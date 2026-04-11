

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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, height: "100%", minHeight: 0 }}>
      <div className="step-guide">
        <span className="step-guide-icon">📝</span>
        <div className="step-guide-text">
          <h3>Bước 5: Chỉnh sửa & Xuất phụ đề</h3>
          <p>Xem lại phụ đề, chỉnh sửa nếu cần rồi xuất file SRT/VTT. Bước tiếp theo sẽ tạo âm thanh lồng tiếng.</p>
        </div>
      </div>

      {/* Action bar */}
      <div className="card">
        <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
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

            <button
              className="btn btn-secondary btn-sm"
              onClick={undoSegments}
              title="Hoàn tác"
            >↩</button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={redoSegments}
              title="Làm lại"
            >↪</button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={saveSegments}
              disabled={savingSegments}
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
            <button
              className="btn btn-secondary btn-sm"
              onClick={mergeAdjacentDuplicateSegments}
            >
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
          <h2>📋 Phụ đề ({editableSegments.length} dòng)</h2>
          <span className="badge badge-purple">
            {currentVideoTime ? `${currentVideoTime.toFixed(1)}s` : "--"}
          </span>
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
                  return (
                    <tr key={seg.id ?? idx} className={isActive ? "active-row" : ""}>
                      <td className="col-id" style={{ textAlign: "center", color: "var(--text-muted)", fontSize: 11 }}>
                        {idx + 1}
                      </td>
                      <td className="col-time" style={{ fontSize: 11, color: "var(--text-muted)" }}>
                        <div>{formatTime(seg.start_sec)}</div>
                        <div>{formatTime(seg.end_sec)}</div>
                      </td>
                      <td className="col-orig">
                        <textarea
                          rows={2}
                          value={seg.raw_text ?? ""}
                          onChange={(e) => updateEditableSegment(idx, { raw_text: e.target.value })}
                          style={{ fontSize: 12 }}
                        />
                      </td>
                      <td className="col-tran">
                        <textarea
                          rows={2}
                          value={seg.translated_text ?? ""}
                          onChange={(e) => updateEditableSegment(idx, { translated_text: e.target.value })}
                          style={{ fontSize: 12 }}
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
        onClick={onNextStep}
        disabled={!editableSegments.length}
      >
        ▶ Tiếp theo: Tạo âm thanh →
      </button>
    </div>
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
