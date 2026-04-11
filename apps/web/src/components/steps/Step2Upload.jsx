import { useRef, useState } from "react";

export function Step2Upload({
  selectedProject,
  videoFile,
  setVideoFile,
  loading,
  uploadVideo,
  sourceUrl,
  setSourceUrl,
  autoStartAfterIngest,
  setAutoStartAfterIngest,
  ingestVideoFromUrl,
  ingestingUrl,
}) {
  const fileInputRef = useRef(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [tab, setTab] = useState("file"); // "file" | "url"

  function handleDrop(e) {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) setVideoFile(file);
  }

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (file) setVideoFile(file);
  }

  const hasVideo = Boolean(selectedProject?.video_path);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 700, margin: "0 auto", width: "100%" }}>
      <div className="step-guide">
        <span className="step-guide-icon">🎬</span>
        <div className="step-guide-text">
          <h3>Bước 2: Tải lên video</h3>
          <p>Kéo thả file video vào đây hoặc nhập URL YouTube/Twitter để tải về tự động.</p>
        </div>
      </div>

      {hasVideo && (
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "12px 16px",
          borderRadius: "var(--radius-md)",
          background: "var(--success-muted)",
          border: "1px solid rgba(34,197,94,0.25)",
        }}>
          <span style={{ fontSize: 22 }}>✅</span>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13, color: "var(--success)" }}>Video đã sẵn sàng</div>
            <div className="text-sm text-muted mt-8" style={{ marginTop: 2 }}>
              {selectedProject.video_path?.split(/[\\/]/).pop()}
            </div>
          </div>
          <button
            className="btn btn-sm btn-secondary"
            style={{ marginLeft: "auto" }}
            onClick={() => setTab("file")}
          >
            Thay thế
          </button>
        </div>
      )}

      <div className="card">
        {/* Tab */}
        <div style={{ display: "flex", borderBottom: "1px solid var(--border)" }}>
          {[["file", "📁 Từ máy tính"], ["url", "🔗 Từ URL"]].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              style={{
                flex: 1,
                padding: "12px",
                background: "transparent",
                border: "none",
                borderBottom: tab === key ? "2px solid var(--accent)" : "2px solid transparent",
                color: tab === key ? "var(--text-primary)" : "var(--text-muted)",
                fontWeight: tab === key ? 700 : 500,
                fontSize: 13,
                cursor: "pointer",
                borderRadius: 0,
                transition: "all var(--transition)",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="card-body">
          {tab === "file" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {/* Drop zone */}
              <div
                className={`drop-zone${isDragOver ? " drag-over" : ""}`}
                onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <div className="drop-zone-icon">{videoFile ? "🎞️" : "📤"}</div>
                <div className="drop-zone-title">
                  {videoFile ? videoFile.name : "Kéo & thả file video vào đây"}
                </div>
                <div className="drop-zone-sub">
                  {videoFile
                    ? `${(videoFile.size / 1024 / 1024).toFixed(1)} MB — nhấn để đổi`
                    : "Hỗ trợ MP4, MKV, AVI, MOV · Tối đa 512MB"}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/*"
                  style={{ display: "none" }}
                  onChange={handleFileChange}
                />
              </div>

              <button
                className="btn btn-primary btn-lg"
                style={{ width: "100%" }}
                disabled={!videoFile || loading || !selectedProject}
                onClick={uploadVideo}
              >
                {loading ? "⏳ Đang tải lên…" : "📤 Tải video lên"}
              </button>

              {!selectedProject && (
                <div className="hint-text" style={{ textAlign: "center" }}>
                  ← Quay lại Bước 1 để chọn hoặc tạo dự án trước
                </div>
              )}
            </div>
          )}

          {tab === "url" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>URL video (YouTube, Twitter/X, Bilibili…)</label>
                <input
                  type="url"
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                  placeholder="https://www.youtube.com/watch?v=..."
                />
              </div>

              <label style={{ display: "flex", alignItems: "center", gap: 8, textTransform: "none", letterSpacing: 0, fontSize: 13, fontWeight: 500, cursor: "pointer", marginBottom: 0 }}>
                <input
                  type="checkbox"
                  checked={autoStartAfterIngest}
                  onChange={(e) => setAutoStartAfterIngest(e.target.checked)}
                  style={{ width: "auto" }}
                />
                Tự động bắt đầu xử lý sau khi tải về
              </label>

              <button
                className="btn btn-primary btn-lg"
                style={{ width: "100%" }}
                disabled={!sourceUrl.trim() || ingestingUrl || !selectedProject}
                onClick={ingestVideoFromUrl}
              >
                {ingestingUrl ? "⏳ Đang tải về…" : "🔗 Tải video từ URL"}
              </button>

              <div className="hint-text">
                Yêu cầu <code>yt-dlp</code> được cài trên máy. Video sẽ được tải về tự động.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
