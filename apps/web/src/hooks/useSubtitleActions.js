import { useState } from "react";
import { appendApiToken, withApiAuth } from "../lib/api";

function normalizeApiError(err, fallback) {
  return err?.message || fallback;
}

export function useSubtitleActions(deps) {
  const {
    apiBase,
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
  } = deps;

  const [savingSegments, setSavingSegments] = useState(false);
  const [retranslating, setRetranslating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [dubbing, setDubbing] = useState(false);
  const [uploadingSrt, setUploadingSrt] = useState(false);
  const [retryingStuckJobs, setRetryingStuckJobs] = useState(false);

  function segmentPayload() {
    return editableSegments.map((row) => ({
      id: row.id,
      start_sec: Number(row.start_sec),
      end_sec: Number(row.end_sec),
      raw_text: row.raw_text ?? "",
      translated_text: row.translated_text ?? "",
      speaker: row.speaker ?? "narrator",
      voice: row.voice ?? "narrator-neutral",
    }));
  }

  async function saveSegments() {
    if (!selectedProjectId) {
      setMessage("Chọn dự án trước.");
      return;
    }
    setSavingSegments(true);
    setMessage("");
    try {
      const updated = await jsonFetch(`${apiBase}/projects/${selectedProjectId}/segments`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(segmentPayload()),
      });
      setEditableSegments(updated.map((row) => ({ ...row })));
      setUndoStack([]);
      setRedoStack([]);
      setIsEditingSegments(false);
      setMessage("Đã lưu phụ đề đã chỉnh sửa.");
    } catch (err) {
      setMessage(`Lỗi lưu phụ đề: ${normalizeApiError(err, "save_segments_failed")}`);
    } finally {
      setSavingSegments(false);
    }
  }

  async function retranslateOnly(autoApplyPromptPreset) {
    if (!selectedProjectId) {
      setMessage("Chọn dự án trước.");
      return;
    }
    setRetranslating(true);
    setMessage("");
    try {
      await syncPromptPresetForCurrentProjectIfEnabled(autoApplyPromptPreset);
      await jsonFetch(`${apiBase}/projects/${selectedProjectId}/segments`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(segmentPayload()),
      });
      const out = await jsonFetch(`${apiBase}/projects/${selectedProjectId}/segments/retranslate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gemini_api_key: pipelineForm.gemini_api_key || null,
        }),
      });
      setEditableSegments((out.segments || []).map((row) => ({ ...row })));
      setUndoStack([]);
      setRedoStack([]);
      setIsEditingSegments(false);
      setMessage(`Đã dịch lại. Thống kê: ${JSON.stringify(out.translation_stats || {})}`);
    } catch (err) {
      setMessage(`Lỗi dịch lại: ${normalizeApiError(err, "retranslate_failed")}`);
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
      const out = await jsonFetch(`${apiBase}/projects/${selectedProjectId}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(exportForm),
      });
      setLastExport({ ...out, url: appendApiToken(`${apiBase}${out.download_url}`) });
      setMessage(`Đã xuất ${exportForm.export_format.toUpperCase()} (${exportForm.content_mode}).`);
    } catch (err) {
      setMessage(`Lỗi xuất tệp: ${normalizeApiError(err, "export_failed")}`);
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
      await jsonFetch(`${apiBase}/projects/${selectedProjectId}/dub/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dubForm),
      });
      setMessage(`Đã bắt đầu dựng âm thanh (${dubForm.output_format.toUpperCase()}).`);
      setWizardStep(4);
    } catch (err) {
      setMessage(`Lỗi dựng âm thanh: ${normalizeApiError(err, "dub_failed")}`);
    } finally {
      setDubbing(false);
    }
  }

  async function uploadExternalSrt(srtUploadFile, setDubForm) {
    if (!selectedProjectId || !srtUploadFile) {
      setMessage("Chọn dự án và tệp SRT trước.");
      return;
    }
    setUploadingSrt(true);
    setMessage("");
    try {
      const form = new FormData();
      form.append("file", srtUploadFile);
      const res = await fetch(`${apiBase}/projects/${selectedProjectId}/srt/upload`, withApiAuth({
        method: "POST",
        body: form,
      }));
      if (!res.ok) throw new Error(await res.text());
      const out = await res.json();
      setDubForm((prev) => ({ ...prev, srt_key: out.output_key }));
      setMessage(`Đã tải lên SRT: ${out.output_key}`);
    } catch (err) {
      setMessage(`Lỗi tải lên SRT: ${normalizeApiError(err, "srt_upload_failed")}`);
    } finally {
      setUploadingSrt(false);
    }
  }

  async function downloadDubAudio() {
    if (!latestDubAudioUrl) {
      setMessage("Chưa có file âm thanh để tải.");
      return;
    }
    try {
      const res = await fetch(appendApiToken(latestDubAudioUrl), withApiAuth());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
      setMessage(`Lỗi tải file âm thanh: ${normalizeApiError(err, "download_dub_failed")}`);
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
      const out = await jsonFetch(`${apiBase}/projects/${selectedProjectId}/jobs/retry-stuck`, {
        method: "POST",
      });
      await loadProjectData(selectedProjectId, { includeSegments: false });
      setMessage(`Đã thử lại ${out.retried_count} tác vụ bị kẹt. Bỏ qua ${out.skipped_count}.`);
    } catch (err) {
      setMessage(`Lỗi thử lại tác vụ trong hàng đợi: ${normalizeApiError(err, "retry_jobs_failed")}`);
    } finally {
      setRetryingStuckJobs(false);
    }
  }

  return {
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
  };
}
