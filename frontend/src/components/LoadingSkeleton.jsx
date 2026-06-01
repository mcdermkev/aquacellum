import React from "react";

export function LoadingSkeleton({ variant = "gallery", count = 6 }) {
  // Gallery Card Skeleton
  const renderGalleryCard = (index) => (
    <div
      key={index}
      className="glass-card"
      style={{
        padding: "1.5rem",
        borderRadius: "var(--radius-md)",
        display: "flex",
        flexDirection: "column",
        gap: "1.25rem",
        height: "412px",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Image Placeholder */}
      <div
        className="shimmer-placeholder"
        style={{
          width: "100%",
          height: "12rem",
          borderRadius: "var(--radius-sm)",
        }}
      />
      {/* Title & Scientific name */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        <div
          className="shimmer-placeholder"
          style={{ width: "70%", height: "20px", borderRadius: "4px" }}
        />
        <div
          className="shimmer-placeholder"
          style={{ width: "50%", height: "14px", borderRadius: "4px" }}
        />
      </div>
      {/* Difficulty badge placeholder */}
      <div
        className="shimmer-placeholder"
        style={{ width: "30%", height: "22px", borderRadius: "50px" }}
      />
      {/* Parameters telemetry bars */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
        <div
          className="shimmer-placeholder"
          style={{ width: "90%", height: "10px", borderRadius: "4px" }}
        />
        <div
          className="shimmer-placeholder"
          style={{ width: "80%", height: "10px", borderRadius: "4px" }}
        />
      </div>
      {/* Bottom Button */}
      <div
        className="shimmer-placeholder"
        style={{
          width: "100%",
          height: "36px",
          borderRadius: "var(--radius-sm)",
          marginTop: "auto",
        }}
      />
    </div>
  );

  // Marketplace Card Skeleton
  const renderMarketplaceCard = (index) => (
    <div
      key={index}
      className="glass-card"
      style={{
        padding: "1.5rem",
        borderRadius: "var(--radius-md)",
        display: "flex",
        flexDirection: "column",
        gap: "1.25rem",
        height: "480px",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Image / Header Placeholder */}
      <div
        className="shimmer-placeholder"
        style={{
          width: "100%",
          height: "12rem",
          borderRadius: "var(--radius-sm)",
        }}
      />
      {/* Seller and Price Row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div
          className="shimmer-placeholder"
          style={{ width: "40%", height: "16px", borderRadius: "4px" }}
        />
        <div
          className="shimmer-placeholder"
          style={{ width: "30%", height: "24px", borderRadius: "4px" }}
        />
      </div>
      {/* Common & Scientific Name */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        <div
          className="shimmer-placeholder"
          style={{ width: "80%", height: "20px", borderRadius: "4px" }}
        />
        <div
          className="shimmer-placeholder"
          style={{ width: "60%", height: "14px", borderRadius: "4px" }}
        />
      </div>
      {/* Pedigree & Specs Badges */}
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <div
          className="shimmer-placeholder"
          style={{ width: "60px", height: "20px", borderRadius: "50px" }}
        />
        <div
          className="shimmer-placeholder"
          style={{ width: "80px", height: "20px", borderRadius: "50px" }}
        />
      </div>
      {/* Checkout Button */}
      <div
        className="shimmer-placeholder"
        style={{
          width: "100%",
          height: "40px",
          borderRadius: "var(--radius-sm)",
          marginTop: "auto",
        }}
      />
    </div>
  );

  // Tank List Card Skeleton
  const renderTankCard = (index) => (
    <div
      key={index}
      className="glass-card"
      style={{
        padding: "1.5rem",
        borderRadius: "var(--radius-md)",
        display: "flex",
        flexDirection: "column",
        gap: "1.25rem",
        minHeight: "220px",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Title, Type, and Location Row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", width: "60%" }}>
          <div
            className="shimmer-placeholder"
            style={{ width: "100%", height: "22px", borderRadius: "4px" }}
          />
          <div
            className="shimmer-placeholder"
            style={{ width: "60%", height: "14px", borderRadius: "4px" }}
          />
        </div>
        <div
          className="shimmer-placeholder"
          style={{ width: "80px", height: "24px", borderRadius: "50px" }}
        />
      </div>
      
      {/* Inhabitants & Volume Telemetry */}
      <div style={{ display: "flex", gap: "1.5rem" }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          <div
            className="shimmer-placeholder"
            style={{ width: "40%", height: "12px", borderRadius: "4px" }}
          />
          <div
            className="shimmer-placeholder"
            style={{ width: "80%", height: "18px", borderRadius: "4px" }}
          />
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          <div
            className="shimmer-placeholder"
            style={{ width: "40%", height: "12px", borderRadius: "4px" }}
          />
          <div
            className="shimmer-placeholder"
            style={{ width: "60%", height: "18px", borderRadius: "4px" }}
          />
        </div>
      </div>

      {/* Latest Logs Parameters */}
      <div
        className="shimmer-placeholder"
        style={{
          width: "100%",
          height: "36px",
          borderRadius: "var(--radius-sm)",
          marginTop: "0.5rem",
        }}
      />
    </div>
  );

  const getClassName = () => {
    if (variant === "tanks") return "";
    return variant === "marketplace" ? "loading-skeleton-grid-marketplace" : "loading-skeleton-grid-gallery";
  };

  const getStyle = () => {
    if (variant === "tanks") {
      return {
        display: "flex",
        flexDirection: "column",
        gap: "1.25rem",
        width: "100%"
      };
    }
    return {};
  };

  const cards = Array.from({ length: count });

  return (
    <div className={getClassName()} style={getStyle()}>
      {cards.map((_, idx) => {
        if (variant === "gallery") return renderGalleryCard(idx);
        if (variant === "marketplace") return renderMarketplaceCard(idx);
        if (variant === "tanks") return renderTankCard(idx);
        return renderGalleryCard(idx);
      })}
    </div>
  );
}
