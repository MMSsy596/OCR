import { useState } from "react";

const PROMPT_PRESETS_META = {
  historical:    { label: "Phim cổ trang",     icon: "🏯" },
  modern_short:  { label: "Phim hiện đại",     icon: "🏙️" },
  fantasy:       { label: "Huyền huyễn",        icon: "🔮" },
  cultivation:   { label: "Tu tiên",            icon: "⚔️" },
  reincarnation: { label: "Chuyển sinh",        icon: "♻️" },
  review:        { label: "Review phim",        icon: "🎬" },
};

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
  onOpenCapcutModal,
}) {
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
            <label>Thể loại & Phong cách dịch</label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              {Object.entries(PROMPT_PRESETS_META).map(([key, meta]) => (
                <button
                  key={key}
                  className={`btn ${translationPreset === key ? "btn-primary" : "btn-secondary"}`}
                  style={{ flexDirection: "column", gap: 6, padding: "16px 12px", border: translationPreset === key ? "1px solid var(--border-focus)" : "" }}
                  onClick={() => setTranslationPreset(key)}
                >
                  <span style={{ fontSize: 24 }}>{meta.icon}</span>
                  <span style={{ fontSize: 13 }}>{meta.label}</span>
                </button>
              ))}
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
