/**
 * pdfExport.js — Pedigree Certificate & Facility Summary PDF Generator
 * 
 * Generates professional, printable PDF documents for:
 * 1. Individual specimen pedigree certificates (landscape, single page)
 * 2. Facility summary reports (portrait, single page)
 * 
 * Uses jsPDF for rendering and qrcode for verification QR codes.
 */

import { jsPDF } from "jspdf";
import QRCode from "qrcode";

// ─── Constants ───────────────────────────────────────────────────────────────

const ACCENT_BLUE = [14, 165, 233];   // #0ea5e9
const DARK_TEXT = [30, 41, 59];        // #1e293b
const MUTED_TEXT = [100, 116, 139];    // #64748b
const LIGHT_LINE = [203, 213, 225];    // #cbd5e1
const WHITE = [255, 255, 255];
const WARNING_RED = [239, 68, 68];

const CARE_LEVELS = ["Unknown", "Easy", "Intermediate", "Advanced", "Expert"];

const CONTRACT_ADDRESS = "0x351ca8f34D94F29F6f865Afa419A636324473DeF";
const BASESCAN_BASE = "https://sepolia.basescan.org";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function truncateAddress(addr) {
  if (!addr) return "Unknown";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function formatDate(timestamp) {
  if (!timestamp || timestamp === 0) return "Unknown";
  return new Date(timestamp * 1000).toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric"
  });
}

function nodeLabel(node) {
  if (!node) return "Wild / Unregistered";
  return `#${node.id.toString().padStart(3, "0")} ${node.commonName || ""}`.trim();
}

/**
 * Calculate inbreeding coefficient from sire/dam data (mirrors SpawningWizard logic)
 */
function calculateCOI(spec, lineageTree) {
  if (!lineageTree || !lineageTree.sire || !lineageTree.dam) return 0;
  const sire = lineageTree.sire;
  const dam = lineageTree.dam;

  // Parent-offspring
  if (spec.sireId === dam.id || spec.damId === sire.id ||
      sire.id === dam.sireId || sire.id === dam.damId ||
      dam.id === sire.sireId || dam.id === sire.damId) {
    return 25;
  }
  // Full siblings
  if (sire.sireId > 0 && sire.sireId === dam.sireId && sire.damId > 0 && sire.damId === dam.damId) {
    return 25;
  }
  // Half siblings
  if ((sire.sireId > 0 && sire.sireId === dam.sireId) || (sire.damId > 0 && sire.damId === dam.damId)) {
    return 12.5;
  }
  return 0;
}

async function generateQRDataUrl(text) {
  try {
    return await QRCode.toDataURL(text, { width: 100, margin: 1, color: { dark: "#1e293b", light: "#ffffff" } });
  } catch {
    return null;
  }
}

// ─── Pedigree Certificate ────────────────────────────────────────────────────

/**
 * Generate a landscape pedigree certificate PDF for a specimen.
 * 
 * @param {Object} params
 * @param {Object} params.spec - Specimen data { specimenId, speciesId, sireId, damId, breeder, birthTimestamp, currentTankId, owner }
 * @param {Object} params.speciesInfo - { commonName, scientificName, careLevel, minTemp, maxTemp, minPh, maxPh }
 * @param {Object|null} params.tankInfo - { id, name, facility, room, rack }
 * @param {Object|null} params.lineageTree - 3-gen tree { sire, dam, sireSire, sireDam, damSire, damDam, ... }
 * @param {Object|null} params.metadata - Cached metadata with attributes (snapped params)
 * @param {string|null} params.photoDataUrl - Base64 photo data URL
 * @param {string|null} params.mintTxHash - Transaction hash of the mint
 */
export async function generatePedigreeCertificate({
  spec,
  speciesInfo,
  tankInfo,
  lineageTree,
  metadata,
  photoDataUrl,
  mintTxHash
}) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "letter" });
  const pageW = doc.internal.pageSize.getWidth();   // ~279mm
  const pageH = doc.internal.pageSize.getHeight();  // ~216mm
  const margin = 12;

  // ── Header Strip ──
  doc.setFillColor(...ACCENT_BLUE);
  doc.rect(0, 0, pageW, 2, "F");

  // Logo text
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...ACCENT_BLUE);
  doc.text("AQUADEX", margin, 12);

  // Title
  doc.setFontSize(14);
  doc.setTextColor(...DARK_TEXT);
  doc.text("CERTIFICATE OF PROVENANCE", pageW / 2, 12, { align: "center" });

  // Doc ID + date
  doc.setFontSize(7);
  doc.setTextColor(...MUTED_TEXT);
  doc.text(`Cert #${spec.specimenId.toString().padStart(3, "0")} • ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}`, pageW - margin, 12, { align: "right" });

  // Accent line
  doc.setDrawColor(...LIGHT_LINE);
  doc.setLineWidth(0.3);
  doc.line(margin, 16, pageW - margin, 16);

  // ── Specimen Identity Block (left 55%) ──
  const identityX = margin;
  const identityW = (pageW - margin * 2) * 0.55;
  let y = 24;

  // Photo (top-right of identity block)
  const photoSize = 30;
  if (photoDataUrl) {
    try {
      doc.addImage(photoDataUrl, "JPEG", identityX + identityW - photoSize - 2, y - 2, photoSize, photoSize);
    } catch {
      // Photo failed to embed, skip silently
    }
  }

  // Common name
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(...DARK_TEXT);
  doc.text(speciesInfo.commonName || "Unknown Species", identityX, y + 4);
  y += 8;

  // Scientific name
  doc.setFont("helvetica", "italic");
  doc.setFontSize(10);
  doc.setTextColor(...MUTED_TEXT);
  doc.text(speciesInfo.scientificName || "", identityX, y + 4);
  y += 10;

  // Details table
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);

  const details = [
    ["Cert Serial No.", `#${spec.specimenId.toString().padStart(3, "0")}`],
    ["Species ID", `${spec.speciesId}`],
    ["Birth Date", formatDate(spec.birthTimestamp)],
    ["Breeder", truncateAddress(spec.breeder)],
    ["Owner", truncateAddress(spec.owner)],
    ["Care Level", CARE_LEVELS[speciesInfo.careLevel] || "Unknown"],
  ];

  if (tankInfo) {
    details.push(["Containment", `${tankInfo.name} (${tankInfo.facility} › ${tankInfo.room} › ${tankInfo.rack})`]);
  }

  for (const [label, value] of details) {
    doc.setTextColor(...MUTED_TEXT);
    doc.text(`${label}:`, identityX, y + 4);
    doc.setTextColor(...DARK_TEXT);
    doc.text(value, identityX + 32, y + 4);
    y += 5.5;
  }

  // ── Ancestry Tree (right 45%) ──
  const treeX = identityX + identityW + 8;
  const treeW = pageW - margin - treeX;
  let treeY = 20;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...DARK_TEXT);
  doc.text("3-GENERATION PEDIGREE", treeX, treeY);
  treeY += 6;

  // COI badge
  const coi = calculateCOI(spec, lineageTree);
  doc.setFontSize(7);
  if (coi > 0) {
    doc.setTextColor(...WARNING_RED);
    doc.text(`COI: ${coi}% ⚠`, treeX + 55, treeY - 6);
  } else {
    doc.setTextColor(34, 197, 94);
    doc.text(`COI: 0% (Safe)`, treeX + 55, treeY - 6);
  }

  // Draw the tree
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);

  const colWidth = treeW / 4;
  const rowH = 9;

  // Gen 3 (great-grandparents) — 8 rows
  const gen3 = [
    lineageTree?.sireSireSire, lineageTree?.sireSireDam,
    lineageTree?.sireDamSire, lineageTree?.sireDamDam,
    lineageTree?.damSireSire, lineageTree?.damSireDam,
    lineageTree?.damDamSire, lineageTree?.damDamDam,
  ];

  // Gen 2 (grandparents) — 4 rows
  const gen2 = [
    lineageTree?.sireSire, lineageTree?.sireDam,
    lineageTree?.damSire, lineageTree?.damDam,
  ];

  // Gen 1 (parents) — 2 rows
  const gen1 = [lineageTree?.sire, lineageTree?.dam];

  // Render gen 3 (rightmost column)
  const gen3X = treeX + colWidth * 3;
  for (let i = 0; i < 8; i++) {
    const nodeY = treeY + i * rowH;
    doc.setTextColor(...MUTED_TEXT);
    doc.setFontSize(5);
    doc.text(i % 2 === 0 ? "♂" : "♀", gen3X, nodeY + 3);
    doc.setTextColor(...DARK_TEXT);
    doc.setFontSize(6);
    doc.text(nodeLabel(gen3[i]), gen3X + 3, nodeY + 3);
  }

  // Render gen 2
  const gen2X = treeX + colWidth * 2;
  for (let i = 0; i < 4; i++) {
    const nodeY = treeY + i * rowH * 2 + rowH * 0.5;
    doc.setTextColor(...MUTED_TEXT);
    doc.setFontSize(5);
    doc.text(i % 2 === 0 ? "♂" : "♀", gen2X, nodeY + 3);
    doc.setTextColor(...DARK_TEXT);
    doc.setFontSize(7);
    doc.text(nodeLabel(gen2[i]), gen2X + 3, nodeY + 3);
    // Connector lines
    doc.setDrawColor(...LIGHT_LINE);
    doc.setLineWidth(0.2);
    doc.line(gen2X + colWidth - 2, nodeY + 1, gen3X - 1, treeY + i * 2 * rowH + 3);
    doc.line(gen2X + colWidth - 2, nodeY + 1, gen3X - 1, treeY + (i * 2 + 1) * rowH + 3);
  }

  // Render gen 1
  const gen1X = treeX + colWidth;
  for (let i = 0; i < 2; i++) {
    const nodeY = treeY + i * rowH * 4 + rowH * 1.5;
    doc.setTextColor(...MUTED_TEXT);
    doc.setFontSize(5);
    doc.text(i === 0 ? "♂ SIRE" : "♀ DAM", gen1X, nodeY + 3);
    doc.setTextColor(...DARK_TEXT);
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.text(nodeLabel(gen1[i]), gen1X + 3, nodeY + 7);
    doc.setFont("helvetica", "normal");
    // Connector lines
    doc.setDrawColor(...LIGHT_LINE);
    doc.line(gen1X + colWidth - 2, nodeY + 4, gen2X - 1, treeY + i * 4 * rowH + rowH * 0.5 + 3);
    doc.line(gen1X + colWidth - 2, nodeY + 4, gen2X - 1, treeY + (i * 2 + 1) * rowH * 2 + rowH * 0.5 + 3);
  }

  // Specimen node (leftmost)
  const specNodeY = treeY + rowH * 3;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...ACCENT_BLUE);
  doc.text(`#${spec.specimenId.toString().padStart(3, "0")}`, treeX, specNodeY + 3);
  doc.setFontSize(7);
  doc.setTextColor(...DARK_TEXT);
  doc.text(speciesInfo.commonName || "", treeX, specNodeY + 7);
  // Connectors to parents
  doc.setDrawColor(...ACCENT_BLUE);
  doc.setLineWidth(0.3);
  doc.line(treeX + 18, specNodeY + 4, gen1X - 1, treeY + rowH * 1.5 + 5);
  doc.line(treeX + 18, specNodeY + 4, gen1X - 1, treeY + rowH * 5.5 + 5);

  // ── Water Parameters at Registration (if available) ──
  let paramsY = y + 8;
  const snappedAttrs = metadata?.attributes?.filter(a => a.trait_type?.startsWith("Snapped")) || [];
  if (snappedAttrs.length > 0) {
    doc.setDrawColor(...LIGHT_LINE);
    doc.line(identityX, paramsY, identityX + identityW, paramsY);
    paramsY += 5;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(...DARK_TEXT);
    doc.text("WATER PARAMETERS AT REGISTRATION", identityX, paramsY);
    paramsY += 5;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    for (const attr of snappedAttrs) {
      const label = attr.trait_type.replace("Snapped ", "");
      doc.setTextColor(...MUTED_TEXT);
      doc.text(`${label}:`, identityX, paramsY);
      doc.setTextColor(...DARK_TEXT);
      doc.text(attr.value, identityX + 22, paramsY);
      paramsY += 4.5;
    }
  }

  // ── Verification Footer ──
  const footerY = pageH - 18;
  doc.setDrawColor(...LIGHT_LINE);
  doc.setLineWidth(0.3);
  doc.line(margin, footerY, pageW - margin, footerY);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(6);
  doc.setTextColor(...MUTED_TEXT);

  const tokenLine = `Token ID: ${spec.specimenId} • Contract: ${CONTRACT_ADDRESS}`;
  doc.text(tokenLine, margin, footerY + 5);

  if (mintTxHash) {
    doc.text(`Mint TX: ${mintTxHash}`, margin, footerY + 9);
  }

  doc.text("Verified on Base L2 • Aquadex Protocol • aquacellum.com", margin, footerY + 13);

  // QR Code (bottom-right)
  const verifyUrl = mintTxHash
    ? `${BASESCAN_BASE}/tx/${mintTxHash}`
    : `${BASESCAN_BASE}/address/${CONTRACT_ADDRESS}`;

  const qrDataUrl = await generateQRDataUrl(verifyUrl);
  if (qrDataUrl) {
    try {
      doc.addImage(qrDataUrl, "PNG", pageW - margin - 22, footerY - 8, 22, 22);
      doc.setFontSize(5);
      doc.text("Scan to verify", pageW - margin - 22, footerY + 15);
    } catch {
      // QR embed failed, skip
    }
  }

  // ── Save ──
  const fileName = `Aquadex_Pedigree_${spec.specimenId.toString().padStart(3, "0")}_${speciesInfo.commonName?.replace(/\s+/g, "_") || "Specimen"}.pdf`;
  doc.save(fileName);
}

// ─── Facility Summary ────────────────────────────────────────────────────────

/**
 * Generate a portrait facility summary PDF.
 * 
 * @param {Object} params
 * @param {Array} params.tanks - Array of tank objects
 * @param {string} params.ownerAddress - Wallet address
 * @param {Array} params.recentSpawns - Last 5 spawn records [{ speciesName, eggCount, date }]
 */
export async function generateFacilitySummary({ tanks, ownerAddress, recentSpawns = [] }) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "letter" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 15;
  let y = 12;

  // Header
  doc.setFillColor(...ACCENT_BLUE);
  doc.rect(0, 0, pageW, 2, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...ACCENT_BLUE);
  doc.text("AQUADEX", margin, y);

  doc.setFontSize(14);
  doc.setTextColor(...DARK_TEXT);
  doc.text("FACILITY SUMMARY REPORT", pageW / 2, y, { align: "center" });

  doc.setFontSize(7);
  doc.setTextColor(...MUTED_TEXT);
  doc.text(new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }), pageW - margin, y, { align: "right" });

  y += 6;
  doc.setDrawColor(...LIGHT_LINE);
  doc.setLineWidth(0.3);
  doc.line(margin, y, pageW - margin, y);
  y += 8;

  // Owner info
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED_TEXT);
  doc.text("Facility Owner:", margin, y);
  doc.setTextColor(...DARK_TEXT);
  doc.setFont("helvetica", "bold");
  doc.text(ownerAddress || "Unknown", margin + 28, y);
  y += 8;

  // Unit counts
  const tankCount = tanks.filter(t => t.containment === 0).length;
  const tubCount = tanks.filter(t => t.containment === 1).length;
  const basketCount = tanks.filter(t => t.containment === 2).length;
  const totalVolume = tanks.reduce((sum, t) => sum + (t.volumeLiters || 0), 0);
  const totalSpecimens = tanks.reduce((sum, t) => sum + (t.specimens?.length || 0), 0);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...DARK_TEXT);
  doc.text("OVERVIEW", margin, y);
  y += 6;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  const overviewRows = [
    ["Total Units", `${tanks.length}`],
    ["Tanks / Tubs / Baskets", `${tankCount} / ${tubCount} / ${basketCount}`],
    ["Total Volume", `${totalVolume.toLocaleString()} L (${(totalVolume * 0.264172).toFixed(0)} gal)`],
    ["Active Specimens", `${totalSpecimens}`],
  ];

  for (const [label, value] of overviewRows) {
    doc.setTextColor(...MUTED_TEXT);
    doc.text(label, margin, y);
    doc.setTextColor(...DARK_TEXT);
    doc.text(value, margin + 45, y);
    y += 5;
  }
  y += 6;

  // Rack breakdown table
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...DARK_TEXT);
  doc.text("RACK BREAKDOWN", margin, y);
  y += 6;

  // Group by rack
  const rackGroups = {};
  for (const tank of tanks) {
    const rack = tank.rack || "Unassigned";
    if (!rackGroups[rack]) rackGroups[rack] = { units: 0, volume: 0, alerts: 0 };
    rackGroups[rack].units++;
    rackGroups[rack].volume += tank.volumeLiters || 0;
    if (tank.latestLog) {
      const nh3 = Number(tank.latestLog.ammoniaPpmX100 || 0) / 100;
      const no2 = Number(tank.latestLog.nitritePpmX100 || 0) / 100;
      if (nh3 > 0.05 || no2 > 0.05) rackGroups[rack].alerts++;
    }
  }

  // Table header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(...MUTED_TEXT);
  doc.text("Rack", margin, y);
  doc.text("Units", margin + 50, y);
  doc.text("Volume (L)", margin + 65, y);
  doc.text("Alerts", margin + 90, y);
  y += 4;
  doc.setDrawColor(...LIGHT_LINE);
  doc.line(margin, y, pageW - margin, y);
  y += 4;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  for (const [rack, data] of Object.entries(rackGroups)) {
    doc.setTextColor(...DARK_TEXT);
    doc.text(rack, margin, y);
    doc.text(`${data.units}`, margin + 50, y);
    doc.text(`${data.volume.toLocaleString()}`, margin + 65, y);
    if (data.alerts > 0) {
      doc.setTextColor(...WARNING_RED);
      doc.text(`${data.alerts} ⚠`, margin + 90, y);
    } else {
      doc.setTextColor(34, 197, 94);
      doc.text("OK", margin + 90, y);
    }
    y += 5;
  }
  y += 8;

  // Recent spawns
  if (recentSpawns.length > 0) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...DARK_TEXT);
    doc.text("RECENT SPAWNS", margin, y);
    y += 6;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    for (const spawn of recentSpawns.slice(0, 5)) {
      doc.setTextColor(...DARK_TEXT);
      doc.text(`${spawn.speciesName || "Unknown"} — ${spawn.eggCount} eggs — ${spawn.date || "Unknown date"}`, margin, y);
      y += 4.5;
    }
  }

  // Footer
  const footerY = doc.internal.pageSize.getHeight() - 12;
  doc.setDrawColor(...LIGHT_LINE);
  doc.line(margin, footerY, pageW - margin, footerY);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6);
  doc.setTextColor(...MUTED_TEXT);
  doc.text("Aquadex Protocol • aquacellum.com • Generated from local facility registry", margin, footerY + 5);

  // Save
  const fileName = `Aquadex_Facility_Summary_${new Date().toISOString().split("T")[0]}.pdf`;
  doc.save(fileName);
}

// ─── Tank QR Label (printable sticker) ───────────────────────────────────────

/**
 * Generate a small printable QR label PDF for a tank/rack unit.
 * Designed to be printed on standard label paper (2" x 1.5" per label, 4-up on a page).
 * 
 * @param {Object} params
 * @param {number} params.tankId
 * @param {string} params.tankName
 * @param {string} params.facility
 * @param {string} params.room
 * @param {string} params.rack
 * @param {number} params.volumeLiters
 * @param {string} params.containment - "Tank" | "Tub" | "Basket"
 */
export async function generateTankQRLabel({ tankId, tankName, facility, room, rack, volumeLiters, containment }) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: [76, 51] }); // ~3" x 2" label
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 4;

  // Background
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, pageW, pageH, "F");

  // QR Code (left side)
  const deepLink = `https://aquacellum.com/app#tank=${tankId}`;
  const qrDataUrl = await generateQRDataUrl(deepLink);
  const qrSize = 28;
  if (qrDataUrl) {
    try {
      doc.addImage(qrDataUrl, "PNG", margin, margin, qrSize, qrSize);
    } catch {
      // QR failed, draw placeholder
      doc.setDrawColor(200, 200, 200);
      doc.rect(margin, margin, qrSize, qrSize);
    }
  }

  // Text (right side of QR)
  const textX = margin + qrSize + 4;
  let y = margin + 2;

  // Tank name
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...DARK_TEXT);
  doc.text(tankName || `Unit #${tankId}`, textX, y);
  y += 4;

  // Containment type + volume
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6);
  doc.setTextColor(...MUTED_TEXT);
  doc.text(`${containment || "Tank"} • ${volumeLiters || 0}L`, textX, y);
  y += 3.5;

  // Location path
  doc.text(`${facility || ""} › ${room || ""} › ${rack || ""}`, textX, y);
  y += 3.5;

  // ID
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(...ACCENT_BLUE);
  doc.text(`ID: ${tankId}`, textX, y);

  // Bottom strip — Aquadex branding
  doc.setFont("helvetica", "normal");
  doc.setFontSize(4.5);
  doc.setTextColor(...MUTED_TEXT);
  doc.text("aquacellum.com • Aquadex Protocol", margin, pageH - 2);

  // Border
  doc.setDrawColor(...LIGHT_LINE);
  doc.setLineWidth(0.3);
  doc.roundedRect(0.5, 0.5, pageW - 1, pageH - 1, 2, 2);

  // Save
  const fileName = `Aquadex_QR_Label_Unit_${tankId}.pdf`;
  doc.save(fileName);
}
