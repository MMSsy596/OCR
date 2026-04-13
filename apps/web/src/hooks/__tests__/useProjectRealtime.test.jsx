import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { useProjectRealtime } from "../useProjectRealtime";

const streamMock = vi.fn();

vi.mock("../useProjectEventStream", () => ({
  useProjectEventStream: (...args) => streamMock(...args),
}));

describe("useProjectRealtime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    streamMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("tải dữ liệu project ngay khi có selectedProjectId", () => {
    streamMock.mockReturnValue("closed");
    const loadProjectData = vi.fn().mockResolvedValue(undefined);

    renderHook(() =>
      useProjectRealtime({
        apiBase: "http://localhost:8000",
        selectedProjectId: "p1",
        latestDubAudioJob: null,
        jobs: [],
        isEditingSegments: false,
        loadProjectData,
        setProjects: vi.fn(),
        setJobs: vi.fn(),
        setWizardStep: vi.fn(),
        setMessage: vi.fn(),
      }),
    );

    expect(loadProjectData).toHaveBeenCalledWith("p1", { includeSegments: true });
  });

  it("đẩy wizard sang bước kết quả khi job dub hoàn tất", () => {
    streamMock.mockReturnValue("open");
    const setWizardStep = vi.fn();
    const setMessage = vi.fn();

    renderHook(() =>
      useProjectRealtime({
        apiBase: "http://localhost:8000",
        selectedProjectId: "p1",
        latestDubAudioJob: {
          id: "job-1",
          artifacts: {
            dubbed_audio: "/audio.wav",
            dub_output_key: "audio.wav",
          },
        },
        jobs: [],
        isEditingSegments: false,
        loadProjectData: vi.fn(),
        setProjects: vi.fn(),
        setJobs: vi.fn(),
        setWizardStep,
        setMessage,
      }),
    );

    expect(setWizardStep).toHaveBeenCalledWith(7);
    expect(setMessage).toHaveBeenCalledWith("Đã tạo xong âm thanh: audio.wav");
  });

  it("tăng bộ đếm lỗi stream khi hook SSE báo lỗi", () => {
    let latestOptions;
    streamMock.mockImplementation((_projectId, options) => {
      latestOptions = options;
      return "connecting";
    });

    const { result } = renderHook(() =>
      useProjectRealtime({
        apiBase: "http://localhost:8000",
        selectedProjectId: "p1",
        latestDubAudioJob: null,
        jobs: [],
        isEditingSegments: false,
        loadProjectData: vi.fn(),
        setProjects: vi.fn(),
        setJobs: vi.fn(),
        setWizardStep: vi.fn(),
        setMessage: vi.fn(),
      }),
    );

    act(() => {
      latestOptions.onError();
    });

    expect(result.current.streamErrorCount).toBe(1);
  });
});
