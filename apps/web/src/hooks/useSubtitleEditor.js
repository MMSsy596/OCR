import { useEffect, useMemo, useRef, useState } from "react";

function cloneSegments(segments) {
  return (segments || []).map((row) => ({ ...row }));
}

function normalizeTextForMerge(text) {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "")
    .replace(/[.,;:!?'"`~\-_=+*/\\|()[\]{}<>，。!?;:、]/g, "");
}

export function useSubtitleEditor({ maxHistory = 100, setMessage }) {
  const [editableSegments, setEditableSegments] = useState([]);
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const [isEditingSegments, setIsEditingSegments] = useState(false);
  const [currentVideoTime, setCurrentVideoTime] = useState(0);

  const segmentsRef = useRef([]);

  const activeSegment = useMemo(() => {
    let left = 0;
    let right = editableSegments.length - 1;
    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      const seg = editableSegments[mid];
      const start = Number(seg.start_sec);
      const end = Number(seg.end_sec);
      if (currentVideoTime < start) {
        right = mid - 1;
        continue;
      }
      if (currentVideoTime > end) {
        left = mid + 1;
        continue;
      }
      return seg;
    }
    return null;
  }, [editableSegments, currentVideoTime]);

  function resetHistory() {
    setUndoStack([]);
    setRedoStack([]);
  }

  function pushUndoSnapshot(snapshot) {
    setUndoStack((prev) => {
      const next = [...prev, cloneSegments(snapshot)];
      if (next.length > maxHistory) next.shift();
      return next;
    });
    setRedoStack([]);
  }

  function replaceEditableSegments(nextSegments, options = {}) {
    const { clearHistory = false, markEditing = false } = options;
    setEditableSegments((nextSegments || []).map((row) => ({ ...row })));
    if (clearHistory) resetHistory();
    if (markEditing !== undefined) setIsEditingSegments(markEditing);
  }

  function undoSegments() {
    const current = cloneSegments(segmentsRef.current);
    setUndoStack((prev) => {
      if (!prev.length) return prev;
      const previous = prev[prev.length - 1];
      setRedoStack((rprev) => [current, ...rprev].slice(0, maxHistory));
      setEditableSegments(cloneSegments(previous));
      setIsEditingSegments(true);
      setMessage?.("Đã hoàn tác (Ctrl+Z).");
      return prev.slice(0, -1);
    });
  }

  function redoSegments() {
    const current = cloneSegments(segmentsRef.current);
    setRedoStack((prev) => {
      if (!prev.length) return prev;
      const nextState = prev[0];
      setUndoStack((uprev) => {
        const next = [...uprev, current];
        if (next.length > maxHistory) next.shift();
        return next;
      });
      setEditableSegments(cloneSegments(nextState));
      setIsEditingSegments(true);
      setMessage?.("Đã làm lại (Ctrl+Y).");
      return prev.slice(1);
    });
  }

  function updateEditableSegment(id, field, value) {
    pushUndoSnapshot(editableSegments);
    setIsEditingSegments(true);
    setEditableSegments((prev) =>
      prev.map((row) =>
        row.id === id
          ? {
              ...row,
              [field]:
                field === "start_sec" || field === "end_sec"
                  ? Number(value)
                  : value,
            }
          : row,
      ),
    );
  }

  function mergeAdjacentDuplicateSegments() {
    if (!editableSegments.length) {
      setMessage?.("Chưa có dữ liệu để gộp.");
      return;
    }
    pushUndoSnapshot(editableSegments);
    const ordered = [...editableSegments].sort(
      (a, b) => Number(a.start_sec) - Number(b.start_sec),
    );
    const merged = [];
    for (const seg of ordered) {
      const current = { ...seg };
      const prev = merged[merged.length - 1];
      if (!prev) {
        merged.push(current);
        continue;
      }
      const prevRaw = normalizeTextForMerge(prev.raw_text);
      const curRaw = normalizeTextForMerge(current.raw_text);
      const prevTrans = normalizeTextForMerge(prev.translated_text);
      const curTrans = normalizeTextForMerge(current.translated_text);
      const isDuplicate =
        (prevRaw && curRaw && prevRaw === curRaw) ||
        (prevTrans && curTrans && prevTrans === curTrans);

      if (isDuplicate) {
        prev.end_sec = Math.max(Number(prev.end_sec), Number(current.end_sec));
        if (
          String(current.raw_text || "").length >
          String(prev.raw_text || "").length
        ) {
          prev.raw_text = current.raw_text;
        }
        if (
          String(current.translated_text || "").length >
          String(prev.translated_text || "").length
        ) {
          prev.translated_text = current.translated_text;
        }
      } else {
        merged.push(current);
      }
    }

    setEditableSegments(merged);
    setIsEditingSegments(true);
    setMessage?.(
      `Đã gộp dòng trùng kề nhau: ${editableSegments.length} -> ${merged.length} dòng.`,
    );
  }

  useEffect(() => {
    segmentsRef.current = editableSegments;
  }, [editableSegments]);

  useEffect(() => {
    const onKeyDown = (event) => {
      const hotkey = event.ctrlKey || event.metaKey;
      if (!hotkey || event.altKey) return;

      const key = event.key.toLowerCase();
      const isUndo = key === "z" && !event.shiftKey;
      const isRedo = key === "y" || (key === "z" && event.shiftKey);
      if (!isUndo && !isRedo) return;

      if (isUndo && undoStack.length === 0) return;
      if (isRedo && redoStack.length === 0) return;

      event.preventDefault();
      if (isUndo) {
        undoSegments();
        return;
      }
      redoSegments();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undoStack, redoStack]);

  return {
    editableSegments,
    setEditableSegments,
    undoStack,
    setUndoStack,
    redoStack,
    setRedoStack,
    isEditingSegments,
    setIsEditingSegments,
    currentVideoTime,
    setCurrentVideoTime,
    activeSegment,
    pushUndoSnapshot,
    resetHistory,
    replaceEditableSegments,
    updateEditableSegment,
    mergeAdjacentDuplicateSegments,
    undoSegments,
    redoSegments,
  };
}
