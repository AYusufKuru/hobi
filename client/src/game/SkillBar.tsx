import { useEffect, useRef, useState } from 'react';
import type { GameSocket } from './socket';
import type { HangarState } from './HangarPanel';

const AMMO_META: Record<
  string,
  { label: string; color: string; key: string }
> = {
  'ammo-x1': { label: 'X1', color: '#ff3344', key: '1' },
  'ammo-x2': { label: 'X2', color: '#3388ff', key: '2' },
  'ammo-x3': { label: 'X3', color: '#33dd66', key: '3' },
  'ammo-x4': { label: 'X4', color: '#ffffff', key: '4' },
  'ammo-rsb': { label: 'RSB', color: '#ff8800', key: '5' },
};

const SLOT_ORDER = [
  'ammo-x1',
  'ammo-x2',
  'ammo-x3',
  'ammo-x4',
  'ammo-rsb',
] as const;

type Props = {
  socket: GameSocket;
  selfId: string;
  hangar: HangarState | null;
  firing?: boolean;
  onHangar: (h: HangarState) => void;
  onAmmo?: (count: number, activeId: string) => void;
  onToast?: (msg: string | null) => void;
};

function emitCombat(action: 'start' | 'stop') {
  window.dispatchEvent(
    new CustomEvent('govorbit:combat', { detail: { action } }),
  );
}

export default function SkillBar({
  socket,
  selfId,
  hangar,
  firing = false,
  onHangar,
  onAmmo,
  onToast,
}: Props) {
  const [activeId, setActiveId] = useState('ammo-x1');
  const [ammoLive, setAmmoLive] = useState<Record<string, number>>({});
  const activeIdRef = useRef(activeId);
  const firingRef = useRef(firing);
  activeIdRef.current = activeId;
  firingRef.current = firing;

  const ammo = {
    ...(hangar?.stats?.ammo ?? hangar?.loadout?.ammo ?? {}),
    ...ammoLive,
  };
  const skillBar =
    hangar?.stats?.skillBar ??
    hangar?.loadout?.skillBar ??
    [...SLOT_ORDER];

  useEffect(() => {
    const id = hangar?.stats?.activeAmmoId ?? hangar?.loadout?.activeAmmoId;
    if (id) setActiveId(id);
  }, [hangar?.stats?.activeAmmoId, hangar?.loadout?.activeAmmoId]);

  useEffect(() => {
    const onSnap = (snap: {
      players?: Array<{
        id?: string;
        ammo?: Record<string, number>;
        activeAmmoId?: string;
        laserAmmo?: number;
      }>;
    }) => {
      const self = snap.players?.find((p) => p.id === selfId);
      if (self?.ammo) {
        setAmmoLive(self.ammo);
        if (self.activeAmmoId) setActiveId(self.activeAmmoId);
        if (typeof self.laserAmmo === 'number' && self.activeAmmoId) {
          onAmmo?.(self.laserAmmo, self.activeAmmoId);
        }
      }
    };
    socket.on('snapshot', onSnap);
    return () => {
      socket.off('snapshot', onSnap);
    };
  }, [socket, onAmmo, selfId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        document.activeElement &&
        ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)
      ) {
        return;
      }
      const map: Record<string, string> = {
        Digit1: 'ammo-x1',
        Digit2: 'ammo-x2',
        Digit3: 'ammo-x3',
        Digit4: 'ammo-x4',
        Digit5: 'ammo-rsb',
        Numpad1: 'ammo-x1',
        Numpad2: 'ammo-x2',
        Numpad3: 'ammo-x3',
        Numpad4: 'ammo-x4',
        Numpad5: 'ammo-rsb',
      };
      const ammoId = map[e.code];
      if (ammoId) void activateAmmo(ammoId);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [socket]);

  async function select(ammoId: string) {
    await new Promise<void>((resolve) => {
      socket.emit(
        'ammo:select',
        { ammoId },
        (res: { ok?: boolean; error?: string; hangar?: HangarState }) => {
          if (!res?.ok) {
            onToast?.(res?.error ?? 'Cephane seçilemedi');
            resolve();
            return;
          }
          if (res.hangar) {
            onHangar(res.hangar);
            setActiveId(ammoId);
            const count = res.hangar.loadout?.ammo?.[ammoId] ?? 0;
            onAmmo?.(count, ammoId);
          }
          resolve();
        },
      );
    });
  }

  /** Same laser again while firing → stop. Else select + start fire. */
  async function activateAmmo(ammoId: string) {
    if (activeIdRef.current === ammoId && firingRef.current) {
      emitCombat('stop');
      return;
    }
    await select(ammoId);
    emitCombat('start');
  }

  async function assignSlot(slot: number, ammoId: string | null) {
    await new Promise<void>((resolve) => {
      socket.emit(
        'skillbar:set',
        { slot, ammoId },
        (res: { ok?: boolean; error?: string; hangar?: HangarState }) => {
          if (!res?.ok) {
            onToast?.(res?.error ?? 'Slot güncellenemedi');
          } else if (res.hangar) {
            onHangar(res.hangar);
          }
          resolve();
        },
      );
    });
  }

  const slots = SLOT_ORDER.map((id, i) => {
    const assigned = skillBar[i] ?? id;
    return assigned || id;
  });

  return (
    <div className="skill-bar" onMouseDown={(e) => e.stopPropagation()}>
      {slots.map((ammoId, i) => {
        const meta = AMMO_META[ammoId] ?? {
          label: '?',
          color: '#888',
          key: String(i + 1),
        };
        const count = ammo[ammoId] ?? 0;
        const active = activeId === ammoId;
        return (
          <button
            key={`${ammoId}-${i}`}
            type="button"
            className={`skill-slot ${active ? 'active' : ''} ${count <= 0 ? 'empty' : ''}`}
            style={{ ['--ammo-color' as string]: meta.color }}
            title={`${meta.label} · bas: ateş / aynı tuş: dur`}
            onClick={() => void activateAmmo(ammoId)}
            onContextMenu={(e) => {
              e.preventDefault();
              void assignSlot(i, null);
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData('text/ammo-id');
              if (id) void assignSlot(i, id);
            }}
          >
            <span className="skill-key">{meta.key}</span>
            <span className="skill-label">{meta.label}</span>
            <span className="skill-count">{count}</span>
          </button>
        );
      })}
    </div>
  );
}
