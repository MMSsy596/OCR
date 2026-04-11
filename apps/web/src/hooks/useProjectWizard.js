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

  const hasVideo = Boolean(selectedProject?.video_path);
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
  const maxUnlockedStep = useMemo(() => {
    if (!hasVideo) return 1;
    if (requiresRoi && !hasSavedRoi) return 2;
    if (!hasOcrProgress && !hasDubActivity) return 3;
    return 4;
  }, [hasVideo, requiresRoi, hasSavedRoi, hasOcrProgress, hasDubActivity]);
  const canGoNext = wizardStep < maxUnlockedStep;
  const wizardSteps = [
    { id: 1, title: "Video" },
    { id: 2, title: requiresRoi ? "ROI" : "Nguồn vào" },
    { id: 3, title: "Xử lý log" },
    { id: 4, title: "SRT/TTS" },
  ];

  function statusLabel(status) {
    if (status === "draft") return "nháp";
    if (status === "processing") return "đang xử lý";
    if (status === "ready") return "sẵn sàng";
    if (status === "failed") return "lỗi";
    return status || "";
  }

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
      setMessage(
        requiresRoi
          ? "Cần có video và lưu ROI trước khi sang bước xử lý log."
          : "Cần có video trước khi sang bước xử lý log.",
      );
      return;
    }
    if (stepId === 4) {
      setMessage("Cần chạy OCR để có tiến trình trước khi sang bước SRT/TTS.");
    }
  }

  useEffect(() => {
    setWizardStep((current) => Math.min(current, maxUnlockedStep));
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
