import { startTransition, useEffect, useMemo, useState } from "react";
import { CapcutImportModal } from "./components/CapcutImportModal";
import { GeminiKeyManager } from "./components/GeminiKeyManager";
import { TranslationContextModal } from "./components/TranslationContextModal";
import { NotificationIsland } from "./components/NotificationIsland";
import { WizardNav } from "./components/WizardNav";
import { Step1Project } from "./components/steps/Step1Project";
import { Step2Upload } from "./components/steps/Step2Upload";
import { Step3Region } from "./components/steps/Step3Region";
import { Step4Run } from "./components/steps/Step4Run";
import { Step5Export } from "./components/steps/Step5Export";
import { Step6Dub } from "./components/steps/Step6Dub";
import { Step7Result } from "./components/steps/Step7Result";
import { useProjectActions } from "./hooks/useProjectActions";
import { useProjectRealtime } from "./hooks/useProjectRealtime";
import { useProjectWizard } from "./hooks/useProjectWizard";
import { useRoiEditor } from "./hooks/useRoiEditor";
import { useSubtitleActions } from "./hooks/useSubtitleActions";
import { useSubtitleEditor } from "./hooks/useSubtitleEditor";
import { appendApiToken, readApiErrorMessage, withApiAuth } from "./lib/api";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8000";

/* ── helpers ── */
async function jsonFetch(url, options = {}) {
  const res = await fetch(url, withApiAuth(options));
  if (!res.ok) throw new Error(await readApiErrorMessage(res, `HTTP ${res.status}`));
  return res.json();
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

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
  const n = normalizeRoi(roi);
  return n.w > 0.01 && n.h > 0.01;
}

function isQueuedJob(job) {
  return job?.status === "queued";
}

function jobTimeValue(job) {
  const candidates = [job?.updated_at, job?.created_at, job?.artifacts?.last_event?.time];
  for (const value of candidates) {
    const parsed = value ? Date.parse(value) : Number.NaN;
    if (!Number.isNaN(parsed)) return parsed;
  }
  return 0;
}

function pickLatestByKind(jobs, kind) {
  const pool = (jobs || [])
    .filter((j) => (j?.artifacts?.job_kind || "pipeline") === kind)
    .sort((a, b) => jobTimeValue(b) - jobTimeValue(a));
  if (!pool.length) return null;
  return pool.find((j) => j.status === "running")
      || pool.find((j) => isQueuedJob(j) && jobTimeValue(pool[0]) - jobTimeValue(j) < 15000)
      || pool.find((j) => j.status === "done" || j.status === "failed")
      || pool[0];
}
function pickDubAudioJob(jobs) {
  const pool = (jobs || []).filter((j) => j?.artifacts?.job_kind === "dub");
  return pool.find((j) => j?.artifacts?.dubbed_audio)
      || pool.find((j) => j.status === "done" && j?.artifacts?.dub_output_key)
      || null;
}

function inferTone(text) {
  const t = String(text || "").trim().toLowerCase();
  if (!t) return "info";
  if (t.startsWith("lỗi") || t.includes(" thất bại") || t.includes("không ")) return "error";
  if (t.startsWith("chọn ") || t.startsWith("cần ") || t.startsWith("chưa ")) return "warning";
  if (t.startsWith("đã ") || t.includes("thành công") || t.includes("hoàn tất")) return "success";
  return "info";
}
function inferTitle(text, tone) {
  if (tone === "error") return "Có lỗi";
  if (tone === "warning") return "Cần chú ý";
  if (tone === "success") return "Hoàn tất";
  const t = String(text || "").trim();
  if (t.startsWith("Đang ") || t.startsWith("Đã nhận ")) return "Đang xử lý";
  return "Thông báo";
}

const PROMPT_PRESETS = {
  historical:    { label: "Phim cổ trang",    text: "Dịch theo văn phong cổ trang, tự nhiên, dễ nghe, giữ thần thái hội thoại. Ưu tiên xưng hô theo quan hệ nhân vật và cấp bậc. Không dịch thô và không viết dài dòng." },
  modern_short:  { label: "Phim hiện đại",    text: "Dịch theo văn phong hiện đại, đối thoại gọn, đời thường, tự nhiên như người Việt nói. Ưu tiên tốc độ đọc subtitle, tránh câu quá dài." },
  fantasy:       { label: "Huyền huyễn",       text: "Dịch theo phong cách huyền huyễn, tạo cảm giác kỳ ảo nhưng vẫn rõ nghĩa. Thuật ngữ sức mạnh và bối cảnh cần nhất quán." },
  cultivation:   { label: "Tu tiên",           text: "Dịch đúng văn mạch tu tiên, giữ tinh thần cấp bậc tu vi, công pháp, linh căn, cảnh giới. Ưu tiên nhất quán thuật ngữ theo glossary." },
  reincarnation: { label: "Chuyển sinh",       text: "Dịch rõ cấu trúc kể chuyện chuyển sinh, giữ logic thời gian trước/sau chuyển sinh. Hạn chế lặp lại và tạo nhịp kể chuyện mạch lạc." },
  review:        { label: "Review phim",       text: "Dịch theo văn review phim, rõ ý, dễ hiểu, liên kết nguyên nhân-kết quả. Khi cần, diễn đạt thành câu nhận xét tự nhiên cho người xem Việt." },
};
const TONE_PRESETS = {
  accurate: "Giọng điệu chính xác, trung lập, ưu tiên sát nghĩa và rõ ý.",
  natural:  "Giọng điệu tự nhiên, mềm mại, đối thoại như người Việt bản địa.",
  dramatic: "Giọng điệu kịch tính, đầy cảm xúc, phù hợp cảnh cao trào.",
};

function composePrompt(presetKey, toneKey, customOverride) {
  if (customOverride) return customOverride;
  const pre  = PROMPT_PRESETS[presetKey]?.text || PROMPT_PRESETS.historical.text;
  const tone = TONE_PRESETS[toneKey] || TONE_PRESETS.accurate;
  return [
    "Mục tiêu: dịch subtitle đúng ngữ cảnh, giữ ý nghĩa đầy đủ, ngôn ngữ tự nhiên.",
    `Thể loại: ${pre}`,
    `Giọng điệu: ${tone}`,
    "Ràng buộc: Không tự ý thêm ý mới. Giữ nhất quán cách xưng hô, tên riêng, thuật ngữ và glossary.",
    "Ràng buộc: Trả về câu dịch gọn, dễ đọc trên subtitle, không kèm giải thích.",
  ].join("\n");
}

function parseVoiceMap(input) {
  return input.split("\n").map((l) => l.trim()).filter(Boolean).reduce((acc, l) => {
    const [k, v] = l.split("=", 2);
    if (k && v) acc[k.trim()] = v.trim();
    return acc;
  }, {});
}

/* ═══════════════════════════════════════════════════════════ */
export function App() {
  const [projects, setProjects]           = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [jobs, setJobs]                   = useState([]);
  const [pipelineLoading, setPipelineLoading] = useState(false);
  const [lastExport, setLastExport]       = useState(null);
  const [notices, setNotices]             = useState([]);
  const [apiStatus, setApiStatus]         = useState("checking");
  const [runtimeCapabilities, setRuntimeCapabilities] = useState(null);
  const [syncPendingCount, setSyncPendingCount] = useState(0);
  const [showCapcutModal, setShowCapcutModal] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen]     = useState(true);
  const [showKeyManager, setShowKeyManager]   = useState(false);
  const [showContextModal, setShowContextModal] = useState(false);
  const [customPromptOverride, setCustomPromptOverride] = useState(null);

  const [projectForm, setProjectForm] = useState({
    name: "", source_lang: "zh", target_lang: "vi",
    prompt: "", glossary: "Đạo huynh=Sư huynh\nTiên tôn=Tiên Tôn",
    roi: { x: 0.05, y: 0.78, w: 0.9, h: 0.18 },
  });
  const [translationPreset, setTranslationPreset] = useState("historical");
  const [translationTone, setTranslationTone]     = useState("accurate");
  const [videoFile, setVideoFile]         = useState(null);
  const [sourceUrl, setSourceUrl]         = useState("");
  const [autoStartAfterIngest, setAutoStartAfterIngest] = useState(true);
  const [srtUploadFile, setSrtUploadFile] = useState(null);
  const [pipelineForm, setPipelineForm]   = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("pipeline_form_saved") || "{}");
      return {
        input_mode: saved.input_mode || "video_ocr",
        gemini_api_key: saved.gemini_api_key || "",
        gemini_models: saved.gemini_models || "gemini-2.5-flash-lite, gemini-2.5-flash, gemini-2.5-pro",
        voiceMapText: saved.voiceMapText || "character_a=male-deep\ncharacter_b=female-bright\nnarrator=narrator-neutral",
        scan_interval_sec: saved.scan_interval_sec || 1.5,
      };
    } catch {
      return {
        input_mode: "video_ocr", gemini_api_key: "",
        gemini_models: "gemini-2.5-flash-lite, gemini-2.5-flash, gemini-2.5-pro",
        voiceMapText: "character_a=male-deep\ncharacter_b=female-bright\nnarrator=narrator-neutral",
        scan_interval_sec: 1.5,
      };
    }
  });
  const [exportForm, setExportForm]       = useState({ export_format: "srt", content_mode: "translated" });
  const [dubForm, setDubForm]             = useState({
    srt_key: "manual.translated.srt", output_format: "wav",
    voice: "vi-VN-HoaiMyNeural", rate: "+0%", volume: "+0%", pitch: "+0Hz",
    match_video_duration: true,
    tts_engine: "edge",
    fpt_api_key: "",
    fpt_voice: "banmai",
    fpt_speed: 0,
  });

  /* ── notifications ── */
  function dismissNotice(id) {
    startTransition(() => setNotices((prev) => prev.filter((n) => n.id !== id)));
  }
  function setMessage(input) {
    const text = String(input || "").trim();
    if (!text) return;
    const tone = inferTone(text);
    const notice = { id: `${Date.now()}-${Math.random().toString(36).slice(2,8)}`, tone, title: inferTitle(text, tone), message: text, createdAt: Date.now() };
    startTransition(() => setNotices((prev) => [notice, ...prev].slice(0, 4)));
  }

  /* ── derived ── */
  const selectedProject = useMemo(() => projects.find((p) => p.id === selectedProjectId) || null, [projects, selectedProjectId]);
  const videoSrc = selectedProjectId ? appendApiToken(`${API_BASE}/projects/${selectedProjectId}/video`) : "";
  const pipelineInputMode = pipelineForm.input_mode || "video_ocr";

  const latestPipelineJob  = useMemo(() => pickLatestByKind(jobs, "pipeline"), [jobs]);
  const latestDubJob       = useMemo(() => pickLatestByKind(jobs, "dub"), [jobs]);
  const latestDubAudioJob  = useMemo(() => pickDubAudioJob(jobs), [jobs]);
  const latestDubAudioUrl  = useMemo(() => latestDubAudioJob?.artifacts?.dubbed_audio ? `${API_BASE}/jobs/${latestDubAudioJob.id}/artifact/dubbed_audio` : "", [latestDubAudioJob]);
  const latestDubAudioName = useMemo(() => latestDubAudioJob?.artifacts?.dub_output_key || "dub-output.wav", [latestDubAudioJob]);
  const latestJobEvents    = useMemo(() => [...(latestPipelineJob?.artifacts?.events || [])].slice(-30).reverse(), [latestPipelineJob]);
  const latestJobStats     = useMemo(() => latestPipelineJob?.artifacts?.stats || {}, [latestPipelineJob]);
  const latestDubEvents    = useMemo(() => [...(latestDubJob?.artifacts?.events || [])].slice(-20).reverse(), [latestDubJob]);

  /* ── hooks ── */
  const { editableSegments, setEditableSegments, isEditingSegments, setIsEditingSegments, currentVideoTime, setCurrentVideoTime, activeSegment, resetHistory, updateEditableSegment, mergeAdjacentDuplicateSegments, undoSegments, redoSegments, setUndoStack, setRedoStack } =
    useSubtitleEditor({ maxHistory: 100, setMessage });

  const { stageRef, roiDraft, setRoiDraft, roiEditMode, toggleRoiEditMode, beginDraw, beginMove, beginResize, onVideoTimeUpdate } =
    useRoiEditor({ normalizeRoi, selectedProject, setMessage, setCurrentVideoTime });

  const { wizardStep, setWizardStep, maxUnlockedStep, canGoNext, wizardSteps, statusLabel, hasSavedRoi, goToStep } =
    useProjectWizard({ selectedProject, selectedProjectId, latestPipelineJob, latestJobEvents, latestJobStats, editableSegments, jobs, hasValidRoi, pipelineInputMode, setMessage });

  const { streamState, streamErrorCount } = useProjectRealtime({
    apiBase: API_BASE, selectedProjectId, latestDubAudioJob, latestDubJob, jobs,
    isEditingSegments, loadProjectData, setProjects, setJobs, setWizardStep, setMessage,
  });

  const { creating, clearingSessions, forceClearingSessions, loading: projectLoading, savingRoi, ingestingUrl,
    createProject, clearOldSessions, forceClearAllSessions, uploadVideo, ingestVideoFromUrl, saveSelectedRoi,
    applyPresetToCurrentProject, syncPromptPresetForCurrentProjectIfEnabled } =
    useProjectActions({
      apiBase: API_BASE, jsonFetch, normalizeRoi, parseVoiceMap,
      loadProjectsSafe, loadProjectData, setProjects, setSelectedProjectId,
      setEditableSegments, setJobs, setMessage, setWizardStep,
      projectForm, sourceUrl, autoStartAfterIngest, pipelineForm,
      selectedProjectId, videoFile, roiDraft,
      composePrompt: () => composePrompt(translationPreset, translationTone, customPromptOverride),
      selectedProject, setProjectForm, setRoiDraft,
    });

  const { savingSegments, retranslating, exporting, dubbing, uploadingSrt, retryingStuckJobs,
    saveSegments, retranslateOnly, exportSubtitle, startDubAudio, uploadExternalSrt, downloadDubAudio, retryStuckJobs } =
    useSubtitleActions({
      apiBase: API_BASE, jsonFetch, selectedProjectId, editableSegments,
      setEditableSegments, setUndoStack, setRedoStack, setIsEditingSegments, setMessage,
      pipelineForm, exportForm, setLastExport, dubForm, setWizardStep,
      latestDubAudioUrl, latestDubAudioName, loadProjectData,
      syncPromptPresetForCurrentProjectIfEnabled,
    });

  /* ── CapCut import handler ── */
  async function handleCapcutImported(project, hasSrt) {
    setShowCapcutModal(false);
    await loadProjectsSafe();
    setSelectedProjectId(project.id);
    // Nếu có SRT và video → bước 4; chỉ có video → bước 3 (cài ROI)
    setWizardStep(hasSrt ? 4 : 3);
    setMessage(`Đã import dự án ${project.name} từ CapCut thành công!`);

  }

  /* ── data loading ── */
  function beginSync() {
    setSyncPendingCount((count) => count + 1);
  }
  function endSync() {
    setSyncPendingCount((count) => Math.max(0, count - 1));
  }

  async function loadProjectsSafe() {
    beginSync();
    try {
      const [data, cap, uiSettings] = await Promise.all([
        jsonFetch(`${API_BASE}/projects`),
        jsonFetch(`${API_BASE}/runtime/capabilities`).catch(() => null),
        jsonFetch(`${API_BASE}/admin/ui-settings`).catch(() => ({})),
      ]);
      setProjects(data);
      setRuntimeCapabilities(cap);
      
      // Khôi phục uiSettings từ backend (ghi đè localStorage nếu có)
      if (uiSettings && Object.keys(uiSettings).length > 0) {
        if (uiSettings.pipeline_form_saved) {
           setPipelineForm((prev) => ({...prev, ...uiSettings.pipeline_form_saved}));
           if (uiSettings.pipeline_form_saved.translationPreset) {
               setTranslationPreset(uiSettings.pipeline_form_saved.translationPreset);
           }
        }
        if (uiSettings.translation_context_custom_presets) {
           localStorage.setItem("translation_context_custom_presets", JSON.stringify(uiSettings.translation_context_custom_presets));
           // Dispatch event context
           window.dispatchEvent(new Event("storage"));
        }
      }
      
      setApiStatus("online");
      if (!selectedProjectId && data.length) setSelectedProjectId(data[0].id);
    } catch {
      setApiStatus("offline");
      setMessage(`Không kết nối được API. Hãy chạy backend.`);
    } finally {
      endSync();
    }
  }

  async function loadProjectData(projectId, opts = {}) {
    beginSync();
    try {
      const [incomingJobs, project] = await Promise.all([
        jsonFetch(`${API_BASE}/projects/${projectId}/jobs`),
        jsonFetch(`${API_BASE}/projects/${projectId}`),
      ]);
      if ((opts.includeSegments ?? true) && !isEditingSegments) {
        const segs = await jsonFetch(`${API_BASE}/projects/${projectId}/segments`);
        setEditableSegments(segs.map((r) => ({ ...r })));
        resetHistory();
      }
      setJobs(incomingJobs);
      setProjects((prev) => prev.map((p) => (p.id === project.id ? project : p)));
    } catch { /* Bỏ qua lỗi polling tạm thời */ }
    finally {
      endSync();
    }
  }

  /* ── effects ── */
  useEffect(() => { loadProjectsSafe(); }, []);
  useEffect(() => {
    setJobs([]); setEditableSegments([]); setLastExport(null);
    setSrtUploadFile(null); setCurrentVideoTime(0);
  }, [selectedProjectId, setCurrentVideoTime]);
  useEffect(() => {
    if (!notices.length) return;
    const ts = notices.map((n) => window.setTimeout(() => dismissNotice(n.id), n.tone === "error" ? 7200 : n.tone === "warning" ? 5400 : 3800));
    return () => ts.forEach(clearTimeout);
  }, [notices]);

  /* ── liveActivities for island ── */
  const liveActivities = useMemo(() => {
    const activities = [];
    const push = (item) => {
      if (!item) return;
      activities.push(item);
    };

    if (syncPendingCount > 0) push({ tone: "info", title: "Đang đồng bộ dữ liệu", message: "Ứng dụng vẫn đang tải dữ liệu mới nhất...", state: "waiting", priority: 12 });
    if (creating) push({ tone: "info", title: "Đang tạo dự án", message: "Khởi tạo metadata dự án...", state: "waiting", priority: 18 });
    if (projectLoading) push({ tone: "info", title: "Đang tải video", message: "Đang upload nguồn video vào dự án...", state: "waiting", priority: 18 });
    if (ingestingUrl) push({ tone: "info", title: "Đang nhận link video", message: "Đang tải nguồn từ URL...", state: "waiting", priority: 18 });
    if (savingRoi) push({ tone: "info", title: "Đang lưu vùng OCR", message: "Đang cập nhật ROI cho dự án...", state: "waiting", priority: 14 });
    if (pipelineLoading) push({ tone: "info", title: "Đang gửi job pipeline", message: "Đang đẩy job OCR/Dịch vào hàng đợi...", state: "waiting", priority: 20 });
    if (savingSegments) push({ tone: "info", title: "Đang lưu phụ đề", message: "Đang lưu chỉnh sửa subtitle...", state: "waiting", priority: 14 });
    if (retranslating) push({ tone: "info", title: "Đang dịch lại phụ đề", message: "Đang xử lý AI dịch lại toàn bộ...", state: "waiting", priority: 22 });
    if (exporting) push({ tone: "info", title: "Đang xuất phụ đề", message: "Đang tạo file export...", state: "waiting", priority: 16 });
    if (uploadingSrt) push({ tone: "info", title: "Đang tải SRT", message: "Đang upload file phụ đề ngoài...", state: "waiting", priority: 14 });
    if (dubbing) push({ tone: "info", title: "Đang gửi job lồng tiếng", message: "Đang tạo job dub audio...", state: "waiting", priority: 20 });
    if (retryingStuckJobs) push({ tone: "warning", title: "Đang retry job kẹt", message: "Đang khởi động lại các job thất bại/queued...", state: "waiting", priority: 21 });

    if (latestPipelineJob?.status === "running") {
      push({
        tone: "info",
        title: "Đang chạy OCR / dịch",
        progress: latestPipelineJob.progress ?? 0,
        message: latestJobEvents[0]?.message || "Pipeline đang xử lý video...",
        state: "running",
        priority: 26,
      });
    } else if (latestPipelineJob && isQueuedJob(latestPipelineJob)) {
      push({
        tone: "warning",
        title: "Đang chờ worker pipeline",
        progress: 0,
        message: "Job đang trong hàng đợi worker...",
        state: "waiting",
        priority: 24,
      });
    }

    if (latestDubJob?.status === "running") {
      push({
        tone: "info",
        title: "Đang dựng lồng tiếng",
        progress: latestDubJob.progress ?? 0,
        message: latestDubEvents[0]?.message || "Đang xử lý audio dub...",
        state: "running",
        priority: 27,
      });
    } else if (latestDubJob && isQueuedJob(latestDubJob)) {
      push({
        tone: "warning",
        title: "Đang chờ worker lồng tiếng",
        progress: 0,
        message: "Job lồng tiếng đang chờ xử lý...",
        state: "waiting",
        priority: 25,
      });
    }

    return activities;
  }, [
    creating,
    projectLoading,
    ingestingUrl,
    savingRoi,
    pipelineLoading,
    savingSegments,
    retranslating,
    exporting,
    uploadingSrt,
    dubbing,
    retryingStuckJobs,
    syncPendingCount,
    latestPipelineJob,
    latestDubJob,
    latestJobEvents,
    latestDubEvents,
  ]);

  /* ── pipeline start ── */
  async function startPipeline() {
    if (!selectedProjectId) return setMessage("Chọn dự án trước.");
    setPipelineLoading(true);
    try {
      await syncPromptPresetForCurrentProjectIfEnabled(true);
      await jsonFetch(`${API_BASE}/projects/${selectedProjectId}/pipeline/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input_mode: pipelineInputMode,
          gemini_api_key: pipelineForm.gemini_api_key || null,
          voice_map: parseVoiceMap(pipelineForm.voiceMapText),
          scan_interval_sec: Number(pipelineForm.scan_interval_sec) || 1.0,
        }),
      });
      setIsEditingSegments(false);
      await loadProjectData(selectedProjectId);
      setWizardStep(4);
    } catch (err) {
      setMessage(`Lỗi chạy quy trình: ${err.message}`);
    } finally {
      setPipelineLoading(false);
    }
  }

  const loading = pipelineLoading || projectLoading;

  /* ── wizard steps config ── */
  const stepsConfig = [
    { label: "Dự án" },
    { label: "Video" },
    { label: "Vùng OCR" },
    { label: "Xử lý" },
    { label: "Xuất SRT" },
    { label: "Âm thanh" },
    { label: "Kết quả" },
  ].map((s, i) => ({ ...s, maxUnlocked: maxUnlockedStep >= i + 1 ? i + 1 : Math.min(maxUnlockedStep + 1, i + 1) }));

  /* ── step props ── */
  const step1Props = {
    projects, selectedProjectId, setSelectedProjectId,
    projectForm, setProjectForm, creating, createProject,
    clearOldSessions, clearingSessions, translationPreset, setTranslationPreset,
    customPromptOverride,
    statusLabel,
    onOpenCapcutModal: () => setShowCapcutModal(true),
    onOpenContextModal: () => setShowContextModal(true),
  };
  const step2Props = {
    selectedProject, videoFile, setVideoFile, loading, uploadVideo,
    sourceUrl, setSourceUrl, autoStartAfterIngest, setAutoStartAfterIngest,
    ingestVideoFromUrl, ingestingUrl,
  };
  const step3Props = {
    selectedProject, videoSrc, stageRef, roiDraft, roiEditMode,
    toggleRoiEditMode, beginDraw, beginMove, beginResize, onVideoTimeUpdate,
    savingRoi, saveSelectedRoi, setRoiDraft, hasSavedRoi,
  };
  const step4Props = {
    selectedProject, hasSavedRoi, loading, startPipeline,
    latestPipelineJob, latestJobEvents, latestJobStats, pipelineForm, setPipelineForm,
    translationPreset, setTranslationPreset, streamState,
    retryingStuckJobs, retryStuckJobs, runtimeCapabilities,
    onNextStep: () => setWizardStep(5),
    onOpenContextModal: () => setShowContextModal(true),
  };
  const step5Props = {
    editableSegments, selectedProject, savingSegments, retranslating,
    exporting, uploadingSrt, exportForm, setExportForm,
    srtUploadFile, setSrtUploadFile, saveSegments,
    retranslateOnly, exportSubtitle, uploadExternalSrt,
    lastExport, undoSegments, redoSegments, updateEditableSegment,
    mergeAdjacentDuplicateSegments, currentVideoTime, activeSegment,
    onNextStep: () => setWizardStep(6),
  };
  const step6Props = {
    editableSegments, dubbing, dubForm, setDubForm,
    startDubAudio, latestDubJob, latestDubAudioUrl, latestDubAudioName,
    downloadDubAudio,
    onNextStep: () => setWizardStep(7),
  };
  const step7Props = {
    selectedProject, editableSegments, lastExport,
    exportSubtitle, exporting, exportForm, setExportForm,
    latestDubAudioUrl, latestDubAudioName, downloadDubAudio,
    latestPipelineJob, latestDubJob, videoSrc,
    onNewProject: () => { goToStep(1); },
  };

  const STEPS = [step1Props, step2Props, step3Props, step4Props, step5Props, step6Props, step7Props];
  const STEP_COMPONENTS = [Step1Project, Step2Upload, Step3Region, Step4Run, Step5Export, Step6Dub, Step7Result];
  const StepComponent = STEP_COMPONENTS[wizardStep - 1] || Step1Project;
  const stepProps = STEPS[wizardStep - 1] || step1Props;

  return (
    <div className="app-shell">
      {/* Sidebar */}
      <aside className={`sidebar ${isSidebarOpen ? "" : "collapsed"}`}>
        <div className="sidebar-header" style={{ padding: isSidebarOpen ? "20px 24px" : "20px 0", justifyContent: isSidebarOpen ? "flex-start" : "center", display: "flex", alignItems: "center", gap: 12 }}>
          <button 
            className="sidebar-toggle-btn"
            onClick={() => setIsSidebarOpen(!isSidebarOpen)} 
            style={{ background: "transparent", border: "none", color: "var(--text-secondary)", cursor: "pointer", fontSize: 18, width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "var(--radius-sm)" }}
            onMouseOver={(e) => e.currentTarget.style.background = "var(--bg-hover)"}
            onMouseOut={(e) => e.currentTarget.style.background = "transparent"}
            title={isSidebarOpen ? "Thu gọn (Thu hẹp sidebar)" : "Mở rộng"}
          >
            {isSidebarOpen ? "◀" : "▶"}
          </button>
          
          {isSidebarOpen && (
            <>
              <div className="app-logo-icon" style={{ background: "none", boxShadow: "none", padding: 0, overflow: "hidden", borderRadius: "var(--radius-sm)" }}>
                <img src="/favicon.png" alt="Solar OCR" style={{ width: 26, height: 26, objectFit: "cover", display: "block", borderRadius: "var(--radius-sm)" }} />
              </div>
              <h1 style={{fontSize: 15, fontWeight: 700, whiteSpace: "nowrap"}}>Solar OCR</h1>
            </>
          )}
        </div>

        {isSidebarOpen ? (
          <div style={{ padding: "16px 14px", flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
            <button
            className="btn btn-primary"
            style={{ width: "100%", justifyContent: "center" }}
            onClick={() => setSelectedProjectId("")}
          >
            + Tạo dự án mới
          </button>
          <button
            className="btn btn-ghost btn-sm"
            style={{ width: "100%", justifyContent: "center", gap: 6 }}
            onClick={() => setShowKeyManager(true)}
            title="Quản lý Gemini API Keys"
          >
            🔑 Quản lý Keys
          </button>
          
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-muted)", padding: "8px 0" }}>
              Gợi ý dự án
            </div>
            {projects.slice(0, 15).map((p) => (
              <div
                key={p.id}
                className={`project-card${p.id === selectedProjectId ? " active" : ""}`}
                style={{ marginBottom: 6 }}
                onClick={() => {
                  setSelectedProjectId(p.id);
                  // Tính step phù hợp từ dữ liệu project hiện có (không cần chờ fetch)
                  const targetStep = (() => {
                    if (!p.video_path) return 2;       // Chưa có video → bước Upload
                    if (!hasValidRoi(p.roi)) return 3; // Có video, chưa ROI → bước ROI
                    return 4;                           // Có cả hai → bước Xử lý
                  })();
                  setWizardStep(targetStep);
                }}
              >
                <div className="project-card-icon" style={{ width: 26, height: 26, fontSize: 13 }}>🎞️</div>
                <div style={{ minWidth: 0, overflow: "hidden" }}>
                  <div className="project-card-title" style={{ fontSize: 12 }} title={`${p.name}\nID: ${p.id}`}>{p.name}</div>
                  <div className="project-card-sub" style={{ fontSize: 10 }}>{p.source_lang} → {p.target_lang} · <span style={{ fontFamily: "monospace", opacity: 0.6 }}>{p.id.slice(0, 8)}</span></div>
                </div>
              </div>
            ))}
          </div>
        </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "center", paddingTop: 16 }}>
            <button
              style={{ background: "var(--text-primary)", color: "var(--bg-base)", width: 36, height: 36, borderRadius: "var(--radius-pill)", border: "none", cursor: "pointer", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center" }}
              title="Tạo dự án mới"
              onClick={() => {
                setIsSidebarOpen(true);
                setSelectedProjectId("");
              }}
            >
              +
            </button>
            <div style={{ height: 1, background: "var(--border)", width: "60%" }} />
            {projects.slice(0, 5).map(p => (
              <div 
                key={p.id}
                title={p.name}
                onClick={() => {
                  setSelectedProjectId(p.id);
                  const targetStep = p.video_path ? (hasValidRoi(p.roi) ? 4 : 3) : 2;
                  setWizardStep(targetStep);
                }}
                className={`project-card-icon ${p.id === selectedProjectId ? "active" : ""}`}
                style={{ 
                  cursor: "pointer", 
                  width: 32, height: 32, fontSize: 14, 
                  background: p.id === selectedProjectId ? "var(--accent)" : "var(--bg-elevated)", 
                  color: p.id === selectedProjectId ? "#fff" : "inherit" 
                }}
              >
                🎞️
              </div>
            ))}
          </div>
        )}
      </aside>

      {/* Main Area */}
      <div className="main-wrapper">
        <header className="app-header">
          {selectedProjectId ? (
            <WizardNav
              steps={wizardSteps}
              currentStep={wizardStep}
              maxUnlockedStep={maxUnlockedStep}
              onGoTo={goToStep}
            />
          ) : (
            <div style={{ flex: 1 }}></div>
          )}
          <div className={`status-pill ${apiStatus}`}>
            API {apiStatus === "online" ? "online" : apiStatus === "offline" ? "offline" : "..."}
          </div>
        </header>

        <main className="main-content">
          <StepComponent {...stepProps} />
        </main>
      </div>

      {/* Notifications */}
      <NotificationIsland
        liveActivities={liveActivities}
        notices={notices}
        onDismiss={dismissNotice}
      />

      {/* CapCut Import Modal */}
      {showCapcutModal && (
        <CapcutImportModal
          onClose={() => setShowCapcutModal(false)}
          onImported={handleCapcutImported}
        />
      )}

      {/* Gemini Key Manager */}
      {showKeyManager && (
        <GeminiKeyManager onClose={() => setShowKeyManager(false)} />
      )}

      {/* Translation Context Modal */}
      {showContextModal && (
        <TranslationContextModal
          currentPresetKey={translationPreset}
          currentCustomText={customPromptOverride || ""}
          currentTone={translationTone}
          onClose={() => setShowContextModal(false)}
          onConfirm={(result) => {
            setTranslationPreset(result.presetKey);
            setTranslationTone(result.toneKey);
            if (result.customPromptOverride) {
              setCustomPromptOverride(result.customPromptOverride);
            } else {
              setCustomPromptOverride(null);
            }
            setShowContextModal(false);
          }}
        />
      )}
    </div>
  );
}
