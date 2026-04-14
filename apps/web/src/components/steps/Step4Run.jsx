import { useState } from "react";

const PRESET_LABELS = {
  historical:    "Phim cổ trang",
  modern_short:  "Phim hiện đại",
  fantasy:       "Huyền huyễn",
  cultivation:   "Tu tiên",
  reincarnation: "Chuyển sinh",
  review:        "Review phim",
};

function formatEventTime(isoText) {
  if (!isoText) return "--:--";
  const d = new Date(isoText);
  return isNaN(d) ? "--:--" : d.toLocaleTimeString("vi-VN", { hour12: false });
}

export function Step4Run({
  selectedProject,
  hasSavedRoi,
  loading,
  startPipeline,
  latestPipelineJob,
  latestJobEvents,
  latestJobStats,
  pipelineForm,
  setPipelineForm,
  translationPreset,
  setTranslationPreset,
  streamState,
  retryingStuckJobs,
  retryStuckJobs,
  runtimeCapabilities,
}) {
  const [showLog, setShowLog] = useState(false);
  const status = latestPipelineJob?.status;
  const progress = latestPipelineJob?.progress ?? 0;
  const isRunning = status === "running";
  const isQueued  = status === "queued";
  const isDone    = status === "done";
  const isFailed  = status === "failed";


  const statusColor = isDone ? "var(--success)" : isFailed ? "var(--danger)" : "var(--accent-2)";
  const statusIcon  = isDone ? "✅" : isFailed ? "❌" : isRunning ? "⚙️" : isQueued ? "⏳" : "🚀";

  const canStart = selectedProject && hasSavedRoi && !isRunning && !isQueued;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 800, margin: "0 auto", width: "100%" }}>
      <div className="step-guide">
        <span className="step-guide-icon">⚙️</span>
        <div className="step-guide-text">
          <h3>Bước 4: Chạy xử lý</h3>
          <p>Nhấn nút "Bắt đầu" để hệ thống tự động OCR, dịch và tạo phụ đề. Bạn có thể theo dõi tiến trình bên dưới.</p>
        </div>
      </div>

      {/* Main action card */}
      <div className="card">
        <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Status banner */}
          {latestPipelineJob && (
            <div style={{
              padding: "12px 16px",
              borderRadius: "var(--radius-md)",
              background: isDone ? "var(--success-muted)" : isFailed ? "var(--danger-muted)" : "var(--accent-muted)",
              border: `1px solid ${isDone ? "rgba(34,197,94,0.25)" : isFailed ? "rgba(239,68,68,0.25)" : "rgba(99,102,241,0.25)"}`,
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}>
              <span style={{ fontSize: 22 }}>{statusIcon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: statusColor }}>
                  {isDone ? "Hoàn tất" : isFailed ? "Thất bại" : isRunning ? "Đang xử lý…" : isQueued ? "Đang chờ worker…" : "Sẵn sàng"}
                </div>
                {latestJobEvents?.[0]?.message && (
                  <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 3 }}>
                    {latestJobEvents[0].message}
                  </div>
                )}
              </div>
              <span style={{ fontSize: 13, fontWeight: 700, color: statusColor }}>{progress}%</span>
            </div>
          )}

          {/* Progress bar */}
          {(isRunning || isQueued) && (
            <div>
              <div className="progress-label">
                <span>{isQueued ? "Chờ worker nhận…" : "Đang xử lý…"}</span>
                <span>{progress}%</span>
              </div>
              <div className="progress-wrap">
                <div
                  className={`progress-bar${isQueued ? " indeterminate" : ""}`}
                  style={{ width: isQueued ? undefined : `${Math.max(progress, 2)}%` }}
                />
              </div>
            </div>
          )}

          {/* Stats realtime */}
          {latestJobStats?.ocr_live && (
            <div style={{ display: "flex", gap: 16, fontSize: 12, color: "var(--text-secondary)" }}>
              <span>🖼️ Frames: {latestJobStats.ocr_live.frames_sampled ?? 0}/{latestJobStats.ocr_live.estimated_samples ?? "?"}</span>
              <span>📊 OCR: {Number(latestJobStats.ocr_live.progress_pct || 0).toFixed(1)}%</span>
            </div>
          )}

          {/* Start button */}
          <button
            className="btn btn-primary btn-lg"
            style={{ width: "100%" }}
            onClick={startPipeline}
            disabled={!canStart || loading}
          >
            {loading    ? "⏳ Đang khởi tạo…"  :
             isRunning  ? "⚙️ Đang chạy…"       :
             isQueued   ? "⏳ Đang xếp hàng…"   :
             isDone     ? "🔄 Chạy lại"         :
                          "🚀 Bắt đầu xử lý"}
          </button>

          {!hasSavedRoi && (
            <div className="hint-text" style={{ textAlign: "center", color: "var(--warning)" }}>
              ⚠️ Chưa lưu vùng OCR — quay lại Bước 3
            </div>
          )}

          {/* Log toggle */}
          {latestJobEvents?.length > 0 && (
            <button
              className="btn btn-ghost btn-sm"
              style={{ alignSelf: "flex-start" }}
              onClick={() => setShowLog((v) => !v)}
            >
              {showLog ? "▲ Ẩn nhật ký" : "▼ Xem nhật ký xử lý"}
            </button>
          )}

          {showLog && latestJobEvents?.length > 0 && (
            <div className="live-log">
              {[...latestJobEvents].slice(0, 25).map((ev, i) => (
                <div
                  key={`${ev.time}-${i}`}
                  className={`log-line${ev.level === "warning" ? " warn" : ev.level === "error" ? " error" : ev.level === "success" || ev.phase === "done" ? " ok" : ""}`}
                >
                  <span className="log-time">[{formatEventTime(ev.time)}]</span>
                  <span>[{ev.phase}] {ev.message}</span>
                  {ev.progress != null && <span style={{ marginLeft: "auto", color: "var(--text-muted)" }}>{ev.progress}%</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Advanced options */}
      <details className="accordion">
        <summary>⚙️ Tuỳ chọn nâng cao</summary>
        <div className="accordion-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="form-row">
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Khoảng quét OCR (giây)</label>
              <input
                type="number" step="0.1" min="0.1" max="10"
                value={pipelineForm.scan_interval_sec}
                onChange={(e) => setPipelineForm((p) => ({ ...p, scan_interval_sec: Number(e.target.value) }))}
              />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Phong cách dịch</label>
              <select value={translationPreset} onChange={(e) => setTranslationPreset(e.target.value)}>
                {Object.entries(PRESET_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Gemini API Key (tuỳ chọn)</label>
              <input
                type="password"
                value={pipelineForm.gemini_api_key}
                onChange={(e) => setPipelineForm((p) => ({ ...p, gemini_api_key: e.target.value }))}
                placeholder="Để trống dùng key mặc định"
              />
            </div>
          </div>
          <button
            className="btn btn-secondary btn-sm"
            disabled={retryingStuckJobs}
            onClick={retryStuckJobs}
            style={{ alignSelf: "flex-start" }}
          >
            {retryingStuckJobs ? "Đang thử lại…" : "🔁 Thử lại job bị kẹt"}
          </button>
        </div>
      </details>
    </div>
  );
}
