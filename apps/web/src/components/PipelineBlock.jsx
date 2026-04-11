import { BusyInline } from "./BusyState";

export function PipelineBlock({
  wizardStep,
  selectedProjectId,
  hasSavedRoi,
  pipelineForm,
  setPipelineForm,
  translationPreset,
  setTranslationPreset,
  translationTone,
  setTranslationTone,
  translationExtraRule,
  setTranslationExtraRule,
  autoApplyPromptPreset,
  setAutoApplyPromptPreset,
  applyPresetToCurrentProject,
  retryingStuckJobs,
  loading,
  retryStuckJobs,
  startPipeline,
  PROMPT_PRESETS,
  latestPipelineJob,
  latestJobStats,
  latestJobEvents,
  streamState,
  streamErrorCount,
  formatEventTime,
  formatValue,
}) {
  return (
    <section className={`block ${wizardStep === 3 ? "" : "hidden-step"}`}>
      <h2>Bước 3: OCR và log</h2>
      <BusyInline
        active={loading || retryingStuckJobs || latestPipelineJob?.status === "queued" || latestPipelineJob?.status === "running"}
        label={
          retryingStuckJobs
            ? "Đang thử lại các job bị kẹt..."
            : loading
              ? "Đang gửi yêu cầu pipeline lên backend..."
              : latestPipelineJob?.status === "queued"
                ? "Pipeline đang chờ worker nhận..."
                : latestPipelineJob?.status === "running"
                  ? "Pipeline đang OCR, dịch và xuất subtitle..."
                  : ""
        }
      />
      <details>
        <summary>Tùy chọn OCR nâng cao</summary>
        <label>
          Khóa API Gemini (tùy chọn)
          <input
            type="password"
            value={pipelineForm.gemini_api_key}
            onChange={(e) =>
              setPipelineForm((f) => ({
                ...f,
                gemini_api_key: e.target.value,
              }))
            }
          />
        </label>
        <div className="inline-two">
          <label>
            Preset ngữ cảnh dịch
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
            Tone dịch
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
          Rule bổ sung cho ngữ cảnh dịch
          <input
            value={translationExtraRule}
            onChange={(e) => setTranslationExtraRule(e.target.value)}
            placeholder="Ví dụ: hội thoại nam chính nói ngắn, lạnh"
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={autoApplyPromptPreset}
            onChange={(e) => setAutoApplyPromptPreset(e.target.checked)}
          />
          Tự áp preset/tone vào prompt dự án trước khi chạy dịch
        </label>
        <button type="button" onClick={applyPresetToCurrentProject}>
          Áp preset vào dự án hiện tại
        </button>
        <label>
          Ánh xạ giọng đọc
          <textarea
            rows={3}
            value={pipelineForm.voiceMapText}
            onChange={(e) =>
              setPipelineForm((f) => ({
                ...f,
                voiceMapText: e.target.value,
              }))
            }
          />
        </label>
        <button disabled={retryingStuckJobs || loading} onClick={retryStuckJobs}>
          {retryingStuckJobs
            ? "Đang thử lại tác vụ trong hàng đợi..."
            : "Thử lại tác vụ trong hàng đợi cũ"}
        </button>
      </details>
      <label>
        Khoảng quét OCR (giây/lần)
        <input
          type="number"
          step="0.1"
          min="0.1"
          max="10"
          value={pipelineForm.scan_interval_sec}
          onChange={(e) =>
            setPipelineForm((f) => ({
              ...f,
              scan_interval_sec: Number(e.target.value),
            }))
          }
        />
      </label>
      <button
        disabled={loading || !selectedProjectId || !hasSavedRoi}
        onClick={startPipeline}
      >
        Chạy quy trình
      </button>
      {latestPipelineJob ? (
        <div className="info">
          <p>
            <strong>Bước:</strong> {latestPipelineJob?.step || "-"}
          </p>
          <p>
            <strong>Loại tác vụ:</strong>{" "}
            {latestPipelineJob?.artifacts?.job_kind || "pipeline"}
          </p>
          <p>
            <strong>Realtime:</strong>{" "}
            {streamState === "open"
              ? "đang stream SSE"
              : streamState === "connecting"
                ? "đang kết nối SSE"
                : streamErrorCount > 0
                  ? `fallback polling (${streamErrorCount} lần ngắt stream)`
                  : "polling"}
          </p>
          <p>
            <strong>Tiến độ:</strong> {latestPipelineJob?.progress ?? 0}%
          </p>
          {latestJobStats?.ocr_live ? (
            <p>
              <strong>OCR realtime:</strong>{" "}
              {latestJobStats.ocr_live.frames_sampled ?? 0}/
              {latestJobStats.ocr_live.estimated_samples ?? 0} frame{" "}
              ({Number(latestJobStats.ocr_live.progress_pct || 0).toFixed(1)}%)
            </p>
          ) : null}
          {latestPipelineJob?.artifacts?.translation_stats ? (
            <p>
              <strong>Dịch:</strong>{" "}
              {JSON.stringify(latestPipelineJob.artifacts.translation_stats)}
            </p>
          ) : null}
          {latestPipelineJob?.artifacts?.translation_error_hint ? (
            <p className="error">
              {latestPipelineJob.artifacts.translation_error_hint}
            </p>
          ) : null}
          {Object.keys(latestJobStats).length > 0 ? (
            <details>
              <summary>Chi tiết thông số xử lý</summary>
              {Object.entries(latestJobStats).map(([phase, payload]) => (
                <div key={phase} style={{ marginTop: 8 }}>
                  <p>
                    <strong>{phase}</strong>
                  </p>
                  {Object.entries(payload || {}).map(([k, v]) => (
                    <p key={`${phase}-${k}`}>
                      {k}: {formatValue(v)}
                    </p>
                  ))}
                </div>
              ))}
            </details>
          ) : null}
          {latestJobEvents.length > 0 ? (
            <details>
              <summary>Tiến trình xử lý (nhật ký chi tiết)</summary>
              <div style={{ maxHeight: 220, overflow: "auto", marginTop: 8 }}>
                {latestJobEvents.map((event, idx) => (
                  <p key={`${event.time || idx}-${idx}`}>
                    [{formatEventTime(event.time)}] [{event.phase}] [
                    {event.level || "info"}] ({event.progress ?? "-"}%):{" "}
                    {event.message}
                  </p>
                ))}
              </div>
            </details>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
