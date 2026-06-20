import { useEffect, useState, useCallback } from "react";
import { db } from "../db";
import { isNudgeActive, isBatchNudgeActive } from "../utils/arrivalNudge";

/**
 * useArrivalNudge — Hook that checks for specimens/batches past the nudge threshold.
 * Returns the count of items needing attention and whether a toast should be shown.
 *
 * Used by App.jsx to show the IncomingBadge count and optionally fire a startup toast.
 */

const TOAST_COOLDOWN_KEY = "aquadex_last_arrival_nudge";
const TOAST_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours between toasts

export function useArrivalNudge(walletAccount) {
  const [incomingCount, setIncomingCount] = useState(0);
  const [nudgeCount, setNudgeCount] = useState(0);
  const [shouldShowToast, setShouldShowToast] = useState(false);

  const refresh = useCallback(async () => {
    if (!walletAccount) {
      setIncomingCount(0);
      setNudgeCount(0);
      return;
    }
    const acct = walletAccount.toLowerCase();

    try {
      // Specimens in transit
      let specimens = [];
      try {
        specimens = await db.specimens
          .where("ownerAddress")
          .equals(acct)
          .filter((s) => s.arrivalStatus === "transit")
          .toArray();
      } catch (e) {
        const all = await db.specimens.where("ownerAddress").equals(acct).toArray();
        specimens = all.filter((s) => s.arrivalStatus === "transit");
      }

      // Batch orders awaiting arrival
      let batches = [];
      try {
        const orders = await db.marketOrders.toArray();
        batches = orders.filter(
          (o) =>
            o.orderType === "batch" &&
            (o.buyer || "").toLowerCase() === acct &&
            (o.state === 1 || o.state === 0) &&
            !o.assignedTankId
        );
      } catch (e) {}

      const total = specimens.length + batches.length;
      setIncomingCount(total);

      // Count nudged items
      const nudgedSpecs = specimens.filter((s) => isNudgeActive(s, s.nudgeDismissedAt));
      const nudgedBatches = batches.filter((o) => isBatchNudgeActive(o));
      const totalNudged = nudgedSpecs.length + nudgedBatches.length;
      setNudgeCount(totalNudged);

      // Determine if we should show startup toast
      if (totalNudged > 0) {
        const lastToast = localStorage.getItem(TOAST_COOLDOWN_KEY);
        const elapsed = lastToast ? Date.now() - Number(lastToast) : Infinity;
        if (elapsed > TOAST_COOLDOWN_MS) {
          setShouldShowToast(true);
        }
      }
    } catch (err) {
      console.warn("[useArrivalNudge] Query failed:", err);
    }
  }, [walletAccount]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Mark toast as shown (called by the consumer after displaying the toast)
  const markToastShown = useCallback(() => {
    localStorage.setItem(TOAST_COOLDOWN_KEY, String(Date.now()));
    setShouldShowToast(false);
  }, []);

  return {
    incomingCount,
    nudgeCount,
    hasNudge: nudgeCount > 0,
    shouldShowToast,
    markToastShown,
    refresh,
  };
}
