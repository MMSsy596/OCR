import { useState } from "react";

function formatDuration(sec) {
  if (!sec) return "--";
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}g ${m}p ${ss}s`;
  if (m > 0) return `${m} phút ${ss} giây`;
  return `${ss} giây`;
}

function formatBytes(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function ResultCard({ icon, label, subtitle, href, filename, disabled, children }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 14,
      padding: "14px 18px",
      borderRadius: "var(--radius-md)",
      background: "var(--surface-2)",
      border: "1px solid var(--border)",
    }}>
      <div style={{
        width: 44, height: 44, borderRadius: "var(--radius-sm)",
        background: "var(--accent-muted)", display: "flex", alignItems: "center",
        justifyContent: "center", fontSize: 22, flexShrink: 0,
      }}>
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{label}</div>
        {subtitle && <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{subtitle}</div>}
      </div>
      <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
        {children}
        {href && (
          <a
            href={href}
            download={filename || true}
            className={`btn btn-primary btn-sm${disabled ? " disabled" : ""}`}
            style={{ pointerEvents: disabled ? "none" : "auto", opacity: disabled ? 0.5 : 1 }}
          >
            ⬇️ Tải xuống
          </a>
        )}
      </div>
    </div>
  );
}

export function Step7Result({
  selectedProject,
  editableSegments,
  lastExport,
  exportSubtitle,
  exporting,
  exportForm,
  setExportForm,
  latestDubAudioUrl,
  latestDubAudioName,
  downloadDubAudio,
  latestPipelineJob,
  latestDubJob,
  videoSrc,
  onNewProject,
}) {
  const [showCapCutGuide, setShowCapCutGuide] = useState(false);
  const [capCutLoading, setCapCutLoading] = useState(false);

  // Compute stats
  const segCount = editableSegments.length;
  const totalDuration = editableSegments.length
    ? Math.max(...editableSegments.map((s) => s.end_sec || 0))
    : 0;

  const pipelineCreatedAt = latestPipelineJob?.created_at;
  const pipelineUpdatedAt = latestPipelineJob?.updated_at;
  const processingSeconds = pipelineCreatedAt && pipelineUpdatedAt
    ? Math.round((new Date(pipelineUpdatedAt) - new Date(pipelineCreatedAt)) / 1000)
    : null;

  const hasDubAudio = Boolean(latestDubAudioUrl);
  const hasSubtitle = segCount > 0;
  const hasVideo    = Boolean(selectedProject?.video_path);

  async function handleExportAndDownload(fmt) {
    setExportForm((p) => ({ ...p, export_format: fmt }));
    setTimeout(exportSubtitle, 50);
  }

  async function buildCapCutZip() {
    setCapCutLoading(true);
    try {
      // Dynamically import JSZip (available if installed, otherwise fallback)
      let JSZip;
      try {
        JSZip = (await import("jszip")).default;
      } catch {
        setShowCapCutGuide(true);
        setCapCutLoading(false);
        return;
      }

      const zip = new JSZip();

      // Build draft_content.json (CapCut draft format)
      const projectName = selectedProject?.name || "Solar OCR";
      const now = Date.now();
      const draftId = `solar_${now}`;

      // CapCut draft_content.json minimal structure
      const draftContent = {
        id: draftId,
        name: projectName,
        create_time: Math.floor(now / 1000),
        update_time: Math.floor(now / 1000),
        version: 360000,
        type: "draft",
        materials: {
          videos: hasVideo ? [{
            id: "video_main",
            path: "video/source.mp4",
            duration: Math.round(totalDuration * 1000000),
            type: "video",
          }] : [],
          texts: [],
          audios: hasDubAudio ? [{
            id: "audio_dub",
            path: `audio/${latestDubAudioName || "dub.wav"}`,
            type: "audio",
            duration: Math.round(totalDuration * 1000000),
          }] : [],
        },
        tracks: [],
      };

      zip.file("draft_content.json", JSON.stringify(draftContent, null, 2));

      // Add SRT file
      if (hasSubtitle) {
        const srtContent = editableSegments.map((seg, i) => {
          const fmt = (sec) => {
            const s = Math.floor(sec);
            const ms = Math.round((sec - s) * 1000);
            const hh = String(Math.floor(s / 3600)).padStart(2, "0");
            const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
            const ss = String(s % 60).padStart(2, "0");
            return `${hh}:${mm}:${ss},${String(ms).padStart(3, "0")}`;
          };
          return `${i + 1}\n${fmt(seg.start_sec)} --> ${fmt(seg.end_sec)}\n${seg.translated_text || seg.raw_text || ""}\n`;
        }).join("\n");
        zip.file("subtitle/subtitle.srt", srtContent);
      }

      // README inside zip
      zip.file("README.txt",
        `Solar OCR Studio — CapCut Import Package\n` +
        `===========================================\n\n` +
        `Dự án: ${projectName}\n` +
        `Tổng phụ đề: ${segCount} dòng\n` +
        `Thời lượng: ${formatDuration(totalDuration)}\n\n` +
        `Hướng dẫn import vào CapCut:\n` +
        `1. Mở File Explorer → điều hướng đến thư mục Drafts của CapCut:\n` +
        `   Windows: C:\\Users\\<Tên>\\AppData\\Local\\CapCut\\User Data\\Projects\\com.lveditor.draft\\\n` +
        `   Mac: /Users/<Tên>/Movies/CapCut/User Data/Projects/com.lveditor.draft/\n` +
        `2. Tạo thư mục mới tên "${draftId}"\n` +
        `3. Giải nén toàn bộ nội dung file ZIP này vào thư mục vừa tạo\n` +
        `4. Mở CapCut → Dự án "${projectName}" sẽ xuất hiện trong danh sách\n` +
        `5. Vào dự án → Import video thủ công nếu cần và attach subtitle\n\n` +
        `Lưu ý: File video gốc không được đóng gói do kích thước lớn.\n` +
        `Hãy kéo thả video vào CapCut sau khi mở draft.\n`
      );

      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${projectName.replace(/\s+/g, "_")}_capcut.zip`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("CapCut export error:", err);
      setShowCapCutGuide(true);
    } finally {
      setCapCutLoading(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 800, margin: "0 auto", width: "100%" }}>

      {/* Hero banner */}
      <div style={{
        padding: "28px 24px",
        borderRadius: "var(--radius-lg)",
        background: "linear-gradient(135deg, var(--accent-muted) 0%, var(--surface-2) 100%)",
        border: "1px solid var(--border)",
        textAlign: "center",
      }}>
        <div style={{ fontSize: 52, marginBottom: 8 }}>🎉</div>
        <h2 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 800 }}>Hoàn tất!</h2>
        <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: 14 }}>
          Dự án <strong>{selectedProject?.name || "—"}</strong> đã xử lý xong.
        </p>

        {/* Quick stats */}
        <div style={{
          display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap",
          marginTop: 20,
        }}>
          {[
            { icon: "📋", label: "Phụ đề", value: `${segCount} dòng` },
            { icon: "⏱️", label: "Thời lượng", value: formatDuration(totalDuration) },
            { icon: "⚡", label: "Xử lý mất", value: processingSeconds ? formatDuration(processingSeconds) : "—" },
          ].map((stat) => (
            <div key={stat.label} style={{
              padding: "10px 20px",
              borderRadius: "var(--radius-md)",
              background: "var(--surface-3, var(--surface-2))",
              border: "1px solid var(--border)",
              minWidth: 100,
            }}>
              <div style={{ fontSize: 20 }}>{stat.icon}</div>
              <div style={{ fontSize: 18, fontWeight: 800, marginTop: 4 }}>{stat.value}</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{stat.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Files section */}
      <div className="card">
        <div className="card-header">
          <h2>📦 File kết quả</h2>
        </div>
        <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>

          {/* Video gốc */}
          <ResultCard
            icon="🎬"
            label="Video gốc"
            subtitle={selectedProject?.video_path?.split(/[/\\]/).pop() || "source.mp4"}
            href={hasVideo ? videoSrc : null}
            filename={selectedProject?.video_path?.split(/[/\\]/).pop() || "source.mp4"}
            disabled={!hasVideo}
          />

          {/* Phụ đề */}
          <ResultCard
            icon="📄"
            label="File phụ đề"
            subtitle={`${segCount} dòng phụ đề đã dịch`}
            disabled={!hasSubtitle}
          >
            {["srt", "vtt"].map((fmt) => (
              <button
                key={fmt}
                className="btn btn-secondary btn-sm"
                disabled={exporting || !hasSubtitle}
                onClick={() => handleExportAndDownload(fmt)}
              >
                {exporting ? "⏳" : `⬇️ ${fmt.toUpperCase()}`}
              </button>
            ))}
          </ResultCard>

          {/* File âm thanh */}
          <ResultCard
            icon="🔊"
            label="File âm thanh lồng tiếng"
            subtitle={hasDubAudio ? (latestDubAudioName || "dub-output.wav") : "Chưa tạo âm thanh"}
            href={hasDubAudio ? latestDubAudioUrl : null}
            filename={latestDubAudioName || "dub-output.wav"}
            disabled={!hasDubAudio}
          />
        </div>
      </div>

      {/* CapCut import */}
      <div className="card">
        <div className="card-header">
          <h2>🎬 Import vào CapCut</h2>
        </div>
        <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p style={{ margin: 0, fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>
            Tải gói ZIP để nhanh chóng import dự án vào CapCut. Gói bao gồm file phụ đề đúng cấu trúc Draft của CapCut và hướng dẫn chi tiết.
          </p>
          <button
            className="btn btn-primary"
            style={{ width: "100%", gap: 8 }}
            onClick={buildCapCutZip}
            disabled={capCutLoading || (!hasSubtitle && !hasDubAudio)}
          >
            {capCutLoading ? "⏳ Đang tạo gói…" : "🎬 Tải gói import CapCut (.zip)"}
          </button>

          {showCapCutGuide && (
            <div style={{
              padding: "14px 16px",
              borderRadius: "var(--radius-md)",
              background: "var(--accent-muted)",
              border: "1px solid var(--border)",
              fontSize: 13, lineHeight: 1.8,
            }}>
              <strong>📂 Hướng dẫn import thủ công:</strong>
              <ol style={{ margin: "8px 0 0 16px", padding: 0 }}>
                <li>Tải file SRT ở trên</li>
                <li>Mở CapCut → Tạo project mới</li>
                <li>Import video gốc vào timeline</li>
                <li>Vào <strong>Text → Import subtitles</strong> → chọn file SRT vừa tải</li>
                {hasDubAudio && <li>Import file âm thanh lồng tiếng vào track Audio</li>}
              </ol>
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 10 }}>
        <button
          className="btn btn-ghost"
          style={{ flex: 1 }}
          onClick={onNewProject}
        >
          ➕ Tạo dự án mới
        </button>
        <button
          className="btn btn-secondary"
          style={{ flex: 1 }}
          onClick={() => window.location.reload()}
        >
          🔄 Quay về đầu
        </button>
      </div>
    </div>
  );
}
