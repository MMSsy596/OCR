import { useCallback, useEffect, useRef, useState } from "react";

/* ── helpers ── */
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function formatTime(sec) {
  if (!sec || isNaN(sec)) return "0:00";
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const hh = Math.floor(m / 60);
  const ss = String(s % 60).padStart(2, "0");
  const mm = String(m % 60).padStart(2, "0");
  return hh > 0 ? `${hh}:${mm}:${ss}` : `${m}:${ss}`;
}

/* ── ROI Overlay (rendered on top of video, pointer-events isolated) ── */
function RoiOverlay({ roi, editMode, onDrawStart, onMoveStart, onResizeStart }) {
  if (!roi) return null;

  const boxStyle = {
    position: "absolute",
    left:   `${roi.x * 100}%`,
    top:    `${roi.y * 100}%`,
    width:  `${roi.w * 100}%`,
    height: `${roi.h * 100}%`,
    border: "2px solid #22c55e",
    background: "rgba(34,197,94,0.10)",
    borderRadius: 3,
    boxSizing: "border-box",
    cursor: editMode ? "move" : "default",
    pointerEvents: editMode ? "auto" : "none",
  };

  const handleStyle = (dir) => ({
    position: "absolute",
    width: 12, height: 12,
    background: "#22c55e",
    border: "2px solid #166534",
    borderRadius: 2,
    cursor: {
      nw: "nwse-resize", ne: "nesw-resize",
      sw: "nesw-resize", se: "nwse-resize",
    }[dir],
    ...(dir.includes("n") ? { top: -6 } : { bottom: -6 }),
    ...(dir.includes("w") ? { left: -6 } : { right: -6 }),
  });

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 10 }}>
      {/* Draw capture layer — only active in draw mode */}
      {editMode && (
        <div
          style={{ position: "absolute", inset: 0, cursor: "crosshair", zIndex: 9 }}
          onMouseDown={onDrawStart}
        />
      )}
      {/* ROI box */}
      <div
        style={{ ...boxStyle, zIndex: 11 }}
        onMouseDown={editMode ? onMoveStart : undefined}
      >
        <span style={{
          position: "absolute", top: -22, left: 0,
          fontSize: 11, fontWeight: 700,
          background: "#86efac", color: "#14532d",
          borderRadius: 5, padding: "2px 6px",
          whiteSpace: "nowrap", userSelect: "none",
        }}>
          Vùng phụ đề
        </span>
        {editMode && ["nw", "ne", "sw", "se"].map((dir) => (
          <div
            key={dir}
            style={handleStyle(dir)}
            onMouseDown={(e) => { e.stopPropagation(); onResizeStart(e, dir); }}
          />
        ))}
      </div>
    </div>
  );
}

/* ── Custom Video Controls ── */
function VideoControls({ videoRef, duration, currentTime, onSeek }) {
  const SEEK_STEPS = [5, 15, 30, 60];

  function handleScrub(e) {
    if (!duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    onSeek(pct * duration);
  }

  function jumpTo(sec) {
    onSeek(clamp(sec, 0, duration || 0));
  }

  const progress = duration ? (currentTime / duration) * 100 : 0;

  return (
    <div style={{
      display: "flex", flexDirection: "column", gap: 8,
      padding: "10px 14px",
      background: "rgba(10,12,20,0.95)",
      borderTop: "1px solid rgba(255,255,255,0.08)",
    }}>
      {/* Scrubber */}
      <div
        style={{
          height: 6, background: "rgba(255,255,255,0.12)",
          borderRadius: 999, cursor: "pointer", position: "relative",
          flexShrink: 0,
        }}
        onClick={handleScrub}
      >
        <div style={{
          position: "absolute", left: 0, top: 0, bottom: 0,
          width: `${progress}%`,
          background: "linear-gradient(90deg, #6366f1, #818cf8)",
          borderRadius: "inherit",
          transition: "width 0.1s linear",
        }} />
        <div style={{
          position: "absolute", top: "50%", transform: "translate(-50%,-50%)",
          left: `${progress}%`,
          width: 12, height: 12,
          background: "#818cf8", borderRadius: "50%",
          boxShadow: "0 0 8px rgba(99,102,241,0.8)",
          pointerEvents: "none",
        }} />
      </div>

      {/* Time + seek buttons */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 12, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums", minWidth: 80 }}>
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
        <div style={{ flex: 1 }} />
        {SEEK_STEPS.map((s) => (
          <button
            key={`-${s}`}
            className="btn btn-ghost btn-sm"
            style={{ padding: "3px 7px", fontSize: 11, color: "var(--text-muted)" }}
            onClick={() => jumpTo(currentTime - s)}
            title={`Tua lùi ${s}s`}
          >
            -{s}s
          </button>
        ))}
        {[...SEEK_STEPS].reverse().map((s) => (
          <button
            key={`+${s}`}
            className="btn btn-ghost btn-sm"
            style={{ padding: "3px 7px", fontSize: 11, color: "var(--text-muted)" }}
            onClick={() => jumpTo(currentTime + s)}
            title={`Tua tới ${s}s`}
          >
            +{s}s
          </button>
        ))}
      </div>

      {/* Percentage quick jump */}
      <div style={{ display: "flex", gap: 4 }}>
        <span style={{ fontSize: 11, color: "var(--text-muted)", alignSelf: "center", marginRight: 4 }}>Nhảy đến:</span>
        {[0, 10, 25, 50, 75, 90, 100].map((pct) => (
          <button
            key={pct}
            className="btn btn-ghost btn-sm"
            style={{ padding: "2px 6px", fontSize: 11, color: "var(--text-muted)" }}
            onClick={() => jumpTo((duration || 0) * pct / 100)}
          >
            {pct}%
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── Main component ── */
export function Step3Region({
  selectedProject,
  videoSrc,
  stageRef,
  roiDraft,
  roiEditMode,
  toggleRoiEditMode,
  beginDraw,
  beginMove,
  beginResize,
  onVideoTimeUpdate,
  savingRoi,
  saveSelectedRoi,
  setRoiDraft,
  hasSavedRoi,
}) {
  const roi = roiDraft;
  const videoRef = useRef(null);
  const [duration, setDuration]       = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying]     = useState(false);

  function resetDefault() {
    setRoiDraft({ x: 0.05, y: 0.78, w: 0.9, h: 0.18 });
  }

  function seekTo(sec) {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = clamp(sec, 0, duration || 0);
  }

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    isPlaying ? v.pause() : v.play();
  }

  /* ── Stage-level draw handler (only when editMode + no drag over ROI box) ── */
  // We pass beginDraw from useRoiEditor which already checks roiEditMode + shiftKey.
  // We override: draw starts when editMode is on and user drags on the crosshair layer (no shiftKey needed here).
  const stageAreaRef = useRef(null);

  // Map stageAreaRef → stageRef (useRoiEditor uses stageRef for coord calc)
  useEffect(() => {
    if (stageAreaRef.current && stageRef) {
      stageRef.current = stageAreaRef.current;
    }
  }, [stageRef]);

  /* Custom beginDraw that does NOT require shiftKey */
  function handleDrawStart(e) {
    if (!roiEditMode) return;
    // Compute relative position inside the overlay div
    const rect = stageAreaRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pt = {
      x: clamp((e.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((e.clientY - rect.top) / rect.height, 0, 1),
    };
    // Mutate a synthetic event to feed into beginDraw
    const synth = { ...e, shiftKey: true, clientX: e.clientX, clientY: e.clientY };
    beginDraw(synth);
  }

  function handleMoveStart(e) {
    if (!roiEditMode) return;
    beginMove(e);
  }

  function handleResizeStart(e, dir) {
    if (!roiEditMode) return;
    beginResize(dir, e);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="step-guide">
        <span className="step-guide-icon">🎯</span>
        <div className="step-guide-text">
          <h3>Bước 3: Khoanh vùng phụ đề</h3>
          <p>
            Dùng thanh tua để xem các vị trí có chữ phụ đề, rồi bật{" "}
            <strong>Vẽ vùng</strong> và kéo để khoanh vùng chính xác.
          </p>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2>🖼️ Trình xem & chọn vùng OCR</h2>
          <div className="row-actions">
            <button className="btn btn-sm btn-secondary" onClick={resetDefault}>
              🔄 Mặc định
            </button>
            <button
              className={`btn btn-sm ${roiEditMode ? "btn-primary" : "btn-secondary"}`}
              onClick={toggleRoiEditMode}
            >
              {roiEditMode ? "✏️ Đang vẽ — bấm để tắt" : "✏️ Vẽ vùng"}
            </button>
          </div>
        </div>

        <div className="card-body" style={{ padding: 0 }}>
          {!selectedProject?.video_path ? (
            <div style={{ textAlign: "center", padding: "40px 0", color: "var(--text-muted)" }}>
              <div style={{ fontSize: 40, marginBottom: 10 }}>🎬</div>
              <div>Chưa có video — quay lại Bước 2 để tải lên</div>
            </div>
          ) : (
            <>
              {/* Video stage */}
              <div
                ref={stageAreaRef}
                style={{
                  position: "relative",
                  aspectRatio: "16/9",
                  width: "100%",
                  background: "#000",
                  overflow: "hidden",
                  cursor: roiEditMode ? "crosshair" : "default",
                }}
              >
                {/* Native video — always interactive (controls=false so we use custom controls) */}
                <video
                  ref={videoRef}
                  src={videoSrc}
                  style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
                  onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
                  onTimeUpdate={(e) => {
                    setCurrentTime(e.currentTarget.currentTime);
                    onVideoTimeUpdate(e);
                  }}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                />

                {/* ROI overlay – pointer-events managed internally */}
                <RoiOverlay
                  roi={roi}
                  editMode={roiEditMode}
                  onDrawStart={handleDrawStart}
                  onMoveStart={handleMoveStart}
                  onResizeStart={handleResizeStart}
                />
              </div>

              {/* Custom video controls */}
              <VideoControls
                videoRef={videoRef}
                duration={duration}
                currentTime={currentTime}
                onSeek={seekTo}
              />

              {/* Info row */}
              <div style={{ padding: "10px 16px", display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
                {/* Play/pause */}
                <button className="btn btn-secondary btn-sm" onClick={togglePlay} style={{ minWidth: 80 }}>
                  {isPlaying ? "⏸ Dừng" : "▶ Phát"}
                </button>

                {/* ROI values */}
                {roi && (
                  <div style={{ display: "flex", gap: 10, fontSize: 12, color: "var(--text-muted)", flexWrap: "wrap" }}>
                    <span>X: <strong>{(roi.x * 100).toFixed(1)}%</strong></span>
                    <span>Y: <strong>{(roi.y * 100).toFixed(1)}%</strong></span>
                    <span>W: <strong>{(roi.w * 100).toFixed(1)}%</strong></span>
                    <span>H: <strong>{(roi.h * 100).toFixed(1)}%</strong></span>
                  </div>
                )}

                {/* Hint */}
                <span style={{ fontSize: 12, color: "var(--text-muted)", marginLeft: "auto" }}>
                  {roiEditMode
                    ? "Kéo để vẽ vùng mới · Kéo khung xanh để di chuyển · Kéo góc để thay đổi kích thước"
                    : "Bật \"Vẽ vùng\" để chỉnh sửa vùng OCR"}
                </span>
              </div>

              {/* Save row */}
              <div style={{ padding: "0 16px 16px", display: "flex", gap: 10, alignItems: "center" }}>
                <button
                  className="btn btn-primary"
                  style={{ flex: 1 }}
                  disabled={!roi || savingRoi}
                  onClick={saveSelectedRoi}
                >
                  {savingRoi ? "⏳ Đang lưu…" : "💾 Lưu vùng OCR"}
                </button>
                {hasSavedRoi && (
                  <span className="badge badge-green" style={{ alignSelf: "center" }}>
                    ✓ Đã lưu
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
