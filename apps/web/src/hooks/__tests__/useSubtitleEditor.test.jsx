import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSubtitleEditor } from "../useSubtitleEditor";

describe("useSubtitleEditor", () => {
  it("cập nhật, hoàn tác và làm lại subtitle đúng", () => {
    const setMessage = vi.fn();
    const { result } = renderHook(() =>
      useSubtitleEditor({ maxHistory: 5, setMessage }),
    );

    act(() => {
      result.current.setEditableSegments([
        {
          id: 1,
          start_sec: 0,
          end_sec: 2,
          raw_text: "Xin chào",
          translated_text: "Xin chào",
          speaker: "a",
          voice: "v1",
        },
      ]);
    });

    act(() => {
      result.current.updateEditableSegment(1, "translated_text", "Chào NanBao");
    });

    expect(result.current.editableSegments[0].translated_text).toBe("Chào NanBao");
    expect(result.current.undoStack).toHaveLength(1);
    expect(result.current.isEditingSegments).toBe(true);

    act(() => {
      result.current.undoSegments();
    });

    expect(result.current.editableSegments[0].translated_text).toBe("Xin chào");
    expect(setMessage).toHaveBeenCalledWith("Đã hoàn tác (Ctrl+Z).");

    act(() => {
      result.current.redoSegments();
    });

    expect(result.current.editableSegments[0].translated_text).toBe("Chào NanBao");
    expect(setMessage).toHaveBeenCalledWith("Đã làm lại (Ctrl+Y).");
  });

  it("gộp các dòng trùng kề nhau và xác định active segment bằng binary search", () => {
    const setMessage = vi.fn();
    const { result } = renderHook(() =>
      useSubtitleEditor({ maxHistory: 5, setMessage }),
    );

    act(() => {
      result.current.setEditableSegments([
        {
          id: 1,
          start_sec: 0,
          end_sec: 1,
          raw_text: "A",
          translated_text: "Xin chào",
          speaker: "a",
          voice: "v1",
        },
        {
          id: 2,
          start_sec: 1,
          end_sec: 2,
          raw_text: "A",
          translated_text: "Xin chào",
          speaker: "a",
          voice: "v1",
        },
        {
          id: 3,
          start_sec: 3,
          end_sec: 4,
          raw_text: "B",
          translated_text: "Tạm biệt",
          speaker: "b",
          voice: "v2",
        },
      ]);
      result.current.setCurrentVideoTime(3.2);
    });

    expect(result.current.activeSegment?.id).toBe(3);

    act(() => {
      result.current.mergeAdjacentDuplicateSegments();
    });

    expect(result.current.editableSegments).toHaveLength(2);
    expect(result.current.editableSegments[0].end_sec).toBe(2);
    expect(setMessage).toHaveBeenCalledWith(
      "Đã gộp dòng trùng kề nhau: 3 -> 2 dòng.",
    );
  });
});
