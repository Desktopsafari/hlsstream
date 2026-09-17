"use client";

import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { CHAT_SERVER_URL, CHAT_SOCKET_PATH } from "@/config/constants";
import { getDisplayName, getSessionId, setDisplayName } from "@/lib/session";

type ChatMessage = {
  id: string;
  display_name: string;
  message: string;
  created_at: string;
};

export default function ChatPanel() {
  const [name, setName] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [banned, setBanned] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setName(getDisplayName());
  }, []);

  useEffect(() => {
    if (!name) return;

    const socket = io(CHAT_SERVER_URL, {
      path: CHAT_SOCKET_PATH,
      auth: { sessionId: getSessionId(), displayName: name },
    });
    socketRef.current = socket;

    socket.on("chat:history", (history: ChatMessage[]) => {
      setMessages(history);
    });

    socket.on("chat:message", (msg: ChatMessage) => {
      setMessages((prev) => [...prev, msg]);
    });

    socket.on("chat:error", (msg: string) => {
      setError(msg);
      setTimeout(() => setError(null), 4000);
    });

    socket.on("chat:banned", () => {
      setBanned(true);
      socket.disconnect();
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [name]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  function submitName(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = nameInput.trim();
    if (trimmed.length === 0) return;
    setDisplayName(trimmed);
    setName(trimmed);
  }

  function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = draft.trim();
    if (trimmed.length === 0 || !socketRef.current) return;
    socketRef.current.emit("chat:message", trimmed);
    setDraft("");
  }

  if (!name) {
    return (
      <form onSubmit={submitName} className="flex flex-1 flex-col justify-center gap-3">
        <p className="text-sm text-muted">
          Pick a display name to join the chat.
        </p>
        <input
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          maxLength={24}
          placeholder="Display name"
          className="rounded-md border border-moss bg-parchment px-3 py-2 text-sm text-ink outline-none focus:border-forest"
        />
        <button
          type="submit"
          className="rounded-md bg-forest px-3 py-2 text-sm font-semibold text-parchment hover:bg-forest-dark"
        >
          Join chat
        </button>
      </form>
    );
  }

  if (banned) {
    return (
      <div className="flex flex-1 items-center justify-center text-center text-sm text-muted">
        You&apos;ve been removed from chat.
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-3">
      <div
        ref={scrollRef}
        className="flex flex-1 flex-col gap-2 overflow-y-auto"
        style={{ maxHeight: 360 }}
      >
        {messages.map((m) => (
          <div key={m.id} className="text-sm">
            <span className="font-semibold text-forest">{m.display_name}: </span>
            <span className="text-ink">{m.message}</span>
          </div>
        ))}
        {messages.length === 0 && (
          <p className="text-sm text-muted">No messages yet — say hello.</p>
        )}
      </div>

      {error && <p className="text-xs text-amber">{error}</p>}

      <form onSubmit={sendMessage} className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={500}
          placeholder="Say something…"
          className="flex-1 rounded-md border border-moss bg-parchment px-3 py-2 text-sm text-ink outline-none focus:border-forest"
        />
        <button
          type="submit"
          className="rounded-md bg-forest px-3 py-2 text-sm font-semibold text-parchment hover:bg-forest-dark"
        >
          Send
        </button>
      </form>
    </div>
  );
}
