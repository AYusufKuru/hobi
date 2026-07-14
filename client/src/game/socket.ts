import { io, Socket } from 'socket.io-client';
import type { JoinResult, PlayerInput, Snapshot } from './types';

const URL = import.meta.env.VITE_SOCKET_URL ?? 'http://localhost:3001';

export type GameSocket = Socket;

export type AuthResult = { ok: boolean; error?: string; name?: string };

export function createGameSocket(): GameSocket {
  return io(URL, {
    autoConnect: false,
    transports: ['websocket'],
  });
}

export function registerAccount(
  socket: GameSocket,
  email: string,
  name: string,
  password: string,
): Promise<AuthResult> {
  return new Promise((resolve) => {
    socket.emit(
      'auth:register',
      { email, name, password },
      (result: AuthResult) => resolve(result),
    );
  });
}

export function joinGame(
  socket: GameSocket,
  name: string,
  password: string,
): Promise<JoinResult> {
  return new Promise((resolve) => {
    socket.emit(
      'join',
      { name, password },
      (result: JoinResult) => resolve(result),
    );
  });
}

export function sendInput(socket: GameSocket, input: PlayerInput) {
  socket.emit('input', input);
}

export function onSnapshot(
  socket: GameSocket,
  handler: (snapshot: Snapshot) => void,
) {
  socket.on('snapshot', handler);
  return () => {
    socket.off('snapshot', handler);
  };
}
