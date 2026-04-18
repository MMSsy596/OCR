import { useEffect, useMemo, useRef, useState } from "react";

const TONE_CONFIG = {
  info: { accent: "#0A84FF", label: "Thông tin" },
  success: { accent: "#32D74B", label: "Thành công" },
  warning: { accent: "#FFD60A", label: "Cảnh báo" },
  error: { accent: "#FF453A", label: "Lỗi" },
};

function clampPct(value) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

function scoreActivity(activity) {
  const toneScore = activity?.tone === "error" ? 30 : activity?.tone === "warning" ? 20 : 10;
  const priority = Number(activity?.priority) || 0;
  return toneScore + priority;
}

function ProgressBar({ progress, accent }) {
  const pct = clampPct(progress);
  return (
    <div
      style={{
        height: 7,
        width: "100%",
        borderRadius: 999,
        overflow: "hidden",
        background: "rgba(255,255,255,0.13)",
      }}
    >
      <div
        style={{
          height: "100%",
          width: `${pct}%`,
          borderRadius: 999,
          background: accent,
          transition: "width 220ms linear",
        }}
      />
    </div>
  );
}

function WaitingSpinner({ accent }) {
  return (
    <span
      style={{
        width: 12,
        height: 12,
        borderRadius: "50%",
        border: `2px solid ${accent}33`,
        borderTopColor: accent,
        animation: "islandSpin 800ms linear infinite",
        flexShrink: 0,
      }}
    />
  );
}

function ActivityRow({ activity }) {
  const cfg = TONE_CONFIG[activity?.tone] || TONE_CONFIG.info;
  const pct = activity?.progress === undefined ? null : clampPct(activity.progress);
  const isWaiting = activity?.state === "waiting";
  return (
    <div
      style={{
        padding: "10px 12px",
        borderRadius: 14,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.03)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {isWaiting ? (
          <WaitingSpinner accent={cfg.accent} />
        ) : (
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: cfg.accent,
              boxShadow: `0 0 10px ${cfg.accent}`,
              flexShrink: 0,
            }}
          />
        )}
        <div
          style={{
            color: "#fff",
            fontSize: 13,
            fontWeight: 600,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            flex: 1,
          }}
        >
          {activity.title || cfg.label}
        </div>
        {pct !== null ? (
          <span style={{ color: "rgba(255,255,255,0.68)", fontSize: 12, fontWeight: 600 }}>{Math.round(pct)}%</span>
        ) : null}
      </div>
      {activity.message ? (
        <div style={{ marginTop: 6, color: "rgba(255,255,255,0.65)", fontSize: 12, lineHeight: 1.35 }}>{activity.message}</div>
      ) : null}
      {pct !== null ? (
        <div style={{ marginTop: 9 }}>
          <ProgressBar progress={pct} accent={cfg.accent} />
        </div>
      ) : null}
    </div>
  );
}

function NoticeItem({ notice, onDismiss }) {
  const cfg = TONE_CONFIG[notice?.tone] || TONE_CONFIG.info;
  const [closing, setClosing] = useState(false);
  function dismiss() {
    setClosing(true);
    window.setTimeout(() => onDismiss?.(notice.id), 240);
  }
  return (
    <button
      type="button"
      onClick={dismiss}
      style={{
        width: 360,
        maxWidth: "calc(100vw - 24px)",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 16,
        padding: "11px 12px",
        background: "rgba(18,18,18,0.88)",
        backdropFilter: "blur(18px) saturate(180%)",
        textAlign: "left",
        cursor: "pointer",
        opacity: closing ? 0 : 1,
        transform: closing ? "translateY(-8px) scale(0.98)" : "translateY(0) scale(1)",
        transition: "all 220ms cubic-bezier(0.32, 0.72, 0, 1)",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: cfg.accent,
            marginTop: 6,
            flexShrink: 0,
          }}
        />
        <div style={{ minWidth: 0 }}>
          <div style={{ color: "#fff", fontSize: 13, fontWeight: 600 }}>
            {notice.title || cfg.label}
          </div>
          {notice.message ? (
            <div style={{ color: "rgba(255,255,255,0.67)", fontSize: 12, lineHeight: 1.35, marginTop: 3 }}>
              {notice.message}
            </div>
          ) : null}
        </div>
      </div>
    </button>
  );
}

export function NotificationIsland({ liveActivities, liveActivity, notices, onDismiss }) {
  const [expanded, setExpanded] = useState(false);
  const containerRef = useRef(null);

  const activities = useMemo(() => {
    const source = Array.isArray(liveActivities) && liveActivities.length
      ? liveActivities
      : liveActivity
        ? [liveActivity]
        : [];
    return source
      .filter(Boolean)
      .sort((a, b) => scoreActivity(b) - scoreActivity(a));
  }, [liveActivities, liveActivity]);

  const primary = activities[0] || null;
  const queue = (notices || []).slice(0, 4);
  const hasData = Boolean(primary) || queue.length > 0;

  useEffect(() => {
    if (!primary) {
      setExpanded(false);
    }
  }, [primary]);

  useEffect(() => {
    if (!expanded) return undefined;
    function onDocClick(event) {
      if (!containerRef.current?.contains(event.target)) {
        setExpanded(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [expanded]);

  if (!hasData) return null;

  const cfg = TONE_CONFIG[primary?.tone] || TONE_CONFIG.info;
  const primaryPct = primary?.progress === undefined ? null : clampPct(primary.progress);
  const primaryWaiting = primary?.state === "waiting";

  return (
    <div
      style={{
        position: "fixed",
        top: 12,
        left: 0,
        right: 0,
        zIndex: 10000,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 10,
        pointerEvents: "none",
      }}
    >
      <style>{`
        @keyframes islandSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes islandPop {
          0% { transform: scale(0.95); opacity: 0; }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>
      {primary ? (
        <div ref={containerRef} style={{ pointerEvents: "auto", animation: "islandPop 0.4s cubic-bezier(0.32, 0.72, 0, 1) forwards" }}>
          <button
            type="button"
            onClick={() => activities.length > 0 && setExpanded((v) => !v)}
            style={{
              width: expanded ? 400 : "auto",
              minWidth: expanded ? 400 : 260,
              maxWidth: "calc(100vw - 32px)",
              border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: expanded ? 32 : 999,
              background: "rgba(0,0,0,0.85)",
              backdropFilter: "blur(24px) saturate(200%)",
              boxShadow: "0 16px 40px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.1)",
              padding: expanded ? "16px" : "12px 18px",
              cursor: "pointer",
              transition: "all 0.4s cubic-bezier(0.32, 0.72, 0, 1)",
              textAlign: "left",
              display: "flex",
              flexDirection:expanded ? "column" : "row",
              gap: expanded ? 12 : 10,
              alignItems: expanded ? "stretch" : "center",
              overflow: "hidden"
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {primaryWaiting ? (
                <WaitingSpinner accent={cfg.accent} />
              ) : (
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: cfg.accent,
                    boxShadow: `0 0 12px ${cfg.accent}`,
                    flexShrink: 0,
                  }}
                />
              )}
              <div
                style={{
                  color: "#fff",
                  fontSize: 13,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  flex: 1,
                }}
              >
                {primary.title || cfg.label}
              </div>
              {primaryPct !== null ? (
                <span style={{ color: "rgba(255,255,255,0.65)", fontSize: 12, fontWeight: 700 }}>{Math.round(primaryPct)}%</span>
              ) : null}
              {activities.length > 1 && !expanded ? (
                <div style={{ 
                  background: "rgba(255,255,255,0.15)", 
                  padding: "2px 6px", 
                  borderRadius: 99, 
                  color: "#fff", 
                  fontSize: 11, 
                  fontWeight: 600,
                  flexShrink: 0
                }}>
                  +{activities.length - 1}
                </div>
              ) : null}
            </div>

            {expanded ? (
              <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                {activities.slice(0, 4).map((activity, idx) => (
                  <ActivityRow key={`${activity.title || "activity"}-${idx}`} activity={activity} />
                ))}
              </div>
            ) : null}
          </button>
        </div>
      ) : null}

      <div style={{ display: "grid", gap: 8, pointerEvents: "auto" }}>
        {queue.map((notice) => (
          <NoticeItem key={notice.id} notice={notice} onDismiss={onDismiss} />
        ))}
      </div>
    </div>
  );
}
