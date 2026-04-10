export function VideoUploadBlock({
  wizardStep,
  videoFile,
  setVideoFile,
  loading,
  uploadVideo,
  sourceUrl,
  setSourceUrl,
  autoStartAfterIngest,
  setAutoStartAfterIngest,
  ingestingUrl,
  selectedProjectId,
  ingestVideoFromUrl,
}) {
  return (
    <section className={`block ${wizardStep === 1 ? "" : "hidden-step"}`}>
      <h2>Bước 1: Video</h2>
      <label>
        Tệp video
        <input
          type="file"
          accept="video/*"
          onChange={(e) => setVideoFile(e.target.files?.[0] || null)}
        />
      </label>
      <button disabled={loading} onClick={uploadVideo}>
        Tải video lên
      </button>
      <label>
        Dán link video để app tự tải
        <input
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          placeholder="https://..."
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={autoStartAfterIngest}
          onChange={(e) => setAutoStartAfterIngest(e.target.checked)}
        />
        Tự chạy pipeline sau khi tải xong
      </label>
      <button
        disabled={ingestingUrl || loading || !selectedProjectId || !sourceUrl.trim()}
        onClick={ingestVideoFromUrl}
      >
        {ingestingUrl ? "Đang bắt link và tải..." : "Dán link và tự xử lý"}
      </button>
    </section>
  );
}
