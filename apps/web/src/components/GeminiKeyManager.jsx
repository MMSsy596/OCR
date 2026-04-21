import { useState, useEffect, useCallback } from "react";
import { withApiAuth, readApiErrorMessage } from "../lib/api";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8000";

async function apiFetch(url, options = {}) {
  const res = await fetch(url, withApiAuth(options));
  if (!res.ok) throw new Error(await readApiErrorMessage(res, `HTTP ${res.status}`));
  return res.json();
}

function KeyRow({ item, onDelete, onEdit, onTest, testing }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      padding: "10px 16px",
      borderRadius: "var(--radius-md)",
      background: item.is_primary ? "rgba(99,102,241,0.08)" : "var(--bg-elevated)",
      border: `1px solid ${item.is_primary ? "rgba(99,102,241,0.3)" : "var(--border)"}`,
      marginBottom: 8,
      transition: "all 0.2s",
    }}>
      {/* Index badge */}
      <div style={{
        width: 28, height: 28, borderRadius: "50%",
        background: item.is_primary ? "var(--accent)" : "var(--bg-card)",
        color: item.is_primary ? "#fff" : "var(--text-secondary)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 12, fontWeight: 700, flexShrink: 0,
        border: "1px solid var(--border)",
      }}>
        {item.index + 1}
      </div>

      {/* Key info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: "monospace", fontSize: 14, color: "var(--text-primary)" }}>
            {item.key_masked}
          </span>
          {item.is_primary && (
            <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20, background: "rgba(99,102,241,0.2)", color: "var(--accent)", fontWeight: 700 }}>
              PRIMARY
            </span>
          )}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
          ...{item.key_suffix} · Key #{item.index + 1} trong danh sách rollback
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => onTest(item)}
          disabled={testing}
          title="Kiểm tra key này"
          style={{ fontSize: 13 }}
        >
          {testing ? "⏳" : "🧪"}
        </button>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => onEdit(item)}
          title="Sửa key này"
          style={{ fontSize: 13 }}
        >
          ✏️
        </button>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => onDelete(item)}
          title="Xóa key này"
          style={{ fontSize: 13, color: "var(--danger)" }}
        >
          🗑️
        </button>
      </div>
    </div>
  );
}

export function GeminiKeyManager({ onClose }) {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [addMode, setAddMode] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [inputVal, setInputVal] = useState("");
  const [saving, setSaving] = useState(false);
  const [testingIdx, setTestingIdx] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const loadKeys = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const data = await apiFetch(`${API_BASE}/admin/gemini-keys`);
      setKeys(data.keys || []);
    } catch (err) {
      setError(`Không tải được danh sách key: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadKeys(); }, [loadKeys]);

  async function handleAdd() {
    if (!inputVal.trim()) return;
    setSaving(true);
    try {
      const data = await apiFetch(`${API_BASE}/admin/gemini-keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: inputVal.trim() }),
      });
      setKeys(data.keys || []);
      setInputVal("");
      setAddMode(false);
    } catch (err) {
      setError(`Lỗi thêm key: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate() {
    if (!inputVal.trim() || editItem === null) return;
    setSaving(true);
    try {
      const data = await apiFetch(`${API_BASE}/admin/gemini-keys/${editItem.index}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: inputVal.trim() }),
      });
      setKeys(data.keys || []);
      setInputVal("");
      setEditItem(null);
    } catch (err) {
      setError(`Lỗi cập nhật key: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(item) {
    setSaving(true);
    try {
      const data = await apiFetch(`${API_BASE}/admin/gemini-keys/${item.index}`, {
        method: "DELETE",
      });
      setKeys((prev) => prev.filter((k) => k.index !== item.index).map((k, i) => ({ ...k, index: i, is_primary: i === 0 })));
      setDeleteConfirm(null);
      await loadKeys();
    } catch (err) {
      setError(`Lỗi xóa key: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleTest(item) {
    setTestingIdx(item.index);
    setTestResult(null);
    try {
      const result = await apiFetch(`${API_BASE}/admin/gemini-keys/${item.index}/test`, {
        method: "POST",
      });
      setTestResult({ idx: item.index, ...result });
    } catch (err) {
      setTestResult({ idx: item.index, ok: false, message: `Lỗi: ${err.message}`, key_suffix: item.key_suffix });
    } finally {
      setTestingIdx(null);
    }
  }

  function openEdit(item) {
    setEditItem(item);
    setInputVal("");
    setAddMode(false);
  }

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 16,
    }}>
      <div style={{
        width: "100%", maxWidth: 600,
        background: "var(--bg-card)",
        borderRadius: "var(--radius-xl)",
        border: "1px solid var(--border)",
        boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
        maxHeight: "90vh", display: "flex", flexDirection: "column",
        overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{
          padding: "20px 24px", borderBottom: "1px solid var(--border)",
          display: "flex", alignItems: "center", gap: 12,
        }}>
          <div style={{ fontSize: 24 }}>🔑</div>
          <div style={{ flex: 1 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Quản lý Gemini API Keys</h2>
            <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "4px 0 0" }}>
              {keys.length} key · Key #1 là main, các key sau là dự phòng rollback
            </p>
          </div>
          <button
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            style={{ fontSize: 18, width: 36, height: 36 }}
          >✕</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 24px" }}>

          {error && (
            <div style={{ padding: "10px 14px", background: "var(--danger-muted)", borderRadius: "var(--radius-md)", color: "var(--danger)", fontSize: 13, marginBottom: 12, border: "1px solid rgba(239,68,68,0.25)" }}>
              ❌ {error}
              <button className="btn btn-ghost btn-sm" onClick={() => setError("")} style={{ float: "right", fontSize: 12 }}>Đóng</button>
            </div>
          )}

          {testResult && (
            <div style={{
              padding: "10px 14px",
              background: testResult.ok ? "var(--success-muted)" : "var(--danger-muted)",
              borderRadius: "var(--radius-md)",
              color: testResult.ok ? "var(--success)" : "var(--danger)",
              fontSize: 13, marginBottom: 12,
              border: `1px solid ${testResult.ok ? "rgba(34,197,94,0.25)" : "rgba(239,68,68,0.25)"}`,
            }}>
              {testResult.message}
              <button className="btn btn-ghost btn-sm" onClick={() => setTestResult(null)} style={{ float: "right", fontSize: 12 }}>✕</button>
            </div>
          )}

          {loading ? (
            <div style={{ textAlign: "center", padding: "32px 0", color: "var(--text-muted)" }}>
              ⏳ Đang tải...
            </div>
          ) : keys.length === 0 ? (
            <div style={{ textAlign: "center", padding: "32px 0", color: "var(--text-muted)" }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>🔑</div>
              <p>Chưa có key nào được cấu hình.</p>
              <p style={{ fontSize: 12 }}>Thêm ít nhất 1 Gemini API key để bắt đầu dịch.</p>
            </div>
          ) : (
            <div>
              {keys.map((item) => (
                <KeyRow
                  key={item.index}
                  item={item}
                  onDelete={(i) => setDeleteConfirm(i)}
                  onEdit={openEdit}
                  onTest={handleTest}
                  testing={testingIdx === item.index}
                />
              ))}
            </div>
          )}

          {/* Add form */}
          {(addMode || editItem) && (
            <div style={{
              marginTop: 12, padding: "16px",
              background: "var(--bg-elevated)",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--border-focus)",
            }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>
                {editItem ? `✏️ Sửa key #${editItem.index + 1} (****${editItem.key_suffix})` : "➕ Thêm key mới"}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="text"
                  value={inputVal}
                  onChange={(e) => setInputVal(e.target.value)}
                  placeholder="Nhập Gemini API Key (AIza...)"
                  style={{ flex: 1 }}
                  onKeyDown={(e) => e.key === "Enter" && (editItem ? handleUpdate() : handleAdd())}
                  autoFocus
                />
                <button
                  className="btn btn-primary btn-sm"
                  onClick={editItem ? handleUpdate : handleAdd}
                  disabled={saving || !inputVal.trim()}
                >
                  {saving ? "⏳" : editItem ? "Lưu" : "Thêm"}
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => { setAddMode(false); setEditItem(null); setInputVal(""); }}
                >
                  Huỷ
                </button>
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
                Key sẽ được lưu vào file .env. Thứ tự trong danh sách = thứ tự rollback.
              </div>
            </div>
          )}

          {/* Delete confirm */}
          {deleteConfirm && (
            <div style={{
              marginTop: 12, padding: "14px 16px",
              background: "var(--danger-muted)",
              borderRadius: "var(--radius-md)",
              border: "1px solid rgba(239,68,68,0.3)",
            }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--danger)", marginBottom: 10 }}>
                🗑️ Xác nhận xóa key #{deleteConfirm.index + 1} (****{deleteConfirm.key_suffix})?
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className="btn btn-sm"
                  style={{ background: "var(--danger)", color: "#fff", border: "none" }}
                  onClick={() => handleDelete(deleteConfirm)}
                  disabled={saving}
                >
                  {saving ? "Đang xóa…" : "Xóa"}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setDeleteConfirm(null)}>Huỷ</button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: "12px 24px", borderTop: "1px solid var(--border)",
          display: "flex", gap: 8, alignItems: "center",
        }}>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => { setAddMode(true); setEditItem(null); setInputVal(""); }}
            disabled={addMode || editItem !== null}
          >
            ➕ Thêm key
          </button>
          <button className="btn btn-ghost btn-sm" onClick={loadKeys} disabled={loading}>
            🔄 Làm mới
          </button>
          <div style={{ flex: 1 }} />
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
            Key được mã hóa hiển thị. Thứ tự = ưu tiên rollback.
          </div>
        </div>
      </div>
    </div>
  );
}
