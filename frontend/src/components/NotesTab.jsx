import React, { useState, useEffect } from "react";
import { db } from "../db";

export function NotesTab({ tankId }) {
  const [notes, setNotes] = useState([]);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [dbReady, setDbReady] = useState(true);

  const loadNotes = async () => {
    try {
      const rows = await db.tankNotes.where("tankId").equals(tankId).toArray();
      setNotes(rows.sort((a, b) => b.createdAt - a.createdAt));
    } catch (e) {
      console.warn("tankNotes not ready:", e);
      setDbReady(false);
      setNotes([]);
    }
  };

  useEffect(() => { loadNotes(); }, [tankId]);

  const saveNote = async () => {
    if (!draft.trim()) return;
    setSaving(true);
    try {
      await db.tankNotes.add({ tankId, text: draft.trim(), createdAt: Date.now() });
      setDraft("");
      await loadNotes();
    } catch (e) {
      console.warn("Failed to save note:", e);
    } finally {
      setSaving(false);
    }
  };

  const deleteNote = async (id) => {
    try {
      await db.tankNotes.delete(id);
      await loadNotes();
    } catch (e) {
      console.warn("Failed to delete note:", e);
    }
  };

  if (!dbReady) {
    return (
      <div style={{ padding: "2rem", textAlign: "center", color: "var(--text-muted)", fontSize: "0.85rem" }}>
        📝 Notes are upgrading… Please refresh the page once.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <span style={{ fontSize: "1rem" }}>📝</span>
        <strong style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>Tank Notes</strong>
      </div>

      {/* Compose area */}
      <div style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid var(--glass-border)",
        borderRadius: "10px",
        padding: "0.75rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
      }}>
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder="Write a note about water changes, feeding, observations..."
          rows={3}
          style={{
            width: "100%",
            background: "rgba(0,0,0,0.25)",
            border: "1px solid var(--glass-border)",
            borderRadius: "6px",
            color: "#fff",
            fontSize: "0.8rem",
            padding: "0.6rem 0.75rem",
            resize: "vertical",
            outline: "none",
            fontFamily: "inherit",
            boxSizing: "border-box",
          }}
          onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) saveNote(); }}
        />
        <button
          onClick={saveNote}
          disabled={saving || !draft.trim()}
          style={{
            alignSelf: "flex-end",
            padding: "0.4rem 1.1rem",
            background: draft.trim() ? "linear-gradient(135deg,#38bdf8,#6366f1)" : "rgba(255,255,255,0.08)",
            border: "none",
            borderRadius: "6px",
            color: draft.trim() ? "#fff" : "var(--text-muted)",
            fontWeight: "600",
            fontSize: "0.78rem",
            cursor: draft.trim() ? "pointer" : "not-allowed",
            transition: "all 0.2s",
          }}
        >
          {saving ? "Saving…" : "Save Note"}
        </button>
      </div>

      {/* Notes list */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxHeight: "220px", overflowY: "auto" }}>
        {notes.length === 0 ? (
          <p style={{ color: "var(--text-muted)", fontSize: "0.82rem", textAlign: "center", padding: "1.5rem 0" }}>
            No notes yet. Add your first observation above!
          </p>
        ) : notes.map(note => (
          <div key={note.id} style={{
            background: "rgba(56,189,248,0.04)",
            border: "1px solid rgba(56,189,248,0.15)",
            borderRadius: "8px",
            padding: "0.65rem 0.85rem",
            display: "flex",
            gap: "0.5rem",
            alignItems: "flex-start",
          }}>
            <div style={{ flex: 1 }}>
              <p style={{ color: "#fff", fontSize: "0.8rem", margin: 0, lineHeight: 1.5 }}>{note.text}</p>
              <span style={{ color: "var(--text-muted)", fontSize: "0.68rem" }}>
                {new Date(note.createdAt).toLocaleString()}
              </span>
            </div>
            <button
              onClick={() => deleteNote(note.id)}
              title="Delete note"
              aria-label="Delete note"
              style={{
                background: "none",
                border: "none",
                color: "rgba(239,68,68,0.6)",
                cursor: "pointer",
                fontSize: "0.9rem",
                padding: "0.1rem 0.2rem",
                lineHeight: 1,
                flexShrink: 0,
              }}
            >✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}
