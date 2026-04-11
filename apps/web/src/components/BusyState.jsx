export function BusyInline({ active, label }) {
  if (!active || !label) return null;
  return (
    <div className="busy-inline" role="status" aria-live="polite">
      <span className="busy-inline-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function BusyBanner({ items }) {
  const activeItems = (items || []).filter(Boolean);
  if (!activeItems.length) return null;

  return (
    <section className="busy-banner card" role="status" aria-live="polite">
      <div className="busy-banner-head">
        <span className="busy-banner-pulse" aria-hidden="true" />
        <strong>Ứng dụng đang thực thi</strong>
      </div>
      <div className="busy-banner-list">
        {activeItems.map((item) => (
          <div key={item.id} className="busy-banner-item">
            <span className="busy-banner-dot" aria-hidden="true" />
            <span>{item.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
