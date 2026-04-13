const EDGE_VOICES = [
  { value: "vi-VN-HoaiMyNeural",  label: "Hoài My (nữ, nhẹ nhàng)" },
  { value: "vi-VN-NamMinhNeural", label: "Nam Minh (nam, trầm)" },
];

// Danh sách giọng FPT.AI — viết liền không dấu đúng theo API
const FPT_VOICES = [
  { value: "banmai",    label: "Ban Mai (Nữ miền Bắc) ⭐" },
  { value: "thuminh",   label: "Thu Minh (Nữ miền Bắc)" },
  { value: "myan",      label: "Mỹ An (Nữ miền Trung)" },
  { value: "giahuy",    label: "Gia Huy (Nam miền Trung)" },
  { value: "ngoclam",   label: "Ngọc Lam (Nữ miền Trung)" },
  { value: "leminh",    label: "Lê Minh (Nam miền Bắc)" },
  { value: "minhquang", label: "Minh Quang (Nam miền Nam)" },
  { value: "linhsan",   label: "Linh San (Nữ miền Nam)" },
  { value: "lannhi",    label: "Lan Nhi (Nữ miền Nam)" },
];

const FPT_DEFAULT_KEY = "gSZ0IfH1XDMKp2I2X5bzAet2EgxhKzDn";

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
  const isFpt       = dubForm.tts_engine === "fpt";

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

          {/* Row 1: Engine + Output format */}
          <div className="form-row">
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Engine TTS</label>
              <select
                value={dubForm.tts_engine}
                onChange={(e) => setDubForm((p) => ({ ...p, tts_engine: e.target.value }))}
              >
                <option value="edge">Microsoft Edge TTS (miễn phí)</option>
                <option value="fpt">FPT.AI TTS (tiếng Việt chất lượng cao)</option>
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

          {/* Row 2: Voice + Speed */}
          <div className="form-row">
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Giọng đọc</label>
              {isFpt ? (
                <select
                  value={dubForm.fpt_voice}
                  onChange={(e) => setDubForm((p) => ({ ...p, fpt_voice: e.target.value }))}
                >
                  {FPT_VOICES.map((v) => (
                    <option key={v.value} value={v.value}>{v.label}</option>
                  ))}
                </select>
              ) : (
                <select
                  value={dubForm.voice}
                  onChange={(e) => setDubForm((p) => ({ ...p, voice: e.target.value }))}
                >
                  {EDGE_VOICES.map((v) => (
                    <option key={v.value} value={v.value}>{v.label}</option>
                  ))}
                </select>
              )}
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              {isFpt ? (
                <>
                  <label>
                    Tốc độ đọc&nbsp;
                    <span style={{ fontWeight: 700, color: "var(--accent)" }}>
                      {dubForm.fpt_speed > 0 ? `+${dubForm.fpt_speed}` : dubForm.fpt_speed}
                    </span>
                    <span style={{ color: "var(--text-muted)", fontSize: 12 }}>&nbsp;(-3 → +3)</span>
                  </label>
                  <input
                    type="range"
                    min={-3} max={3} step={1}
                    value={dubForm.fpt_speed}
                    onChange={(e) => setDubForm((p) => ({ ...p, fpt_speed: Number(e.target.value) }))}
                    style={{ width: "100%", accentColor: "var(--accent)", marginTop: 6 }}
                  />
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                    <span>-3 chậm</span><span>0 bình thường</span><span>+3 nhanh</span>
                  </div>
                </>
              ) : (
                <>
                  <label>Tốc độ đọc</label>
                  <input
                    value={dubForm.rate}
                    onChange={(e) => setDubForm((p) => ({ ...p, rate: e.target.value }))}
                    placeholder="+0%"
                  />
                </>
              )}
            </div>
          </div>

          {/* FPT API Key */}
          {isFpt && (
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>
                FPT.AI API Key
                <span style={{ color: "var(--text-muted)", fontSize: 12, marginLeft: 6 }}>
                  (để trống dùng key mặc định)
                </span>
              </label>
              <input
                type="password"
                value={dubForm.fpt_api_key}
                onChange={(e) => setDubForm((p) => ({ ...p, fpt_api_key: e.target.value }))}
                placeholder={`Mặc định: ${FPT_DEFAULT_KEY.slice(0, 8)}…`}
                style={{ fontFamily: "monospace" }}
              />
            </div>
          )}

          {/* Edge-only: Volume */}
          {!isFpt && (
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Âm lượng</label>
              <input
                value={dubForm.volume}
                onChange={(e) => setDubForm((p) => ({ ...p, volume: e.target.value }))}
                placeholder="+0%"
              />
            </div>
          )}

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
