export function Avatar({ seed, label, size = 36 }: { seed: string; label: string; size?: number }) {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const initials =
    label
      .replace(/^0x/i, "")
      .replace(/[^\p{L}\p{N}]/gu, "")
      .slice(0, 2) || "?";
  return (
    <span
      className="peer-avatar"
      aria-hidden="true"
      style={{
        ["--avatar-size" as string]: `${size}px`,
        background: `linear-gradient(135deg, hsl(${hash % 360} 65% 50%), hsl(${(hash + 40) % 360} 65% 38%))`,
      }}
    >
      {initials}
    </span>
  );
}
