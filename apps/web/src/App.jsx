import { useEffect, useMemo, useState } from "react";
import { ExportDubBlock } from "./components/ExportDubBlock";
import { PipelineBlock } from "./components/PipelineBlock";
import { ProjectManagerBlock } from "./components/ProjectManagerBlock";
import { SubtitleEditorTable } from "./components/SubtitleEditorTable";
import { VideoUploadBlock } from "./components/VideoUploadBlock";
import { WizardNav } from "./components/WizardNav";
import { useProjectActions } from "./hooks/useProjectActions";
import { useProjectRealtime } from "./hooks/useProjectRealtime";
import { useProjectWizard } from "./hooks/useProjectWizard";
import { useRoiEditor } from "./hooks/useRoiEditor";
import { useSubtitleActions } from "./hooks/useSubtitleActions";
import { useSubtitleEditor } from "./hooks/useSubtitleEditor";
import { appendApiToken, readApiErrorMessage, withApiAuth } from "./lib/api";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8000";

async function jsonFetch(url, options = {}) {
  const res = await fetch(url, withApiAuth(options));
  if (!res.ok) {
    throw new Error(await readApiErrorMessage(res, `HTTP ${res.status}`));
  }
  return res.json();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeRoi(roi) {
  let x = clamp(Number(roi.x) || 0, 0, 0.99);
  let y = clamp(Number(roi.y) || 0, 0, 0.99);
  let w = clamp(Number(roi.w) || 0.2, 0.01, 1);
  let h = clamp(Number(roi.h) || 0.2, 0.01, 1);
  if (x + w > 1) w = 1 - x;
  if (y + h > 1) h = 1 - y;
  return { x, y, w: clamp(w, 0.01, 1), h: clamp(h, 0.01, 1) };
}

function hasValidRoi(roi) {
  if (!roi) return false;
  const normalized = normalizeRoi(roi);
  return normalized.w > 0.01 && normalized.h > 0.01;
}

function formatEventTime(isoText) {
  if (!isoText) return "-";
  const date = new Date(isoText);
  if (Number.isNaN(date.getTime())) return isoText;
  return date.toLocaleTimeString("vi-VN", { hour12: false });
}

function formatValue(value) {
  if (value === null || value === undefined) return "-";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

const PROMPT_PRESETS = {
  historical: {
    label: "Phim cổ trang",
    text:
      "Dịch theo văn phong cổ trang, tự nhiên, dễ nghe, giữ thần thái hội thoại. " +
      "Ưu tiên xưng hô theo quan hệ nhân vật và cấp bậc. Không dịch thô và không viết dài dòng.",
  },
  modern_short: {
    label: "Phim ngắn hiện đại",
    text:
      "Dịch theo văn phong hiện đại, đối thoại gọn, đời thường, tự nhiên như người Việt nói. " +
      "Ưu tiên tốc độ đọc subtitle, tránh câu quá dài.",
  },
  fantasy: {
    label: "Phim huyền huyễn",
    text:
      "Dịch theo phong cách huyền huyễn, tạo cảm giác kỳ ảo nhưng vẫn rõ nghĩa. " +
      "Thuật ngữ sức mạnh và bối cảnh cần nhất quán.",
  },
  cultivation: {
    label: "Tu tiên",
    text:
      "Dịch đúng văn mạch tu tiên, giữ tinh thần cấp bậc tu vi, công pháp, linh căn, cảnh giới. " +
      "Ưu tiên nhất quán thuật ngữ theo glossary.",
  },
  reincarnation: {
    label: "Chuyển sinh",
    text:
      "Dịch rõ cấu trúc kể chuyện chuyển sinh, giữ logic thời gian trước/sau chuyển sinh. " +
      "Hạn chế lặp lại và tạo nhịp kể chuyện mạch lạc.",
  },
  review: {
    label: "Review phim",
    text:
      "Dịch theo văn review phim, rõ ý, dễ hiểu, liên kết nguyên nhân-kết quả. " +
      "Khi cần, diễn đạt thành câu nhận xét tự nhiên cho người xem Việt.",
  },
};

const TONE_PRESETS = {
  accurate: "Giọng điệu chính xác, trung lập, ưu tiên sát nghĩa và rõ ý.",
  natural: "Giọng điệu tự nhiên, mềm mại, đối thoại như người Việt bản địa.",
  witty: "Giọng điệu dí dỏm, có chút hài hước nhẹ nhưng không lệch nghĩa.",
  teasing: "Giọng điệu trêu ghẹo nhẹ, lanh lợi, vẫn lịch sự và đúng ngữ cảnh.",
  dramatic: "Giọng điệu kịch tính, đầy cảm xúc, phù hợp cảnh cao trào.",
};

function composePromptFromPreset(presetKey, toneKey, extraRule) {
  const presetText = PROMPT_PRESETS[presetKey]?.text || PROMPT_PRESETS.historical.text;
  const toneText = TONE_PRESETS[toneKey] || TONE_PRESETS.accurate;
  const extra = String(extraRule || "").trim();
  const lines = [
    "Mục tiêu: dịch subtitle đúng ngữ cảnh, giữ ý nghĩa đầy đủ, ngôn ngữ tự nhiên.",
    `Thể loại: ${presetText}`,
    `Giọng điệu: ${toneText}`,
    "Ràng buộc: Không tự ý thêm ý mới. Nếu câu gốc mơ hồ, ưu tiên cách nói tự nhiên nhất theo ngữ cảnh trước/sau.",
    "Ràng buộc: Giữ nhất quán cách xưng hô, tên riêng, thuật ngữ và glossary.",
    "Ràng buộc: Trả về câu dịch gọn, dễ đọc trên subtitle, không kèm giải thích.",
  ];
  if (extra) {
    lines.push(`Yêu cầu bổ sung: ${extra}`);
  }
  return lines.join("\n");
}

export function App() {
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [jobs, setJobs] = useState([]);
  const [pipelineLoading, setPipelineLoading] = useState(false);
  const [lastExport, setLastExport] = useState(null);
  const [projectForm, setProjectForm] = useState({
    name: "Dự án NanBao",
    source_lang: "zh",
    target_lang: "vi",
    prompt: "Dịch theo văn phong phim cổ trang, tự nhiên, ngắn gọn.",
    glossary: "Đạo huynh=Sư huynh\nTiên tôn=Tiên Tôn",
    roi: { x: 0.1, y: 0.75, w: 0.8, h: 0.2 },
  });
  const [translationPreset, setTranslationPreset] = useState("historical");
  const [translationTone, setTranslationTone] = useState("accurate");
  const [translationExtraRule, setTranslationExtraRule] = useState("");
  const [autoApplyPromptPreset, setAutoApplyPromptPreset] = useState(true);
  const [videoFile, setVideoFile] = useState(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [autoStartAfterIngest, setAutoStartAfterIngest] = useState(true);
  const [srtUploadFile, setSrtUploadFile] = useState(null);
  const [pipelineForm, setPipelineForm] = useState({
    gemini_api_key: "",
    voiceMapText:
      "character_a=male-deep\ncharacter_b=female-bright\nnarrator=narrator-neutral",
    scan_interval_sec: 1.5,
  });
  const [exportForm, setExportForm] = useState({
    export_format: "srt",
    content_mode: "translated",
  });
  const [dubForm, setDubForm] = useState({
    srt_key: "manual.translated.srt",
    output_format: "wav",
    voice: "vi-VN-HoaiMyNeural",
    rate: "+0%",
    volume: "+0%",
    pitch: "+0Hz",
    match_video_duration: true,
  });
  const [message, setMessage] = useState("");
  const [apiStatus, setApiStatus] = useState("checking");

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId) || null,
    [projects, selectedProjectId],
  );
  const videoSrc = selectedProjectId
    ? appendApiToken(`${API_BASE}/projects/${selectedProjectId}/video`)
    : "";

  const {
    editableSegments,
    setEditableSegments,
    undoStack,
    setUndoStack,
    redoStack,
    setRedoStack,
    isEditingSegments,
    setIsEditingSegments,
    currentVideoTime,
    setCurrentVideoTime,
    activeSegment,
    resetHistory,
    updateEditableSegment,
    mergeAdjacentDuplicateSegments,
    undoSegments,
    redoSegments,
  } = useSubtitleEditor({
    maxHistory: 100,
    setMessage,
  });

  const {
    stageRef,
    roiDraft,
    setRoiDraft,
    roiEditMode,
    toggleRoiEditMode,
    beginDraw,
    beginMove,
    beginResize,
    onVideoTimeUpdate,
  } = useRoiEditor({
    normalizeRoi,
    selectedProject,
    setMessage,
    setCurrentVideoTime,
  });

  const latestPipelineJob = useMemo(
    () =>
      jobs.find((job) => (job?.artifacts?.job_kind || "pipeline") === "pipeline") ||
      null,
    [jobs],
  );
  const latestDubJob = useMemo(
    () => jobs.find((job) => job?.artifacts?.job_kind === "dub") || null,
    [jobs],
  );
  const latestDubAudioUrl = useMemo(
    () =>
      latestDubJob?.artifacts?.dubbed_audio
        ? `${API_BASE}/jobs/${latestDubJob.id}/artifact/dubbed_audio`
        : "",
    [latestDubJob],
  );
  const latestDubAudioName = useMemo(
    () => latestDubJob?.artifacts?.dub_output_key || "dub-output.wav",
    [latestDubJob],
  );
  const latestJobEvents = useMemo(
    () => [...(latestPipelineJob?.artifacts?.events || [])].slice(-30).reverse(),
    [latestPipelineJob],
  );
  const latestJobStats = useMemo(
    () => latestPipelineJob?.artifacts?.stats || {},
    [latestPipelineJob],
  );

  async function loadProjectsSafe() {
    try {
      const data = await jsonFetch(`${API_BASE}/projects`);
      setProjects(data);
      setApiStatus("online");
      if (!selectedProjectId && data.length) {
        setSelectedProjectId(data[0].id);
      }
    } catch (err) {
      setApiStatus("offline");
      setMessage(`Không kết nối được API ${API_BASE}. Hãy chạy backend.`);
      console.error(err);
    }
  }

  async function loadProjectData(projectId, options = {}) {
    const includeSegments = options.includeSegments ?? true;
    try {
      const [incomingJobs, project] = await Promise.all([
        jsonFetch(`${API_BASE}/projects/${projectId}/jobs`),
        jsonFetch(`${API_BASE}/projects/${projectId}`),
      ]);
      if (includeSegments && !isEditingSegments) {
        const segments = await jsonFetch(`${API_BASE}/projects/${projectId}/segments`);
        setEditableSegments(segments.map((row) => ({ ...row })));
        resetHistory();
      }
      setJobs(incomingJobs);
      setProjects((prev) => prev.map((item) => (item.id === project.id ? project : item)));
    } catch {
      // Bỏ qua lỗi polling tạm thời để không làm gián đoạn UI
    }
  }

  const {
    wizardStep,
    setWizardStep,
    maxUnlockedStep,
    canGoNext,
    wizardSteps,
    statusLabel,
    hasSavedRoi,
    goToStep,
  } = useProjectWizard({
    selectedProject,
    latestPipelineJob,
    latestJobEvents,
    latestJobStats,
    editableSegments,
    jobs,
    hasValidRoi,
    setMessage,
  });

  const { streamState, streamErrorCount } = useProjectRealtime({
    apiBase: API_BASE,
    selectedProjectId,
    latestDubJob,
    jobs,
    isEditingSegments,
    loadProjectData,
    setProjects,
    setJobs,
    setWizardStep,
    setMessage,
  });

  useEffect(() => {
    loadProjectsSafe();
  }, []);

  useEffect(() => {
    setJobs([]);
    setEditableSegments([]);
    setLastExport(null);
    setSrtUploadFile(null);
    setCurrentVideoTime(0);
  }, [selectedProjectId, setCurrentVideoTime]);

  const composeCurrentPrompt = () =>
    composePromptFromPreset(
      translationPreset,
      translationTone,
      translationExtraRule,
    );

  function parseVoiceMap(input) {
    return input
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .reduce((acc, line) => {
        const [k, v] = line.split("=", 2);
        if (k && v) acc[k.trim()] = v.trim();
        return acc;
      }, {});
  }

  const {
    creating,
    clearingSessions,
    forceClearingSessions,
    loading: projectLoading,
    savingRoi,
    ingestingUrl,
    createProject,
    clearOldSessions,
    forceClearAllSessions,
    uploadVideo,
    ingestVideoFromUrl,
    saveSelectedRoi,
    applyPresetToCreateForm,
    applyPresetToCurrentProject,
    syncPromptPresetForCurrentProjectIfEnabled,
  } = useProjectActions({
    apiBase: API_BASE,
    jsonFetch,
    normalizeRoi,
    parseVoiceMap,
    loadProjectsSafe,
    loadProjectData,
    setProjects,
    setSelectedProjectId,
    setEditableSegments,
    setJobs,
    setMessage,
    setWizardStep,
    projectForm,
    sourceUrl,
    autoStartAfterIngest,
    pipelineForm,
    selectedProjectId,
    videoFile,
    roiDraft,
    composePrompt: composeCurrentPrompt,
    selectedProject,
    setProjectForm,
    setRoiDraft,
  });

  const {
    savingSegments,
    retranslating,
    exporting,
    dubbing,
    uploadingSrt,
    retryingStuckJobs,
    saveSegments,
    retranslateOnly,
    exportSubtitle,
    startDubAudio,
    uploadExternalSrt,
    downloadDubAudio,
    retryStuckJobs,
  } = useSubtitleActions({
    apiBase: API_BASE,
    jsonFetch,
    selectedProjectId,
    editableSegments,
    setEditableSegments,
    setUndoStack,
    setRedoStack,
    setIsEditingSegments,
    setMessage,
    pipelineForm,
    exportForm,
    setLastExport,
    dubForm,
    setWizardStep,
    latestDubAudioUrl,
    latestDubAudioName,
    loadProjectData,
    syncPromptPresetForCurrentProjectIfEnabled,
  });

  const loading = pipelineLoading || projectLoading;

  async function startPipeline() {
    if (!selectedProjectId) {
      setMessage("Chọn dự án trước.");
      return;
    }
    setPipelineLoading(true);
    setMessage("");
    try {
      await syncPromptPresetForCurrentProjectIfEnabled(autoApplyPromptPreset);
      await jsonFetch(`${API_BASE}/projects/${selectedProjectId}/pipeline/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gemini_api_key: pipelineForm.gemini_api_key || null,
          voice_map: parseVoiceMap(pipelineForm.voiceMapText),
          scan_interval_sec: Number(pipelineForm.scan_interval_sec) || 1.0,
        }),
      });
      setIsEditingSegments(false);
      await loadProjectData(selectedProjectId);
      setMessage("Đã đưa quy trình xử lý vào hàng đợi.");
      setWizardStep(3);
    } catch (err) {
      setMessage(`Lỗi chạy quy trình xử lý: ${err.message}`);
    } finally {
      setPipelineLoading(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1>NanBao OCR Studio</h1>
        </div>
        <div className={`status-pill ${apiStatus}`}>
          API{" "}
          {apiStatus === "online"
            ? "đang hoạt động"
            : apiStatus === "offline"
              ? "mất kết nối"
              : "đang kiểm tra"}
        </div>
      </header>

      <WizardNav
        wizardSteps={wizardSteps}
        wizardStep={wizardStep}
        canGoNext={canGoNext}
        maxUnlockedStep={maxUnlockedStep}
        goToStep={goToStep}
        setWizardStep={setWizardStep}
      />

      {latestDubJob?.artifacts?.dubbed_audio ? (
        <section className="card" style={{ padding: 10, marginBottom: 12 }}>
          <strong>Âm thanh mới nhất:</strong>{" "}
          <a
            className="download-link"
            href={appendApiToken(`${API_BASE}/jobs/${latestDubJob.id}/artifact/dubbed_audio`)}
            target="_blank"
            rel="noreferrer"
          >
            {latestDubJob.artifacts.dub_output_key || "Tải file âm thanh"}
          </a>
        </section>
      ) : null}

      <main className="workspace">
        <aside className="sidebar card">
          <ProjectManagerBlock
            projects={projects}
            selectedProjectId={selectedProjectId}
            setSelectedProjectId={setSelectedProjectId}
            statusLabel={statusLabel}
            clearingSessions={clearingSessions}
            clearOldSessions={clearOldSessions}
            forceClearingSessions={forceClearingSessions}
            forceClearAllSessions={forceClearAllSessions}
            projectForm={projectForm}
            setProjectForm={setProjectForm}
            translationPreset={translationPreset}
            setTranslationPreset={setTranslationPreset}
            translationTone={translationTone}
            setTranslationTone={setTranslationTone}
            translationExtraRule={translationExtraRule}
            setTranslationExtraRule={setTranslationExtraRule}
            PROMPT_PRESETS={PROMPT_PRESETS}
            applyPresetToCreateForm={applyPresetToCreateForm}
            creating={creating}
            createProject={createProject}
          />

          <VideoUploadBlock
            wizardStep={wizardStep}
            videoFile={videoFile}
            setVideoFile={setVideoFile}
            loading={loading}
            uploadVideo={uploadVideo}
            sourceUrl={sourceUrl}
            setSourceUrl={setSourceUrl}
            autoStartAfterIngest={autoStartAfterIngest}
            setAutoStartAfterIngest={setAutoStartAfterIngest}
            ingestingUrl={ingestingUrl}
            selectedProjectId={selectedProjectId}
            ingestVideoFromUrl={ingestVideoFromUrl}
          />

          <section className={`block ${wizardStep === 2 ? "" : "hidden-step"}`}>
            <h2>Bước 2: ROI</h2>
            <button type="button" onClick={toggleRoiEditMode}>
              {roiEditMode ? "Tắt chỉnh ROI" : "Bật chỉnh ROI"}
            </button>
            <button
              type="button"
              disabled={savingRoi}
              onClick={saveSelectedRoi}
            >
              {savingRoi ? "Đang lưu ROI..." : "Lưu ROI cho dự án"}
            </button>
            <p className="hint">
              ROI hiện tại: x={roiDraft.x.toFixed(3)}, y={roiDraft.y.toFixed(3)},
              w={roiDraft.w.toFixed(3)}, h={roiDraft.h.toFixed(3)}
            </p>
          </section>

          <PipelineBlock
            wizardStep={wizardStep}
            selectedProjectId={selectedProjectId}
            hasSavedRoi={hasSavedRoi}
            pipelineForm={pipelineForm}
            setPipelineForm={setPipelineForm}
            translationPreset={translationPreset}
            setTranslationPreset={setTranslationPreset}
            translationTone={translationTone}
            setTranslationTone={setTranslationTone}
            translationExtraRule={translationExtraRule}
            setTranslationExtraRule={setTranslationExtraRule}
            autoApplyPromptPreset={autoApplyPromptPreset}
            setAutoApplyPromptPreset={setAutoApplyPromptPreset}
            applyPresetToCurrentProject={applyPresetToCurrentProject}
            retryingStuckJobs={retryingStuckJobs}
            loading={loading}
            retryStuckJobs={retryStuckJobs}
            startPipeline={startPipeline}
            PROMPT_PRESETS={PROMPT_PRESETS}
            latestPipelineJob={latestPipelineJob}
            latestJobStats={latestJobStats}
            latestJobEvents={latestJobEvents}
            streamState={streamState}
            streamErrorCount={streamErrorCount}
            formatEventTime={formatEventTime}
            formatValue={formatValue}
          />

          <section className={`block ${wizardStep === 4 ? "" : "hidden-step"}`}>
            <h2>Bước 4: Chỉnh subtitle</h2>
            <details>
              <summary>Công cụ chỉnh sửa thủ công</summary>
              <button
                disabled={savingSegments || editableSegments.length === 0}
                onClick={saveSegments}
              >
                {savingSegments ? "Đang lưu phụ đề..." : "Lưu phụ đề"}
              </button>
              <button disabled={undoStack.length === 0} onClick={undoSegments}>
                Hoàn tác (Ctrl+Z)
              </button>
              <button disabled={redoStack.length === 0} onClick={redoSegments}>
                Làm lại (Ctrl+Y)
              </button>
              <button
                disabled={editableSegments.length === 0}
                onClick={mergeAdjacentDuplicateSegments}
              >
                Gộp dòng trùng kề nhau
              </button>
              <button
                disabled={retranslating || editableSegments.length === 0}
                onClick={() => retranslateOnly(autoApplyPromptPreset)}
              >
                {retranslating ? "Đang dịch lại..." : "Dịch lại"}
              </button>
            </details>
          </section>

          <ExportDubBlock
            wizardStep={wizardStep}
            exportForm={exportForm}
            setExportForm={setExportForm}
            exporting={exporting}
            editableSegments={editableSegments}
            exportSubtitle={exportSubtitle}
            uploadingSrt={uploadingSrt}
            srtUploadFile={srtUploadFile}
            setSrtUploadFile={setSrtUploadFile}
            selectedProjectId={selectedProjectId}
            uploadExternalSrt={() => uploadExternalSrt(srtUploadFile, setDubForm)}
            dubForm={dubForm}
            setDubForm={setDubForm}
            dubbing={dubbing}
            startDubAudio={startDubAudio}
            lastExport={lastExport}
            latestDubJob={latestDubJob}
            latestDubAudioUrl={latestDubAudioUrl}
            downloadDubAudio={downloadDubAudio}
          />
        </aside>

        <section className="content">
          <section className={`card preview-card ${wizardStep === 1 ? "" : "hidden-step"}`}>
            <div className="row-head">
              <h2>Bước 1: Chuẩn bị video</h2>
              <span>{selectedProject?.name || "chưa chọn dự án"}</span>
            </div>
            {selectedProject?.video_path ? (
              <video
                src={videoSrc}
                controls
                className="preview-video"
                onTimeUpdate={onVideoTimeUpdate}
                onSeeked={onVideoTimeUpdate}
              />
            ) : (
              <p className="hint">Chưa có video trong dự án hiện tại.</p>
            )}
          </section>

          <section className={`card preview-card ${wizardStep === 2 ? "" : "hidden-step"}`}>
            <div className="row-head">
              <h2>Xem trước ROI</h2>
              <span>{selectedProject?.name || "chưa chọn dự án"}</span>
            </div>
            {selectedProject?.video_path ? (
              <>
                <p className="hint">
                  {roiEditMode
                    ? "Giữ Shift + kéo để tạo khung mới. Kéo khung hoặc góc để chỉnh ngay."
                    : "Tua video để kiểm tra phụ đề có nằm đúng ROI không."}
                </p>
                <div
                  className="preview-stage"
                  ref={stageRef}
                  onMouseDown={beginDraw}
                >
                  <video
                    src={videoSrc}
                    controls
                    className="preview-video"
                    onTimeUpdate={onVideoTimeUpdate}
                    onSeeked={onVideoTimeUpdate}
                  />
                  <div
                    className={`roi-box ${roiEditMode ? "editable" : "readonly"}`}
                    style={{
                      left: `${roiDraft.x * 100}%`,
                      top: `${roiDraft.y * 100}%`,
                      width: `${roiDraft.w * 100}%`,
                      height: `${roiDraft.h * 100}%`,
                    }}
                    onMouseDown={beginMove}
                  >
                    <div className="roi-label">ROI</div>
                    {roiEditMode ? (
                      <>
                        <div
                          className="roi-handle nw"
                          onMouseDown={(e) => beginResize("nw", e)}
                        />
                        <div
                          className="roi-handle ne"
                          onMouseDown={(e) => beginResize("ne", e)}
                        />
                        <div
                          className="roi-handle sw"
                          onMouseDown={(e) => beginResize("sw", e)}
                        />
                        <div
                          className="roi-handle se"
                          onMouseDown={(e) => beginResize("se", e)}
                        />
                      </>
                    ) : null}
                  </div>
                </div>
                <div className="timeline-card">
                  <p>
                    <strong>Thời gian:</strong> {currentVideoTime.toFixed(2)}s
                  </p>
                  {activeSegment ? (
                    <>
                      <p>
                        <strong>Đang hiển thị:</strong> #{activeSegment.id} (
                        {Number(activeSegment.start_sec).toFixed(2)} -{" "}
                        {Number(activeSegment.end_sec).toFixed(2)})
                      </p>
                      <p>
                        <strong>Gốc:</strong> {activeSegment.raw_text}
                      </p>
                      <p>
                        <strong>Dịch:</strong> {activeSegment.translated_text}
                      </p>
                    </>
                  ) : (
                    <p>Không có phụ đề tại mốc này.</p>
                  )}
                </div>
              </>
            ) : (
              <p className="hint">Tải video lên để bắt đầu xem trước.</p>
            )}
          </section>

          <section className={`card preview-card ${wizardStep === 3 ? "" : "hidden-step"}`}>
            <div className="row-head">
              <h2>Log OCR thời gian thực</h2>
              <span>
                {latestPipelineJob ? `${latestPipelineJob.progress}%` : "chưa có tác vụ"}
              </span>
            </div>
            {latestJobEvents.length > 0 ? (
              <div className="timeline-card" style={{ maxHeight: 260, overflow: "auto" }}>
                {latestJobEvents.map((event, idx) => (
                  <p key={`${event.time || idx}-${idx}`}>
                    [{formatEventTime(event.time)}] [{event.phase}] [{event.level || "info"}]
                    {" "}({event.progress ?? "-"}%): {event.message}
                  </p>
                ))}
              </div>
            ) : (
              <p className="hint">
                Chưa có log OCR. Hãy chạy pipeline để theo dõi tiến trình tách khung hình.
              </p>
            )}
          </section>

          <section className={`card editor-card ${wizardStep === 4 ? "" : "hidden-step"}`}>
            <div className="row-head">
              <h2>Chỉnh sửa phụ đề</h2>
              <span>{editableSegments.length} dòng</span>
            </div>
            <details>
              <summary>Mở bảng chỉnh sửa subtitle chi tiết</summary>
              <SubtitleEditorTable
                editableSegments={editableSegments}
                activeSegment={activeSegment}
                updateEditableSegment={updateEditableSegment}
              />
            </details>
          </section>
        </section>
      </main>

      {message ? <footer className="toast">{message}</footer> : null}
    </div>
  );
}
