import { useEffect, useState } from "react";

// Shows seconds remaining until `expiresAt`, and fires onExpire once at zero.
export default function Countdown({ expiresAt, onExpire }) {
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000))
  );

  useEffect(() => {
    const tick = () => {
      const secs = Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000));
      setRemaining(secs);
      if (secs <= 0) {
        clearInterval(id);
        onExpire?.();
      }
    };
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [expiresAt, onExpire]);

  const pct = Math.min(100, (remaining / 60) * 100);

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-slate-400">
        <span>Reserved — complete your purchase</span>
        <span className="font-mono font-semibold text-amber-400">{remaining}s</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-700">
        <div
          className="h-full bg-amber-400 transition-all duration-200"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
