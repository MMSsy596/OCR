import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useProjectWizard } from "../useProjectWizard";

describe("useProjectWizard", () => {
  it("mở khóa step đúng theo trạng thái project", () => {
    const setMessage = vi.fn();
    const { result } = renderHook(() =>
      useProjectWizard({
        selectedProject: {
          id: "p1",
          video_path: "/video.mp4",
          roi: { x: 0.1, y: 0.7, w: 0.8, h: 0.2 },
        },
        latestPipelineJob: null,
        latestJobEvents: [],
        latestJobStats: {},
        editableSegments: [],
        jobs: [],
        hasValidRoi: () => true,
        pipelineInputMode: "video_ocr",
        setMessage,
      }),
    );

    expect(result.current.maxUnlockedStep).toBe(3);
    expect(result.current.canGoNext).toBe(true);
    expect(result.current.statusLabel("processing")).toBe("đang xử lý");
  });

  it("chặn chuyển step khi chưa đủ điều kiện và báo đúng message", () => {
    const setMessage = vi.fn();
    const { result } = renderHook(() =>
      useProjectWizard({
        selectedProject: {
          id: "p1",
          video_path: "/video.mp4",
          roi: { x: 0.1, y: 0.7, w: 0.8, h: 0.2 },
        },
        latestPipelineJob: null,
        latestJobEvents: [],
        latestJobStats: {},
        editableSegments: [],
        jobs: [],
        hasValidRoi: () => true,
        pipelineInputMode: "video_ocr",
        setMessage,
      }),
    );

    act(() => {
      result.current.goToStep(5);
    });

    expect(result.current.wizardStep).toBe(1);
    expect(setMessage).toHaveBeenCalledWith(
      "Cần chạy OCR để có tiến trình trước khi sang bước SRT/TTS.",
    );
  });

  it("tự co wizard step về mức hợp lệ khi dữ liệu bị giảm", () => {
    const setMessage = vi.fn();
    const initialProps = {
      selectedProject: {
        id: "p1",
        video_path: "/video.mp4",
        roi: { x: 0.1, y: 0.7, w: 0.8, h: 0.2 },
      },
      latestPipelineJob: { progress: 50 },
      latestJobEvents: [{ phase: "ocr" }],
      latestJobStats: { ocr_live: { progress_pct: 50 } },
      editableSegments: [{ id: 1 }],
      jobs: [],
      hasValidRoi: () => true,
      pipelineInputMode: "video_ocr",
      setMessage,
    };

    const { result, rerender } = renderHook((props) => useProjectWizard(props), {
      initialProps,
    });

    act(() => {
      result.current.setWizardStep(4);
    });
    expect(result.current.wizardStep).toBe(4);

    rerender({
      ...initialProps,
      selectedProject: { id: "p1", video_path: null, roi: null },
      latestPipelineJob: null,
      latestJobEvents: [],
      latestJobStats: {},
      editableSegments: [],
    });

    expect(result.current.maxUnlockedStep).toBe(1);
    expect(result.current.wizardStep).toBe(2);
  });
});
