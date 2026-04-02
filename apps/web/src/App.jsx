import { useEffect, useMemo, useRef, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

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
    name: "NanBao Project",
    source_lang: "zh",
    target_lang: "vi",
    prompt: "Dịch theo văn phong phim cổ trang, tự nhiên, ngắn gọn.",
    glossary: "Đạo huynh=Sư huynh\nTiên tôn=Tiên Tôn",
    roi: { x: 0.1, y: 0.75, w: 0.8, h: 0.2 },
  });
  const [videoFile, setVideoFile] = useState(null);
  const [srtUploadFile, setSrtUploadFile] = useState(null);
  const [pipelineForm, setPipelineForm] = useState({
    gemini_api_key: "",
    voiceMapText:
      "character_a=male-deep\ncharacter_b=female-bright\nnarrator=narrator-neutral",
    scan_interval_sec: 1.0,
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

  const stageRef = useRef(null);
  const segmentsRef = useRef([]);
  const pollTickRef = useRef(0);

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
  const latestJobEvents = useMemo(
    () => [...(latestJob?.artifacts?.events || [])].slice(-30).reverse(),
    [latestJob],
  );
  const latestJobStats = useMemo(
    () => latestJob?.artifacts?.stats || {},
    [latestJob],
  );
  const statusLabel = (status) => {
    if (status === "draft") return "nháp";
    if (status === "processing") return "đang xử lý";
    if (status === "ready") return "sẵn sàng";
    if (status === "failed") return "lỗi";
    return status || "";
  };

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
    const timer = setInterval(() => {
      pollTickRef.current += 1;
      const includeSegments = !isEditingSegments && pollTickRef.current % 4 === 0;
      loadProjectData(selectedProjectId, { includeSegments });
    }, 2500);
    return () => clearInterval(timer);
  }, [selectedProjectId, isEditingSegments]);

  useEffect(() => {
    if (selectedProject?.roi) {
      setRoiDraft(normalizeRoi(selectedProject.roi));
    }
  }, [selectedProjectId]);

  useEffect(() => {
    segmentsRef.current = editableSegments;
  }, [editableSegments]);

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
      setMessage(`Đã tạo project: ${created.name}`);
    } catch (err) {
      setMessage(`Lỗi tạo project: ${err.message}`);
    } finally {
      setCreating(false);
    }
  }

  async function clearOldSessions() {
    if (!window.confirm("Ban co chac muon xoa toan bo session cu (khong o trang thai processing)?")) {
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
        `Da xoa ${out.deleted_projects} session cu, skip ${out.skipped_processing_projects} session dang chay.`,
      );
    } catch (err) {
      setMessage(`Loi clear sessions: ${err.message}`);
    } finally {
      setClearingSessions(false);
    }
  }

  async function forceClearAllSessions() {
    const step1 = window.confirm(
      "CANH BAO: thao tac nay se xoa TAT CA session, ke ca processing. Ban tiep tuc?",
    );
    if (!step1) return;
    const token = window.prompt(
      "Buoc 2/2: Nhap CHINH XAC 'FORCE CLEAR ALL' de xac nhan:",
      "",
    );
    if (token !== "FORCE CLEAR ALL") {
      setMessage("Da huy force clear do xac nhan khong hop le.");
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
        `Force clear xong: da xoa ${out.deleted_projects} session, dọn ${out.removed_storage_dirs} thu muc.`,
      );
    } catch (err) {
      setMessage(`Loi force clear sessions: ${err.message}`);
    } finally {
      setForceClearingSessions(false);
    }
  }

  async function uploadVideo() {
    if (!selectedProjectId || !videoFile) {
      setMessage("Chọn project và file video trước.");
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
      setMessage("Upload video thành công.");
    } catch (err) {
      setMessage(`Lỗi upload: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function uploadExternalSrt() {
    if (!selectedProjectId || !srtUploadFile) {
      setMessage("Chon project va file SRT truoc.");
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
      setMessage(`Da upload SRT: ${out.output_key}`);
    } catch (err) {
      setMessage(`Loi upload SRT: ${err.message}`);
    } finally {
      setUploadingSrt(false);
    }
  }

  async function saveSelectedRoi() {
    if (!selectedProjectId) {
      setMessage("Chọn project trước khi lưu ROI.");
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
      setMessage("Đã lưu ROI cho project.");
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
      setMessage("Chọn project trước.");
      return;
    }
    setLoading(true);
    setMessage("");
    try {
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
      setMessage("Pipeline đã được enqueue.");
    } catch (err) {
      setMessage(`Lỗi chạy pipeline: ${err.message}`);
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
    event.stopPropagation();
    const start = eventToPoint(event);
    if (!start) return;
    setDragState({ mode: "move", start, base: roiDraft, handle: null });
  }

  function beginResize(handle, event) {
    if (!roiEditMode) return;
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
      setMessage("Chọn project trước.");
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
      setMessage("Đã lưu subtitle chỉnh sửa.");
    } catch (err) {
      setMessage(`Lỗi lưu subtitle: ${err.message}`);
    } finally {
      setSavingSegments(false);
    }
  }

  async function retranslateOnly() {
    if (!selectedProjectId) {
      setMessage("Chọn project trước.");
      return;
    }
    setRetranslating(true);
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
      setMessage(
        `Đã dịch lại. Thống kê: ${JSON.stringify(out.translation_stats || {})}`,
      );
    } catch (err) {
      setMessage(`Lỗi dịch lại: ${err.message}`);
    } finally {
      setRetranslating(false);
    }
  }

  async function exportSubtitle() {
    if (!selectedProjectId) {
      setMessage("Chọn project trước.");
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
      setMessage(`Lỗi xuất file: ${err.message}`);
    } finally {
      setExporting(false);
    }
  }

  async function startDubAudio() {
    if (!selectedProjectId) {
      setMessage("Chọn project trước.");
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
      await loadProjectData(selectedProjectId);
      setMessage(
        "Đã bắt đầu dựng audio lồng tiếng theo timestamp.",
      );
    } catch (err) {
      setMessage(`Lỗi dựng audio: ${err.message}`);
    } finally {
      setDubbing(false);
    }
  }

  async function retryStuckJobs() {
    if (!selectedProjectId) {
      setMessage("Chon project truoc.");
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
        `Da retry ${out.retried_count} job bi ket. Skip ${out.skipped_count}.`,
      );
    } catch (err) {
      setMessage(`Loi retry queued jobs: ${err.message}`);
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
            OCR, dịch, chỉnh sửa và xuất phụ đề trong một không
            gian làm việc tập trung.
          </p>
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

      <main className="workspace">
        <aside className="sidebar card">
          <section className="block">
            <h2>Project</h2>
            <label>
              Chọn project
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
            <button disabled={clearingSessions} onClick={clearOldSessions}>
              {clearingSessions ? "Dang clear sessions..." : "Clear session cu"}
            </button>
            <button
              disabled={forceClearingSessions}
              onClick={forceClearAllSessions}
            >
              {forceClearingSessions
                ? "Dang force clear..."
                : "Force clear all (ke ca processing)"}
            </button>
            <details>
              <summary>Tạo project mới</summary>
              <label>
                Tên project
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
                Prompt
                <textarea
                  rows={2}
                  value={projectForm.prompt}
                  onChange={(e) =>
                    setProjectForm((f) => ({ ...f, prompt: e.target.value }))
                  }
                />
              </label>
              <label>
                Glossary
                <textarea
                  rows={3}
                  value={projectForm.glossary}
                  onChange={(e) =>
                    setProjectForm((f) => ({ ...f, glossary: e.target.value }))
                  }
                />
              </label>
              <button disabled={creating} onClick={createProject}>
                {creating ? "Đang tạo..." : "Tạo project"}
              </button>
            </details>
          </section>

          <section className="block">
            <h2>Pipeline</h2>
            <label>
              Tệp video
              <input
                type="file"
                accept="video/*"
                onChange={(e) => setVideoFile(e.target.files?.[0] || null)}
              />
            </label>
            <button disabled={loading} onClick={uploadVideo}>
              Tải video lên
            </button>
            <label>
              Gemini API key (tùy chọn)
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
            <button disabled={loading} onClick={startPipeline}>
              Chạy pipeline
            </button>
            <button
              disabled={retryingStuckJobs || loading}
              onClick={retryStuckJobs}
            >
              {retryingStuckJobs
                ? "Dang retry queued jobs..."
                : "Retry queued jobs cu"}
            </button>
            {latestJob ? (
              <div className="info">
                <p>
                  <strong>B??c:</strong> {latestJob.step}
                </p>
                <p>
                  <strong>Ti?n ??:</strong> {latestJob.progress}%
                </p>
                {latestJob.artifacts?.translation_stats ? (
                  <p>
                    <strong>D?ch:</strong>{" "}
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
                    <summary>Chi ti?t th?ng s? x? l?</summary>
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
                    <summary>Timeline x? l? (log chi ti?t)</summary>
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

          <section className="block">
            <h2>Subtitle Tools</h2>
            <button
              disabled={savingSegments || editableSegments.length === 0}
              onClick={saveSegments}
            >
              {savingSegments ? "Dang luu subtitle..." : "Luu subtitle"}
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
              Hoan tac (Ctrl+Z)
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
              Lam lai (Ctrl+Y)
            </button>
            <button
              disabled={editableSegments.length === 0}
              onClick={mergeAdjacentDuplicateSegments}
            >
              Gop dong trung ke nhau
            </button>
            <button
              disabled={retranslating || editableSegments.length === 0}
              onClick={retranslateOnly}
            >
              {retranslating ? "Dang dich lai..." : "Dich lai"}
            </button>
          </section>

          <section className="block">
            <h2>Dub & Export</h2>
            <label>
              Che do noi dung
              <select
                value={exportForm.content_mode}
                onChange={(e) =>
                  setExportForm((f) => ({ ...f, content_mode: e.target.value }))
                }
              >
                <option value="raw">Ban goc</option>
                <option value="translated">Ban dich</option>
                <option value="bilingual">Song ngu</option>
              </select>
            </label>
            <label>
              Dinh dang subtitle
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
              {exporting ? "Dang xuat subtitle..." : "Xuat subtitle"}
            </button>

            <label>
              Chen file SRT khac
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
              {uploadingSrt ? "Dang upload SRT..." : "Upload SRT vao project"}
            </button>

            <label>
              SRT dung de long tieng
              <input
                value={dubForm.srt_key}
                onChange={(e) =>
                  setDubForm((f) => ({ ...f, srt_key: e.target.value }))
                }
                placeholder="manual.translated.srt"
              />
            </label>
            <label>
              Giong doc
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
                Toc do
                <input
                  value={dubForm.rate}
                  onChange={(e) =>
                    setDubForm((f) => ({ ...f, rate: e.target.value }))
                  }
                  placeholder="+0%"
                />
              </label>
              <label>
                Format audio
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
              Khop tong thoi luong video goc
            </label>
            <button
              disabled={dubbing || editableSegments.length === 0}
              onClick={startDubAudio}
            >
              {dubbing ? "Dang dung audio..." : "Tao audio long tieng"}
            </button>
            {lastExport ? (
              <a
                className="download-link"
                href={lastExport.url}
                target="_blank"
                rel="noreferrer"
              >
                Tai subtitle: {lastExport.output_key}
              </a>
            ) : null}
            {latestDubJob?.artifacts?.dub_output_key ? (
              <a
                className="download-link"
                href={`${API_BASE}/jobs/${latestDubJob.id}/artifact/dubbed_audio`}
                target="_blank"
                rel="noreferrer"
              >
                Tai audio: {latestDubJob.artifacts.dub_output_key}
              </a>
            ) : null}
          </section>
        </aside>

        <section className="content">
          <section className="card preview-card">
            <div className="row-head">
              <h2>Xem trước ROI</h2>
              <div className="row-actions">
                <button type="button" onClick={() => setRoiEditMode((v) => !v)}>
                  {roiEditMode ? "Tắt chỉnh ROI" : "Bật chỉnh ROI"}
                </button>
                <button
                  type="button"
                  disabled={savingRoi}
                  onClick={saveSelectedRoi}
                >
                  {savingRoi ? "Đang lưu..." : "Lưu ROI"}
                </button>
              </div>
            </div>
            {selectedProject?.video_path ? (
              <>
                <p className="hint">
                  {roiEditMode
                    ? "Shift + kéo để tạo khung mới. Kéo khung/góc để chỉnh."
                    : "Tua video để kiểm tra subtitle có nằm đúng ROI không."}
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
                        <strong>Raw:</strong> {activeSegment.raw_text}
                      </p>
                      <p>
                        <strong>Dịch:</strong> {activeSegment.translated_text}
                      </p>
                    </>
                  ) : (
                    <p>Không có subtitle tại mốc này.</p>
                  )}
                </div>
              </>
            ) : (
              <p className="hint">
                Tải video lên để bắt đầu xem trước.
              </p>
            )}
          </section>

          <section className="card editor-card">
            <div className="row-head">
              <h2>Chỉnh sửa subtitle</h2>
              <span>{editableSegments.length} dòng</span>
            </div>
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
                    <th>Bắt đầu</th>
                    <th>Kết thúc</th>
                    <th>Gốc</th>
                    <th>Bản dịch</th>
                    <th>Nhân vật</th>
                    <th>Giọng</th>
                  </tr>
                </thead>
                <tbody>
                  {editableSegments.length === 0 ? (
                    <tr>
                      <td colSpan={7}>Chưa có dữ liệu</td>
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
          </section>
        </section>
      </main>

      {message ? <footer className="toast">{message}</footer> : null}
    </div>
  );
}
