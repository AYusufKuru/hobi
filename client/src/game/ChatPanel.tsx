import { FormEvent, useEffect, useRef, useState } from 'react';
import type { GameSocket } from './socket';

export type ChatMessage = {
  id: string;
  playerId: string;
  name: string;
  text: string;
  mapId?: string;
  at: number;
};

type Props = {
  socket: GameSocket;
  selfId: string;
};

const MAX_MESSAGES = 80;

export default function ChatPanel({ socket, selfId }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onChat = (msg: ChatMessage) => {
      setMessages((prev) => [...prev, msg].slice(-MAX_MESSAGES));
    };
    socket.on('chat', onChat);
    return () => {
      socket.off('chat', onChat);
    };
  }, [socket]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  function send(e: FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    setError('');
    socket.emit(
      'chat:send',
      { text: trimmed },
      (res: { ok?: boolean; error?: string }) => {
        if (!res?.ok) {
          setError(res?.error ?? 'Gönderilemedi');
          return;
        }
        setText('');
      },
    );
  }

  return (
    <div className="chat-panel" onMouseDown={(e) => e.stopPropagation()}>
      <div className="chat-head">Sohbet</div>
      <div className="chat-log" ref={listRef}>
        {messages.length === 0 && (
          <div className="chat-empty">Henüz mesaj yok</div>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`chat-line ${m.playerId === selfId ? 'self' : ''}`}
          >
            <span className="chat-name">{m.name}</span>
            <span className="chat-text">{m.text}</span>
          </div>
        ))}
      </div>
      {error && <div className="chat-error">{error}</div>}
      <form className="chat-form" onSubmit={send}>
        <input
          ref={inputRef}
          type="text"
          maxLength={120}
          value={text}
          placeholder="Mesaj yaz..."
          autoComplete="off"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Don't let Phaser/game steal Space/Ctrl while typing
            e.stopPropagation();
          }}
        />
        <button type="submit" disabled={!text.trim()}>
          Gönder
        </button>
      </form>
    </div>
  );
}
