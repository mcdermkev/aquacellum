import React, { useState, useRef } from "react";
import { Modal } from "./Modal";
import { supabase, isSupabaseConfigured } from "../services/supabaseClient";

/**
 * FeedbackWidget — Floating "Report Bug / Feedback" button with modal form.
 * Stores submissions in Supabase `beta_feedback` table.
 * Falls back to localStorage queue if Supabase is unavailable.
 *
 * Props:
 *  - walletAddress (string|null) — connected wallet for attribution
 *  - casualModeActive (boolean) — adjusts copy tone
 */
export function FeedbackWidget({ walletAddress, casualModeActive = true }) {
  const [isOpen, setIsOpen] = useState(false);
  const [category, setCategory] = useState("bug");
  const [description, setDescription] = useState("");
  const [screenshot, setScreenshot] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
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
    }, 300);
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Only accept images under 5MB
    if (!file.type.startsWith("image/")) return;
    if (file.size > 5 * 1024 * 1024) return;
    setScreenshot(file);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!description.trim()) return;

    setSubmitting(true);

    const feedback = {
      category,
      description: description.trim(),
      wallet_address: walletAddress?.toLowerCase() || null,
      page_url: window.location.href,
      user_agent: navigator.userAgent,
      screen_size: `${window.innerWidth}x${window.innerHeight}`,
      created_at: new Date().toISOString(),
    };

    // Step 1: Upload screenshot (best-effort; failure must not block anything).
    let screenshotUrl = null;
    if (screenshot && isSupabaseConfigured()) {
      try {
        const fileName = `feedback/${Date.now()}_${screenshot.name}`;
        const { data: uploadData } = await supabase.storage
          .from("media")
          .upload(fileName, screenshot, { contentType: screenshot.type });
        if (uploadData?.path) {
          const { data: urlData } = supabase.storage
            .from("media")
            .getPublicUrl(uploadData.path);
          screenshotUrl = urlData?.publicUrl || null;
        }
      } catch (err) {
        console.warn("[Feedback] Screenshot upload failed (non-blocking):", err.message);
      }
    }
    feedback.screenshot_url = screenshotUrl;

    // Step 2: Notify Discord FIRST and independently of the database write.
    // Discord is the team's real-time channel — it must fire even if Supabase is
    // down or rejects the insert. Discord webhooks allow browser CORS, so this
    // direct POST works without a server proxy.
    const discordWebhookUrl = import.meta.env.VITE_DISCORD_FEEDBACK_WEBHOOK;
    if (discordWebhookUrl) {
      const categoryEmoji = { bug: "🐛", feature: "💡", ux: "🎨", other: "💬" };
      try {
        const res = await fetch(discordWebhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            embeds: [{
              title: `${categoryEmoji[category] || "💬"} Beta Feedback: ${category.toUpperCase()}`,
              description: description.trim().slice(0, 1000),
              color: category === "bug" ? 0xf87171 : category === "feature" ? 0x38bdf8 : category === "ux" ? 0xfbbf24 : 0x94a3b8,
              fields: [
                { name: "Page", value: feedback.page_url || "—", inline: true },
                { name: "Device", value: feedback.screen_size || "—", inline: true },
                ...(screenshotUrl ? [{ name: "Screenshot", value: `[View](${screenshotUrl})` }] : []),
              ],
              footer: { text: `Wallet: ${feedback.wallet_address?.slice(0, 8) || "anonymous"}...` },
              timestamp: feedback.created_at,
            }],
          }),
        });
        if (!res.ok) console.warn("[Feedback] Discord webhook returned", res.status);
      } catch (err) {
        console.warn("[Feedback] Discord notification failed:", err.message);
      }
    } else {
      console.warn("[Feedback] VITE_DISCORD_FEEDBACK_WEBHOOK not set — Discord notification skipped");
    }

    // Step 3: Persist to Supabase (best-effort). On failure, queue locally for later sync.
    try {
      if (isSupabaseConfigured()) {
        const { error } = await supabase
          .from("beta_feedback")
          .insert([feedback]);
        if (error) throw error;
      } else {
        throw new Error("Supabase not configured");
      }
    } catch (err) {
      console.warn("[Feedback] DB write failed, queuing locally:", err.message);
      const queue = JSON.parse(localStorage.getItem("aquadex_feedback_queue") || "[]");
      queue.push(feedback);
      localStorage.setItem("aquadex_feedback_queue", JSON.stringify(queue));
    }

    setSubmitted(true);
    setSubmitting(false);
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
                {casualModeActive ? "Thanks for the feedback!" : "Feedback submitted."}
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
    background: "rgba(14, 20, 36, 0.92)",
    backdropFilter: "blur(12px)",
    border: "1px solid rgba(56, 189, 248, 0.25)",
    borderRadius: "50px",
    color: "#38bdf8",
    fontFamily: "'Outfit', sans-serif",
    fontSize: "0.8rem",
    fontWeight: 500,
    cursor: "pointer",
    boxShadow: "0 4px 20px rgba(0, 0, 0, 0.4), 0 0 15px rgba(56, 189, 248, 0.08)",
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
    fontFamily: "'Outfit', sans-serif",
    fontWeight: 600,
    color: "#f8fafc",
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
    border: "1px solid rgba(255, 255, 255, 0.08)",
    background: "rgba(255, 255, 255, 0.03)",
    color: "#94a3b8",
    fontSize: "0.78rem",
    fontFamily: "'Plus Jakarta Sans', sans-serif",
    cursor: "pointer",
    transition: "all 0.2s ease",
  },
  categoryBtnActive: {
    background: "rgba(56, 189, 248, 0.12)",
    borderColor: "rgba(56, 189, 248, 0.4)",
    color: "#38bdf8",
  },
  label: {
    fontSize: "0.78rem",
    fontWeight: 500,
    color: "#94a3b8",
    marginTop: "0.25rem",
  },
  textarea: {
    width: "100%",
    padding: "0.75rem",
    borderRadius: "8px",
    border: "1px solid rgba(255, 255, 255, 0.08)",
    background: "rgba(0, 0, 0, 0.3)",
    color: "#f8fafc",
    fontFamily: "'Plus Jakarta Sans', sans-serif",
    fontSize: "0.85rem",
    resize: "vertical",
    lineHeight: 1.5,
    outline: "none",
    transition: "border-color 0.2s ease",
  },
  charCount: {
    fontSize: "0.7rem",
    color: "#64748b",
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
    border: "1px dashed rgba(255, 255, 255, 0.12)",
    background: "transparent",
    color: "#94a3b8",
    fontSize: "0.78rem",
    cursor: "pointer",
    fontFamily: "'Plus Jakarta Sans', sans-serif",
    transition: "border-color 0.2s ease",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    maxWidth: "100%",
  },
  removeScreenshot: {
    background: "none",
    border: "none",
    color: "#f87171",
    cursor: "pointer",
    fontSize: "0.9rem",
    padding: "0.25rem",
  },
  submitBtn: {
    marginTop: "0.5rem",
    padding: "0.75rem 1.5rem",
    borderRadius: "8px",
    border: "none",
    background: "linear-gradient(135deg, #0284c7 0%, #0369a1 100%)",
    color: "#fff",
    fontFamily: "'Outfit', sans-serif",
    fontWeight: 500,
    fontSize: "0.9rem",
    cursor: "pointer",
    boxShadow: "0 4px 14px rgba(2, 132, 199, 0.4)",
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
    color: "#34d399",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "1.5rem",
    fontWeight: "bold",
  },
  successTitle: {
    margin: 0,
    fontSize: "1.1rem",
    fontFamily: "'Outfit', sans-serif",
    fontWeight: 600,
    color: "#f8fafc",
  },
  successText: {
    margin: 0,
    fontSize: "0.85rem",
    color: "#94a3b8",
  },
  doneBtn: {
    marginTop: "0.75rem",
    padding: "0.6rem 1.5rem",
    borderRadius: "8px",
    border: "1px solid rgba(255, 255, 255, 0.08)",
    background: "rgba(255, 255, 255, 0.05)",
    color: "#f8fafc",
    fontFamily: "'Outfit', sans-serif",
    fontWeight: 500,
    fontSize: "0.85rem",
    cursor: "pointer",
    transition: "all 0.2s ease",
  },
};
