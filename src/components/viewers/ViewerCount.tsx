"use client";

import { useEffect, useState } from "react";
import { io } from "socket.io-client";
import { CHAT_SERVER_URL, CHAT_SOCKET_PATH } from "@/config/constants";

export default function ViewerCount() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    const socket = io(`${CHAT_SERVER_URL}/viewers`, {
      path: CHAT_SOCKET_PATH,
    });

    socket.on("viewers:count", (n: number) => setCount(n));

    return () => {
      socket.disconnect();
    };
  }, []);

  if (count === null) return null;

  return (
    <span className="flex items-center gap-1.5 text-xs font-medium text-muted">
      <span className="h-1.5 w-1.5 rounded-full bg-forest" />
      {count} watching now
    </span>
  );
}
