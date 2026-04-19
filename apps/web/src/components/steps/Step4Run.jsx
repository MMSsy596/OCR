import { useState, useEffect, useCallback } from "react";
import { withApiAuth, readApiErrorMessage } from "../../lib/api";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8000";

async function apiFetch(url, options = {}) {
  const res = await fetch(url, withApiAuth(options));
  if (!res.ok) throw new Error(await readApiErrorMessage(res, `HTTP ${res.status}`));
  return res.json();
}

function DraggableKeyList({ isLocked }) {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(false);
  const [draggedIdx, setDraggedIdx] = useState(null);

  const loadKeys = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch(`${API_BASE}/admin/gemini-keys`);
      setKeys(data.keys || []);
    } catch (err) {
      console.warn("load keys error", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadKeys();
  }, [loadKeys]);

  async function handleDrop(targetIdx) {
    if (draggedIdx === null || draggedIdx === targetIdx) {
      setDraggedIdx(null);
      return;
    }
    const newKeys = [...keys];
    const [moved] = newKeys.splice(draggedIdx, 1);
    newKeys.splice(targetIdx, 0, moved);
    setKeys(newKeys);
    setDraggedIdx(null);

    try {
      // Vì thứ tự trong DB là dựa vào API /admin/gemini-keys/reorder
      const indices = newKeys.map(k => k.index);
      const res = await apiFetch(`${API_BASE}/admin/gemini-keys/reorder`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ new_order_indices: indices })
      });
      setKeys(res.keys || []);
    } catch (err) {
      console.warn("reorder error", err);
      loadKeys(); // Revert on failure
    }
  }

  if (keys.length === 0 && !loading) return (
    <div style={{ fontSize: 12, color: "var(--text-muted)", padding: 8, background: "var(--bg-elevated)", borderRadius: 6 }}>
      Chưa có API Key nào được cài đặt.
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
      <label style={{ fontSize: 13, fontWeight: 600 }}>Thứ tự API Keys (kéo thả để ưu tiên fallback)</label>
      {loading && keys.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Đang tải keys...</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {keys.map((k, idx) => (
            <div
              key={k.key_masked + "_" + k.index}
              draggable={!isLocked}
              onDragStart={(e) => {
                setDraggedIdx(idx);
                // HTML5 Drag require setData
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", idx);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
              }}
              onDrop={(e) => {
                e.preventDefault();
                handleDrop(idx);
              }}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "8px 12px", background: draggedIdx === idx ? "var(--bg-card)" : "var(--bg-elevated)",
                border: "1px dashed var(--border)", borderRadius: "var(--radius-sm)",
                cursor: isLocked ? "default" : "grab", opacity: isLocked ? 0.6 : (draggedIdx === idx ? 0.5 : 1),
                transition: "all 0.2s"
              }}
            >
              <div style={{ fontSize: 14, opacity: 0.5, cursor: "grab" }}>≡</div>
              <div style={{ fontSize: 12, fontWeight: 700, minWidth: 24, color: "var(--text-muted)" }}>#{idx + 1}</div>
              <div style={{ fontSize: 13, flex: 1, fontFamily: "monospace" }}>{k.key_masked}</div>
              {idx === 0 && <div style={{ fontSize: 10, padding: "2px 6px", background: "rgba(99,102,241,0.2)", color: "var(--accent)", borderRadius: 12, fontWeight: 700 }}>PRIORITY</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


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

function formatKeyAction(ev) {
  if (!ev) return "";
  switch (ev.action) {
    case "trying_key":        return `🔑 Đang thử key #${ev.key_index + 1} (****${ev.key_suffix})`;
    case "key_failed_switching":
    case "key_invalid_switching":
      return `⚠️ Key ****${ev.key_suffix} lỗi → chuyển sang ****${ev.switching_to || "?"}`;
    case "success_on_fallback":
    case "success_on_fallback_key":
      return `✅ Thành công với key dự phòng ****${ev.key_suffix}`;
    case "non_key_error":
    case "chunk_error_trying_next":
      return `⚡ Lỗi mạng/parse với key ****${ev.key_suffix}, thử key tiếp`;
    case "fallback_deep_translator": return "🔄 Dùng Deep Translator (không có Gemini key hợp lệ)";
    case "all_keys_failed":   return "❌ Tất cả key đều thất bại";
    case "skip_invalid":      return `⏭ Bỏ qua key đã lỗi ****${ev.key_suffix}`;
    default:                  return `${ev.action}`;
  }
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
  onNextStep,
  onOpenContextModal,
}) {
  const [showLog, setShowLog] = useState(false);
  const [showKeyLog, setShowKeyLog] = useState(false);
  const [wasRunning, setWasRunning] = useState(false);

  const status = latestPipelineJob?.status;
  const progress = latestPipelineJob?.progress ?? 0;
  const isRunning = status === "running";
  const isQueued  = status === "queued";
  const isDone    = status === "done";
  const isFailed  = status === "failed";
  const isLocked  = isRunning || isQueued;

  useEffect(() => {
    if (isRunning || isQueued) {
      setWasRunning(true);
    } else if (isDone && wasRunning) {
      setWasRunning(false);
      onNextStep?.();
    }
  }, [isRunning, isQueued, isDone, wasRunning, onNextStep]);

  const statusColor = isDone ? "var(--success)" : isFailed ? "var(--danger)" : "var(--accent-2)";
  const statusIcon  = isDone ? "✅" : isFailed ? "❌" : isRunning ? "⚙️" : isQueued ? "⏳" : "🚀";

  const canStart = selectedProject && hasSavedRoi && !isRunning && !isQueued;

  // Key switch log từ job artifacts
  const translateStat = latestPipelineJob?.artifacts?.stats?.translate || {};
  const keySwitchLog  = translateStat.key_switch_log || [];
  const totalKeysAvail = translateStat.total_keys_available ?? 0;

  // Lưu settings vào localStorage trước khi chạy
  function handleStartPipeline() {
    try {
      localStorage.setItem("pipeline_form_saved", JSON.stringify({
        ...pipelineForm,
        translationPreset,
        savedAt: Date.now(),
      }));
    } catch(_) {}
    startPipeline();
  }

  const inputDisabledStyle = isLocked ? { opacity: 0.5, pointerEvents: "none" } : {};

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
              {totalKeysAvail > 0 && (
                <div style={{ fontSize: 11, padding: "3px 8px", borderRadius: 20, background: "rgba(99,102,241,0.2)", color: "var(--accent-2)" }}>
                  🔑 {totalKeysAvail} key
                </div>
              )}
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
            onClick={handleStartPipeline}
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

          {/* Key switch log */}
          {keySwitchLog.length > 0 && (
            <>
              <button
                className="btn btn-ghost btn-sm"
                style={{ alignSelf: "flex-start", color: "var(--accent-2)" }}
                onClick={() => setShowKeyLog((v) => !v)}
              >
                {showKeyLog ? "▲ Ẩn log key dịch" : `🔑 Log rollback key (${keySwitchLog.length} sự kiện)`}
              </button>
              {showKeyLog && (
                <div className="live-log" style={{ maxHeight: 200 }}>
                  {keySwitchLog.map((ev, i) => (
                    <div key={i} className={`log-line${ev.action?.includes("failed") || ev.action?.includes("error") || ev.action === "all_keys_failed" ? " error" : ev.action?.includes("success") ? " ok" : ev.action?.includes("switching") ? " warn" : ""}`}>
                      <span className="log-time">[key]</span>
                      <span>{formatKeyAction(ev)}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Advanced options */}
      <details className="accordion">
        <summary style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span>⚙️ Tuỳ chọn nâng cao</span>
          {isLocked && (
            <span style={{
              fontSize: 11, fontWeight: 600, color: "var(--warning)",
              background: "rgba(251,191,36,0.15)", padding: "2px 8px",
              borderRadius: 20, marginLeft: "auto", marginRight: 8,
            }}>
              🔒 Đang xử lý — không thể chỉnh
            </span>
          )}
        </summary>
        <div className="accordion-body" style={{ display: "flex", flexDirection: "column", gap: 12, ...inputDisabledStyle }}>

          {/* Context button */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", background: "var(--bg-elevated)", borderRadius: "var(--radius-md)", border: "1px solid var(--border)" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>🌐 Ngữ cảnh bản dịch</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                {PRESET_LABELS[translationPreset] || translationPreset}
              </div>
            </div>
            <button
              className="btn btn-secondary btn-sm"
              onClick={onOpenContextModal}
              disabled={isLocked}
            >
              Chọn & tuỳ chỉnh
            </button>
          </div>

          <div className="form-row">
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Khoảng quét OCR (giây)</label>
              <input
                type="number" step="0.1" min="0.1" max="10"
                value={pipelineForm.scan_interval_sec}
                disabled={isLocked}
                onChange={(e) => setPipelineForm((p) => ({ ...p, scan_interval_sec: Number(e.target.value) }))}
              />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group" style={{ marginBottom: 0, flex: 1 }}>
              <label>Phong cách dịch</label>
              <select value={translationPreset} onChange={(e) => setTranslationPreset(e.target.value)} disabled={isLocked}>
                {Object.entries(PRESET_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
          </div>
          
          <div className="form-row">
            <div className="form-group" style={{ width: "100%", marginBottom: 0 }}>
              <DraggableKeyList isLocked={isLocked} />
            </div>
          </div>
          <button
            className="btn btn-secondary btn-sm"
            disabled={retryingStuckJobs || isLocked}
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
