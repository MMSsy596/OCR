import { useState, useEffect } from "react";

const STORAGE_KEY = "translation_context_custom_presets";

const BUILTIN_PRESETS = {
  historical:    { label: "Phim cổ trang",    icon: "🏯", text: "Dịch theo văn phong cổ trang, tự nhiên, dễ nghe, giữ thần thái hội thoại. Ưu tiên xưng hô theo quan hệ nhân vật và cấp bậc. Không dịch thô và không viết dài dòng." },
  modern_short:  { label: "Phim hiện đại",    icon: "🏙️", text: "Dịch theo văn phong hiện đại, đối thoại gọn, đời thường, tự nhiên như người Việt nói. Ưu tiên tốc độ đọc subtitle, tránh câu quá dài." },
  fantasy:       { label: "Huyền huyễn",       icon: "🔮", text: "Dịch theo phong cách huyền huyễn, tạo cảm giác kỳ ảo nhưng vẫn rõ nghĩa. Thuật ngữ sức mạnh và bối cảnh cần nhất quán." },
  cultivation:   { label: "Tu tiên",           icon: "⚔️", text: "Dịch đúng văn mạch tu tiên, giữ tinh thần cấp bậc tu vi, công pháp, linh căn, cảnh giới. Ưu tiên nhất quán thuật ngữ theo glossary." },
  reincarnation: { label: "Chuyển sinh",       icon: "♻️", text: "Dịch rõ cấu trúc kể chuyện chuyển sinh, giữ logic thời gian trước/sau chuyển sinh. Hạn chế lặp lại và tạo nhịp kể chuyện mạch lạc." },
  review:        { label: "Review phim",       icon: "🎬", text: "Dịch theo văn review phim, rõ ý, dễ hiểu, liên kết nguyên nhân-kết quả. Khi cần, diễn đạt thành câu nhận xét tự nhiên cho người xem Việt." },
};

const TONE_OPTIONS = [
  { key: "accurate", label: "Chính xác", desc: "Trung lập, sát nghĩa, ưu tiên rõ ý." },
  { key: "natural",  label: "Tự nhiên",  desc: "Mềm mại, đối thoại như người Việt bản địa." },
  { key: "dramatic", label: "Kịch tính", desc: "Đầy cảm xúc, phù hợp cảnh cao trào." },
];

function loadCustomPresets() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveCustomPresets(presets) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch(_) {}
}

export function TranslationContextModal({
  currentPresetKey,
  currentCustomText,
  currentTone,
  onConfirm,
  onClose,
}) {
  const [tab, setTab] = useState("builtin"); // "builtin" | "custom"
  const [selectedKey, setSelectedKey] = useState(currentPresetKey || "historical");
  const [customPrompt, setCustomPrompt] = useState(currentCustomText || "");
  const [selectedTone, setSelectedTone] = useState(currentTone || "accurate");
  const [customPresets, setCustomPresets] = useState(loadCustomPresets());
  const [saveName, setSaveName] = useState("");
  const [showSaveForm, setShowSaveForm] = useState(false);

  // Khi chọn preset builtin, điền text gợi ý vào custom
  function handleSelectBuiltin(key) {
    setSelectedKey(key);
    if (!customPrompt || customPrompt === BUILTIN_PRESETS[currentPresetKey]?.text) {
      setCustomPrompt(BUILTIN_PRESETS[key]?.text || "");
    }
  }

  // Lấy text prompt hiện tại để preview
  const activeText = tab === "custom"
    ? customPrompt
    : (customPresets[selectedKey]?.text || BUILTIN_PRESETS[selectedKey]?.text || "");

  const activeLabel = tab === "custom"
    ? (saveName || "Tuỳ chỉnh")
    : (customPresets[selectedKey]?.label || BUILTIN_PRESETS[selectedKey]?.label || selectedKey);

  // Compose full prompt preview
  const toneText = {
    accurate: "Giọng điệu chính xác, trung lập, ưu tiên sát nghĩa và rõ ý.",
    natural:  "Giọng điệu tự nhiên, mềm mại, đối thoại như người Việt bản địa.",
    dramatic: "Giọng điệu kịch tính, đầy cảm xúc, phù hợp cảnh cao trào.",
  }[selectedTone] || "";

  const fullPromptPreview = [
    "Mục tiêu: dịch subtitle đúng ngữ cảnh, giữ ý nghĩa đầy đủ, ngôn ngữ tự nhiên.",
    `Thể loại: ${activeText}`,
    `Giọng điệu: ${toneText}`,
    "Ràng buộc: Không tự ý thêm ý mới. Giữ nhất quán cách xưng hô, tên riêng, thuật ngữ và glossary.",
    "Ràng buộc: Trả về câu dịch gọn, dễ đọc trên subtitle, không kèm giải thích.",
  ].join("\n");

  function handleSaveCustom() {
    if (!saveName.trim()) return;
    const newPresets = {
      ...customPresets,
      [saveName.trim()]: { label: saveName.trim(), text: customPrompt, icon: "⭐" },
    };
    setCustomPresets(newPresets);
    saveCustomPresets(newPresets);
    setSelectedKey(saveName.trim());
    setShowSaveForm(false);
    setSaveName("");
  }

  function handleDeleteCustom(key) {
    const { [key]: _, ...rest } = customPresets;
    setCustomPresets(rest);
    saveCustomPresets(rest);
    if (selectedKey === key) setSelectedKey("historical");
  }

  function handleConfirm() {
    const finalKey = tab === "custom" ? `custom:${Date.now()}` : selectedKey;
    const finalText = tab === "custom" ? customPrompt : activeText;
    onConfirm({
      presetKey: tab === "custom" ? "historical" : selectedKey,
      customPromptOverride: tab === "custom" ? customPrompt : null,
      toneKey: selectedTone,
      label: activeLabel,
      fullPrompt: fullPromptPreview,
    });
  }

  const allBuiltinEntries = Object.entries(BUILTIN_PRESETS);
  const allCustomEntries  = Object.entries(customPresets);

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9998,
      background: "rgba(0,0,0,0.75)", backdropFilter: "blur(10px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 16,
    }}>
      <div style={{
        width: "100%", maxWidth: 700,
        background: "var(--bg-card)",
        borderRadius: "var(--radius-xl)",
        border: "1px solid var(--border)",
        boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
        maxHeight: "90vh", display: "flex", flexDirection: "column",
      }}>
        {/* Header */}
        <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 24 }}>🌐</span>
          <div style={{ flex: 1 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Ngữ cảnh bản dịch</h2>
            <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "4px 0 0" }}>Chọn phong cách dịch hoặc tuỳ chỉnh prompt AI</p>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} style={{ fontSize: 18, width: 36, height: 36 }}>✕</button>
        </div>

        {/* Tab header */}
        <div style={{ display: "flex", borderBottom: "1px solid var(--border)", padding: "0 24px" }}>
          {[
            { key: "builtin", label: "📚 Preset có sẵn" },
            { key: "custom",  label: "✏️ Tuỳ chỉnh" },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                background: "none", border: "none", cursor: "pointer",
                padding: "12px 16px", fontSize: 13, fontWeight: tab === t.key ? 700 : 400,
                color: tab === t.key ? "var(--accent)" : "var(--text-secondary)",
                borderBottom: tab === t.key ? "2px solid var(--accent)" : "2px solid transparent",
                marginBottom: -1,
                transition: "all 0.15s",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 24px" }}>

          {tab === "builtin" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>
                Chọn thể loại phim để AI tối ưu phong cách dịch phù hợp
              </div>

              {/* Builtin presets */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
                {allBuiltinEntries.map(([key, meta]) => (
                  <button
                    key={key}
                    onClick={() => handleSelectBuiltin(key)}
                    style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "12px 14px", borderRadius: "var(--radius-md)",
                      background: selectedKey === key && tab === "builtin" ? "rgba(99,102,241,0.12)" : "var(--bg-elevated)",
                      border: `1px solid ${selectedKey === key && tab === "builtin" ? "var(--border-focus)" : "var(--border)"}`,
                      cursor: "pointer", textAlign: "left",
                      transition: "all 0.15s",
                    }}
                  >
                    <span style={{ fontSize: 20 }}>{meta.icon}</span>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{meta.label}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{meta.text.slice(0, 50)}…</div>
                    </div>
                  </button>
                ))}
              </div>

              {/* Custom saved presets */}
              {allCustomEntries.length > 0 && (
                <>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginTop: 12 }}>
                    ⭐ Preset đã lưu
                  </div>
                  {allCustomEntries.map(([key, meta]) => (
                    <div key={key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <button
                        onClick={() => { setSelectedKey(key); setCustomPrompt(meta.text); }}
                        style={{
                          flex: 1, display: "flex", alignItems: "center", gap: 10,
                          padding: "10px 14px", borderRadius: "var(--radius-md)",
                          background: selectedKey === key ? "rgba(251,146,60,0.1)" : "var(--bg-elevated)",
                          border: `1px solid ${selectedKey === key ? "rgba(251,146,60,0.4)" : "var(--border)"}`,
                          cursor: "pointer", textAlign: "left",
                          transition: "all 0.15s",
                        }}
                      >
                        <span style={{ fontSize: 18 }}>⭐</span>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>{meta.label}</div>
                          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{(meta.text || "").slice(0, 60)}…</div>
                        </div>
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => handleDeleteCustom(key)}
                        style={{ color: "var(--danger)", fontSize: 13, flexShrink: 0 }}
                        title="Xóa preset này"
                      >🗑️</button>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {tab === "custom" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                Tuỳ chỉnh hoàn toàn prompt ngữ cảnh gửi cho AI. Bạn có thể lưu lại để dùng lần sau.
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Prompt ngữ cảnh tuỳ chỉnh</label>
                <textarea
                  rows={6}
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  placeholder="Nhập hướng dẫn dịch cho AI... (VD: Dịch theo phong cách manga, giữ nguyên tên riêng tiếng Nhật)"
                  style={{ fontFamily: "monospace", fontSize: 13 }}
                />
              </div>

              {/* Quickly load from builtin */}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, color: "var(--text-muted)", alignSelf: "center" }}>Nạp từ preset:</span>
                {allBuiltinEntries.map(([key, meta]) => (
                  <button
                    key={key}
                    className="btn btn-ghost btn-sm"
                    style={{ fontSize: 11 }}
                    onClick={() => setCustomPrompt(meta.text)}
                  >
                    {meta.icon} {meta.label}
                  </button>
                ))}
              </div>

              {/* Save form */}
              {showSaveForm ? (
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    value={saveName}
                    onChange={(e) => setSaveName(e.target.value)}
                    placeholder="Tên preset (VD: Anime lồng tiếng)"
                    style={{ flex: 1 }}
                    onKeyDown={(e) => e.key === "Enter" && handleSaveCustom()}
                    autoFocus
                  />
                  <button className="btn btn-primary btn-sm" onClick={handleSaveCustom} disabled={!saveName.trim()}>
                    Lưu
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => { setShowSaveForm(false); setSaveName(""); }}>
                    Huỷ
                  </button>
                </div>
              ) : (
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => setShowSaveForm(true)}
                  disabled={!customPrompt.trim()}
                  style={{ alignSelf: "flex-start" }}
                >
                  💾 Lưu preset này
                </button>
              )}
            </div>
          )}

          {/* Tone selection (luôn hiện) */}
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: "var(--text-secondary)" }}>
              🎭 Giọng điệu bản dịch
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {TONE_OPTIONS.map(t => (
                <button
                  key={t.key}
                  onClick={() => setSelectedTone(t.key)}
                  style={{
                    flex: 1, padding: "10px 8px", borderRadius: "var(--radius-md)",
                    background: selectedTone === t.key ? "rgba(99,102,241,0.12)" : "var(--bg-elevated)",
                    border: `1px solid ${selectedTone === t.key ? "var(--border-focus)" : "var(--border)"}`,
                    cursor: "pointer", textAlign: "center",
                    transition: "all 0.15s",
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>{t.label}</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3 }}>{t.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Full prompt preview */}
          <details style={{ marginTop: 16 }}>
            <summary style={{ fontSize: 12, cursor: "pointer", color: "var(--text-muted)", userSelect: "none" }}>
              👁 Xem trước prompt đầy đủ sẽ gửi cho AI
            </summary>
            <pre style={{
              marginTop: 8, padding: "12px", fontSize: 11,
              fontFamily: "monospace", lineHeight: 1.6,
              background: "var(--bg-elevated)", borderRadius: "var(--radius-md)",
              border: "1px solid var(--border)", color: "var(--text-secondary)",
              whiteSpace: "pre-wrap", wordBreak: "break-word",
            }}>
              {fullPromptPreview}
            </pre>
          </details>
        </div>

        {/* Footer */}
        <div style={{
          padding: "12px 24px", borderTop: "1px solid var(--border)",
          display: "flex", gap: 8, alignItems: "center",
        }}>
          <div style={{ flex: 1, fontSize: 12, color: "var(--text-muted)" }}>
            <strong style={{ color: "var(--text-primary)" }}>{activeLabel}</strong> · Giọng: {TONE_OPTIONS.find(t => t.key === selectedTone)?.label}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Huỷ</button>
          <button className="btn btn-primary" onClick={handleConfirm}>
            ✅ Áp dụng ngữ cảnh này
          </button>
        </div>
      </div>
    </div>
  );
}
