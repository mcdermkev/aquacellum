import React, { useState, useRef, useEffect } from "react";

/**
 * PedigreeTree — Interactive SVG-based pedigree visualization.
 *
 * Renders a 3-generation family tree with:
 * - Smooth cubic Bézier SVG path connectors
 * - Gradient-filled generation nodes with color coding (sire=blue, dam=pink, target=emerald)
 * - Hover tooltips with specimen details
 * - Click to expand/collapse branches
 * - Responsive layout that scales from mobile to desktop
 * - Animated entrance transitions
 *
 * Props:
 *   tree: { target, parents: { sire, dam }, grandparents: { sireSire, sireDam, damSire, damDam } }
 *   onNodeClick: (node) => void — optional callback when a node is clicked
 *   onExport: () => void — optional callback to trigger PDF export
 */

// ─── Node Layout Constants ─────────────────────────────────────────────────
const NODE_WIDTH = 180;
const NODE_HEIGHT = 90;
const NODE_RADIUS = 12;
const GENERATION_GAP = 220;
const VERTICAL_SPACING = 24;

// Generation colors
const COLORS = {
  target: { gradient: ["#34d399", "#06b6d4"], border: "rgba(52,211,153,0.5)", glow: "rgba(52,211,153,0.15)" },
  sire: { gradient: ["#60a5fa", "#3b82f6"], border: "rgba(96,165,250,0.5)", glow: "rgba(96,165,250,0.12)" },
  dam: { gradient: ["#f472b6", "#a855f7"], border: "rgba(244,114,182,0.5)", glow: "rgba(244,114,182,0.12)" },
  grandparent: { gradient: ["#a78bfa", "#7c3aed"], border: "rgba(167,139,250,0.4)", glow: "rgba(167,139,250,0.08)" },
  unknown: { gradient: ["#4b5563", "#374151"], border: "rgba(75,85,99,0.4)", glow: "none" },
};

// ─── Tooltip Component ──────────────────────────────────────────────────────
function Tooltip({ node, position }) {
  if (!node) return null;

  const formatDate = (ts) => {
    if (!ts || ts === 0) return "Wild-Caught / Unknown";
    return new Date(ts * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  return (
    <div
      className="pedigree-tooltip"
      style={{
        position: "absolute",
        left: position.x,
        top: position.y - 10,
        transform: "translate(-50%, -100%)",
        background: "rgba(15, 12, 31, 0.97)",
        backdropFilter: "blur(16px)",
        border: "1px solid rgba(167, 139, 250, 0.3)",
        borderRadius: "12px",
        padding: "12px 16px",
        minWidth: "200px",
        maxWidth: "280px",
        zIndex: 1000,
        pointerEvents: "none",
        boxShadow: "0 20px 40px rgba(0,0,0,0.5), 0 0 20px rgba(139,92,246,0.1)",
        animation: "tooltip-appear 0.2s ease-out",
      }}
    >
      <div style={{ fontSize: "0.65rem", color: "var(--text-muted, #6b7280)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px" }}>
        Certificate #{node.id?.toString().padStart(3, "0")}
      </div>
      <div style={{ fontSize: "0.9rem", fontWeight: "700", color: "#fff", marginBottom: "2px" }}>
        {node.speciesName || "Unknown Species"}
      </div>
      {node.scientificName && (
        <div style={{ fontSize: "0.72rem", fontStyle: "italic", color: "rgba(167,139,250,0.8)", marginBottom: "6px" }}>
          {node.scientificName}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 12px", marginTop: "8px", borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "8px" }}>
        <div>
          <div style={{ fontSize: "0.58rem", color: "var(--text-muted, #6b7280)", textTransform: "uppercase" }}>Hatched</div>
          <div style={{ fontSize: "0.7rem", color: "#e0e0e0" }}>{formatDate(node.birthTimestamp)}</div>
        </div>
        <div>
          <div style={{ fontSize: "0.58rem", color: "var(--text-muted, #6b7280)", textTransform: "uppercase" }}>Status</div>
          <div style={{ fontSize: "0.7rem", color: node.status === 0 ? "#34d399" : node.status === 1 ? "#f87171" : "#fbbf24" }}>
            {node.status === 0 ? "Active" : node.status === 1 ? "Deceased" : "Rehomed"}
          </div>
        </div>
        {node.breeder && (
          <div style={{ gridColumn: "1 / -1" }}>
            <div style={{ fontSize: "0.58rem", color: "var(--text-muted, #6b7280)", textTransform: "uppercase" }}>Registrant</div>
            <div style={{ fontSize: "0.68rem", color: "#e0e0e0", fontFamily: "monospace" }}>
              {node.breeder.substring(0, 6)}...{node.breeder.slice(-4)}
            </div>
          </div>
        )}
      </div>
      {/* Tooltip arrow */}
      <div style={{
        position: "absolute",
        bottom: "-6px",
        left: "50%",
        transform: "translateX(-50%) rotate(45deg)",
        width: "12px",
        height: "12px",
        background: "rgba(15, 12, 31, 0.97)",
        borderRight: "1px solid rgba(167, 139, 250, 0.3)",
        borderBottom: "1px solid rgba(167, 139, 250, 0.3)",
      }} />
    </div>
  );
}

// ─── Single Tree Node ───────────────────────────────────────────────────────
function TreeNode({ node, x, y, colorScheme, label, index, onHover, onClick, isCollapsed }) {
  const [hovered, setHovered] = useState(false);
  const isEmpty = !node;
  const colors = isEmpty ? COLORS.unknown : colorScheme;

  const handleMouseEnter = (e) => {
    if (!isEmpty) {
      setHovered(true);
      const rect = e.currentTarget.getBoundingClientRect();
      const svgContainer = e.currentTarget.closest(".pedigree-svg-container");
      const containerRect = svgContainer?.getBoundingClientRect() || { left: 0, top: 0 };
      onHover?.(node, {
        x: rect.left + rect.width / 2 - containerRect.left,
        y: rect.top - containerRect.top,
      });
    }
  };

  const handleMouseLeave = () => {
    setHovered(false);
    onHover?.(null, { x: 0, y: 0 });
  };

  return (
    <g
      className="pedigree-node"
      style={{
        cursor: isEmpty ? "default" : "pointer",
        animation: `node-appear 0.5s ease-out ${index * 0.08}s both`,
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={() => !isEmpty && onClick?.(node)}
    >
      {/* Glow effect on hover */}
      {hovered && !isEmpty && (
        <rect
          x={x - 4}
          y={y - 4}
          width={NODE_WIDTH + 8}
          height={NODE_HEIGHT + 8}
          rx={NODE_RADIUS + 2}
          fill="none"
          stroke={colors.border}
          strokeWidth="2"
          opacity="0.6"
          style={{ filter: `drop-shadow(0 0 8px ${colors.glow})` }}
        />
      )}

      {/* Node background */}
      <rect
        x={x}
        y={y}
        width={NODE_WIDTH}
        height={NODE_HEIGHT}
        rx={NODE_RADIUS}
        fill={isEmpty ? "rgba(30, 27, 45, 0.6)" : "rgba(14, 11, 26, 0.85)"}
        stroke={isEmpty ? "rgba(75, 85, 99, 0.3)" : colors.border}
        strokeWidth={hovered ? "2" : "1"}
        strokeDasharray={isEmpty ? "4 4" : "none"}
        style={{
          transition: "stroke-width 0.2s, stroke 0.2s",
          filter: hovered && !isEmpty ? `drop-shadow(0 4px 12px ${colors.glow})` : "none",
        }}
      />

      {/* Color accent bar at top */}
      <rect
        x={x}
        y={y}
        width={NODE_WIDTH}
        height="4"
        rx={NODE_RADIUS}
        fill={`url(#gradient-${label.replace(/[^a-z]/gi, "")})`}
        clipPath={`inset(0 0 ${NODE_HEIGHT - 4}px 0 round ${NODE_RADIUS}px)`}
      />
      {/* Simpler top bar that doesn't need clipPath */}
      <rect
        x={x + 1}
        y={y + 1}
        width={NODE_WIDTH - 2}
        height="3"
        rx="2"
        fill={isEmpty ? "rgba(75, 85, 99, 0.3)" : colors.gradient[0]}
        opacity="0.7"
      />

      {/* Content */}
      {isEmpty ? (
        <>
          <text x={x + NODE_WIDTH / 2} y={y + 32} textAnchor="middle" fill="rgba(156, 163, 175, 0.5)" fontSize="11" fontWeight="600">
            {label}
          </text>
          <text x={x + NODE_WIDTH / 2} y={y + 52} textAnchor="middle" fill="rgba(107, 114, 128, 0.6)" fontSize="10">
            Unknown Ancestry
          </text>
          <text x={x + NODE_WIDTH / 2} y={y + 70} textAnchor="middle" fill="rgba(107, 114, 128, 0.3)" fontSize="16">
            ?
          </text>
        </>
      ) : (
        <>
          {/* Role label */}
          <text x={x + 12} y={y + 18} fill={colors.gradient[0]} fontSize="9" fontWeight="700" letterSpacing="0.08em" textTransform="uppercase" opacity="0.8">
            {label}
          </text>

          {/* Certificate number */}
          <text x={x + NODE_WIDTH - 12} y={y + 18} textAnchor="end" fill="rgba(167, 139, 250, 0.7)" fontSize="9" fontFamily="'JetBrains Mono', monospace">
            #{node.id?.toString().padStart(3, "0")}
          </text>

          {/* Species name */}
          <text x={x + 12} y={y + 38} fill="#ffffff" fontSize="12" fontWeight="700" fontFamily="'Inter', sans-serif">
            {truncateText(node.speciesName || "Unknown", 18)}
          </text>

          {/* Scientific name */}
          {node.scientificName && (
            <text x={x + 12} y={y + 54} fill="rgba(167,139,250,0.6)" fontSize="9" fontStyle="italic">
              {truncateText(node.scientificName, 24)}
            </text>
          )}

          {/* Status badge */}
          <rect
            x={x + 12}
            y={y + 62}
            width="48"
            height="16"
            rx="8"
            fill={node.status === 0 ? "rgba(52,211,153,0.12)" : node.status === 1 ? "rgba(248,113,113,0.12)" : "rgba(251,191,36,0.12)"}
            stroke={node.status === 0 ? "rgba(52,211,153,0.3)" : node.status === 1 ? "rgba(248,113,113,0.3)" : "rgba(251,191,36,0.3)"}
            strokeWidth="0.5"
          />
          <text
            x={x + 36}
            y={y + 73}
            textAnchor="middle"
            fill={node.status === 0 ? "#34d399" : node.status === 1 ? "#f87171" : "#fbbf24"}
            fontSize="8"
            fontWeight="600"
          >
            {node.status === 0 ? "Active" : node.status === 1 ? "Deceased" : "Rehomed"}
          </text>

          {/* Generation indicator dot */}
          <circle
            cx={x + NODE_WIDTH - 16}
            cy={y + NODE_HEIGHT - 16}
            r="6"
            fill={colors.gradient[0]}
            opacity="0.3"
          />
        </>
      )}
    </g>
  );
}

// ─── SVG Path Connector ─────────────────────────────────────────────────────
function Connector({ fromX, fromY, toX, toY, color, index }) {
  // Cubic Bézier curve for smooth connection
  const midX = (fromX + toX) / 2;
  const path = `M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`;

  return (
    <path
      d={path}
      fill="none"
      stroke={color}
      strokeWidth="1.5"
      strokeLinecap="round"
      opacity="0.5"
      style={{
        animation: `connector-draw 0.8s ease-out ${0.3 + index * 0.1}s both`,
      }}
    />
  );
}

// ─── Main PedigreeTree Component ────────────────────────────────────────────
export function PedigreeTree({ tree, onNodeClick, onExport }) {
  const containerRef = useRef(null);
  const [tooltip, setTooltip] = useState({ node: null, position: { x: 0, y: 0 } });
  const [collapsed, setCollapsed] = useState({ sire: false, dam: false });
  const [dimensions, setDimensions] = useState({ width: 900, isMobile: false });

  // Responsive sizing
  useEffect(() => {
    const updateDimensions = () => {
      const w = containerRef.current?.offsetWidth || 900;
      setDimensions({ width: w, isMobile: w < 640 });
    };
    updateDimensions();
    window.addEventListener("resize", updateDimensions);
    return () => window.removeEventListener("resize", updateDimensions);
  }, []);

  if (!tree) return null;

  const { isMobile } = dimensions;
  const svgWidth = isMobile ? dimensions.width : Math.max(dimensions.width, 880);

  // ─── Calculate Node Positions ───────────────────────────────────────────
  // Horizontal layout: Target → Parents → Grandparents (left to right)
  const genGap = isMobile ? 160 : GENERATION_GAP;
  const nodeW = isMobile ? 140 : NODE_WIDTH;
  const nodeH = isMobile ? 75 : NODE_HEIGHT;
  const padding = isMobile ? 10 : 40;

  // Generation X positions
  const gen0X = padding;
  const gen1X = gen0X + nodeW + genGap;
  const gen2X = gen1X + nodeW + genGap;

  // Total SVG height
  const totalHeight = isMobile ? 620 : Math.max(4 * nodeH + 3 * VERTICAL_SPACING + 80, 460);

  // Gen 0: Target (vertically centered)
  const targetY = totalHeight / 2 - nodeH / 2;

  // Gen 1: Parents (top half and bottom half)
  const sireY = totalHeight / 4 - nodeH / 2;
  const damY = (3 * totalHeight) / 4 - nodeH / 2;

  // Gen 2: Grandparents (evenly distributed)
  const gpSpacing = totalHeight / 4;
  const gpStartY = gpSpacing / 2 - nodeH / 2;
  const sireSireY = gpStartY;
  const sireDamY = gpStartY + gpSpacing;
  const damSireY = gpStartY + 2 * gpSpacing;
  const damDamY = gpStartY + 3 * gpSpacing;

  const handleHover = (node, position) => {
    setTooltip({ node, position });
  };

  const handleNodeClick = (node) => {
    onNodeClick?.(node);
  };

  const toggleCollapse = (branch) => {
    setCollapsed((prev) => ({ ...prev, [branch]: !prev[branch] }));
  };

  // Build connectors
  const connectors = [];
  // Target → Sire
  connectors.push({
    fromX: gen0X + nodeW,
    fromY: targetY + nodeH / 2,
    toX: gen1X,
    toY: sireY + nodeH / 2,
    color: COLORS.sire.gradient[0],
  });
  // Target → Dam
  connectors.push({
    fromX: gen0X + nodeW,
    fromY: targetY + nodeH / 2,
    toX: gen1X,
    toY: damY + nodeH / 2,
    color: COLORS.dam.gradient[0],
  });

  // Sire → Sire's Parents (if not collapsed)
  if (!collapsed.sire) {
    connectors.push({
      fromX: gen1X + nodeW,
      fromY: sireY + nodeH / 2,
      toX: gen2X,
      toY: sireSireY + nodeH / 2,
      color: COLORS.grandparent.gradient[0],
    });
    connectors.push({
      fromX: gen1X + nodeW,
      fromY: sireY + nodeH / 2,
      toX: gen2X,
      toY: sireDamY + nodeH / 2,
      color: COLORS.grandparent.gradient[0],
    });
  }

  // Dam → Dam's Parents (if not collapsed)
  if (!collapsed.dam) {
    connectors.push({
      fromX: gen1X + nodeW,
      fromY: damY + nodeH / 2,
      toX: gen2X,
      toY: damSireY + nodeH / 2,
      color: COLORS.grandparent.gradient[0],
    });
    connectors.push({
      fromX: gen1X + nodeW,
      fromY: damY + nodeH / 2,
      toX: gen2X,
      toY: damDamY + nodeH / 2,
      color: COLORS.grandparent.gradient[0],
    });
  }

  return (
    <div
      ref={containerRef}
      className="pedigree-svg-container"
      style={{ position: "relative", width: "100%", overflowX: isMobile ? "auto" : "hidden" }}
    >
      {/* Generation Labels */}
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        padding: `0 ${padding}px`,
        marginBottom: "8px",
      }}>
        {["Subject", "Parents (F1)", "Grandparents (F2)"].map((label, i) => (
          <div
            key={label}
            style={{
              fontSize: "0.62rem",
              fontWeight: "700",
              color: "rgba(167, 139, 250, 0.6)",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              flex: 1,
              textAlign: i === 0 ? "left" : i === 1 ? "center" : "right",
            }}
          >
            {label}
          </div>
        ))}
      </div>

      {/* SVG Canvas */}
      <svg
        width={svgWidth}
        height={totalHeight}
        viewBox={`0 0 ${svgWidth} ${totalHeight}`}
        style={{ display: "block" }}
      >
        {/* Gradient Definitions */}
        <defs>
          {Object.entries(COLORS).map(([key, { gradient }]) => (
            <linearGradient key={key} id={`gradient-${key}`} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={gradient[0]} />
              <stop offset="100%" stopColor={gradient[1]} />
            </linearGradient>
          ))}
          {/* Glow filter */}
          <filter id="node-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Background grid pattern */}
        <pattern id="pedigree-grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(139, 92, 246, 0.04)" strokeWidth="0.5" />
        </pattern>
        <rect width="100%" height="100%" fill="url(#pedigree-grid)" />

        {/* Connectors (rendered behind nodes) */}
        {connectors.map((c, i) => (
          <Connector key={i} {...c} index={i} />
        ))}

        {/* Generation 2: Grandparents */}
        {!collapsed.sire && (
          <>
            <TreeNode
              node={tree.grandparents.sireSire}
              x={gen2X} y={sireSireY}
              colorScheme={COLORS.grandparent}
              label="Sire's Sire"
              index={6}
              onHover={handleHover}
              onClick={handleNodeClick}
            />
            <TreeNode
              node={tree.grandparents.sireDam}
              x={gen2X} y={sireDamY}
              colorScheme={COLORS.grandparent}
              label="Sire's Dam"
              index={7}
              onHover={handleHover}
              onClick={handleNodeClick}
            />
          </>
        )}
        {!collapsed.dam && (
          <>
            <TreeNode
              node={tree.grandparents.damSire}
              x={gen2X} y={damSireY}
              colorScheme={COLORS.grandparent}
              label="Dam's Sire"
              index={8}
              onHover={handleHover}
              onClick={handleNodeClick}
            />
            <TreeNode
              node={tree.grandparents.damDam}
              x={gen2X} y={damDamY}
              colorScheme={COLORS.grandparent}
              label="Dam's Dam"
              index={9}
              onHover={handleHover}
              onClick={handleNodeClick}
            />
          </>
        )}

        {/* Generation 1: Parents */}
        <TreeNode
          node={tree.parents.sire}
          x={gen1X} y={sireY}
          colorScheme={COLORS.sire}
          label="Sire"
          index={2}
          onHover={handleHover}
          onClick={(node) => {
            if (node) toggleCollapse("sire");
            handleNodeClick(node);
          }}
        />
        <TreeNode
          node={tree.parents.dam}
          x={gen1X} y={damY}
          colorScheme={COLORS.dam}
          label="Dam"
          index={3}
          onHover={handleHover}
          onClick={(node) => {
            if (node) toggleCollapse("dam");
            handleNodeClick(node);
          }}
        />

        {/* Collapse indicators */}
        {tree.parents.sire && (
          <g
            style={{ cursor: "pointer" }}
            onClick={() => toggleCollapse("sire")}
          >
            <circle cx={gen1X + nodeW + 14} cy={sireY + nodeH / 2} r="10" fill="rgba(96,165,250,0.1)" stroke="rgba(96,165,250,0.3)" strokeWidth="1" />
            <text x={gen1X + nodeW + 14} y={sireY + nodeH / 2 + 4} textAnchor="middle" fontSize="10" fill="rgba(96,165,250,0.8)">
              {collapsed.sire ? "+" : "−"}
            </text>
          </g>
        )}
        {tree.parents.dam && (
          <g
            style={{ cursor: "pointer" }}
            onClick={() => toggleCollapse("dam")}
          >
            <circle cx={gen1X + nodeW + 14} cy={damY + nodeH / 2} r="10" fill="rgba(244,114,182,0.1)" stroke="rgba(244,114,182,0.3)" strokeWidth="1" />
            <text x={gen1X + nodeW + 14} y={damY + nodeH / 2 + 4} textAnchor="middle" fontSize="10" fill="rgba(244,114,182,0.8)">
              {collapsed.dam ? "+" : "−"}
            </text>
          </g>
        )}

        {/* Generation 0: Target */}
        <TreeNode
          node={tree.target}
          x={gen0X} y={targetY}
          colorScheme={COLORS.target}
          label="Subject"
          index={0}
          onHover={handleHover}
          onClick={handleNodeClick}
        />
      </svg>

      {/* Tooltip overlay (HTML, positioned absolutely over SVG) */}
      {tooltip.node && (
        <Tooltip node={tooltip.node} position={tooltip.position} />
      )}

      {/* Legend */}
      <div style={{
        display: "flex",
        gap: "16px",
        justifyContent: "center",
        marginTop: "16px",
        flexWrap: "wrap",
      }}>
        {[
          { label: "Subject", color: COLORS.target.gradient[0] },
          { label: "Sire Line", color: COLORS.sire.gradient[0] },
          { label: "Dam Line", color: COLORS.dam.gradient[0] },
          { label: "Grandparents", color: COLORS.grandparent.gradient[0] },
        ].map(({ label, color }) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <div style={{ width: "10px", height: "10px", borderRadius: "50%", background: color, opacity: 0.8 }} />
            <span style={{ fontSize: "0.68rem", color: "var(--text-muted, #6b7280)" }}>{label}</span>
          </div>
        ))}
      </div>

      {/* CSS Animations */}
      <style>{`
        @keyframes node-appear {
          from {
            opacity: 0;
            transform: translateY(8px) scale(0.95);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        @keyframes connector-draw {
          from {
            stroke-dasharray: 500;
            stroke-dashoffset: 500;
          }
          to {
            stroke-dasharray: 500;
            stroke-dashoffset: 0;
          }
        }
        @keyframes tooltip-appear {
          from {
            opacity: 0;
            transform: translate(-50%, -100%) scale(0.95);
          }
          to {
            opacity: 1;
            transform: translate(-50%, -100%) scale(1);
          }
        }
        .pedigree-node {
          transition: transform 0.2s ease;
        }
        .pedigree-node:hover {
          transform: translateY(-2px);
        }
        .pedigree-svg-container::-webkit-scrollbar {
          height: 6px;
        }
        .pedigree-svg-container::-webkit-scrollbar-track {
          background: rgba(139, 92, 246, 0.05);
          border-radius: 3px;
        }
        .pedigree-svg-container::-webkit-scrollbar-thumb {
          background: rgba(139, 92, 246, 0.2);
          border-radius: 3px;
        }
      `}</style>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function truncateText(text, maxLen) {
  if (!text) return "";
  return text.length > maxLen ? text.substring(0, maxLen - 1) + "…" : text;
}

export default PedigreeTree;
