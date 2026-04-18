import { useEffect, useRef, useState } from "react";

export function useRoiEditor({
  normalizeRoi,
  selectedProject,
  setMessage,
  setCurrentVideoTime,
}) {
  const [roiDraft, setRoiDraft] = useState({ x: 0.1, y: 0.75, w: 0.8, h: 0.2 });
  const [dragState, setDragState] = useState(null);
  const [roiEditMode, setRoiEditMode] = useState(true);
  const [isShiftPressed, setIsShiftPressed] = useState(false);

  const stageRef = useRef(null);

  const roiRef = useRef(null);

  useEffect(() => {
    if (selectedProject?.roi) {
      const currentObj = selectedProject.roi;
      const prevObj = roiRef.current;
      if (!prevObj || prevObj.x !== currentObj.x || prevObj.y !== currentObj.y || prevObj.w !== currentObj.w || prevObj.h !== currentObj.h) {
        roiRef.current = currentObj;
        setRoiDraft(normalizeRoi(currentObj));
      }
    }
  }, [normalizeRoi, selectedProject?.roi]);

  useEffect(() => {
    if (!dragState) return undefined;

    const onMove = (event) => {
      const pt = eventToPoint(event);
      if (!pt) return;
      const { mode, handle, start, base } = dragState;

      if (mode === "draw") {
        const x1 = Math.min(start.x, pt.x);
        const y1 = Math.min(start.y, pt.y);
        const x2 = Math.max(start.x, pt.x);
        const y2 = Math.max(start.y, pt.y);
        setRoiDraft(normalizeRoi({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 }));
        return;
      }

      if (mode === "move") {
        const dx = pt.x - start.x;
        const dy = pt.y - start.y;
        setRoiDraft(
          normalizeRoi({
            x: base.x + dx,
            y: base.y + dy,
            w: base.w,
            h: base.h,
          }),
        );
        return;
      }

      if (mode === "resize") {
        const dx = pt.x - start.x;
        const dy = pt.y - start.y;
        let next = { ...base };
        if (handle === "nw") {
          next = {
            x: base.x + dx,
            y: base.y + dy,
            w: base.w - dx,
            h: base.h - dy,
          };
        }
        if (handle === "ne") {
          next = {
            x: base.x,
            y: base.y + dy,
            w: base.w + dx,
            h: base.h - dy,
          };
        }
        if (handle === "sw") {
          next = {
            x: base.x + dx,
            y: base.y,
            w: base.w - dx,
            h: base.h + dy,
          };
        }
        if (handle === "se") {
          next = {
            x: base.x,
            y: base.y,
            w: base.w + dx,
            h: base.h + dy,
          };
        }
        setRoiDraft(normalizeRoi(next));
      }
    };

    const onUp = () => setDragState(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragState, normalizeRoi]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Shift") setIsShiftPressed(true);
    };
    const onKeyUp = (event) => {
      if (event.key === "Shift") setIsShiftPressed(false);
    };
    const onWindowBlur = () => setIsShiftPressed(false);

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onWindowBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onWindowBlur);
    };
  }, []);

  function eventToPoint(event) {
    const stage = stageRef.current;
    if (!stage) return null;
    const rect = stage.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    };
  }

  function beginDraw(event) {
    if (!roiEditMode || !selectedProject?.video_path) return;
    const start = eventToPoint(event);
    if (!start) return;
    setDragState({ mode: "draw", start, base: roiDraft, handle: null });
  }

  function beginMove(event) {
    if (!roiEditMode) return;
    event.preventDefault();
    event.stopPropagation();
    const start = eventToPoint(event);
    if (!start) return;
    setDragState({ mode: "move", start, base: roiDraft, handle: null });
  }

  function beginResize(handle, event) {
    if (!roiEditMode) return;
    event.preventDefault();
    event.stopPropagation();
    const start = eventToPoint(event);
    if (!start) return;
    setDragState({ mode: "resize", start, base: roiDraft, handle });
  }

  function onVideoTimeUpdate(event) {
    setCurrentVideoTime(event.currentTarget.currentTime || 0);
  }

  function toggleRoiEditMode() {
    // Chức năng đã bị loại bỏ theo yêu cầu, luôn bật edit mode
  }

  return {
    stageRef,
    roiDraft,
    setRoiDraft,
    roiEditMode,
    setRoiEditMode,
    toggleRoiEditMode,
    isShiftPressed,
    beginDraw,
    beginMove,
    beginResize,
    onVideoTimeUpdate,
  };
}
