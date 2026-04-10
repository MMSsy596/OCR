export function SubtitleEditorTable({
  editableSegments,
  activeSegment,
  updateEditableSegment,
}) {
  return (
    <div className="table-wrap">
      <table>
        <colgroup>
          <col className="col-id" />
          <col className="col-time" />
          <col className="col-time" />
          <col className="col-text" />
          <col className="col-text" />
          <col className="col-meta" />
          <col className="col-meta" />
        </colgroup>
        <thead>
          <tr>
            <th>#</th>
            <th>Bắt đầu</th>
            <th>Kết thúc</th>
            <th>Gốc</th>
            <th>Bản dịch</th>
            <th>Nhân vật</th>
            <th>Giọng</th>
          </tr>
        </thead>
        <tbody>
          {editableSegments.length === 0 ? (
            <tr>
              <td colSpan={7}>Chưa có dữ liệu</td>
            </tr>
          ) : (
            editableSegments.map((s) => (
              <tr
                key={s.id}
                className={activeSegment?.id === s.id ? "active-row" : ""}
              >
                <td>{s.id}</td>
                <td>
                  <input
                    type="number"
                    step="0.01"
                    value={s.start_sec}
                    onChange={(e) =>
                      updateEditableSegment(s.id, "start_sec", e.target.value)
                    }
                  />
                </td>
                <td>
                  <input
                    type="number"
                    step="0.01"
                    value={s.end_sec}
                    onChange={(e) =>
                      updateEditableSegment(s.id, "end_sec", e.target.value)
                    }
                  />
                </td>
                <td>
                  <textarea
                    rows={2}
                    value={s.raw_text}
                    onChange={(e) =>
                      updateEditableSegment(s.id, "raw_text", e.target.value)
                    }
                  />
                </td>
                <td>
                  <textarea
                    rows={2}
                    value={s.translated_text}
                    onChange={(e) =>
                      updateEditableSegment(
                        s.id,
                        "translated_text",
                        e.target.value,
                      )
                    }
                  />
                </td>
                <td>
                  <input
                    value={s.speaker}
                    onChange={(e) =>
                      updateEditableSegment(s.id, "speaker", e.target.value)
                    }
                  />
                </td>
                <td>
                  <input
                    value={s.voice}
                    onChange={(e) =>
                      updateEditableSegment(s.id, "voice", e.target.value)
                    }
                  />
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
