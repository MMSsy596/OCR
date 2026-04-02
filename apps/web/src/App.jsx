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
  const [editableSegments, setEditableSegments] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [savingRoi, setSavingRoi] = useState(false);
  const [savingSegments, setSavingSegments] = useState(false);
  const [retranslating, setRetranslating] = useState(false);
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
  const latestJob = jobs[0];

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
        setRoiDraft(normalizeRoi({ x: base.x + dx, y: base.y + dy, w: base.w, h: base.h }));
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
      if (!isEditingSegments) setEditableSegments(s.map((row) => ({ ...row })));
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
        body: JSON.stringify({ ...projectForm, roi: normalizeRoi(projectForm.roi) }),
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
      await fetch(`${API_BASE}/projects/${selectedProjectId}/upload`, { method: "POST", body: form }).then(
        async (res) => {
          if (!res.ok) throw new Error(await res.text());
        },
      );
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
        if (k && v) acc[k.trim()] = v.trim();
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
      await jsonFetch(`${API_BASE}/projects/${selectedProjectId}/pipeline/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gemini_api_key: pipelineForm.gemini_api_key || null,
          voice_map: parseVoiceMap(pipelineForm.voiceMapText),
        }),
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
      setEditableSegments(updated.map((row) => ({ ...row })));
      setIsEditingSegments(false);
      setMessage("Da luu subtitle chinh sua.");
    } catch (err) {
      setMessage(`Loi luu subtitle: ${err.message}`);
    } finally {
      setSavingSegments(false);
    }
  }

  async function retranslateOnly() {
    if (!selectedProjectId) {
      setMessage("Chon project truoc.");
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
      const out = await jsonFetch(`${API_BASE}/projects/${selectedProjectId}/segments/retranslate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gemini_api_key: pipelineForm.gemini_api_key || null }),
      });
      setEditableSegments((out.segments || []).map((row) => ({ ...row })));
      setIsEditingSegments(false);
      setMessage(`Da dich lai. Stats: ${JSON.stringify(out.translation_stats || {})}`);
    } catch (err) {
      setMessage(`Loi dich lai: ${err.message}`);
    } finally {
      setRetranslating(false);
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
      setLastExport({ ...out, url: `${API_BASE}${out.download_url}` });
      setMessage(`Da export ${exportForm.export_format.toUpperCase()} (${exportForm.content_mode}).`);
    } catch (err) {
      setMessage(`Loi export: ${err.message}`);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1>NanBao OCR Studio</h1>
          <p>OCR, translate, edit, export subtitle in one focused workspace.</p>
        </div>
        <div className={`status-pill ${apiStatus}`}>
          API {apiStatus}
        </div>
      </header>

      <main className="workspace">
        <aside className="sidebar card">
          <section className="block">
            <h2>Project</h2>
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
            <details>
              <summary>Tao project moi</summary>
              <label>
                Ten project
                <input value={projectForm.name} onChange={(e) => setProjectForm((f) => ({ ...f, name: e.target.value }))} />
              </label>
              <div className="inline-two">
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
                <textarea rows={2} value={projectForm.prompt} onChange={(e) => setProjectForm((f) => ({ ...f, prompt: e.target.value }))} />
              </label>
              <label>
                Glossary
                <textarea rows={3} value={projectForm.glossary} onChange={(e) => setProjectForm((f) => ({ ...f, glossary: e.target.value }))} />
              </label>
              <button disabled={creating} onClick={createProject}>{creating ? "Dang tao..." : "Tao project"}</button>
            </details>
          </section>

          <section className="block">
            <h2>Pipeline</h2>
            <label>
              Video file
              <input type="file" accept="video/*" onChange={(e) => setVideoFile(e.target.files?.[0] || null)} />
            </label>
            <button disabled={loading} onClick={uploadVideo}>Upload video</button>
            <label>
              Gemini API key (optional)
              <input type="password" value={pipelineForm.gemini_api_key} onChange={(e) => setPipelineForm((f) => ({ ...f, gemini_api_key: e.target.value }))} />
            </label>
            <label>
              Voice map
              <textarea rows={3} value={pipelineForm.voiceMapText} onChange={(e) => setPipelineForm((f) => ({ ...f, voiceMapText: e.target.value }))} />
            </label>
            <button disabled={loading} onClick={startPipeline}>Start pipeline</button>
            {latestJob ? (
              <div className="info">
                <p><strong>Step:</strong> {latestJob.step}</p>
                <p><strong>Progress:</strong> {latestJob.progress}%</p>
                {latestJob.artifacts?.translation_stats ? <p><strong>Translate:</strong> {JSON.stringify(latestJob.artifacts.translation_stats)}</p> : null}
                {latestJob.artifacts?.translation_error_hint ? <p className="error">{latestJob.artifacts.translation_error_hint}</p> : null}
              </div>
            ) : null}
          </section>

          <section className="block">
            <h2>Export</h2>
            <label>
              Content mode
              <select value={exportForm.content_mode} onChange={(e) => setExportForm((f) => ({ ...f, content_mode: e.target.value }))}>
                <option value="raw">Chi ban goc</option>
                <option value="translated">Chi ban dich</option>
                <option value="bilingual">Song ngu</option>
              </select>
            </label>
            <label>
              Format
              <select value={exportForm.export_format} onChange={(e) => setExportForm((f) => ({ ...f, export_format: e.target.value }))}>
                <option value="srt">SRT (CapCut)</option>
                <option value="vtt">VTT</option>
                <option value="csv">CSV</option>
                <option value="txt">TXT</option>
                <option value="json">JSON</option>
              </select>
            </label>
            <button disabled={savingSegments || editableSegments.length === 0} onClick={saveSegments}>
              {savingSegments ? "Dang luu..." : "Luu subtitle"}
            </button>
            <button disabled={retranslating || editableSegments.length === 0} onClick={retranslateOnly}>
              {retranslating ? "Dang dich lai..." : "Dich lai"}
            </button>
            <button disabled={exporting || editableSegments.length === 0} onClick={exportSubtitle}>
              {exporting ? "Dang export..." : "Export"}
            </button>
            {lastExport ? (
              <a className="download-link" href={lastExport.url} target="_blank" rel="noreferrer">
                Tai file: {lastExport.output_key}
              </a>
            ) : null}
          </section>
        </aside>

        <section className="content">
          <section className="card preview-card">
            <div className="row-head">
              <h2>Preview ROI</h2>
              <div className="row-actions">
                <button type="button" onClick={() => setRoiEditMode((v) => !v)}>{roiEditMode ? "Tat ROI Edit" : "Bat ROI Edit"}</button>
                <button type="button" disabled={savingRoi} onClick={saveSelectedRoi}>{savingRoi ? "Dang luu..." : "Luu ROI"}</button>
              </div>
            </div>
            {selectedProject?.video_path ? (
              <>
                <p className="hint">
                  {roiEditMode
                    ? "Shift + keo de tao khung moi. Keo khung/goc de chinh."
                    : "Tua video de kiem tra subtitle co nam dung ROI khong."}
                </p>
                <div className="preview-stage" ref={stageRef} onMouseDown={beginDraw}>
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
                        <div className="roi-handle nw" onMouseDown={(e) => beginResize("nw", e)} />
                        <div className="roi-handle ne" onMouseDown={(e) => beginResize("ne", e)} />
                        <div className="roi-handle sw" onMouseDown={(e) => beginResize("sw", e)} />
                        <div className="roi-handle se" onMouseDown={(e) => beginResize("se", e)} />
                      </>
                    ) : null}
                  </div>
                </div>
                <div className="timeline-card">
                  <p><strong>Time:</strong> {currentVideoTime.toFixed(2)}s</p>
                  {activeSegment ? (
                    <>
                      <p><strong>Active:</strong> #{activeSegment.id} ({Number(activeSegment.start_sec).toFixed(2)} - {Number(activeSegment.end_sec).toFixed(2)})</p>
                      <p><strong>Raw:</strong> {activeSegment.raw_text}</p>
                      <p><strong>Translated:</strong> {activeSegment.translated_text}</p>
                    </>
                  ) : (
                    <p>Khong co subtitle tai moc nay.</p>
                  )}
                </div>
              </>
            ) : (
              <p className="hint">Upload video de bat dau preview.</p>
            )}
          </section>

          <section className="card editor-card">
            <div className="row-head">
              <h2>Subtitle Editor</h2>
              <span>{editableSegments.length} segments</span>
            </div>
            <div className="table-wrap">
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
                        <td><input type="number" step="0.01" value={s.start_sec} onChange={(e) => updateEditableSegment(s.id, "start_sec", e.target.value)} /></td>
                        <td><input type="number" step="0.01" value={s.end_sec} onChange={(e) => updateEditableSegment(s.id, "end_sec", e.target.value)} /></td>
                        <td><textarea rows={2} value={s.raw_text} onChange={(e) => updateEditableSegment(s.id, "raw_text", e.target.value)} /></td>
                        <td><textarea rows={2} value={s.translated_text} onChange={(e) => updateEditableSegment(s.id, "translated_text", e.target.value)} /></td>
                        <td><input value={s.speaker} onChange={(e) => updateEditableSegment(s.id, "speaker", e.target.value)} /></td>
                        <td><input value={s.voice} onChange={(e) => updateEditableSegment(s.id, "voice", e.target.value)} /></td>
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
