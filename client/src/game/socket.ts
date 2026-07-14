import { io, Socket } from 'socket.io-client';
import type { JoinResult, PlayerInput, Snapshot } from './types';

const URL = import.meta.env.VITE_SOCKET_URL ?? 'http://localhost:3001';

export type GameSocket = Socket;

export function createGameSocket(): GameSocket {
  return io(URL, {
    autoConnect: false,
    transports: ['websocket'],
  });
}

export function joinGame(
  socket: GameSocket,
  name: string,
): Promise<JoinResult> {
  return new Promise((resolve) => {
    socket.emit('join', { name }, (result: JoinResult) => resolve(result));
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
