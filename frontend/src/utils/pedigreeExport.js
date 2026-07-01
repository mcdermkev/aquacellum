/**
 * pedigreeExport.js — Generates a branded pedigree certificate image.
 *
 * Renders the lineage tree to an off-screen Canvas with:
 * - Aquacellum-branded header with gradient
 * - 3-generation pedigree layout
 * - Specimen details and breeder info
 * - QR-style verification hash
 * - Exports as downloadable PNG or triggers print dialog
 *
 * No external dependencies required — uses native Canvas API.
 */

const CERT_WIDTH = 1200;
const CERT_HEIGHT = 800;

// Brand colors
const COLORS = {
  bgDark: "#07050f",
  bgSurface: "#0e0b1a",
  violet: "#a78bfa",
  violetDark: "#7c3aed",
  emerald: "#34d399",
  blue: "#60a5fa",
  pink: "#f472b6",
  amber: "#fbbf24",
  textPrimary: "#f0eaff",
  textSecondary: "#9b8ab8",
  textMuted: "#4a3d6b",
  border: "rgba(139, 92, 246, 0.25)",
};

/**
 * Generate a pedigree certificate as a PNG data URL.
 * @param {Object} tree - { target, parents: { sire, dam }, grandparents: { sireSire, sireDam, damSire, damDam } }
 * @param {Object} options - { breederName, breederWallet, exportDate }
 * @returns {Promise<string>} PNG data URL
 */
export async function generatePedigreeCertificate(tree, options = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = CERT_WIDTH;
  canvas.height = CERT_HEIGHT;
  const ctx = canvas.getContext("2d");

  // Background
  ctx.fillStyle = COLORS.bgDark;
  ctx.fillRect(0, 0, CERT_WIDTH, CERT_HEIGHT);

  // Subtle grid pattern
  ctx.strokeStyle = "rgba(139, 92, 246, 0.04)";
  ctx.lineWidth = 0.5;
  for (let x = 0; x < CERT_WIDTH; x += 40) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, CERT_HEIGHT); ctx.stroke();
  }
  for (let y = 0; y < CERT_HEIGHT; y += 40) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CERT_WIDTH, y); ctx.stroke();
  }

  // Header gradient bar
  const headerGrad = ctx.createLinearGradient(0, 0, CERT_WIDTH, 0);
  headerGrad.addColorStop(0, "rgba(124, 58, 237, 0.3)");
  headerGrad.addColorStop(0.5, "rgba(139, 92, 246, 0.15)");
  headerGrad.addColorStop(1, "rgba(52, 211, 153, 0.2)");
  ctx.fillStyle = headerGrad;
  ctx.fillRect(0, 0, CERT_WIDTH, 80);

  // Header border
  ctx.strokeStyle = COLORS.border;
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, 80); ctx.lineTo(CERT_WIDTH, 80); ctx.stroke();

  // Title
  ctx.font = "bold 28px 'Inter', sans-serif";
  ctx.fillStyle = COLORS.textPrimary;
  ctx.textAlign = "left";
  ctx.fillText("PEDIGREE CERTIFICATE", 40, 50);

  // Subtitle
  ctx.font = "500 13px 'Inter', sans-serif";
  ctx.fillStyle = COLORS.textSecondary;
  ctx.fillText("Aquacellum Lineage Registry — Verified Ancestry Documentation", 40, 70);

  // Certificate number (top right)
  ctx.textAlign = "right";
  ctx.font = "600 14px 'JetBrains Mono', monospace";
  ctx.fillStyle = COLORS.violet;
  const certNum = `CERT #${tree.target?.id?.toString().padStart(3, "0") || "000"}`;
  ctx.fillText(certNum, CERT_WIDTH - 40, 45);

  // Date
  ctx.font = "400 11px 'Inter', sans-serif";
  ctx.fillStyle = COLORS.textMuted;
  const dateStr = options.exportDate || new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  ctx.fillText(`Issued: ${dateStr}`, CERT_WIDTH - 40, 65);

  // ─── Subject Info Block ────────────────────────────────────────────────────
  ctx.textAlign = "left";
  const infoY = 110;

  ctx.font = "bold 18px 'Inter', sans-serif";
  ctx.fillStyle = COLORS.textPrimary;
  ctx.fillText(tree.target?.speciesName || "Unknown Species", 40, infoY);

  if (tree.target?.scientificName) {
    ctx.font = "italic 13px 'Inter', sans-serif";
    ctx.fillStyle = COLORS.violet;
    ctx.fillText(tree.target.scientificName, 40, infoY + 22);
  }

  // Breeder info
  const breederName = options.breederName || (tree.target?.breeder ? `${tree.target.breeder.slice(0, 6)}...${tree.target.breeder.slice(-4)}` : "Unknown");
  ctx.font = "400 11px 'Inter', sans-serif";
  ctx.fillStyle = COLORS.textSecondary;
  ctx.fillText(`Registrant: ${breederName}`, 40, infoY + 44);

  const birthDate = tree.target?.birthTimestamp
    ? new Date(tree.target.birthTimestamp * 1000).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
    : "Unknown";
  ctx.fillText(`Hatch Date: ${birthDate}`, 40, infoY + 60);

  const statusLabels = ["Active", "Deceased", "Rehomed"];
  ctx.fillText(`Status: ${statusLabels[tree.target?.status] || "Unknown"}`, 280, infoY + 44);

  // ─── Pedigree Tree Layout ──────────────────────────────────────────────────
  const treeStartY = 200;
  const nodeW = 200;
  const nodeH = 70;
  const genGap = 180;

  // Column X positions (3 generations: Subject, Parents, Grandparents)
  const col0X = 60;
  const col1X = col0X + nodeW + genGap;
  const col2X = col1X + nodeW + genGap;

  // Row Y positions
  const targetY = treeStartY + 130; // centered
  const sireY = treeStartY + 40;
  const damY = treeStartY + 240;
  const gpYs = [treeStartY, treeStartY + 100, treeStartY + 200, treeStartY + 300];

  // Draw connectors
  const drawConnector = (fromX, fromY, toX, toY, color) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    const midX = (fromX + toX) / 2;
    ctx.moveTo(fromX, fromY);
    ctx.bezierCurveTo(midX, fromY, midX, toY, toX, toY);
    ctx.stroke();
    ctx.globalAlpha = 1;
  };

  // Target → Parents
  drawConnector(col0X + nodeW, targetY + nodeH / 2, col1X, sireY + nodeH / 2, COLORS.blue);
  drawConnector(col0X + nodeW, targetY + nodeH / 2, col1X, damY + nodeH / 2, COLORS.pink);

  // Sire → Grandparents
  if (tree.grandparents?.sireSire || tree.grandparents?.sireDam) {
    drawConnector(col1X + nodeW, sireY + nodeH / 2, col2X, gpYs[0] + nodeH / 2, COLORS.violet);
    drawConnector(col1X + nodeW, sireY + nodeH / 2, col2X, gpYs[1] + nodeH / 2, COLORS.violet);
  }
  // Dam → Grandparents
  if (tree.grandparents?.damSire || tree.grandparents?.damDam) {
    drawConnector(col1X + nodeW, damY + nodeH / 2, col2X, gpYs[2] + nodeH / 2, COLORS.violet);
    drawConnector(col1X + nodeW, damY + nodeH / 2, col2X, gpYs[3] + nodeH / 2, COLORS.violet);
  }

  // Draw node helper
  const drawNode = (x, y, node, label, accentColor) => {
    // Background
    ctx.fillStyle = "rgba(14, 11, 26, 0.9)";
    ctx.strokeStyle = node ? `${accentColor}88` : "rgba(75, 85, 99, 0.3)";
    ctx.lineWidth = 1;
    roundRect(ctx, x, y, nodeW, nodeH, 10);
    ctx.fill();
    ctx.stroke();

    // Top accent bar
    ctx.fillStyle = node ? accentColor : "rgba(75, 85, 99, 0.3)";
    ctx.globalAlpha = 0.7;
    ctx.fillRect(x + 1, y + 1, nodeW - 2, 3);
    ctx.globalAlpha = 1;

    if (!node) {
      // Empty node
      ctx.font = "600 10px 'Inter', sans-serif";
      ctx.fillStyle = COLORS.textMuted;
      ctx.textAlign = "left";
      ctx.fillText(label, x + 10, y + 28);
      ctx.font = "400 10px 'Inter', sans-serif";
      ctx.fillText("Unknown Ancestry", x + 10, y + 46);
      return;
    }

    // Label
    ctx.font = "700 9px 'Inter', sans-serif";
    ctx.fillStyle = accentColor;
    ctx.textAlign = "left";
    ctx.fillText(label.toUpperCase(), x + 10, y + 18);

    // Cert number
    ctx.textAlign = "right";
    ctx.font = "500 9px 'JetBrains Mono', monospace";
    ctx.fillStyle = COLORS.violet;
    ctx.fillText(`#${node.id?.toString().padStart(3, "0")}`, x + nodeW - 10, y + 18);

    // Species name
    ctx.textAlign = "left";
    ctx.font = "bold 12px 'Inter', sans-serif";
    ctx.fillStyle = COLORS.textPrimary;
    const name = (node.speciesName || "Unknown").substring(0, 22);
    ctx.fillText(name, x + 10, y + 38);

    // Scientific name
    if (node.scientificName) {
      ctx.font = "italic 9px 'Inter', sans-serif";
      ctx.fillStyle = "rgba(167, 139, 250, 0.6)";
      ctx.fillText(node.scientificName.substring(0, 28), x + 10, y + 52);
    }

    // Status badge
    const statusLabels = ["Active", "Deceased", "Rehomed"];
    const statusColors = [COLORS.emerald, "#f87171", COLORS.amber];
    ctx.font = "600 8px 'Inter', sans-serif";
    ctx.fillStyle = statusColors[node.status] || COLORS.textMuted;
    ctx.fillText(statusLabels[node.status] || "Unknown", x + 10, y + 65);
  };

  // Render nodes
  drawNode(col0X, targetY, tree.target, "Subject", COLORS.emerald);
  drawNode(col1X, sireY, tree.parents?.sire, "Sire", COLORS.blue);
  drawNode(col1X, damY, tree.parents?.dam, "Dam", COLORS.pink);
  drawNode(col2X, gpYs[0], tree.grandparents?.sireSire, "Sire's Sire", COLORS.violet);
  drawNode(col2X, gpYs[1], tree.grandparents?.sireDam, "Sire's Dam", COLORS.violet);
  drawNode(col2X, gpYs[2], tree.grandparents?.damSire, "Dam's Sire", COLORS.violet);
  drawNode(col2X, gpYs[3], tree.grandparents?.damDam, "Dam's Dam", COLORS.violet);

  // Generation labels
  ctx.font = "700 10px 'Inter', sans-serif";
  ctx.fillStyle = COLORS.textMuted;
  ctx.textAlign = "center";
  ctx.fillText("F0 — SUBJECT", col0X + nodeW / 2, treeStartY - 10);
  ctx.fillText("F1 — PARENTS", col1X + nodeW / 2, treeStartY - 10);
  ctx.fillText("F2 — GRANDPARENTS", col2X + nodeW / 2, treeStartY - 10);

  // ─── Footer ────────────────────────────────────────────────────────────────
  ctx.strokeStyle = COLORS.border;
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(40, CERT_HEIGHT - 60); ctx.lineTo(CERT_WIDTH - 40, CERT_HEIGHT - 60); ctx.stroke();

  ctx.font = "400 10px 'Inter', sans-serif";
  ctx.fillStyle = COLORS.textMuted;
  ctx.textAlign = "left";
  ctx.fillText("This certificate verifies the documented lineage of the above specimen.", 40, CERT_HEIGHT - 38);
  ctx.fillText("Generated by Aquacellum Lineage Registry — aquacellum.xyz", 40, CERT_HEIGHT - 22);

  // Verification hash (simple fingerprint)
  ctx.textAlign = "right";
  ctx.font = "500 9px 'JetBrains Mono', monospace";
  ctx.fillStyle = COLORS.violet;
  const hash = generateVerificationHash(tree);
  ctx.fillText(`Verify: ${hash}`, CERT_WIDTH - 40, CERT_HEIGHT - 30);

  return canvas.toDataURL("image/png", 1.0);
}

/**
 * Download the pedigree certificate as a PNG file.
 */
export async function downloadPedigreeCertificate(tree, options = {}) {
  const dataUrl = await generatePedigreeCertificate(tree, options);
  const link = document.createElement("a");
  link.download = `pedigree-cert-${tree.target?.id || "unknown"}.png`;
  link.href = dataUrl;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Open print dialog with the certificate.
 */
export async function printPedigreeCertificate(tree, options = {}) {
  const dataUrl = await generatePedigreeCertificate(tree, options);
  const printWindow = window.open("", "_blank");
  if (printWindow) {
    printWindow.document.write(`
      <html>
        <head><title>Pedigree Certificate #${tree.target?.id || "000"}</title></head>
        <body style="margin:0;padding:0;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#111;">
          <img src="${dataUrl}" style="max-width:100%;height:auto;" />
          <script>window.onload = function() { window.print(); }<\/script>
        </body>
      </html>
    `);
    printWindow.document.close();
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function generateVerificationHash(tree) {
  // Simple deterministic hash from tree data (not cryptographic, just visual)
  const str = JSON.stringify({
    id: tree.target?.id,
    sire: tree.parents?.sire?.id,
    dam: tree.parents?.dam?.id,
    ts: tree.target?.birthTimestamp,
  });
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16).toUpperCase().padStart(8, "0");
}
