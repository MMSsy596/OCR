import { useEffect, useRef, useState } from "react";
import { useProjectEventStream } from "./useProjectEventStream";

const QUEUED_ACTIVITY_WINDOW_MS = 120000;

function jobTimeValue(job) {
  const candidates = [job?.updated_at, job?.created_at, job?.artifacts?.last_event?.time];
  for (const value of candidates) {
    const parsed = value ? Date.parse(value) : Number.NaN;
    if (!Number.isNaN(parsed)) return parsed;
  }
  return 0;
}

function isQueueLikelyActive(job, nowMs = Date.now()) {
  if (!job || job?.status !== "queued") return false;
  const ts = jobTimeValue(job);
  if (!ts) return false;
  return nowMs - ts <= QUEUED_ACTIVITY_WINDOW_MS;
}

export function useProjectRealtime({
  apiBase,
  selectedProjectId,
  latestDubAudioJob,
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
  const lastSnapshotAtRef = useRef(0);
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
      lastSnapshotAtRef.current = Date.now();

      const project = payload?.project || null;
      const incomingJobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
      const nowMs = Date.now();
      const hadRunningBefore = (jobsRef.current || []).some(
        (job) => job?.status === "running" || isQueueLikelyActive(job, nowMs),
      );
      const hasRunningNow = incomingJobs.some(
        (job) => job?.status === "running" || isQueueLikelyActive(job, nowMs),
      );

      if (project) {
        setProjects((prev) => {
          const exists = prev.some((item) => item.id === project.id);
          if (!exists) return [...prev, project];
          return prev.map((item) => (item.id === project.id ? project : item));
        });
      }
      setJobs(incomingJobs);

      if (hadRunningBefore && !hasRunningNow && !isEditingSegmentsRef.current && selectedProjectId) {
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
    lastStreamSnapshotRef.current = "";
    lastSnapshotAtRef.current = 0;
    loadProjectDataRef.current(selectedProjectId, { includeSegments: true });
    let stopped = false;
    let timerId = null;

    const scheduleNext = (ms) => {
      if (stopped) return;
      timerId = window.setTimeout(runPoll, ms);
    };

    const runPoll = async () => {
      if (stopped) return;
      pollTickRef.current += 1;
      const nowMs = Date.now();
      const hasLiveJob = (jobsRef.current || []).some(
        (job) => job?.status === "running" || isQueueLikelyActive(job, nowMs),
      );
      const hasFreshStreamSnapshot =
        streamState === "open" &&
        lastSnapshotAtRef.current > 0 &&
        nowMs - lastSnapshotAtRef.current <= (document.hidden ? 25000 : 10000);
      let includeSegments = false;
      if (hasLiveJob) {
        hadActiveJobRef.current = true;
      } else if (!isEditingSegmentsRef.current) {
        includeSegments = hadActiveJobRef.current || pollTickRef.current % 6 === 0;
        hadActiveJobRef.current = false;
      }
      if (!hasFreshStreamSnapshot || pollTickRef.current % (hasLiveJob ? 2 : 4) === 0) {
        await loadProjectDataRef.current(selectedProjectId, { includeSegments });
      }

      const nextDelay = document.hidden
        ? (hasLiveJob ? 12000 : 20000)
        : hasLiveJob
          ? (hasFreshStreamSnapshot ? 4000 : 2000)
          : (hasFreshStreamSnapshot ? 10000 : 5000);
      scheduleNext(nextDelay);
    };

    scheduleNext(document.hidden ? 12000 : 5000);
    return () => {
      stopped = true;
      if (timerId) window.clearTimeout(timerId);
    };
  }, [selectedProjectId, streamState]);

  useEffect(() => {
    if (!latestDubAudioJob?.artifacts?.dubbed_audio) return;
    if (lastDubDoneRef.current === latestDubAudioJob.id) return;

    lastDubDoneRef.current = latestDubAudioJob.id;
    setWizardStep(7);
    setMessage(`Đã tạo xong âm thanh: ${latestDubAudioJob.artifacts.dub_output_key || "dub-output.wav"}`);
  }, [latestDubAudioJob, setMessage, setWizardStep]);

  return {
    streamState,
    streamErrorCount,
  };
}
