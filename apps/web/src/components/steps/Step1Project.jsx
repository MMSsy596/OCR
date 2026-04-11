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
  statusLabel,
}) {
  const [showCreate, setShowCreate] = useState(!projects.length);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, height: "100%" }}>
      {/* Danh sách dự án */}
      <div className="card" style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div className="card-header">
          <h2>📂 Dự án của bạn</h2>
          <div className="row-actions">
            <button
              className="btn btn-sm btn-secondary"
              onClick={() => setShowCreate(true)}
            >
              + Tạo mới
            </button>
            <button
              className="btn btn-sm btn-danger"
              onClick={clearOldSessions}
              disabled={clearingSessions}
              title="Xoá toàn bộ phiên cũ"
            >
              {clearingSessions ? "Đang xoá…" : "🗑 Dọn dẹp"}
            </button>
          </div>
        </div>
        <div className="card-body" style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
          {projects.length === 0 && (
            <div style={{ textAlign: "center", padding: "32px 0", color: "var(--text-muted)" }}>
              <div style={{ fontSize: 40, marginBottom: 10 }}>📭</div>
              <div>Chưa có dự án nào</div>
              <div className="text-sm mt-8">Tạo dự án mới để bắt đầu</div>
            </div>
          )}
          {projects.map((p) => (
            <div
              key={p.id}
              className={`project-card ${p.id === selectedProjectId ? "active" : ""}`}
              onClick={() => setSelectedProjectId(p.id)}
            >
              <div className="project-card-icon">🎞️</div>
              <div style={{ minWidth: 0 }}>
                <div className="project-card-title">{p.name}</div>
                <div className="project-card-sub">
                  {p.source_lang} → {p.target_lang}
                  {p.id === selectedProjectId && statusLabel
                    ? ` · ${statusLabel(p.status)}`
                    : ""}
                </div>
              </div>
              {p.id === selectedProjectId && (
                <span className="badge badge-purple" style={{ marginLeft: "auto", flexShrink: 0 }}>
                  Đang chọn
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Form tạo mới */}
      {showCreate && (
        <div className="card">
          <div className="card-header">
            <h2>✨ Tạo dự án mới</h2>
            {projects.length > 0 && (
              <button className="btn btn-sm btn-ghost" onClick={() => setShowCreate(false)}>✕</button>
            )}
          </div>
          <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="step-guide">
              <span className="step-guide-icon">💡</span>
              <div className="step-guide-text">
                <h3>Bước 1: Tạo dự án</h3>
                <p>Đặt tên và chọn thể loại phim. Hệ thống sẽ tự chọn cách dịch phù hợp.</p>
              </div>
            </div>

            <div className="form-group">
              <label>Tên dự án</label>
              <input
                value={projectForm.name}
                onChange={(e) => setProjectForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="Ví dụ: Tiên Nghịch - Tập 01"
              />
            </div>

            <div className="form-group">
              <label>Thể loại phim</label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                {Object.entries(PROMPT_PRESETS_META).map(([key, meta]) => (
                  <button
                    key={key}
                    className={`btn ${translationPreset === key ? "btn-primary" : "btn-secondary"}`}
                    style={{ flexDirection: "column", gap: 4, padding: "10px 8px", fontSize: 12 }}
                    onClick={() => setTranslationPreset(key)}
                  >
                    <span style={{ fontSize: 20 }}>{meta.icon}</span>
                    {meta.label}
                  </button>
                ))}
              </div>
            </div>

            <details className="accordion">
              <summary>⚙️ Tuỳ chọn nâng cao</summary>
              <div className="accordion-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div className="form-row">
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label>Ngôn ngữ gốc</label>
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
                  <label>Glossary (từ điển riêng)</label>
                  <textarea
                    rows={3}
                    value={projectForm.glossary}
                    onChange={(e) => setProjectForm((p) => ({ ...p, glossary: e.target.value }))}
                    placeholder="Đạo huynh=Sư huynh&#10;Tiên tôn=Tiên Tôn"
                  />
                  <div className="hint-text">Mỗi dòng một từ, định dạng: Gốc=Dịch</div>
                </div>
              </div>
            </details>

            <button
              className="btn btn-primary btn-lg"
              onClick={createProject}
              disabled={creating || !projectForm.name.trim()}
              style={{ width: "100%", marginTop: 4 }}
            >
              {creating ? "⏳ Đang tạo…" : "✨ Tạo dự án"}
            </button>
          </div>
        </div>
      )}

      {!showCreate && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, color: "var(--text-muted)" }}>
          <div style={{ fontSize: 48 }}>👈</div>
          <div style={{ fontSize: 14, textAlign: "center" }}>Chọn một dự án bên trái để tiếp tục<br/>hoặc tạo dự án mới</div>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ Tạo dự án mới</button>
        </div>
      )}
    </div>
  );
}
