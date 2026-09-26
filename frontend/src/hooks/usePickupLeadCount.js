import { useCallback, useEffect, useState } from "react";
import { countNewPickupInquiries } from "../services/pickupCoordinationApi";

/**
 * usePickupLeadCount — the count of NEW (untriaged) guest pickup leads for the
 * signed-in seller, used for the Breeder Terminal nav badge so new leads are
 * noticed without opening the terminal.
 *
 * Only fetches when `enabled` (an authenticated seller in the storefront beta);
 * returns 0 otherwise. Also refreshes when the tab regains focus, so a lead that
 * arrives while the app is open surfaces without a reload.
 *
 * @param {boolean} enabled
 * @returns {{ pickupLeadCount: number, refreshPickupLeadCount: () => Promise<void> }}
 */
export function usePickupLeadCount(enabled) {
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!enabled) { setCount(0); return; }
    const res = await countNewPickupInquiries();
    setCount(res.success && Number.isFinite(res.count) ? res.count : 0);
  }, [enabled]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!enabled) return undefined;
    const onFocus = () => { refresh(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [enabled, refresh]);

  return { pickupLeadCount: count, refreshPickupLeadCount: refresh };
}
