/**
 * CommentThread.jsx
 * 
 * Threaded comment section for Currents.
 * Shows comments with 1-level threading (replies indented under parent).
 * Includes inline reply functionality and comment posting.
 */

import React, { useState, useEffect } from "react";
import { ProfileCard } from "./ProfileCard";
import { getComments, postComment } from "../../services/reefApi";
import { getCurrentWallet } from "../../services/supabaseClient";

/**
 * Format relative time (e.g., "2h ago", "3d ago")
 */
function timeAgo(dateString) {
  const now = new Date();
  const date = new Date(dateString);
  const seconds = Math.floor((now - date) / 1000);

  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return date.toLocaleDateString();
}

function CommentInput({ onSubmit, placeholder = "Write a comment...", autoFocus = false }) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const walletAddress = getCurrentWallet();

  const handleSubmit = async () => {
    if (!text.trim() || submitting) return;
    setSubmitting(true);
    await onSubmit(text.trim());
    setText("");
    setSubmitting(false);
  };

  if (!walletAddress) return null;

  return (
    <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-end" }}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, 1000))}
        placeholder={placeholder}
        autoFocus={autoFocus}
        rows={1}
        className="reef-comment-input"
        style={{
          flex: 1,
          resize: "none",
          padding: "0.5rem 0.75rem",
          borderRadius: "8px",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          background: "rgba(255, 255, 255, 0.03)",
          color: "#fff",
          fontSize: "0.8rem",
          lineHeight: "1.5",
          fontFamily: "inherit",
          outline: "none",
          transition: "border-color 0.15s ease",
          minHeight: "36px",
          maxHeight: "120px",
          overflow: "auto",
        }}
        onFocus={(e) => { e.target.style.borderColor = "rgba(56, 189, 248, 0.3)"; }}
        onBlur={(e) => { e.target.style.borderColor = "rgba(255, 255, 255, 0.08)"; }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
          }
        }}
        aria-label={placeholder}
      />
      <button
        onClick={handleSubmit}
        disabled={!text.trim() || submitting}
        style={{
          padding: "0.45rem 0.75rem",
          borderRadius: "8px",
          border: "none",
          background: text.trim()
            ? "linear-gradient(135deg, #0ea5e9, #0369a1)"
            : "rgba(255, 255, 255, 0.05)",
          color: text.trim() ? "#fff" : "var(--text-muted)",
          fontSize: "0.75rem",
          fontWeight: 600,
          cursor: text.trim() ? "pointer" : "default",
          transition: "all 0.15s ease",
          opacity: submitting ? 0.5 : 1,
        }}
        aria-label="Post comment"
      >
        {submitting ? "..." : "Post"}
      </button>
    </div>
  );
}

function SingleComment({ comment, onReply, isReply = false }) {
  const [showReplyInput, setShowReplyInput] = useState(false);
  const profile = comment.profiles;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.3rem",
        paddingLeft: isReply ? "1.5rem" : "0",
        borderLeft: isReply ? "2px solid rgba(255, 255, 255, 0.06)" : "none",
        marginLeft: isReply ? "0.5rem" : "0",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <ProfileCard
          walletAddress={profile?.wallet_address || comment.author_wallet}
          displayName={profile?.display_name}
          avatarUrl={profile?.avatar_url}
          companionTier={profile?.companion_tier}
          size="small"
          showTier={false}
        />
        <span style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>
          {timeAgo(comment.created_at)}
        </span>
      </div>

      <p style={{
        margin: 0,
        fontSize: "0.8rem",
        color: "var(--text-secondary, #d1d5db)",
        lineHeight: "1.5",
        paddingLeft: "0.3rem",
      }}>
        {comment.body}
      </p>

      {/* Reply button (only for top-level comments) */}
      {!isReply && (
        <button
          onClick={() => setShowReplyInput(!showReplyInput)}
          style={{
            alignSelf: "flex-start",
            padding: "0.15rem 0.4rem",
            fontSize: "0.65rem",
            color: "var(--text-muted)",
            background: "none",
            border: "none",
            cursor: "pointer",
            borderRadius: "4px",
            transition: "color 0.15s ease",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "#fff"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; }}
        >
          ↩ Reply
        </button>
      )}

      {showReplyInput && (
        <div style={{ paddingLeft: "0.5rem", paddingTop: "0.25rem" }}>
          <CommentInput
            placeholder="Write a reply..."
            autoFocus
            onSubmit={async (text) => {
              await onReply(text, comment.id);
              setShowReplyInput(false);
            }}
          />
        </div>
      )}
    </div>
  );
}

export function CommentThread({ currentId, initialCount = 0 }) {
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [commentCount, setCommentCount] = useState(initialCount);

  const loadComments = async () => {
    if (!currentId) return;
    setLoading(true);
    const { data } = await getComments(currentId, { limit: 50 });
    if (data) {
      setComments(data);
      setCommentCount(data.length);
    }
    setLoading(false);
  };

  const handleExpand = () => {
    if (!expanded) {
      loadComments();
    }
    setExpanded(!expanded);
  };

  const handlePostComment = async (text, parentId = null) => {
    const { data } = await postComment(currentId, text, parentId);
    if (data) {
      setComments((prev) => [...prev, data]);
      setCommentCount((prev) => prev + 1);
    }
  };

  // Organize comments into threads (parent + replies)
  const topLevel = comments.filter((c) => !c.parent_comment_id);
  const replies = comments.filter((c) => c.parent_comment_id);
  const replyMap = {};
  for (const reply of replies) {
    if (!replyMap[reply.parent_comment_id]) {
      replyMap[reply.parent_comment_id] = [];
    }
    replyMap[reply.parent_comment_id].push(reply);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      {/* Toggle button */}
      <button
        onClick={handleExpand}
        style={{
          alignSelf: "flex-start",
          display: "inline-flex",
          alignItems: "center",
          gap: "0.35rem",
          padding: "0.3rem 0.6rem",
          fontSize: "0.75rem",
          color: "var(--text-muted)",
          background: "none",
          border: "none",
          cursor: "pointer",
          borderRadius: "4px",
          transition: "color 0.15s ease",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = "#fff"; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; }}
        aria-expanded={expanded}
        aria-label={`${commentCount} comments, click to ${expanded ? "collapse" : "expand"}`}
      >
        💬 {commentCount > 0 ? `${commentCount} comment${commentCount !== 1 ? "s" : ""}` : "Comment"}
      </button>

      {/* Expanded comment section */}
      {expanded && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.75rem",
            padding: "0.75rem",
            borderRadius: "8px",
            background: "rgba(255, 255, 255, 0.02)",
            border: "1px solid rgba(255, 255, 255, 0.05)",
          }}
        >
          {loading && (
            <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", textAlign: "center" }}>
              Loading comments...
            </p>
          )}

          {!loading && topLevel.length === 0 && (
            <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", textAlign: "center", padding: "0.5rem" }}>
              No comments yet. Be the first!
            </p>
          )}

          {/* Comment list */}
          {topLevel.map((comment) => (
            <div key={comment.id} style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <SingleComment
                comment={comment}
                onReply={handlePostComment}
              />
              {/* Replies */}
              {replyMap[comment.id]?.map((reply) => (
                <SingleComment
                  key={reply.id}
                  comment={reply}
                  onReply={handlePostComment}
                  isReply
                />
              ))}
            </div>
          ))}

          {/* New comment input */}
          <div style={{ paddingTop: "0.5rem", borderTop: "1px solid rgba(255, 255, 255, 0.04)" }}>
            <CommentInput onSubmit={(text) => handlePostComment(text, null)} />
          </div>
        </div>
      )}
    </div>
  );
}
