# Aquacellum Curation Standard

This document defines the absolute "Golden Standard" for the Aquacellum decentralized curation system. All community submissions and catalog additions managed via `AquadexGovernance.sol` must strictly adhere to these validation rules to preserve data integrity and compatibility across the Aquadex Protocol.

---

## 1. Metric Scaling Rules

To optimize on-chain storage and eliminate floating-point arithmetic overhead in Solidity, all environmental and water chemistry metrics must be scaled to integers using a $10\times$ multiplier.

> [!IMPORTANT]
> - **Temperature Range**: Must be stored as $10\times$ scaled signed 16-bit integers (`int16`).
>   - *Example*: A temperature of $22.5\text{ °C}$ must be submitted as `225`.
>   - *Example*: A temperature of $28.0\text{ °C}$ must be submitted as `280`.
> - **pH Range**: Must be stored as $10\times$ scaled unsigned 8-bit integers (`uint8`).
>   - *Example*: A pH of $6.5$ must be submitted as `65`.
>   - *Example*: A pH of $7.8$ must be submitted as `78`.

---

## 2. Global Uniqueness & Deduplication

Decentralized submissions are prone to duplicates arising from variations in common names, regional terms, or minor spelling errors in scientific names.

> [!WARNING]
> - **FishBase specCode**: Every species submission must include its official global FishBase `specCode`. This numeric identifier serves as the primary unique key off-chain to reconcile duplicates and verify taxonomical classification before proposals are submitted to governance.
> - **Scientific Names**: Must be validated against the official FishBase taxonomic registry. Common names are secondary and should not be used as uniqueness keys.

---

## 3. Reference Template

When formatting new batches of species entries for indexing, follow the exact schema demonstrated in [fishbase_master.json](file:///c:/Users/mcder/Desktop/fish-dex-protocol/frontend/public/fishbase_master.json):

```json
{
  "specCode": 2001,
  "scientificName": "Paracheirodon innesi",
  "commonName": "Neon tetra",
  "tankMetrics": {
    "tempRangeCelsius": [22.0, 28.0],
    "phRange": [6.5, 7.5],
    "difficulty": "Intermediate"
  }
}
```
During the curation pipeline execution, the off-chain manifest [database_manifest.json](file:///c:/Users/mcder/Desktop/fish-dex-protocol/frontend/public/database_manifest.json) must be updated to track indices, counts, and IPFS metadata hash links.
