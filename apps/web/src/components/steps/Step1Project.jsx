import { useState, useMemo, useEffect } from "react";
import { BUILTIN_PRESETS, loadCustomPresets } from "../TranslationContextModal";

export function Step1Project({
  projects,
  selectedProjectId,
  setSelectedProjectId,
  projectForm,
  setProjectForm,
  creating,
  createProject,
  clearOldSessions,
  clearingSessions,
  translationPreset,
  setTranslationPreset,
  customPromptOverride,
  onOpenCapcutModal,
  onOpenContextModal,
}) {
  const [customPresets, setCustomPresets] = useState({});

  useEffect(() => {
    setCustomPresets(loadCustomPresets());
  }, [translationPreset, customPromptOverride]);

  const allPresets = { ...BUILTIN_PRESETS, ...customPresets };
  const currentText = customPromptOverride || allPresets[translationPreset]?.text || "";
  return (
    <div style={{ maxWidth: 720, margin: "0 auto", width: "100%", padding: "20px 0" }}>
      <div className="card" style={{ boxShadow: "0 12px 48px rgba(0,0,0,0.5)", border: "1px solid rgba(251, 146, 60, 0.2)" }}>
        <div className="card-header" style={{ padding: "24px 32px" }}>
          <h2 style={{ fontSize: 20, display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 26 }}>🚀</span> Tạo dự án mới
          </h2>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              className="btn btn-sm"
              style={{
                background: "linear-gradient(135deg, #7c3aed, #a855f7)",
                color: "#fff",
                border: "1px solid rgba(168,85,247,0.4)",
                fontWeight: 600,
                display: "flex", alignItems: "center", gap: 6,
              }}
              onClick={onOpenCapcutModal}
              title="Import dự án từ CapCut"
            >
              🎬 Import CapCut
            </button>
            <button
              className="btn btn-sm btn-ghost"
              onClick={clearOldSessions}
              disabled={clearingSessions}
              title="Dọn dẹp phiên cũ"
            >
              {clearingSessions ? "Đang xoá…" : "🧹 Dọn dẹp Cache"}
            </button>
          </div>
        </div>

        <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 20, padding: "28px 32px" }}>
          <div className="step-guide">
            <span className="step-guide-icon">💡</span>
            <div className="step-guide-text">
              <h3 style={{color: "var(--accent)"}}>Thiết lập phiên làm việc</h3>
              <p>Đặt tên cho dự án và chọn loại nội dung phù hợp. AI sẽ tự động tối ưu hóa từ vựng và phong cách dịch theo thể loại bạn chọn.</p>
            </div>
          </div>

          <div className="form-group">
            <label>Tên dự án</label>
            <input
              style={{ fontSize: 16, padding: "14px 16px" }}
              value={projectForm.name}
              onChange={(e) => setProjectForm((p) => ({ ...p, name: e.target.value }))}
              placeholder="VD: Tiên Nghịch - Tập 01, Hướng dẫn code React..."
            />
          </div>

          <div className="form-group">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
              <label style={{ marginBottom: 0 }}>Thể loại & Phong cách dịch</label>
              <button 
                className="btn btn-ghost btn-sm" 
                style={{ fontSize: 13, color: "var(--accent)", padding: "2px 8px" }}
                onClick={onOpenContextModal}
                title="Sửa ngữ cảnh hiện tại"
              >
                ⚙️ Tuỳ chỉnh ngữ cảnh
              </button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              {Object.entries(allPresets).map(([key, meta]) => (
                <button
                  key={key}
                  className={`btn ${translationPreset === key ? "btn-primary" : "btn-secondary"}`}
                  style={{ flexDirection: "column", gap: 6, padding: "16px 12px", border: translationPreset === key ? "1px solid var(--border-focus)" : "" }}
                  onClick={() => setTranslationPreset(key)}
                >
                  <span style={{ fontSize: 24 }}>{meta.icon || "⭐"}</span>
                  <span style={{ fontSize: 13 }}>{meta.label}</span>
                </button>
              ))}
            </div>
            
            {/* Preview Box */}
            <div style={{ marginTop: 12, padding: "12px 14px", background: "var(--bg-elevated)", borderRadius: "var(--radius-md)", border: "1px solid var(--border)" }}>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6, fontWeight: 600 }}>
                Ngữ cảnh hiện tại {customPromptOverride ? "(Đã ghi đè tuỳ chỉnh)" : ""}:
              </div>
              <div style={{ fontSize: 13, color: "var(--text-primary)", fontStyle: "italic", lineHeight: 1.5 }}>
                "{currentText}"
              </div>
            </div>
          </div>

          <details className="accordion">
            <summary style={{ padding: "16px 20px" }}>⚙️ Thiết lập chuyên sâu (Tuỳ chọn)</summary>
            <div className="accordion-body" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div className="form-row">
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label>Ngôn ngữ nguồn</label>
                  <select
                    value={projectForm.source_lang}
                    onChange={(e) => setProjectForm((p) => ({ ...p, source_lang: e.target.value }))}
                  >
                    <option value="zh">Tiếng Trung (zh)</option>
                    <option value="en">Tiếng Anh (en)</option>
                    <option value="ja">Tiếng Nhật (ja)</option>
                    <option value="ko">Tiếng Hàn (ko)</option>
                  </select>
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label>Dịch sang</label>
                  <select
                    value={projectForm.target_lang}
                    onChange={(e) => setProjectForm((p) => ({ ...p, target_lang: e.target.value }))}
                  >
                    <option value="vi">Tiếng Việt (vi)</option>
                    <option value="en">Tiếng Anh (en)</option>
                  </select>
                </div>
              </div>
              
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Glossary (Từ điển dịch thuật riêng)</label>
                <textarea
                  rows={4}
                  value={projectForm.glossary}
                  onChange={(e) => setProjectForm((p) => ({ ...p, glossary: e.target.value }))}
                  placeholder="Đạo huynh=Sư huynh&#10;Tiên tôn=Tiên Tôn&#10;React=Thư viện web"
                />
                <div className="hint-text">Cấu trúc 1 từ mỗi dòng: Gốc=Dịch. Giúp ép ChatGPT dịch đúng tên riêng/thuật ngữ.</div>
              </div>
            </div>
          </details>

          <button
            className="btn btn-primary btn-lg"
            onClick={createProject}
            disabled={creating || !projectForm.name.trim()}
            style={{ width: "100%", marginTop: 12, padding: "16px" }}
          >
            {creating ? "⏳ Đang tạo..." : "✨ Khởi tạo dự án"}
          </button>
        </div>
      </div>
    </div>
  );
}
