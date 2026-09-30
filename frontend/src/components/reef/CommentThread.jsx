/**
 * CommentThread.jsx
 *
 * Threaded comment section for Currents.
 * Shows comments with 1-level threading (replies indented under parent).
 * Includes inline reply functionality and comment posting.
 * Styles live in ReefDaylight.css.
 */

import React, { useState, useEffect } from "react";
import { ChatCircle } from "@phosphor-icons/react";
import { ProfileCard } from "./ProfileCard";
import { getComments, postComment } from "../../services/reefApi";
import { getCurrentWallet } from "../../services/supabaseClient";
import "./ReefDaylight.css";

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

function CommentInput({ onSubmit, placeholder = "Write a comment", autoFocus = false }) {
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

  if (!walletAddress) {
    return <p className="reef-comment-note">Sign in to join the conversation.</p>;
  }

  return (
    <div className="reef-comment-form">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, 1000))}
        placeholder={placeholder}
        autoFocus={autoFocus}
        rows={1}
        className="reef-input reef-comment-input"
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
          }
        }}
        aria-label={placeholder}
      />
      <button
        type="button"
        className="reef-btn reef-btn--primary"
        onClick={handleSubmit}
        disabled={!text.trim() || submitting}
        aria-label="Post comment"
      >
        {submitting ? "Posting…" : "Post"}
      </button>
    </div>
  );
}

function SingleComment({ comment, onReply, isReply = false }) {
  const [showReplyInput, setShowReplyInput] = useState(false);
  const profile = comment.profiles;

  return (
    <div className={`reef-comment ${isReply ? "reef-comment--reply" : ""}`}>
      <div className="reef-comment-head">
        <ProfileCard
          walletAddress={profile?.wallet_address || comment.author_wallet}
          displayName={profile?.display_name}
          avatarUrl={profile?.avatar_url}
          companionTier={profile?.companion_tier}
          size="small"
          showTier={false}
        />
        <span className="reef-comment-time">{timeAgo(comment.created_at)}</span>
      </div>

      <p className="reef-comment-body">{comment.body}</p>

      {/* Reply button (only for top-level comments) */}
      {!isReply && getCurrentWallet() && (
        <button type="button" className="reef-link" style={{ alignSelf: "flex-start", fontSize: "0.8rem" }} onClick={() => setShowReplyInput(!showReplyInput)}>
          Reply
        </button>
      )}

      {showReplyInput && (
        <CommentInput
          placeholder="Write a reply"
          autoFocus
          onSubmit={async (text) => {
            await onReply(text, comment.id);
            setShowReplyInput(false);
          }}
        />
      )}
    </div>
  );
}

export function CommentThread({ currentId, initialCount = 0 }) {
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [commentCount, setCommentCount] = useState(initialCount);
  const [loaded, setLoaded] = useState(false);

  const loadComments = async () => {
    if (!currentId || loaded) return;
    setLoading(true);
    const { data } = await getComments(currentId, { limit: 50 });
    if (data) {
      setComments(data);
      setCommentCount(data.length);
      // Auto-expand if there are existing comments
      if (data.length > 0) setExpanded(true);
    }
    setLoading(false);
    setLoaded(true);
  };

  // Load comments on mount
  useEffect(() => {
    loadComments();
  }, [currentId]);

  const handleExpand = () => {
    if (!loaded) loadComments();
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
    if (!replyMap[reply.parent_comment_id]) replyMap[reply.parent_comment_id] = [];
    replyMap[reply.parent_comment_id].push(reply);
  }

  const toggleLabel = commentCount > 0 ? `${commentCount} comment${commentCount !== 1 ? "s" : ""}` : "Comment";

  return (
    <div className="reef-comments">
      <button
        type="button"
        className="reef-btn reef-btn--sm reef-btn--ghost reef-comments-toggle"
        onClick={handleExpand}
        aria-expanded={expanded}
      >
        <ChatCircle size={17} aria-hidden="true" />
        {expanded && commentCount > 0 ? `Hide ${toggleLabel}` : toggleLabel}
      </button>

      {expanded && (
        <div className="reef-comments-panel">
          {loading && <p className="reef-comment-note">Loading comments…</p>}

          {!loading && topLevel.length === 0 && <p className="reef-comment-note">No comments yet.</p>}

          {topLevel.map((comment) => (
            <div key={comment.id} className="reef-comments">
              <SingleComment comment={comment} onReply={handlePostComment} />
              {replyMap[comment.id]?.map((reply) => (
                <SingleComment key={reply.id} comment={reply} onReply={handlePostComment} isReply />
              ))}
            </div>
          ))}

          <div className="reef-comment-compose">
            <CommentInput onSubmit={(text) => handlePostComment(text, null)} />
          </div>
        </div>
      )}
    </div>
  );
}
