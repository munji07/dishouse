"use client";
import { useEffect, useState } from "react";
import { io, Socket } from "socket.io-client";

export function useSocket() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const s = io({ withCredentials: true });
    s.on("connect", () => {
      setSocket(s);
      setConnected(true);
    });
    s.on("disconnect", () => setConnected(false));
    return () => {
      s.disconnect();
      setSocket(null);
    };
  }, []);

  return { socket, connected };
}
