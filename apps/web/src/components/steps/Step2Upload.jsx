import { useEffect, useRef, useState } from "react";
import { withApiAuth, readApiErrorMessage } from "../../lib/api";

const PLATFORM_META = {
  youtube:    { icon: "🎬", label: "YouTube" },
  tiktok:     { icon: "🎵", label: "TikTok" },
  facebook:   { icon: "👥", label: "Facebook" },
  instagram:  { icon: "📸", label: "Instagram" },
  x:          { icon: "🐦", label: "Twitter / X" },
  bilibili:   { icon: "📺", label: "Bilibili" },
  dailymotion:{ icon: "🎥", label: "Dailymotion" },
  generic:    { icon: "🌐", label: "Trang web" },
  unknown:    { icon: "🔗", label: "URL" },
};

function fmtDuration(sec) {
  if (!sec) return "";
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,"0")}:${String(ss).padStart(2,"0")}`;
  return `${m}:${String(ss).padStart(2,"0")}`;
}

function fmtEventTime(iso) {
  if (!iso) return "--:--";
  const d = new Date(iso);
  return isNaN(d) ? "--:--" : d.toLocaleTimeString("vi-VN", { hour12: false });
}

// ── UrlTab ──────────────────────────────────────────────────────────────────
function UrlTab({
  selectedProject,
  sourceUrl, setSourceUrl,
  autoStartAfterIngest, setAutoStartAfterIngest,
  ingestVideoFromUrl, ingestingUrl,
  latestIngestJob, latestIngestEvents,
  apiBase, setWizardStep,
}) {
  const [checkingUrl, setCheckingUrl]   = useState(false);
  const [checkError, setCheckError]     = useState("");
  const [urlInfo, setUrlInfo]           = useState(null);   // { platform, title, thumbnail, formats, ... }
  const [selectedFmt, setSelectedFmt]   = useState("auto");
  const [activeJobId, setActiveJobId]   = useState("");
  const [showLog, setShowLog]           = useState(true);
  const logEndRef = useRef(null);

  // Scroll log to newest when events change
  useEffect(() => {
    if (showLog && latestIngestEvents?.length) {
      logEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [latestIngestEvents, showLog]);

  // Khi job hoàn thành → chuyển bước
  const isIngestRunning = latestIngestJob?.status === "running" || ingestingUrl;
  const isIngestDone    = latestIngestJob?.status === "done";
  const isIngestFailed  = latestIngestJob?.status === "failed";

  useEffect(() => {
    if (isIngestDone && activeJobId && latestIngestJob?.id === activeJobId) {
      const t = setTimeout(() => setWizardStep(3), 1200);
      return () => clearTimeout(t);
    }
  }, [isIngestDone, activeJobId, latestIngestJob?.id, setWizardStep]);

  async function handleCheckUrl() {
    if (!sourceUrl.trim()) return;
    setCheckingUrl(true);
    setCheckError("");
    setUrlInfo(null);
    setSelectedFmt("auto");
    try {
      const res = await fetch(`${apiBase}/ingest-url/check`, withApiAuth({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_url: sourceUrl.trim() }),
      }));
      if (!res.ok) throw new Error(await readApiErrorMessage(res, `HTTP ${res.status}`));
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Không lấy được thông tin link");
      setUrlInfo(data);
      setSelectedFmt(data.formats?.[0]?.format_id || "auto");
    } catch (err) {
      setCheckError(err.message);
    } finally {
      setCheckingUrl(false);
    }
  }

  async function handleDownload() {
    const job = await ingestVideoFromUrl(urlInfo ? selectedFmt : null);
    if (job?.id) {
      setActiveJobId(job.id);
      setShowLog(true);
    }
  }

  // Live download stats từ job artifacts
  const liveStat = latestIngestJob?.artifacts?.stats?.download_live;
  const dlProgress = latestIngestJob?.progress ?? 0;

  const meta = PLATFORM_META[urlInfo?.platform] || PLATFORM_META.unknown;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Input URL */}
      <div className="form-group" style={{ marginBottom: 0 }}>
        <label>URL video (YouTube, TikTok, Bilibili, Twitter/X…)</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="url"
            value={sourceUrl}
            onChange={(e) => { setSourceUrl(e.target.value); setUrlInfo(null); setCheckError(""); }}
            onKeyDown={(e) => e.key === "Enter" && handleCheckUrl()}
            placeholder="https://www.youtube.com/watch?v=..."
            style={{ flex: 1 }}
          />
          <button
            className="btn btn-secondary"
            style={{ whiteSpace: "nowrap", minWidth: 110 }}
            disabled={!sourceUrl.trim() || checkingUrl || isIngestRunning}
            onClick={handleCheckUrl}
          >
            {checkingUrl ? "⏳ Đang kiểm tra…" : "🔍 Kiểm tra link"}
          </button>
        </div>
      </div>

      {/* Lỗi check */}
      {checkError && (
        <div style={{ padding: "10px 14px", borderRadius: "var(--radius-md)",
          background: "var(--danger-muted)", border: "1px solid rgba(239,68,68,0.3)",
          fontSize: 13, color: "var(--danger)" }}>
          ❌ {checkError}
        </div>
      )}

      {/* Thông tin video sau khi kiểm tra */}
      {urlInfo && (
        <div style={{ background: "var(--bg-elevated)", borderRadius: "var(--radius-md)",
          border: "1px solid var(--border)", overflow: "hidden" }}>

          {/* Header: platform + title */}
          <div style={{ display: "flex", gap: 12, padding: "12px 14px",
            borderBottom: "1px solid var(--border)", alignItems: "flex-start" }}>
            {urlInfo.thumbnail ? (
              <img src={urlInfo.thumbnail} alt=""
                style={{ width: 80, height: 52, objectFit: "cover",
                  borderRadius: "var(--radius-sm)", flexShrink: 0, background: "var(--bg-card)" }}
                onError={(e) => { e.target.style.display = "none"; }} />
            ) : (
              <div style={{ width: 80, height: 52, background: "var(--bg-base)",
                borderRadius: "var(--radius-sm)", display: "flex", alignItems: "center",
                justifyContent: "center", fontSize: 28, flexShrink: 0 }}>
                {meta.icon}
              </div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                <span style={{ fontSize: 13 }}>{meta.icon}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)",
                  textTransform: "uppercase", letterSpacing: "0.05em" }}>{meta.label}</span>
                {urlInfo.duration_sec > 0 && (
                  <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: "auto" }}>
                    ⏱ {fmtDuration(urlInfo.duration_sec)}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.4,
                color: "var(--text-primary)", overflow: "hidden",
                display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                {urlInfo.title || "(Không có tiêu đề)"}
              </div>
            </div>
          </div>

          {/* Format picker */}
          <div style={{ padding: "12px 14px" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)",
              textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
              🎞️ Chọn chất lượng tải về
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 220, overflowY: "auto" }}>
              {(urlInfo.formats || []).map((fmt) => (
                <label
                  key={fmt.format_id}
                  style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "9px 12px",
                    borderRadius: "var(--radius-sm)",
                    border: `1.5px solid ${selectedFmt === fmt.format_id ? "var(--accent)" : "var(--border)"}`,
                    background: selectedFmt === fmt.format_id ? "var(--accent-muted)" : "var(--bg-card)",
                    cursor: "pointer",
                    transition: "all var(--transition)",
                  }}
                >
                  <input
                    type="radio"
                    name="video_format"
                    value={fmt.format_id}
                    checked={selectedFmt === fmt.format_id}
                    onChange={() => setSelectedFmt(fmt.format_id)}
                    style={{ width: "auto", margin: 0, accentColor: "var(--accent)" }}
                  />
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 13, fontWeight: 600,
                      color: selectedFmt === fmt.format_id ? "var(--accent)" : "var(--text-primary)" }}>
                      {fmt.height >= 9999 ? "🏆 Tốt nhất có thể (tự động)" : fmt.label}
                    </span>
                  </div>
                  {fmt.height < 9999 && (
                    <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                      {fmt.height >= 1080 && (
                        <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 10,
                          background: "rgba(99,102,241,0.18)", color: "var(--accent)", fontWeight: 700 }}>HD</span>
                      )}
                      {fmt.fps > 30 && (
                        <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 10,
                          background: "rgba(34,197,94,0.15)", color: "var(--success)", fontWeight: 700 }}>
                          {fmt.fps}fps</span>
                      )}
                      {fmt.filesize_human && fmt.filesize_human !== "?" && (
                        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>~{fmt.filesize_human}</span>
                      )}
                    </div>
                  )}
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Auto-start option */}
      <label style={{ display: "flex", alignItems: "center", gap: 8,
        textTransform: "none", letterSpacing: 0, fontSize: 13, fontWeight: 500,
        cursor: "pointer", marginBottom: 0 }}>
        <input
          type="checkbox"
          checked={autoStartAfterIngest}
          onChange={(e) => setAutoStartAfterIngest(e.target.checked)}
          style={{ width: "auto" }}
        />
        Tự động bắt đầu xử lý sau khi tải về
      </label>

      {/* Download button */}
      <button
        className="btn btn-primary btn-lg"
        style={{ width: "100%" }}
        disabled={!sourceUrl.trim() || isIngestRunning || !selectedProject}
        onClick={handleDownload}
      >
        {isIngestRunning ? "⏳ Đang tải về…" : urlInfo ? "⬇️ Tải video về" : "🔗 Tải video từ URL"}
      </button>

      {!selectedProject && (
        <div className="hint-text" style={{ textAlign: "center" }}>
          ← Quay lại Bước 1 để chọn hoặc tạo dự án trước
        </div>
      )}

      {/* ── Live progress & log ── */}
      {latestIngestJob && (latestIngestEvents?.length > 0 || isIngestRunning) && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>

          {/* Status bar */}
          <div style={{
            display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
            borderRadius: "var(--radius-md)",
            background: isIngestDone ? "var(--success-muted)"
                       : isIngestFailed ? "var(--danger-muted)"
                       : "var(--accent-muted)",
            border: `1px solid ${isIngestDone ? "rgba(34,197,94,0.25)"
                                : isIngestFailed ? "rgba(239,68,68,0.25)"
                                : "rgba(99,102,241,0.25)"}`,
          }}>
            <span style={{ fontSize: 18 }}>
              {isIngestDone ? "✅" : isIngestFailed ? "❌" : "⬇️"}
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700,
                color: isIngestDone ? "var(--success)" : isIngestFailed ? "var(--danger)" : "var(--accent)" }}>
                {isIngestDone ? "Tải về hoàn tất!" : isIngestFailed ? "Tải về thất bại" : "Đang tải về…"}
              </div>
              {/* Live speed & ETA */}
              {liveStat && isIngestRunning && (
                <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2, display: "flex", gap: 12 }}>
                  <span>📥 {liveStat.downloaded_human}{liveStat.total_human && liveStat.total_human !== "0B" ? ` / ${liveStat.total_human}` : ""}</span>
                  {liveStat.speed && liveStat.speed !== "-" && <span>🚀 {liveStat.speed}</span>}
                  {liveStat.eta && liveStat.eta !== "-" && <span>⏱ còn {liveStat.eta}</span>}
                </div>
              )}
            </div>
            <span style={{ fontSize: 13, fontWeight: 700,
              color: isIngestDone ? "var(--success)" : isIngestFailed ? "var(--danger)" : "var(--accent-2)" }}>
              {dlProgress}%
            </span>
          </div>

          {/* Progress bar */}
          {isIngestRunning && (
            <div>
              <div className="progress-wrap">
                <div className="progress-bar" style={{ width: `${Math.max(dlProgress, 2)}%`, transition: "width 0.6s" }} />
              </div>
            </div>
          )}

          {/* Log toggle + panel */}
          {latestIngestEvents?.length > 0 && (
            <>
              <button
                className="btn btn-ghost btn-sm"
                style={{ alignSelf: "flex-start" }}
                onClick={() => setShowLog((v) => !v)}
              >
                {showLog ? "▲ Ẩn nhật ký" : `▼ Nhật ký tải (${latestIngestEvents.length} sự kiện)`}
              </button>

              {showLog && (
                <div className="live-log" style={{ maxHeight: 200 }}>
                  {[...latestIngestEvents].reverse().map((ev, i) => (
                    <div
                      key={`${ev.time}-${i}`}
                      className={`log-line${ev.level === "warning" ? " warn" : ev.level === "error" ? " error" : ev.phase === "done" ? " ok" : ""}`}
                    >
                      <span className="log-time">[{fmtEventTime(ev.time)}]</span>
                      <span>[{ev.phase}] {ev.message}</span>
                      {ev.progress != null && (
                        <span style={{ marginLeft: "auto", color: "var(--text-muted)" }}>{ev.progress}%</span>
                      )}
                    </div>
                  ))}
                  <div ref={logEndRef} />
                </div>
              )}
            </>
          )}
        </div>
      )}

      <div className="hint-text">
        Hỗ trợ YouTube, TikTok, Bilibili, Twitter/X, Instagram, Facebook và hầu hết các nền tảng video phổ biến.
      </div>
    </div>
  );
}

// ── Step2Upload (main component) ────────────────────────────────────────────
export function Step2Upload({
  selectedProject,
  videoFile, setVideoFile,
  loading, uploadVideo,
  sourceUrl, setSourceUrl,
  autoStartAfterIngest, setAutoStartAfterIngest,
  ingestVideoFromUrl, ingestingUrl,
  latestIngestJob, latestIngestEvents,
  apiBase, setWizardStep,
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
          <p>Kéo thả file video hoặc nhập URL từ YouTube / TikTok / Bilibili… để tải về tự động.</p>
        </div>
      </div>

      {hasVideo && (
        <div style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: "12px 16px", borderRadius: "var(--radius-md)",
          background: "var(--success-muted)", border: "1px solid rgba(34,197,94,0.25)",
        }}>
          <span style={{ fontSize: 22 }}>✅</span>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13, color: "var(--success)" }}>Video đã sẵn sàng</div>
            <div className="text-sm text-muted mt-8" style={{ marginTop: 2 }}>
              {selectedProject.video_path?.split(/[\\\/]/).pop()}
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
        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid var(--border)" }}>
          {[["file", "📁 Từ máy tính"], ["url", "🔗 Từ URL"]].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              style={{
                flex: 1, padding: "12px",
                background: "transparent", border: "none",
                borderBottom: tab === key ? "2px solid var(--accent)" : "2px solid transparent",
                color: tab === key ? "var(--text-primary)" : "var(--text-muted)",
                fontWeight: tab === key ? 700 : 500,
                fontSize: 13, cursor: "pointer", borderRadius: 0,
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
            <UrlTab
              selectedProject={selectedProject}
              sourceUrl={sourceUrl}
              setSourceUrl={setSourceUrl}
              autoStartAfterIngest={autoStartAfterIngest}
              setAutoStartAfterIngest={setAutoStartAfterIngest}
              ingestVideoFromUrl={ingestVideoFromUrl}
              ingestingUrl={ingestingUrl}
              latestIngestJob={latestIngestJob}
              latestIngestEvents={latestIngestEvents}
              apiBase={apiBase}
              setWizardStep={setWizardStep}
            />
          )}
        </div>
      </div>
    </div>
  );
}
