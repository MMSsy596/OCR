import { useEffect, useRef, useState } from "react";

export function useProjectEventStream(projectId, options = {}) {
  const { apiBase, enabled = true, onSnapshot, onError } = options;
  const [streamState, setStreamState] = useState("idle");
  const onSnapshotRef = useRef(onSnapshot);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onSnapshotRef.current = onSnapshot;
    onErrorRef.current = onError;
  }, [onError, onSnapshot]);

  useEffect(() => {
    if (!enabled || !projectId || !apiBase) {
      setStreamState("idle");
      return undefined;
    }

    let closed = false;
    let eventSource = null;

    try {
      setStreamState("connecting");
      eventSource = new EventSource(
        `${apiBase}/projects/${projectId}/stream`,
      );
    } catch (error) {
      setStreamState("error");
      if (onErrorRef.current) onErrorRef.current(error);
      return undefined;
    }

    eventSource.onopen = () => {
      if (!closed) {
        setStreamState("open");
      }
    };

    eventSource.onmessage = (event) => {
      if (closed) return;
      try {
        const payload = JSON.parse(event.data);
        if (payload?.type === "snapshot" && onSnapshotRef.current) {
          onSnapshotRef.current(payload);
        }
      } catch (error) {
        if (onErrorRef.current) onErrorRef.current(error);
      }
    };

    eventSource.onerror = (error) => {
      if (closed) return;
      setStreamState("error");
      if (onErrorRef.current) onErrorRef.current(error);
      if (eventSource) {
        eventSource.close();
      }
    };

    return () => {
      closed = true;
      setStreamState("idle");
      if (eventSource) {
        eventSource.close();
      }
    };
  }, [apiBase, enabled, projectId]);

  return streamState;
}
