import { useState } from "react";
import { readApiErrorMessage, withApiAuth } from "../lib/api";

async function normalizeApiError(err, fallback) {
  return readApiErrorMessage(err, fallback);
}

export function useProjectActions(deps) {
  const {
    apiBase,
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
    composePrompt,
    selectedProject,
    setProjectForm,
    setRoiDraft,
  } = deps;

  const [creating, setCreating] = useState(false);
  const [clearingSessions, setClearingSessions] = useState(false);
  const [forceClearingSessions, setForceClearingSessions] = useState(false);
  const [loading, setLoading] = useState(false);
  const [savingRoi, setSavingRoi] = useState(false);
  const [ingestingUrl, setIngestingUrl] = useState(false);

  async function createProject() {
    setCreating(true);
    setMessage("⏳ Đang khởi tạo dự án mới...");
    try {
      const created = await jsonFetch(`${apiBase}/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...projectForm,
          roi: normalizeRoi(projectForm.roi),
        }),
      });
      await loadProjectsSafe();
      setSelectedProjectId(created.id);
      setWizardStep(2); // Tự động sang bước 2: Tải video
      setMessage(`✅ Đã tạo dự án: ${created.name}`);
    } catch (err) {
      setMessage(`❌ Lỗi tạo dự án: ${await normalizeApiError(err, "create_project_failed")}`);
    } finally {
      setCreating(false);
    }
  }

  async function clearOldSessions() {
    setClearingSessions(true);
    setMessage("⏳ Đang xóa các phiên cũ...");
    try {
      const out = await jsonFetch(`${apiBase}/projects/clear-sessions`, {
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
        `✅ Đã xóa ${out.deleted_projects} phiên cũ, bỏ qua ${out.skipped_processing_projects} phiên đang chạy.`,
      );
    } catch (err) {
      setMessage(`❌ Lỗi dọn phiên: ${await normalizeApiError(err, "clear_sessions_failed")}`);
    } finally {
      setClearingSessions(false);
    }
  }

  async function forceClearAllSessions() {
    setForceClearingSessions(true);
    setMessage("⏳ Đang xóa ngay tất cả phiên (kể cả đang xử lý)...");
    try {
      const out = await jsonFetch(`${apiBase}/projects/clear-sessions`, {
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
        `✅ Đã xóa cưỡng bức: ${out.deleted_projects} phiên; dọn ${out.removed_storage_dirs} thư mục.`,
      );
    } catch (err) {
      setMessage(`❌ Lỗi xóa cưỡng bức phiên: ${await normalizeApiError(err, "force_clear_failed")}`);
    } finally {
      setForceClearingSessions(false);
    }
  }

  async function uploadVideo() {
    if (!selectedProjectId || !videoFile) {
      setMessage("⚠️ Chọn dự án và tệp video trước.");
      return;
    }
    setLoading(true);
    setMessage("⏳ Đang tải video lên máy chủ, vui lòng đợi...");
    try {
      const form = new FormData();
      form.append("file", videoFile);
      const res = await fetch(`${apiBase}/projects/${selectedProjectId}/upload`, withApiAuth({
        method: "POST",
        body: form,
      }));
      if (!res.ok) throw new Error(await readApiErrorMessage(res, "upload_video_failed"));
      await loadProjectsSafe();
      await loadProjectData(selectedProjectId);
      setMessage("✅ Tải video lên thành công.");
      setWizardStep(3); // Chuyển sang bước 3: Vùng OCR
    } catch (err) {
      setMessage(`❌ Lỗi tải lên: ${await normalizeApiError(err, "upload_video_failed")}`);
    } finally {
      setLoading(false);
    }
  }

  async function ingestVideoFromUrl(formatId = null) {
    if (!selectedProjectId || !sourceUrl.trim()) {
      setMessage("⚠️ Chọn dự án và dán link trước.");
      return null;
    }
    setIngestingUrl(true);
    setMessage("⏳ Đang gửi yêu cầu tải video từ đường dẫn...");
    try {
      const job = await jsonFetch(`${apiBase}/projects/${selectedProjectId}/ingest-url/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_url: sourceUrl.trim(),
          auto_start_pipeline: autoStartAfterIngest,
          input_mode: pipelineForm.input_mode || "video_ocr",
          gemini_api_key: pipelineForm.gemini_api_key || null,
          voice_map: parseVoiceMap(pipelineForm.voiceMapText),
          scan_interval_sec: Number(pipelineForm.scan_interval_sec) || 1.5,
          format_id: formatId || null,
        }),
      });
      await loadProjectData(selectedProjectId);
      setMessage(
        autoStartAfterIngest
          ? "✅ Đã nhận link, đang tải và sẽ tự chạy pipeline."
          : "✅ Đã nhận link, đang tự tải video vào dự án.",
      );
      // Không tự chuyển bước — để Step2Upload handle
      return job;
    } catch (err) {
      setMessage(`❌ Lỗi nhận link: ${await normalizeApiError(err, "ingest_url_failed")}`);
      return null;
    } finally {
      setIngestingUrl(false);
    }
  }

  async function saveSelectedRoi() {
    if (!selectedProjectId) {
      setMessage("⚠️ Chọn dự án trước khi lưu ROI.");
      return;
    }
    setSavingRoi(true);
    setMessage("⏳ Đang lưu vùng chuẩn nhận diện (ROI)...");
    try {
      const updated = await jsonFetch(`${apiBase}/projects/${selectedProjectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roi: normalizeRoi(roiDraft) }),
      });
      setProjects((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      setRoiDraft(normalizeRoi(updated.roi));
      setMessage("✅ Đã cấu hình Video và vùng quét ROI thành công.");
      setWizardStep(4); // Chuyển sang bước 4: Xử lý
    } catch (err) {
      setMessage(`❌ Lỗi lưu ROI: ${await normalizeApiError(err, "save_roi_failed")}`);
    } finally {
      setSavingRoi(false);
    }
  }

  function applyPresetToCreateForm() {
    const prompt = composePrompt();
    setProjectForm((prev) => ({ ...prev, prompt }));
    setMessage("Đã nạp prompt preset vào ô 'Lời nhắc'.");
  }

  async function applyPresetToCurrentProject() {
    if (!selectedProjectId) {
      setMessage("Chọn dự án trước.");
      return;
    }
    const prompt = composePrompt();
    try {
      const updated = await jsonFetch(`${apiBase}/projects/${selectedProjectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      setProjects((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      setProjectForm((prev) => ({ ...prev, prompt }));
      setMessage("Đã áp dụng prompt preset vào dự án hiện tại.");
    } catch (err) {
      setMessage(`Lỗi cập nhật prompt dự án: ${await normalizeApiError(err, "apply_preset_failed")}`);
    }
  }

  async function syncPromptPresetForCurrentProjectIfEnabled(autoApplyPromptPreset) {
    if (!autoApplyPromptPreset || !selectedProjectId) return;
    const prompt = composePrompt();
    if ((selectedProject?.prompt || "").trim() === prompt.trim()) return;
    const updated = await jsonFetch(`${apiBase}/projects/${selectedProjectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    setProjects((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
  }

  return {
    creating,
    clearingSessions,
    forceClearingSessions,
    loading,
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
  };
}
