/**
 * PickupLeadBadge — small numeric badge for the Breeder Terminal nav tab,
 * showing the count of NEW (untriaged) guest pickup leads. Mirrors IncomingBadge.
 */
function PickupLeadBadge({ count = 0 }) {
  if (!count || count < 1) return null;
  return (
    <span
      className="pickup-lead-badge"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: "18px",
        height: "18px",
        borderRadius: "9px",
        padding: "0 5px",
        fontSize: "0.6rem",
        fontWeight: 700,
        lineHeight: 1,
        background: "var(--teal-400, #2dd4bf)",
        color: "#04231a",
      }}
      aria-label={`${count} new pickup ${count === 1 ? "request" : "requests"}`}
    >
      {count}
    </span>
  );
}

export { PickupLeadBadge };
export default PickupLeadBadge;
