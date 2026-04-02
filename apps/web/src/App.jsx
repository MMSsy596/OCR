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

export function App() {
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [segments, setSegments] = useState([]);
  const [editableSegments, setEditableSegments] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [savingRoi, setSavingRoi] = useState(false);
  const [savingSegments, setSavingSegments] = useState(false);
  const [isEditingSegments, setIsEditingSegments] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [lastExport, setLastExport] = useState(null);
  const [projectForm, setProjectForm] = useState({
    name: "NanBao Project",
    source_lang: "zh",
    target_lang: "vi",
    prompt: "Dich theo van phong phim co trang, tu nhien, ngan gon.",
    glossary: "Dao huynh=Su huynh\nTien ton=Tien Ton",
    roi: { x: 0.1, y: 0.75, w: 0.8, h: 0.2 },
  });
  const [videoFile, setVideoFile] = useState(null);
  const [pipelineForm, setPipelineForm] = useState({
    gemini_api_key: "",
    voiceMapText: "character_a=male-deep\ncharacter_b=female-bright\nnarrator=narrator-neutral",
  });
  const [exportForm, setExportForm] = useState({
    export_format: "srt",
    content_mode: "translated",
  });
  const [message, setMessage] = useState("");
  const [apiStatus, setApiStatus] = useState("checking");
  const [roiDraft, setRoiDraft] = useState({ x: 0.1, y: 0.75, w: 0.8, h: 0.2 });
  const [dragState, setDragState] = useState(null);
  const [currentVideoTime, setCurrentVideoTime] = useState(0);
  const [roiEditMode, setRoiEditMode] = useState(false);

  const stageRef = useRef(null);
  const videoRef = useRef(null);

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId) || null,
    [projects, selectedProjectId],
  );
  const videoSrc = selectedProjectId ? `${API_BASE}/projects/${selectedProjectId}/video` : "";
  const activeSegment = useMemo(() => {
    return editableSegments.find(
      (seg) => currentVideoTime >= Number(seg.start_sec) && currentVideoTime <= Number(seg.end_sec),
    );
  }, [editableSegments, currentVideoTime]);

  useEffect(() => {
    loadProjectsSafe();
  }, []);

  useEffect(() => {
    if (!selectedProjectId) return;
    loadProjectData(selectedProjectId);
    const timer = setInterval(() => loadProjectData(selectedProjectId), 2000);
    return () => clearInterval(timer);
  }, [selectedProjectId, isEditingSegments]);

  useEffect(() => {
    if (selectedProject?.roi) {
      setRoiDraft(normalizeRoi(selectedProject.roi));
    }
  }, [selectedProjectId]);

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
        const moved = normalizeRoi({
          x: base.x + dx,
          y: base.y + dy,
          w: base.w,
          h: base.h,
        });
        setRoiDraft(moved);
        return;
      }

      if (mode === "resize") {
        const dx = pt.x - start.x;
        const dy = pt.y - start.y;
        let next = { ...base };
        if (handle === "nw") next = { x: base.x + dx, y: base.y + dy, w: base.w - dx, h: base.h - dy };
        if (handle === "ne") next = { x: base.x, y: base.y + dy, w: base.w + dx, h: base.h - dy };
        if (handle === "sw") next = { x: base.x + dx, y: base.y, w: base.w - dx, h: base.h + dy };
        if (handle === "se") next = { x: base.x, y: base.y, w: base.w + dx, h: base.h + dy };
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
    const x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const y = clamp((event.clientY - rect.top) / rect.height, 0, 1);
    return { x, y };
  }

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
      setMessage(`Khong ket noi duoc API ${API_BASE}. Hay chay backend.`);
      console.error(err);
    }
  }

  async function loadProjectData(projectId) {
    try {
      const [s, j, p] = await Promise.all([
        jsonFetch(`${API_BASE}/projects/${projectId}/segments`),
        jsonFetch(`${API_BASE}/projects/${projectId}/jobs`),
        jsonFetch(`${API_BASE}/projects/${projectId}`),
      ]);
      setSegments(s);
      if (!isEditingSegments) {
        setEditableSegments(s.map((row) => ({ ...row })));
      }
      setJobs(j);
      setProjects((prev) => prev.map((item) => (item.id === p.id ? p : item)));
    } catch {
      // Ignore poll errors
    }
  }

  async function createProject() {
    setCreating(true);
    setMessage("");
    try {
      const payload = {
        ...projectForm,
        roi: normalizeRoi(projectForm.roi),
      };
      const created = await jsonFetch(`${API_BASE}/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      await loadProjectsSafe();
      setSelectedProjectId(created.id);
      setMessage(`Da tao project: ${created.name}`);
    } catch (err) {
      setMessage(`Loi tao project: ${err.message}`);
    } finally {
      setCreating(false);
    }
  }

  async function uploadVideo() {
    if (!selectedProjectId || !videoFile) {
      setMessage("Chon project va file video truoc.");
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
        if (!res.ok) {
          throw new Error(await res.text());
        }
      });
      await loadProjectsSafe();
      await loadProjectData(selectedProjectId);
      setMessage("Upload video thanh cong.");
    } catch (err) {
      setMessage(`Loi upload: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function saveSelectedRoi() {
    if (!selectedProjectId) {
      setMessage("Chon project truoc khi luu ROI.");
      return;
    }
    setSavingRoi(true);
    setMessage("");
    try {
      const updated = await jsonFetch(`${API_BASE}/projects/${selectedProjectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roi: normalizeRoi(roiDraft) }),
      });
      setProjects((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      setRoiDraft(normalizeRoi(updated.roi));
      setMessage("Da luu ROI cho project.");
    } catch (err) {
      setMessage(`Loi luu ROI: ${err.message}`);
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
        if (k && v) {
          acc[k.trim()] = v.trim();
        }
        return acc;
      }, {});
  }

  async function startPipeline() {
    if (!selectedProjectId) {
      setMessage("Chon project truoc.");
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const payload = {
        gemini_api_key: pipelineForm.gemini_api_key || null,
        voice_map: parseVoiceMap(pipelineForm.voiceMapText),
      };
      await jsonFetch(`${API_BASE}/projects/${selectedProjectId}/pipeline/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setIsEditingSegments(false);
      await loadProjectData(selectedProjectId);
      setMessage("Pipeline da duoc enqueue.");
    } catch (err) {
      setMessage(`Loi start pipeline: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  function beginDraw(event) {
    if (!roiEditMode) return;
    if (!selectedProject?.video_path) return;
    if (!event.shiftKey) return;
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
    setIsEditingSegments(true);
    setEditableSegments((prev) =>
      prev.map((row) =>
        row.id === id
          ? { ...row, [field]: field === "start_sec" || field === "end_sec" ? Number(value) : value }
          : row,
      ),
    );
  }

  async function saveSegments() {
    if (!selectedProjectId) {
      setMessage("Chon project truoc.");
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
      const updated = await jsonFetch(`${API_BASE}/projects/${selectedProjectId}/segments`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setSegments(updated);
      setEditableSegments(updated.map((row) => ({ ...row })));
      setIsEditingSegments(false);
      setMessage("Da luu subtitle chinh sua.");
    } catch (err) {
      setMessage(`Loi luu subtitle: ${err.message}`);
    } finally {
      setSavingSegments(false);
    }
  }

  async function exportSubtitle() {
    if (!selectedProjectId) {
      setMessage("Chon project truoc.");
      return;
    }
    setExporting(true);
    setMessage("");
    try {
      const out = await jsonFetch(`${API_BASE}/projects/${selectedProjectId}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(exportForm),
      });
      setLastExport({
        ...out,
        url: `${API_BASE}${out.download_url}`,
      });
      setMessage(`Da export ${exportForm.export_format.toUpperCase()} (${exportForm.content_mode}).`);
    } catch (err) {
      setMessage(`Loi export: ${err.message}`);
    } finally {
      setExporting(false);
    }
  }

  const latestJob = jobs[0];

  return (
    <div className="app-shell">
      <header className="topbar">
        <h1>NanBao OCR Video Studio</h1>
        <p>OCR to Translate to TTS to Export</p>
        <p>
          API: {apiStatus === "online" ? "online" : apiStatus === "offline" ? "offline" : "checking"} ({API_BASE})
        </p>
      </header>

      <main className="grid">
        <section className="panel">
          <h2>Tao Project</h2>
          <label>
            Ten project
            <input
              value={projectForm.name}
              onChange={(e) => setProjectForm((f) => ({ ...f, name: e.target.value }))}
            />
          </label>
          <div className="two-col">
            <label>
              Source
              <input
                value={projectForm.source_lang}
                onChange={(e) => setProjectForm((f) => ({ ...f, source_lang: e.target.value }))}
              />
            </label>
            <label>
              Target
              <input
                value={projectForm.target_lang}
                onChange={(e) => setProjectForm((f) => ({ ...f, target_lang: e.target.value }))}
              />
            </label>
          </div>
          <label>
            Prompt
            <textarea
              rows={3}
              value={projectForm.prompt}
              onChange={(e) => setProjectForm((f) => ({ ...f, prompt: e.target.value }))}
            />
          </label>
          <label>
            Glossary (src=dst, moi dong mot cap)
            <textarea
              rows={4}
              value={projectForm.glossary}
              onChange={(e) => setProjectForm((f) => ({ ...f, glossary: e.target.value }))}
            />
          </label>
          <button disabled={creating} onClick={createProject}>
            {creating ? "Dang tao..." : "Tao project"}
          </button>
        </section>

        <section className="panel">
          <h2>Pipeline</h2>
          <label>
            Chon project
            <select value={selectedProjectId} onChange={(e) => setSelectedProjectId(e.target.value)}>
              <option value="">-- Chon --</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.status})
                </option>
              ))}
            </select>
          </label>

          <label>
            Video file
            <input type="file" accept="video/*" onChange={(e) => setVideoFile(e.target.files?.[0] || null)} />
          </label>
          <button disabled={loading} onClick={uploadVideo}>
            Upload video
          </button>

          <label>
            Gemini API key (optional)
            <input
              type="password"
              value={pipelineForm.gemini_api_key}
              onChange={(e) => setPipelineForm((f) => ({ ...f, gemini_api_key: e.target.value }))}
            />
          </label>

          <label>
            Voice map (speaker=voice)
            <textarea
              rows={4}
              value={pipelineForm.voiceMapText}
              onChange={(e) => setPipelineForm((f) => ({ ...f, voiceMapText: e.target.value }))}
            />
          </label>
          <button disabled={loading} onClick={startPipeline}>
            Start pipeline
          </button>

          {selectedProject && (
            <div className="status-box">
              <p>
                <strong>Status:</strong> {selectedProject.status}
              </p>
              <p>
                <strong>Video:</strong> {selectedProject.video_path || "chua upload"}
              </p>
            </div>
          )}

          {latestJob && (
            <div className="status-box">
              <p>
                <strong>Job:</strong> {latestJob.id}
              </p>
              <p>
                <strong>Step:</strong> {latestJob.step}
              </p>
              <p>
                <strong>Progress:</strong> {latestJob.progress}%
              </p>
              <p>
                <strong>Status:</strong> {latestJob.status}
              </p>
              {latestJob.error_message ? (
                <p className="error">
                  <strong>Error:</strong> {latestJob.error_message}
                </p>
              ) : null}
              {latestJob.artifacts?.translation_stats ? (
                <p>
                  <strong>Translate stats:</strong> {JSON.stringify(latestJob.artifacts.translation_stats)}
                </p>
              ) : null}
              {latestJob.artifacts?.translation_error_hint ? (
                <p className="error">
                  <strong>Translate hint:</strong> {latestJob.artifacts.translation_error_hint}
                </p>
              ) : null}
            </div>
          )}
        </section>

        <section className="panel full">
          <h2>Video Preview + ROI</h2>
          {selectedProject?.video_path ? (
            <>
              <div className="preview-toolbar">
                <div className="roi-readout">
                  ROI: x={roiDraft.x.toFixed(3)} y={roiDraft.y.toFixed(3)} w={roiDraft.w.toFixed(3)} h=
                  {roiDraft.h.toFixed(3)}
                </div>
                <button
                  type="button"
                  className="save-roi-btn"
                  onClick={() => setRoiEditMode((v) => !v)}
                >
                  {roiEditMode ? "Tat che do chinh ROI" : "Bat che do chinh ROI"}
                </button>
                <button disabled={savingRoi} onClick={saveSelectedRoi} className="save-roi-btn">
                  {savingRoi ? "Dang luu ROI..." : "Luu ROI cho project"}
                </button>
              </div>
              <p className="preview-hint">
                {roiEditMode
                  ? "Dang chinh ROI: giu Shift + keo de ve khung, keo khung de di chuyen, keo 4 goc de resize."
                  : "Dang xem video: ban co the play/pause/tua de kiem tra do lech subtitle."}
              </p>
              <div className="preview-stage" ref={stageRef} onMouseDown={beginDraw}>
                <video
                  ref={videoRef}
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
                  <div className="roi-label">OCR ROI</div>
                  {roiEditMode ? (
                    <>
                      <div className="roi-handle nw" onMouseDown={(e) => beginResize("nw", e)} />
                      <div className="roi-handle ne" onMouseDown={(e) => beginResize("ne", e)} />
                      <div className="roi-handle sw" onMouseDown={(e) => beginResize("sw", e)} />
                      <div className="roi-handle se" onMouseDown={(e) => beginResize("se", e)} />
                    </>
                  ) : null}
                </div>
              </div>
              <div className="status-box">
                <p>
                  <strong>Current time:</strong> {currentVideoTime.toFixed(2)}s
                </p>
                {activeSegment ? (
                  <>
                    <p>
                      <strong>Active segment:</strong> #{activeSegment.id} ({Number(activeSegment.start_sec).toFixed(2)}
                      s - {Number(activeSegment.end_sec).toFixed(2)}s)
                    </p>
                    <p>
                      <strong>Raw:</strong> {activeSegment.raw_text}
                    </p>
                    <p>
                      <strong>Translated:</strong> {activeSegment.translated_text}
                    </p>
                  </>
                ) : (
                  <p>Khong co subtitle tai moc thoi gian hien tai.</p>
                )}
              </div>
            </>
          ) : (
            <p>Chua co video. Hay upload video truoc de preview ROI.</p>
          )}
        </section>

        <section className="panel full">
          <h2>Edit Subtitle + Export</h2>
          <div className="edit-actions">
            <button disabled={savingSegments || editableSegments.length === 0} onClick={saveSegments}>
              {savingSegments ? "Dang luu..." : "Luu subtitle da edit"}
            </button>
            <label>
              Content mode
              <select
                value={exportForm.content_mode}
                onChange={(e) => setExportForm((f) => ({ ...f, content_mode: e.target.value }))}
              >
                <option value="raw">Chi ban goc</option>
                <option value="translated">Chi ban dich</option>
                <option value="bilingual">Song ngu</option>
              </select>
            </label>
            <label>
              Format
              <select
                value={exportForm.export_format}
                onChange={(e) => setExportForm((f) => ({ ...f, export_format: e.target.value }))}
              >
                <option value="srt">SRT (CapCut)</option>
                <option value="vtt">VTT</option>
                <option value="csv">CSV</option>
                <option value="txt">TXT (timestamp)</option>
                <option value="json">JSON</option>
              </select>
            </label>
            <button disabled={exporting || editableSegments.length === 0} onClick={exportSubtitle}>
              {exporting ? "Dang export..." : "Export subtitle"}
            </button>
          </div>
          {lastExport ? (
            <p>
              File export:{" "}
              <a href={lastExport.url} target="_blank" rel="noreferrer">
                {lastExport.output_key}
              </a>
            </p>
          ) : null}
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Start</th>
                <th>End</th>
                <th>Raw</th>
                <th>Translated</th>
                <th>Speaker</th>
                <th>Voice</th>
              </tr>
            </thead>
            <tbody>
              {editableSegments.length === 0 ? (
                <tr>
                  <td colSpan={7}>Chua co du lieu</td>
                </tr>
              ) : (
                editableSegments.map((s) => (
                  <tr key={s.id} className={activeSegment?.id === s.id ? "active-row" : ""}>
                    <td>{s.id}</td>
                    <td>
                      <input
                        type="number"
                        step="0.01"
                        value={s.start_sec}
                        onChange={(e) => updateEditableSegment(s.id, "start_sec", e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.01"
                        value={s.end_sec}
                        onChange={(e) => updateEditableSegment(s.id, "end_sec", e.target.value)}
                      />
                    </td>
                    <td>
                      <textarea
                        rows={2}
                        value={s.raw_text}
                        onChange={(e) => updateEditableSegment(s.id, "raw_text", e.target.value)}
                      />
                    </td>
                    <td>
                      <textarea
                        rows={2}
                        value={s.translated_text}
                        onChange={(e) => updateEditableSegment(s.id, "translated_text", e.target.value)}
                      />
                    </td>
                    <td>
                      <input value={s.speaker} onChange={(e) => updateEditableSegment(s.id, "speaker", e.target.value)} />
                    </td>
                    <td>
                      <input value={s.voice} onChange={(e) => updateEditableSegment(s.id, "voice", e.target.value)} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
      </main>

      {message ? <footer className="message">{message}</footer> : null}
    </div>
  );
}
