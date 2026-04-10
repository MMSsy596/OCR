export function ExportDubBlock({
  wizardStep,
  exportForm,
  setExportForm,
  exporting,
  editableSegments,
  exportSubtitle,
  uploadingSrt,
  srtUploadFile,
  setSrtUploadFile,
  selectedProjectId,
  uploadExternalSrt,
  dubForm,
  setDubForm,
  dubbing,
  startDubAudio,
  lastExport,
  latestDubJob,
  latestDubAudioUrl,
  downloadDubAudio,
}) {
  return (
    <section className={`block ${wizardStep === 4 ? "" : "hidden-step"}`}>
      <h2>Bước 4: Xuất SRT và TTS</h2>
      <label>
        Chế độ nội dung
        <select
          value={exportForm.content_mode}
          onChange={(e) =>
            setExportForm((f) => ({ ...f, content_mode: e.target.value }))
          }
        >
          <option value="raw">Bản gốc</option>
          <option value="translated">Bản dịch</option>
          <option value="bilingual">Song ngữ</option>
        </select>
      </label>
      <label>
        Định dạng phụ đề
        <select
          value={exportForm.export_format}
          onChange={(e) =>
            setExportForm((f) => ({ ...f, export_format: e.target.value }))
          }
        >
          <option value="srt">SRT (CapCut)</option>
          <option value="vtt">VTT</option>
          <option value="csv">CSV</option>
          <option value="txt">TXT</option>
          <option value="json">JSON</option>
        </select>
      </label>
      <button
        disabled={exporting || editableSegments.length === 0}
        onClick={exportSubtitle}
      >
        {exporting ? "Đang xuất phụ đề..." : "Xuất phụ đề"}
      </button>

      <label>
        Chèn tệp SRT khác
        <input
          type="file"
          accept=".srt"
          onChange={(e) => setSrtUploadFile(e.target.files?.[0] || null)}
        />
      </label>
      <button
        disabled={uploadingSrt || !srtUploadFile || !selectedProjectId}
        onClick={uploadExternalSrt}
      >
        {uploadingSrt ? "Đang tải lên SRT..." : "Tải lên SRT vào dự án"}
      </button>

      <label>
        SRT dùng để lồng tiếng
        <input
          value={dubForm.srt_key}
          onChange={(e) => setDubForm((f) => ({ ...f, srt_key: e.target.value }))}
          placeholder="manual.translated.srt"
        />
      </label>
      <label>
        Giọng đọc
        <input
          value={dubForm.voice}
          onChange={(e) => setDubForm((f) => ({ ...f, voice: e.target.value }))}
          placeholder="vi-VN-HoaiMyNeural"
        />
      </label>
      <div className="inline-two">
        <label>
          Tốc độ
          <input
            value={dubForm.rate}
            onChange={(e) => setDubForm((f) => ({ ...f, rate: e.target.value }))}
            placeholder="+0%"
          />
        </label>
        <label>
          Định dạng âm thanh
          <select
            value={dubForm.output_format}
            onChange={(e) =>
              setDubForm((f) => ({ ...f, output_format: e.target.value }))
            }
          >
            <option value="wav">WAV</option>
            <option value="mp3">MP3</option>
          </select>
        </label>
      </div>
      <label>
        <input
          type="checkbox"
          checked={dubForm.match_video_duration}
          onChange={(e) =>
            setDubForm((f) => ({ ...f, match_video_duration: e.target.checked }))
          }
        />
        Khớp tổng thời lượng video gốc
      </label>
      <button
        disabled={dubbing || editableSegments.length === 0}
        onClick={startDubAudio}
      >
        {dubbing ? "Đang dựng âm thanh..." : "Tạo âm thanh lồng tiếng"}
      </button>
      {lastExport ? (
        <a
          className="download-link"
          href={lastExport.url}
          target="_blank"
          rel="noreferrer"
        >
          Tải phụ đề: {lastExport.output_key}
        </a>
      ) : null}
      {latestDubJob?.artifacts?.dub_output_key ? (
        <a
          className="download-link"
          href={latestDubAudioUrl}
          target="_blank"
          rel="noreferrer"
        >
          Tải âm thanh: {latestDubJob.artifacts.dub_output_key}
        </a>
      ) : null}
      {latestDubJob?.status === "done" && !latestDubJob?.artifacts?.dubbed_audio ? (
        <p className="error">
          Job lồng tiếng đã hoàn tất nhưng thiếu đường dẫn file âm thanh trong
          artifacts (`dubbed_audio`).
        </p>
      ) : null}
      <button
        type="button"
        disabled={!latestDubAudioUrl}
        onClick={downloadDubAudio}
      >
        Tải file âm thanh về máy
      </button>
    </section>
  );
}
