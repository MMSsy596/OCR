import { BusyInline } from "./BusyState";

export function PipelineBlock({
  wizardStep,
  selectedProjectId,
  hasSavedRoi,
  requiresRoi,
  runtimeCapabilities,
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
  const inputMode = pipelineForm.input_mode || "video_ocr";
  const isAudioMode = inputMode === "audio_asr";
  const audioRuntimeReady = Boolean(
    runtimeCapabilities?.input_modes?.audio_asr?.available,
  );
  const capabilityTools = runtimeCapabilities?.tools || {};

  return (
    <section className={`block ${wizardStep === 3 ? "" : "hidden-step"}`}>
      <h2>Bước 3: Xử lý và log</h2>
      <BusyInline
        active={
          loading ||
          retryingStuckJobs ||
          latestPipelineJob?.status === "queued" ||
          latestPipelineJob?.status === "running"
        }
        label={
          retryingStuckJobs
            ? "Đang thử lại các job bị kẹt..."
            : loading
              ? "Đang gửi yêu cầu pipeline lên backend..."
              : latestPipelineJob?.status === "queued"
                ? "Pipeline đang chờ worker nhận..."
                : latestPipelineJob?.status === "running"
                  ? isAudioMode
                    ? "Pipeline đang nhận diện âm thanh, dịch và xuất subtitle..."
                    : "Pipeline đang OCR, dịch và xuất subtitle..."
                  : ""
        }
      />
      <details>
        <summary>Tùy chọn xử lý nâng cao</summary>
        <div className="inline-two">
          <label>
            Nguồn nhận diện
            <select
              value={inputMode}
              onChange={(e) =>
                setPipelineForm((prev) => ({
                  ...prev,
                  input_mode:
                    e.target.value === "audio_asr" && !audioRuntimeReady
                      ? "video_ocr"
                      : e.target.value,
                }))
              }
            >
              <option value="video_ocr">OCR từ khung hình video</option>
              <option value="audio_asr">
                {audioRuntimeReady
                  ? "Nhận diện từ âm thanh"
                  : "Nhận diện từ âm thanh (thiếu runtime)"}
              </option>
            </select>
          </label>
          <label>
            Provider âm thanh
            <select
              value={pipelineForm.audio_provider || "whisper_cli"}
              disabled={!isAudioMode}
              onChange={(e) =>
                setPipelineForm((prev) => ({
                  ...prev,
                  audio_provider: e.target.value,
                }))
              }
            >
              <option value="whisper_cli">Whisper CLI cục bộ</option>
            </select>
          </label>
        </div>
        {isAudioMode ? (
          <>
            <p className="hint">
              Chế độ này bỏ qua ROI, tách audio từ video rồi nhận diện lời nói thành subtitle.
              Máy cần có `ffmpeg` và `whisper` CLI cài sẵn.
            </p>
            {!audioRuntimeReady ? (
              <p className="error">
                Runtime âm thanh chưa sẵn sàng:
                {capabilityTools.ffmpeg?.available ? "" : " thiếu ffmpeg;"}
                {capabilityTools.ffprobe?.available ? "" : " thiếu ffprobe;"}
                {capabilityTools.whisper?.available ? "" : " thiếu whisper CLI."}
              </p>
            ) : (
              <p className="hint">
                Runtime âm thanh đã sẵn sàng.
                {" "}
                {runtimeCapabilities?.recommendations?.audio_asr_hint || ""}
              </p>
            )}
            <div className="inline-two">
              <label>
                Model ASR
                <select
                  value={pipelineForm.audio_asr_model || "base"}
                  onChange={(e) =>
                    setPipelineForm((prev) => ({
                      ...prev,
                      audio_asr_model: e.target.value,
                    }))
                  }
                >
                  <option value="tiny">tiny</option>
                  <option value="base">base</option>
                  <option value="small">small</option>
                  <option value="medium">medium</option>
                </select>
              </label>
              <label>
                Ngôn ngữ audio
                <input
                  value={pipelineForm.audio_asr_language || "zh"}
                  onChange={(e) =>
                    setPipelineForm((prev) => ({
                      ...prev,
                      audio_asr_language: e.target.value,
                    }))
                  }
                  placeholder="Ví dụ: zh, en, ja"
                />
              </label>
            </div>
            <div className="inline-two">
              <label>
                Độ dài chunk audio (giây)
                <input
                  type="number"
                  min="60"
                  max="3600"
                  step="30"
                  value={pipelineForm.audio_chunk_sec || 600}
                  onChange={(e) =>
                    setPipelineForm((prev) => ({
                      ...prev,
                      audio_chunk_sec: Number(e.target.value),
                    }))
                  }
                />
              </label>
              <label>
                Overlap chunk (giây)
                <input
                  type="number"
                  min="0"
                  max="30"
                  step="1"
                  value={pipelineForm.audio_chunk_overlap_sec || 4}
                  onChange={(e) =>
                    setPipelineForm((prev) => ({
                      ...prev,
                      audio_chunk_overlap_sec: Number(e.target.value),
                    }))
                  }
                />
              </label>
            </div>
          </>
        ) : null}
        <label>
          Khóa API Gemini (tùy chọn)
          <input
            type="password"
            value={pipelineForm.gemini_api_key}
            onChange={(e) =>
              setPipelineForm((prev) => ({
                ...prev,
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
              setPipelineForm((prev) => ({
                ...prev,
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
          disabled={isAudioMode}
          onChange={(e) =>
            setPipelineForm((prev) => ({
              ...prev,
              scan_interval_sec: Number(e.target.value),
            }))
          }
        />
      </label>
      {isAudioMode ? (
        <p className="hint">
          OCR theo khung hình đã tắt. Pipeline sẽ chạy{" "}
          <code>audio -&gt; ASR -&gt; dịch -&gt; xuất subtitle</code>.
        </p>
      ) : null}
      <button
        disabled={
          loading ||
          !selectedProjectId ||
          (requiresRoi && !hasSavedRoi) ||
          (isAudioMode && !audioRuntimeReady)
        }
        onClick={startPipeline}
      >
        Chạy quy trình
      </button>
      {isAudioMode ? (
        <p className="hint">
          Gợi ý cấu hình cho video dài:
          {" "}
          <code>30-60 phút: chunk 480-600s</code>
          {"; "}
          <code>1-2 giờ: chunk 600-900s, overlap 4-6s</code>.
        </p>
      ) : null}
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
            <strong>Mode đầu vào:</strong>{" "}
            {latestPipelineJob?.artifacts?.input_mode ||
              latestPipelineJob?.artifacts?.request_payload?.input_mode ||
              "video_ocr"}
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
          {latestJobStats?.audio_live ? (
            <p>
              <strong>Audio realtime:</strong>{" "}
              {latestJobStats.audio_live.chunks_done ?? 0}/
              {latestJobStats.audio_live.chunks_total ?? 0} chunk{" "}
              ({Number(latestJobStats.audio_live.progress_pct || 0).toFixed(1)}%)
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
