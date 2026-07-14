import { FormEvent, useMemo, useState } from 'react';
import HangarPanel, { type HangarState } from './game/HangarPanel';
import PhaserGame from './game/PhaserGame';
import { createGameSocket, joinGame, type GameSocket } from './game/socket';
import type { PlayerPublic, Snapshot, WorldConfig } from './game/types';

type Session = {
  socket: GameSocket;
  self: PlayerPublic;
  world: WorldConfig;
  snapshot?: Snapshot;
};

type HudStats = {
  hp: number;
  maxHp: number;
  shield: number;
  maxShield: number;
  credits: number;
  gold: number;
  kills: number;
  name: string;
  targetName: string | null;
  firing: boolean;
  rockets: number;
  laserAmmo: number;
  inRange: boolean;
};

export default function App() {
  const [name, setName] = useState(() => localStorage.getItem('govorbit-name') ?? '');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [hangarOpen, setHangarOpen] = useState(false);
  const [hangar, setHangar] = useState<HangarState | null>(null);
  const [stats, setStats] = useState<HudStats>({
    hp: 100,
    maxHp: 100,
    shield: 100,
    maxShield: 100,
    credits: 0,
    gold: 0,
    kills: 0,
    name: '',
    targetName: null,
    firing: false,
    rockets: 0,
    laserAmmo: 0,
    inRange: false,
  });
  const [toast, setToast] = useState<string | null>(null);

  const hud = useMemo(
    () => ({
      onStats: setStats,
      onToast: (msg: string | null) => {
        setToast(msg);
        if (msg) setTimeout(() => setToast(null), 1400);
      },
    }),
    [],
  );

  async function openHangar() {
    if (!session) return;
    setHangarOpen(true);
    await new Promise<void>((resolve) => {
      session.socket.emit('hangar:get', {}, (res: HangarState) => {
        setHangar(res);
        if (res.ok && typeof res.credits === 'number') {
          setStats((s) => ({
            ...s,
            credits: res.credits!,
            gold: typeof res.gold === 'number' ? res.gold : s.gold,
          }));
        }
        resolve();
      });
    });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const socket = createGameSocket();
    socket.connect();

    try {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('Sunucuya bağlanılamadı')), 5000);
        socket.once('connect', () => {
          clearTimeout(t);
          resolve();
        });
        socket.once('connect_error', (err) => {
          clearTimeout(t);
          reject(err);
        });
      });

      const result = await joinGame(socket, name);
      if (!result.ok || !result.self || !result.world) {
        socket.disconnect();
        setError(result.error ?? 'Giriş başarısız');
        setLoading(false);
        return;
      }

      localStorage.setItem('govorbit-name', name.trim());
      const self = result.self as PlayerPublic;
      setStats({
        hp: self.hp,
        maxHp: self.maxHp ?? result.world.maxHp,
        shield: self.shield,
        maxShield: self.maxShield ?? result.world.maxShield,
        credits: self.credits,
        gold: self.gold ?? 0,
        kills: self.kills,
        name: self.name,
        targetName: null,
        firing: false,
        rockets: self.rockets,
        laserAmmo: self.laserAmmo ?? 0,
        inRange: false,
      });
      if ((result as { hangar?: HangarState }).hangar) {
        setHangar((result as { hangar?: HangarState }).hangar!);
      }
      setSession({
        socket,
        self: {
          ...self,
          moving: false,
          inRange: false,
          targetId: self.targetId ?? null,
          firing: self.firing ?? false,
          shipSprite: self.shipSprite ?? 'ship-player',
          maxHp: self.maxHp ?? result.world.maxHp,
          maxShield: self.maxShield ?? result.world.maxShield,
          laserAmmo: self.laserAmmo ?? 0,
          shipId: self.shipId ?? 'ship-phoenix',
          shipSpeed: self.shipSpeed ?? result.world.shipSpeed,
          laserDamage: self.laserDamage ?? 12,
        },
        world: result.world,
        snapshot: result.snapshot,
      });
    } catch (err) {
      socket.disconnect();
      setError(err instanceof Error ? err.message : 'Bağlantı hatası');
    } finally {
      setLoading(false);
    }
  }

  if (session) {
    const shieldPct =
      stats.maxShield > 0 ? (stats.shield / stats.maxShield) * 100 : 0;
    const hpPct = stats.maxHp > 0 ? (stats.hp / stats.maxHp) * 100 : 0;

    return (
      <div className="game-shell">
        <div className="hud">
          <div className="hud-panel">
            <div className="label">Pilot</div>
            <div className="value">{stats.name}</div>
            <div className="vital-block">
              <div className="vital-head">
                <span className="vital-label shd">Kalkan</span>
                <span className="vital-nums">
                  {Math.round(stats.shield)} / {Math.round(stats.maxShield)}
                </span>
              </div>
              <div className="shield-bar">
                <span style={{ width: `${shieldPct}%` }} />
              </div>
            </div>
            <div className="vital-block">
              <div className="vital-head">
                <span className="vital-label hp">Can</span>
                <span className="vital-nums">
                  {Math.round(stats.hp)} / {Math.round(stats.maxHp)}
                </span>
              </div>
              <div className="hp-bar">
                <span style={{ width: `${hpPct}%` }} />
              </div>
            </div>
            <div className="meta-line">
              Roket: {stats.rockets} · Cephane: {stats.laserAmmo}
            </div>
          </div>
          <div className="hud-panel hud-mid">
            <div className="label">Hedef</div>
            <div className="value">
              {stats.targetName ?? '—'}
              {stats.firing ? ' · ATEŞ' : ''}
            </div>
            {stats.targetName && (
              <div className={`range-tag ${stats.inRange ? 'in' : 'out'}`}>
                {stats.inRange ? 'Menzilde' : 'Menzil dışı'}
              </div>
            )}
          </div>
          <div className="hud-panel hud-right">
            <div className="label">Gümüş · Altın · Kill</div>
            <div className="value">
              {stats.credits} · {stats.gold} · {stats.kills}
            </div>
          </div>
        </div>

        <button type="button" className="hangar-fab" onClick={() => void openHangar()}>
          HANGAR
        </button>

        <HangarPanel
          open={hangarOpen}
          onClose={() => setHangarOpen(false)}
          socket={session.socket}
          hangar={hangar}
          onHangar={setHangar}
          onCredits={(c) => setStats((s) => ({ ...s, credits: c }))}
          onGold={(g) => setStats((s) => ({ ...s, gold: g }))}
          onToast={hud.onToast}
        />

        {toast && <div className="status-toast">{toast}</div>}
        <PhaserGame
          socket={session.socket}
          selfId={session.self.id}
          world={session.world}
          snapshot={session.snapshot}
          hud={hud}
        />
      </div>
    );
  }

  return (
    <div className="app">
      <div className="lobby-stage">
        <img
          className="lobby-ship"
          src="/assets/ship-player.png"
          alt=""
          draggable={false}
        />
        <img
          className="lobby-enemy"
          src="/assets/ship-npc.png"
          alt=""
          draggable={false}
        />
        <form className="lobby" onSubmit={onSubmit}>
          <h1 className="brand">GOVORBIT</h1>
          <p className="tagline">DarkOrbit tarzı çok oyunculu uzay demosu</p>
          <label htmlFor="pilot">Pilot adı</label>
          <input
            id="pilot"
            maxLength={16}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="örn. Nova"
            autoFocus
            required
          />
          <p className="error">{error}</p>
          <button type="submit" disabled={loading || !name.trim()}>
            {loading ? 'Bağlanıyor...' : 'Fırlat'}
          </button>
          <ul className="hints">
            <li>
              <strong>Sol tık</strong> — boşluğa git · basılı tutunca imleç yönüne
            </li>
            <li>
              <strong>Çift tık</strong> — hedef + lazer · <strong>Ctrl</strong>{' '}
              lazer · <strong>Space</strong> roket
            </li>
            <li>
              <strong>Hangar</strong> — gemi, lazer, cephane, jeneratör
            </li>
          </ul>
        </form>
      </div>
    </div>
  );
}
