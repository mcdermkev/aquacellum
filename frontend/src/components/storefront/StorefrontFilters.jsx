/**
 * StorefrontFilters.jsx — Filter/sort bar for storefront listings.
 * Supports filtering by type (all/specimen/batch) and sorting by price/date.
 */
import React from "react";
import { FunnelSimple, SortAscending } from "@phosphor-icons/react";

export function StorefrontFilters({
  filterType,
  setFilterType,
  sortBy,
  setSortBy,
  totalCount,
}) {
  const filterOptions = [
    { value: "all", label: "All Listings" },
    { value: "specimen", label: "Specimens" },
    { value: "batch", label: "Batches" },
  ];

  const sortOptions = [
    { value: "newest", label: "Newest" },
    { value: "price-asc", label: "Price: Low → High" },
    { value: "price-desc", label: "Price: High → Low" },
  ];

  return (
    <div className="sf-filters" role="toolbar" aria-label="Listing filters">
      {/* Filter pills */}
      <div className="sf-filters__pills" role="radiogroup" aria-label="Filter by type">
        {filterOptions.map((opt) => (
          <button
            key={opt.value}
            className={`sf-filters__pill ${filterType === opt.value ? "sf-filters__pill--active" : ""}`}
            onClick={() => setFilterType(opt.value)}
            role="radio"
            aria-checked={filterType === opt.value}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Sort dropdown */}
      <div className="sf-filters__right">
        <span className="sf-filters__count">{totalCount} listing{totalCount !== 1 ? "s" : ""}</span>
        <div className="sf-filters__sort">
          <SortAscending weight="bold" size={14} />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="sf-filters__sort-select"
            aria-label="Sort listings"
          >
            {sortOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
