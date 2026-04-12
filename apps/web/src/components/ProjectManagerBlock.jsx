import { BusyInline } from "./BusyState";

export function ProjectManagerBlock({
  projects,
  selectedProjectId,
  setSelectedProjectId,
  statusLabel,
  clearingSessions,
  clearOldSessions,
  forceClearingSessions,
  forceClearAllSessions,
  projectForm,
  setProjectForm,
  translationPreset,
  setTranslationPreset,
  translationTone,
  setTranslationTone,
  translationExtraRule,
  setTranslationExtraRule,
  PROMPT_PRESETS,
  applyPresetToCreateForm,
  creating,
  createProject,
}) {
  const deletingNow = clearingSessions || forceClearingSessions;

  return (
    <section className="block">
      <h2>Dự án</h2>
      <label>
        Chọn dự án đang làm
        <select
          value={selectedProjectId}
          onChange={(e) => setSelectedProjectId(e.target.value)}
        >
          <option value="">-- Chọn dự án --</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({statusLabel(p.status)})
            </option>
          ))}
        </select>
      </label>

      <BusyInline
        active={deletingNow}
        label={
          forceClearingSessions
            ? "Đang xóa tất cả phiên và dọn storage..."
            : clearingSessions
              ? "Đang xóa phiên cũ..."
              : ""
        }
      />
      <div className="inline-two">
        <button
          type="button"
          disabled={deletingNow}
          onClick={clearOldSessions}
        >
          {clearingSessions ? "Đang xóa..." : "Xóa phiên cũ ngay"}
        </button>
        <button
          type="button"
          disabled={deletingNow}
          onClick={forceClearAllSessions}
        >
          {forceClearingSessions ? "Đang xóa..." : "Xóa tất cả ngay"}
        </button>
      </div>
      <p className="hint">
        Thao tác xóa chạy ngay lập tức, không hiện hộp xác nhận.
      </p>

      <BusyInline active={creating} label="Đang tạo dự án mới..." />
      <label>
        Tên dự án
        <input
          value={projectForm.name}
          onChange={(e) =>
            setProjectForm((f) => ({ ...f, name: e.target.value }))
          }
          placeholder="Ví dụ: Dự án Solar"
        />
      </label>
      <div className="inline-two">
        <label>
          Ngôn ngữ nguồn
          <input
            value={projectForm.source_lang}
            onChange={(e) =>
              setProjectForm((f) => ({ ...f, source_lang: e.target.value }))
            }
          />
        </label>
        <label>
          Ngôn ngữ đích
          <input
            value={projectForm.target_lang}
            onChange={(e) =>
              setProjectForm((f) => ({ ...f, target_lang: e.target.value }))
            }
          />
        </label>
      </div>
      <button type="button" disabled={creating || !projectForm.name?.trim()} onClick={createProject}>
        {creating ? "Đang tạo..." : "Tạo dự án mới"}
      </button>

      <details>
        <summary>Tùy chọn dịch nâng cao</summary>
        <label>
          Lời nhắc
          <textarea
            rows={2}
            value={projectForm.prompt}
            onChange={(e) =>
              setProjectForm((f) => ({ ...f, prompt: e.target.value }))
            }
          />
        </label>
        <div className="inline-two">
          <label>
            Preset ngữ cảnh
            <select
              value={translationPreset}
              onChange={(e) => setTranslationPreset(e.target.value)}
            >
              {Object.entries(PROMPT_PRESETS).map(([key, item]) => (
                <option key={key} value={key}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Giọng điệu
            <select
              value={translationTone}
              onChange={(e) => setTranslationTone(e.target.value)}
            >
              <option value="accurate">Chính xác</option>
              <option value="natural">Tự nhiên</option>
              <option value="witty">Dí dỏm</option>
              <option value="teasing">Trêu ghẹo</option>
              <option value="dramatic">Kịch tính</option>
            </select>
          </label>
        </div>
        <label>
          Yêu cầu bổ sung (tùy chọn)
          <input
            value={translationExtraRule}
            onChange={(e) => setTranslationExtraRule(e.target.value)}
            placeholder="Ví dụ: dùng xưng hô huynh - muội cho cặp chính"
          />
        </label>
        <button type="button" onClick={applyPresetToCreateForm}>
          Nạp preset vào lời nhắc
        </button>
        <label>
          Bảng thuật ngữ
          <textarea
            rows={3}
            value={projectForm.glossary}
            onChange={(e) =>
              setProjectForm((f) => ({ ...f, glossary: e.target.value }))
            }
          />
        </label>
      </details>
    </section>
  );
}
