/**
 * shareCard.js — Generates branded shareable card images for social media.
 *
 * Creates visually rich PNG cards for:
 * - Achievement unlocks
 * - Spawn milestones
 * - Survival rate records
 * - Poseidon narrations
 *
 * Uses native Canvas API — no external dependencies.
 * Integrates with Web Share API for native sharing on mobile.
 */

const CARD_WIDTH = 600;
const CARD_HEIGHT = 340;

const BRAND = {
  bg: "#07050f",
  surface: "#0e0b1a",
  violet: "#a78bfa",
  emerald: "#34d399",
  blue: "#60a5fa",
  pink: "#f472b6",
  amber: "#fbbf24",
  text: "#f0eaff",
  muted: "#9b8ab8",
};

/**
 * Generate an achievement share card.
 * @param {{ icon, label, description, tier }} achievement
 * @param {{ totalXp, tierName, earned, total }} stats
 * @returns {Promise<Blob>} PNG blob
 */
export async function generateAchievementCard(achievement, stats = {}) {
  const canvas = createCanvas();
  const ctx = canvas.getContext("2d");

  drawBackground(ctx);
  drawBrandHeader(ctx, "ACHIEVEMENT UNLOCKED");

  // Achievement mark (large centered). icon is a public PNG path.
  ctx.textAlign = "center";
  const iconSrc = achievement.icon || "";
  if (iconSrc.startsWith("/") || /\.(png|webp|svg)$/i.test(iconSrc)) {
    try {
      const img = await loadImage(iconSrc);
      const size = 64;
      ctx.drawImage(img, (CARD_WIDTH - size) / 2, 92, size, size);
    } catch {
      ctx.font = "48px serif";
      ctx.fillText("🏆", CARD_WIDTH / 2, 140);
    }
  } else {
    ctx.font = "48px serif";
    ctx.fillText(iconSrc || "🏆", CARD_WIDTH / 2, 140);
  }

  // Achievement name
  ctx.font = "bold 22px 'Inter', sans-serif";
  ctx.fillStyle = getTierColor(achievement.tier);
  ctx.fillText(achievement.label || "Achievement", CARD_WIDTH / 2, 180);

  // Description
  ctx.font = "400 13px 'Inter', sans-serif";
  ctx.fillStyle = BRAND.muted;
  ctx.fillText(achievement.description || "", CARD_WIDTH / 2, 205);

  // Stats row
  ctx.font = "600 12px 'Inter', sans-serif";
  ctx.fillStyle = BRAND.text;
  const statsText = `${stats.earned || 0}/${stats.total || 17} Achievements · ${stats.totalXp || 0} XP · ${stats.tierName || "Shallow"}`;
  ctx.fillText(statsText, CARD_WIDTH / 2, 250);

  drawFooter(ctx);
  return canvasToBlob(canvas);
}

/**
 * Generate a spawn milestone share card.
 * @param {{ speciesName, spawnCount, totalOffspring, survivalRate }} data
 * @returns {Promise<Blob>}
 */
export async function generateSpawnMilestoneCard(data) {
  const canvas = createCanvas();
  const ctx = canvas.getContext("2d");

  drawBackground(ctx);
  drawBrandHeader(ctx, "SPAWN MILESTONE");

  // Main stat
  ctx.font = "bold 52px 'JetBrains Mono', monospace";
  ctx.textAlign = "center";
  ctx.fillStyle = BRAND.emerald;
  ctx.fillText(`${data.spawnCount}`, CARD_WIDTH / 2, 145);

  ctx.font = "600 14px 'Inter', sans-serif";
  ctx.fillStyle = BRAND.text;
  ctx.fillText("Successful Spawns", CARD_WIDTH / 2, 170);

  // Species
  if (data.speciesName) {
    ctx.font = "italic 13px 'Inter', sans-serif";
    ctx.fillStyle = BRAND.violet;
    ctx.fillText(data.speciesName, CARD_WIDTH / 2, 195);
  }

  // Stats row
  drawStatsRow(ctx, 230, [
    { label: "Total Fry", value: data.totalOffspring || 0, color: BRAND.blue },
    { label: "Best Survival", value: `${data.survivalRate || 0}%`, color: BRAND.emerald },
    { label: "Species Bred", value: data.speciesCount || 1, color: BRAND.amber },
  ]);

  drawFooter(ctx);
  return canvasToBlob(canvas);
}

/**
 * Generate a survival rate share card.
 * @param {{ spawnId, speciesName, survivalRate, fryCount, alive }} data
 * @returns {Promise<Blob>}
 */
export async function generateSurvivalCard(data) {
  const canvas = createCanvas();
  const ctx = canvas.getContext("2d");

  drawBackground(ctx);
  drawBrandHeader(ctx, "SURVIVAL RECORD");

  // Main percentage
  const color = data.survivalRate >= 90 ? BRAND.emerald : data.survivalRate >= 70 ? BRAND.amber : BRAND.pink;
  ctx.font = "bold 56px 'JetBrains Mono', monospace";
  ctx.textAlign = "center";
  ctx.fillStyle = color;
  ctx.fillText(`${data.survivalRate}%`, CARD_WIDTH / 2, 148);

  ctx.font = "600 14px 'Inter', sans-serif";
  ctx.fillStyle = BRAND.text;
  ctx.fillText("Fry Survival Rate", CARD_WIDTH / 2, 175);

  ctx.font = "italic 12px 'Inter', sans-serif";
  ctx.fillStyle = BRAND.violet;
  ctx.fillText(`${data.speciesName || "Unknown"} — Spawn #${String(data.spawnId || "").slice(-6)}`, CARD_WIDTH / 2, 198);

  drawStatsRow(ctx, 230, [
    { label: "Eggs", value: data.fryCount || 0, color: BRAND.amber },
    { label: "Alive", value: data.alive || 0, color: BRAND.emerald },
    { label: "Lost", value: (data.fryCount || 0) - (data.alive || 0), color: BRAND.pink },
  ]);

  drawFooter(ctx);
  return canvasToBlob(canvas);
}

/**
 * Generate a Poseidon narration share card.
 * @param {{ narration, speciesName, daysSinceSpawn }} data
 * @returns {Promise<Blob>}
 */
export async function generateNarrationCard(data) {
  const canvas = createCanvas();
  const ctx = canvas.getContext("2d");

  drawBackground(ctx);
  drawBrandHeader(ctx, "POSEIDON OBSERVES");

  // Poseidon quote
  ctx.font = "italic 15px 'Inter', sans-serif";
  ctx.fillStyle = "rgba(103, 232, 249, 0.9)";
  ctx.textAlign = "center";

  // Word wrap the narration
  const words = (data.narration || "").split(" ");
  let line = "";
  let y = 130;
  for (const word of words) {
    const test = line + word + " ";
    if (ctx.measureText(test).width > CARD_WIDTH - 80) {
      ctx.fillText(line.trim(), CARD_WIDTH / 2, y);
      line = word + " ";
      y += 22;
    } else {
      line = test;
    }
  }
  if (line.trim()) ctx.fillText(line.trim(), CARD_WIDTH / 2, y);

  // Attribution
  ctx.font = "500 11px 'Inter', sans-serif";
  ctx.fillStyle = BRAND.muted;
  ctx.fillText(`— Poseidon · ${data.speciesName || ""} · Day ${data.daysSinceSpawn || "?"}`, CARD_WIDTH / 2, y + 35);

  drawFooter(ctx);
  return canvasToBlob(canvas);
}

// ─── Share Utilities ────────────────────────────────────────────────────────

/**
 * Share a card image via Web Share API (or fallback to download).
 * @param {Blob} blob - PNG image blob
 * @param {string} title - Share title
 * @param {string} text - Share description
 */
export async function shareCardImage(blob, title, text) {
  const file = new File([blob], "aquacellum-share.png", { type: "image/png" });

  // Try Web Share API (mobile native sharing)
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({
        title,
        text: `${text}\n\n🌊 Bred on Aquacellum — aquacellum.xyz`,
        files: [file],
      });
      return { shared: true, method: "native" };
    } catch (err) {
      if (err.name === "AbortError") return { shared: false, method: "cancelled" };
    }
  }

  // Fallback: copy to clipboard if available
  if (navigator.clipboard && typeof ClipboardItem !== "undefined") {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob }),
      ]);
      return { shared: true, method: "clipboard" };
    } catch (err) {
      console.warn("Clipboard write failed:", err);
    }
  }

  // Final fallback: download
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.download = "aquacellum-share.png";
  link.href = url;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  return { shared: true, method: "download" };
}

// ─── Canvas Helpers ─────────────────────────────────────────────────────────

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load ${src}`));
    img.src = src;
  });
}

function createCanvas() {
  const canvas = document.createElement("canvas");
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  return canvas;
}

function drawBackground(ctx) {
  // Dark bg
  ctx.fillStyle = BRAND.bg;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  // Subtle grid
  ctx.strokeStyle = "rgba(139, 92, 246, 0.03)";
  ctx.lineWidth = 0.5;
  for (let x = 0; x < CARD_WIDTH; x += 30) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, CARD_HEIGHT); ctx.stroke();
  }
  for (let y = 0; y < CARD_HEIGHT; y += 30) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CARD_WIDTH, y); ctx.stroke();
  }

  // Corner glow
  const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, 200);
  grad.addColorStop(0, "rgba(139, 92, 246, 0.08)");
  grad.addColorStop(1, "transparent");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
}

function drawBrandHeader(ctx, label) {
  // Top accent line
  const grad = ctx.createLinearGradient(0, 0, CARD_WIDTH, 0);
  grad.addColorStop(0, BRAND.violet);
  grad.addColorStop(1, BRAND.emerald);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, CARD_WIDTH, 3);

  // Label
  ctx.font = "700 10px 'Inter', sans-serif";
  ctx.fillStyle = BRAND.violet;
  ctx.textAlign = "center";
  ctx.letterSpacing = "0.15em";
  ctx.fillText(label, CARD_WIDTH / 2, 35);
}

function drawFooter(ctx) {
  // Separator
  ctx.strokeStyle = "rgba(139, 92, 246, 0.15)";
  ctx.lineWidth = 0.5;
  ctx.beginPath(); ctx.moveTo(40, CARD_HEIGHT - 50); ctx.lineTo(CARD_WIDTH - 40, CARD_HEIGHT - 50); ctx.stroke();

  // Brand
  ctx.font = "600 10px 'Inter', sans-serif";
  ctx.fillStyle = BRAND.muted;
  ctx.textAlign = "center";
  ctx.fillText("🌊 aquacellum.xyz — Breed. Track. Prove.", CARD_WIDTH / 2, CARD_HEIGHT - 25);
}

function drawStatsRow(ctx, y, stats) {
  const gap = CARD_WIDTH / (stats.length + 1);
  stats.forEach((stat, i) => {
    const x = gap * (i + 1);
    ctx.font = "bold 18px 'JetBrains Mono', monospace";
    ctx.fillStyle = stat.color;
    ctx.textAlign = "center";
    ctx.fillText(String(stat.value), x, y);
    ctx.font = "400 10px 'Inter', sans-serif";
    ctx.fillStyle = BRAND.muted;
    ctx.fillText(stat.label, x, y + 16);
  });
}

function getTierColor(tier) {
  switch (tier) {
    case "gold": return "#ffd700";
    case "silver": return "#c0c0d2";
    case "bronze": return "#cd7f32";
    default: return BRAND.text;
  }
}

function canvasToBlob(canvas) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/png", 1.0);
  });
}
