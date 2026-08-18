/**
 * CreateTide.jsx
 * 
 * Multi-step wizard for creating Tides.
 * Council members or School Elders can create.
 * Supports: Expo, Virtual, Challenge, and Auction tide types.
 */

import { useState, useEffect } from "react";
import { useCreateTide } from "../../hooks/useTides";
import { uploadImage } from "../../services/mediaUpload";
import { getCurrentWallet } from "../../services/supabaseClient";
import { loadOwnedSpecimens, specimenOptionLabel } from "../../utils/ownedSpecimens";
import { isSellerFiatReady } from "../../services/stripePayments";
import { formatUsdCents, parseUsdToCents } from "../../utils/money";

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

  // ── Auction lots ─────────────────────────────────────────────────────────
  // `formData.auctionItems` existed from the start but nothing ever wrote to it:
  // there was no UI for it anywhere in the wizard. So every auction tide was
  // created with `settings.auction_items: []`, and AuctionPanel correctly
  // reported "no lots configured" forever. Hosts could build an auction and then
  // had literally nothing to sell.
  //
  // Lots are chosen from the host's OWN registered specimens rather than typed as
  // raw token IDs, so a lot always points at a real certificate they hold and can
  // be shown with a proper name.
  const [ownedSpecimens, setOwnedSpecimens] = useState([]);
  const [specimensLoading, setSpecimensLoading] = useState(false);
  const [lotDraft, setLotDraft] = useState({ specimenId: "", reserve: "", notes: "" });
  const [lotError, setLotError] = useState(null);

  const createTide = useCreateTide();

  // null while unknown, so no warning flashes before the answer arrives.
  const [payoutsReady, setPayoutsReady] = useState(null);

  useEffect(() => {
    if (formData.tideType !== "auction") return;
    let cancelled = false;

    setSpecimensLoading(true);
    loadOwnedSpecimens(getCurrentWallet())
      .then((rows) => { if (!cancelled) setOwnedSpecimens(rows); })
      .catch((e) => console.warn("[CreateTide] could not load specimens:", e))
      .finally(() => { if (!cancelled) setSpecimensLoading(false); });

    isSellerFiatReady(getCurrentWallet())
      .then((ready) => { if (!cancelled) setPayoutsReady(!!ready); })
      .catch(() => { if (!cancelled) setPayoutsReady(false); });

    return () => { cancelled = true; };
  }, [formData.tideType]);

  const updateField = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const addLot = () => {
    setLotError(null);

    const spec = ownedSpecimens.find((s) => String(s.id) === String(lotDraft.specimenId));
    if (!spec) {
      setLotError("Pick which of your fish to auction.");
      return;
    }
    if (formData.auctionItems.some((i) => String(i.token_id) === String(spec.id))) {
      setLotError("That fish is already in this auction.");
      return;
    }

    // A reserve is optional; an unparseable one is not. Storing junk here would
    // land in the trigger's reserve check and reject every bid on the lot.
    let reserveCents = null;
    if (lotDraft.reserve.trim()) {
      const parsed = parseUsdToCents(lotDraft.reserve);
      if (parsed.error) {
        setLotError(parsed.error);
        return;
      }
      reserveCents = parsed.cents;
    }

    setFormData((prev) => ({
      ...prev,
      auctionItems: [
        ...prev.auctionItems,
        {
          token_id: spec.id,
          title: specimenOptionLabel(spec),
          species_name: spec.commonName || spec.scientificName || "",
          reserve_cents: reserveCents,
          notes: lotDraft.notes.trim() || null,
        },
      ],
    }));
    setLotDraft({ specimenId: "", reserve: "", notes: "" });
  };

  const removeLot = (tokenId) => {
    setFormData((prev) => ({
      ...prev,
      auctionItems: prev.auctionItems.filter((i) => String(i.token_id) !== String(tokenId)),
    }));
  };

  // ── Expo location ────────────────────────────────────────────────────────
  // Latitude/longitude are now required for an expo, so typing raw coordinates
  // cannot be the only way in. Both existing expos in production have
  // gps_bounds: null precisely because the fields were optional and unlabelled.
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState(null);

  const useMyLocation = () => {
    setLocateError(null);

    if (!navigator.geolocation) {
      setLocateError("This browser can't share a location — enter the coordinates by hand.");
      return;
    }

    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setFormData((prev) => ({
          ...prev,
          gpsLat: pos.coords.latitude.toFixed(6),
          gpsLng: pos.coords.longitude.toFixed(6),
        }));
        setLocating(false);
      },
      (err) => {
        setLocateError(
          err.code === err.PERMISSION_DENIED
            ? "Location permission denied — enter the coordinates by hand."
            : "Couldn't get a location — enter the coordinates by hand."
        );
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
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

      // An auction with no lots is not an auction. This is what shipped before:
      // the wizard happily created auction tides with an empty item list, and the
      // bidding panel had nothing to render.
      if (formData.tideType === "auction" && formData.auctionItems.length === 0) {
        throw new Error("Add at least one fish to auction before creating this tide.");
      }

      // An expo without a location can't render its map or gate check-in, and
      // both of those are the entire point of the type.
      if (formData.tideType === "expo") {
        if (!formData.gpsLat || !formData.gpsLng) {
          throw new Error("Set the meetup location so attendees can find it and check in.");
        }
        const lat = parseFloat(formData.gpsLat);
        const lng = parseFloat(formData.gpsLng);
        if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
          throw new Error("Latitude must be between -90 and 90.");
        }
        if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
          throw new Error("Longitude must be between -180 and 180.");
        }
      }

      // Upload banner if provided
      let bannerUrl = null;
      if (formData.bannerFile) {
        const { url, error: uploadError } = await uploadImage(formData.bannerFile);
        if (uploadError) throw new Error("Banner upload failed: " + uploadError);
        bannerUrl = url;
      }

      // Build GPS bounds for Expo tides (validated as required above, so this is
      // always populated for an expo rather than silently staying null).
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
                }${type.comingSoon ? " create-tide__type-card--coming-soon" : ""}`}
                onClick={() => !type.comingSoon && updateField("tideType", type.key)}
                aria-pressed={formData.tideType === type.key}
                aria-disabled={type.comingSoon}
                disabled={type.comingSoon}
              >
                <span className="create-tide__type-icon">{type.icon}</span>
                <strong>{type.label}</strong>
                {type.comingSoon && (
                  <span className="create-tide__coming-soon-badge">Coming Soon</span>
                )}
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
              <p className="create-tide__hint">
                Required — this places the meetup on the map and defines the area
                attendees can check in from.
              </p>
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={useMyLocation}
                disabled={locating}
              >
                {locating ? "Locating…" : "📍 Use my current location"}
              </button>
              {locateError && (
                <p className="create-tide__error" role="alert">{locateError}</p>
              )}
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

          {/* Auction: the lots */}
          {formData.tideType === "auction" && (
            <fieldset className="create-tide__fieldset">
              <legend>🔨 Auction Lots</legend>
              <p className="create-tide__hint">
                Choose which of your registered fish go up for bidding. Bids are in
                US dollars.
              </p>

              {/* Surfaced here rather than at settlement. An auction cannot be
                  settled until the host can receive payouts, so finding out after
                  running the event means a wasted auction and disappointed
                  bidders. */}
              {payoutsReady === false && (
                <p className="create-tide__warning">
                  ⚠️ Stripe payouts aren't set up yet. You can create this auction,
                  but you'll need to connect payouts before you can settle it and
                  charge the winners.
                </p>
              )}

              {formData.auctionItems.length > 0 && (
                <ul className="create-tide__lots">
                  {formData.auctionItems.map((lot) => (
                    <li key={lot.token_id} className="create-tide__lot">
                      <div className="create-tide__lot-info">
                        <strong>{lot.title}</strong>
                        <span className="text-muted">
                          {lot.reserve_cents
                            ? `Opening bid ${formatUsdCents(lot.reserve_cents, { showCents: false })}`
                            : "No reserve"}
                        </span>
                        {lot.notes && <span className="text-muted">{lot.notes}</span>}
                      </div>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => removeLot(lot.token_id)}
                        aria-label={`Remove ${lot.title} from the auction`}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {specimensLoading ? (
                <p className="text-muted">Loading your fish…</p>
              ) : ownedSpecimens.length === 0 ? (
                <p className="text-muted">
                  You don't have any registered fish yet. Register a specimen first,
                  then it can be auctioned here.
                </p>
              ) : (
                <div className="create-tide__lot-draft">
                  <label className="form-field">
                    <span>Fish</span>
                    <select
                      value={lotDraft.specimenId}
                      onChange={(e) => setLotDraft((d) => ({ ...d, specimenId: e.target.value }))}
                    >
                      <option value="">Choose a fish…</option>
                      {ownedSpecimens
                        .filter(
                          (s) =>
                            !formData.auctionItems.some(
                              (i) => String(i.token_id) === String(s.id)
                            )
                        )
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {specimenOptionLabel(s)}
                          </option>
                        ))}
                    </select>
                  </label>

                  <label className="form-field">
                    <span>Opening bid in USD (optional)</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={lotDraft.reserve}
                      onChange={(e) => setLotDraft((d) => ({ ...d, reserve: e.target.value }))}
                      placeholder="e.g. 25"
                    />
                  </label>

                  <label className="form-field">
                    <span>Lot notes (optional)</span>
                    <input
                      type="text"
                      value={lotDraft.notes}
                      onChange={(e) => setLotDraft((d) => ({ ...d, notes: e.target.value }))}
                      placeholder="e.g. proven breeder, 3 years old"
                      maxLength={140}
                    />
                  </label>

                  {lotError && <p className="create-tide__error" role="alert">{lotError}</p>}

                  <button
                    type="button"
                    className="btn btn--secondary btn--sm"
                    onClick={addLot}
                    disabled={!lotDraft.specimenId}
                  >
                    + Add lot
                  </button>
                </div>
              )}
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
