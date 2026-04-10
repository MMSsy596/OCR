import { useEffect, useRef, useState } from "react";
import { useProjectEventStream } from "./useProjectEventStream";

export function useProjectRealtime({
  apiBase,
  selectedProjectId,
  latestDubJob,
  jobs,
  isEditingSegments,
  loadProjectData,
  setProjects,
  setJobs,
  setWizardStep,
  setMessage,
}) {
  const [streamErrorCount, setStreamErrorCount] = useState(0);

  const pollTickRef = useRef(0);
  const jobsRef = useRef([]);
  const isEditingSegmentsRef = useRef(false);
  const lastDubDoneRef = useRef("");
  const hadActiveJobRef = useRef(false);
  const lastStreamSnapshotRef = useRef("");
  const loadProjectDataRef = useRef(loadProjectData);

  useEffect(() => {
    loadProjectDataRef.current = loadProjectData;
  }, [loadProjectData]);

  const streamState = useProjectEventStream(selectedProjectId, {
    apiBase,
    enabled: Boolean(selectedProjectId),
    onSnapshot: (payload) => {
      const serialized = JSON.stringify(payload);
      if (serialized === lastStreamSnapshotRef.current) return;
      lastStreamSnapshotRef.current = serialized;

      const project = payload?.project || null;
      const incomingJobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
      const hadRunningBefore = (jobsRef.current || []).some(
        (job) => job?.status === "queued" || job?.status === "running",
      );
      const hasRunningNow = incomingJobs.some(
        (job) => job?.status === "queued" || job?.status === "running",
      );

      if (project) {
        setProjects((prev) => {
          const exists = prev.some((item) => item.id === project.id);
          if (!exists) return [...prev, project];
          return prev.map((item) => (item.id === project.id ? project : item));
        });
      }
      setJobs(incomingJobs);

      if (
        hadRunningBefore &&
        !hasRunningNow &&
        !isEditingSegmentsRef.current &&
        selectedProjectId
      ) {
        loadProjectDataRef.current(selectedProjectId, { includeSegments: true });
      }
    },
    onError: () => {
      setStreamErrorCount((count) => count + 1);
    },
  });

  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  useEffect(() => {
    isEditingSegmentsRef.current = isEditingSegments;
  }, [isEditingSegments]);

  useEffect(() => {
    if (!selectedProjectId) return;
    pollTickRef.current = 0;
    loadProjectDataRef.current(selectedProjectId, { includeSegments: true });
    let stopped = false;
    let timerId = null;

    const scheduleNext = (ms) => {
      if (stopped) return;
      timerId = window.setTimeout(runPoll, ms);
    };

    const runPoll = async () => {
      if (stopped) return;
      if (streamState === "open") {
        scheduleNext(document.hidden ? 25000 : 15000);
        return;
      }
      pollTickRef.current += 1;
      const hasLiveJob = (jobsRef.current || []).some(
        (job) => job?.status === "queued" || job?.status === "running",
      );
      let includeSegments = false;
      if (hasLiveJob) {
        hadActiveJobRef.current = true;
      } else if (!isEditingSegmentsRef.current) {
        includeSegments =
          hadActiveJobRef.current || pollTickRef.current % 6 === 0;
        hadActiveJobRef.current = false;
      }
      await loadProjectDataRef.current(selectedProjectId, { includeSegments });

      const nextDelay = document.hidden
        ? 20000
        : hasLiveJob
          ? 5000
          : 15000;
      scheduleNext(nextDelay);
    };

    scheduleNext(document.hidden ? 12000 : 5000);
    return () => {
      stopped = true;
      if (timerId) window.clearTimeout(timerId);
    };
  }, [selectedProjectId, streamState]);

  useEffect(() => {
    if (!latestDubJob?.artifacts?.dubbed_audio) return;
    if (lastDubDoneRef.current === latestDubJob.id) return;
    lastDubDoneRef.current = latestDubJob.id;
    setWizardStep(4);
    setMessage(
      `Đã tạo xong âm thanh: ${latestDubJob.artifacts.dub_output_key || "dub-output.wav"}`,
    );
  }, [latestDubJob, setMessage, setWizardStep]);

  return {
    streamState,
    streamErrorCount,
  };
}
