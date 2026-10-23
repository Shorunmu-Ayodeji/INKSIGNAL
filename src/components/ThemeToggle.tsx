import { useEffect, useState } from "react";

type Mode = "light" | "dark" | "system";

const KEY = "inksignal:theme";
const MODES: Mode[] = ["light", "system", "dark"];
const LABELS: Record<Mode, string> = { light: "Light", system: "Auto", dark: "Dark" };
const ICONS: Record<Mode, string> = { light: "☀", system: "◐", dark: "☾" };

function storedMode(): Mode {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function apply(mode: Mode) {
  const dark =
    mode === "dark" || (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

apply(storedMode());

export function ThemeToggle() {
  const [mode, setMode] = useState<Mode>(storedMode);

  useEffect(() => {
    apply(mode);
    if (mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [mode]);

  function choose(next: Mode) {
    setMode(next);
    try {
      if (next === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {
      /* storage unavailable */
    }
  }

  return (
    <div className="theme-toggle" role="group" aria-label="Colour theme">
      {MODES.map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={mode === m}
          aria-label={LABELS[m]}
          title={LABELS[m]}
          onClick={() => choose(m)}
        >
          <span aria-hidden="true" className="theme-toggle__icon">
            {ICONS[m]}
          </span>
          <span className="theme-toggle__label">{LABELS[m]}</span>
        </button>
      ))}
    </div>
  );
}
