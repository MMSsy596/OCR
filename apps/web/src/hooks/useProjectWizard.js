import { useEffect, useMemo, useState } from "react";

export function useProjectWizard({
  selectedProject,
  latestPipelineJob,
  latestJobEvents,
  latestJobStats,
  editableSegments,
  jobs,
  hasValidRoi,
  pipelineInputMode,
  setMessage,
}) {
  const [wizardStep, setWizardStep] = useState(1);

  const hasProject  = Boolean(selectedProject);
  const hasVideo    = Boolean(selectedProject?.video_path);
  const hasSavedRoi = useMemo(
    () => hasVideo && hasValidRoi(selectedProject?.roi),
    [hasVideo, selectedProject?.roi, hasValidRoi],
  );
  const requiresRoi = pipelineInputMode !== "audio_asr";

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

  /**
   * Mức step đã hoàn thành — dùng để lock/unlock wizard:
   *  0 = chưa chọn dự án  → step 1 accessible (via +1 rule)
   *  1 = có dự án          → step 2 accessible
   *  2 = có video          → step 3 accessible
   *  3 = có ROI (hoặc audio mode) → step 4 accessible
   *  4 = có tiến trình OCR/dub   → step 5 accessible
   */
  const maxUnlockedStep = useMemo(() => {
    if (!hasProject || !hasVideo)   return 0;
    if (requiresRoi && !hasSavedRoi) return 1;
    if (!hasOcrProgress && !hasDubActivity) return 2;
    if (hasDubActivity) return 5;
    return 3;
  }, [hasProject, hasVideo, requiresRoi, hasSavedRoi, hasOcrProgress, hasDubActivity]);

  const canGoNext = wizardStep < maxUnlockedStep + 1;

  const wizardSteps = [
    { id: 1, label: "Video" },
    { id: 2, label: requiresRoi ? "Vùng OCR" : "Nguồn vào" },
    { id: 3, label: "Xử lý" },
    { id: 4, label: "Xuất SRT" },
    { id: 5, label: "Âm thanh" },
    { id: 6, label: "Kết quả" },
  ];

  function statusLabel(status) {
    if (status === "draft")      return "nháp";
    if (status === "processing") return "đang xử lý";
    if (status === "ready")      return "sẵn sàng";
    if (status === "failed")     return "lỗi";
    return status || "";
  }

  function goToStep(stepId) {
    // Cho phép đến bất kỳ step từ 1 → maxUnlockedStep+1
    if (stepId >= 1 && stepId <= maxUnlockedStep + 1) {
      setWizardStep(stepId);
      return;
    }
    const msgs = {
      2: "Cần tải video lên trước.",
      3: requiresRoi
        ? "Cần có video và lưu vùng OCR trước."
        : "Cần tải video lên trước.",
      4: "Cần chạy xử lý OCR trước khi xuất phụ đề.",
      5: "Cần xuất phụ đề trước khi tạo âm thanh.",
      6: "Cần hoàn thành xử lý trước khi xem kết quả.",
    };
    if (msgs[stepId]) setMessage(msgs[stepId]);
  }

  // Đảm bảo stepState không vượt quá giới hạn khi dữ liệu thay đổi
  useEffect(() => {
    setWizardStep((cur) => Math.min(cur, maxUnlockedStep + 1));
  }, [maxUnlockedStep]);

  return {
    wizardStep,
    setWizardStep,
    hasVideo,
    hasSavedRoi,
    requiresRoi,
    hasOcrProgress,
    hasDubActivity,
    maxUnlockedStep,
    canGoNext,
    wizardSteps,
    statusLabel,
    goToStep,
  };
}
