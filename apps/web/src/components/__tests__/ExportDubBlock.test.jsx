import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExportDubBlock } from "../ExportDubBlock";

afterEach(() => {
  cleanup();
});

function renderBlock(props = {}) {
  const baseProps = {
    wizardStep: 4,
    exportForm: { export_format: "srt", content_mode: "translated" },
    setExportForm: vi.fn(),
    exporting: false,
    editableSegments: [],
    exportSubtitle: vi.fn(),
    uploadingSrt: false,
    srtUploadFile: null,
    setSrtUploadFile: vi.fn(),
    selectedProjectId: "project-1",
    uploadExternalSrt: vi.fn(),
    dubForm: {
      srt_key: "manual.external.srt",
      output_format: "wav",
      voice: "vi-VN-HoaiMyNeural",
      rate: "+0%",
      volume: "+0%",
      pitch: "+0Hz",
      match_video_duration: true,
    },
    setDubForm: vi.fn(),
    dubbing: false,
    startDubAudio: vi.fn(),
    lastExport: null,
    latestDubJob: null,
    latestDubAudioUrl: "",
    downloadDubAudio: vi.fn(),
    ...props,
  };

  render(<ExportDubBlock {...baseProps} />);
  return baseProps;
}

describe("ExportDubBlock", () => {
  it("cho phép chạy dub khi có project và srt_key dù chưa có editableSegments", () => {
    const props = renderBlock();

    const button = screen.getByRole("button", { name: "Tạo âm thanh lồng tiếng" });
    expect(button.disabled).toBe(false);

    fireEvent.click(button);
    expect(props.startDubAudio).toHaveBeenCalledTimes(1);
  });

  it("khóa nút dub khi chưa có project được chọn", () => {
    renderBlock({ selectedProjectId: "" });

    const button = screen.getByRole("button", { name: "Tạo âm thanh lồng tiếng" });
    expect(button.disabled).toBe(true);
  });
});
