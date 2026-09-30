import React, { useState, useRef } from "react";
import { Modal } from "./Modal";
import { supabase, isSupabaseConfigured, getMintedToken } from "../services/supabaseClient";

const SCREENSHOT_BUCKET = "feedback-screenshots";
const SCREENSHOT_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/**
 * Upload a screenshot into the private feedback bucket through a one-time
 * signed upload from our server (/api/retention?action=feedback-upload).
 * Returns the object path, or null if anything fails (a report without its
 * screenshot is still worth sending).
 */
async function uploadScreenshot(file) {
  if (!file || !isSupabaseConfigured()) return null;
  try {
    const res = await fetch("/api/retention?action=feedback-upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contentType: file.type, size: file.size }),
    });
    if (!res.ok) return null;
    const { path, token } = await res.json();
    if (!path || !token) return null;
    const { error } = await supabase.storage
      .from(SCREENSHOT_BUCKET)
      .uploadToSignedUrl(path, token, file, { contentType: file.type });
    return error ? null : path;
  } catch (err) {
    console.warn("[Feedback] Screenshot upload failed (non-blocking):", err.message);
    return null;
  }
}

/**
 * FeedbackWidget: floating "Feedback" button with a modal form.
 *
 * The report goes to our server (/api/retention?action=feedback), which posts
 * it to the team's private Discord channel. An optional screenshot goes into a
 * private storage bucket and the team gets a link that expires in 7 days; the
 * file is deleted after 90 days. Nothing is kept in this browser.
 *
 * Props:
 *  - walletAddress: accepted for compatibility but unused. Attribution comes
 *    only from the verified session token, never from the client.
 *  - casualModeActive (boolean) — adjusts copy tone
 */
export function FeedbackWidget({ casualModeActive = true }) {
  const [isOpen, setIsOpen] = useState(false);
  const [category, setCategory] = useState("bug");
  const [description, setDescription] = useState("");
  const [screenshot, setScreenshot] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [sendError, setSendError] = useState(null);
  const [fileNote, setFileNote] = useState(null);
  const fileInputRef = useRef(null);

  const handleOpen = () => {
    setIsOpen(true);
    setSubmitted(false);
  };

  const handleClose = () => {
    setIsOpen(false);
    // Reset form after close animation
    setTimeout(() => {
      setDescription("");
      setCategory("bug");
      setScreenshot(null);
      setSubmitted(false);
      setSendError(null);
      setFileNote(null);
    }, 300);
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // PNG, JPEG, WebP or GIF under 5 MB (the bucket enforces the same limits).
    if (!SCREENSHOT_TYPES.includes(file.type)) {
      setFileNote("Screenshots must be PNG, JPEG, WebP or GIF.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setFileNote("Screenshots must be under 5 MB.");
      return;
    }
    setFileNote(null);
    setScreenshot(file);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!description.trim()) return;

    setSubmitting(true);
    setSendError(null);

    // 1. Optional screenshot into the private bucket (best-effort).
    const screenshotPath = screenshot ? await uploadScreenshot(screenshot) : null;

    // 2. The report goes through our server, which holds the Discord webhook in
    //    a server-only env var. A signed session token only adds verified
    //    wallet attribution; the report works signed out too.
    try {
      const headers = { "Content-Type": "application/json" };
      const token = getMintedToken();
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch("/api/retention?action=feedback", {
        method: "POST",
        headers,
        body: JSON.stringify({
          category,
          description: description.trim(),
          pageUrl: window.location.href,
          screenSize: `${window.innerWidth}x${window.innerHeight}`,
          screenshotPath,
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.error || `status ${res.status}`);
      }
      setSubmitted(true);
    } catch (err) {
      console.warn("[Feedback] Send failed:", err.message);
      setSendError(
        `We could not send this (${err.message}). Your text is still here. Try again, or email kevin@aquacellum.com.`
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      {/* Floating trigger button */}
      <button
        onClick={handleOpen}
        className="feedback-fab"
        style={styles.fab}
        aria-label="Report a bug or give feedback"
        title="Report Bug / Feedback"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        <span style={styles.fabLabel}>Feedback</span>
      </button>

      {/* Feedback Modal */}
      <Modal isOpen={isOpen} onClose={handleClose} ariaLabel="Submit feedback or report a bug">
        <div style={styles.modalContent}>
          {submitted ? (
            <div style={styles.successState}>
              <div style={styles.successIcon}>✓</div>
              <h3 style={styles.successTitle}>
                {casualModeActive ? "Thanks for the feedback" : "Feedback submitted."}
              </h3>
              <p style={styles.successText}>
                {casualModeActive
                  ? "Your report helps make Aquacellum better for all fishkeepers."
                  : "Logged. Team will review."}
              </p>
              <button onClick={handleClose} style={styles.doneBtn}>Done</button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} style={styles.form}>
              <h3 style={styles.title}>
                {casualModeActive ? "Report a Bug or Share Feedback" : "Submit Report"}
              </h3>

              {/* Category selector */}
              <div style={styles.categoryRow}>
                {[
                  { value: "bug", label: "🐛 Bug", proLabel: "BUG" },
                  { value: "feature", label: "💡 Idea", proLabel: "FEATURE" },
                  { value: "ux", label: "🎨 UX Issue", proLabel: "UX" },
                  { value: "other", label: "💬 Other", proLabel: "OTHER" },
                ].map((cat) => (
                  <button
                    key={cat.value}
                    type="button"
                    onClick={() => setCategory(cat.value)}
                    style={{
                      ...styles.categoryBtn,
                      ...(category === cat.value ? styles.categoryBtnActive : {}),
                    }}
                    aria-pressed={category === cat.value}
                  >
                    {casualModeActive ? cat.label : cat.proLabel}
                  </button>
                ))}
              </div>

              {/* Description textarea */}
              <label style={styles.label} htmlFor="feedback-desc">
                {casualModeActive ? "What happened?" : "Description"}
              </label>
              <textarea
                id="feedback-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={
                  casualModeActive
                    ? "Describe what you experienced, what you expected, or your suggestion..."
                    : "Steps to reproduce, expected vs actual behavior..."
                }
                style={styles.textarea}
                rows={5}
                maxLength={2000}
                required
                autoFocus
              />
              <div style={styles.charCount}>{description.length}/2000</div>

              {/* Screenshot upload */}
              <div style={styles.screenshotRow}>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  style={styles.screenshotBtn}
                >
                  📷 {screenshot ? screenshot.name : "Attach Screenshot (optional)"}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  style={{ display: "none" }}
                  aria-label="Upload screenshot"
                />
                {screenshot && (
                  <button
                    type="button"
                    onClick={() => setScreenshot(null)}
                    style={styles.removeScreenshot}
                    aria-label="Remove screenshot"
                  >
                    ✕
                  </button>
                )}
              </div>
              {fileNote && <p role="status" style={styles.note}>{fileNote}</p>}
              {sendError && <p role="alert" style={styles.errorText}>{sendError}</p>}

              {/* Submit */}
              <button
                type="submit"
                disabled={submitting || !description.trim()}
                style={{
                  ...styles.submitBtn,
                  opacity: submitting || !description.trim() ? 0.5 : 1,
                }}
              >
                {submitting ? "Sending..." : casualModeActive ? "Send Feedback" : "Submit"}
              </button>
            </form>
          )}
        </div>
      </Modal>
    </>
  );
}

const styles = {
  fab: {
    position: "fixed",
    bottom: "5.5rem",
    right: "2rem",
    zIndex: 9999,
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    padding: "0.65rem 1rem",
    background: "var(--bg-secondary)",
    backdropFilter: "blur(12px)",
    border: "1px solid rgba(56, 189, 248, 0.25)",
    borderRadius: "50px",
    color: "var(--accent-blue)",
    fontFamily: "var(--font-display)",
    fontSize: "0.8rem",
    fontWeight: 500,
    cursor: "pointer",
    boxShadow: "var(--shadow-md)",
    transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
  },
  fabLabel: {
    fontSize: "0.8rem",
    lineHeight: 1,
  },
  modalContent: {
    padding: "1.5rem",
    minWidth: "min(420px, 90vw)",
    maxWidth: "480px",
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "0.75rem",
  },
  title: {
    margin: 0,
    fontSize: "1.1rem",
    fontFamily: "var(--font-display)",
    fontWeight: 600,
    color: "var(--text-primary)",
    marginBottom: "0.25rem",
  },
  categoryRow: {
    display: "flex",
    gap: "0.5rem",
    flexWrap: "wrap",
  },
  categoryBtn: {
    padding: "0.4rem 0.75rem",
    borderRadius: "50px",
    border: "1px solid rgba(var(--ink-rgb), 0.13)",
    background: "rgba(var(--ink-rgb), 0.03)",
    color: "var(--text-muted)",
    fontSize: "0.78rem",
    fontFamily: "var(--font-body)",
    cursor: "pointer",
    transition: "all 0.2s ease",
  },
  categoryBtnActive: {
    background: "rgba(56, 189, 248, 0.12)",
    borderColor: "rgba(56, 189, 248, 0.4)",
    color: "var(--accent-blue)",
  },
  label: {
    fontSize: "0.78rem",
    fontWeight: 500,
    color: "var(--text-muted)",
    marginTop: "0.25rem",
  },
  textarea: {
    width: "100%",
    padding: "0.75rem",
    borderRadius: "8px",
    border: "1px solid rgba(var(--ink-rgb), 0.13)",
    background: "var(--bg-secondary)",
    color: "var(--text-primary)",
    fontFamily: "var(--font-body)",
    fontSize: "0.85rem",
    resize: "vertical",
    lineHeight: 1.5,
    outline: "none",
    transition: "border-color 0.2s ease",
  },
  charCount: {
    fontSize: "0.7rem",
    color: "var(--text-muted)",
    textAlign: "right",
    marginTop: "-0.5rem",
  },
  screenshotRow: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
  },
  screenshotBtn: {
    padding: "0.4rem 0.75rem",
    borderRadius: "6px",
    border: "1px dashed rgba(var(--ink-rgb), 0.17)",
    background: "transparent",
    color: "var(--text-muted)",
    fontSize: "0.78rem",
    cursor: "pointer",
    fontFamily: "var(--font-body)",
    transition: "border-color 0.2s ease",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    maxWidth: "100%",
  },
  removeScreenshot: {
    background: "none",
    border: "none",
    color: "var(--accent-red)",
    cursor: "pointer",
    fontSize: "0.9rem",
    padding: "0.25rem",
  },
  note: {
    margin: 0,
    fontSize: "0.78rem",
    color: "var(--text-secondary)",
  },
  errorText: {
    margin: 0,
    fontSize: "0.82rem",
    lineHeight: 1.5,
    color: "#b91c1c",
  },
  submitBtn: {
    marginTop: "0.5rem",
    padding: "0.75rem 1.5rem",
    borderRadius: "8px",
    border: "none",
    background: "linear-gradient(135deg, #0284c7 0%, #0369a1 100%)",
    color: "#fff",
    fontFamily: "var(--font-display)",
    fontWeight: 500,
    fontSize: "0.9rem",
    cursor: "pointer",
    boxShadow: "0 4px 12px rgba(2, 132, 199, 0.25)",
    transition: "all 0.3s ease",
  },
  successState: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: "1.5rem 0",
    gap: "0.75rem",
    textAlign: "center",
  },
  successIcon: {
    width: "48px",
    height: "48px",
    borderRadius: "50%",
    background: "rgba(52, 211, 153, 0.15)",
    color: "var(--accent-green)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "1.5rem",
    fontWeight: "bold",
  },
  successTitle: {
    margin: 0,
    fontSize: "1.1rem",
    fontFamily: "var(--font-display)",
    fontWeight: 600,
    color: "var(--text-primary)",
  },
  successText: {
    margin: 0,
    fontSize: "0.85rem",
    color: "var(--text-muted)",
  },
  doneBtn: {
    marginTop: "0.75rem",
    padding: "0.6rem 1.5rem",
    borderRadius: "8px",
    border: "1px solid rgba(var(--ink-rgb), 0.13)",
    background: "rgba(var(--ink-rgb), 0.05)",
    color: "var(--text-primary)",
    fontFamily: "var(--font-display)",
    fontWeight: 500,
    fontSize: "0.85rem",
    cursor: "pointer",
    transition: "all 0.2s ease",
  },
};
