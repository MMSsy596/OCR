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

  function resetDefault() {
    setRoiDraft({ x: 0.05, y: 0.78, w: 0.9, h: 0.18 });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="step-guide">
        <span className="step-guide-icon">🎯</span>
        <div className="step-guide-text">
          <h3>Bước 3: Khoanh vùng phụ đề</h3>
          <p>
            Kéo để vẽ vùng chứa phụ đề trên video. Thường phụ đề nằm ở{" "}
            <strong>đáy màn hình</strong>. Nhấn "Mặc định" nếu không chắc.
          </p>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2>🖼️ Chọn vùng OCR</h2>
          <div className="row-actions">
            <button className="btn btn-sm btn-secondary" onClick={resetDefault}>
              🔄 Mặc định
            </button>
            <button
              className={`btn btn-sm ${roiEditMode ? "btn-primary" : "btn-secondary"}`}
              onClick={toggleRoiEditMode}
            >
              {roiEditMode ? "✏️ Đang vẽ" : "✏️ Vẽ vùng"}
            </button>
          </div>
        </div>

        <div className="card-body">
          {!selectedProject?.video_path ? (
            <div style={{ textAlign: "center", padding: "40px 0", color: "var(--text-muted)" }}>
              <div style={{ fontSize: 40, marginBottom: 10 }}>🎬</div>
              <div>Chưa có video — quay lại Bước 2 để tải lên</div>
            </div>
          ) : (
            <>
              <div
                className="preview-stage"
                ref={stageRef}
                onMouseDown={roiEditMode ? beginDraw : undefined}
                style={{ cursor: roiEditMode ? "crosshair" : "default" }}
              >
                <video
                  className="preview-video"
                  src={videoSrc}
                  onTimeUpdate={onVideoTimeUpdate}
                  controls
                />
                {roi && (
                  <div
                    className={`roi-box ${roiEditMode ? "editable" : "readonly"}`}
                    style={{
                      left:   `${roi.x * 100}%`,
                      top:    `${roi.y * 100}%`,
                      width:  `${roi.w * 100}%`,
                      height: `${roi.h * 100}%`,
                    }}
                    onMouseDown={roiEditMode ? beginMove : undefined}
                  >
                    <span className="roi-label">Vùng phụ đề</span>
                    {roiEditMode && (
                      <>
                        {["nw","ne","sw","se"].map((pos) => (
                          <div
                            key={pos}
                            className={`roi-handle ${pos}`}
                            onMouseDown={(e) => { e.stopPropagation(); beginResize(e, pos); }}
                          />
                        ))}
                      </>
                    )}
                  </div>
                )}
              </div>

              {roi && (
                <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", fontSize: 12, color: "var(--text-muted)" }}>
                  <span>X: {(roi.x * 100).toFixed(1)}%</span>
                  <span>Y: {(roi.y * 100).toFixed(1)}%</span>
                  <span>W: {(roi.w * 100).toFixed(1)}%</span>
                  <span>H: {(roi.h * 100).toFixed(1)}%</span>
                </div>
              )}

              <div className="hint-text" style={{ marginTop: 8 }}>
                {roiEditMode
                  ? "Nhấn giữ chuột để vẽ vùng mới · Kéo vùng xanh để di chuyển · Kéo góc để thay đổi kích thước"
                  : "Bấm \"Vẽ vùng\" để chỉnh sửa vùng phụ đề"}
              </div>

              <div style={{ marginTop: 14, display: "flex", gap: 10 }}>
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
