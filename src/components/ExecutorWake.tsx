"use client";

import { useEffect, useRef } from "react";

export default function ExecutorWake() {
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    void fetch("/api/executor/wake", { method: "POST", credentials: "omit", keepalive: true })
      .catch(() => undefined);
  }, []);
  return null;
}
