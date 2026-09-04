"use client";
import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";

export function useSocket() {
  const ref = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const s = io({ withCredentials: true });
    ref.current = s;
    s.on("connect", () => setConnected(true));
    s.on("disconnect", () => setConnected(false));
    return () => { s.disconnect(); };
  }, []);

  return { socket: ref.current, connected };
}
