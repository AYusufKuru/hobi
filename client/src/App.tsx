import { FormEvent, useMemo, useState } from 'react';
import ChatPanel from './game/ChatPanel';
import HangarPanel, { type HangarState } from './game/HangarPanel';
import PhaserGame from './game/PhaserGame';
import {
  createGameSocket,
  joinGame,
  registerAccount,
  type GameSocket,
} from './game/socket';
import type { PlayerPublic, Snapshot, WorldConfig } from './game/types';

type AuthMode = 'login' | 'register';

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
  mapName: string;
  targetName: string | null;
  firing: boolean;
  rockets: number;
  laserAmmo: number;
  inRange: boolean;
};

export default function App() {
  const [mode, setMode] = useState<AuthMode>('login');
  const [name, setName] = useState(() => localStorage.getItem('govorbit-name') ?? '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
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
    mapName: '1-1',
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

  async function connectSocket(): Promise<GameSocket> {
    const socket = createGameSocket();
    socket.connect();
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
    return socket;
  }

  async function enterGame(socket: GameSocket, pilotName: string, pass: string) {
    const result = await joinGame(socket, pilotName, pass);
    if (!result.ok || !result.self || !result.world) {
      socket.disconnect();
      setError(result.error ?? 'Giriş başarısız');
      return;
    }

    localStorage.setItem('govorbit-name', pilotName.trim());
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
      mapName: result.snapshot?.mapName ?? '1-1',
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
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (mode === 'register') {
        if (password !== password2) {
          setError('Şifreler eşleşmiyor');
          return;
        }
        const socket = await connectSocket();
        const reg = await registerAccount(socket, email, name, password);
        if (!reg.ok) {
          socket.disconnect();
          setError(reg.error ?? 'Kayıt başarısız');
          return;
        }
        await enterGame(socket, reg.name ?? name, password);
        return;
      }

      const socket = await connectSocket();
      await enterGame(socket, name, password);
    } catch (err) {
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
            <div className="label">Pilot · Harita</div>
            <div className="value">
              {stats.name} · {stats.mapName}
            </div>
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

        <ChatPanel socket={session.socket} selfId={session.self.id} />

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

          <div className="auth-tabs" role="tablist">
            <button
              type="button"
              className={mode === 'login' ? 'active' : ''}
              onClick={() => {
                setMode('login');
                setError('');
              }}
            >
              Giriş
            </button>
            <button
              type="button"
              className={mode === 'register' ? 'active' : ''}
              onClick={() => {
                setMode('register');
                setError('');
              }}
            >
              Kayıt ol
            </button>
          </div>

          {mode === 'register' && (
            <>
              <label htmlFor="email">E-posta</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ornek@mail.com"
                required
              />
            </>
          )}

          <label htmlFor="pilot">Pilot adı</label>
          <input
            id="pilot"
            maxLength={16}
            autoComplete="username"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="örn. Nova"
            autoFocus
            required
          />

          <label htmlFor="password">Şifre</label>
          <input
            id="password"
            type="password"
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === 'register' ? 'en az 6 karakter' : '••••••'}
            minLength={mode === 'register' ? 6 : 1}
            required
          />

          {mode === 'register' && (
            <>
              <label htmlFor="password2">Şifre tekrar</label>
              <input
                id="password2"
                type="password"
                autoComplete="new-password"
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                placeholder="şifreyi tekrar yaz"
                minLength={6}
                required
              />
            </>
          )}

          <p className="error">{error}</p>
          <button
            type="submit"
            disabled={
              loading ||
              !name.trim() ||
              !password ||
              (mode === 'register' && (!email.trim() || !password2))
            }
          >
            {loading
              ? mode === 'register'
                ? 'Kaydediliyor...'
                : 'Giriş yapılıyor...'
              : mode === 'register'
                ? 'Kayıt ol ve fırlat'
                : 'Giriş yap'}
          </button>
          <ul className="hints">
            <li>
              Üyelikte <strong>gümüş, altın, hangar</strong> ve ekipman kaydolur
            </li>
            <li>
              <strong>Sol tık</strong> git · <strong>Ctrl</strong> lazer ·{' '}
              <strong>Space</strong> roket
            </li>
          </ul>
        </form>
      </div>
    </div>
  );
}
