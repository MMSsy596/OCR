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

  const hasProject = Boolean(selectedProject);
  const hasVideo = Boolean(selectedProject?.video_path);
  const hasSavedRoi = useMemo(
    () => hasVideo && hasValidRoi(selectedProject?.roi),
    [hasVideo, selectedProject?.roi, hasValidRoi],
  );
  const requiresRoi = true;

  const hasOcrProgress = useMemo(() => {
    if ((latestPipelineJob?.progress || 0) > 0) return true;
    if ((latestJobEvents || []).length > 0) return true;
    if (Object.keys(latestJobStats || {}).length > 0) return true;
    if ((editableSegments || []).length > 0) return true;
    return false;
  }, [latestPipelineJob, latestJobEvents, latestJobStats, editableSegments]);

  const hasDubActivity = useMemo(
    () =>
      (jobs || []).some(
        (job) =>
          job?.artifacts?.job_kind === "dub" &&
          (job?.status === "running" ||
            job?.status === "done" ||
            Boolean(job?.artifacts?.dubbed_audio) ||
            Boolean(job?.artifacts?.dub_output_key)),
      ),
    [jobs],
  );

  // maxUnlockedStep: bước đã "đủ dữ liệu" (0..6) cho flow 7 bước.
  const maxUnlockedStep = useMemo(() => {
    if (!hasProject) return 0; // mở step 1
    if (!hasVideo) return 1; // mở step 2
    if (requiresRoi && !hasSavedRoi) return 2; // mở step 3
    if (!hasOcrProgress && !hasDubActivity) return 3; // mở step 4
    if (hasDubActivity) return 6; // mở toàn bộ đến step 7
    return 4; // đã có OCR -> mở step 5/6
  }, [hasProject, hasVideo, requiresRoi, hasSavedRoi, hasOcrProgress, hasDubActivity]);

  const canGoNext = wizardStep < maxUnlockedStep + 1;

  const wizardSteps = [
    { id: 1, label: "Dự án" },
    { id: 2, label: "Video" },
    { id: 3, label: "Vùng OCR" },
    { id: 4, label: "Xử lý" },
    { id: 5, label: "Xuất SRT" },
    { id: 6, label: "Âm thanh" },
    { id: 7, label: "Kết quả" },
  ];

  function statusLabel(status) {
    if (status === "draft") return "nháp";
    if (status === "processing") return "đang xử lý";
    if (status === "ready") return "sẵn sàng";
    if (status === "failed") return "lỗi";
    return status || "";
  }

  function goToStep(stepId) {
    if (stepId >= 1 && stepId <= maxUnlockedStep + 1) {
      setWizardStep(stepId);
      return;
    }
    const msgs = {
      2: "Cần tạo dự án trước.",
      3: "Cần tải video lên trước.",
      4: "Cần lưu vùng OCR trước khi chạy xử lý.",
      5: "Cần chạy OCR để có tiến trình trước khi sang bước SRT/TTS.",
      6: "Cần xuất phụ đề trước khi tạo âm thanh.",
      7: "Cần có kết quả lồng tiếng trước khi xem bước kết quả.",
    };
    if (msgs[stepId]) setMessage(msgs[stepId]);
  }

  useEffect(() => {
    setWizardStep((cur) => Math.min(Math.max(1, cur), maxUnlockedStep + 1));
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
