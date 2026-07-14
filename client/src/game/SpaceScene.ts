import Phaser from 'phaser';
import type { GameSocket } from './socket';
import { sendInput } from './socket';
import type {
  NpcPublic,
  PlayerPublic,
  Snapshot,
  WorldConfig,
} from './types';
import { droidLocalOffset, MAX_DROIDS } from './droidFormation';

export type SceneHud = {
  onStats?: (stats: {
    hp: number;
    maxHp: number;
    shield: number;
    maxShield: number;
    credits: number;
    gold: number;
    kills: number;
    name: string;
    mapName: string;
    targetName: string | null;
    firing: boolean;
    rockets: number;
    laserAmmo: number;
    inRange: boolean;
  }) => void;
  onToast?: (message: string | null) => void;
};

type ShipGfx = {
  root: Phaser.GameObjects.Container;
  sprite: Phaser.GameObjects.Image;
  glow: Phaser.GameObjects.Image;
  thrust: Phaser.GameObjects.Particles.ParticleEmitter;
  label: Phaser.GameObjects.Text;
  hp: Phaser.GameObjects.Graphics;
  droids: Phaser.GameObjects.Image[];
  lastHp: number;
  renderX: number;
  renderY: number;
  renderAngle: number;
};

type NpcGfx = {
  root: Phaser.GameObjects.Container;
  sprite: Phaser.GameObjects.Image;
  glow: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  hp: Phaser.GameObjects.Graphics;
  spriteKey: string;
  barW: number;
  labelY: number;
  lastHp: number;
  renderX: number;
  renderY: number;
  renderAngle: number;
};

type BulletGfx = {
  img: Phaser.GameObjects.Image;
  renderX: number;
  renderY: number;
  kind: 'laser' | 'rocket';
  targetId: string | null;
  aimX: number;
  aimY: number;
  frozen: boolean;
};

const SHIP_ANGLE_OFFSET = Math.PI / 2;
const PICK_RADIUS = 42;
const DOUBLE_CLICK_MS = 320;
const DOUBLE_CLICK_DIST = 48;
const MINIMAP_W = 168;
const MINIMAP_H = 112;
/** Screen-edge margin in CSS/camera pixels (after zoom) */
const MINIMAP_PAD = 40;
const ROCKET_HOLD_FRAMES = 4;

export class SpaceScene extends Phaser.Scene {
  private socket!: GameSocket;
  private selfId!: string;
  private world!: WorldConfig;
  private hud!: SceneHud;

  private ships = new Map<string, ShipGfx>();
  private npcs = new Map<string, NpcGfx>();
  private bullets = new Map<string, BulletGfx>();
  private latest?: Snapshot;

  private destX: number | null = null;
  private destY: number | null = null;
  /** Show minimap dest mark only when destination was set via minimap click */
  private destFromMinimap = false;
  private targetId: string | null = null;
  private firing = false;
  private fireRocket = false;
  private rocketHoldFrames = 0;
  private deadUntil = 0;
  /** Sol tık basılı tutulunca imleç yönüne sürekli git */
  private holdSteer = false;

  private lastClickAt = 0;
  private lastClickX = 0;
  private lastClickY = 0;

  private destMarker!: Phaser.GameObjects.Graphics;
  private targetRing!: Phaser.GameObjects.Graphics;
  private lockLine!: Phaser.GameObjects.Graphics;
  private laserRangeGfx!: Phaser.GameObjects.Graphics;
  private worldFx!: Phaser.GameObjects.Graphics;
  private radiationGfx!: Phaser.GameObjects.Graphics;
  private minimapGfx!: Phaser.GameObjects.Graphics;
  private stationLabels = new Map<string, Phaser.GameObjects.Text>();
  private cursorGfx!: Phaser.GameObjects.Graphics;
  private ctrlKey!: Phaser.Input.Keyboard.Key;
  private spaceKey!: Phaser.Input.Keyboard.Key;
  private combatHotkeyListener = (ev: Event) => {
    const action = (ev as CustomEvent<{ action?: 'start' | 'stop' }>).detail
      ?.action;
    if (action === 'start') this.startFire();
    else if (action === 'stop') this.stopFire(false);
  };

  constructor() {
    super('SpaceScene');
  }

  init(data: {
    socket: GameSocket;
    selfId: string;
    world: WorldConfig;
    snapshot?: Snapshot;
    hud: SceneHud;
  }) {
    this.socket = data.socket;
    this.selfId = data.selfId;
    this.world = data.world;
    this.hud = data.hud;
    this.latest = data.snapshot;
  }

  preload() {
    this.load.image('space-bg', '/assets/space-bg.jpg');
    this.load.image('ship-player', '/assets/ship-player.png');
    this.load.image('ship-elite', '/assets/ship-elite.png');
    this.load.image('ship-goliath', '/assets/ship-goliath.png');
    this.load.image('ship-npc', '/assets/ship-npc.png');
    this.load.image('cubikon-idle', '/assets/cubikon-idle.png');
    this.load.image('cubikon-angry', '/assets/cubikon-angry.png');
    this.load.image('protegit', '/assets/protegit.png');
    this.load.image('droid', '/assets/droid.png');
    this.load.image('bullet', '/assets/bullet-cyan.png');
    this.load.image('explosion', '/assets/explosion.png');
  }

  create() {
    this.cameras.main.setBackgroundColor('#03050c');
    // No world bounds — ship stays screen-center even near map edges
    this.cameras.main.setZoom(1.08);
    this.physics.world.setBounds(0, 0, this.world.width, this.world.height);

    this.createBackground();
    this.createAmbientDust();
    this.drawBorder();
    this.drawRadiationZone();

    this.worldFx = this.add.graphics().setDepth(4);
    this.destMarker = this.add.graphics().setDepth(6);
    this.laserRangeGfx = this.add.graphics().setDepth(6);
    this.targetRing = this.add.graphics().setDepth(12);
    this.lockLine = this.add.graphics().setDepth(7);
    this.minimapGfx = this.add.graphics().setDepth(60).setScrollFactor(0);
    this.cursorGfx = this.add.graphics().setDepth(50).setScrollFactor(0);

    this.ctrlKey = this.input.keyboard!.addKey(
      Phaser.Input.Keyboard.KeyCodes.CTRL,
    );
    this.spaceKey = this.input.keyboard!.addKey(
      Phaser.Input.Keyboard.KeyCodes.SPACE,
    );

    window.addEventListener('govorbit:combat', this.combatHotkeyListener);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener('govorbit:combat', this.combatHotkeyListener);
    });

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (!pointer.leftButtonDown()) return;
      if (Date.now() < this.deadUntil) return;

      if (this.handleMinimapClick(pointer.x, pointer.y)) return;

      const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      this.handleClick(world.x, world.y);
    });

    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (pointer.leftButtonReleased()) {
        this.holdSteer = false;
      }
    });

    this.input.on('pointerupoutside', () => {
      this.holdSteer = false;
    });

    this.socket.on('snapshot', (snapshot: Snapshot) => {
      this.latest = snapshot;
    });

    this.socket.on(
      'youDied',
      (payload: { respawnInMs: number; victimId?: string }) => {
        if (payload.victimId && payload.victimId !== this.selfId) return;
        this.deadUntil = Date.now() + (payload.respawnInMs ?? 2500);
        this.destX = null;
        this.destY = null;
        this.destFromMinimap = false;
        this.targetId = null;
        this.firing = false;
        this.fireRocket = false;
        this.rocketHoldFrames = 0;
        this.holdSteer = false;
        this.hud.onToast?.('YOK EDİLDİN — yeniden doğuş...');
        this.cameras.main.shake(220, 0.012);
        this.cameras.main.flash(180, 255, 80, 60);
        const self = this.ships.get(this.selfId);
        if (self) this.spawnExplosion(self.renderX, self.renderY, 1.2);
        this.time.delayedCall(payload.respawnInMs ?? 2500, () => {
          this.hud.onToast?.(null);
        });
      },
    );

    this.socket.on(
      'killed',
      (payload: { victimId: string; killerId: string; kind: string }) => {
        const target =
          this.ships.get(payload.victimId) ?? this.npcs.get(payload.victimId);
        if (target) {
          this.spawnExplosion(
            target.renderX,
            target.renderY,
            payload.kind === 'npc' ? 0.85 : 1.15,
          );
          for (const b of this.bullets.values()) {
            if (b.targetId === payload.victimId && !b.frozen) {
              b.frozen = true;
              b.aimX = target.renderX;
              b.aimY = target.renderY;
              b.img.setData('tx', b.aimX);
              b.img.setData('ty', b.aimY);
            }
          }
        }
        if (this.targetId === payload.victimId) {
          this.targetId = null;
          this.firing = false;
        }
        if (payload.killerId === this.selfId) {
          this.hud.onToast?.(
            payload.kind === 'npc' ? '+10 kredi (NPC)' : '+25 kredi (PvP)',
          );
          this.time.delayedCall(1200, () => this.hud.onToast?.(null));
        }
      },
    );

    this.socket.on(
      'hit',
      (payload: {
        targetId: string;
        byId: string;
        kind: string;
        damage?: number;
      }) => {
        if (!payload.damage || payload.damage <= 0) return;
        const gfx =
          this.ships.get(payload.targetId) ?? this.npcs.get(payload.targetId);
        if (!gfx) return;
        this.spawnDamageNumber(
          gfx.renderX,
          gfx.renderY - 36,
          Math.round(payload.damage),
        );
      },
    );



    this.socket.on(
      'loot',
      (payload: { credits?: number; rockets?: number; message?: string }) => {
        const parts: string[] = [];
        if (payload.credits) parts.push(`+${payload.credits} kredi`);
        if (payload.rockets) parts.push(`+${payload.rockets} roket`);
        this.hud.onToast?.(
          payload.message ??
            (parts.length ? `LOOT · ${parts.join(' · ')}` : 'Kargo toplandı'),
        );
        this.time.delayedCall(1400, () => this.hud.onToast?.(null));
      },
    );

    this.socket.on(
      'portal',
      (payload: {
        label?: string;
        message?: string;
        playerId?: string;
        mapName?: string;
      }) => {
        if (payload.playerId && payload.playerId !== this.selfId) return;
        this.targetId = null;
        this.firing = false;
        this.destX = null;
        this.destY = null;
        this.destFromMinimap = false;
        this.hud.onToast?.(
          payload.message ??
            (payload.mapName
              ? `Harita · ${payload.mapName}`
              : 'Işınlandın'),
        );
        this.cameras.main.flash(160, 80, 200, 255);
        this.time.delayedCall(1600, () => this.hud.onToast?.(null));
      },
    );

    this.socket.on(
      'portalChannel',
      (payload: { playerId: string; portalId: string; endsAt: number }) => {
        if (payload.playerId !== this.selfId) return;
        this.hud.onToast?.('Işınlanma · 3 sn...');
      },
    );

    this.socket.on(
      'portalCancel',
      (payload: { playerId: string; reason?: string }) => {
        if (payload.playerId !== this.selfId) return;
        this.hud.onToast?.(
          payload.reason === 'hasar'
            ? 'Işınlanma iptal (hasar)'
            : 'Işınlanma iptal',
        );
        this.time.delayedCall(1400, () => this.hud.onToast?.(null));
      },
    );

    if (this.latest) this.syncEntities(this.latest, true);
  }

  update(_time: number, delta: number) {
    if (!this.latest) return;

    if (this.targetId && !this.findEntityPos(this.targetId)) {
      this.targetId = null;
      this.firing = false;
    }

    if (Phaser.Input.Keyboard.JustDown(this.ctrlKey)) {
      if (!this.isTypingInUi()) this.toggleFire();
    }

    if (Phaser.Input.Keyboard.JustDown(this.spaceKey)) {
      if (!this.isTypingInUi() && Date.now() >= this.deadUntil) {
        this.fireRocket = true;
        this.rocketHoldFrames = ROCKET_HOLD_FRAMES;
      }
    }

    this.updateHoldSteer();

    this.syncEntities(this.latest, false);
    this.smoothRender(delta);
    this.drawWorldFx();
    this.drawOverlays();
    this.drawMinimap();
    this.updateCamera(delta);
    this.pushInput();
    this.updateHud();
  }

  private isTypingInUi() {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName;
    return (
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      (el as HTMLElement).isContentEditable
    );
  }

  private updateHoldSteer() {
    const pointer = this.input.activePointer;
    if (!this.holdSteer || !pointer.leftButtonDown()) {
      if (this.holdSteer && !pointer.leftButtonDown()) {
        this.holdSteer = false;
      }
      return;
    }
    if (Date.now() < this.deadUntil) {
      this.holdSteer = false;
      return;
    }

    if (this.isOverMinimap(pointer.x, pointer.y)) return;

    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    this.destFromMinimap = false;
    this.destX = Phaser.Math.Clamp(world.x, 20, this.world.width - 20);
    this.destY = Phaser.Math.Clamp(world.y, 20, this.world.height - 20);
  }

  /**
   * Camera-space rect compensated for main zoom (scrollFactor 0 still scales).
   */
  private minimapRect() {
    const cam = this.cameras.main;
    const zoom = cam.zoom || 1;
    const mw = MINIMAP_W / zoom;
    const mh = MINIMAP_H / zoom;
    const midX = cam.width * 0.5;
    const midY = cam.height * 0.5;
    return {
      x: midX + (midX - MINIMAP_PAD) / zoom - mw,
      y: midY + (midY - MINIMAP_PAD) / zoom - mh,
      w: mw,
      h: mh,
    };
  }

  /** Screen-space rect for pointer.x / pointer.y hit tests */
  private minimapScreenRect() {
    const cam = this.cameras.main;
    return {
      x: cam.width - MINIMAP_PAD - MINIMAP_W,
      y: cam.height - MINIMAP_PAD - MINIMAP_H,
      w: MINIMAP_W,
      h: MINIMAP_H,
    };
  }

  private isOverMinimap(sx: number, sy: number) {
    const mm = this.minimapScreenRect();
    return sx >= mm.x && sx <= mm.x + mm.w && sy >= mm.y && sy <= mm.y + mm.h;
  }

  private handleMinimapClick(sx: number, sy: number): boolean {
    if (!this.isOverMinimap(sx, sy)) return false;
    const mm = this.minimapScreenRect();
    const u = (sx - mm.x) / mm.w;
    const v = (sy - mm.y) / mm.h;
    this.holdSteer = false;
    this.destFromMinimap = true;
    this.destX = Phaser.Math.Clamp(u * this.world.width, 20, this.world.width - 20);
    this.destY = Phaser.Math.Clamp(v * this.world.height, 20, this.world.height - 20);
    return true;
  }

  private handleClick(x: number, y: number) {
    const now = Date.now();
    const isDouble =
      now - this.lastClickAt < DOUBLE_CLICK_MS &&
      Math.hypot(x - this.lastClickX, y - this.lastClickY) < DOUBLE_CLICK_DIST;
    this.lastClickAt = now;
    this.lastClickX = x;
    this.lastClickY = y;

    const hit = this.pickEntity(x, y);
    if (hit) {
      if (hit.id === this.selfId) return;
      this.holdSteer = false;
      this.targetId = hit.id;
      // Single click: select only (cancel fire). Double-click: select + fire.
      this.firing = isDouble;
      this.hud.onToast?.(
        isDouble
          ? hit.kind === 'npc'
            ? `Hedef + lazer (${hit.name})`
            : `Ateş: ${hit.name}`
          : hit.kind === 'npc'
            ? `Hedef kilitlendi (${hit.name})`
            : `Hedef: ${hit.name}`,
      );
      this.time.delayedCall(900, () => this.hud.onToast?.(null));
      this.pulsePick(hit.id);
      return;
    }

    const portal = this.pickPortal(x, y);
    if (portal) {
      this.holdSteer = false;
      this.requestPortalJump(portal.id, portal.label);
      return;
    }

    this.holdSteer = true;
    this.destFromMinimap = false;
    this.destX = Phaser.Math.Clamp(x, 20, this.world.width - 20);
    this.destY = Phaser.Math.Clamp(y, 20, this.world.height - 20);
  }

  private pickPortal(
    x: number,
    y: number,
  ): { id: string; label: string } | null {
    const r = this.world.portalUseRange ?? 100;
    let best: { id: string; label: string; d: number } | null = null;
    for (const portal of this.latest?.portals ?? []) {
      const d = Math.hypot(portal.x - x, portal.y - y);
      if (d <= r && (!best || d < best.d)) {
        best = { id: portal.id, label: portal.label, d };
      }
    }
    return best ? { id: best.id, label: best.label } : null;
  }

  private requestPortalJump(portalId: string, label: string) {
    if (Date.now() < this.deadUntil) return;
    this.socket.emit(
      'portal:jump',
      { portalId },
      (res: { ok?: boolean; error?: string; endsAt?: number }) => {
        if (!res?.ok) {
          this.hud.onToast?.(res?.error ?? 'Portal kullanılamadı');
          this.time.delayedCall(1200, () => this.hud.onToast?.(null));
          return;
        }
        this.hud.onToast?.(`${label} · ışınlanma 3 sn...`);
      },
    );
  }

  /** Ctrl: toggle. clearLock=true on cease (Ctrl off) so tracking stops. */
  private toggleFire() {
    if (this.firing) this.stopFire(true);
    else this.startFire();
  }

  private startFire() {
    if (Date.now() < this.deadUntil) return;
    if (!this.targetId) {
      this.hud.onToast?.('Önce bir hedef seç (çift tık veya sol tık)');
      this.time.delayedCall(1000, () => this.hud.onToast?.(null));
      return;
    }
    if (!this.findEntityPos(this.targetId)) {
      this.targetId = null;
      this.firing = false;
      return;
    }
    if (this.firing) return;
    this.firing = true;
    this.hud.onToast?.('ATEŞ AÇILDI');
    this.time.delayedCall(800, () => this.hud.onToast?.(null));
  }

  private stopFire(clearLock: boolean) {
    if (!this.firing && !clearLock) return;
    this.firing = false;
    if (clearLock) {
      this.targetId = null;
      this.hud.onToast?.('Ateş kapandı · kilit kalktı');
    } else {
      this.hud.onToast?.('Ateş kapandı');
    }
    this.time.delayedCall(800, () => this.hud.onToast?.(null));
  }

  private pickEntity(
    x: number,
    y: number,
  ): { id: string; kind: 'player' | 'npc'; name: string } | null {
    let best: {
      id: string;
      kind: 'player' | 'npc';
      name: string;
      d: number;
    } | null = null;

    for (const p of this.latest?.players ?? []) {
      if (p.hp <= 0) continue;
      const gfx = this.ships.get(p.id);
      const px = gfx?.renderX ?? p.x;
      const py = gfx?.renderY ?? p.y;
      if (this.isInSafeZone(px, py)) continue;
      const d = Math.hypot(px - x, py - y);
      if (d <= PICK_RADIUS && (!best || d < best.d)) {
        best = { id: p.id, kind: 'player', name: p.name, d };
      }
    }
    for (const n of this.latest?.npcs ?? []) {
      if (n.hp <= 0) continue;
      const gfx = this.npcs.get(n.id);
      const px = gfx?.renderX ?? n.x;
      const py = gfx?.renderY ?? n.y;
      const d = Math.hypot(px - x, py - y);
      if (d <= PICK_RADIUS && (!best || d < best.d)) {
        best = { id: n.id, kind: 'npc', name: n.name || 'Streuner', d };
      }
    }
    return best ? { id: best.id, kind: best.kind, name: best.name } : null;
  }

  private isInSafeZone(x: number, y: number): boolean {
    for (const s of this.latest?.stations ?? []) {
      if (Math.hypot(x - s.x, y - s.y) <= s.safeRadius) return true;
    }
    return false;
  }

  private findEntityPos(id: string) {
    const p = this.latest?.players.find((x) => x.id === id && x.hp > 0);
    if (p) {
      const gfx = this.ships.get(id);
      return { x: gfx?.renderX ?? p.x, y: gfx?.renderY ?? p.y };
    }
    const n = this.latest?.npcs.find((x) => x.id === id && x.hp > 0);
    if (n) {
      const gfx = this.npcs.get(id);
      return { x: gfx?.renderX ?? n.x, y: gfx?.renderY ?? n.y };
    }
    return null;
  }

  private pushInput() {
    const sendRocket = this.fireRocket || this.rocketHoldFrames > 0;
    sendInput(this.socket, {
      destX: this.destX,
      destY: this.destY,
      targetId: this.targetId,
      firing: this.firing && !!this.targetId,
      fireRocket: sendRocket,
    });
    this.fireRocket = false;
    if (this.rocketHoldFrames > 0) this.rocketHoldFrames -= 1;
  }

  private updateHud() {
    const self = this.latest?.players.find((p) => p.id === this.selfId);
    if (!self) return;
    let targetName: string | null = null;
    if (this.targetId) {
      const p = this.latest?.players.find((x) => x.id === this.targetId);
      const n = this.latest?.npcs.find((x) => x.id === this.targetId);
      targetName = p?.name ?? (n ? n.name || 'Streuner' : null);
    }
    this.hud.onStats?.({
      hp: self.hp,
      maxHp: self.maxHp ?? this.world.maxHp,
      shield: self.shield,
      maxShield: self.maxShield ?? this.world.maxShield,
      credits: self.credits,
      gold: self.gold ?? 0,
      kills: self.kills,
      name: self.name,
      mapName: this.latest?.mapName ?? '1-1',
      targetName,
      firing: this.firing,
      rockets: self.rockets,
      laserAmmo: self.laserAmmo ?? 0,
      inRange: !!this.targetId && self.inRange,
    });
  }

  private updateCamera(_delta: number) {
    const self = this.ships.get(this.selfId);
    if (!self) return;
    // Hard lock: ship always dead-center (no smooth follow / lag)
    this.cameras.main.centerOn(self.renderX, self.renderY);
  }

  private syncEntities(snapshot: Snapshot, instant: boolean) {
    const seenPlayers = new Set<string>();
    for (const player of snapshot.players) {
      seenPlayers.add(player.id);
      this.upsertShip(player, instant);
    }
    for (const [id, gfx] of this.ships) {
      if (!seenPlayers.has(id)) {
        gfx.thrust.stop();
        gfx.root.destroy(true);
        this.ships.delete(id);
      }
    }

    const seenNpcs = new Set<string>();
    for (const npc of snapshot.npcs) {
      seenNpcs.add(npc.id);
      this.upsertNpc(npc, instant);
    }
    for (const [id, gfx] of this.npcs) {
      if (!seenNpcs.has(id)) {
        gfx.root.destroy(true);
        this.npcs.delete(id);
      }
    }

    const seenBullets = new Set<string>();
    for (const bullet of snapshot.bullets) {
      seenBullets.add(bullet.id);
      let gfx = this.bullets.get(bullet.id);
      const isRocket = bullet.kind === 'rocket';
      if (!gfx) {
        const img = this.add
          .image(bullet.x, bullet.y, 'bullet')
          .setBlendMode(Phaser.BlendModes.ADD)
          .setDepth(5);
        if (isRocket) {
          img.setDisplaySize(34, 52).setTint(0xff8844);
        } else if (bullet.ownerId.startsWith('npc-')) {
          img.setDisplaySize(20, 32).setTint(0xff5533);
        } else {
          const tint = bullet.tint && bullet.tint > 0 ? bullet.tint : 0x66e0ff;
          img.setDisplaySize(22, 36).setTint(tint);
        }
        gfx = {
          img,
          renderX: bullet.x,
          renderY: bullet.y,
          kind: bullet.kind,
          targetId: bullet.targetId ?? null,
          aimX: bullet.aimX ?? bullet.x,
          aimY: bullet.aimY ?? bullet.y,
          frozen: !!bullet.frozen,
        };
        this.bullets.set(bullet.id, gfx);
      } else if (gfx.kind !== bullet.kind) {
        gfx.kind = bullet.kind;
        if (isRocket) {
          gfx.img.setDisplaySize(34, 52).setTint(0xff8844);
        } else {
          const tint = bullet.tint && bullet.tint > 0 ? bullet.tint : 0x66e0ff;
          gfx.img.setDisplaySize(22, 36).setTint(tint);
        }
      } else if (
        !isRocket &&
        !bullet.ownerId.startsWith('npc-') &&
        bullet.tint &&
        bullet.tint > 0
      ) {
        gfx.img.setTint(bullet.tint);
      }
      gfx.targetId = bullet.targetId ?? gfx.targetId;
      if (bullet.frozen || gfx.frozen) {
        gfx.frozen = true;
        if (typeof bullet.aimX === 'number') gfx.aimX = bullet.aimX;
        if (typeof bullet.aimY === 'number') gfx.aimY = bullet.aimY;
      } else {
        const lock =
          (gfx.targetId && this.ships.get(gfx.targetId)) ||
          (gfx.targetId && this.npcs.get(gfx.targetId)) ||
          null;
        const liveOk =
          lock &&
          ((this.latest?.players.find((p) => p.id === gfx.targetId)?.hp ?? 1) >
            0 ||
            (this.latest?.npcs.find((n) => n.id === gfx.targetId)?.hp ?? 1) > 0);
        if (lock && liveOk) {
          gfx.aimX = lock.renderX;
          gfx.aimY = lock.renderY;
        } else if (lock) {
          // Dying / just exploded — freeze at last seen spot
          gfx.frozen = true;
          gfx.aimX = lock.renderX;
          gfx.aimY = lock.renderY;
        } else if (typeof bullet.aimX === 'number') {
          gfx.frozen = true;
          gfx.aimX = bullet.aimX;
          gfx.aimY = bullet.aimY ?? gfx.aimY;
        }
      }
      gfx.img.setData('tx', gfx.aimX);
      gfx.img.setData('ty', gfx.aimY);
    }
    for (const [id, gfx] of this.bullets) {
      if (!seenBullets.has(id)) {
        gfx.img.destroy();
        this.bullets.delete(id);
      }
    }

    const self = snapshot.players.find((p) => p.id === this.selfId);
    if (
      !this.holdSteer &&
      self &&
      this.destX !== null &&
      this.destY !== null
    ) {
      const d = Math.hypot(self.x - this.destX, self.y - this.destY);
      if (d < (this.world.arriveRadius ?? 14) + 8 && !self.moving) {
        this.destX = null;
        this.destY = null;
        this.destFromMinimap = false;
      }
    }
  }

  private smoothRender(delta: number) {
    const dt = delta / 1000;
    const otherLerp = 1 - Math.pow(0.002, dt);
    const arrive = this.world.arriveRadius ?? 8;

    for (const [id, gfx] of this.ships) {
      const p = this.latest?.players.find((x) => x.id === id);
      if (!p) continue;

      if (id === this.selfId && p.hp > 0 && Date.now() >= this.deadUntil) {
        const speed = p.shipSpeed || this.world.shipSpeed || 360;
        const hasDest = this.destX !== null && this.destY !== null;

        if (hasDest) {
          const dx = this.destX! - gfx.renderX;
          const dy = this.destY! - gfx.renderY;
          const dist = Math.hypot(dx, dy);
          if (dist > arrive) {
            const step = Math.min(speed * dt, dist);
            gfx.renderX += (dx / dist) * step;
            gfx.renderY += (dy / dist) * step;
            // Light server pull only while moving
            gfx.renderX += (p.x - gfx.renderX) * 0.18;
            gfx.renderY += (p.y - gfx.renderY) * 0.18;
          } else {
            // Arrived — lock in place, no coasting
            gfx.renderX = this.holdSteer ? gfx.renderX : this.destX!;
            gfx.renderY = this.holdSteer ? gfx.renderY : this.destY!;
            if (!this.holdSteer) {
              this.destX = null;
              this.destY = null;
              this.destFromMinimap = false;
            }
            if (!p.moving) {
              gfx.renderX = p.x;
              gfx.renderY = p.y;
            }
          }
        } else {
          // Stopped: hard snap to server (kills residual slide)
          gfx.renderX = p.x;
          gfx.renderY = p.y;
        }
      } else {
        // Remote ships: lerp while moving, hard stop when server says stopped
        // (avoids asymptotic coast that looks like sliding)
        if (!p.moving || p.hp <= 0) {
          gfx.renderX = p.x;
          gfx.renderY = p.y;
        } else {
          const dx = p.x - gfx.renderX;
          const dy = p.y - gfx.renderY;
          const dist = Math.hypot(dx, dy);
          if (dist < 4) {
            gfx.renderX = p.x;
            gfx.renderY = p.y;
          } else {
            gfx.renderX += dx * otherLerp;
            gfx.renderY += dy * otherLerp;
          }
        }
      }

      gfx.renderAngle = p.angle;

      // Root stays axis-aligned so name + bars don't orbit the ship
      gfx.root.setPosition(gfx.renderX, gfx.renderY);
      gfx.root.setRotation(0);
      const shipRot = gfx.renderAngle + SHIP_ANGLE_OFFSET;
      gfx.sprite.setRotation(shipRot);
      gfx.glow.setRotation(shipRot);
      this.layoutShipDroids(gfx, p.droidCount ?? 0, p.hp > 0);
      gfx.label.setPosition(0, 42);
      gfx.label.setRotation(0);
      gfx.label.setColor('#ffffff');
      gfx.root.setAlpha(p.hp <= 0 ? 0.2 : 1);
      gfx.glow.setAlpha(
        p.hp <= 0 ? 0 : 0.28 + Math.sin(this.time.now / 250) * 0.08,
      );

      const moving = p.moving || (id === this.selfId && this.destX !== null);
      gfx.thrust.setQuantity(moving && p.hp > 0 ? 3 : 0);
      const backAngle = Phaser.Math.RadToDeg(gfx.renderAngle + Math.PI);
      gfx.thrust.particleAngle = { min: backAngle - 16, max: backAngle + 16 };
      gfx.thrust.followOffset.set(
        Math.cos(gfx.renderAngle + Math.PI) * 18,
        Math.sin(gfx.renderAngle + Math.PI) * 18,
      );

      this.drawHpBar(
        gfx.hp,
        p.hp,
        p.maxHp ?? this.world.maxHp,
        p.shield,
        p.maxShield ?? this.world.maxShield,
      );
    }

    for (const [id, gfx] of this.npcs) {
      const n = this.latest?.npcs.find((x) => x.id === id);
      if (!n) continue;
      gfx.renderX += (n.x - gfx.renderX) * otherLerp;
      gfx.renderY += (n.y - gfx.renderY) * otherLerp;
      gfx.renderAngle = n.angle;
      gfx.root.setPosition(gfx.renderX, gfx.renderY);
      gfx.root.setRotation(0);
      const npcRot = gfx.renderAngle + SHIP_ANGLE_OFFSET;
      gfx.sprite.setRotation(npcRot);
      gfx.glow.setRotation(npcRot);
      gfx.label.setPosition(0, gfx.labelY);
      gfx.label.setRotation(0);
      const isBossKind = n.kind === 'cubikon' || n.kind === 'protegit';
      gfx.glow.setAlpha(
        isBossKind ? 0 : 0.3 + Math.sin(this.time.now / 200 + n.x) * 0.1,
      );

      gfx.hp.clear();
      gfx.hp.setRotation(0);
      const maxHp = n.maxHp ?? this.world.npcHp;
      const ratio = Math.max(0, n.hp / Math.max(1, maxHp));
      const bw = gfx.barW;
      gfx.hp.fillStyle(0x000000, 0.5);
      gfx.hp.fillRoundedRect(-bw / 2, -gfx.labelY - 6, bw, 3, 1);
      gfx.hp.fillStyle(
        n.kind === 'cubikon' ? 0xffaa33 : n.kind === 'protegit' ? 0xff4444 : 0xff6b4a,
        1,
      );
      gfx.hp.fillRoundedRect(-bw / 2, -gfx.labelY - 6, bw * ratio, 3, 1);
    }

    const laserSpeed = this.world.bulletSpeed || 980;
    const rocketSpeed = this.world.rocketSpeed || 560;

    for (const [id, gfx] of [...this.bullets.entries()]) {
      if (!gfx.frozen && gfx.targetId) {
        const lock =
          this.ships.get(gfx.targetId) ?? this.npcs.get(gfx.targetId);
        const hp =
          this.latest?.players.find((p) => p.id === gfx.targetId)?.hp ??
          this.latest?.npcs.find((n) => n.id === gfx.targetId)?.hp;
        if (lock && (hp === undefined || hp > 0)) {
          gfx.aimX = lock.renderX;
          gfx.aimY = lock.renderY;
        } else if (lock) {
          gfx.frozen = true;
          gfx.aimX = lock.renderX;
          gfx.aimY = lock.renderY;
        }
      }
      gfx.img.setData('tx', gfx.aimX);
      gfx.img.setData('ty', gfx.aimY);

      const tx = gfx.aimX;
      const ty = gfx.aimY;
      const dx = tx - gfx.renderX;
      const dy = ty - gfx.renderY;
      const dist = Math.hypot(dx, dy);
      if (dist > 8) {
        gfx.img.setRotation(Math.atan2(dy, dx) + SHIP_ANGLE_OFFSET);
        const spd = gfx.kind === 'rocket' ? rocketSpeed : laserSpeed;
        const step = Math.min(spd * dt * 1.15, dist);
        gfx.renderX += (dx / dist) * step;
        gfx.renderY += (dy / dist) * step;
        gfx.img.setPosition(gfx.renderX, gfx.renderY);
      } else if (gfx.frozen) {
        // Arrived at death spot — fade out
        gfx.img.destroy();
        this.bullets.delete(id);
      } else {
        gfx.img.setPosition(gfx.renderX, gfx.renderY);
      }
    }
  }

  private spawnDamageNumber(x: number, y: number, amount: number) {
    const label = this.add
      .text(x, y, `-${amount}`, {
        fontFamily: 'Orbitron, sans-serif',
        fontSize: '15px',
        color: '#ff6b6b',
        stroke: '#1a0505',
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(40)
      .setAlpha(0.95);

    this.tweens.add({
      targets: label,
      y: y - 42,
      alpha: 0,
      scaleX: 0.35,
      scaleY: 0.35,
      duration: 750,
      ease: 'Cubic.easeIn',
      onComplete: () => label.destroy(),
    });
  }

  private drawWorldFx() {
    const g = this.worldFx;
    g.clear();
    const pulse = 0.55 + Math.sin(this.time.now / 220) * 0.25;

    this.drawStations(g, pulse);

    for (const portal of this.latest?.portals ?? []) {
      const r = this.world.portalRadius ?? 48;
      g.lineStyle(3, 0xa78bfa, 0.55 + pulse * 0.35);
      g.strokeCircle(portal.x, portal.y, r * (0.92 + pulse * 0.08));
      g.lineStyle(2, 0x66e0ff, 0.4 + pulse * 0.3);
      g.strokeCircle(portal.x, portal.y, r * 0.62);
      g.lineStyle(1, 0xffffff, 0.25);
      g.strokeCircle(portal.x, portal.y, r * 0.28);
      g.fillStyle(0xa78bfa, 0.08 + pulse * 0.06);
      g.fillCircle(portal.x, portal.y, r * 0.5);
    }
  }

  private drawStations(g: Phaser.GameObjects.Graphics, pulse: number) {
    const spin = this.time.now / 900;
    const pulse2 = 0.5 + Math.sin(this.time.now / 380 + 0.8) * 0.28;

    for (const station of this.latest?.stations ?? []) {
      const { x, y, safeRadius: r, label, id } = station;

      g.fillStyle(0x22d3ee, 0.035 + pulse * 0.025);
      g.fillCircle(x, y, r);
      g.lineStyle(2, 0x22d3ee, 0.1 + pulse * 0.12);
      g.strokeCircle(x, y, r);
      g.lineStyle(1, 0x86efac, 0.07 + pulse2 * 0.1);
      g.strokeCircle(x, y, r * 0.68);

      const platR = 118;
      g.fillStyle(0x0f172a, 0.72);
      g.fillCircle(x, y, platR + 8);
      g.fillStyle(0x1e293b, 0.92);
      g.fillCircle(x, y, platR);
      g.lineStyle(3, 0x334155, 0.95);
      g.strokeCircle(x, y, platR);
      g.lineStyle(2, 0x38bdf8, 0.45 + pulse * 0.35);
      g.strokeCircle(x, y, platR * 0.76);

      g.lineStyle(5, 0x475569, 0.75);
      g.lineBetween(x - platR * 0.88, y, x + platR * 0.88, y);
      g.lineBetween(x, y - platR * 0.88, x, y + platR * 0.88);
      g.lineStyle(3, 0x64748b, 0.55);
      g.lineBetween(x - platR * 0.55, y - platR * 0.55, x + platR * 0.55, y + platR * 0.55);
      g.lineBetween(x - platR * 0.55, y + platR * 0.55, x + platR * 0.55, y - platR * 0.55);

      g.fillStyle(0x020617, 0.95);
      g.fillCircle(x, y, 34);
      g.fillStyle(0x0c4a6e, 0.9);
      g.fillCircle(x, y - 48, 26);
      g.fillStyle(0x38bdf8, 0.85);
      g.fillCircle(x, y - 48, 14);
      g.fillStyle(0xe0f2fe, 0.55 + pulse * 0.35);
      g.fillCircle(x, y - 48, 6);

      g.fillStyle(0x4ade80, 0.45 + pulse * 0.45);
      g.fillCircle(x, y - 74, 5 + pulse * 2);
      g.lineStyle(2, 0x4ade80, 0.25 + pulse * 0.2);
      g.strokeCircle(x, y - 74, 12 + pulse * 4);

      for (let i = 0; i < 4; i++) {
        const ang = spin + i * (Math.PI / 2);
        const orbit = platR + 24;
        const ax = x + Math.cos(ang) * orbit;
        const ay = y + Math.sin(ang) * orbit;
        g.fillStyle(0x67e8f9, 0.4 + pulse2 * 0.3);
        g.fillCircle(ax, ay, 7);
        g.lineStyle(1, 0xa5f3fc, 0.35);
        g.lineBetween(x, y, ax, ay);
      }

      let txt = this.stationLabels.get(id);
      if (!txt) {
        txt = this.add
          .text(x, y - platR - 28, label, {
            fontFamily: 'Orbitron, sans-serif',
            fontSize: '14px',
            color: '#a5f3fc',
            stroke: '#020617',
            strokeThickness: 4,
          })
          .setOrigin(0.5)
          .setDepth(5);
        this.stationLabels.set(id, txt);
      }
      txt.setPosition(x, y - platR - 28);
      txt.setText(label);
      txt.setAlpha(0.82 + pulse * 0.18);
    }

    for (const [id, txt] of this.stationLabels) {
      if (!(this.latest?.stations ?? []).some((s) => s.id === id)) {
        txt.destroy();
        this.stationLabels.delete(id);
      }
    }
  }

  private drawOverlays() {
    this.destMarker.clear();
    this.cursorGfx.clear();

    this.laserRangeGfx.clear();
    this.targetRing.clear();
    this.lockLine.clear();

    const self = this.ships.get(this.selfId);
    if (this.targetId && self) {
      const pos = this.findEntityPos(this.targetId);
      if (pos) {
        const pulse = 1 + Math.sin(this.time.now / 140) * 0.12;
        const color = this.firing ? 0xff6b4a : 0xffd166;
        this.targetRing.lineStyle(2, color, 0.95);
        this.targetRing.strokeCircle(pos.x, pos.y, 36 * pulse);
        this.targetRing.lineStyle(1, color, 0.4);
        this.targetRing.strokeCircle(pos.x, pos.y, 48);
        const s = 40;
        this.targetRing.lineStyle(2, color, 0.9);
        this.targetRing.lineBetween(pos.x - s, pos.y - s, pos.x - s + 12, pos.y - s);
        this.targetRing.lineBetween(pos.x - s, pos.y - s, pos.x - s, pos.y - s + 12);
        this.targetRing.lineBetween(pos.x + s, pos.y - s, pos.x + s - 12, pos.y - s);
        this.targetRing.lineBetween(pos.x + s, pos.y - s, pos.x + s, pos.y - s + 12);
        this.targetRing.lineBetween(pos.x - s, pos.y + s, pos.x - s + 12, pos.y + s);
        this.targetRing.lineBetween(pos.x - s, pos.y + s, pos.x - s, pos.y + s - 12);
        this.targetRing.lineBetween(pos.x + s, pos.y + s, pos.x + s - 12, pos.y + s);
        this.targetRing.lineBetween(pos.x + s, pos.y + s, pos.x + s, pos.y + s - 12);
      }
    }
  }

  private drawMinimap() {
    const g = this.minimapGfx;
    g.clear();
    const mm = this.minimapRect();
    const sx = mm.w / this.world.width;
    const sy = mm.h / this.world.height;

    g.fillStyle(0x050a14, 0.82);
    g.fillRect(mm.x, mm.y, mm.w, mm.h);
    // Stroke inset so the border never clips past the canvas edge
    g.lineStyle(1.5, 0x3dd6ff, 0.55);
    g.strokeRect(mm.x + 1, mm.y + 1, mm.w - 2, mm.h - 2);

    const inset = this.world.radiationInset ?? 0;
    if (inset > 0) {
      g.fillStyle(0xff3344, 0.18);
      g.fillRect(mm.x, mm.y, mm.w, inset * sy);
      g.fillRect(mm.x, mm.y + mm.h - inset * sy, mm.w, inset * sy);
      g.fillRect(mm.x, mm.y, inset * sx, mm.h);
      g.fillRect(mm.x + mm.w - inset * sx, mm.y, inset * sx, mm.h);
    }

    const scaleX = mm.w / this.world.width;
    const scaleY = mm.h / this.world.height;
    for (const station of this.latest?.stations ?? []) {
      const stx = mm.x + station.x * scaleX;
      const sty = mm.y + station.y * scaleY;
      const sr = Math.max(6, station.safeRadius * scaleX);
      g.fillStyle(0x22d3ee, 0.12);
      g.fillCircle(stx, sty, sr);
      g.lineStyle(1, 0x38bdf8, 0.45);
      g.strokeCircle(stx, sty, sr);
      g.fillStyle(0x7dd3fc, 0.95);
      g.fillCircle(stx, sty, 5);
    }

    for (const portal of this.latest?.portals ?? []) {
      g.fillStyle(0xa78bfa, 0.9);
      g.fillCircle(mm.x + portal.x * sx, mm.y + portal.y * sy, 4);
    }

    for (const n of this.latest?.npcs ?? []) {
      if (n.hp <= 0) continue;
      g.fillStyle(0xff6b4a, 0.95);
      g.fillCircle(mm.x + n.x * sx, mm.y + n.y * sy, 2.5);
    }

    for (const p of this.latest?.players ?? []) {
      if (p.hp <= 0) continue;
      if (p.id === this.selfId) continue;
      g.fillStyle(0x66e0ff, 0.95);
      g.fillCircle(mm.x + p.x * sx, mm.y + p.y * sy, 2.8);
    }

    const self = this.latest?.players.find((p) => p.id === this.selfId);
    if (self) {
      g.fillStyle(0xffffff, 1);
      g.fillCircle(mm.x + self.x * sx, mm.y + self.y * sy, 3.5);
      g.lineStyle(1, 0x3dd6ff, 1);
      g.strokeCircle(mm.x + self.x * sx, mm.y + self.y * sy, 5);
    }

    if (
      this.destFromMinimap &&
      this.destX !== null &&
      this.destY !== null
    ) {
      const cx = mm.x + this.destX * sx;
      const cy = mm.y + this.destY * sy;
      const arm = 5;
      g.lineStyle(1.5, 0x3dd6ff, 0.95);
      g.beginPath();
      g.moveTo(cx - arm, cy);
      g.lineTo(cx + arm, cy);
      g.moveTo(cx, cy - arm);
      g.lineTo(cx, cy + arm);
      g.strokePath();
    }
  }

  private syncShipDroids(gfx: ShipGfx, count: number) {
    const n = Math.max(0, Math.min(MAX_DROIDS, Math.floor(count)));
    while (gfx.droids.length < n) {
      const img = this.add
        .image(0, 0, 'droid')
        .setDisplaySize(28, 28)
        .setOrigin(0.5);
      // Behind ship hull/glow
      gfx.root.addAt(img, 0);
      gfx.droids.push(img);
    }
    while (gfx.droids.length > n) {
      const img = gfx.droids.pop();
      if (img) {
        gfx.root.remove(img, true);
      }
    }
  }

  private layoutShipDroids(gfx: ShipGfx, count: number, alive: boolean) {
    const n = Math.max(0, Math.min(MAX_DROIDS, Math.floor(count)));
    const cos = Math.cos(gfx.renderAngle);
    const sin = Math.sin(gfx.renderAngle);
    const shipRot = gfx.renderAngle + SHIP_ANGLE_OFFSET;
    for (let i = 0; i < gfx.droids.length; i++) {
      const img = gfx.droids[i];
      if (i >= n || !alive) {
        img.setVisible(false);
        continue;
      }
      const local = droidLocalOffset(i);
      img.setPosition(local.x * cos - local.y * sin, local.x * sin + local.y * cos);
      img.setRotation(shipRot);
      img.setVisible(true);
      img.setAlpha(0.95);
    }
  }

  private upsertShip(player: PlayerPublic, instant: boolean) {
    let gfx = this.ships.get(player.id);
    const isSelf = player.id === this.selfId;
    const key = player.shipSprite || 'ship-player';
    const size = key === 'ship-goliath' ? 78 : 64;
    const glowSize = key === 'ship-goliath' ? 94 : 78;

    if (!gfx) {
      const root = this.add.container(player.x, player.y).setDepth(10);
      const glow = this.add
        .image(0, 0, key)
        .setDisplaySize(glowSize, glowSize)
        .setAlpha(0.35)
        .setTint(0x66e0ff)
        .setBlendMode(Phaser.BlendModes.ADD);
      const sprite = this.add.image(0, 0, key).setDisplaySize(size, size);
      if (!isSelf) {
        const tint = Phaser.Display.Color.HexStringToColor(player.color).color;
        sprite.setTint(tint);
      }

      const thrust = this.add.particles(0, 0, 'bullet', {
        follow: root,
        speed: { min: 50, max: 110 },
        scale: { start: 0.24, end: 0 },
        alpha: { start: 0.75, end: 0 },
        lifespan: 300,
        frequency: 28,
        quantity: 0,
        blendMode: 'ADD',
        tint: [0x66e0ff, 0xffffff, 0x3dd6ff],
      });
      thrust.setDepth(9);

      const label = this.add
        .text(0, size * 0.65, player.name, {
          fontFamily: 'Orbitron, sans-serif',
          fontSize: isSelf ? '12px' : '11px',
          color: '#ffffff',
          stroke: '#031018',
          strokeThickness: 3,
        })
        .setOrigin(0.5, 0);

      const hp = this.add.graphics();
      root.add([glow, sprite, hp, label]);
      gfx = {
        root,
        sprite,
        glow,
        thrust,
        label,
        hp,
        droids: [],
        lastHp: player.hp,
        renderX: player.x,
        renderY: player.y,
        renderAngle: player.angle,
      };
      this.ships.set(player.id, gfx);
    } else if (gfx.sprite.texture.key !== key) {
      gfx.sprite.setTexture(key).setDisplaySize(size, size);
      gfx.glow.setTexture(key).setDisplaySize(glowSize, glowSize);
      gfx.label.setY(size * 0.65);
    }

    this.syncShipDroids(gfx, player.droidCount ?? 0);

    gfx.label.setText(player.name);
    if (instant) {
      gfx.renderX = player.x;
      gfx.renderY = player.y;
      gfx.renderAngle = player.angle;
    }

    gfx.lastHp = player.hp;
  }

  private npcVisual(npc: NpcPublic) {
    const kind = npc.kind ?? 'streuner';
    if (kind === 'cubikon') {
      const key =
        npc.npcSprite ?? (npc.enraged ? 'cubikon-angry' : 'cubikon-idle');
      const angry = key === 'cubikon-angry';
      return {
        key,
        size: angry ? 160 : 140,
        glow: 0,
        glowTint: 0xff8800,
        labelY: angry ? 88 : 78,
        barW: 120,
        depth: 9,
        fontSize: '13px',
        labelColor: '#ffcc66',
        useGlow: false,
      };
    }
    if (kind === 'protegit') {
      return {
        key: 'protegit',
        size: 52,
        glow: 0,
        glowTint: 0xff3344,
        labelY: 34,
        barW: 52,
        depth: 8,
        fontSize: '10px',
        labelColor: '#ff8888',
        useGlow: false,
      };
    }
    return {
      key: 'ship-npc',
      size: 56,
      glow: 70,
      glowTint: 0xff5533,
      labelY: 38,
      barW: 56,
      depth: 8,
      fontSize: '11px',
      labelColor: '#ffffff',
      useGlow: true,
    };
  }

  private upsertNpc(npc: NpcPublic, instant: boolean) {
    const vis = this.npcVisual(npc);
    let gfx = this.npcs.get(npc.id);
    if (!gfx) {
      const root = this.add.container(npc.x, npc.y).setDepth(vis.depth);
      const glow = this.add
        .image(0, 0, vis.key)
        .setDisplaySize(vis.glow || vis.size, vis.glow || vis.size)
        .setAlpha(vis.useGlow ? 0.4 : 0)
        .setTint(vis.glowTint)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setVisible(!!vis.useGlow);
      const sprite = this.add.image(0, 0, vis.key).setDisplaySize(vis.size, vis.size);
      const label = this.add
        .text(0, vis.labelY, npc.name || 'NPC', {
          fontFamily: 'Orbitron, sans-serif',
          fontSize: vis.fontSize,
          color: vis.labelColor,
          stroke: '#031018',
          strokeThickness: 3,
        })
        .setOrigin(0.5, 0);
      const hp = this.add.graphics();
      root.add([glow, sprite, hp, label]);
      gfx = {
        root,
        sprite,
        glow,
        label,
        hp,
        spriteKey: vis.key,
        barW: vis.barW,
        labelY: vis.labelY,
        lastHp: npc.hp,
        renderX: npc.x,
        renderY: npc.y,
        renderAngle: npc.angle,
      };
      this.npcs.set(npc.id, gfx);
    } else if (gfx.spriteKey !== vis.key) {
      gfx.spriteKey = vis.key;
      gfx.sprite.setTexture(vis.key).setDisplaySize(vis.size, vis.size);
      if (vis.useGlow) {
        gfx.glow.setTexture(vis.key).setDisplaySize(vis.glow, vis.glow).setVisible(true);
      } else {
        gfx.glow.setVisible(false);
      }
      gfx.barW = vis.barW;
      gfx.labelY = vis.labelY;
      gfx.label.setY(vis.labelY);
      gfx.label.setFontSize(vis.fontSize);
      gfx.label.setColor(vis.labelColor);
    }

    gfx.label.setText(npc.name || 'NPC');
    if (instant) {
      gfx.renderX = npc.x;
      gfx.renderY = npc.y;
      gfx.renderAngle = npc.angle;
    }

    gfx.lastHp = npc.hp;
  }

  private drawHpBar(
    g: Phaser.GameObjects.Graphics,
    hp: number,
    maxHp: number,
    shield: number,
    maxShield: number,
  ) {
    g.clear();
    g.setRotation(0);
    const w = 64;
    const shH = 3;
    const hpH = 4;
    const shY = -46;
    const hpY = -40;
    const hpCap = Math.max(1, maxHp);
    const shCap = Math.max(1, maxShield);
    const hpRatio = Math.min(1, Math.max(0, hp / hpCap));
    const shRatio =
      maxShield <= 0 ? 0 : Math.min(1, Math.max(0, shield / shCap));

    g.fillStyle(0x000000, 0.55);
    g.fillRoundedRect(-w / 2, shY, w, shH, 1);
    if (shRatio > 0) {
      g.fillStyle(0x3b82f6, 1);
      g.fillRoundedRect(-w / 2, shY, w * shRatio, shH, 1);
    }

    g.fillStyle(0x000000, 0.55);
    g.fillRoundedRect(-w / 2, hpY, w, hpH, 1);
    const tint =
      hpRatio > 0.5 ? 0x4ade80 : hpRatio > 0.25 ? 0xffd166 : 0xff6b4a;
    g.fillStyle(tint, 1);
    g.fillRoundedRect(-w / 2, hpY, w * hpRatio, hpH, 1);
    g.lineStyle(1, 0xffffff, 0.18);
    g.strokeRoundedRect(-w / 2, hpY, w, hpH, 1);
  }

  private pulsePick(id: string) {
    const gfx = this.ships.get(id) ?? this.npcs.get(id);
    if (!gfx) return;
    this.tweens.add({
      targets: gfx.glow,
      alpha: 0.85,
      duration: 120,
      yoyo: true,
      repeat: 2,
    });
  }

  private spawnExplosion(x: number, y: number, scale = 1) {
    const boom = this.add
      .image(x, y, 'explosion')
      .setBlendMode(Phaser.BlendModes.ADD)
      .setScale(0.2 * scale)
      .setAlpha(0.95)
      .setDepth(20);

    this.tweens.add({
      targets: boom,
      scale: 1.1 * scale,
      alpha: 0,
      duration: 420,
      ease: 'Cubic.easeOut',
      onComplete: () => boom.destroy(),
    });

    const sparks = this.add.particles(x, y, 'bullet', {
      speed: { min: 60, max: 220 },
      angle: { min: 0, max: 360 },
      scale: { start: 0.25, end: 0 },
      alpha: { start: 1, end: 0 },
      lifespan: 450,
      quantity: 14,
      blendMode: 'ADD',
      tint: [0xffaa44, 0xff6644, 0xffffff, 0x66e0ff],
      emitting: false,
    });
    sparks.setDepth(21);
    sparks.explode(14);
    this.time.delayedCall(500, () => sparks.destroy());
  }

  private createBackground() {
    const tile = this.add
      .tileSprite(
        this.world.width / 2,
        this.world.height / 2,
        this.world.width,
        this.world.height,
        'space-bg',
      )
      .setDepth(-20)
      .setAlpha(0.92);

    const wash = this.add.graphics().setDepth(-19).setAlpha(0.35);
    wash.fillStyle(0x0a1a3a, 1);
    wash.fillCircle(this.world.width * 0.25, this.world.height * 0.3, 900);
    wash.fillStyle(0x2a1040, 1);
    wash.fillCircle(this.world.width * 0.75, this.world.height * 0.7, 1100);
    wash.fillStyle(0x06304a, 1);
    wash.fillCircle(this.world.width * 0.55, this.world.height * 0.2, 700);

    this.tweens.add({
      targets: tile,
      tilePositionX: 160,
      tilePositionY: 100,
      duration: 100000,
      ease: 'Linear',
      repeat: -1,
    });
  }

  private createAmbientDust() {
    this.add
      .particles(0, 0, 'bullet', {
        x: { min: 0, max: this.world.width },
        y: { min: 0, max: this.world.height },
        scale: { min: 0.03, max: 0.08 },
        alpha: { start: 0.35, end: 0 },
        lifespan: { min: 4000, max: 9000 },
        speedX: { min: -8, max: 8 },
        speedY: { min: -8, max: 8 },
        frequency: 180,
        blendMode: 'ADD',
        tint: [0x88ddff, 0xffffff, 0xa78bfa],
      })
      .setDepth(-10);
  }

  private drawBorder() {
    const g = this.add.graphics().setDepth(-5);
    g.lineStyle(3, 0x3dd6ff, 0.45);
    g.strokeRect(4, 4, this.world.width - 8, this.world.height - 8);
    g.lineStyle(1, 0x3dd6ff, 0.1);
    const step = 500;
    for (let x = step; x < this.world.width; x += step) {
      g.lineBetween(x, 0, x, this.world.height);
    }
    for (let y = step; y < this.world.height; y += step) {
      g.lineBetween(0, y, this.world.width, y);
    }
  }

  private drawRadiationZone() {
    const inset = this.world.radiationInset ?? 0;
    if (inset <= 0) {
      this.radiationGfx = this.add.graphics().setDepth(-4);
      return;
    }
    const g = this.add.graphics().setDepth(-4);
    this.radiationGfx = g;
    const w = this.world.width;
    const h = this.world.height;

    g.fillStyle(0xff2233, 0.14);
    g.fillRect(0, 0, w, inset);
    g.fillRect(0, h - inset, w, inset);
    g.fillRect(0, inset, inset, h - inset * 2);
    g.fillRect(w - inset, inset, inset, h - inset * 2);

    g.lineStyle(2, 0xff4455, 0.35);
    g.strokeRect(inset, inset, w - inset * 2, h - inset * 2);
  }
}
