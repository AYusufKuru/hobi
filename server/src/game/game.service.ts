import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuid } from 'uuid';
import { hashPassword, verifyPassword } from '../auth/password';
import { PlayerEntity } from '../player/player.entity';
import {
  getCatalogItem,
} from '../hangar/catalog';
import {
  addToDepot,
  catalogForClient,
  deriveStats,
  ensureFit,
  parseLoadout,
  takeFromDepot,
  type Loadout,
} from '../hangar/loadout';
import {
  BulletState,
  CargoBox,
  DEFAULT_MAP_ID,
  GameEvent,
  isMapId,
  MAPS,
  MapId,
  NpcState,
  PlayerInput,
  PlayerState,
  PORTALS,
  portalsOnMap,
  Snapshot,
  WORLD,
} from './game.types';

const COLORS = [
  '#4fc3f7',
  '#81c784',
  '#ffb74d',
  '#e57373',
  '#ba68c8',
  '#4db6ac',
  '#f06292',
  '#fff176',
];

@Injectable()
export class GameService implements OnModuleInit, OnModuleDestroy {
  private players = new Map<string, PlayerState>();
  private sockets = new Map<string, string>();
  private inputs = new Map<string, PlayerInput>();
  private rocketLatch = new Map<string, boolean>();
  private bullets = new Map<string, BulletState>();
  private npcs = new Map<string, NpcState>();
  private cargo = new Map<string, CargoBox>();
  private pendingHits: Array<{
    byId: string;
    targetId: string;
    damage: number;
    npcExtra: number;
    applyAt: number;
  }> = [];
  private tickHandle: NodeJS.Timeout | null = null;
  private readonly tickMs = 1000 / 30;
  private persistCounter = 0;
  private eventQueue: GameEvent[] = [];

  constructor(
    @InjectRepository(PlayerEntity)
    private readonly playerRepo: Repository<PlayerEntity>,
  ) {}

  onModuleInit() {
    this.spawnNpcs();
    this.tickHandle = setInterval(() => {
      this.eventQueue.push(...this.simulate());
    }, this.tickMs);
  }

  onModuleDestroy() {
    if (this.tickHandle) clearInterval(this.tickHandle);
  }

  drainEvents(): GameEvent[] {
    const events = this.eventQueue;
    this.eventQueue = [];
    return events;
  }

  getPlayerIdBySocket(socketId: string) {
    return this.sockets.get(socketId);
  }

  getHangarState(socketId: string) {
    const playerId = this.sockets.get(socketId);
    const player = playerId ? this.players.get(playerId) : undefined;
    if (!player) return { ok: false as const, error: 'Oyunda değilsin' };
    const stats = deriveStats(player.loadout);
    return {
      ok: true as const,
      credits: player.credits,
      gold: player.gold,
      catalog: catalogForClient(),
      loadout: player.loadout,
      stats: {
        speed: player.shipSpeed,
        maxHp: player.maxHp,
        maxShield: player.maxShield,
        laserDamage: player.laserDamage,
        laserNpcBonus: player.laserNpcBonus,
        equippedLasers: player.equippedLasers,
        shieldAbsorb: player.shieldAbsorb,
        laserAmmo: player.laserAmmo,
        laserSlots: stats.laserSlots,
        generatorSlots: stats.generatorSlots,
      },
    };
  }

  buyItem(socketId: string, itemId: string) {
    const player = this.playerFromSocket(socketId);
    if (!player) return { ok: false as const, error: 'Oyunda değilsin' };
    const item = getCatalogItem(itemId);
    if (!item) return { ok: false as const, error: 'Ürün yok' };
    if (item.inMarket === false) {
      return { ok: false as const, error: 'Bu ürün markette satılmıyor' };
    }

    const currency = item.currency ?? 'silver';
    if (currency === 'gold') {
      if (player.gold < item.price) {
        return { ok: false as const, error: 'Yetersiz altın' };
      }
    } else if (player.credits < item.price) {
      return { ok: false as const, error: 'Yetersiz gümüş' };
    }

    const pay = () => {
      if (currency === 'gold') player.gold -= item.price;
      else player.credits -= item.price;
    };

    if (item.category === 'ammo') {
      pay();
      player.laserAmmo += item.ammoAdd ?? 0;
      player.loadout.laserAmmo = player.laserAmmo;
      this.applyLoadoutStats(player);
      void this.persistPlayer(player);
      return { ok: true as const, hangar: this.getHangarState(socketId) };
    }

    if (item.category === 'ships') {
      if (player.loadout.ships.includes(item.id)) {
        return { ok: false as const, error: 'Bu gemi zaten depoda' };
      }
      pay();
      player.loadout.ships.push(item.id);
      ensureFit(player.loadout, item.id);
      this.applyLoadoutStats(player);
      void this.persistPlayer(player);
      return { ok: true as const, hangar: this.getHangarState(socketId) };
    }

    // lasers / generators → depot stack (can buy multiple)
    if (item.category === 'lasers') {
      pay();
      addToDepot(player.loadout.lasers, item.id, 1);
    } else if (item.category === 'generators') {
      pay();
      addToDepot(player.loadout.generators, item.id, 1);
    } else {
      return { ok: false as const, error: 'Satın alınamaz' };
    }
    void this.persistPlayer(player);
    return { ok: true as const, hangar: this.getHangarState(socketId) };
  }

  /** Activate a ship from depot as the flying hull */
  activateShip(socketId: string, shipId: string) {
    const player = this.playerFromSocket(socketId);
    if (!player) return { ok: false as const, error: 'Oyunda değilsin' };
    if (!player.loadout.ships.includes(shipId)) {
      return { ok: false as const, error: 'Bu gemi sende yok' };
    }
    player.loadout.activeShipId = shipId;
    ensureFit(player.loadout, shipId);
    this.applyLoadoutStats(player);
    player.hp = player.maxHp;
    player.shield = player.maxShield;
    void this.persistPlayer(player);
    return { ok: true as const, hangar: this.getHangarState(socketId) };
  }

  /**
   * Equip module from depot into a slot on a ship.
   * slotKind: 'laser' | 'generator'
   */
  equipSlot(
    socketId: string,
    body: {
      shipId?: string;
      slotKind?: 'laser' | 'generator';
      slotIndex?: number;
      itemId?: string;
    },
  ) {
    const player = this.playerFromSocket(socketId);
    if (!player) return { ok: false as const, error: 'Oyunda değilsin' };
    const shipId = body.shipId ?? '';
    const itemId = body.itemId ?? '';
    const slotKind = body.slotKind;
    const slotIndex = Number(body.slotIndex);
    if (!player.loadout.ships.includes(shipId)) {
      return { ok: false as const, error: 'Gemi yok' };
    }
    const item = getCatalogItem(itemId);
    if (!item) return { ok: false as const, error: 'Modül yok' };
    if (slotKind === 'laser' && item.category !== 'lasers') {
      return { ok: false as const, error: 'Bu yuvaya sadece lazer' };
    }
    if (slotKind === 'generator' && item.category !== 'generators') {
      return { ok: false as const, error: 'Bu yuvaya sadece jeneratör' };
    }

    const fit = ensureFit(player.loadout, shipId);
    const slots = slotKind === 'laser' ? fit.lasers : fit.generators;
    const depot =
      slotKind === 'laser' ? player.loadout.lasers : player.loadout.generators;
    if (slotIndex < 0 || slotIndex >= slots.length) {
      return { ok: false as const, error: 'Geçersiz yuva' };
    }
    if (!takeFromDepot(depot, itemId, 1)) {
      return { ok: false as const, error: 'Depoda yok' };
    }
    const previous = slots[slotIndex];
    if (previous) addToDepot(depot, previous, 1);
    slots[slotIndex] = itemId;

    this.applyLoadoutStats(player);
    void this.persistPlayer(player);
    return { ok: true as const, hangar: this.getHangarState(socketId) };
  }

  unequipSlot(
    socketId: string,
    body: {
      shipId?: string;
      slotKind?: 'laser' | 'generator';
      slotIndex?: number;
    },
  ) {
    const player = this.playerFromSocket(socketId);
    if (!player) return { ok: false as const, error: 'Oyunda değilsin' };
    const shipId = body.shipId ?? '';
    const slotKind = body.slotKind;
    const slotIndex = Number(body.slotIndex);
    if (!player.loadout.ships.includes(shipId)) {
      return { ok: false as const, error: 'Gemi yok' };
    }
    const fit = ensureFit(player.loadout, shipId);
    const slots = slotKind === 'laser' ? fit.lasers : fit.generators;
    const depot =
      slotKind === 'laser' ? player.loadout.lasers : player.loadout.generators;
    if (slotIndex < 0 || slotIndex >= slots.length) {
      return { ok: false as const, error: 'Geçersiz yuva' };
    }
    const current = slots[slotIndex];
    if (!current) return { ok: false as const, error: 'Yuva boş' };
    slots[slotIndex] = null;
    addToDepot(depot, current, 1);
    this.applyLoadoutStats(player);
    void this.persistPlayer(player);
    return { ok: true as const, hangar: this.getHangarState(socketId) };
  }

  /** @deprecated kept for compatibility — use activateShip / equipSlot */
  equipItem(socketId: string, itemId: string) {
    return this.activateShip(socketId, itemId);
  }

  unequipItem(_socketId: string, _itemId: string) {
    return { ok: false as const, error: 'Yuvadan çıkar (gemi ekranı)' };
  }

  startPortalJump(socketId: string, portalId: string) {
    const player = this.playerFromSocket(socketId);
    if (!player) return { ok: false as const, error: 'Oyunda değilsin' };
    if (player.hp <= 0) return { ok: false as const, error: 'Öldün' };
    const portal = PORTALS.find(
      (p) => p.id === portalId && p.mapId === player.mapId,
    );
    if (!portal) return { ok: false as const, error: 'Portal yok' };
    const dist = Math.hypot(player.x - portal.x, player.y - portal.y);
    if (dist > WORLD.portalUseRange) {
      return { ok: false as const, error: 'Portala daha yaklaş' };
    }
    const now = Date.now();
    if (now - player.lastPortalAt < 1500) {
      return { ok: false as const, error: 'Portal soğumada' };
    }
    player.portalChannelId = portal.id;
    player.portalChannelEndsAt = now + WORLD.portalChannelMs;
    this.eventQueue.push({
      type: 'portalChannel',
      playerId: player.id,
      portalId: portal.id,
      endsAt: player.portalChannelEndsAt,
    });
    return {
      ok: true as const,
      endsAt: player.portalChannelEndsAt,
      portalId: portal.id,
    };
  }

  private cancelPortalChannel(
    player: PlayerState,
    events: GameEvent[],
    reason: string,
  ) {
    if (!player.portalChannelId) return;
    player.portalChannelId = null;
    player.portalChannelEndsAt = 0;
    events.push({
      type: 'portalCancel',
      playerId: player.id,
      reason,
    });
  }

  getMapIdForSocket(socketId: string): MapId | null {
    const player = this.playerFromSocket(socketId);
    return player?.mapId ?? null;
  }

  private chatCooldown = new Map<string, number>();

  sendChat(socketId: string, rawText: string) {
    const player = this.playerFromSocket(socketId);
    if (!player) return { ok: false as const, error: 'Oyunda değilsin' };
    if (player.hp <= 0) return { ok: false as const, error: 'Öldün' };

    const text = (rawText || '')
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .trim()
      .slice(0, 120);
    if (!text) return { ok: false as const, error: 'Boş mesaj' };

    const now = Date.now();
    const last = this.chatCooldown.get(player.id) ?? 0;
    if (now - last < 400) {
      return { ok: false as const, error: 'Çok hızlı' };
    }
    this.chatCooldown.set(player.id, now);

    return {
      ok: true as const,
      message: {
        id: uuid(),
        playerId: player.id,
        name: player.name,
        text,
        mapId: player.mapId,
        at: now,
      },
    };
  }

  getSnapshot(mapId: MapId = DEFAULT_MAP_ID): Snapshot {
    const map = MAPS[mapId] ?? MAPS[DEFAULT_MAP_ID];
    return {
      players: [...this.players.values()]
        .filter((p) => p.mapId === mapId)
        .map((p) => {
          const {
            lastShotAt,
            lastLaserDpsAt,
            lastRocketAt,
            lastDamageAt,
            lastMovedAt,
            lastRepairAt,
            lastShieldRegenAt,
            vx,
            vy,
            lastPortalAt,
            portalChannelId,
            portalChannelEndsAt,
            loadout: _loadout,
            ...rest
          } = p;
          void lastShotAt;
          void lastLaserDpsAt;
          void lastRocketAt;
          void lastDamageAt;
          void lastMovedAt;
          void lastRepairAt;
          void lastShieldRegenAt;
          void lastPortalAt;
          void portalChannelId;
          void portalChannelEndsAt;
          void _loadout;
          const aim = this.resolveTargetPos(p.targetId, p.mapId);
          const inRange = !!(
            aim &&
            Math.hypot(aim.x - p.x, aim.y - p.y) <= WORLD.laserRange
          );
          return {
            ...rest,
            moving: Math.hypot(vx, vy) > 12,
            inRange,
          };
        }),
      bullets: [...this.bullets.values()]
        .filter((b) => b.mapId === mapId)
        .map(({ id, ownerId, targetId, aimX, aimY, frozen, x, y, kind }) => ({
          id,
          ownerId,
          targetId,
          aimX,
          aimY,
          frozen,
          x,
          y,
          kind,
        })),
      npcs: [...this.npcs.values()]
        .filter((n) => n.mapId === mapId)
        .map(
          ({
            vx: _vx,
            vy: _vy,
            lastShotAt: _ls,
            lastDpsAt: _ld,
            aggroId: _ag,
            nextWanderAt: _nw,
            engageAngle: _ea,
            engageDist: _ed,
            engageAnchorX: _eax,
            engageAnchorY: _eay,
            ...rest
          }) => rest,
        ),
      cargo: [...this.cargo.values()],
      portals: [...portalsOnMap(mapId)],
      mapId,
      mapName: map.name,
      serverTime: Date.now(),
    };
  }

  async register(rawEmail: string, rawName: string, rawPassword: string) {
    const email = (rawEmail || '').trim().toLowerCase().slice(0, 120);
    const name = (rawName || '').trim().slice(0, 16);
    const password = rawPassword || '';

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { ok: false as const, error: 'Geçerli bir e-posta gir' };
    }
    if (name.length < 2) {
      return { ok: false as const, error: 'İsim en az 2 karakter' };
    }
    if (password.length < 6) {
      return { ok: false as const, error: 'Şifre en az 6 karakter' };
    }

    const nameTaken = await this.playerRepo
      .createQueryBuilder('p')
      .where('LOWER(p.name) = LOWER(:name)', { name })
      .getOne();
    const emailTaken = await this.playerRepo
      .createQueryBuilder('p')
      .where('LOWER(p.email) = LOWER(:email)', { email })
      .getOne();

    // Claim legacy name-only account (no password yet)
    if (nameTaken && !nameTaken.passwordHash) {
      if (emailTaken && emailTaken.id !== nameTaken.id) {
        return { ok: false as const, error: 'Bu e-posta kullanımda' };
      }
      nameTaken.email = email;
      nameTaken.passwordHash = await hashPassword(password);
      await this.playerRepo.save(nameTaken);
      return { ok: true as const, name: nameTaken.name };
    }

    if (nameTaken) {
      return { ok: false as const, error: 'Bu isim alınmış' };
    }
    if (emailTaken) {
      return { ok: false as const, error: 'Bu e-posta kullanımda' };
    }

    const loadout = parseLoadout('');
    const stats = deriveStats(loadout);
    const entity = this.playerRepo.create({
      id: uuid(),
      name,
      email,
      passwordHash: await hashPassword(password),
      x: 420 + Math.random() * 80,
      y: 420 + Math.random() * 80,
      mapId: DEFAULT_MAP_ID,
      hp: stats.maxHp,
      credits: 10000,
      gold: 2000,
      kills: 0,
      loadoutJson: JSON.stringify(loadout),
    });
    await this.playerRepo.save(entity);
    return { ok: true as const, name: entity.name };
  }

  async join(socketId: string, rawName: string, rawPassword: string) {
    const name = (rawName || '').trim().slice(0, 16);
    const password = rawPassword || '';
    if (!name) return { ok: false as const, error: 'İsim gerekli' };
    if (!password) return { ok: false as const, error: 'Şifre gerekli' };

    const existingOnline = [...this.players.values()].find(
      (p) => p.name.toLowerCase() === name.toLowerCase(),
    );
    if (existingOnline) {
      return { ok: false as const, error: 'Bu isim şu an oyunda' };
    }

    const entity = await this.playerRepo
      .createQueryBuilder('p')
      .where('LOWER(p.name) = LOWER(:name)', { name })
      .getOne();
    if (!entity) {
      return { ok: false as const, error: 'Hesap bulunamadı — önce kayıt ol' };
    }
    if (!entity.passwordHash) {
      return {
        ok: false as const,
        error: 'Bu hesap için şifre yok — Kayıt ol ile bağla',
      };
    }
    const okPass = await verifyPassword(password, entity.passwordHash);
    if (!okPass) {
      return { ok: false as const, error: 'İsim veya şifre yanlış' };
    }

    const loadout = parseLoadout(entity.loadoutJson);
    const stats = deriveStats(loadout);

    entity.hp = stats.maxHp;
    entity.x = 420 + Math.random() * 80;
    entity.y = 420 + Math.random() * 80;
    if (!entity.mapId || !isMapId(entity.mapId)) {
      entity.mapId = DEFAULT_MAP_ID;
    }
    entity.loadoutJson = JSON.stringify(loadout);
    if (entity.credits < 50) {
      entity.credits = Math.max(entity.credits, 200);
    }
    if (entity.gold == null) entity.gold = 25;
    await this.playerRepo.save(entity);

    const mapId: MapId = isMapId(entity.mapId) ? entity.mapId : DEFAULT_MAP_ID;
    const color = COLORS[Math.abs(this.hash(name)) % COLORS.length];
    const player: PlayerState = {
      id: entity.id,
      name: entity.name,
      mapId,
      x: entity.x,
      y: entity.y,
      vx: 0,
      vy: 0,
      angle: 0,
      hp: stats.maxHp,
      maxHp: stats.maxHp,
      shield: stats.maxShield,
      maxShield: stats.maxShield,
      credits: entity.credits,
      gold: entity.gold ?? 25,
      kills: entity.kills,
      rockets: WORLD.startingRockets,
      laserAmmo: loadout.laserAmmo,
      shipId: loadout.activeShipId,
      shipSprite: stats.sprite,
      shipSpeed: stats.speed,
      laserDamage: stats.laserDamage,
      laserNpcBonus: stats.laserNpcBonus,
      equippedLasers: stats.equippedLasers,
      shieldAbsorb: stats.shieldAbsorb,
      loadout,
      color,
      lastShotAt: 0,
      lastLaserDpsAt: 0,
      lastRocketAt: 0,
      lastDamageAt: 0,
      lastMovedAt: Date.now(),
      lastRepairAt: Date.now(),
      lastShieldRegenAt: Date.now(),
      targetId: null,
      firing: false,
      lastPortalAt: 0,
      portalChannelId: null,
      portalChannelEndsAt: 0,
    };

    this.players.set(player.id, player);
    this.sockets.set(socketId, player.id);
    this.inputs.set(player.id, {
      destX: null,
      destY: null,
      targetId: null,
      firing: false,
      fireRocket: false,
    });
    this.rocketLatch.set(player.id, false);

    const {
      lastShotAt: _a,
      lastLaserDpsAt: _dps,
      lastRocketAt: _b,
      lastDamageAt: _c,
      lastMovedAt: _m,
      lastRepairAt: _r,
      lastShieldRegenAt: _sr,
      vx: _vx,
      vy: _vy,
      lastPortalAt: _p,
      portalChannelId: _pc,
      portalChannelEndsAt: _pe,
      loadout: _l,
      ...self
    } = player;

    return {
      ok: true as const,
      self,
      world: WORLD,
      snapshot: this.getSnapshot(mapId),
      hangar: this.getHangarState(socketId),
    };
  }

  leave(socketId: string) {
    const playerId = this.sockets.get(socketId);
    if (!playerId) return null;
    this.sockets.delete(socketId);
    this.inputs.delete(playerId);
    this.rocketLatch.delete(playerId);
    const player = this.players.get(playerId);
    this.players.delete(playerId);
    for (const [id, b] of this.bullets) {
      if (b.ownerId === playerId) this.bullets.delete(id);
    }
    void this.persistPlayer(player);
    return playerId;
  }

  setInput(socketId: string, input: PlayerInput) {
    const playerId = this.sockets.get(socketId);
    if (!playerId || !this.players.has(playerId)) return;

    const destX =
      input.destX === null || input.destX === undefined
        ? null
        : this.clamp(Number(input.destX), 0, WORLD.width);
    const destY =
      input.destY === null || input.destY === undefined
        ? null
        : this.clamp(Number(input.destY), 0, WORLD.height);

    const targetId =
      typeof input.targetId === 'string' && input.targetId.length > 0
        ? input.targetId
        : null;

    this.inputs.set(playerId, {
      destX,
      destY,
      targetId,
      firing: !!input.firing && !!targetId,
      fireRocket: !!input.fireRocket,
    });
  }

  private simulate(): GameEvent[] {
    const dt = this.tickMs / 1000;
    const now = Date.now();
    const events: GameEvent[] = [];

    for (const player of this.players.values()) {
      if (player.hp <= 0) {
        player.vx = 0;
        player.vy = 0;
        player.firing = false;
        continue;
      }

      const input = this.inputs.get(player.id);
      if (!input) continue;

      player.targetId = input.targetId;
      player.firing = input.firing && !!input.targetId;

      const aim = this.resolveTargetPos(player.targetId, player.mapId);
      if (player.targetId && !aim) {
        player.targetId = null;
        player.firing = false;
        input.targetId = null;
        input.firing = false;
      }

      // Movement
      player.vx = 0;
      player.vy = 0;
      if (input.destX !== null && input.destY !== null) {
        const dx = input.destX - player.x;
        const dy = input.destY - player.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= WORLD.arriveRadius) {
          player.x = input.destX;
          player.y = input.destY;
          input.destX = null;
          input.destY = null;
          player.vx = 0;
          player.vy = 0;
        } else {
          const step = Math.min(player.shipSpeed * dt, dist);
          player.vx = (dx / dist) * player.shipSpeed;
          player.vy = (dy / dist) * player.shipSpeed;
          player.x = this.clamp(
            player.x + (dx / dist) * step,
            WORLD.shipRadius,
            WORLD.width - WORLD.shipRadius,
          );
          player.y = this.clamp(
            player.y + (dy / dist) * step,
            WORLD.shipRadius,
            WORLD.height - WORLD.shipRadius,
          );
        }
      }

      if (aim) {
        player.angle = Math.atan2(aim.y - player.y, aim.x - player.x);
      } else if (input.destX !== null && input.destY !== null) {
        player.angle = Math.atan2(input.destY - player.y, input.destX - player.x);
      } else if (Math.hypot(player.vx, player.vy) > 1) {
        player.angle = Math.atan2(player.vy, player.vx);
      }

      // Portal channel complete (click-to-jump, 3s cast)
      if (
        player.portalChannelId &&
        player.portalChannelEndsAt > 0 &&
        now >= player.portalChannelEndsAt
      ) {
        const portal = PORTALS.find(
          (p) => p.id === player.portalChannelId && p.mapId === player.mapId,
        );
        player.portalChannelId = null;
        player.portalChannelEndsAt = 0;
        if (portal) {
          player.mapId = portal.toMapId;
          player.x = portal.toX + (Math.random() - 0.5) * 40;
          player.y = portal.toY + (Math.random() - 0.5) * 40;
          player.vx = 0;
          player.vy = 0;
          player.targetId = null;
          player.firing = false;
          player.lastPortalAt = now;
          input.destX = null;
          input.destY = null;
          input.targetId = null;
          input.firing = false;
          events.push({
            type: 'portal',
            playerId: player.id,
            portalId: portal.id,
            mapId: portal.toMapId,
            mapName: MAPS[portal.toMapId].name,
          });
        }
      }

      // Radiation zone (map edge)
      const rad = WORLD.radiationInset;
      if (
        player.x < rad ||
        player.y < rad ||
        player.x > WORLD.width - rad ||
        player.y > WORLD.height - rad
      ) {
        this.applyDamage(player, WORLD.radiationDps * dt, events, 'radiation');
      }

      // Shield regen — after 3s without damage, +5% maxShield / sec (ok while moving)
      if (now - player.lastDamageAt < WORLD.shieldRegenDelayMs) {
        player.lastShieldRegenAt = now;
      } else if (
        player.maxShield > 0 &&
        player.shield < player.maxShield &&
        now - player.lastShieldRegenAt >= WORLD.shieldRegenIntervalMs
      ) {
        player.lastShieldRegenAt = now;
        const shHeal = Math.max(
          1,
          Math.round(player.maxShield * WORLD.shieldRegenPct),
        );
        player.shield = Math.min(player.maxShield, player.shield + shHeal);
      }

      // Hull repair — after 3s idle + no damage, +3% maxHp / sec
      const isMoving =
        Math.hypot(player.vx, player.vy) > 8 ||
        (input.destX !== null && input.destY !== null);
      if (isMoving) {
        player.lastMovedAt = now;
        player.lastRepairAt = now;
      } else if (
        player.hp > 0 &&
        player.hp < player.maxHp &&
        now - player.lastMovedAt >= WORLD.repairIdleMs &&
        now - player.lastDamageAt >= WORLD.repairIdleMs &&
        now - player.lastRepairAt >= WORLD.repairIntervalMs
      ) {
        player.lastRepairAt = now;
        const heal = Math.max(1, Math.round(player.maxHp * WORLD.repairPct));
        player.hp = Math.min(player.maxHp, player.hp + heal);
      }

      // Laser — visual beams lock to targetId at fire time; DPS is per-second
      const laserDist = aim
        ? Math.hypot(aim.x - player.x, aim.y - player.y)
        : Infinity;
      const canLaser =
        player.firing &&
        player.equippedLasers > 0 &&
        !!player.targetId &&
        !!aim &&
        laserDist <= WORLD.laserRange;

      if (canLaser && now - player.lastShotAt >= WORLD.fireCooldownMs) {
        player.lastShotAt = now;
        // Dual visual lasers (left + right barrels), every 0.5s
        const fireAng = Math.atan2(aim!.y - player.y, aim!.x - player.x);
        const perpX = -Math.sin(fireAng) * 9;
        const perpY = Math.cos(fireAng) * 9;
        for (const side of [-1, 1] as const) {
          this.spawnProjectileFrom(
            player.id,
            player.mapId,
            player.x + perpX * side,
            player.y + perpY * side,
            aim!.x,
            aim!.y,
            'laser',
            0,
            WORLD.bulletSpeed,
            0,
            player.targetId!,
          );
        }
      }

      if (canLaser && now - player.lastLaserDpsAt >= WORLD.laserDpsIntervalMs) {
        player.lastLaserDpsAt = now;
        if (player.laserAmmo > 0) {
          player.laserAmmo = Math.max(0, player.laserAmmo - 5);
          player.loadout.laserAmmo = player.laserAmmo;
          if (player.laserAmmo === 0) this.applyLoadoutStats(player);
        }
        // Damage applies on fire, not when the beam arrives
        this.dealLockedDamage(
          player.id,
          player.targetId!,
          player.laserDamage,
          player.laserNpcBonus,
          events,
        );
      } else if (!canLaser) {
        // Next burst starts with an immediate hit
        player.lastLaserDpsAt = Math.min(
          player.lastLaserDpsAt,
          now - WORLD.laserDpsIntervalMs,
        );
      }

      // Rocket (Space) — locks target at fire time
      const wantRocket = input.fireRocket;
      const wasRocket = this.rocketLatch.get(player.id) ?? false;
      if (wantRocket && !wasRocket) {
        if (
          aim &&
          player.targetId &&
          player.rockets > 0 &&
          laserDist <= WORLD.rocketRange &&
          now - player.lastRocketAt >= WORLD.rocketCooldownMs
        ) {
          player.lastRocketAt = now;
          player.rockets -= 1;
          this.spawnProjectileFrom(
            player.id,
            player.mapId,
            player.x,
            player.y,
            aim.x,
            aim.y,
            'rocket',
            WORLD.rocketDamage,
            WORLD.rocketSpeed,
            0,
            player.targetId,
          );
          events.push({
            type: 'credits',
            playerId: player.id,
            credits: player.credits,
            gold: player.gold,
            kills: player.kills,
            rockets: player.rockets,
          });
        }
      }
      this.rocketLatch.set(player.id, wantRocket);

      // Cargo boxes disabled for now (resources later)

    }

    // NPCs — passive until damaged by a player, then flank + shoot
    for (const npc of this.npcs.values()) {
      if (npc.hp <= 0) continue;

      // Keep / lose aggro (aggro only set when hit by a player)
      if (npc.aggroId) {
        const prey = this.players.get(npc.aggroId);
        const d = prey && prey.hp > 0
          ? Math.hypot(prey.x - npc.x, prey.y - npc.y)
          : Infinity;
        if (!prey || prey.hp <= 0 || prey.mapId !== npc.mapId || d > WORLD.npcLeashRange) {
          npc.aggroId = null;
          npc.nextWanderAt = 0;
          npc.engageDist = 0;
        }
      }

      const prey = npc.aggroId ? this.players.get(npc.aggroId) : null;
      if (prey && prey.hp > 0 && prey.mapId === npc.mapId) {
        const preyMoved =
          Math.hypot(prey.x - npc.engageAnchorX, prey.y - npc.engageAnchorY) >=
          WORLD.npcRepositionMove;
        if (npc.engageDist <= 0 || preyMoved) {
          this.pickNpcEngage(npc, prey.x, prey.y);
        }

        const holdX =
          prey.x + Math.cos(npc.engageAngle) * npc.engageDist;
        const holdY =
          prey.y + Math.sin(npc.engageAngle) * npc.engageDist;
        const toHoldX = holdX - npc.x;
        const toHoldY = holdY - npc.y;
        const toHold = Math.hypot(toHoldX, toHoldY);
        if (toHold > 22) {
          npc.vx = (toHoldX / toHold) * WORLD.npcSpeed;
          npc.vy = (toHoldY / toHold) * WORLD.npcSpeed;
        } else {
          npc.vx = 0;
          npc.vy = 0;
        }
        npc.angle = Math.atan2(prey.y - npc.y, prey.x - npc.x);

        const d = Math.hypot(prey.x - npc.x, prey.y - npc.y);
        if (d <= WORLD.npcLaserRange) {
          if (now - npc.lastShotAt >= WORLD.npcFireCooldownMs) {
            npc.lastShotAt = now;
            this.spawnProjectileFrom(
              npc.id,
              npc.mapId,
              npc.x,
              npc.y,
              prey.x,
              prey.y,
              'laser',
              0,
              WORLD.npcBulletSpeed,
              0,
              prey.id,
            );
          }
          if (now - npc.lastDpsAt >= WORLD.laserDpsIntervalMs) {
            npc.lastDpsAt = now;
            this.dealLockedDamage(
              npc.id,
              prey.id,
              WORLD.npcLaserDamage,
              0,
              events,
            );
          }
        }
      } else {
        // Random wander
        if (now >= npc.nextWanderAt) {
          const ang = Math.random() * Math.PI * 2;
          npc.vx = Math.cos(ang) * WORLD.npcWanderSpeed;
          npc.vy = Math.sin(ang) * WORLD.npcWanderSpeed;
          npc.angle = ang;
          npc.nextWanderAt = now + 1800 + Math.random() * 3200;
        }
      }

      npc.x = this.clamp(npc.x + npc.vx * dt, 20, WORLD.width - 20);
      npc.y = this.clamp(npc.y + npc.vy * dt, 20, WORLD.height - 20);
      if (npc.x <= 20 || npc.x >= WORLD.width - 20) {
        npc.vx *= -1;
        npc.angle = Math.atan2(npc.vy, npc.vx);
      }
      if (npc.y <= 20 || npc.y >= WORLD.height - 20) {
        npc.vy *= -1;
        npc.angle = Math.atan2(npc.vy, npc.vx);
      }
      if (!npc.aggroId) {
        npc.angle = Math.atan2(npc.vy, npc.vx);
      }
    }

    this.flushPendingHits(now, events);

    // Projectiles — home to live target, or frozen death spot
    for (const [id, bullet] of this.bullets) {
      if (!bullet.frozen) {
        const live = this.resolveTargetPos(bullet.targetId, bullet.mapId);
        if (live) {
          bullet.aimX = live.x;
          bullet.aimY = live.y;
        } else {
          // Target gone — keep last aim and finish the flight there
          bullet.frozen = true;
        }
      }

      const ang = Math.atan2(bullet.aimY - bullet.y, bullet.aimX - bullet.x);
      const spd =
        bullet.kind === 'rocket' ? WORLD.rocketSpeed : WORLD.bulletSpeed;
      bullet.vx = Math.cos(ang) * spd;
      bullet.vy = Math.sin(ang) * spd;
      bullet.x += bullet.vx * dt;
      bullet.y += bullet.vy * dt;

      const life =
        bullet.kind === 'rocket' ? WORLD.rocketLifetimeMs : WORLD.bulletLifetimeMs;
      if (
        now - bullet.bornAt > life ||
        bullet.x < -40 ||
        bullet.y < -40 ||
        bullet.x > WORLD.width + 40 ||
        bullet.y > WORLD.height + 40
      ) {
        this.bullets.delete(id);
        continue;
      }

      const hitR =
        bullet.kind === 'rocket'
          ? WORLD.rocketRadius + 14
          : WORLD.bulletRadius + 22;
      const dist = Math.hypot(bullet.aimX - bullet.x, bullet.aimY - bullet.y);
      if (dist > hitR) continue;

      // Reached aim point
      if (bullet.kind === 'laser' || bullet.damage <= 0 || bullet.frozen) {
        this.bullets.delete(id);
        continue;
      }

      this.dealLockedDamage(
        bullet.ownerId,
        bullet.targetId,
        bullet.damage,
        bullet.npcExtra,
        events,
      );
      this.bullets.delete(id);
    }

    this.persistCounter += 1;
    if (this.persistCounter >= 60) {
      this.persistCounter = 0;
      void this.persistAll();
    }

    return events;
  }

  private spawnProjectile(
    player: PlayerState,
    aim: { x: number; y: number },
    kind: 'laser' | 'rocket',
    damage: number,
    speed: number,
    _life: number,
    npcExtra = 0,
  ) {
    if (!player.targetId) return;
    this.spawnProjectileFrom(
      player.id,
      player.mapId,
      player.x,
      player.y,
      aim.x,
      aim.y,
      kind,
      damage,
      speed,
      npcExtra,
      player.targetId,
    );
  }

  private spawnProjectileFrom(
    ownerId: string,
    mapId: MapId,
    x: number,
    y: number,
    aimX: number,
    aimY: number,
    kind: 'laser' | 'rocket',
    damage: number,
    speed: number,
    npcExtra = 0,
    targetId: string,
  ) {
    const fireAngle = Math.atan2(aimY - y, aimX - x);
    const id = uuid();
    this.bullets.set(id, {
      id,
      ownerId,
      mapId,
      targetId,
      aimX,
      aimY,
      frozen: false,
      x: x + Math.cos(fireAngle) * 26,
      y: y + Math.sin(fireAngle) * 26,
      vx: Math.cos(fireAngle) * speed,
      vy: Math.sin(fireAngle) * speed,
      bornAt: Date.now(),
      kind,
      damage,
      npcExtra,
    });
  }

  private freezeBulletsOnTarget(targetId: string, x: number, y: number) {
    for (const b of this.bullets.values()) {
      if (b.targetId === targetId && !b.frozen) {
        b.aimX = x;
        b.aimY = y;
        b.frozen = true;
      }
    }
  }

  private queueLockedHit(hit: {
    byId: string;
    targetId: string;
    damage: number;
    npcExtra: number;
    applyAt: number;
  }) {
    this.pendingHits.push(hit);
  }

  private flushPendingHits(now: number, events: GameEvent[]) {
    if (this.pendingHits.length === 0) return;
    const due: typeof this.pendingHits = [];
    const keep: typeof this.pendingHits = [];
    for (const h of this.pendingHits) {
      if (h.applyAt <= now) due.push(h);
      else keep.push(h);
    }
    this.pendingHits = keep;
    for (const h of due) {
      this.dealLockedDamage(h.byId, h.targetId, h.damage, h.npcExtra, events);
    }
  }

  private dealLockedDamage(
    byId: string,
    targetId: string,
    damage: number,
    npcExtra: number,
    events: GameEvent[],
  ) {
    if (damage <= 0) return;
    const playerTarget = this.players.get(targetId);
    if (playerTarget && playerTarget.hp > 0) {
      this.damagePlayer(playerTarget, damage, byId, events);
      return;
    }
    const npc = this.npcs.get(targetId);
    if (!npc || npc.hp <= 0) return;
    // Taking damage from a player pulls aggro
    if (this.players.has(byId)) {
      if (npc.aggroId !== byId) npc.engageDist = 0;
      npc.aggroId = byId;
    }
    const amount = damage + (npcExtra > 0 ? npcExtra : 0);
    npc.hp = Math.max(0, npc.hp - amount);
    events.push({
      type: 'hit',
      targetId: npc.id,
      hp: npc.hp,
      shield: 0,
      byId,
      kind: 'npc',
      damage: amount,
    });
    if (npc.hp <= 0) {
      this.freezeBulletsOnTarget(npc.id, npc.x, npc.y);
      const killer = this.players.get(byId);
      if (killer) {
        killer.credits += WORLD.npcCredits;
        killer.gold += WORLD.npcGold;
        events.push({
          type: 'credits',
          playerId: killer.id,
          credits: killer.credits,
          gold: killer.gold,
          kills: killer.kills,
          rockets: killer.rockets,
        });
      }
      events.push({
        type: 'killed',
        victimId: npc.id,
        killerId: byId,
        kind: 'npc',
      });
      this.clearLocksOn(npc.id);
      this.respawnNpc(npc);
    }
  }

  private damagePlayer(
    target: PlayerState,
    amount: number,
    byId: string,
    events: GameEvent[],
  ) {
    target.lastDamageAt = Date.now();
    target.lastRepairAt = Date.now();
    target.lastShieldRegenAt = Date.now();
    this.cancelPortalChannel(target, events, 'hasar');
    this.applyShieldAndHull(target, amount);
    events.push({
      type: 'hit',
      targetId: target.id,
      hp: target.hp,
      shield: target.shield,
      byId,
      kind: 'player',
      damage: amount,
    });
    if (target.hp <= 0) {
      this.freezeBulletsOnTarget(target.id, target.x, target.y);
      const killer = this.players.get(byId);
      if (killer) {
        killer.kills += 1;
        killer.credits += WORLD.killCredits;
        events.push({
          type: 'credits',
          playerId: killer.id,
          credits: killer.credits,
          gold: killer.gold,
          kills: killer.kills,
          rockets: killer.rockets,
        });
      }
      events.push({
        type: 'killed',
        victimId: target.id,
        killerId: byId,
        kind: 'player',
      });
      events.push({ type: 'youDied', victimId: target.id });
      this.clearLocksOn(target.id);
      this.scheduleRespawn(target.id);
    }
  }

  private applyShieldAndHull(target: PlayerState, amount: number) {
    if (amount <= 0) return;
    const absorb =
      target.shield > 0 && target.maxShield > 0
        ? Math.max(0, Math.min(100, target.shieldAbsorb)) / 100
        : 0;
    if (absorb <= 0 || target.shield <= 0) {
      target.hp = Math.max(0, target.hp - amount);
      return;
    }
    let toShield = Math.round(amount * absorb);
    let toHull = amount - toShield;
    if (toShield > target.shield) {
      toHull += toShield - target.shield;
      toShield = target.shield;
    }
    target.shield -= toShield;
    if (toHull > 0) target.hp = Math.max(0, target.hp - toHull);
  }

  private applyDamage(
    target: PlayerState,
    amount: number,
    events: GameEvent[],
    _source: string,
  ) {
    if (amount <= 0 || target.hp <= 0) return;
    target.lastDamageAt = Date.now();
    target.lastRepairAt = Date.now();
    target.lastShieldRegenAt = Date.now();
    this.cancelPortalChannel(target, events, 'hasar');
    this.applyShieldAndHull(target, amount);
    if (target.hp <= 0) {
      events.push({ type: 'youDied', victimId: target.id });
      this.clearLocksOn(target.id);
      this.scheduleRespawn(target.id);
    }
  }

  private clearLocksOn(targetId: string) {
    for (const player of this.players.values()) {
      if (player.targetId === targetId) {
        player.targetId = null;
        player.firing = false;
      }
    }
    for (const input of this.inputs.values()) {
      if (input.targetId === targetId) {
        input.targetId = null;
        input.firing = false;
      }
    }
  }

  private resolveTargetPos(targetId: string | null, mapId?: MapId) {
    if (!targetId) return null;
    const player = this.players.get(targetId);
    if (player && player.hp > 0) {
      if (mapId && player.mapId !== mapId) return null;
      return { x: player.x, y: player.y };
    }
    const npc = this.npcs.get(targetId);
    if (npc && npc.hp > 0) {
      if (mapId && npc.mapId !== mapId) return null;
      return { x: npc.x, y: npc.y };
    }
    return null;
  }

  private scheduleRespawn(playerId: string) {
    setTimeout(() => {
      const player = this.players.get(playerId);
      if (!player) return;
      player.hp = player.maxHp;
      player.shield = player.maxShield;
      player.mapId = DEFAULT_MAP_ID;
      player.x = 420 + Math.random() * 80;
      player.y = 420 + Math.random() * 80;
      player.vx = 0;
      player.vy = 0;
      player.targetId = null;
      player.firing = false;
      player.rockets = Math.max(player.rockets, 5);
    }, 2500);
  }

  private spawnNpcs() {
    for (const mapId of Object.keys(MAPS) as MapId[]) {
      for (let i = 0; i < WORLD.npcCount; i++) {
        const id = `npc-${mapId}-${i}`;
        this.npcs.set(id, this.makeNpc(id, mapId));
      }
    }
  }

  private makeNpc(id: string, mapId: MapId): NpcState {
    const angle = Math.random() * Math.PI * 2;
    const spd = WORLD.npcWanderSpeed;
    const map = MAPS[mapId];
    return {
      id,
      name: 'Streuner',
      mapId,
      x: 600 + Math.random() * (map.width - 1200),
      y: 600 + Math.random() * (map.height - 1200),
      angle,
      hp: WORLD.npcHp,
      vx: Math.cos(angle) * spd,
      vy: Math.sin(angle) * spd,
      lastShotAt: 0,
      lastDpsAt: 0,
      aggroId: null,
      nextWanderAt: Date.now() + 1000 + Math.random() * 2000,
      engageAngle: 0,
      engageDist: 0,
      engageAnchorX: 0,
      engageAnchorY: 0,
    };
  }

  private pickNpcEngage(npc: NpcState, preyX: number, preyY: number) {
    const slack = WORLD.npcPreferSlack;
    const prefer = WORLD.npcPreferRange;
    npc.engageDist = prefer * (1 - slack + Math.random() * slack * 2);
    npc.engageAngle = Math.random() * Math.PI * 2;
    npc.engageAnchorX = preyX;
    npc.engageAnchorY = preyY;
  }

  private respawnNpc(npc: NpcState) {
    Object.assign(npc, this.makeNpc(npc.id, npc.mapId));
  }

  private async persistAll() {
    for (const player of this.players.values()) {
      await this.persistPlayer(player);
    }
  }

  private async persistPlayer(player?: PlayerState) {
    if (!player) return;
    await this.playerRepo.update(
      { id: player.id },
      {
        x: player.x,
        y: player.y,
        mapId: player.mapId,
        hp: Math.max(player.hp, 1),
        credits: player.credits,
        gold: player.gold,
        kills: player.kills,
        loadoutJson: JSON.stringify(this.toLoadout(player)),
      },
    );
  }

  private playerFromSocket(socketId: string) {
    const id = this.sockets.get(socketId);
    return id ? this.players.get(id) : undefined;
  }

  private toLoadout(player: PlayerState): Loadout {
    player.loadout.laserAmmo = player.laserAmmo;
    player.loadout.activeShipId = player.shipId;
    return player.loadout;
  }

  private applyLoadoutStats(player: PlayerState) {
    player.loadout.laserAmmo = player.laserAmmo;
    const prevMaxShield = player.maxShield;
    const stats = deriveStats(player.loadout);
    player.shipId = player.loadout.activeShipId;
    player.shipSpeed = stats.speed;
    player.maxHp = stats.maxHp;
    player.maxShield = stats.maxShield;
    player.laserDamage = stats.laserDamage;
    player.laserNpcBonus = stats.laserNpcBonus;
    player.equippedLasers = stats.equippedLasers;
    player.shieldAbsorb = stats.shieldAbsorb;
    player.shipSprite = stats.sprite;
    player.laserAmmo = player.loadout.laserAmmo;
    player.hp = Math.min(player.hp, player.maxHp);
    if (stats.maxShield > prevMaxShield) {
      player.shield += stats.maxShield - prevMaxShield;
    }
    player.shield = Math.min(player.shield, player.maxShield);
  }

  private clamp(v: number, min: number, max: number) {
    return Math.max(min, Math.min(max, v));
  }

  private hash(s: string) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return h;
  }
}
