/**
 * CreateSchool.jsx
 * 
 * Multi-step wizard for creating a new School (Club).
 * Step 1: Name + slug + type
 * Step 2: Description + banner + tracked species
 * Step 3: Settings (member cap, invite-only)
 */

import React, { useState, useCallback } from "react";
import { useCreateSchool } from "../../hooks/useSchools";
import { isSlugAvailable } from "../../services/schoolsApi";
import { uploadImage } from "../../services/mediaUpload";

const SCHOOL_TYPES = [
  { value: "species", label: "🐟 Species-Focused", desc: "Dedicated to specific species care & breeding" },
  { value: "regional", label: "🌍 Regional", desc: "Local community of breeders in your area" },
  { value: "breeding", label: "🧬 Breeding Program", desc: "Collaborative breeding projects" },
  { value: "conservation", label: "🌿 Conservation", desc: "Species preservation efforts" },
  { value: "equipment", label: "⚙️ Equipment/Tech", desc: "Filtration, lighting, automation" },
  { value: "open", label: "🌊 Open", desc: "General aquarium community" },
];

export function CreateSchool({ onClose, onCreated }) {
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    name: "",
    slug: "",
    schoolType: "",
    description: "",
    bannerUrl: "",
    trackedSpecies: [],
    memberCap: "",
    isInviteOnly: false,
  });
  const [slugAvailable, setSlugAvailable] = useState(null);
  const [slugChecking, setSlugChecking] = useState(false);
  const [bannerUploading, setBannerUploading] = useState(false);
  const [error, setError] = useState("");

  const createSchoolMutation = useCreateSchool();

  // Auto-generate slug from name
  const generateSlug = useCallback((name) => {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 40);
  }, []);

  const handleNameChange = async (name) => {
    setFormData((prev) => ({ ...prev, name }));
    const slug = generateSlug(name);
    setFormData((prev) => ({ ...prev, slug }));

    if (slug.length >= 3) {
      setSlugChecking(true);
      const available = await isSlugAvailable(slug);
      setSlugAvailable(available);
      setSlugChecking(false);
    } else {
      setSlugAvailable(null);
    }
  };

  const handleSlugChange = async (slug) => {
    const cleanSlug = slug.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40);
    setFormData((prev) => ({ ...prev, slug: cleanSlug }));

    if (cleanSlug.length >= 3) {
      setSlugChecking(true);
      const available = await isSlugAvailable(cleanSlug);
      setSlugAvailable(available);
      setSlugChecking(false);
    } else {
      setSlugAvailable(null);
    }
  };

  const handleBannerUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setBannerUploading(true);
    try {
      const url = await uploadImage(file);
      setFormData((prev) => ({ ...prev, bannerUrl: url }));
    } catch (err) {
      setError("Banner upload failed. Please try again.");
    }
    setBannerUploading(false);
  };

  const handleSubmit = async () => {
    setError("");

    if (!formData.name || !formData.slug || !formData.schoolType) {
      setError("Please fill in all required fields.");
      return;
    }

    const result = await createSchoolMutation.mutateAsync({
      name: formData.name,
      slug: formData.slug,
      description: formData.description,
      bannerUrl: formData.bannerUrl,
      schoolType: formData.schoolType,
      memberCap: formData.memberCap ? parseInt(formData.memberCap) : null,
      isInviteOnly: formData.isInviteOnly,
      trackedSpecies: formData.trackedSpecies,
    });

    if (result.error) {
      setError(result.error.message || "Failed to create school.");
    } else {
      onCreated?.(result.data);
      onClose?.();
    }
  };

  const canProceedStep1 = formData.name.length >= 3 && formData.slug.length >= 3 && slugAvailable && formData.schoolType;
  const canSubmit = canProceedStep1;

  return (
    <div className="create-school-wizard" style={{
      position: "fixed",
      inset: 0,
      zIndex: 1000,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "rgba(0, 0, 0, 0.7)",
      backdropFilter: "blur(8px)",
      padding: "1rem",
    }}>
      <div className="glass-card" style={{
        width: "100%",
        maxWidth: "560px",
        maxHeight: "85vh",
        overflow: "auto",
        padding: "2rem",
        borderRadius: "var(--radius-md)",
        border: "1px solid rgba(56, 189, 248, 0.15)",
      }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
          <h2 style={{ margin: 0, fontSize: "1.25rem", color: "#fff" }}>
            🏫 Create a School
          </h2>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: "1.5rem", cursor: "pointer" }}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Step Indicator */}
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem" }}>
          {[1, 2, 3].map((s) => (
            <div key={s} style={{
              flex: 1,
              height: "3px",
              borderRadius: "2px",
              background: s <= step ? "var(--accent-blue)" : "rgba(255,255,255,0.1)",
              transition: "background 0.3s ease",
            }} />
          ))}
        </div>

        {/* Step 1: Name + Slug + Type */}
        {step === 1 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            <div>
              <label style={{ display: "block", fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "0.4rem" }}>
                School Name *
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="e.g. Pacific Northwest Cichlid Collective"
                maxLength={60}
                style={{
                  width: "100%",
                  padding: "0.7rem 1rem",
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: "var(--radius-sm)",
                  color: "#fff",
                  fontSize: "0.9rem",
                }}
              />
            </div>

            <div>
              <label style={{ display: "block", fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "0.4rem" }}>
                URL Slug *
              </label>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>/school/</span>
                <input
                  type="text"
                  value={formData.slug}
                  onChange={(e) => handleSlugChange(e.target.value)}
                  placeholder="pnw-cichlids"
                  maxLength={40}
                  style={{
                    flex: 1,
                    padding: "0.7rem 1rem",
                    background: "rgba(255,255,255,0.04)",
                    border: `1px solid ${slugAvailable === false ? "rgba(248, 113, 113, 0.4)" : slugAvailable === true ? "rgba(52, 211, 153, 0.4)" : "rgba(255,255,255,0.1)"}`,
                    borderRadius: "var(--radius-sm)",
                    color: "#fff",
                    fontSize: "0.9rem",
                  }}
                />
              </div>
              {slugChecking && (
                <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>Checking...</span>
              )}
              {slugAvailable === true && (
                <span style={{ fontSize: "0.7rem", color: "var(--accent-green)" }}>✓ Available</span>
              )}
              {slugAvailable === false && (
                <span style={{ fontSize: "0.7rem", color: "var(--accent-red)" }}>✗ Taken</span>
              )}
            </div>

            <div>
              <label style={{ display: "block", fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "0.6rem" }}>
                School Type *
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                {SCHOOL_TYPES.map((t) => (
                  <button
                    key={t.value}
                    onClick={() => setFormData((prev) => ({ ...prev, schoolType: t.value }))}
                    style={{
                      padding: "0.6rem 0.8rem",
                      background: formData.schoolType === t.value
                        ? "rgba(56, 189, 248, 0.15)"
                        : "rgba(255,255,255,0.03)",
                      border: `1px solid ${formData.schoolType === t.value ? "rgba(56, 189, 248, 0.4)" : "rgba(255,255,255,0.08)"}`,
                      borderRadius: "var(--radius-sm)",
                      color: formData.schoolType === t.value ? "#fff" : "var(--text-secondary)",
                      cursor: "pointer",
                      textAlign: "left",
                      transition: "all 0.2s ease",
                    }}
                  >
                    <div style={{ fontSize: "0.8rem", fontWeight: "600" }}>{t.label}</div>
                    <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginTop: "0.2rem" }}>{t.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Step 2: Description + Banner + Species */}
        {step === 2 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            <div>
              <label style={{ display: "block", fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "0.4rem" }}>
                Description
              </label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
                placeholder="What's this school about? Who should join?"
                maxLength={500}
                rows={4}
                style={{
                  width: "100%",
                  padding: "0.7rem 1rem",
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: "var(--radius-sm)",
                  color: "#fff",
                  fontSize: "0.85rem",
                  resize: "vertical",
                }}
              />
              <span style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>
                {formData.description.length}/500
              </span>
            </div>

            <div>
              <label style={{ display: "block", fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "0.4rem" }}>
                Banner Image
              </label>
              {formData.bannerUrl ? (
                <div style={{ position: "relative" }}>
                  <img
                    src={formData.bannerUrl}
                    alt="School banner"
                    style={{
                      width: "100%",
                      height: "120px",
                      objectFit: "cover",
                      borderRadius: "var(--radius-sm)",
                      border: "1px solid rgba(255,255,255,0.1)",
                    }}
                  />
                  <button
                    onClick={() => setFormData((prev) => ({ ...prev, bannerUrl: "" }))}
                    style={{
                      position: "absolute",
                      top: "0.5rem",
                      right: "0.5rem",
                      background: "rgba(0,0,0,0.7)",
                      border: "none",
                      borderRadius: "50%",
                      color: "#fff",
                      width: "24px",
                      height: "24px",
                      cursor: "pointer",
                      fontSize: "0.8rem",
                    }}
                  >
                    ×
                  </button>
                </div>
              ) : (
                <label style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  height: "80px",
                  background: "rgba(255,255,255,0.03)",
                  border: "1px dashed rgba(255,255,255,0.15)",
                  borderRadius: "var(--radius-sm)",
                  cursor: "pointer",
                  color: "var(--text-muted)",
                  fontSize: "0.8rem",
                }}>
                  {bannerUploading ? "Uploading..." : "📷 Click to upload banner"}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleBannerUpload}
                    style={{ display: "none" }}
                  />
                </label>
              )}
            </div>

            <div>
              <label style={{ display: "block", fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "0.4rem" }}>
                Tracked Species (optional)
              </label>
              <p style={{ fontSize: "0.7rem", color: "var(--text-muted)", margin: "0 0 0.5rem" }}>
                Add species this school focuses on. Members' Currents about these species will appear in the school feed.
              </p>
              <input
                type="text"
                placeholder="Search species to add... (coming soon)"
                disabled
                style={{
                  width: "100%",
                  padding: "0.7rem 1rem",
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  borderRadius: "var(--radius-sm)",
                  color: "var(--text-muted)",
                  fontSize: "0.85rem",
                }}
              />
            </div>
          </div>
        )}

        {/* Step 3: Settings */}
        {step === 3 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            <div>
              <label style={{ display: "block", fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "0.4rem" }}>
                Member Cap (optional)
              </label>
              <input
                type="number"
                value={formData.memberCap}
                onChange={(e) => setFormData((prev) => ({ ...prev, memberCap: e.target.value }))}
                placeholder="Leave empty for unlimited"
                min={2}
                max={10000}
                style={{
                  width: "100%",
                  padding: "0.7rem 1rem",
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: "var(--radius-sm)",
                  color: "#fff",
                  fontSize: "0.9rem",
                }}
              />
            </div>

            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "1rem",
              background: "rgba(255,255,255,0.03)",
              borderRadius: "var(--radius-sm)",
              border: "1px solid rgba(255,255,255,0.08)",
            }}>
              <div>
                <div style={{ fontSize: "0.85rem", color: "#fff", fontWeight: "500" }}>
                  🔒 Invite Only
                </div>
                <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginTop: "0.2rem" }}>
                  Members must be invited or approved to join
                </div>
              </div>
              <button
                onClick={() => setFormData((prev) => ({ ...prev, isInviteOnly: !prev.isInviteOnly }))}
                style={{
                  width: "44px",
                  height: "24px",
                  borderRadius: "12px",
                  border: "none",
                  background: formData.isInviteOnly ? "var(--accent-blue)" : "rgba(255,255,255,0.15)",
                  cursor: "pointer",
                  position: "relative",
                  transition: "background 0.2s ease",
                }}
                role="switch"
                aria-checked={formData.isInviteOnly}
              >
                <div style={{
                  width: "18px",
                  height: "18px",
                  borderRadius: "50%",
                  background: "#fff",
                  position: "absolute",
                  top: "3px",
                  left: formData.isInviteOnly ? "23px" : "3px",
                  transition: "left 0.2s ease",
                }} />
              </button>
            </div>

            {/* Summary */}
            <div style={{
              padding: "1rem",
              background: "rgba(56, 189, 248, 0.05)",
              borderRadius: "var(--radius-sm)",
              border: "1px solid rgba(56, 189, 248, 0.1)",
            }}>
              <div style={{ fontSize: "0.75rem", color: "var(--accent-blue)", fontWeight: "600", marginBottom: "0.5rem" }}>
                Review
              </div>
              <div style={{ fontSize: "0.8rem", color: "#fff" }}>
                <strong>{formData.name}</strong> ({SCHOOL_TYPES.find((t) => t.value === formData.schoolType)?.label})
              </div>
              <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginTop: "0.3rem" }}>
                /school/{formData.slug} · {formData.isInviteOnly ? "Invite only" : "Open"} · {formData.memberCap || "Unlimited"} members
              </div>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{
            marginTop: "1rem",
            padding: "0.6rem 1rem",
            background: "rgba(248, 113, 113, 0.1)",
            border: "1px solid rgba(248, 113, 113, 0.2)",
            borderRadius: "var(--radius-sm)",
            color: "var(--accent-red)",
            fontSize: "0.8rem",
          }}>
            {error}
          </div>
        )}

        {/* Navigation */}
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: "1.5rem", gap: "1rem" }}>
          {step > 1 ? (
            <button
              onClick={() => setStep(step - 1)}
              className="btn-secondary"
              style={{ padding: "0.6rem 1.5rem" }}
            >
              ← Back
            </button>
          ) : (
            <button
              onClick={onClose}
              className="btn-secondary"
              style={{ padding: "0.6rem 1.5rem" }}
            >
              Cancel
            </button>
          )}

          {step < 3 ? (
            <button
              onClick={() => setStep(step + 1)}
              className="btn-primary"
              disabled={step === 1 && !canProceedStep1}
              style={{ padding: "0.6rem 1.5rem" }}
            >
              Next →
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              className="btn-primary"
              disabled={!canSubmit || createSchoolMutation.isPending}
              style={{ padding: "0.6rem 1.5rem" }}
            >
              {createSchoolMutation.isPending ? "Creating..." : "🏫 Create School"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
