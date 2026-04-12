import { useEffect, useRef, useState } from "react";

/* ─── palette per tone (HyperOS / iOS style) ─── */
const TONE_CONFIG = {
  info:    { accent: "#0A84FF", bg: "rgba(0, 0, 0, 1)", border: "rgba(255,255,255,0.1)", label: "Information", orb: "#0A84FF" },
  success: { accent: "#32D74B", bg: "rgba(0, 0, 0, 1)", border: "rgba(255,255,255,0.1)", label: "Success",     orb: "#32D74B" },
  warning: { accent: "#FFD60A", bg: "rgba(0, 0, 0, 1)", border: "rgba(255,255,255,0.1)", label: "Warning",     orb: "#FFD60A" },
  error:   { accent: "#FF453A", bg: "rgba(0, 0, 0, 1)", border: "rgba(255,255,255,0.1)", label: "Error",       orb: "#FF453A" },
};

function clampPct(v) { return Math.max(0, Math.min(100, Number(v) || 0)); }

/* ── Dynamic Island Smooth Progress Bar ── */
function IslandProgressBar({ progress, accent }) {
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
      height: 6, borderRadius: 999,
      background: "rgba(255,255,255,0.15)",
      overflow: "hidden", marginTop: 12,
      boxShadow: "inset 0 1px 2px rgba(0,0,0,0.5)"
    }}>
      <div style={{
        height: "100%", borderRadius: "inherit",
        background: accent,
        width: `${display}%`,
        transition: "width 0.1s linear",
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
      onClick={onClickExpand}
      onKeyDown={(e) => e.key === "Enter" && onClickExpand()}
      style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "8px 16px 8px 12px",
        borderRadius: 999,
        background: "#000",
        border: `1px solid rgba(255,255,255,0.08)`,
        boxShadow: "0 10px 30px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.1)",
        cursor: "pointer",
        userSelect: "none",
        maxWidth: 340,
        height: 40,
        transition: "all 0.4s cubic-bezier(0.32, 0.72, 0, 1)",
      }}
    >
      {/* Waveform / Orb */}
      <div style={{
        width: 16, height: 16, flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "center", gap: 2
      }}>
        <div style={{ width: 3, height: "60%", background: cfg.accent, borderRadius: 2, animation: "wave 1.2s ease-in-out infinite" }} />
        <div style={{ width: 3, height: "100%", background: cfg.accent, borderRadius: 2, animation: "wave 1.2s ease-in-out infinite 0.2s" }} />
        <div style={{ width: 3, height: "80%", background: cfg.accent, borderRadius: 2, animation: "wave 1.2s ease-in-out infinite 0.4s" }} />
      </div>
      
      {/* text */}
      <span style={{ fontSize: 13, fontWeight: 500, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", letterSpacing: "-0.01em" }}>
        {act.title}
        {pct !== null ? <span style={{ marginLeft: 8, opacity: 0.5 }}>{pct}%</span> : null}
      </span>
    </div>
  );
}

/* ── Expanded Action Card (Dynamic Island Expanded) ── */
function LiveCard({ act, onClose }) {
  const cfg = TONE_CONFIG[act.tone] || TONE_CONFIG.info;
  const hasProgress = act.progress !== undefined && act.progress !== null;

  return (
    <div style={{
      padding: "20px 24px",
      background: "#000",
      border: `1px solid rgba(255,255,255,0.08)`,
      borderRadius: 36,
      boxShadow: "0 20px 50px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.1)",
      minWidth: 340, maxWidth: 420,
      transition: "all 0.5s cubic-bezier(0.32, 0.72, 0, 1)",
      overflow: "hidden"
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 40, height: 40, borderRadius: "50%", flexShrink: 0,
            background: `rgba(${parseInt(cfg.accent.slice(1,3),16)}, ${parseInt(cfg.accent.slice(3,5),16)}, ${parseInt(cfg.accent.slice(5,7),16)}, 0.15)`,
            display: "flex", alignItems: "center", justifyContent: "center"
          }}>
             <div style={{ width: 14, height: 14, borderRadius: "50%", background: cfg.accent, boxShadow: `0 0 12px ${cfg.accent}` }} />
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#fff", letterSpacing: "-0.01em" }}>{act.title}</div>
            <div style={{ fontSize: 13, color: "rgba(235, 235, 245, 0.6)", marginTop: 2 }}>{act.message}</div>
          </div>
        </div>
      </div>

      {hasProgress && (
        <IslandProgressBar progress={act.progress} accent={cfg.accent} />
      )}
    </div>
  );
}

/* ── Notice item (toast wrapper) ── */
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
        padding: "14px 18px",
        background: "rgba(28, 28, 30, 0.75)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 20,
        backdropFilter: "blur(24px) saturate(200%)",
        display: "flex", alignItems: "center", gap: 14,
        width: 340,
        boxShadow: "0 10px 40px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.1)",
        animation: out ? "islandOut 0.3s cubic-bezier(0.32, 0.72, 0, 1) forwards" : "islandIn 0.5s cubic-bezier(0.32, 0.72, 0, 1) forwards",
        cursor: "pointer"
      }}
      onClick={dismiss}
    >
      <div style={{
        width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
        background: `rgba(${parseInt(cfg.accent.slice(1,3),16)}, ${parseInt(cfg.accent.slice(3,5),16)}, ${parseInt(cfg.accent.slice(5,7),16)}, 0.15)`,
        display: "flex", alignItems: "center", justifyContent: "center"
      }}>
         <div style={{ width: 12, height: 12, borderRadius: "50%", background: cfg.accent }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "#fff", marginBottom: 2, letterSpacing: "-0.01em" }}>
          {notice.title || cfg.label}
        </div>
        {notice.message && (
          <div style={{ fontSize: 13, color: "rgba(235, 235, 245, 0.6)", lineHeight: 1.4, wordBreak: "break-word" }}>
            {notice.message}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Main export ── */
export function NotificationIsland({ liveActivity, notices, onDismiss }) {
  const [expanded, setExpanded] = useState(false);
  const [visible, setVisible] = useState(false);
  const [animOut, setAnimOut] = useState(false);
  const prevLive = useRef(null);
  const overlayRef = useRef(null);

  const visibleNotices = (notices || []).slice(0, 3);

  useEffect(() => {
    if (liveActivity) {
      setAnimOut(false);
      setVisible(true);
      if (expanded) return;
    } else if (prevLive.current) {
      setAnimOut(true);
      const t = setTimeout(() => { setVisible(false); setExpanded(false); setAnimOut(false); }, 400);
      return () => clearTimeout(t);
    }
    prevLive.current = liveActivity;
  }, [liveActivity, expanded]);

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
      <style>{`
        @keyframes islandIn {
          from { opacity: 0; transform: translateY(-20px) scale(0.9); filter: blur(5px); }
          to   { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
        }
        @keyframes islandOut {
          from { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
          to   { opacity: 0; transform: translateY(-15px) scale(0.9); filter: blur(4px); }
        }
        @keyframes pillExpand {
          from { opacity: 0; transform: scale(0.95); border-radius: 999px; }
          to   { opacity: 1; transform: scale(1); border-radius: 36px; }
        }
        @keyframes wave {
          0%, 100% { height: 40%; }
          50% { height: 100%; }
        }
      `}</style>

      <div
        style={{
          position: "fixed",
          top: 16, left: 0, right: 0,
          zIndex: 9999,
          display: "flex", flexDirection: "column", alignItems: "center", gap: 12,
          pointerEvents: "none",
        }}
      >
        {visible && liveActivity && (
          <div
            ref={overlayRef}
            style={{
              pointerEvents: "auto",
              transformOrigin: "top center",
              animation: animOut ? "islandOut 0.4s cubic-bezier(0.32, 0.72, 0, 1) forwards" : "islandIn 0.5s cubic-bezier(0.32, 0.72, 0, 1) forwards",
            }}
          >
            {expanded ? (
              <LiveCard act={liveActivity} onClose={() => setExpanded(false)} />
            ) : (
              <LivePill act={liveActivity} onClickExpand={() => setExpanded(true)} />
            )}
          </div>
        )}

        {/* Toast notices queue */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, pointerEvents: "auto", alignItems: "center" }}>
          {visibleNotices.map((n) => (
            <NoticeItem key={n.id} notice={n} onDismiss={onDismiss} />
          ))}
        </div>
      </div>
    </>
  );
}
