import { useState } from "react";
import { withApiAuth } from "../lib/api";

function normalizeApiError(err, fallback) {
  return err?.message || fallback;
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
    setMessage("");
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
      setMessage(`Đã tạo dự án: ${created.name}`);
    } catch (err) {
      setMessage(`Lỗi tạo dự án: ${normalizeApiError(err, "create_project_failed")}`);
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
        `Đã xóa ${out.deleted_projects} phiên cũ, bỏ qua ${out.skipped_processing_projects} phiên đang chạy.`,
      );
    } catch (err) {
      setMessage(`Lỗi dọn phiên: ${normalizeApiError(err, "clear_sessions_failed")}`);
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
        `Đã xóa cưỡng bức: ${out.deleted_projects} phiên; dọn ${out.removed_storage_dirs} thư mục.`,
      );
    } catch (err) {
      setMessage(`Lỗi xóa cưỡng bức phiên: ${normalizeApiError(err, "force_clear_failed")}`);
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
      await fetch(`${apiBase}/projects/${selectedProjectId}/upload`, withApiAuth({
        method: "POST",
        body: form,
      })).then(async (res) => {
        if (!res.ok) throw new Error(await res.text());
      });
      await loadProjectsSafe();
      await loadProjectData(selectedProjectId);
      setMessage("Tải video lên thành công.");
      setWizardStep(2);
    } catch (err) {
      setMessage(`Lỗi tải lên: ${normalizeApiError(err, "upload_video_failed")}`);
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
      await jsonFetch(`${apiBase}/projects/${selectedProjectId}/ingest-url/start`, {
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
      setMessage(`Lỗi nhận link: ${normalizeApiError(err, "ingest_url_failed")}`);
    } finally {
      setIngestingUrl(false);
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
      const updated = await jsonFetch(`${apiBase}/projects/${selectedProjectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roi: normalizeRoi(roiDraft) }),
      });
      setProjects((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      setRoiDraft(normalizeRoi(updated.roi));
      setMessage("Đã lưu ROI cho dự án.");
    } catch (err) {
      setMessage(`Lỗi lưu ROI: ${normalizeApiError(err, "save_roi_failed")}`);
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
      setMessage(`Lỗi cập nhật prompt dự án: ${normalizeApiError(err, "apply_preset_failed")}`);
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
