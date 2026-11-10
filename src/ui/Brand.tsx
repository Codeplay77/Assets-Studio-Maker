/** Shared identity for the window chrome and welcome screen. */
export function Brand({ symbolOnly = false }: { symbolOnly?: boolean }) {
  return (
    <div className="brand" role="img" aria-label="Assets Studio Maker">
      <img src="/brand/asset-studio-symbol-256.png" alt="" className="brand-symbol" draggable={false} />
      {!symbolOnly && (
        <span className="brand-wordmark">
          <strong>Assets<span>Studio</span></strong>
          <small>MAKER</small>
        </span>
      )}
    </div>
  );
}
