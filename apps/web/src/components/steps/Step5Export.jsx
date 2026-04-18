import { useEffect, useRef, useState } from "react";

export function Step5Export({
  editableSegments,
  selectedProject,
  savingSegments,
  retranslating,
  exporting,
  exportForm,
  setExportForm,
  srtUploadFile,
  setSrtUploadFile,
  uploadingSrt,
  saveSegments,
  retranslateOnly,
  exportSubtitle,
  uploadExternalSrt,
  lastExport,
  undoSegments,
  redoSegments,
  updateEditableSegment,
  mergeAdjacentDuplicateSegments,
  currentVideoTime,
  activeSegment,
  onNextStep,
}) {
  // Track which segment indices have unsaved changes
  const [dirtySet, setDirtySet] = useState(new Set());
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Reset dirty tracking when segments reloaded fresh
  useEffect(() => {
    setDirtySet(new Set());
  }, [editableSegments.length]);

  function handleChange(idx, field, value) {
    updateEditableSegment(idx, { [field]: value });
    setDirtySet((prev) => new Set(prev).add(idx));
  }

  function handleSave() {
    saveSegments();
    setDirtySet(new Set());
  }

  // Ctrl+S shortcut
  useEffect(() => {
    function onKeyDown(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        if (dirtySet.size > 0 && !savingSegments) handleSave();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dirtySet.size, savingSegments]);

  function handleNextStep() {
    if (dirtySet.size > 0) {
      if (!window.confirm(`Bạn có ${dirtySet.size} dòng chưa lưu. Lưu trước khi tiếp tục?`)) {
        onNextStep();
        return;
      }
      handleSave();
      setTimeout(onNextStep, 400);
      return;
    }
    onNextStep();
  }

  const dirtyCount = dirtySet.size;

  return (
    <div 
      className={isFullscreen ? "fullscreen-step" : ""}
      style={
        isFullscreen 
          ? { position: "fixed", inset: 0, zIndex: 9999, background: "var(--bg-base)", padding: "20px 32px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 16 } 
          : { display: "flex", flexDirection: "column", gap: 16, height: "100%", minHeight: 0 }
      }
    >
      <div className="step-guide">
        <span className="step-guide-icon">📝</span>
        <div className="step-guide-text">
          <h3>Bước 5: Chỉnh sửa &amp; Xuất phụ đề</h3>
          <p>Chỉnh sửa trực tiếp văn bản gốc hoặc bản dịch trong bảng bên dưới, sau đó lưu và xuất file.</p>
        </div>
      </div>

      {/* Action bar */}
      <div className="card">
        <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>

          {/* Unsaved indicator */}
          {dirtyCount > 0 && (
            <div style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "8px 14px",
              borderRadius: "var(--radius-md)",
              background: "rgba(251,146,60,0.1)",
              border: "1px solid rgba(251,146,60,0.3)",
            }}>
              <span style={{ fontSize: 16 }}>✏️</span>
              <span style={{ fontSize: 13, color: "var(--warning)", flex: 1 }}>
                <strong>{dirtyCount} dòng</strong> đã chỉnh sửa chưa lưu
              </span>
              <button
                className="btn btn-primary btn-sm"
                onClick={handleSave}
                disabled={savingSegments}
              >
                {savingSegments ? "⏳ Đang lưu…" : "💾 Lưu ngay (Ctrl+S)"}
              </button>
            </div>
          )}

          {/* Quick export */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", marginRight: 4 }}>
              Xuất nhanh:
            </span>
            {["srt", "vtt", "txt", "json"].map((fmt) => (
              <button
                key={fmt}
                className="btn btn-secondary btn-sm"
                disabled={exporting || !editableSegments.length}
                onClick={() => {
                  setExportForm((p) => ({ ...p, export_format: fmt }));
                  setTimeout(exportSubtitle, 50);
                }}
              >
                📄 {fmt.toUpperCase()}
              </button>
            ))}

            <span className="spacer" />

            <button className="btn btn-secondary btn-sm" onClick={undoSegments} title="Hoàn tác">↩</button>
            <button className="btn btn-secondary btn-sm" onClick={redoSegments} title="Làm lại">↪</button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={handleSave}
              disabled={savingSegments}
              title="Lưu (Ctrl+S)"
            >
              {savingSegments ? "⏳" : "💾 Lưu"}
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={retranslateOnly}
              disabled={retranslating}
            >
              {retranslating ? "⏳ Đang dịch…" : "🔄 Dịch lại"}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={mergeAdjacentDuplicateSegments}>
              🔗 Gộp trùng
            </button>
          </div>

          {lastExport?.url && (
            <a
              href={lastExport.url}
              download={lastExport.filename}
              className="btn btn-primary btn-sm"
              style={{ alignSelf: "flex-start" }}
            >
              ⬇️ Tải {lastExport.filename}
            </a>
          )}

          {/* Upload SRT ngoài */}
          <details className="accordion">
            <summary>📤 Tải lên SRT từ ngoài</summary>
            <div className="accordion-body" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <input
                type="file"
                accept=".srt,.vtt"
                style={{ flex: 1, minWidth: 200 }}
                onChange={(e) => setSrtUploadFile(e.target.files?.[0] ?? null)}
              />
              <button
                className="btn btn-secondary btn-sm"
                disabled={!srtUploadFile || uploadingSrt}
                onClick={uploadExternalSrt}
              >
                {uploadingSrt ? "⏳ Đang tải…" : "📤 Upload"}
              </button>
            </div>
          </details>
        </div>
      </div>

      {/* Subtitle table */}
      <div className="card" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <div className="card-header">
          <h2>
            📋 Phụ đề ({editableSegments.length} dòng
            {dirtyCount > 0 ? <span style={{ color: "var(--warning)" }}> · {dirtyCount} đã sửa</span> : ""})
          </h2>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className="badge badge-purple">
              {currentVideoTime ? `${currentVideoTime.toFixed(1)}s` : "--"}
            </span>
            <button 
              className="btn btn-sm btn-secondary" 
              onClick={() => setIsFullscreen(!isFullscreen)}
              title={isFullscreen ? "Thu nhỏ về mặc định" : "Mở rộng toàn màn hình để dễ xem"}
            >
              {isFullscreen ? "↙️ Thu nhỏ" : "↗️ Toàn màn hình"}
            </button>
          </div>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          {editableSegments.length === 0 ? (
            <div style={{ textAlign: "center", padding: "60px 0", color: "var(--text-muted)" }}>
              <div style={{ fontSize: 40, marginBottom: 10 }}>📭</div>
              <div>Chưa có phụ đề — hãy chạy xử lý ở Bước 4</div>
            </div>
          ) : (
            <table className="subtitle-table">
              <thead>
                <tr>
                  <th className="col-id">#</th>
                  <th className="col-time">Thời gian</th>
                  <th className="col-orig">Văn bản gốc</th>
                  <th className="col-tran">Bản dịch</th>
                </tr>
              </thead>
              <tbody>
                {editableSegments.map((seg, idx) => {
                  const isActive = activeSegment?.id === seg.id;
                  const isDirty = dirtySet.has(idx);
                  return (
                    <tr
                      key={seg.id ?? idx}
                      className={isActive ? "active-row" : ""}
                      style={isDirty ? { background: "rgba(251,146,60,0.06)" } : undefined}
                    >
                      <td className="col-id" style={{ textAlign: "center", fontSize: 11, verticalAlign: "top", paddingTop: 12 }}>
                        <div style={{ color: "var(--text-muted)" }}>{idx + 1}</div>
                        {isDirty && (
                          <div style={{ color: "var(--warning)", fontSize: 14, marginTop: 4 }} title="Chưa lưu">✏️</div>
                        )}
                      </td>
                      <td className="col-time" style={{ fontSize: 11, color: "var(--text-muted)", verticalAlign: "top", paddingTop: 12 }}>
                        <div>{formatTime(seg.start_sec)}</div>
                        <div>{formatTime(seg.end_sec)}</div>
                      </td>
                      <td className="col-orig">
                        <AutoTextarea
                          value={seg.raw_text ?? ""}
                          onChange={(v) => handleChange(idx, "raw_text", v)}
                          placeholder="Văn bản gốc..."
                          isDirty={isDirty}
                          accent="orange"
                        />
                      </td>
                      <td className="col-tran">
                        <AutoTextarea
                          value={seg.translated_text ?? ""}
                          onChange={(v) => handleChange(idx, "translated_text", v)}
                          placeholder="Bản dịch..."
                          isDirty={isDirty}
                          accent="indigo"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Next step */}
      <button
        className="btn btn-primary btn-lg"
        style={{ width: "100%", marginTop: 4 }}
        onClick={handleNextStep}
        disabled={!editableSegments.length}
      >
        {dirtyCount > 0 ? "💾 Lưu & Tiếp theo: Tạo âm thanh →" : "▶ Tiếp theo: Tạo âm thanh →"}
      </button>
    </div>
  );
}

/* Auto-resize textarea */
function AutoTextarea({ value, onChange, placeholder, isDirty, accent = "orange" }) {
  const ref = useRef(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.style.height = "auto";
      ref.current.style.height = `${Math.max(ref.current.scrollHeight, 44)}px`;
    }
  }, [value]);

  const borderColor = isDirty
    ? accent === "indigo" ? "rgba(99,102,241,0.6)" : "rgba(251,146,60,0.6)"
    : "var(--border)";
  const bgColor = isDirty
    ? accent === "indigo" ? "rgba(99,102,241,0.05)" : "rgba(251,146,60,0.05)"
    : "var(--input-bg)";

  return (
    <textarea
      ref={ref}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      rows={2}
      style={{
        fontSize: 12,
        resize: "vertical",
        minHeight: 44,
        width: "100%",
        border: `1px solid ${borderColor}`,
        background: bgColor,
        transition: "border-color 0.15s, background 0.15s",
        lineHeight: 1.5,
        boxSizing: "border-box",
      }}
    />
  );
}

function formatTime(sec) {
  if (sec == null) return "--:--";
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const ss = String(s % 60).padStart(2, "0");
  const mm = String(m % 60).padStart(2, "0");
  if (h > 0) return `${h}:${mm}:${ss}`;
  return `${mm}:${ss}`;
}
