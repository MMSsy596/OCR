import { useEffect, useMemo, useRef, useState } from "react";

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

function normalizeTextForMerge(text) {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "")
    .replace(/[.,;:!?'"`~\-_=+*/\\|()[\]{}<>,ã€‚!?;:ã€]/g, "");
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
    label: "Phim co trang",
    text:
      "Dich theo van phong co trang, tu nhien, de nghe, giu than thai hoi thoai. " +
      "Uu tien xung ho theo quan he nhan vat va cap bac. Khong dich tho va khong viet dai dong.",
  },
  modern_short: {
    label: "Phim ngan hien dai",
    text:
      "Dich theo van phong hien dai, doi thoai gon, doi thuong, tu nhien nhu nguoi Viet noi. " +
      "Uu tien toc do doc subtitle, tranh cau qua dai.",
  },
  fantasy: {
    label: "Phim huyen huyen",
    text:
      "Dich theo phong cach huyen huyen, tao cam giac ky ao nhung van ro nghia. " +
      "Thuat ngu suc manh va boi canh can nhat quan.",
  },
  cultivation: {
    label: "Tu tien",
    text:
      "Dich dung van mach tu tien, giu tinh than cap bac tu vi, cong phap, linh can, canh gioi. " +
      "Uu tien nhat quan thuat ngu theo glossary.",
  },
  reincarnation: {
    label: "Chuyen sinh",
    text:
      "Dich ro cau truc ke chuyen chuyen sinh, giu logic thoi gian truoc/sau chuyen sinh. " +
      "Han che lap lai va tao nhip ke chuyen mach lac.",
  },
  review: {
    label: "Review phim",
    text:
      "Dich theo van review phim, ro y, de hieu, lien ket nguyen nhan-ket qua. " +
      "Khi can, dien dat thanh cau nhan xet tu nhien cho nguoi xem Viet.",
  },
};

const TONE_PRESETS = {
  accurate: "Giong dieu chinh xac, trung lap, uu tien sat nghia va ro y.",
  natural: "Giong dieu tu nhien, mem mai, doi thoai nhu nguoi Viet ban dia.",
  witty: "Giong dieu di dom, co chut hai huoc nhe nhung khong lech nghia.",
  teasing: "Giong dieu treu gheo nhe, lanh loi, van lich su va dung ngu canh.",
  dramatic: "Giong dieu kich tinh, day cam xuc, phu hop canh cao trao.",
};

function composePromptFromPreset(presetKey, toneKey, extraRule) {
  const presetText = PROMPT_PRESETS[presetKey]?.text || PROMPT_PRESETS.historical.text;
  const toneText = TONE_PRESETS[toneKey] || TONE_PRESETS.accurate;
  const extra = String(extraRule || "").trim();
  const lines = [
    "Muc tieu: dich subtitle dung ngu canh, giu y nghia day du, ngon ngu tu nhien.",
    `The loai: ${presetText}`,
    `Giong dieu: ${toneText}`,
    "Rang buoc: Khong tu y them y moi. Neu cau goc mo ho, uu tien cach noi tu nhien nhat theo ngu canh truoc/sau.",
    "Rang buoc: Giu nhat quan cach xung ho, ten rieng, thuat ngu va glossary.",
    "Rang buoc: Tra ve cau dich gon, de doc tren subtitle, khong kem giai thich.",
  ];
  if (extra) {
    lines.push(`Yeu cau bo sung: ${extra}`);
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
    name: "Dá»± Ã¡n NanBao",
    source_lang: "zh",
    target_lang: "vi",
    prompt: "Dá»‹ch theo vÄƒn phong phim cá»• trang, tá»± nhiÃªn, ngáº¯n gá»n.",
    glossary: "Äáº¡o huynh=SÆ° huynh\nTiÃªn tÃ´n=TiÃªn TÃ´n",
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

  const stageRef = useRef(null);
  const segmentsRef = useRef([]);
  const pollTickRef = useRef(0);
  const jobsRef = useRef([]);
  const isEditingSegmentsRef = useRef(false);

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId) || null,
    [projects, selectedProjectId],
  );
  const videoSrc = selectedProjectId
    ? `${API_BASE}/projects/${selectedProjectId}/video`
    : "";
  const activeSegment = useMemo(() => {
    return editableSegments.find(
      (seg) =>
        currentVideoTime >= Number(seg.start_sec) &&
        currentVideoTime <= Number(seg.end_sec),
    );
  }, [editableSegments, currentVideoTime]);
  const latestJob = jobs[0];
  const latestDubJob = useMemo(
    () =>
      jobs.find(
        (job) =>
          job?.artifacts?.dubbed_audio ||
          job?.step === "synthesize_tts" ||
          job?.step === "stitch_timeline",
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
    () => [...(latestJob?.artifacts?.events || [])].slice(-30).reverse(),
    [latestJob],
  );
  const latestJobStats = useMemo(
    () => latestJob?.artifacts?.stats || {},
    [latestJob],
  );
  const statusLabel = (status) => {
    if (status === "draft") return "nhÃ¡p";
    if (status === "processing") return "Ä‘ang xá»­ lÃ½";
    if (status === "ready") return "sáºµn sÃ ng";
    if (status === "failed") return "lá»—i";
    return status || "";
  };
  const wizardSteps = [
    { id: 1, title: "Video" },
    { id: 2, title: "ROI" },
    { id: 3, title: "OCR Log" },
    { id: 4, title: "SRT/TTS" },
  ];

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
      pollTickRef.current += 1;
      const hasActiveJob = (jobsRef.current || []).some(
        (job) => job?.status === "queued" || job?.status === "running",
      );
      const includeSegments =
        !isEditingSegmentsRef.current &&
        pollTickRef.current % (hasActiveJob ? 8 : 4) === 0;
      await loadProjectData(selectedProjectId, { includeSegments });

      const nextDelay = document.hidden
        ? 20000
        : hasActiveJob
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
  }, [selectedProjectId]);

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
          setMessage("ÄÃ£ hoÃ n tÃ¡c (Ctrl+Z).");
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
          setMessage("ÄÃ£ lÃ m láº¡i (Ctrl+Y).");
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
        `KhÃ´ng káº¿t ná»‘i Ä‘Æ°á»£c API ${API_BASE}. HÃ£y cháº¡y backend.`,
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
      setMessage(`ÄÃ£ táº¡o dá»± Ã¡n: ${created.name}`);
    } catch (err) {
      setMessage(`Lá»—i táº¡o dá»± Ã¡n: ${err.message}`);
    } finally {
      setCreating(false);
    }
  }

  async function clearOldSessions() {
    if (!window.confirm("Báº¡n cÃ³ cháº¯c muá»‘n xÃ³a toÃ n bá»™ phiÃªn cÅ© (khÃ´ng á»Ÿ tráº¡ng thÃ¡i Ä‘ang xá»­ lÃ½)?")) {
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
        `ÄÃ£ xÃ³a ${out.deleted_projects} phiÃªn cÅ©, bá» qua ${out.skipped_processing_projects} phiÃªn Ä‘ang cháº¡y.`,
      );
    } catch (err) {
      setMessage(`Lá»—i dá»n phiÃªn: ${err.message}`);
    } finally {
      setClearingSessions(false);
    }
  }

  async function forceClearAllSessions() {
    const step1 = window.confirm(
      "Cáº¢NH BÃO: thao tÃ¡c nÃ y sáº½ xÃ³a Táº¤T Cáº¢ phiÃªn, ká»ƒ cáº£ phiÃªn Ä‘ang xá»­ lÃ½. Báº¡n tiáº¿p tá»¥c?",
    );
    if (!step1) return;
    const token = window.prompt(
      "BÆ°á»›c 2/2: Nháº­p CHÃNH XÃC 'FORCE CLEAR ALL' Ä‘á»ƒ xÃ¡c nháº­n:",
      "",
    );
    if (token !== "FORCE CLEAR ALL") {
      setMessage("ÄÃ£ há»§y thao tÃ¡c xÃ³a cÆ°á»¡ng bá»©c do xÃ¡c nháº­n khÃ´ng há»£p lá»‡.");
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
        `ÄÃ£ xÃ³a cÆ°á»¡ng bá»©c: ${out.deleted_projects} phiÃªn; dá»n ${out.removed_storage_dirs} thÆ° má»¥c.`,
      );
    } catch (err) {
      setMessage(`Lá»—i xÃ³a cÆ°á»¡ng bá»©c phiÃªn: ${err.message}`);
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
      setMessage("Chá»n dá»± Ã¡n vÃ  tá»‡p SRT trÆ°á»›c.");
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
      setMessage(`ÄÃ£ táº£i lÃªn SRT: ${out.output_key}`);
    } catch (err) {
      setMessage(`Lá»—i táº£i lÃªn SRT: ${err.message}`);
    } finally {
      setUploadingSrt(false);
    }
  }

  async function saveSelectedRoi() {
    if (!selectedProjectId) {
      setMessage("Chá»n dá»± Ã¡n trÆ°á»›c khi lÆ°u ROI.");
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
      setMessage("ÄÃ£ lÆ°u ROI cho dá»± Ã¡n.");
    } catch (err) {
      setMessage(`Lá»—i lÆ°u ROI: ${err.message}`);
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
      setMessage("ChÆ°a cÃ³ dá»¯ liá»‡u Ä‘á»ƒ gá»™p.");
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
      `ÄÃ£ gá»™p dÃ²ng trÃ¹ng ká» nhau: ${editableSegments.length} -> ${merged.length} dÃ²ng.`,
    );
  }

  async function saveSegments() {
    if (!selectedProjectId) {
      setMessage("Chá»n dá»± Ã¡n trÆ°á»›c.");
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
      setMessage("ÄÃ£ lÆ°u phá»¥ Ä‘á» Ä‘Ã£ chá»‰nh sá»­a.");
    } catch (err) {
      setMessage(`Lá»—i lÆ°u phá»¥ Ä‘á»: ${err.message}`);
    } finally {
      setSavingSegments(false);
    }
  }

  async function retranslateOnly() {
    if (!selectedProjectId) {
      setMessage("Chá»n dá»± Ã¡n trÆ°á»›c.");
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
      setMessage(`ÄÃ£ dá»‹ch láº¡i. Thá»‘ng kÃª: ${JSON.stringify(out.translation_stats || {})}`);
    } catch (err) {
      setMessage(`Lá»—i dá»‹ch láº¡i: ${err.message}`);
    } finally {
      setRetranslating(false);
    }
  }

  async function exportSubtitle() {
    if (!selectedProjectId) {
      setMessage("Chá»n dá»± Ã¡n trÆ°á»›c.");
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
        `ÄÃ£ xuáº¥t ${exportForm.export_format.toUpperCase()} (${exportForm.content_mode}).`,
      );
    } catch (err) {
      setMessage(`Lá»—i xuáº¥t tá»‡p: ${err.message}`);
    } finally {
      setExporting(false);
    }
  }

  async function startDubAudio() {
    if (!selectedProjectId) {
      setMessage("Chá»n dá»± Ã¡n trÆ°á»›c.");
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
        `ÄÃ£ báº¯t Ä‘áº§u dá»±ng Ã¢m thanh (${dubForm.output_format.toUpperCase()}).`,
      );
      setWizardStep(4);
    } catch (err) {
      setMessage(`Lá»—i dá»±ng Ã¢m thanh: ${err.message}`);
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
    setMessage("Da nap prompt preset vao o 'Loi nhac'.");
  }

  async function applyPresetToCurrentProject() {
    if (!selectedProjectId) {
      setMessage("Chon du an truoc.");
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
      setMessage("Da ap dung prompt preset vao du an hien tai.");
    } catch (err) {
      setMessage(`Loi cap nhat prompt du an: ${err.message}`);
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
      setMessage("ChÆ°a cÃ³ file Ã¢m thanh Ä‘á»ƒ táº£i.");
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
      setMessage(`ÄÃ£ táº£i file Ã¢m thanh: ${latestDubAudioName}`);
    } catch (err) {
      setMessage(`Lá»—i táº£i file Ã¢m thanh: ${err.message}`);
    }
  }

  async function retryStuckJobs() {
    if (!selectedProjectId) {
      setMessage("Chá»n dá»± Ã¡n trÆ°á»›c.");
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
        `ÄÃ£ thá»­ láº¡i ${out.retried_count} tÃ¡c vá»¥ bá»‹ káº¹t. Bá» qua ${out.skipped_count}.`,
      );
    } catch (err) {
      setMessage(`Lá»—i thá»­ láº¡i tÃ¡c vá»¥ trong hÃ ng Ä‘á»£i: ${err.message}`);
    } finally {
      setRetryingStuckJobs(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1>NanBao OCR Studio</h1>
          <p>
            Táº­p trung vÃ o 5 viá»‡c chÃ­nh: táº£i video, chá»‰nh ROI, theo dÃµi OCR,
            nháº­p/xuáº¥t SRT vÃ  chuyá»ƒn giá»ng nÃ³i.
          </p>
        </div>
        <div className={`status-pill ${apiStatus}`}>
          API{" "}
          {apiStatus === "online"
            ? "Ä‘ang hoáº¡t Ä‘á»™ng"
            : apiStatus === "offline"
              ? "máº¥t káº¿t ná»‘i"
              : "Ä‘ang kiá»ƒm tra"}
        </div>
      </header>

      <section className="wizard-nav card">
        <div className="wizard-steps">
          {wizardSteps.map((step) => (
            <button
              key={step.id}
              type="button"
              className={`wizard-step ${wizardStep === step.id ? "active" : ""}`}
              onClick={() => setWizardStep(step.id)}
            >
              <span>{step.id}</span>
              <strong>{step.title}</strong>
            </button>
          ))}
        </div>
        <div className="wizard-actions">
          <button
            type="button"
            disabled={wizardStep <= 1}
            onClick={() => setWizardStep((s) => Math.max(1, s - 1))}
          >
            Bước trước
          </button>
          <button
            type="button"
            disabled={wizardStep >= 4}
            onClick={() => setWizardStep((s) => Math.min(4, s + 1))}
          >
            Bước tiếp
          </button>
        </div>
      </section>

      <main className="workspace">
        <aside className="sidebar card">
          <section className="block">
            <h2>1) Dá»± Ã¡n</h2>
            <label>
              Chá»n dá»± Ã¡n
              <select
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
              >
                <option value="">-- Chá»n --</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({statusLabel(p.status)})
                  </option>
                ))}
              </select>
            </label>
            <details>
              <summary>Quáº£n lÃ½ dá»± Ã¡n nÃ¢ng cao</summary>
              <button disabled={clearingSessions} onClick={clearOldSessions}>
                {clearingSessions ? "Äang dá»n phiÃªn..." : "Dá»n phiÃªn cÅ©"}
              </button>
              <button
                disabled={forceClearingSessions}
                onClick={forceClearAllSessions}
              >
                {forceClearingSessions
                  ? "Äang xÃ³a cÆ°á»¡ng bá»©c..."
                  : "XÃ³a cÆ°á»¡ng bá»©c táº¥t cáº£ (ká»ƒ cáº£ Ä‘ang xá»­ lÃ½)"}
              </button>
            </details>
            <details>
              <summary>Táº¡o dá»± Ã¡n má»›i</summary>
              <label>
                TÃªn dá»± Ã¡n
                <input
                  value={projectForm.name}
                  onChange={(e) =>
                    setProjectForm((f) => ({ ...f, name: e.target.value }))
                  }
                />
              </label>
              <div className="inline-two">
                <label>
                  NgÃ´n ngá»¯ nguá»“n
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
                  NgÃ´n ngá»¯ Ä‘Ã­ch
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
                Lá»i nháº¯c
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
                  Preset ngá»¯ cáº£nh
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
                  Giá»ng Ä‘iá»‡u
                  <select
                    value={translationTone}
                    onChange={(e) => setTranslationTone(e.target.value)}
                  >
                    <option value="accurate">ChÃ­nh xÃ¡c</option>
                    <option value="natural">Tá»± nhiÃªn</option>
                    <option value="witty">DÃ­ dá»m</option>
                    <option value="teasing">TrÃªu gháº¹o</option>
                    <option value="dramatic">Ká»‹ch tÃ­nh</option>
                  </select>
                </label>
              </div>
              <label>
                YÃªu cáº§u bá»• sung (tÃ¹y chá»n)
                <input
                  value={translationExtraRule}
                  onChange={(e) => setTranslationExtraRule(e.target.value)}
                  placeholder="VÃ­ dá»¥: dÃ¹ng xÆ°ng hÃ´ huynh - muá»™i cho cáº·p chÃ­nh"
                />
              </label>
              <button type="button" onClick={applyPresetToCreateForm}>
                Náº¡p preset vÃ o lá»i nháº¯c
              </button>
              <label>
                Báº£ng thuáº­t ngá»¯
                <textarea
                  rows={3}
                  value={projectForm.glossary}
                  onChange={(e) =>
                    setProjectForm((f) => ({ ...f, glossary: e.target.value }))
                  }
                />
              </label>
              <button disabled={creating} onClick={createProject}>
                {creating ? "Äang táº¡o..." : "Táº¡o dá»± Ã¡n"}
              </button>
            </details>
          </section>

          <section className={`block ${wizardStep === 1 ? "" : "hidden-step"}`}>
            <h2>2) OCR vÃ  log</h2>
            <label>
              Tá»‡p video
              <input
                type="file"
                accept="video/*"
                onChange={(e) => setVideoFile(e.target.files?.[0] || null)}
              />
            </label>
            <button disabled={loading} onClick={uploadVideo}>
              Táº£i video lÃªn
            </button>
            <label>
              DÃ¡n link video Ä‘á»ƒ app tá»± táº£i
              <input
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                placeholder="https://..."
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={autoStartAfterIngest}
                onChange={(e) => setAutoStartAfterIngest(e.target.checked)}
              />
              Tá»± cháº¡y pipeline sau khi táº£i xong
            </label>
            <button
              disabled={ingestingUrl || loading || !selectedProjectId || !sourceUrl.trim()}
              onClick={ingestVideoFromUrl}
            >
              {ingestingUrl ? "Äang báº¯t link vÃ  táº£i..." : "DÃ¡n link vÃ  tá»± xá»­ lÃ½"}
            </button>
            <details>
              <summary>TÃ¹y chá»n OCR nÃ¢ng cao</summary>
              <label>
                KhÃ³a API Gemini (tÃ¹y chá»n)
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
                  Preset ngá»¯ cáº£nh dá»‹ch
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
                  Tone dá»‹ch
                  <select
                    value={translationTone}
                    onChange={(e) => setTranslationTone(e.target.value)}
                  >
                    <option value="accurate">ChÃ­nh xÃ¡c</option>
                    <option value="natural">Tá»± nhiÃªn</option>
                    <option value="witty">DÃ­ dá»m</option>
                    <option value="teasing">TrÃªu gháº¹o</option>
                    <option value="dramatic">Ká»‹ch tÃ­nh</option>
                  </select>
                </label>
              </div>
              <label>
                Rule bá»• sung cho ngá»¯ cáº£nh dá»‹ch
                <input
                  value={translationExtraRule}
                  onChange={(e) => setTranslationExtraRule(e.target.value)}
                  placeholder="VÃ­ dá»¥: há»™i thoáº¡i nam chÃ­nh nÃ³i ngáº¯n, láº¡nh"
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={autoApplyPromptPreset}
                  onChange={(e) => setAutoApplyPromptPreset(e.target.checked)}
                />
                Tá»± Ã¡p preset/tone vÃ o prompt dá»± Ã¡n trÆ°á»›c khi cháº¡y dá»‹ch
              </label>
              <button type="button" onClick={applyPresetToCurrentProject}>
                Ãp preset vÃ o dá»± Ã¡n hiá»‡n táº¡i
              </button>
              <label>
                Ãnh xáº¡ giá»ng Ä‘á»c
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
              <button
                disabled={retryingStuckJobs || loading}
                onClick={retryStuckJobs}
              >
                {retryingStuckJobs
                  ? "Äang thá»­ láº¡i tÃ¡c vá»¥ trong hÃ ng Ä‘á»£i..."
                  : "Thá»­ láº¡i tÃ¡c vá»¥ trong hÃ ng Ä‘á»£i cÅ©"}
              </button>
            </details>
            <label>
              Khoáº£ng quÃ©t OCR (giÃ¢y/láº§n)
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
            <button disabled={loading} onClick={startPipeline}>
              Cháº¡y quy trÃ¬nh
            </button>
            {latestJob ? (
              <div className="info">
                <p>
                  <strong>BÆ°á»›c:</strong> {latestJob.step}
                </p>
                <p>
                  <strong>Loáº¡i tÃ¡c vá»¥:</strong> {latestJob.artifacts?.job_kind || "pipeline"}
                </p>
                <p>
                  <strong>Tiáº¿n Ä‘á»™:</strong> {latestJob.progress}%
                </p>
                {latestJobStats?.ocr_live ? (
                  <p>
                    <strong>OCR realtime:</strong>{" "}
                    {latestJobStats.ocr_live.frames_sampled ?? 0}/
                    {latestJobStats.ocr_live.estimated_samples ?? 0} frame
                    {" "}({Number(latestJobStats.ocr_live.progress_pct || 0).toFixed(1)}%)
                  </p>
                ) : null}
                {latestJob.artifacts?.translation_stats ? (
                  <p>
                    <strong>Dá»‹ch:</strong>{" "}
                    {JSON.stringify(latestJob.artifacts.translation_stats)}
                  </p>
                ) : null}
                {latestJob.artifacts?.translation_error_hint ? (
                  <p className="error">
                    {latestJob.artifacts.translation_error_hint}
                  </p>
                ) : null}
                {Object.keys(latestJobStats).length > 0 ? (
                  <details>
                    <summary>Chi tiáº¿t thÃ´ng sá»‘ xá»­ lÃ½</summary>
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
                    <summary>Tiáº¿n trÃ¬nh xá»­ lÃ½ (nháº­t kÃ½ chi tiáº¿t)</summary>
                    <div style={{ maxHeight: 220, overflow: "auto", marginTop: 8 }}>
                      {latestJobEvents.map((event, idx) => (
                        <p key={`${event.time || idx}-${idx}`}>
                          [{formatEventTime(event.time)}] [{event.phase}] [{event.level || "info"}] ({event.progress ?? "-"}%): {event.message}
                        </p>
                      ))}
                    </div>
                  </details>
                ) : null}
              </div>
            ) : null}
          </section>

          <section className={`block ${wizardStep === 4 ? "" : "hidden-step"}`}>
            <h2>NÃ¢ng cao: cÃ´ng cá»¥ phá»¥ Ä‘á»</h2>
            <details>
              <summary>Má»Ÿ cÃ´ng cá»¥ chá»‰nh sá»­a thá»§ cÃ´ng</summary>
              <button
                disabled={savingSegments || editableSegments.length === 0}
                onClick={saveSegments}
              >
                {savingSegments ? "Äang lÆ°u phá»¥ Ä‘á»..." : "LÆ°u phá»¥ Ä‘á»"}
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
                HoÃ n tÃ¡c (Ctrl+Z)
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
                LÃ m láº¡i (Ctrl+Y)
              </button>
              <button
                disabled={editableSegments.length === 0}
                onClick={mergeAdjacentDuplicateSegments}
              >
                Gá»™p dÃ²ng trÃ¹ng ká» nhau
              </button>
              <button
                disabled={retranslating || editableSegments.length === 0}
                onClick={retranslateOnly}
              >
                {retranslating ? "Äang dá»‹ch láº¡i..." : "Dá»‹ch láº¡i"}
              </button>
            </details>
          </section>

          <section className={`block ${wizardStep === 4 ? "" : "hidden-step"}`}>
            <h2>3) SRT vÃ  giá»ng nÃ³i</h2>
            <label>
              Cháº¿ Ä‘á»™ ná»™i dung
              <select
                value={exportForm.content_mode}
                onChange={(e) =>
                  setExportForm((f) => ({ ...f, content_mode: e.target.value }))
                }
              >
                <option value="raw">Báº£n gá»‘c</option>
                <option value="translated">Báº£n dá»‹ch</option>
                <option value="bilingual">Song ngá»¯</option>
              </select>
            </label>
            <label>
              Äá»‹nh dáº¡ng phá»¥ Ä‘á»
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
              {exporting ? "Äang xuáº¥t phá»¥ Ä‘á»..." : "Xuáº¥t phá»¥ Ä‘á»"}
            </button>

            <label>
              ChÃ¨n tá»‡p SRT khÃ¡c
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
              {uploadingSrt ? "Äang táº£i lÃªn SRT..." : "Táº£i lÃªn SRT vÃ o dá»± Ã¡n"}
            </button>

            <label>
              SRT dÃ¹ng Ä‘á»ƒ lá»“ng tiáº¿ng
              <input
                value={dubForm.srt_key}
                onChange={(e) =>
                  setDubForm((f) => ({ ...f, srt_key: e.target.value }))
                }
                placeholder="manual.translated.srt"
              />
            </label>
            <label>
              Giá»ng Ä‘á»c
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
                Tá»‘c Ä‘á»™
                <input
                  value={dubForm.rate}
                  onChange={(e) =>
                    setDubForm((f) => ({ ...f, rate: e.target.value }))
                  }
                  placeholder="+0%"
                />
              </label>
              <label>
                Äá»‹nh dáº¡ng Ã¢m thanh
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
              Khá»›p tá»•ng thá»i lÆ°á»£ng video gá»‘c
            </label>
            <button
              disabled={dubbing || editableSegments.length === 0}
              onClick={startDubAudio}
            >
              {dubbing ? "Äang dá»±ng Ã¢m thanh..." : "Táº¡o Ã¢m thanh lá»“ng tiáº¿ng"}
            </button>
            {lastExport ? (
              <a
                className="download-link"
                href={lastExport.url}
                target="_blank"
                rel="noreferrer"
              >
                Táº£i phá»¥ Ä‘á»: {lastExport.output_key}
              </a>
            ) : null}
            {latestDubJob?.artifacts?.dub_output_key ? (
              <a
                className="download-link"
                href={`${API_BASE}/jobs/${latestDubJob.id}/artifact/dubbed_audio`}
                target="_blank"
                rel="noreferrer"
              >
                Táº£i Ã¢m thanh: {latestDubJob.artifacts.dub_output_key}
              </a>
            ) : null}
            <button
              type="button"
              disabled={!latestDubAudioUrl}
              onClick={downloadDubAudio}
            >
              Táº£i file Ã¢m thanh vá» mÃ¡y
            </button>
            {latestDubJob?.artifacts?.dubbed_audio ? (
              <p className="hint">
                ÄÆ°á»ng dáº«n file Ã¢m thanh: {latestDubJob.artifacts.dubbed_audio}
              </p>
            ) : null}
          </section>
        </aside>

        <section className="content">
          <section className={`card preview-card ${wizardStep === 1 ? "" : "hidden-step"}`}>
            <div className="row-head">
              <h2>Bước 1: Chuẩn bị video</h2>
              <span>{selectedProject?.name || "chưa chọn dự án"}</span>
            </div>
            <p className="hint">
              Tải video hoặc dán link ở panel bên trái. Sau khi có video, chuyển sang bước ROI để căn vùng đọc chữ.
            </p>
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
              <h2>Xem trÆ°á»›c ROI</h2>
              <div className="row-actions">
                <button type="button" onClick={() => setRoiEditMode((v) => !v)}>
                  {roiEditMode ? "Táº¯t chá»‰nh ROI" : "Báº­t chá»‰nh ROI"}
                </button>
                <button
                  type="button"
                  disabled={savingRoi}
                  onClick={saveSelectedRoi}
                >
                  {savingRoi ? "Äang lÆ°u..." : "LÆ°u ROI"}
                </button>
              </div>
            </div>
            {selectedProject?.video_path ? (
              <>
                <p className="hint">
                  {roiEditMode
                    ? "Giá»¯ Shift + kÃ©o Ä‘á»ƒ táº¡o khung má»›i. KÃ©o khung/gÃ³c Ä‘á»ƒ chá»‰nh ngay."
                    : "Tua video Ä‘á»ƒ kiá»ƒm tra phá»¥ Ä‘á» cÃ³ náº±m Ä‘Ãºng ROI khÃ´ng."}
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
                    <strong>Thá»i gian:</strong> {currentVideoTime.toFixed(2)}s
                  </p>
                  {activeSegment ? (
                    <>
                      <p>
                        <strong>Äang hiá»ƒn thá»‹:</strong> #{activeSegment.id}{" "}
                        ({Number(activeSegment.start_sec).toFixed(2)} -{" "}
                        {Number(activeSegment.end_sec).toFixed(2)})
                      </p>
                      <p>
                        <strong>Gá»‘c:</strong> {activeSegment.raw_text}
                      </p>
                      <p>
                        <strong>Dá»‹ch:</strong> {activeSegment.translated_text}
                      </p>
                    </>
                  ) : (
                    <p>KhÃ´ng cÃ³ phá»¥ Ä‘á» táº¡i má»‘c nÃ y.</p>
                  )}
                </div>
              </>
            ) : (
              <p className="hint">
                Táº£i video lÃªn Ä‘á»ƒ báº¯t Ä‘áº§u xem trÆ°á»›c.
              </p>
            )}
          </section>

          <section className={`card preview-card ${wizardStep === 3 ? "" : "hidden-step"}`}>
            <div className="row-head">
              <h2>Log OCR thá»i gian thá»±c</h2>
              <span>
                {latestJob ? `${latestJob.progress}%` : "chÆ°a cÃ³ tÃ¡c vá»¥"}
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
              <p className="hint">ChÆ°a cÃ³ log OCR. HÃ£y cháº¡y pipeline Ä‘á»ƒ theo dÃµi tiáº¿n trÃ¬nh tÃ¡ch khung hÃ¬nh.</p>
            )}
          </section>

          <section className={`card editor-card ${wizardStep === 4 ? "" : "hidden-step"}`}>
            <div className="row-head">
              <h2>Chá»‰nh sá»­a phá»¥ Ä‘á»</h2>
              <span>{editableSegments.length} dÃ²ng</span>
            </div>
            <details>
              <summary>Má»Ÿ báº£ng chá»‰nh sá»­a subtitle chi tiáº¿t</summary>
              <div className="table-wrap">
                <table>
                <colgroup>
                  <col className="col-id" />
                  <col className="col-time" />
                  <col className="col-time" />
                  <col className="col-text" />
                  <col className="col-text" />
                  <col className="col-meta" />
                  <col className="col-meta" />
                </colgroup>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Báº¯t Ä‘áº§u</th>
                    <th>Káº¿t thÃºc</th>
                    <th>Gá»‘c</th>
                    <th>Báº£n dá»‹ch</th>
                    <th>NhÃ¢n váº­t</th>
                    <th>Giá»ng</th>
                  </tr>
                </thead>
                <tbody>
                  {editableSegments.length === 0 ? (
                    <tr>
                      <td colSpan={7}>ChÆ°a cÃ³ dá»¯ liá»‡u</td>
                    </tr>
                  ) : (
                    editableSegments.map((s) => (
                      <tr
                        key={s.id}
                        className={
                          activeSegment?.id === s.id ? "active-row" : ""
                        }
                      >
                        <td>{s.id}</td>
                        <td>
                          <input
                            type="number"
                            step="0.01"
                            value={s.start_sec}
                            onChange={(e) =>
                              updateEditableSegment(
                                s.id,
                                "start_sec",
                                e.target.value,
                              )
                            }
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            step="0.01"
                            value={s.end_sec}
                            onChange={(e) =>
                              updateEditableSegment(
                                s.id,
                                "end_sec",
                                e.target.value,
                              )
                            }
                          />
                        </td>
                        <td>
                          <textarea
                            rows={2}
                            value={s.raw_text}
                            onChange={(e) =>
                              updateEditableSegment(
                                s.id,
                                "raw_text",
                                e.target.value,
                              )
                            }
                          />
                        </td>
                        <td>
                          <textarea
                            rows={2}
                            value={s.translated_text}
                            onChange={(e) =>
                              updateEditableSegment(
                                s.id,
                                "translated_text",
                                e.target.value,
                              )
                            }
                          />
                        </td>
                        <td>
                          <input
                            value={s.speaker}
                            onChange={(e) =>
                              updateEditableSegment(
                                s.id,
                                "speaker",
                                e.target.value,
                              )
                            }
                          />
                        </td>
                        <td>
                          <input
                            value={s.voice}
                            onChange={(e) =>
                              updateEditableSegment(
                                s.id,
                                "voice",
                                e.target.value,
                              )
                            }
                          />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                </table>
              </div>
            </details>
          </section>
        </section>
      </main>

      {message ? <footer className="toast">{message}</footer> : null}
    </div>
  );
}



