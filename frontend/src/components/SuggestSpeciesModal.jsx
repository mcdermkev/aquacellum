import React, { useState } from 'react';
import { BreedersCouncil } from "./BreedersCouncil";

export default function SuggestSpeciesModal({
  isOpen,
  onClose,
  casualModeActive,
  onSubmit,
  walletAccount,
  suggestionsQuery,
  castVote,
  isVoting,
  promoteSpecies,
  isPromoting,
  CARE_LEVEL_STRINGS,
  marketplaceAddress
}) {
  const [activeTab, setActiveTab] = useState("council");
  const [formData, setFormData] = useState({
    scientificName: '',
    commonName: '',
    careLevel: 0,
    minTemp: 22.0,
    maxTemp: 28.0,
    minPh: 6.5,
    maxPh: 7.5,
    proofUrl: '',
    notes: ''
  });
  const [errors, setErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showNamiAlert, setShowNamiAlert] = useState(false);

  if (!isOpen) return null;

  const validate = () => {
    const newErrors = {};
    const scientificNameRegex = /^[A-Z][a-z]+ [a-z]+$/;
    
    if (!formData.scientificName.trim()) {
      newErrors.scientificName = "Scientific name is required.";
    } else if (!scientificNameRegex.test(formData.scientificName.trim())) {
      newErrors.scientificName = "Must follow binomial format (e.g. 'Paracheirodon innesi').";
    }
    
    if (!formData.commonName.trim()) {
      newErrors.commonName = "Common name is required.";
    }
    
    const minT = Number(formData.minTemp);
    const maxT = Number(formData.maxTemp);
    if (isNaN(minT) || isNaN(maxT) || minT >= maxT || minT < 0 || maxT > 45) {
      newErrors.temp = "Provide a valid temperature range (0 - 45 °C).";
    }
    
    const minP = Number(formData.minPh);
    const maxP = Number(formData.maxPh);
    if (isNaN(minP) || isNaN(maxP) || minP >= maxP || minP < 0 || maxP > 14) {
      newErrors.ph = "Provide a valid pH range (0.0 - 14.0).";
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;

    // Check for Tidecaller Interception
    const searchKeys = ["nami", "tidecaller"];
    const textToCheck = `${formData.commonName} ${formData.scientificName}`.toLowerCase();
    const isNamiSuggested = searchKeys.some(key => textToCheck.includes(key));
    
    if (isNamiSuggested) {
      setShowNamiAlert(true);
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmit(formData);
      onClose();
    } catch (err) {
      setErrors({ api: err.message || "Failed to submit species." });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(11, 37, 48, 0.45)', backdropFilter: 'blur(16px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 30000,
      padding: '1.5rem',
      overflowY: 'auto'
    }}>
      {showNamiAlert ? (
        <div className="glass-card" style={{
          maxWidth: "480px",
          width: "100%",
          padding: "2rem",
          background: "#ffffff",
          border: "1px solid rgba(56, 189, 248, 0.4)",
          borderRadius: "1rem",
          boxShadow: "var(--shadow-lg)",
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "1.25rem",
          animation: "shimmer 3s ease-in-out infinite",
          color: "var(--text-primary)"
        }}>
          <div style={{
            width: "64px",
            height: "64px",
            borderRadius: "50%",
            background: "rgba(56, 189, 248, 0.15)",
            border: "1px solid rgba(56, 189, 248, 0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "2rem",
            boxShadow: "none"
          }}>
            🌊
          </div>
          
          <h3 style={{ fontSize: "1.5rem", fontWeight: "800", color: "var(--accent-blue)", margin: 0 }}>
            Tidecaller Intervention
          </h3>
          
          <p style={{ fontSize: "0.90rem", color: "var(--text-secondary)", lineHeight: "1.6", margin: 0 }}>
            "Warning: The Tidecaller (Nami) belongs to the open oceans and cannot be registered in this physical tank containment catalog."
          </p>
          
          <button 
            onClick={() => {
              setShowNamiAlert(false);
              onClose();
            }} 
            className="btn-primary" 
            style={{ 
              padding: "0.5rem 1.5rem", 
              fontSize: "0.85rem",
              background: "var(--accent-blue-fill)",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              fontWeight: "bold",
              cursor: "pointer",
              boxShadow: "var(--shadow-md)" 
            }}
          >
            Dismiss
          </button>
        </div>
      ) : (
        <div style={{
          background: '#ffffff',
          border: '1px solid rgba(56, 189, 248, 0.25)',
          borderRadius: '1rem',
          padding: '2rem',
          maxWidth: (!casualModeActive && activeTab === 'council') ? '920px' : '540px',
          width: '100%',
          boxShadow: 'var(--shadow-lg)',
          display: 'flex', flexDirection: 'column', gap: '1.2rem',
          color: 'var(--text-primary)',
          backdropFilter: 'blur(12px)',
          maxHeight: '90vh',
          overflowY: 'auto',
          position: 'relative'
        }}>
          {/* Close button in top right */}
          <button 
            type="button"
            onClick={onClose}
            style={{
              position: 'absolute',
              top: '1.5rem',
              right: '1.5rem',
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: '1.25rem',
              transition: 'color 0.2s',
              zIndex: 10
            }}
            onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
            onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
          >
            ✕
          </button>

          <div>
            <h2 style={{ fontSize: '1.4rem', fontWeight: '800', margin: 0, color: 'var(--accent-blue)' }}>
              {casualModeActive ? "Suggest a Fish 🐠" : "Aquadex Breeders Council Portal"}
            </h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.2rem', marginBottom: '0.5rem' }}>
              {casualModeActive
                ? "Know a cool fish we're missing? Add it to our community catalog \u2014 it only takes a minute!"
                : "Review active species suggestions, cast curation votes, or propose new entries."}
            </p>
          </div>

          {/* Premium Segmented Switcher (Pro Mode only) */}
          {!casualModeActive && (
            <div style={{
              display: "inline-flex",
              background: "var(--bg-band)",
              border: "1px solid rgba(56, 189, 248, 0.15)",
              padding: "0.25rem",
              borderRadius: "50px",
              marginBottom: "1rem",
              width: "fit-content"
            }}>
              <button
                type="button"
                onClick={() => setActiveTab("council")}
                style={{
                  background: activeTab === "council" 
                    ? "linear-gradient(135deg, rgba(56, 189, 248, 0.15) 0%, rgba(14, 165, 233, 0.25) 100%)" 
                    : "transparent",
                  outline: "none",
                  borderRadius: "50px",
                  color: activeTab === "council" ? "var(--text-primary)" : "var(--text-secondary)",
                  padding: "0.45rem 1.25rem",
                  fontSize: "0.78rem",
                  fontWeight: "600",
                  cursor: "pointer",
                  transition: "all 0.25s ease",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.4rem",
                  border: activeTab === "council" ? "1px solid rgba(56, 189, 248, 0.3)" : "1px solid transparent",
                  boxShadow: activeTab === "council" ? "0 0 10px rgba(56, 189, 248, 0.15)" : "none"
                }}
              >
                🏛️ Active Proposals / Votes
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("propose")}
                style={{
                  background: activeTab === "propose" 
                    ? "linear-gradient(135deg, rgba(56, 189, 248, 0.15) 0%, rgba(14, 165, 233, 0.25) 100%)" 
                    : "transparent",
                  outline: "none",
                  borderRadius: "50px",
                  color: activeTab === "propose" ? "var(--text-primary)" : "var(--text-secondary)",
                  padding: "0.45rem 1.25rem",
                  fontSize: "0.78rem",
                  fontWeight: "600",
                  cursor: "pointer",
                  transition: "all 0.25s ease",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.4rem",
                  border: activeTab === "propose" ? "1px solid rgba(56, 189, 248, 0.3)" : "1px solid transparent",
                  boxShadow: activeTab === "propose" ? "0 0 10px rgba(56, 189, 248, 0.15)" : "none"
                }}
              >
                ⚡ Propose Catalog Entry
              </button>
            </div>
          )}

          {!casualModeActive && activeTab === "council" ? (
            <div style={{ flex: 1, minHeight: '300px' }}>
              <BreedersCouncil
                walletAccount={walletAccount}
                suggestionsQuery={suggestionsQuery}
                castVote={castVote}
                isVoting={isVoting}
                promoteSpecies={promoteSpecies}
                isPromoting={isPromoting}
                CARE_LEVEL_STRINGS={CARE_LEVEL_STRINGS}
                marketplaceAddress={marketplaceAddress}
                isModalView={true}
              />
            </div>
          ) : (
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--text-muted)', display: 'block', marginBottom: '0.25rem' }}>Scientific Name*</label>
                  <input 
                    type="text" 
                    placeholder="e.g. Paracheirodon innesi"
                    value={formData.scientificName}
                    onChange={e => setFormData({ ...formData, scientificName: e.target.value })}
                    style={{
                      width: '100%', background: 'rgba(var(--ink-rgb), 0.03)', border: '1px solid rgba(var(--ink-rgb), 0.15)',
                      padding: '0.45rem', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '0.85rem', outline: 'none'
                    }}
                  />
                  {errors.scientificName && <span style={{ color: 'var(--accent-red)', fontSize: '0.7rem' }}>{errors.scientificName}</span>}
                </div>
                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--text-muted)', display: 'block', marginBottom: '0.25rem' }}>Common Name*</label>
                  <input 
                    type="text" 
                    placeholder="e.g. Neon Tetra"
                    value={formData.commonName}
                    onChange={e => setFormData({ ...formData, commonName: e.target.value })}
                    style={{
                      width: '100%', background: 'rgba(var(--ink-rgb), 0.03)', border: '1px solid rgba(var(--ink-rgb), 0.15)',
                      padding: '0.45rem', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '0.85rem', outline: 'none'
                    }}
                  />
                  {errors.commonName && <span style={{ color: 'var(--accent-red)', fontSize: '0.7rem' }}>{errors.commonName}</span>}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '0.5rem' }}>
                <div>
                  <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.15rem' }}>Min Temp (°C)</label>
                  <input type="number" step="0.1" value={formData.minTemp} onChange={e => setFormData({...formData, minTemp: e.target.value})} style={{ width: '100%', background: 'rgba(var(--ink-rgb), 0.03)', border: '1px solid rgba(var(--ink-rgb), 0.15)', padding: '0.3rem', borderRadius: '4px', color: 'var(--text-primary)', fontSize: '0.8rem', outline: 'none' }} />
                </div>
                <div>
                  <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.15rem' }}>Max Temp (°C)</label>
                  <input type="number" step="0.1" value={formData.maxTemp} onChange={e => setFormData({...formData, maxTemp: e.target.value})} style={{ width: '100%', background: 'rgba(var(--ink-rgb), 0.03)', border: '1px solid rgba(var(--ink-rgb), 0.15)', padding: '0.3rem', borderRadius: '4px', color: 'var(--text-primary)', fontSize: '0.8rem', outline: 'none' }} />
                </div>
                <div>
                  <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.15rem' }}>Min pH</label>
                  <input type="number" step="0.1" value={formData.minPh} onChange={e => setFormData({...formData, minPh: e.target.value})} style={{ width: '100%', background: 'rgba(var(--ink-rgb), 0.03)', border: '1px solid rgba(var(--ink-rgb), 0.15)', padding: '0.3rem', borderRadius: '4px', color: 'var(--text-primary)', fontSize: '0.8rem', outline: 'none' }} />
                </div>
                <div>
                  <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.15rem' }}>Max pH</label>
                  <input type="number" step="0.1" value={formData.maxPh} onChange={e => setFormData({...formData, maxPh: e.target.value})} style={{ width: '100%', background: 'rgba(var(--ink-rgb), 0.03)', border: '1px solid rgba(var(--ink-rgb), 0.15)', padding: '0.3rem', borderRadius: '4px', color: 'var(--text-primary)', fontSize: '0.8rem', outline: 'none' }} />
                </div>
              </div>
              {(errors.temp || errors.ph) && <span style={{ color: 'var(--accent-red)', fontSize: '0.7rem' }}>{errors.temp || errors.ph}</span>}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '1rem' }}>
                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--text-muted)', display: 'block', marginBottom: '0.25rem' }}>Care Level</label>
                  <select 
                    value={formData.careLevel} 
                    onChange={e => setFormData({ ...formData, careLevel: Number(e.target.value) })}
                    style={{
                      width: '100%', background: '#ffffff', border: '1px solid rgba(var(--ink-rgb), 0.15)',
                      padding: '0.45rem', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '0.85rem', outline: 'none'
                    }}
                  >
                    <option value={0}>Easy</option>
                    <option value={1}>Intermediate</option>
                    <option value={2}>Advanced</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--text-muted)', display: 'block', marginBottom: '0.25rem' }}>Reference URL</label>
                  <input 
                    type="url" 
                    placeholder="e.g. FishBase/WoRMS link"
                    value={formData.proofUrl}
                    onChange={e => setFormData({ ...formData, proofUrl: e.target.value })}
                    style={{
                      width: '100%', background: 'rgba(var(--ink-rgb), 0.03)', border: '1px solid rgba(var(--ink-rgb), 0.15)',
                      padding: '0.45rem', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '0.85rem', outline: 'none'
                    }}
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--text-muted)', display: 'block', marginBottom: '0.25rem' }}>Ecology Notes</label>
                <textarea 
                  rows="2"
                  placeholder="Habitats, parameters, dietary patterns or compatibility suggestions..."
                  value={formData.notes}
                  onChange={e => setFormData({ ...formData, notes: e.target.value })}
                  style={{
                    width: '100%', background: 'rgba(var(--ink-rgb), 0.03)', border: '1px solid rgba(var(--ink-rgb), 0.15)',
                    padding: '0.45rem', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '0.85rem', resize: 'none', outline: 'none'
                  }}
                />
              </div>

              {errors.api && <span style={{ color: 'var(--accent-red)', fontSize: '0.75rem', textAlign: 'center' }}>{errors.api}</span>}

              <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                <button 
                  type="button" 
                  onClick={onClose} 
                  disabled={isSubmitting}
                  style={{ padding: '0.5rem 1.25rem', background: 'transparent', border: '1px solid rgba(var(--ink-rgb), 0.2)', borderRadius: '6px', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '0.85rem' }}
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  disabled={isSubmitting}
                  style={{
                    padding: '0.5rem 1.5rem',
                    background: 'var(--accent-blue-fill)',
                    border: 'none',
                    borderRadius: '6px',
                    color: '#fff',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                    boxShadow: 'var(--shadow-md)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem'
                  }}
                >
                  {isSubmitting ? 'Verifying...' : 'Submit Suggestion'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
