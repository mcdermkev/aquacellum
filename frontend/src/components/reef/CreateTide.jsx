/**
 * CreateTide.jsx
 * 
 * Multi-step wizard for creating Tides.
 * Council members or School Elders can create.
 * Supports: Expo, Virtual, Challenge, and Auction tide types.
 */

import { useState } from "react";
import { useCreateTide } from "../../hooks/useTides";
import { uploadImage } from "../../services/mediaUpload";

const TIDE_TYPES = [
  {
    key: "expo",
    icon: "📍",
    label: "Expo",
    desc: "Physical meetup/swap. GPS-gated zone, 2% reduced fees, double XP.",
  },
  {
    key: "virtual",
    icon: "🎥",
    label: "Virtual",
    desc: "Livestream event — breeding demos, Q&A, species spotlights.",
  },
  {
    key: "challenge",
    icon: "🏆",
    label: "Challenge",
    desc: "Time-boxed competition. Most spawns, best grow-out, photo contest.",
  },
  {
    key: "auction",
    icon: "🔨",
    label: "Auction",
    desc: "Live auction for rare specimens. Real-time bidding with escrow.",
  },
];

export function CreateTide({ onSuccess, onCancel, preselectedSchoolId = null }) {
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    tideType: "",
    title: "",
    description: "",
    startTime: "",
    endTime: "",
    bannerFile: null,
    bannerPreview: null,
    // Expo-specific
    gpsLat: "",
    gpsLng: "",
    gpsRadius: "1",
    // Virtual-specific
    streamUrl: "",
    // Challenge-specific
    challengeRules: "",
    targetSpecies: "",
    scoringMethod: "spawns",
    // Auction-specific
    auctionItems: [],
    // General
    maxAttendees: "",
    hostSchoolId: preselectedSchoolId || "",
  });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const createTide = useCreateTide();

  const updateField = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleBannerSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    updateField("bannerFile", file);
    updateField("bannerPreview", URL.createObjectURL(file));
  };

  const handleSubmit = async () => {
    setError(null);
    setSubmitting(true);

    try {
      // Validate required fields
      if (!formData.title.trim()) throw new Error("Title is required.");
      if (!formData.tideType) throw new Error("Select a tide type.");
      if (!formData.startTime || !formData.endTime) throw new Error("Set start and end times.");
      if (new Date(formData.endTime) <= new Date(formData.startTime)) {
        throw new Error("End time must be after start time.");
      }

      // Upload banner if provided
      let bannerUrl = null;
      if (formData.bannerFile) {
        const { url, error: uploadError } = await uploadImage(formData.bannerFile);
        if (uploadError) throw new Error("Banner upload failed: " + uploadError);
        bannerUrl = url;
      }

      // Build GPS bounds for Expo tides
      let gpsBounds = null;
      if (formData.tideType === "expo" && formData.gpsLat && formData.gpsLng) {
        gpsBounds = {
          lat: parseFloat(formData.gpsLat),
          lng: parseFloat(formData.gpsLng),
          radius_km: parseFloat(formData.gpsRadius) || 1,
        };
      }

      // Build settings based on type
      const settings = {};
      if (formData.tideType === "challenge") {
        settings.challenge_rules = formData.challengeRules;
        settings.target_species = formData.targetSpecies;
        settings.scoring_method = formData.scoringMethod;
      }
      if (formData.tideType === "auction") {
        settings.auction_items = formData.auctionItems;
      }

      const result = await createTide.mutateAsync({
        title: formData.title.trim(),
        description: formData.description.trim() || null,
        tideType: formData.tideType,
        startTime: new Date(formData.startTime).toISOString(),
        endTime: new Date(formData.endTime).toISOString(),
        gpsBounds,
        bannerUrl,
        streamUrl: formData.streamUrl || null,
        maxAttendees: formData.maxAttendees ? parseInt(formData.maxAttendees) : null,
        hostSchoolId: formData.hostSchoolId || null,
        settings,
      });

      if (result.error) throw new Error(result.error.message || "Failed to create tide.");
      if (onSuccess) onSuccess(result.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="create-tide" aria-label="Create a Tide">
      <header className="create-tide__header">
        <h2>🌊 Create a Tide</h2>
        <button className="btn btn--ghost" onClick={onCancel}>✕</button>
      </header>

      {/* Step indicator */}
      <div className="create-tide__steps" aria-label="Progress">
        {[1, 2, 3].map((s) => (
          <span
            key={s}
            className={`create-tide__step ${step >= s ? "create-tide__step--active" : ""}`}
          >
            {s}
          </span>
        ))}
      </div>

      {/* Step 1: Type selection */}
      {step === 1 && (
        <div className="create-tide__step-content">
          <h3>What kind of tide?</h3>
          <div className="create-tide__type-grid">
            {TIDE_TYPES.map((type) => (
              <button
                key={type.key}
                className={`create-tide__type-card ${
                  formData.tideType === type.key ? "create-tide__type-card--selected" : ""
                }`}
                onClick={() => updateField("tideType", type.key)}
                aria-pressed={formData.tideType === type.key}
              >
                <span className="create-tide__type-icon">{type.icon}</span>
                <strong>{type.label}</strong>
                <p>{type.desc}</p>
              </button>
            ))}
          </div>
          <button
            className="btn btn--primary"
            onClick={() => setStep(2)}
            disabled={!formData.tideType}
          >
            Next →
          </button>
        </div>
      )}

      {/* Step 2: Details */}
      {step === 2 && (
        <div className="create-tide__step-content">
          <h3>Tide Details</h3>

          <label className="form-field">
            <span>Title *</span>
            <input
              type="text"
              value={formData.title}
              onChange={(e) => updateField("title", e.target.value)}
              placeholder="e.g. Portland Cichlid Swap Meet"
              maxLength={100}
            />
          </label>

          <label className="form-field">
            <span>Description</span>
            <textarea
              value={formData.description}
              onChange={(e) => updateField("description", e.target.value)}
              placeholder="What's this tide about?"
              rows={3}
              maxLength={500}
            />
          </label>

          <div className="create-tide__time-row">
            <label className="form-field">
              <span>Start Time *</span>
              <input
                type="datetime-local"
                value={formData.startTime}
                onChange={(e) => updateField("startTime", e.target.value)}
              />
            </label>
            <label className="form-field">
              <span>End Time *</span>
              <input
                type="datetime-local"
                value={formData.endTime}
                onChange={(e) => updateField("endTime", e.target.value)}
              />
            </label>
          </div>

          <label className="form-field">
            <span>Banner Image</span>
            <input type="file" accept="image/*" onChange={handleBannerSelect} />
            {formData.bannerPreview && (
              <img
                src={formData.bannerPreview}
                alt="Banner preview"
                className="create-tide__banner-preview"
              />
            )}
          </label>

          <div className="create-tide__nav-buttons">
            <button className="btn btn--ghost" onClick={() => setStep(1)}>← Back</button>
            <button
              className="btn btn--primary"
              onClick={() => setStep(3)}
              disabled={!formData.title || !formData.startTime || !formData.endTime}
            >
              Next →
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Type-specific settings + submit */}
      {step === 3 && (
        <div className="create-tide__step-content">
          <h3>Settings</h3>

          {/* Expo: GPS bounds */}
          {formData.tideType === "expo" && (
            <fieldset className="create-tide__fieldset">
              <legend>📍 Expo Zone (GPS)</legend>
              <div className="create-tide__gps-row">
                <label className="form-field">
                  <span>Latitude</span>
                  <input
                    type="number"
                    step="any"
                    value={formData.gpsLat}
                    onChange={(e) => updateField("gpsLat", e.target.value)}
                    placeholder="45.5231"
                  />
                </label>
                <label className="form-field">
                  <span>Longitude</span>
                  <input
                    type="number"
                    step="any"
                    value={formData.gpsLng}
                    onChange={(e) => updateField("gpsLng", e.target.value)}
                    placeholder="-122.6765"
                  />
                </label>
                <label className="form-field">
                  <span>Radius (km)</span>
                  <input
                    type="number"
                    step="0.1"
                    min="0.1"
                    value={formData.gpsRadius}
                    onChange={(e) => updateField("gpsRadius", e.target.value)}
                  />
                </label>
              </div>
            </fieldset>
          )}

          {/* Virtual: Stream URL */}
          {formData.tideType === "virtual" && (
            <label className="form-field">
              <span>🎥 Stream URL</span>
              <input
                type="url"
                value={formData.streamUrl}
                onChange={(e) => updateField("streamUrl", e.target.value)}
                placeholder="https://stream.cloudflare.com/..."
              />
            </label>
          )}

          {/* Challenge: Rules */}
          {formData.tideType === "challenge" && (
            <fieldset className="create-tide__fieldset">
              <legend>🏆 Challenge Config</legend>
              <label className="form-field">
                <span>Scoring Method</span>
                <select
                  value={formData.scoringMethod}
                  onChange={(e) => updateField("scoringMethod", e.target.value)}
                >
                  <option value="spawns">Most Spawns</option>
                  <option value="survival">Best Survival Rate</option>
                  <option value="votes">Community Votes</option>
                  <option value="streak">Longest Care Streak</option>
                </select>
              </label>
              <label className="form-field">
                <span>Target Species (optional)</span>
                <input
                  type="text"
                  value={formData.targetSpecies}
                  onChange={(e) => updateField("targetSpecies", e.target.value)}
                  placeholder="e.g. Corydoras sterbai"
                />
              </label>
              <label className="form-field">
                <span>Rules</span>
                <textarea
                  value={formData.challengeRules}
                  onChange={(e) => updateField("challengeRules", e.target.value)}
                  placeholder="Describe the challenge rules…"
                  rows={3}
                />
              </label>
            </fieldset>
          )}

          {/* General: Max attendees */}
          <label className="form-field">
            <span>Max Attendees (leave empty for unlimited)</span>
            <input
              type="number"
              min="1"
              value={formData.maxAttendees}
              onChange={(e) => updateField("maxAttendees", e.target.value)}
              placeholder="Unlimited"
            />
          </label>

          {/* Error */}
          {error && <p className="create-tide__error" role="alert">{error}</p>}

          {/* Submit */}
          <div className="create-tide__nav-buttons">
            <button className="btn btn--ghost" onClick={() => setStep(2)}>← Back</button>
            <button
              className="btn btn--primary"
              onClick={handleSubmit}
              disabled={submitting}
            >
              {submitting ? "Creating…" : "🌊 Create Tide"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

export default CreateTide;
