const VOICES = [
  { value: "vi-VN-HoaiMyNeural",  label: "Hoài My (nữ, nhẹ nhàng)" },
  { value: "vi-VN-NamMinhNeural", label: "Nam Minh (nam, trầm)" },
];

export function Step6Dub({
  editableSegments,
  dubbing,
  dubForm,
  setDubForm,
  startDubAudio,
  latestDubJob,
  latestDubAudioUrl,
  latestDubAudioName,
  downloadDubAudio,
  onNextStep,
}) {
  const dubStatus   = latestDubJob?.status;
  const dubProgress = latestDubJob?.progress ?? 0;
  const isDone      = dubStatus === "done";
  const isRunning   = dubStatus === "running";
  const isFailed    = dubStatus === "failed";

  const statusColor = isDone ? "var(--success)" : isFailed ? "var(--danger)" : "var(--accent-2)";
  const statusIcon  = isDone ? "✅" : isFailed ? "❌" : isRunning ? "⚙️" : "🔊";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 800, margin: "0 auto", width: "100%" }}>
      <div className="step-guide">
        <span className="step-guide-icon">🔊</span>
        <div className="step-guide-text">
          <h3>Bước 6: Tạo âm thanh lồng tiếng</h3>
          <p>Hệ thống sẽ đọc phụ đề đã dịch bằng giọng TTS và tạo file âm thanh để ghép vào video.</p>
        </div>
      </div>

      {/* Config card */}
      <div className="card">
        <div className="card-header">
          <h2>⚙️ Cài đặt lồng tiếng</h2>
        </div>
        <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="form-row">
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Giọng đọc</label>
              <select
                value={dubForm.voice}
                onChange={(e) => setDubForm((p) => ({ ...p, voice: e.target.value }))}
              >
                {VOICES.map((v) => (
                  <option key={v.value} value={v.value}>{v.label}</option>
                ))}
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Định dạng xuất</label>
              <select
                value={dubForm.output_format}
                onChange={(e) => setDubForm((p) => ({ ...p, output_format: e.target.value }))}
              >
                <option value="wav">WAV (chất lượng cao)</option>
                <option value="mp3">MP3</option>
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Tốc độ đọc</label>
              <input
                value={dubForm.rate}
                onChange={(e) => setDubForm((p) => ({ ...p, rate: e.target.value }))}
                placeholder="+0%"
              />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Âm lượng</label>
              <input
                value={dubForm.volume}
                onChange={(e) => setDubForm((p) => ({ ...p, volume: e.target.value }))}
                placeholder="+0%"
              />
            </div>
          </div>

          {/* Status banner */}
          {latestDubJob && (
            <div style={{
              padding: "12px 16px",
              borderRadius: "var(--radius-md)",
              background: isDone ? "var(--success-muted)" : isFailed ? "var(--danger-muted)" : "var(--accent-muted)",
              border: `1px solid ${isDone ? "rgba(34,197,94,0.25)" : isFailed ? "rgba(239,68,68,0.25)" : "rgba(99,102,241,0.25)"}`,
              display: "flex", alignItems: "center", gap: 12,
            }}>
              <span style={{ fontSize: 22 }}>{statusIcon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: statusColor }}>
                  {isDone ? "Hoàn tất!" : isFailed ? "Thất bại" : isRunning ? "Đang tạo âm thanh…" : "Sẵn sàng"}
                </div>
              </div>
              <span style={{ fontSize: 13, fontWeight: 700, color: statusColor }}>{dubProgress}%</span>
            </div>
          )}

          {/* Progress bar */}
          {isRunning && (
            <div>
              <div className="progress-label">
                <span>Đang tổng hợp giọng nói…</span>
                <span>{dubProgress}%</span>
              </div>
              <div className="progress-wrap">
                <div className="progress-bar" style={{ width: `${Math.max(dubProgress, 2)}%` }} />
              </div>
            </div>
          )}

          {/* Actions */}
          <div style={{ display: "flex", gap: 10 }}>
            <button
              className="btn btn-primary"
              style={{ flex: 1 }}
              disabled={dubbing || isRunning || !editableSegments.length}
              onClick={startDubAudio}
            >
              {dubbing ? "⏳ Đang gửi…" : isRunning ? "⚙️ Đang chạy…" : isDone ? "🔄 Tạo lại" : "🔊 Tạo lồng tiếng"}
            </button>
            {latestDubAudioUrl && (
              <button className="btn btn-secondary" onClick={downloadDubAudio}>
                ⬇️ Tải file âm thanh
              </button>
            )}
          </div>

          {!editableSegments.length && (
            <div className="hint-text" style={{ textAlign: "center", color: "var(--warning)" }}>
              ⚠️ Chưa có phụ đề — hãy hoàn thành Bước 5 trước
            </div>
          )}
        </div>
      </div>

      {/* Next step */}
      <button
        className="btn btn-primary btn-lg"
        style={{ width: "100%" }}
        onClick={onNextStep}
        disabled={!isDone && !latestDubAudioUrl}
      >
        {isDone ? "▶ Xem kết quả →" : "▶ Bỏ qua & Xem kết quả →"}
      </button>
    </div>
  );
}
