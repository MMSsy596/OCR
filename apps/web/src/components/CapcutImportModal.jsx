import { useEffect, useRef, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8000";

function formatDuration(sec) {
  if (!sec || sec <= 0) return "--:--";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function CoverImage({ coverUrl, name }) {
  const [errored, setErrored] = useState(false);
  if (errored) {
    return (
      <div style={{
        width: "100%", aspectRatio: "16/9",
        background: "linear-gradient(135deg, #1e293b 60%, #334155)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 36, borderRadius: "var(--radius-sm)",
      }}>
        🎞️
      </div>
    );
  }
  return (
    <img
      src={`${API_BASE}${coverUrl}`}
      alt={name}
      onError={() => setErrored(true)}
      style={{
        width: "100%", aspectRatio: "16/9", objectFit: "cover",
        borderRadius: "var(--radius-sm)", display: "block",
        background: "#1e293b",
      }}
    />
  );
}

export function CapcutImportModal({ onClose, onImported }) {
  const [drafts, setDrafts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [importingId, setImportingId] = useState(null);
  const overlayRef = useRef(null);

  useEffect(() => {
    async function fetchDrafts() {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`${API_BASE}/capcut/drafts`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setDrafts(data);
      } catch (err) {
        setError("Không tải được danh sách draft CapCut. Kiểm tra backend đang chạy.");
      } finally {
        setLoading(false);
      }
    }
    fetchDrafts();
  }, []);

  // Đóng modal khi click ngoài
  function handleOverlayClick(e) {
    if (e.target === overlayRef.current) onClose();
  }

  async function handleImport(draft) {
    if (importingId) return;
    setImportingId(draft.draft_id);
    try {
      const res = await fetch(`${API_BASE}/capcut/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draft_folder: draft.draft_folder,
          project_name: draft.draft_name,
          source_lang: "zh",
          target_lang: "vi",
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      const project = await res.json();
      onImported(project, draft.has_srt);
    } catch (err) {
      alert(`Import thất bại: ${err.message}`);
    } finally {
      setImportingId(null);
    }
  }

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(0,0,0,0.72)",
        backdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "24px",
      }}
    >
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid rgba(251,146,60,0.22)",
          borderRadius: "var(--radius-lg)",
          width: "100%", maxWidth: 820,
          maxHeight: "85vh",
          display: "flex", flexDirection: "column",
          boxShadow: "0 24px 80px rgba(0,0,0,0.7)",
          animation: "fadeInUp 0.22s ease",
        }}
      >
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "22px 28px", borderBottom: "1px solid var(--border)",
          flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 28 }}>🎬</span>
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Import từ CapCut</h2>
              <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                Chọn dự án CapCut để import vào Solar OCR Studio
              </p>
            </div>
          </div>
          <button
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            style={{ fontWeight: 700, fontSize: 16, padding: "6px 12px" }}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div style={{ overflowY: "auto", padding: "24px 28px", flex: 1 }}>
          {loading && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 16 }}>
              {[1, 2, 3].map((i) => (
                <div key={i} style={{
                  background: "var(--surface-raised)",
                  borderRadius: "var(--radius)",
                  overflow: "hidden",
                  border: "1px solid var(--border)",
                }}>
                  <div style={{
                    width: "100%", aspectRatio: "16/9",
                    background: "linear-gradient(90deg,#1e293b 25%,#334155 50%,#1e293b 75%)",
                    backgroundSize: "200% 100%",
                    animation: "shimmer 1.5s infinite",
                  }} />
                  <div style={{ padding: "14px 16px" }}>
                    <div style={{ height: 14, background: "#334155", borderRadius: 4, marginBottom: 8, width: "70%" }} />
                    <div style={{ height: 11, background: "#1e293b", borderRadius: 4, width: "45%" }} />
                  </div>
                </div>
              ))}
            </div>
          )}

          {!loading && error && (
            <div style={{
              textAlign: "center", padding: "48px 24px",
              color: "var(--text-muted)",
            }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>😕</div>
              <p style={{ fontSize: 14, marginBottom: 8 }}>{error}</p>
              <p style={{ fontSize: 12, color: "var(--text-muted)", opacity: 0.7 }}>
                Đường dẫn tìm kiếm: <code>%LOCALAPPDATA%\CapCut\User Data\Projects\com.lveditor.draft</code>
              </p>
            </div>
          )}

          {!loading && !error && drafts.length === 0 && (
            <div style={{ textAlign: "center", padding: "48px 24px" }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>📂</div>
              <p style={{ fontSize: 14, color: "var(--text-muted)" }}>
                Không tìm thấy dự án CapCut nào. Hãy chắc chắn CapCut đã được cài đặt và có ít nhất 1 dự án.
              </p>
            </div>
          )}

          {!loading && !error && drafts.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 16 }}>
              {drafts.map((draft) => {
                const isImporting = importingId === draft.draft_id;
                const disabled = !!importingId;
                return (
                  <div
                    key={draft.draft_id}
                    style={{
                      background: "var(--surface-raised)",
                      borderRadius: "var(--radius)",
                      overflow: "hidden",
                      border: "1px solid var(--border)",
                      transition: "border-color 0.15s, transform 0.15s, box-shadow 0.15s",
                      cursor: disabled ? "default" : "pointer",
                      opacity: disabled && !isImporting ? 0.5 : 1,
                    }}
                    onMouseEnter={(e) => { if (!disabled) { e.currentTarget.style.borderColor = "rgba(251,146,60,0.5)"; e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 8px 24px rgba(0,0,0,0.4)"; } }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = ""; }}
                  >
                    {/* Cover */}
                    <div style={{ position: "relative" }}>
                      <CoverImage coverUrl={draft.cover_url} name={draft.draft_name} />
                      {/* Duration badge */}
                      <div style={{
                        position: "absolute", bottom: 8, right: 8,
                        background: "rgba(0,0,0,0.72)", color: "#fff",
                        fontSize: 11, fontWeight: 700, padding: "2px 7px",
                        borderRadius: 4, fontFamily: "monospace",
                      }}>
                        {formatDuration(draft.duration_sec)}
                      </div>
                      {/* SRT badge */}
                      {draft.has_srt && (
                        <div style={{
                          position: "absolute", top: 8, left: 8,
                          background: "rgba(34,197,94,0.85)", color: "#fff",
                          fontSize: 10, fontWeight: 700, padding: "2px 7px",
                          borderRadius: 4,
                        }}>
                          SRT ✓
                        </div>
                      )}
                      {!draft.has_video && (
                        <div style={{
                          position: "absolute", top: 8, right: 8,
                          background: "rgba(239,68,68,0.85)", color: "#fff",
                          fontSize: 10, fontWeight: 700, padding: "2px 7px",
                          borderRadius: 4,
                        }}>
                          Thiếu Video
                        </div>
                      )}
                    </div>

                    {/* Info */}
                    <div style={{ padding: "14px 16px" }}>
                      <div style={{
                        fontSize: 13, fontWeight: 600,
                        color: "var(--text-primary)",
                        marginBottom: 4,
                        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                      }}>
                        {draft.draft_name}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 14 }}>
                        {draft.has_video ? "📹 Có video" : "⚠️ Không tìm thấy video"}&nbsp;
                        {draft.has_srt && "· 📄 Có SRT"}
                      </div>
                      <button
                        className={`btn ${isImporting ? "btn-secondary" : "btn-primary"}`}
                        style={{ width: "100%", justifyContent: "center", fontSize: 12, padding: "8px" }}
                        disabled={disabled || !draft.has_video}
                        onClick={() => handleImport(draft)}
                      >
                        {isImporting ? "⏳ Đang import..." : "📥 Import"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: "16px 28px", borderTop: "1px solid var(--border)",
          flexShrink: 0, display: "flex", justifyContent: "space-between",
          alignItems: "center",
        }}>
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
            {drafts.length > 0 ? `${drafts.length} dự án tìm thấy` : "Quét từ thư mục CapCut cục bộ"}
          </span>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            Đóng
          </button>
        </div>
      </div>

      {/* Animation keyframe */}
      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(20px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes shimmer {
          0%   { background-position: -200% 0; }
          100% { background-position:  200% 0; }
        }
      `}</style>
    </div>
  );
}
