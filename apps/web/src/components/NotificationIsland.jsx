import { useEffect, useRef, useState } from "react";

/* ─── palette per tone ─── */
const TONE_CONFIG = {
  info:    { accent: "#6366f1", bg: "rgba(99,102,241,0.12)",  border: "rgba(99,102,241,0.35)",  glow: "0 0 14px rgba(99,102,241,0.55)",  label: "Đang xử lý",  orb: "radial-gradient(circle at 35% 35%, #fff, #818cf8 40%, #6366f1)" },
  success: { accent: "#22c55e", bg: "rgba(34,197,94,0.12)",   border: "rgba(34,197,94,0.35)",   glow: "0 0 14px rgba(34,197,94,0.55)",   label: "Hoàn tất",     orb: "radial-gradient(circle at 35% 35%, #fff, #4ade80 40%, #16a34a)" },
  warning: { accent: "#f59e0b", bg: "rgba(245,158,11,0.12)",  border: "rgba(245,158,11,0.35)",  glow: "0 0 14px rgba(245,158,11,0.55)",  label: "Lưu ý",        orb: "radial-gradient(circle at 35% 35%, #fff, #fcd34d 40%, #d97706)" },
  error:   { accent: "#ef4444", bg: "rgba(239,68,68,0.12)",   border: "rgba(239,68,68,0.35)",   glow: "0 0 14px rgba(239,68,68,0.55)",   label: "Lỗi",          orb: "radial-gradient(circle at 35% 35%, #fff, #f87171 40%, #dc2626)" },
};

function clampPct(v) { return Math.max(0, Math.min(100, Number(v) || 0)); }

/* ── Animated progress bar: smooth fill tracking real progress ── */
function ProgressBar({ progress, accent }) {
  const [display, setDisplay] = useState(clampPct(progress));
  const animRef = useRef(null);
  const currentRef = useRef(clampPct(progress));

  useEffect(() => {
    const target = clampPct(progress);
    if (animRef.current) cancelAnimationFrame(animRef.current);
    const step = () => {
      const diff = target - currentRef.current;
      if (Math.abs(diff) < 0.3) {
        currentRef.current = target;
        setDisplay(target);
        return;
      }
      currentRef.current += diff * 0.12;
      setDisplay(Math.round(currentRef.current * 10) / 10);
      animRef.current = requestAnimationFrame(step);
    };
    animRef.current = requestAnimationFrame(step);
    return () => animRef.current && cancelAnimationFrame(animRef.current);
  }, [progress]);

  return (
    <div style={{
      height: 3, borderRadius: 999,
      background: "rgba(255,255,255,0.1)",
      overflow: "hidden", marginTop: 8,
    }}>
      <div style={{
        height: "100%", borderRadius: "inherit",
        background: `linear-gradient(90deg, ${accent}cc, ${accent})`,
        boxShadow: `0 0 8px ${accent}88`,
        width: `${display}%`,
        transition: "width 0.08s linear",
      }} />
    </div>
  );
}

/* ── Live activity pill (collapsible) ── */
function LivePill({ act, onClickExpand }) {
  const cfg = TONE_CONFIG[act.tone] || TONE_CONFIG.info;
  const hasProgress = act.progress !== undefined && act.progress !== null;
  const pct = hasProgress ? clampPct(act.progress) : null;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={false}
      title="Click để xem chi tiết"
      onClick={onClickExpand}
      onKeyDown={(e) => e.key === "Enter" && onClickExpand()}
      style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "6px 14px 6px 10px",
        borderRadius: 999,
        background: cfg.bg,
        border: `1px solid ${cfg.border}`,
        backdropFilter: "blur(16px)",
        cursor: "pointer",
        userSelect: "none",
        maxWidth: 320,
      }}
    >
      {/* orb */}
      <div style={{
        width: 9, height: 9, borderRadius: "50%", flexShrink: 0,
        background: cfg.orb,
        boxShadow: cfg.glow,
        animation: "islandOrbPulse 1.8s ease-in-out infinite",
      }} />
      {/* text */}
      <span style={{ fontSize: 12, fontWeight: 600, color: "#f1f5f9", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 200 }}>
        {act.title}
        {pct !== null ? <span style={{ marginLeft: 6, opacity: 0.65 }}>{pct}%</span> : null}
      </span>
      {/* mini progress arc */}
      {pct !== null && (
        <svg width="18" height="18" style={{ flexShrink: 0 }} viewBox="0 0 18 18">
          <circle cx="9" cy="9" r="7" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="2.5" />
          <circle
            cx="9" cy="9" r="7" fill="none"
            stroke={cfg.accent} strokeWidth="2.5"
            strokeDasharray={`${(pct / 100) * 43.98} 43.98`}
            strokeLinecap="round"
            transform="rotate(-90 9 9)"
            style={{ transition: "stroke-dasharray 0.4s ease" }}
          />
        </svg>
      )}
    </div>
  );
}

/* ── Expanded card ── */
function LiveCard({ act, onClose }) {
  const cfg = TONE_CONFIG[act.tone] || TONE_CONFIG.info;
  const hasProgress = act.progress !== undefined && act.progress !== null;

  return (
    <div style={{
      padding: "14px 16px",
      background: "rgba(13,15,24,0.95)",
      border: `1px solid ${cfg.border}`,
      borderRadius: 16,
      backdropFilter: "blur(20px)",
      boxShadow: `0 8px 40px rgba(0,0,0,0.55), ${cfg.glow}`,
      minWidth: 260, maxWidth: 380,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <div style={{
          width: 10, height: 10, borderRadius: "50%", flexShrink: 0,
          background: cfg.orb,
          boxShadow: cfg.glow,
          animation: "islandOrbPulse 1.8s ease-in-out infinite",
        }} />
        <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: "#f1f5f9" }}>{act.title}</span>
        {hasProgress && (
          <span style={{ fontSize: 12, fontWeight: 600, color: cfg.accent }}>{clampPct(act.progress)}%</span>
        )}
        <button
          onClick={onClose}
          style={{
            width: 22, height: 22, borderRadius: "50%",
            border: "1px solid rgba(255,255,255,0.1)",
            background: "rgba(255,255,255,0.06)",
            color: "#94a3b8", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 13, lineHeight: 1, flexShrink: 0,
          }}
        >×</button>
      </div>
      <p style={{ margin: "0 0 0 20px", fontSize: 12, color: "#94a3b8", lineHeight: 1.55 }}>
        {act.message}
      </p>
      {hasProgress && (
        <div style={{ marginLeft: 20 }}>
          <ProgressBar progress={act.progress} accent={cfg.accent} />
        </div>
      )}
    </div>
  );
}

/* ── Notice item (toast) ── */
function NoticeItem({ notice, onDismiss }) {
  const cfg = TONE_CONFIG[notice.tone] || TONE_CONFIG.info;
  const [out, setOut] = useState(false);

  function dismiss() {
    setOut(true);
    setTimeout(() => onDismiss?.(notice.id), 300);
  }

  return (
    <div
      style={{
        padding: "10px 14px",
        background: "rgba(13,15,24,0.94)",
        border: `1px solid ${cfg.border}`,
        borderLeft: `3px solid ${cfg.accent}`,
        borderRadius: 12,
        backdropFilter: "blur(20px)",
        display: "flex", alignItems: "flex-start", gap: 10,
        maxWidth: 380,
        animation: out ? "islandOut 0.28s ease forwards" : "islandIn 0.22s cubic-bezier(0.34,1.56,0.64,1) forwards",
      }}
    >
      <div style={{
        width: 8, height: 8, borderRadius: "50%", marginTop: 4, flexShrink: 0,
        background: cfg.accent, boxShadow: cfg.glow,
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#f1f5f9", marginBottom: 2 }}>
          {notice.title || cfg.label}
        </div>
        <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.5, wordBreak: "break-word" }}>
          {notice.message}
        </div>
      </div>
      <button
        onClick={dismiss}
        style={{
          width: 20, height: 20, borderRadius: "50%",
          border: "1px solid rgba(255,255,255,0.1)",
          background: "rgba(255,255,255,0.06)",
          color: "#64748b", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 13, lineHeight: 1, flexShrink: 0,
        }}
      >×</button>
    </div>
  );
}

/* ── Main export ── */
export function NotificationIsland({ liveActivity, notices, onDismiss }) {
  const [expanded, setExpanded] = useState(false);
  const [visible, setVisible] = useState(false);
  const [animOut, setAnimOut] = useState(false);
  const prevLive = useRef(null);
  const collapseTimer = useRef(null);
  const overlayRef = useRef(null);

  const visibleNotices = (notices || []).slice(0, 4);

  // Appear / disappear when liveActivity changes
  useEffect(() => {
    if (liveActivity) {
      setAnimOut(false);
      setVisible(true);
      // Auto-collapse pill after 4s if not expanded
      if (expanded) return;
      if (collapseTimer.current) clearTimeout(collapseTimer.current);
    } else if (prevLive.current) {
      // liveActivity just disappeared → animate out
      setAnimOut(true);
      const t = setTimeout(() => { setVisible(false); setExpanded(false); setAnimOut(false); }, 320);
      return () => clearTimeout(t);
    }
    prevLive.current = liveActivity;
  }, [liveActivity]); // eslint-disable-line

  // Click outside to collapse
  useEffect(() => {
    if (!expanded) return;
    function handleClick(e) {
      if (overlayRef.current && !overlayRef.current.contains(e.target)) {
        setExpanded(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [expanded]);

  const hasAnything = (visible && liveActivity) || visibleNotices.length > 0;
  if (!hasAnything) return null;

  return (
    <>
      {/* keyframes injected once */}
      <style>{`
        @keyframes islandIn {
          from { opacity: 0; transform: translateY(-10px) scale(0.94); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes islandOut {
          from { opacity: 1; transform: translateY(0) scale(1); }
          to   { opacity: 0; transform: translateY(-8px) scale(0.94); }
        }
        @keyframes islandOrbPulse {
          0%,100% { transform: scale(1);   opacity: 0.85; }
          50%      { transform: scale(1.25); opacity: 1; }
        }
        @keyframes pillIn {
          from { opacity: 0; transform: translateY(-8px) scale(0.9); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes pillOut {
          from { opacity: 1; transform: scale(1); }
          to   { opacity: 0; transform: scale(0.88); }
        }
      `}</style>

      <div
        style={{
          position: "fixed",
          top: 16, left: "50%", transform: "translateX(-50%)",
          zIndex: 200,
          display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
          pointerEvents: "none",
        }}
        aria-live="polite" aria-atomic="false"
      >
        {/* Live activity */}
        {visible && liveActivity && (
          <div
            ref={overlayRef}
            style={{
              pointerEvents: "auto",
              animation: animOut ? "pillOut 0.3s ease forwards" : "pillIn 0.25s cubic-bezier(0.34,1.56,0.64,1) forwards",
            }}
          >
            {expanded ? (
              <LiveCard act={liveActivity} onClose={() => setExpanded(false)} />
            ) : (
              <LivePill act={liveActivity} onClickExpand={() => setExpanded(true)} />
            )}
          </div>
        )}

        {/* Toast notices */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, pointerEvents: "auto", alignItems: "center" }}>
          {visibleNotices.map((n) => (
            <NoticeItem key={n.id} notice={n} onDismiss={onDismiss} />
          ))}
        </div>
      </div>
    </>
  );
}
