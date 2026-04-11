function toneLabel(tone) {
  if (tone === "error") return "Lỗi";
  if (tone === "success") return "Hoàn tất";
  if (tone === "warning") return "Lưu ý";
  return "Đang xử lý";
}

function formatPercent(progress) {
  if (progress === null || progress === undefined) return "";
  return `${Math.max(0, Math.min(100, Number(progress) || 0))}%`;
}

export function NotificationIsland({
  liveActivity,
  notices,
  onDismiss,
}) {
  const visibleNotices = (notices || []).slice(0, 3);

  if (!liveActivity && visibleNotices.length === 0) return null;

  return (
    <div className="island-stack" aria-live="polite" aria-atomic="false">
      {liveActivity ? (
        <section className={`hyper-island hyper-island-live ${liveActivity.tone || "info"}`}>
          <div className="hyper-island-orb" />
          <div className="hyper-island-body">
            <div className="hyper-island-topline">
              <span className="hyper-island-title">{liveActivity.title}</span>
              <span className="hyper-island-meta">
                {liveActivity.step || toneLabel(liveActivity.tone)}
                {liveActivity.progress !== undefined ? ` • ${formatPercent(liveActivity.progress)}` : ""}
              </span>
            </div>
            <p className="hyper-island-message">{liveActivity.message}</p>
            {liveActivity.progress !== undefined ? (
              <div className="hyper-island-progress">
                <div
                  className="hyper-island-progress-bar"
                  style={{ width: formatPercent(liveActivity.progress) }}
                />
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {visibleNotices.length > 0 ? (
        <div className="hyper-island-feed">
          {visibleNotices.map((notice) => (
            <article key={notice.id} className={`hyper-island hyper-island-feed-item ${notice.tone}`}>
              <div className="hyper-island-body">
                <div className="hyper-island-topline">
                  <span className="hyper-island-title">{notice.title || toneLabel(notice.tone)}</span>
                  <button
                    type="button"
                    className="hyper-island-close"
                    onClick={() => onDismiss?.(notice.id)}
                    aria-label="Đóng thông báo"
                  >
                    ×
                  </button>
                </div>
                <p className="hyper-island-message">{notice.message}</p>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </div>
  );
}
