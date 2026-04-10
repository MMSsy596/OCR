import { useEffect, useMemo, useRef, useState } from "react";
import { PipelineBlock } from "./components/PipelineBlock";
import { SubtitleEditorTable } from "./components/SubtitleEditorTable";
import { VideoUploadBlock } from "./components/VideoUploadBlock";
import { WizardNav } from "./components/WizardNav";
import { useProjectEventStream } from "./hooks/useProjectEventStream";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8000";

async function jsonFetch(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
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

function normalizeTextForMerge(text) {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "")
    .replace(/[.,;:!?'"`~\-_=+*/\\|()[\]{}<>,。!?;:、]/g, "");
}

function cloneSegments(segments) {
  return (segments || []).map((row) => ({ ...row }));
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
  const MAX_HISTORY = 100;
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [editableSegments, setEditableSegments] = useState([]);
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [clearingSessions, setClearingSessions] = useState(false);
  const [forceClearingSessions, setForceClearingSessions] = useState(false);
  const [savingRoi, setSavingRoi] = useState(false);
  const [savingSegments, setSavingSegments] = useState(false);
  const [retranslating, setRetranslating] = useState(false);
  const [uploadingSrt, setUploadingSrt] = useState(false);
  const [retryingStuckJobs, setRetryingStuckJobs] = useState(false);
  const [isEditingSegments, setIsEditingSegments] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [dubbing, setDubbing] = useState(false);
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
  const [ingestingUrl, setIngestingUrl] = useState(false);
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
  const [roiDraft, setRoiDraft] = useState({ x: 0.1, y: 0.75, w: 0.8, h: 0.2 });
  const [dragState, setDragState] = useState(null);
  const [currentVideoTime, setCurrentVideoTime] = useState(0);
  const [roiEditMode, setRoiEditMode] = useState(false);
  const [isShiftPressed, setIsShiftPressed] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [streamErrorCount, setStreamErrorCount] = useState(0);

  const stageRef = useRef(null);
  const segmentsRef = useRef([]);
  const pollTickRef = useRef(0);
  const jobsRef = useRef([]);
  const isEditingSegmentsRef = useRef(false);
  const lastDubDoneRef = useRef("");
  const hadActiveJobRef = useRef(false);
  const lastStreamSnapshotRef = useRef("");

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId) || null,
    [projects, selectedProjectId],
  );
  const videoSrc = selectedProjectId
    ? `${API_BASE}/projects/${selectedProjectId}/video`
    : "";
  const activeSegment = useMemo(() => {
    let left = 0;
    let right = editableSegments.length - 1;
    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      const seg = editableSegments[mid];
      const start = Number(seg.start_sec);
      const end = Number(seg.end_sec);
      if (currentVideoTime < start) {
        right = mid - 1;
        continue;
      }
      if (currentVideoTime > end) {
        left = mid + 1;
        continue;
      }
      return seg;
    }
    return null;
  }, [editableSegments, currentVideoTime]);
  const latestPipelineJob = useMemo(
    () =>
      jobs.find((job) => (job?.artifacts?.job_kind || "pipeline") === "pipeline") ||
      null,
    [jobs],
  );
  const latestDubJob = useMemo(
    () =>
      jobs.find(
        (job) =>
          job?.artifacts?.job_kind === "dub",
      ),
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
  const streamState = useProjectEventStream(selectedProjectId, {
    apiBase: API_BASE,
    enabled: Boolean(selectedProjectId),
    onSnapshot: (payload) => {
      const serialized = JSON.stringify(payload);
      if (serialized === lastStreamSnapshotRef.current) return;
      lastStreamSnapshotRef.current = serialized;

      const project = payload?.project || null;
      const incomingJobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
      const hadRunningBefore = (jobsRef.current || []).some(
        (job) => job?.status === "queued" || job?.status === "running",
      );
      const hasRunningNow = incomingJobs.some(
        (job) => job?.status === "queued" || job?.status === "running",
      );

      if (project) {
        setProjects((prev) => {
          const exists = prev.some((item) => item.id === project.id);
          if (!exists) return [...prev, project];
          return prev.map((item) => (item.id === project.id ? project : item));
        });
      }
      setJobs(incomingJobs);

      if (
        hadRunningBefore &&
        !hasRunningNow &&
        !isEditingSegmentsRef.current &&
        selectedProjectId
      ) {
        loadProjectData(selectedProjectId, { includeSegments: true });
      }
    },
    onError: () => {
      setStreamErrorCount((count) => count + 1);
    },
  });
  const hasVideo = Boolean(selectedProject?.video_path);
  const hasSavedRoi = useMemo(
    () => hasVideo && hasValidRoi(selectedProject?.roi),
    [hasVideo, selectedProject?.roi],
  );
  const hasOcrProgress = useMemo(() => {
    if ((latestPipelineJob?.progress || 0) > 0) return true;
    if (latestJobEvents.length > 0) return true;
    if (Object.keys(latestJobStats || {}).length > 0) return true;
    if (editableSegments.length > 0) return true;
    return false;
  }, [latestPipelineJob, latestJobEvents, latestJobStats, editableSegments]);
  const hasDubActivity = useMemo(
    () =>
      jobs.some(
        (job) =>
          job?.artifacts?.job_kind === "dub" &&
          (job?.status === "running" ||
            job?.status === "done" ||
            Boolean(job?.artifacts?.dubbed_audio) ||
            Boolean(job?.artifacts?.dub_output_key)),
      ),
    [jobs],
  );
  const maxUnlockedStep = useMemo(() => {
    if (!hasVideo) return 1;
    if (!hasSavedRoi) return 2;
    if (!hasOcrProgress && !hasDubActivity) return 3;
    return 4;
  }, [hasVideo, hasSavedRoi, hasOcrProgress, hasDubActivity]);
  const canGoNext = wizardStep < maxUnlockedStep;
  const statusLabel = (status) => {
    if (status === "draft") return "nháp";
    if (status === "processing") return "đang xử lý";
    if (status === "ready") return "sẵn sàng";
    if (status === "failed") return "lỗi";
    return status || "";
  };
  const wizardSteps = [
    { id: 1, title: "Video" },
    { id: 2, title: "ROI" },
    { id: 3, title: "OCR Log" },
    { id: 4, title: "SRT/TTS" },
  ];

  function goToStep(stepId) {
    if (stepId <= maxUnlockedStep) {
      setWizardStep(stepId);
      return;
    }
    if (stepId === 2) {
      setMessage("Cần tải video trước khi sang bước ROI.");
      return;
    }
    if (stepId === 3) {
      setMessage("Cần có video và lưu ROI trước khi sang bước OCR Log.");
      return;
    }
    if (stepId === 4) {
      setMessage("Cần chạy OCR để có tiến trình trước khi sang bước SRT/TTS.");
      return;
    }
  }

  function pushUndoSnapshot(snapshot) {
    setUndoStack((prev) => {
      const next = [...prev, cloneSegments(snapshot)];
      if (next.length > MAX_HISTORY) next.shift();
      return next;
    });
    setRedoStack([]);
  }

  useEffect(() => {
    loadProjectsSafe();
  }, []);

  useEffect(() => {
    if (!selectedProjectId) return;
    pollTickRef.current = 0;
    loadProjectData(selectedProjectId, { includeSegments: true });
    let stopped = false;
    let timerId = null;

    const scheduleNext = (ms) => {
      if (stopped) return;
      timerId = window.setTimeout(runPoll, ms);
    };

    const runPoll = async () => {
      if (stopped) return;
      if (streamState === "open") {
        scheduleNext(document.hidden ? 25000 : 15000);
        return;
      }
      pollTickRef.current += 1;
      const hasLiveJob = (jobsRef.current || []).some(
        (job) => job?.status === "queued" || job?.status === "running",
      );
      let includeSegments = false;
      if (hasLiveJob) {
        hadActiveJobRef.current = true;
      } else if (!isEditingSegmentsRef.current) {
        includeSegments =
          hadActiveJobRef.current || pollTickRef.current % 6 === 0;
        hadActiveJobRef.current = false;
      }
      await loadProjectData(selectedProjectId, { includeSegments });

      const nextDelay = document.hidden
        ? 20000
        : hasLiveJob
          ? 5000
          : 15000;
      scheduleNext(nextDelay);
    };

    scheduleNext(document.hidden ? 12000 : 5000);
    return () => {
      stopped = true;
      if (timerId) window.clearTimeout(timerId);
    };
  }, [selectedProjectId]);

  useEffect(() => {
    if (selectedProject?.roi) {
      setRoiDraft(normalizeRoi(selectedProject.roi));
    }
  }, [selectedProjectId, streamState]);

  useEffect(() => {
    setWizardStep((current) => Math.min(current, maxUnlockedStep));
  }, [maxUnlockedStep]);

  useEffect(() => {
    segmentsRef.current = editableSegments;
  }, [editableSegments]);

  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  useEffect(() => {
    isEditingSegmentsRef.current = isEditingSegments;
  }, [isEditingSegments]);

  useEffect(() => {
    if (!latestDubJob?.artifacts?.dubbed_audio) return;
    if (lastDubDoneRef.current === latestDubJob.id) return;
    lastDubDoneRef.current = latestDubJob.id;
    setWizardStep(4);
    setMessage(`Đã tạo xong âm thanh: ${latestDubJob.artifacts.dub_output_key || "dub-output.wav"}`);
  }, [latestDubJob]);


  useEffect(() => {
    const onKeyDown = (event) => {
      const hotkey = event.ctrlKey || event.metaKey;
      if (!hotkey || event.altKey) return;

      const key = event.key.toLowerCase();
      const isUndo = key === "z" && !event.shiftKey;
      const isRedo = key === "y" || (key === "z" && event.shiftKey);
      if (!isUndo && !isRedo) return;

      if (isUndo && undoStack.length === 0) return;
      if (isRedo && redoStack.length === 0) return;

      event.preventDefault();
      if (isUndo) {
        const current = cloneSegments(segmentsRef.current);
        setUndoStack((prev) => {
          if (!prev.length) return prev;
          const previous = prev[prev.length - 1];
          setRedoStack((rprev) => {
            const next = [current, ...rprev];
            return next.slice(0, MAX_HISTORY);
          });
          setEditableSegments(cloneSegments(previous));
          setIsEditingSegments(true);
          setMessage("Đã hoàn tác (Ctrl+Z).");
          return prev.slice(0, -1);
        });
      } else {
        const current = cloneSegments(segmentsRef.current);
        setRedoStack((prev) => {
          if (!prev.length) return prev;
          const nextState = prev[0];
          setUndoStack((uprev) => {
            const next = [...uprev, current];
            if (next.length > MAX_HISTORY) next.shift();
            return next;
          });
          setEditableSegments(cloneSegments(nextState));
          setIsEditingSegments(true);
          setMessage("Đã làm lại (Ctrl+Y).");
          return prev.slice(1);
        });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undoStack, redoStack]);

  useEffect(() => {
    if (!dragState) return undefined;
    const onMove = (event) => {
      const pt = eventToPoint(event);
      if (!pt) return;
      const { mode, handle, start, base } = dragState;

      if (mode === "draw") {
        const x1 = Math.min(start.x, pt.x);
        const y1 = Math.min(start.y, pt.y);
        const x2 = Math.max(start.x, pt.x);
        const y2 = Math.max(start.y, pt.y);
        setRoiDraft(normalizeRoi({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 }));
        return;
      }
      if (mode === "move") {
        const dx = pt.x - start.x;
        const dy = pt.y - start.y;
        setRoiDraft(
          normalizeRoi({
            x: base.x + dx,
            y: base.y + dy,
            w: base.w,
            h: base.h,
          }),
        );
        return;
      }
      if (mode === "resize") {
        const dx = pt.x - start.x;
        const dy = pt.y - start.y;
        let next = { ...base };
        if (handle === "nw")
          next = {
            x: base.x + dx,
            y: base.y + dy,
            w: base.w - dx,
            h: base.h - dy,
          };
        if (handle === "ne")
          next = { x: base.x, y: base.y + dy, w: base.w + dx, h: base.h - dy };
        if (handle === "sw")
          next = { x: base.x + dx, y: base.y, w: base.w - dx, h: base.h + dy };
        if (handle === "se")
          next = { x: base.x, y: base.y, w: base.w + dx, h: base.h + dy };
        setRoiDraft(normalizeRoi(next));
      }
    };
    const onUp = () => setDragState(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragState]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Shift") setIsShiftPressed(true);
    };
    const onKeyUp = (event) => {
      if (event.key === "Shift") setIsShiftPressed(false);
    };
    const onWindowBlur = () => setIsShiftPressed(false);

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onWindowBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onWindowBlur);
    };
  }, []);

  function eventToPoint(event) {
    const stage = stageRef.current;
    if (!stage) return null;
    const rect = stage.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
    };
  }

  async function loadProjectsSafe() {
    try {
      const data = await jsonFetch(`${API_BASE}/projects`);
      setProjects(data);
      setApiStatus("online");
      if (!selectedProjectId && data.length) setSelectedProjectId(data[0].id);
    } catch (err) {
      setApiStatus("offline");
      setMessage(
        `Không kết nối được API ${API_BASE}. Hãy chạy backend.`,
      );
      console.error(err);
    }
  }

  async function loadProjectData(projectId, options = {}) {
    const includeSegments = options.includeSegments ?? true;
    try {
      const [j, p] = await Promise.all([
        jsonFetch(`${API_BASE}/projects/${projectId}/jobs`),
        jsonFetch(`${API_BASE}/projects/${projectId}`),
      ]);
      if (includeSegments && !isEditingSegments) {
        const s = await jsonFetch(`${API_BASE}/projects/${projectId}/segments`);
        setEditableSegments(s.map((row) => ({ ...row })));
        setUndoStack([]);
        setRedoStack([]);
      }
      setJobs(j);
      setProjects((prev) => prev.map((item) => (item.id === p.id ? p : item)));
    } catch {
      // ignore poll errors
    }
  }

  async function createProject() {
    setCreating(true);
    setMessage("");
    try {
      const created = await jsonFetch(`${API_BASE}/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...projectForm,
          roi: normalizeRoi(projectForm.roi),
        }),
      });
      await loadProjectsSafe();
      setSelectedProjectId(created.id);
      setMessage(`Đã tạo dự án: ${created.name}`);
    } catch (err) {
      setMessage(`Lỗi tạo dự án: ${err.message}`);
    } finally {
      setCreating(false);
    }
  }

  async function clearOldSessions() {
    if (!window.confirm("Bạn có chắc muốn xóa toàn bộ phiên cũ (không ở trạng thái đang xử lý)?")) {
      return;
    }
    setClearingSessions(true);
    setMessage("");
    try {
      const out = await jsonFetch(`${API_BASE}/projects/clear-sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          include_processing: false,
          delete_storage: true,
        }),
      });
      await loadProjectsSafe();
      if (selectedProjectId && out.deleted_project_ids?.includes(selectedProjectId)) {
        setSelectedProjectId("");
        setEditableSegments([]);
        setJobs([]);
      }
      setMessage(
        `Đã xóa ${out.deleted_projects} phiên cũ, bỏ qua ${out.skipped_processing_projects} phiên đang chạy.`,
      );
    } catch (err) {
      setMessage(`Lỗi dọn phiên: ${err.message}`);
    } finally {
      setClearingSessions(false);
    }
  }

  async function forceClearAllSessions() {
    const step1 = window.confirm(
      "CẢNH BÁO: thao tác này sẽ xóa TẤT CẢ phiên, kể cả phiên đang xử lý. Bạn tiếp tục?",
    );
    if (!step1) return;
    const token = window.prompt(
      "Bước 2/2: Nhập CHÍNH XÁC 'FORCE CLEAR ALL' để xác nhận:",
      "",
    );
    if (token !== "FORCE CLEAR ALL") {
      setMessage("Đã hủy thao tác xóa cưỡng bức do xác nhận không hợp lệ.");
      return;
    }
    setForceClearingSessions(true);
    setMessage("");
    try {
      const out = await jsonFetch(`${API_BASE}/projects/clear-sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          include_processing: true,
          delete_storage: true,
        }),
      });
      await loadProjectsSafe();
      setSelectedProjectId("");
      setEditableSegments([]);
      setJobs([]);
      setMessage(
        `Đã xóa cưỡng bức: ${out.deleted_projects} phiên; dọn ${out.removed_storage_dirs} thư mục.`,
      );
    } catch (err) {
      setMessage(`Lỗi xóa cưỡng bức phiên: ${err.message}`);
    } finally {
      setForceClearingSessions(false);
    }
  }

  async function uploadVideo() {
    if (!selectedProjectId || !videoFile) {
      setMessage("Chọn dự án và tệp video trước.");
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const form = new FormData();
      form.append("file", videoFile);
      await fetch(`${API_BASE}/projects/${selectedProjectId}/upload`, {
        method: "POST",
        body: form,
      }).then(async (res) => {
        if (!res.ok) throw new Error(await res.text());
      });
      await loadProjectsSafe();
      await loadProjectData(selectedProjectId);
      setMessage("Tải video lên thành công.");
      setWizardStep(2);
    } catch (err) {
      setMessage(`Lỗi tải lên: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function ingestVideoFromUrl() {
    if (!selectedProjectId || !sourceUrl.trim()) {
      setMessage("Chọn dự án và dán link trước.");
      return;
    }
    setIngestingUrl(true);
    setMessage("");
    try {
      await jsonFetch(`${API_BASE}/projects/${selectedProjectId}/ingest-url/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_url: sourceUrl.trim(),
          auto_start_pipeline: autoStartAfterIngest,
          gemini_api_key: pipelineForm.gemini_api_key || null,
          voice_map: parseVoiceMap(pipelineForm.voiceMapText),
          scan_interval_sec: Number(pipelineForm.scan_interval_sec) || 1.5,
        }),
      });
      await loadProjectData(selectedProjectId);
      setMessage(
        autoStartAfterIngest
          ? "Đã nhận link, đang tải và sẽ tự chạy pipeline."
          : "Đã nhận link, đang tự tải video vào dự án.",
      );
      setWizardStep(2);
    } catch (err) {
      setMessage(`Lỗi nhận link: ${err.message}`);
    } finally {
      setIngestingUrl(false);
    }
  }

  async function uploadExternalSrt() {
    if (!selectedProjectId || !srtUploadFile) {
      setMessage("Chọn dự án và tệp SRT trước.");
      return;
    }
    setUploadingSrt(true);
    setMessage("");
    try {
      const form = new FormData();
      form.append("file", srtUploadFile);
      const res = await fetch(`${API_BASE}/projects/${selectedProjectId}/srt/upload`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        throw new Error(await res.text());
      }
      const out = await res.json();
      setDubForm((prev) => ({ ...prev, srt_key: out.output_key }));
      setMessage(`Đã tải lên SRT: ${out.output_key}`);
    } catch (err) {
      setMessage(`Lỗi tải lên SRT: ${err.message}`);
    } finally {
      setUploadingSrt(false);
    }
  }

  async function saveSelectedRoi() {
    if (!selectedProjectId) {
      setMessage("Chọn dự án trước khi lưu ROI.");
      return;
    }
    setSavingRoi(true);
    setMessage("");
    try {
      const updated = await jsonFetch(
        `${API_BASE}/projects/${selectedProjectId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roi: normalizeRoi(roiDraft) }),
        },
      );
      setProjects((prev) =>
        prev.map((item) => (item.id === updated.id ? updated : item)),
      );
      setRoiDraft(normalizeRoi(updated.roi));
      setMessage("Đã lưu ROI cho dự án.");
    } catch (err) {
      setMessage(`Lỗi lưu ROI: ${err.message}`);
    } finally {
      setSavingRoi(false);
    }
  }

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

  async function startPipeline() {
    if (!selectedProjectId) {
      setMessage("Chọn dự án trước.");
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      await syncPromptPresetForCurrentProjectIfEnabled();
      await jsonFetch(
        `${API_BASE}/projects/${selectedProjectId}/pipeline/start`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            gemini_api_key: pipelineForm.gemini_api_key || null,
            voice_map: parseVoiceMap(pipelineForm.voiceMapText),
            scan_interval_sec: Number(pipelineForm.scan_interval_sec) || 1.0,
          }),
        },
      );
      setIsEditingSegments(false);
      await loadProjectData(selectedProjectId);
      setMessage("Đã đưa quy trình xử lý vào hàng đợi.");
      setWizardStep(3);
    } catch (err) {
      setMessage(`Lỗi chạy quy trình xử lý: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  function beginDraw(event) {
    if (!roiEditMode || !selectedProject?.video_path || !event.shiftKey) return;
    const start = eventToPoint(event);
    if (!start) return;
    setDragState({ mode: "draw", start, base: roiDraft, handle: null });
  }

  function beginMove(event) {
    if (!roiEditMode) return;
    event.preventDefault();
    event.stopPropagation();
    const start = eventToPoint(event);
    if (!start) return;
    setDragState({ mode: "move", start, base: roiDraft, handle: null });
  }

  function beginResize(handle, event) {
    if (!roiEditMode) return;
    event.preventDefault();
    event.stopPropagation();
    const start = eventToPoint(event);
    if (!start) return;
    setDragState({ mode: "resize", start, base: roiDraft, handle });
  }

  function onVideoTimeUpdate(event) {
    setCurrentVideoTime(event.currentTarget.currentTime || 0);
  }

  function updateEditableSegment(id, field, value) {
    pushUndoSnapshot(editableSegments);
    setIsEditingSegments(true);
    setEditableSegments((prev) =>
      prev.map((row) =>
        row.id === id
          ? {
              ...row,
              [field]:
                field === "start_sec" || field === "end_sec"
                  ? Number(value)
                  : value,
            }
          : row,
      ),
    );
  }

  function mergeAdjacentDuplicateSegments() {
    if (!editableSegments.length) {
      setMessage("Chưa có dữ liệu để gộp.");
      return;
    }
    pushUndoSnapshot(editableSegments);
    const ordered = [...editableSegments].sort(
      (a, b) => Number(a.start_sec) - Number(b.start_sec),
    );
    const merged = [];
    for (const seg of ordered) {
      const current = { ...seg };
      const prev = merged[merged.length - 1];
      if (!prev) {
        merged.push(current);
        continue;
      }
      const prevRaw = normalizeTextForMerge(prev.raw_text);
      const curRaw = normalizeTextForMerge(current.raw_text);
      const prevTrans = normalizeTextForMerge(prev.translated_text);
      const curTrans = normalizeTextForMerge(current.translated_text);
      const isDuplicate =
        (prevRaw && curRaw && prevRaw === curRaw) ||
        (prevTrans && curTrans && prevTrans === curTrans);

      if (isDuplicate) {
        prev.end_sec = Math.max(Number(prev.end_sec), Number(current.end_sec));
        if (
          String(current.raw_text || "").length >
          String(prev.raw_text || "").length
        ) {
          prev.raw_text = current.raw_text;
        }
        if (
          String(current.translated_text || "").length >
          String(prev.translated_text || "").length
        ) {
          prev.translated_text = current.translated_text;
        }
      } else {
        merged.push(current);
      }
    }

    setEditableSegments(merged);
    setIsEditingSegments(true);
    setMessage(
      `Đã gộp dòng trùng kề nhau: ${editableSegments.length} -> ${merged.length} dòng.`,
    );
  }

  async function saveSegments() {
    if (!selectedProjectId) {
      setMessage("Chọn dự án trước.");
      return;
    }
    setSavingSegments(true);
    setMessage("");
    try {
      const payload = editableSegments.map((row) => ({
        id: row.id,
        start_sec: Number(row.start_sec),
        end_sec: Number(row.end_sec),
        raw_text: row.raw_text ?? "",
        translated_text: row.translated_text ?? "",
        speaker: row.speaker ?? "narrator",
        voice: row.voice ?? "narrator-neutral",
      }));
      const updated = await jsonFetch(
        `${API_BASE}/projects/${selectedProjectId}/segments`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      setEditableSegments(updated.map((row) => ({ ...row })));
      setUndoStack([]);
      setRedoStack([]);
      setIsEditingSegments(false);
      setMessage("Đã lưu phụ đề đã chỉnh sửa.");
    } catch (err) {
      setMessage(`Lỗi lưu phụ đề: ${err.message}`);
    } finally {
      setSavingSegments(false);
    }
  }

  async function retranslateOnly() {
    if (!selectedProjectId) {
      setMessage("Chọn dự án trước.");
      return;
    }
    setRetranslating(true);
    setMessage("");
    try {
      await syncPromptPresetForCurrentProjectIfEnabled();
      const payload = editableSegments.map((row) => ({
        id: row.id,
        start_sec: Number(row.start_sec),
        end_sec: Number(row.end_sec),
        raw_text: row.raw_text ?? "",
        translated_text: row.translated_text ?? "",
        speaker: row.speaker ?? "narrator",
        voice: row.voice ?? "narrator-neutral",
      }));
      await jsonFetch(`${API_BASE}/projects/${selectedProjectId}/segments`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const out = await jsonFetch(
        `${API_BASE}/projects/${selectedProjectId}/segments/retranslate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            gemini_api_key: pipelineForm.gemini_api_key || null,
          }),
        },
      );
      setEditableSegments((out.segments || []).map((row) => ({ ...row })));
      setUndoStack([]);
      setRedoStack([]);
      setIsEditingSegments(false);
      setMessage(`Đã dịch lại. Thống kê: ${JSON.stringify(out.translation_stats || {})}`);
    } catch (err) {
      setMessage(`Lỗi dịch lại: ${err.message}`);
    } finally {
      setRetranslating(false);
    }
  }

  async function exportSubtitle() {
    if (!selectedProjectId) {
      setMessage("Chọn dự án trước.");
      return;
    }
    setExporting(true);
    setMessage("");
    try {
      const out = await jsonFetch(
        `${API_BASE}/projects/${selectedProjectId}/export`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(exportForm),
        },
      );
      setLastExport({ ...out, url: `${API_BASE}${out.download_url}` });
      setMessage(
        `Đã xuất ${exportForm.export_format.toUpperCase()} (${exportForm.content_mode}).`,
      );
    } catch (err) {
      setMessage(`Lỗi xuất tệp: ${err.message}`);
    } finally {
      setExporting(false);
    }
  }

  async function startDubAudio() {
    if (!selectedProjectId) {
      setMessage("Chọn dự án trước.");
      return;
    }
    setDubbing(true);
    setMessage("");
    try {
      await jsonFetch(`${API_BASE}/projects/${selectedProjectId}/dub/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dubForm),
      });
      setMessage(
        `Đã bắt đầu dựng âm thanh (${dubForm.output_format.toUpperCase()}).`,
      );
      setWizardStep(4);
    } catch (err) {
      setMessage(`Lỗi dựng âm thanh: ${err.message}`);
    } finally {
      setDubbing(false);
    }
  }

  function applyPresetToCreateForm() {
    const prompt = composePromptFromPreset(
      translationPreset,
      translationTone,
      translationExtraRule,
    );
    setProjectForm((prev) => ({ ...prev, prompt }));
    setMessage("Đã nạp prompt preset vào ô 'Lời nhắc'.");
  }

  async function applyPresetToCurrentProject() {
    if (!selectedProjectId) {
      setMessage("Chọn dự án trước.");
      return;
    }
    const prompt = composePromptFromPreset(
      translationPreset,
      translationTone,
      translationExtraRule,
    );
    try {
      const updated = await jsonFetch(`${API_BASE}/projects/${selectedProjectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      setProjects((prev) =>
        prev.map((item) => (item.id === updated.id ? updated : item)),
      );
      setProjectForm((prev) => ({ ...prev, prompt }));
      setMessage("Đã áp dụng prompt preset vào dự án hiện tại.");
    } catch (err) {
      setMessage(`Lỗi cập nhật prompt dự án: ${err.message}`);
    }
  }

  async function syncPromptPresetForCurrentProjectIfEnabled() {
    if (!autoApplyPromptPreset || !selectedProjectId) return;
    const prompt = composePromptFromPreset(
      translationPreset,
      translationTone,
      translationExtraRule,
    );
    if ((selectedProject?.prompt || "").trim() === prompt.trim()) return;
    const updated = await jsonFetch(`${API_BASE}/projects/${selectedProjectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    setProjects((prev) =>
      prev.map((item) => (item.id === updated.id ? updated : item)),
    );
  }

  async function downloadDubAudio() {
    if (!latestDubAudioUrl) {
      setMessage("Chưa có file âm thanh để tải.");
      return;
    }
    try {
      const res = await fetch(latestDubAudioUrl);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = latestDubAudioName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(blobUrl);
      setMessage(`Đã tải file âm thanh: ${latestDubAudioName}`);
    } catch (err) {
      setMessage(`Lỗi tải file âm thanh: ${err.message}`);
    }
  }

  async function retryStuckJobs() {
    if (!selectedProjectId) {
      setMessage("Chọn dự án trước.");
      return;
    }
    setRetryingStuckJobs(true);
    setMessage("");
    try {
      const out = await jsonFetch(
        `${API_BASE}/projects/${selectedProjectId}/jobs/retry-stuck`,
        {
          method: "POST",
        },
      );
      await loadProjectData(selectedProjectId, { includeSegments: false });
      setMessage(
        `Đã thử lại ${out.retried_count} tác vụ bị kẹt. Bỏ qua ${out.skipped_count}.`,
      );
    } catch (err) {
      setMessage(`Lỗi thử lại tác vụ trong hàng đợi: ${err.message}`);
    } finally {
      setRetryingStuckJobs(false);
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
            href={`${API_BASE}/jobs/${latestDubJob.id}/artifact/dubbed_audio`}
            target="_blank"
            rel="noreferrer"
          >
            {latestDubJob.artifacts.dub_output_key || "Tải file âm thanh"}
          </a>
        </section>
      ) : null}

      <main className="workspace">
        <aside className="sidebar card">
          <section className="block">
            <h2>Dự án hiện tại</h2>
            <label>
              Chọn dự án
              <select
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
              >
                <option value="">-- Chọn --</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({statusLabel(p.status)})
                  </option>
                ))}
              </select>
            </label>
            <details>
              <summary>Quản lý dự án nâng cao</summary>
              <button disabled={clearingSessions} onClick={clearOldSessions}>
                {clearingSessions ? "Đang dọn phiên..." : "Dọn phiên cũ"}
              </button>
              <button
                disabled={forceClearingSessions}
                onClick={forceClearAllSessions}
              >
                {forceClearingSessions
                  ? "Đang xóa cưỡng bức..."
                  : "Xóa cưỡng bức tất cả (kể cả đang xử lý)"}
              </button>
            </details>
            <details>
              <summary>Tạo dự án mới</summary>
              <label>
                Tên dự án
                <input
                  value={projectForm.name}
                  onChange={(e) =>
                    setProjectForm((f) => ({ ...f, name: e.target.value }))
                  }
                />
              </label>
              <div className="inline-two">
                <label>
                  Ngôn ngữ nguồn
                  <input
                    value={projectForm.source_lang}
                    onChange={(e) =>
                      setProjectForm((f) => ({
                        ...f,
                        source_lang: e.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  Ngôn ngữ đích
                  <input
                    value={projectForm.target_lang}
                    onChange={(e) =>
                      setProjectForm((f) => ({
                        ...f,
                        target_lang: e.target.value,
                      }))
                    }
                  />
                </label>
              </div>
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
              <button disabled={creating} onClick={createProject}>
                {creating ? "Đang tạo..." : "Tạo dự án"}
              </button>
            </details>
          </section>

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
            <button type="button" onClick={() => setRoiEditMode((v) => !v)}>
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
              <button
                disabled={undoStack.length === 0}
                onClick={() => {
                  const current = cloneSegments(segmentsRef.current);
                  setUndoStack((prev) => {
                    if (!prev.length) return prev;
                    const previous = prev[prev.length - 1];
                    setRedoStack((rprev) =>
                      [current, ...rprev].slice(0, MAX_HISTORY),
                    );
                    setEditableSegments(cloneSegments(previous));
                    setIsEditingSegments(true);
                    return prev.slice(0, -1);
                  });
                }}
              >
                Hoàn tác (Ctrl+Z)
              </button>
              <button
                disabled={redoStack.length === 0}
                onClick={() => {
                  const current = cloneSegments(segmentsRef.current);
                  setRedoStack((prev) => {
                    if (!prev.length) return prev;
                    const nextState = prev[0];
                    setUndoStack((uprev) => {
                      const next = [...uprev, current];
                      if (next.length > MAX_HISTORY) next.shift();
                      return next;
                    });
                    setEditableSegments(cloneSegments(nextState));
                    setIsEditingSegments(true);
                    return prev.slice(1);
                  });
                }}
              >
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
                onClick={retranslateOnly}
              >
                {retranslating ? "Đang dịch lại..." : "Dịch lại"}
              </button>
            </details>
          </section>

          <section className={`block ${wizardStep === 4 ? "" : "hidden-step"}`}>
            <h2>Bước 4: Xuất SRT và TTS</h2>
            <label>
              Chế độ nội dung
              <select
                value={exportForm.content_mode}
                onChange={(e) =>
                  setExportForm((f) => ({ ...f, content_mode: e.target.value }))
                }
              >
                <option value="raw">Bản gốc</option>
                <option value="translated">Bản dịch</option>
                <option value="bilingual">Song ngữ</option>
              </select>
            </label>
            <label>
              Định dạng phụ đề
              <select
                value={exportForm.export_format}
                onChange={(e) =>
                  setExportForm((f) => ({
                    ...f,
                    export_format: e.target.value,
                  }))
                }
              >
                <option value="srt">SRT (CapCut)</option>
                <option value="vtt">VTT</option>
                <option value="csv">CSV</option>
                <option value="txt">TXT</option>
                <option value="json">JSON</option>
              </select>
            </label>
            <button
              disabled={exporting || editableSegments.length === 0}
              onClick={exportSubtitle}
            >
              {exporting ? "Đang xuất phụ đề..." : "Xuất phụ đề"}
            </button>

            <label>
              Chèn tệp SRT khác
              <input
                type="file"
                accept=".srt"
                onChange={(e) => setSrtUploadFile(e.target.files?.[0] || null)}
              />
            </label>
            <button
              disabled={uploadingSrt || !srtUploadFile || !selectedProjectId}
              onClick={uploadExternalSrt}
            >
              {uploadingSrt ? "Đang tải lên SRT..." : "Tải lên SRT vào dự án"}
            </button>

            <label>
              SRT dùng để lồng tiếng
              <input
                value={dubForm.srt_key}
                onChange={(e) =>
                  setDubForm((f) => ({ ...f, srt_key: e.target.value }))
                }
                placeholder="manual.translated.srt"
              />
            </label>
            <label>
              Giọng đọc
              <input
                value={dubForm.voice}
                onChange={(e) =>
                  setDubForm((f) => ({ ...f, voice: e.target.value }))
                }
                placeholder="vi-VN-HoaiMyNeural"
              />
            </label>
            <div className="inline-two">
              <label>
                Tốc độ
                <input
                  value={dubForm.rate}
                  onChange={(e) =>
                    setDubForm((f) => ({ ...f, rate: e.target.value }))
                  }
                  placeholder="+0%"
                />
              </label>
              <label>
                Định dạng âm thanh
                <select
                  value={dubForm.output_format}
                  onChange={(e) =>
                    setDubForm((f) => ({ ...f, output_format: e.target.value }))
                  }
                >
                  <option value="wav">WAV</option>
                  <option value="mp3">MP3</option>
                </select>
              </label>
            </div>
            <label>
              <input
                type="checkbox"
                checked={dubForm.match_video_duration}
                onChange={(e) =>
                  setDubForm((f) => ({
                    ...f,
                    match_video_duration: e.target.checked,
                  }))
                }
              />
              Khớp tổng thời lượng video gốc
            </label>
            <button
              disabled={dubbing || editableSegments.length === 0}
              onClick={startDubAudio}
            >
              {dubbing ? "Đang dựng âm thanh..." : "Tạo âm thanh lồng tiếng"}
            </button>
            {lastExport ? (
              <a
                className="download-link"
                href={lastExport.url}
                target="_blank"
                rel="noreferrer"
              >
                Tải phụ đề: {lastExport.output_key}
              </a>
            ) : null}
            {latestDubJob?.artifacts?.dub_output_key ? (
              <a
                className="download-link"
                href={`${API_BASE}/jobs/${latestDubJob.id}/artifact/dubbed_audio`}
                target="_blank"
                rel="noreferrer"
              >
                Tải âm thanh: {latestDubJob.artifacts.dub_output_key}
              </a>
            ) : null}
            {latestDubJob?.status === "done" && !latestDubJob?.artifacts?.dubbed_audio ? (
              <p className="error">
                Job lồng tiếng đã hoàn tất nhưng thiếu đường dẫn file âm thanh trong artifacts (`dubbed_audio`).
              </p>
            ) : null}
            <button
              type="button"
              disabled={!latestDubAudioUrl}
              onClick={downloadDubAudio}
            >
              Tải file âm thanh về máy
            </button>
          </section>
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
                    ? "Giữ Shift + kéo để tạo khung mới. Kéo khung/góc để chỉnh ngay."
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
                        <strong>Đang hiển thị:</strong> #{activeSegment.id}{" "}
                        ({Number(activeSegment.start_sec).toFixed(2)} -{" "}
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
              <p className="hint">
                Tải video lên để bắt đầu xem trước.
              </p>
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
              <p className="hint">Chưa có log OCR. Hãy chạy pipeline để theo dõi tiến trình tách khung hình.</p>
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



