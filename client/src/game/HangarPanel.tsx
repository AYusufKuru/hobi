import { useMemo, useRef, useState, type DragEvent } from 'react';
import type { GameSocket } from './socket';
import {
  DROID_UI_CENTER,
  DROID_UI_LEFT,
  DROID_UI_RIGHT,
} from './droidFormation';

export type ShopCategory =
  | 'ships'
  | 'lasers'
  | 'generators'
  | 'ammo'
  | 'droids';
export type ShopCurrency = 'silver' | 'gold';

export type ShopItem = {
  id: string;
  category: ShopCategory;
  name: string;
  desc: string;
  price: number;
  currency?: ShopCurrency;
  inMarket?: boolean;
  speed?: number;
  maxHp?: number;
  maxShield?: number;
  laserSlots?: number;
  generatorSlots?: number;
  baseDamage?: number;
  npcBonus?: number;
  ammoAdd?: number;
  speedBonus?: number;
  shieldBonus?: number;
  absorbPct?: number;
};

export type ShipFit = {
  lasers: (string | null)[];
  generators: (string | null)[];
};

export type DroidFit = {
  slots: [string | null, string | null];
};

export type HangarLoadout = {
  version: 2;
  ships: string[];
  lasers: Record<string, number>;
  generators: Record<string, number>;
  fits: Record<string, ShipFit>;
  activeShipId: string;
  laserAmmo: number;
  ammo?: Record<string, number>;
  activeAmmoId?: string;
  skillBar?: (string | null)[];
  droidCount?: number;
  droidFits?: DroidFit[];
};

export type HangarState = {
  ok: boolean;
  error?: string;
  credits?: number;
  gold?: number;
  catalog?: ShopItem[];
  loadout?: HangarLoadout;
  stats?: {
    speed: number;
    maxHp: number;
    maxShield: number;
    laserDamage: number;
    laserNpcBonus?: number;
    equippedLasers?: number;
    shieldAbsorb?: number;
    laserAmmo: number;
    activeAmmoId?: string;
    ammo?: Record<string, number>;
    skillBar?: (string | null)[];
    laserSlots?: number;
    generatorSlots?: number;
    droidCount?: number;
  };
};

type Props = {
  open: boolean;
  onClose: () => void;
  socket: GameSocket;
  hangar: HangarState | null;
  onHangar: (state: HangarState) => void;
  onCredits?: (credits: number) => void;
  onGold?: (gold: number) => void;
  onToast?: (msg: string | null) => void;
};

type NavId = 'info' | 'equip' | 'market';
type EquipTab = 'preview' | 'ship' | 'droid';

type DragPayload =
  | { from: 'hangar'; itemId: string; kind: 'laser' | 'generator' }
  | {
      from: 'ship';
      itemId: string;
      kind: 'laser' | 'generator';
      slotIndex: number;
    }
  | {
      from: 'droid';
      itemId: string;
      kind: 'laser' | 'generator';
      droidIndex: number;
      slotIndex: number;
    };

const ITEM_ICON: Record<string, string> = {
  'ship-phoenix': '/assets/hangar/ship-phoenix.png',
  'ship-leonov': '/assets/hangar/ship-leonov.png',
  'ship-goliath': '/assets/hangar/ship-goliath.png',
  'laser-lf1': '/assets/hangar/laser-lf1.png',
  'laser-mp1': '/assets/hangar/laser-mp1.png',
  'laser-lf2': '/assets/hangar/laser-lf2.png',
  'laser-lf3': '/assets/hangar/laser-lf3.png',
  'laser-lf4': '/assets/hangar/laser-lf4.png',
  'gen-spd-2': '/assets/hangar/gen-speed.png',
  'gen-spd-4': '/assets/hangar/gen-speed.png',
  'gen-spd-6': '/assets/hangar/gen-speed.png',
  'gen-spd-8': '/assets/hangar/gen-speed.png',
  'gen-spd-10': '/assets/hangar/gen-speed.png',
  'gen-shd-1000': '/assets/hangar/gen-shield.png',
  'gen-shd-2000': '/assets/hangar/gen-shield.png',
  'gen-shd-5000': '/assets/hangar/gen-shield.png',
  'gen-shd-4000': '/assets/hangar/gen-shield.png',
  'gen-shd-10000': '/assets/hangar/gen-shield.png',
  'gen-speed-1': '/assets/hangar/gen-speed.png',
  'gen-speed-2': '/assets/hangar/gen-speed.png',
  'gen-shield-1': '/assets/hangar/gen-shield.png',
  'gen-shield-2': '/assets/hangar/gen-shield.png',
  'ammo-ucb': '/assets/hangar/ammo-ucb.png',
  'ammo-rsb': '/assets/hangar/ammo-rsb.png',
  'ammo-x1': '/assets/hangar/ammo-ucb.png',
  'ammo-x2': '/assets/hangar/ammo-ucb.png',
  'ammo-x3': '/assets/hangar/ammo-ucb.png',
  'ammo-x4': '/assets/hangar/ammo-ucb.png',
  'droid-basic': '/assets/droid.png',
};

const SIDEBAR: { id: NavId | 'disabled'; label: string }[] = [
  { id: 'info', label: 'Bilgi' },
  { id: 'equip', label: 'Ekipman' },
  { id: 'market', label: 'Market' },
  { id: 'disabled', label: 'Açık Artırma' },
  { id: 'disabled', label: 'Görevler' },
  { id: 'disabled', label: 'Klan' },
  { id: 'disabled', label: 'İstatistikler' },
  { id: 'disabled', label: 'Uzay Haritası' },
  { id: 'disabled', label: 'Ayarlar' },
];

function iconFor(id: string) {
  return ITEM_ICON[id] ?? '/assets/hangar/laser-lf1.png';
}

function emitAck<T>(socket: GameSocket, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve) => {
    socket.emit(event, payload, (res: T) => resolve(res));
  });
}

function parseDragPayload(raw: string): DragPayload | null {
  try {
    return JSON.parse(raw) as DragPayload;
  } catch {
    return null;
  }
}

export default function HangarPanel({
  open,
  onClose,
  socket,
  hangar,
  onHangar,
  onCredits,
  onGold,
  onToast,
}: Props) {
  const [nav, setNav] = useState<NavId>('equip');
  const [equipTab, setEquipTab] = useState<EquipTab>('ship');
  const [selectedShipId, setSelectedShipId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [marketCat, setMarketCat] = useState<ShopCategory>('ships');
  const [dragOver, setDragOver] = useState<string | null>(null);
  const dragRef = useRef<DragPayload | null>(null);

  const catalog = hangar?.catalog ?? [];
  const loadout = hangar?.loadout;
  const stats = hangar?.stats;
  const selectedShip = selectedShipId ?? loadout?.activeShipId ?? 'ship-phoenix';
  const fit = loadout?.fits?.[selectedShip];

  const depotItems = useMemo(() => {
    if (!loadout) return [] as { id: string; n: number; kind: 'laser' | 'generator' }[];
    const out: { id: string; n: number; kind: 'laser' | 'generator' }[] = [];
    for (const [id, n] of Object.entries(loadout.lasers)) {
      if (n > 0) out.push({ id, n, kind: 'laser' });
    }
    for (const [id, n] of Object.entries(loadout.generators)) {
      if (n > 0) out.push({ id, n, kind: 'generator' });
    }
    return out;
  }, [loadout]);

  const marketItems = useMemo(
    () => catalog.filter((i) => i.category === marketCat),
    [catalog, marketCat],
  );

  if (!open) return null;

  async function applyResult(res: {
    ok: boolean;
    error?: string;
    hangar?: HangarState;
  }) {
    if (!res.ok) {
      onToast?.(res.error ?? 'İşlem başarısız');
      return false;
    }
    if (res.hangar) {
      onHangar(res.hangar);
      if (typeof res.hangar.credits === 'number') onCredits?.(res.hangar.credits);
      if (typeof res.hangar.gold === 'number') onGold?.(res.hangar.gold);
    }
    return true;
  }

  async function buy(itemId: string) {
    setBusy(true);
    const res = await emitAck<{ ok: boolean; error?: string; hangar?: HangarState }>(
      socket,
      'hangar:buy',
      { itemId },
    );
    setBusy(false);
    if (await applyResult(res)) onToast?.('Satın alındı');
  }

  async function activateShip(shipId: string) {
    setBusy(true);
    const res = await emitAck<{ ok: boolean; error?: string; hangar?: HangarState }>(
      socket,
      'hangar:activateShip',
      { shipId },
    );
    setBusy(false);
    if (await applyResult(res)) {
      setSelectedShipId(shipId);
      onToast?.('Gemi aktif');
    }
  }

  async function equipToSlot(
    itemId: string,
    kind: 'laser' | 'generator',
    slotIndex: number,
  ) {
    setBusy(true);
    const res = await emitAck<{ ok: boolean; error?: string; hangar?: HangarState }>(
      socket,
      'hangar:equipSlot',
      { shipId: selectedShip, slotKind: kind, slotIndex, itemId },
    );
    setBusy(false);
    if (await applyResult(res)) onToast?.('Takıldı');
  }

  async function unequip(kind: 'laser' | 'generator', slotIndex: number) {
    setBusy(true);
    const res = await emitAck<{ ok: boolean; error?: string; hangar?: HangarState }>(
      socket,
      'hangar:unequipSlot',
      { shipId: selectedShip, slotKind: kind, slotIndex },
    );
    setBusy(false);
    if (await applyResult(res)) onToast?.('Hangara alındı');
  }

  async function equipDroidToSlot(
    itemId: string,
    droidIndex: number,
    slotIndex: number,
  ) {
    setBusy(true);
    const res = await emitAck<{ ok: boolean; error?: string; hangar?: HangarState }>(
      socket,
      'hangar:equipDroidSlot',
      { droidIndex, slotIndex, itemId },
    );
    setBusy(false);
    if (await applyResult(res)) onToast?.('Droid modülü takıldı');
  }

  async function unequipDroid(droidIndex: number, slotIndex: number) {
    setBusy(true);
    const res = await emitAck<{ ok: boolean; error?: string; hangar?: HangarState }>(
      socket,
      'hangar:unequipDroidSlot',
      { droidIndex, slotIndex },
    );
    setBusy(false);
    if (await applyResult(res)) onToast?.('Modül depoya alındı');
  }

  function itemName(id: string) {
    return catalog.find((c) => c.id === id)?.name ?? id;
  }

  function readDrag(e: DragEvent): DragPayload | null {
    if (dragRef.current) return dragRef.current;
    const raw =
      e.dataTransfer.getData('text/plain') ||
      e.dataTransfer.getData('application/json');
    return raw ? parseDragPayload(raw) : null;
  }

  function clearDrag() {
    dragRef.current = null;
    setDragOver(null);
  }

  function onDragStartHangar(
    e: DragEvent,
    itemId: string,
    kind: 'laser' | 'generator',
  ) {
    const payload: DragPayload = { from: 'hangar', itemId, kind };
    dragRef.current = payload;
    e.dataTransfer.setData('text/plain', JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'move';
  }

  function onDragStartShip(
    e: DragEvent,
    itemId: string,
    kind: 'laser' | 'generator',
    slotIndex: number,
  ) {
    const payload: DragPayload = { from: 'ship', itemId, kind, slotIndex };
    dragRef.current = payload;
    e.dataTransfer.setData('text/plain', JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'move';
  }

  async function onDropShipSlot(
    e: DragEvent,
    kind: 'laser' | 'generator',
    slotIndex: number,
  ) {
    e.preventDefault();
    e.stopPropagation();
    const data = readDrag(e);
    clearDrag();
    if (!data || busy) return;
    if (data.kind !== kind) {
      onToast?.(
        kind === 'laser' ? 'Bu yuva sadece lazer' : 'Bu yuva sadece jeneratör',
      );
      return;
    }
    if (data.from === 'hangar') {
      await equipToSlot(data.itemId, kind, slotIndex);
      return;
    }
    if (data.from === 'ship') {
      if (data.kind === kind && data.slotIndex === slotIndex) return;
      setBusy(true);
      await emitAck(socket, 'hangar:unequipSlot', {
        shipId: selectedShip,
        slotKind: data.kind,
        slotIndex: data.slotIndex,
      });
      const res = await emitAck<{
        ok: boolean;
        error?: string;
        hangar?: HangarState;
      }>(socket, 'hangar:equipSlot', {
        shipId: selectedShip,
        slotKind: kind,
        slotIndex,
        itemId: data.itemId,
      });
      setBusy(false);
      await applyResult(res);
    }
  }

  function moduleKind(id: string): 'laser' | 'generator' | null {
    const cat = catalog.find((c) => c.id === id)?.category;
    if (cat === 'lasers') return 'laser';
    if (cat === 'generators') return 'generator';
    return null;
  }

  function onDragStartDroidInv(
    e: DragEvent,
    itemId: string,
    kind: 'laser' | 'generator',
  ) {
    onDragStartHangar(e, itemId, kind);
  }

  function onDragStartDroid(
    e: DragEvent,
    itemId: string,
    kind: 'laser' | 'generator',
    droidIndex: number,
    slotIndex: number,
  ) {
    const payload: DragPayload = {
      from: 'droid',
      itemId,
      kind,
      droidIndex,
      slotIndex,
    };
    dragRef.current = payload;
    e.dataTransfer.setData('text/plain', JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'move';
  }

  function isDroidShieldGen(id: string) {
    const item = catalog.find((c) => c.id === id);
    return (
      item?.category === 'generators' &&
      (item.shieldBonus ?? 0) > 0 &&
      (item.speedBonus ?? 0) === 0
    );
  }

  function isDroidModuleAllowed(id: string) {
    const item = catalog.find((c) => c.id === id);
    if (!item) return false;
    if (item.category === 'lasers') return true;
    return isDroidShieldGen(id);
  }

  async function onDropDroidSlot(
    e: DragEvent,
    droidIndex: number,
    slotIndex: number,
  ) {
    e.preventDefault();
    e.stopPropagation();
    const data = readDrag(e);
    clearDrag();
    if (!data || busy) return;
    if (!isDroidModuleAllowed(data.itemId)) {
      onToast?.('Droidlere hız jeneratörü takılamaz — sadece lazer veya kalkan');
      return;
    }
    if (data.from === 'hangar') {
      await equipDroidToSlot(data.itemId, droidIndex, slotIndex);
      return;
    }
    if (data.from === 'droid') {
      if (data.droidIndex === droidIndex && data.slotIndex === slotIndex) {
        return;
      }
      setBusy(true);
      await emitAck(socket, 'hangar:unequipDroidSlot', {
        droidIndex: data.droidIndex,
        slotIndex: data.slotIndex,
      });
      const res = await emitAck<{
        ok: boolean;
        error?: string;
        hangar?: HangarState;
      }>(socket, 'hangar:equipDroidSlot', {
        droidIndex,
        slotIndex,
        itemId: data.itemId,
      });
      setBusy(false);
      await applyResult(res);
    }
  }

  async function onDropDroidInv(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    const data = readDrag(e);
    clearDrag();
    if (!data || busy) return;
    if (data.from === 'droid') {
      await unequipDroid(data.droidIndex, data.slotIndex);
    }
  }

  function renderDroidCard(droidIndex: number, areaClass?: string) {
    const owned = droidIndex < (loadout?.droidCount ?? 0);
    const fit = loadout?.droidFits?.[droidIndex];
    const key = `droid-${droidIndex}`;

    if (!owned) {
      return (
        <div key={key} className={`droid-card empty ${areaClass ?? ''}`}>
          <span className="empty-mark">—</span>
        </div>
      );
    }

    return (
      <div key={key} className={`droid-card ${areaClass ?? ''}`}>
        <div className="droid-card-body">
          <img src="/assets/droid.png" alt="" draggable={false} />
        </div>
        <div className="droid-mod-slots">
          {[0, 1].map((si) => {
            const modId = fit?.slots?.[si] ?? null;
            const slotKey = `${key}-s${si}`;
            return (
              <div
                key={slotKey}
                className={`do-slot droid-mod ${modId ? 'filled' : 'empty'} ${
                  dragOver === slotKey ? 'drop-target' : ''
                }`}
                draggable={!!modId && !busy}
                title={modId ? itemName(modId) : 'Lazer / kalkan'}
                onDragStart={(e) => {
                  if (!modId) return;
                  const kind = moduleKind(modId);
                  if (!kind) return;
                  onDragStartDroid(e, modId, kind, droidIndex, si);
                }}
                onDragEnd={clearDrag}
                onDragOver={(ev) => allowDrop(ev, slotKey)}
                onDragLeave={() => setDragOver(null)}
                onDrop={(ev) => void onDropDroidSlot(ev, droidIndex, si)}
              >
                {modId ? (
                  <img src={iconFor(modId)} alt="" draggable={false} />
                ) : (
                  <span className="empty-mark">+</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  async function onDropHangar(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    const data = readDrag(e);
    clearDrag();
    if (!data || busy) return;
    if (data.from === 'ship') {
      await unequip(data.kind, data.slotIndex);
    }
  }

  function allowDrop(e: DragEvent, key: string) {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setDragOver(key);
  }

  return (
    <div className="do-overlay">
      <div className="do-shell">
        <aside className="do-sidebar">
          <div className="do-sidebar-brand">
            <img src="/assets/hangar/ship-phoenix.png" alt="" />
            <span>Kontrol Paneli</span>
          </div>
          <nav className="do-sidebar-nav">
            {SIDEBAR.map((item, idx) => (
              <button
                key={`${item.label}-${idx}`}
                type="button"
                className={
                  item.id !== 'disabled' && nav === item.id ? 'active' : ''
                }
                disabled={item.id === 'disabled' || busy}
                onClick={() => {
                  if (item.id === 'disabled') return;
                  setNav(item.id);
                }}
              >
                {item.label}
              </button>
            ))}
          </nav>
          <button type="button" className="do-logout" onClick={onClose}>
            Çıkış Yap
          </button>
        </aside>

        <section className="do-main">
          <header className="do-top">
            {nav === 'equip' && (
              <div className="do-tabs">
                <button
                  type="button"
                  className={equipTab === 'preview' ? 'active' : ''}
                  onClick={() => setEquipTab('preview')}
                >
                  ÖNİZLEME
                </button>
                <button
                  type="button"
                  className={equipTab === 'ship' ? 'active' : ''}
                  onClick={() => setEquipTab('ship')}
                >
                  GEMİ
                </button>
                <button
                  type="button"
                  className={equipTab === 'droid' ? 'active' : ''}
                  onClick={() => setEquipTab('droid')}
                >
                  DROID
                </button>
              </div>
            )}
            {nav === 'market' && <div className="do-tabs-title">MARKET</div>}
            {nav === 'info' && <div className="do-tabs-title">BİLGİ</div>}
            <div className="do-top-right">
              <span className="do-credits">
                {hangar?.credits ?? 0} gümüş · {hangar?.gold ?? 0} altın
              </span>
              <button type="button" className="do-close" onClick={onClose}>
                KAPAT X
              </button>
            </div>
          </header>

          <div className="do-content">
            {nav === 'info' && (
              <div className="do-info">
                <h3>Pilot durumu</h3>
                <ul>
                  <li>
                    Hasar: {stats?.laserDamage ?? 0}
                    {(stats?.laserNpcBonus ?? 0) > 0
                      ? ` (+${stats?.laserNpcBonus} NPC)`
                      : ''}
                  </li>
                  <li>Takılı lazer: {stats?.equippedLasers ?? 0}</li>
                  <li>Can: {stats?.maxHp ?? 0}</li>
                  <li>Max Kalkan: {stats?.maxShield ?? 0}</li>
                  <li>Absorb: %{stats?.shieldAbsorb ?? 0}</li>
                  <li>Hız: {stats?.speed ?? 0}</li>
                  <li>Cephane: {stats?.laserAmmo ?? 0}</li>
                  <li>Aktif gemi: {itemName(loadout?.activeShipId ?? '')}</li>
                </ul>
              </div>
            )}

            {nav === 'market' && (
              <div className="do-market">
                <div className="do-subtabs">
                  {                    (
                    [
                      ['ships', 'Gemiler'],
                      ['lasers', 'Lazerler'],
                      ['generators', 'Jeneratör'],
                      ['ammo', 'Cephane'],
                      ['droids', 'Droid'],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      className={marketCat === id ? 'active' : ''}
                      onClick={() => setMarketCat(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="do-item-grid">
                  {marketItems.map((item) => {
                    const ownedShip =
                      item.category === 'ships' &&
                      loadout?.ships.includes(item.id);
                    const droidFull =
                      item.category === 'droids' &&
                      (loadout?.droidCount ?? 0) >= 8;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className="do-item-card"
                        disabled={busy || !!ownedShip || droidFull}
                        onClick={() => void buy(item.id)}
                      >
                        <img src={iconFor(item.id)} alt="" />
                        <span className="name">{item.name}</span>
                        <span className="qty">
                          {ownedShip
                            ? 'SAHİP'
                            : droidFull
                              ? 'MAX 8'
                              : item.category === 'droids'
                                ? `${loadout?.droidCount ?? 0}/8 · ${item.price} ${
                                    item.currency === 'gold' ? 'altın' : 'gümüş'
                                  }`
                                : `${item.price} ${
                                    item.currency === 'gold' ? 'altın' : 'gümüş'
                                  }`}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {nav === 'equip' && equipTab === 'preview' && (
              <div className="do-preview">
                <div className="do-panel">
                  <h3>Hangarlar</h3>
                  <div className="do-hangar-row">
                    {(loadout?.ships ?? []).map((sid) => {
                      const active = loadout?.activeShipId === sid;
                      return (
                        <div key={sid} className="do-ship-slot">
                          <img src={iconFor(sid)} alt="" />
                          <span className="name">{itemName(sid)}</span>
                          {active ? (
                            <span className="active-tag">aktif</span>
                          ) : (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void activateShip(sid)}
                            >
                              Değiştir
                            </button>
                          )}
                        </div>
                      );
                    })}
                    <button
                      type="button"
                      className="do-ship-slot buy"
                      onClick={() => {
                        setNav('market');
                        setMarketCat('ships');
                      }}
                    >
                      <span className="plus">+</span>
                      <span className="name">Hangar Satın Al</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {nav === 'equip' && equipTab === 'droid' && (
              <div className="do-droid-layout">
                <div className="do-droid-main">
                  <h3>Droidler ({loadout?.droidCount ?? 0}/8)</h3>
                  <p className="do-hint">
                    Her droidde 2 modül (lazer veya kalkan jeneratörü). Takılan
                    modüller gemi statlarına eklenir.
                  </p>
                  <div className="do-droid-stage">
                    <div className="droid-cluster left">
                      {DROID_UI_LEFT.map((idx, pos) =>
                        renderDroidCard(
                          idx,
                          pos === 0 ? 'droid-lead' : pos === 1 ? 'droid-top' : 'droid-bot',
                        ),
                      )}
                    </div>
                    <div className="droid-back-center">
                      {DROID_UI_CENTER.map((idx) => renderDroidCard(idx))}
                    </div>
                    <div className="droid-cluster right">
                      {DROID_UI_RIGHT.map((idx, pos) =>
                        renderDroidCard(
                          idx,
                          pos === 0 ? 'droid-lead' : pos === 1 ? 'droid-top' : 'droid-bot',
                        ),
                      )}
                    </div>
                  </div>
                </div>

                <div
                  className={`do-panel do-hangar-inv ${
                    dragOver === 'droid-inv' ? 'drop-target' : ''
                  }`}
                  onDragOver={(e) => allowDrop(e, 'droid-inv')}
                  onDragLeave={() => setDragOver(null)}
                  onDrop={(e) => void onDropDroidInv(e)}
                >
                  <h3>Sahip olduklarım</h3>

                  <div className="do-inv-section">
                    <h4>Lazer</h4>
                    <div className="do-equip-grid hangar">
                      {depotItems.filter((d) => d.kind === 'laser').length ===
                        0 && <div className="do-empty tiny">Lazer yok</div>}
                      {depotItems
                        .filter((d) => d.kind === 'laser')
                        .map(({ id, n, kind }) => (
                          <div
                            key={id}
                            className="do-slot filled"
                            draggable={!busy}
                            title={`${itemName(id)} ×${n}`}
                            onDragStart={(e) =>
                              onDragStartDroidInv(e, id, kind)
                            }
                            onDragEnd={clearDrag}
                          >
                            <img src={iconFor(id)} alt="" draggable={false} />
                            {n > 1 && <span className="stack">{n}</span>}
                          </div>
                        ))}
                    </div>
                  </div>

                  <div className="do-inv-section">
                    <h4>Kalkan (jeneratör)</h4>
                    <div className="do-equip-grid hangar">
                      {depotItems.filter(
                        (d) => d.kind === 'generator' && isDroidShieldGen(d.id),
                      ).length === 0 && (
                        <div className="do-empty tiny">Kalkan jeneratörü yok</div>
                      )}
                      {depotItems
                        .filter(
                          (d) =>
                            d.kind === 'generator' && isDroidShieldGen(d.id),
                        )
                        .map(({ id, n, kind }) => (
                          <div
                            key={id}
                            className="do-slot filled"
                            draggable={!busy}
                            title={`${itemName(id)} ×${n}`}
                            onDragStart={(e) =>
                              onDragStartDroidInv(e, id, kind)
                            }
                            onDragEnd={clearDrag}
                          >
                            <img src={iconFor(id)} alt="" draggable={false} />
                            {n > 1 && <span className="stack">{n}</span>}
                          </div>
                        ))}
                    </div>
                  </div>

                  <p className="do-hint">
                    Gemi hangarıyla aynı modüller — hız jeneratörü droidlere
                    takılamaz.
                  </p>
                </div>
              </div>
            )}

            {nav === 'equip' && equipTab === 'ship' && (
              <div className="do-ship-layout do-ship-layout-rev">
                {/* LEFT: ship equipment slots */}
                <div className="do-ship-left">
                  <div className="do-panel do-ship-header">
                    <h3>Gemi yuvaları</h3>
                    <div className="do-ship-picker compact">
                      {(loadout?.ships ?? []).map((sid) => (
                        <button
                          key={sid}
                          type="button"
                          className={selectedShip === sid ? 'active' : ''}
                          onClick={() => setSelectedShipId(sid)}
                          title={itemName(sid)}
                        >
                          <img src={iconFor(sid)} alt="" />
                        </button>
                      ))}
                    </div>
                    <span className="do-active-ship-name">
                      {itemName(selectedShip)}
                      {loadout?.activeShipId === selectedShip ? ' · aktif' : ''}
                    </span>
                  </div>

                  <div className="do-panel">
                    <h3>Lazer</h3>
                    <div className="do-equip-grid">
                      {(fit?.lasers ?? []).map((lid, i) => {
                        const key = `laser-${i}`;
                        return (
                          <div
                            key={key}
                            className={`do-slot ${lid ? 'filled' : 'empty'} ${
                              dragOver === key ? 'drop-target' : ''
                            }`}
                            draggable={!!lid && !busy}
                            title={lid ? itemName(lid) : 'Lazer yuvası'}
                            onDragStart={(e) =>
                              lid && onDragStartShip(e, lid, 'laser', i)
                            }
                            onDragEnd={clearDrag}
                            onDragOver={(e) => allowDrop(e, key)}
                            onDragLeave={() => setDragOver(null)}
                            onDrop={(e) => void onDropShipSlot(e, 'laser', i)}
                          >
                            {lid ? (
                              <img src={iconFor(lid)} alt="" draggable={false} />
                            ) : (
                              <span className="empty-mark">+</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="do-panel">
                    <h3>Jeneratörler</h3>
                    <div className="do-equip-grid gens">
                      {(fit?.generators ?? []).map((gid, i) => {
                        const key = `gen-${i}`;
                        return (
                          <div
                            key={key}
                            className={`do-slot ${gid ? 'filled' : 'empty'} ${
                              dragOver === key ? 'drop-target' : ''
                            }`}
                            draggable={!!gid && !busy}
                            title={gid ? itemName(gid) : 'Jeneratör yuvası'}
                            onDragStart={(e) =>
                              gid && onDragStartShip(e, gid, 'generator', i)
                            }
                            onDragEnd={clearDrag}
                            onDragOver={(e) => allowDrop(e, key)}
                            onDragLeave={() => setDragOver(null)}
                            onDrop={(e) => void onDropShipSlot(e, 'generator', i)}
                          >
                            {gid ? (
                              <img src={iconFor(gid)} alt="" draggable={false} />
                            ) : (
                              <span className="empty-mark">+</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="do-panel">
                    <h3>Uzantılar</h3>
                    <div className="do-equip-grid gens">
                      {Array.from({ length: 4 }).map((_, i) => (
                        <div key={`ext-${i}`} className="do-slot empty">
                          <span className="empty-mark">+</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <p className="do-hint">
                    Sağdaki Hangar’dan sürükle → soldaki yuvalara bırak.
                    Yuvalardan Hangar’a sürükleyerek çıkar.
                  </p>
                </div>

                {/* RIGHT: Hangar inventory by category */}
                <div
                  className={`do-panel do-hangar-inv ${
                    dragOver === 'hangar' ? 'drop-target' : ''
                  }`}
                  onDragOver={(e) => allowDrop(e, 'hangar')}
                  onDragLeave={() => setDragOver(null)}
                  onDrop={(e) => void onDropHangar(e)}
                >
                  <h3>Hangar</h3>

                  <div className="do-inv-section">
                    <h4>Silah</h4>
                    <div className="do-equip-grid hangar">
                      {depotItems.filter((d) => d.kind === 'laser').length ===
                        0 && <div className="do-empty tiny">Silah yok</div>}
                      {depotItems
                        .filter((d) => d.kind === 'laser')
                        .map(({ id, n, kind }) => (
                          <div
                            key={id}
                            className="do-slot filled"
                            draggable={!busy}
                            title={`${itemName(id)} ×${n}`}
                            onDragStart={(e) => onDragStartHangar(e, id, kind)}
                            onDragEnd={clearDrag}
                          >
                            <img src={iconFor(id)} alt="" draggable={false} />
                            {n > 1 && <span className="stack">{n}</span>}
                          </div>
                        ))}
                    </div>
                  </div>

                  <div className="do-inv-section">
                    <h4>Jeneratör</h4>
                    <div className="do-equip-grid hangar">
                      {depotItems.filter((d) => d.kind === 'generator')
                        .length === 0 && (
                        <div className="do-empty tiny">Jeneratör yok</div>
                      )}
                      {depotItems
                        .filter((d) => d.kind === 'generator')
                        .map(({ id, n, kind }) => (
                          <div
                            key={id}
                            className="do-slot filled"
                            draggable={!busy}
                            title={`${itemName(id)} ×${n}`}
                            onDragStart={(e) => onDragStartHangar(e, id, kind)}
                            onDragEnd={clearDrag}
                          >
                            <img src={iconFor(id)} alt="" draggable={false} />
                            {n > 1 && <span className="stack">{n}</span>}
                          </div>
                        ))}
                    </div>
                  </div>

                  <div className="do-inv-section">
                    <h4>Cephane (skill bara sürükle)</h4>
                    <div className="do-equip-grid hangar">
                      {(
                        [
                          'ammo-x1',
                          'ammo-x2',
                          'ammo-x3',
                          'ammo-x4',
                          'ammo-rsb',
                        ] as const
                      ).map((id) => {
                        const n = loadout?.ammo?.[id] ?? 0;
                        const item = catalog.find((c) => c.id === id);
                        return (
                          <div
                            key={id}
                            className="do-slot filled"
                            draggable={!busy}
                            title={`${item?.name ?? id} ×${n}`}
                            onDragStart={(e) => {
                              e.dataTransfer.setData('text/ammo-id', id);
                              e.dataTransfer.setData('text/plain', id);
                            }}
                          >
                            <img src={iconFor(id)} alt="" draggable={false} />
                            <span className="stack">{n}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
