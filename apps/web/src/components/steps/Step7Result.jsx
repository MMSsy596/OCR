import { useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8000";

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
  const [capCutLoading, setCapCutLoading] = useState(false);
  const [capCutResult, setCapCutResult]   = useState(null);
  const [capCutError, setCapCutError]     = useState("");
  const [includeDub, setIncludeDub]       = useState(true);

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
    const payload = { ...exportForm, export_format: fmt };
    const result = await exportSubtitle(payload);
    if (result && result.url) {
      const link = document.createElement("a");
      link.href = result.url;
      link.download = `subtitle.${fmt}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
  }

  async function exportToCapcut() {
    if (!selectedProject?.id) return;
    setCapCutLoading(true);
    setCapCutResult(null);
    setCapCutError("");
    try {
      const res = await fetch(`${API_BASE}/projects/${selectedProject.id}/capcut/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          include_dub: includeDub && hasDubAudio,
          style_source: capCutStyleSource,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.detail || data.message || `HTTP ${res.status}`);
      }
      setCapCutResult(data);
    } catch (err) {
      setCapCutError(`Xuất thất bại: ${err.message}`);
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
        <div style={{ display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap", marginTop: 20 }}>
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
          <ResultCard
            icon="🎬"
            label="Video gốc"
            subtitle={selectedProject?.video_path?.split(/[/\\]/).pop() || "source.mp4"}
            href={hasVideo ? videoSrc : null}
            filename={selectedProject?.video_path?.split(/[/\\]/).pop() || "source.mp4"}
            disabled={!hasVideo}
          />
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

      {/* ── Xuất sang CapCut ─────────────────────────────────────── */}
      <div className="card" style={{ border: "1px solid rgba(168,85,247,0.35)" }}>
        <div className="card-header" style={{
          background: "linear-gradient(135deg, rgba(124,58,237,0.18) 0%, rgba(168,85,247,0.08) 100%)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 24 }}>📤</span>
            <div>
              <h2 style={{ margin: 0, fontSize: 16 }}>Xuất sang CapCut</h2>
              <p style={{ margin: 0, fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>
                Tạo dự án CapCut mới ngay trên máy — mở CapCut lên là thấy ngay
              </p>
            </div>
          </div>
        </div>
        <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          {/* Status cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
            {[
              { icon: "🎬", label: "Track video", desc: hasVideo ? "Video gốc đã nhúng" : "Không có video", ok: hasVideo },
              { icon: "💬", label: "Track subtitle", desc: hasSubtitle ? `${segCount} dòng dịch` : "Chưa có phụ đề", ok: hasSubtitle },
              { icon: "🔊", label: "Track audio dub", desc: hasDubAudio ? "Có file dub (tùy chọn)" : "Chưa tạo dub", ok: hasDubAudio },
            ].map((item) => (
              <div key={item.label} style={{
                padding: "12px 14px",
                borderRadius: "var(--radius-md)",
                background: item.ok ? "rgba(34,197,94,0.08)" : "var(--surface-2)",
                border: `1px solid ${item.ok ? "rgba(34,197,94,0.25)" : "var(--border)"}`,
                display: "flex", alignItems: "center", gap: 10,
              }}>
                <span style={{ fontSize: 20 }}>{item.icon}</span>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>{item.label}</div>
                  <div style={{ fontSize: 11, color: item.ok ? "rgba(34,197,94,0.9)" : "var(--text-muted)" }}>{item.desc}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Checkbox include dub */}
          {hasDubAudio && (
            <label style={{
              display: "flex", alignItems: "center", gap: 10,
              cursor: "pointer", fontSize: 13, color: "var(--text-secondary)",
              padding: "8px 12px",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border)",
              background: includeDub ? "rgba(168,85,247,0.08)" : "transparent",
            }}>
              <input
                type="checkbox"
                checked={includeDub}
                onChange={(e) => setIncludeDub(e.target.checked)}
                style={{ width: 16, height: 16, accentColor: "#a855f7" }}
              />
              <span>🔊 Kèm track audio lồng tiếng trong dự án CapCut</span>
            </label>
          )}

          <div style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            padding: "10px 12px",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border)",
            background: "var(--surface-2)",
          }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Kiểu subtitle khi xuất CapCut</div>
            <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 13 }}>
              <input
                type="radio"
                name="capcut-style-source"
                value="preset_0417"
                checked={capCutStyleSource === "preset_0417"}
                onChange={(e) => setCapCutStyleSource(e.target.value)}
              />
              <span>Dùng mẫu cố định `0417` (Mặc định)</span>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 13 }}>
              <input
                type="radio"
                name="capcut-style-source"
                value="latest_draft"
                checked={capCutStyleSource === "latest_draft"}
                onChange={(e) => setCapCutStyleSource(e.target.value)}
              />
              <span>Dùng style của draft CapCut mới nhất lúc bấm xuất</span>
            </label>
          </div>

          {/* Button */}
          <button
            id="btn-export-capcut"
            className="btn"
            style={{
              width: "100%", gap: 10, fontSize: 15, fontWeight: 700,
              background: "linear-gradient(135deg, #7c3aed, #a855f7)",
              color: "#fff",
              border: "1px solid rgba(168,85,247,0.4)",
              padding: "14px",
              boxShadow: capCutLoading ? "none" : "0 4px 20px rgba(168,85,247,0.35)",
              transition: "all 0.2s",
            }}
            disabled={capCutLoading || !hasSubtitle}
            onClick={exportToCapcut}
          >
            {capCutLoading ? "⏳ Đang tạo dự án CapCut…" : "📤 Xuất sang CapCut ngay"}
          </button>

          {/* Success */}
          {capCutResult?.success && (
            <div style={{
              padding: "16px 18px",
              borderRadius: "var(--radius-md)",
              background: "rgba(34,197,94,0.1)",
              border: "1px solid rgba(34,197,94,0.35)",
              animation: "fadeInUp 0.3s ease",
            }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>
                ✅ Đã tạo dự án CapCut thành công!
              </div>
              <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 6 }}>
                Tên dự án: <strong>"{capCutResult.draft_name}"</strong> · {capCutResult.subtitle_count} dòng subtitle
              </div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>
                👉 Mở CapCut → Dự án mới đã xuất hiện đầu danh sách. Nếu CapCut đang mở sẵn, hãy đóng và mở lại.
              </div>
            </div>
          )}

          {/* Error */}
          {capCutError && (
            <div style={{
              padding: "12px 16px",
              borderRadius: "var(--radius-md)",
              background: "rgba(239,68,68,0.08)",
              border: "1px solid rgba(239,68,68,0.3)",
              fontSize: 13, color: "#fca5a5",
            }}>
              ⚠️ {capCutError}
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 10 }}>
        <button className="btn btn-ghost" style={{ flex: 1 }} onClick={onNewProject}>
          ➕ Tạo dự án mới
        </button>
        <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => window.location.reload()}>
          🔄 Quay về đầu
        </button>
      </div>
    </div>
  );
}
