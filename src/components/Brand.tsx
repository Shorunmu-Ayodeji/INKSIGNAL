export function Brand({ inverse = false }: { inverse?: boolean }) {
  return (
    <div className={`brand${inverse ? " brand--inverse" : ""}`}>
      <span className="ink-mark" role="img" aria-label="Ink" />
      <div className="brand__text">
        <span className="brand__name">INKSIGNAL</span>
      </div>
    </div>
  );
}
