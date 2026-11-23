"use client";
import { useEffect, useState } from "react";
import styles from "../../app/docs/docs.module.css";
export default function CodeBlock({ code, label, useOrigin = false }: { code: string; label: string; useOrigin?: boolean }) {
  const [origin, setOrigin] = useState("https://YOUR_APP_ORIGIN");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (useOrigin) setOrigin(window.location.origin); }, [useOrigin]);
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(false), 1800); return () => clearTimeout(timer); }, [copied]);
  const text = useOrigin ? code.replaceAll("https://YOUR_APP_ORIGIN", origin) : code;
  async function copy() {
    try { const copyText = useOrigin ? code.replaceAll("https://YOUR_APP_ORIGIN", window.location.origin) : code; await navigator.clipboard.writeText(copyText); setCopied(true); setError(""); }
    catch { setError("Select the code below and copy it manually."); }
  }
  return <div className={styles.codeBlock}>
    <div className={styles.codeBar}><span>{label}</span><button onClick={() => void copy()} aria-label={`Copy ${label}`}>{copied ? "Copied" : "Copy"}</button></div>
    <pre tabIndex={0}><code>{text}</code></pre>
    <span className={styles.copyStatus} role="status">{copied ? "Code copied." : error}</span>
  </div>;
}
