import { useCallback, useEffect, useMemo, useState } from "react";
import { loadCustomGroups, mergeGroups } from "../services/tankGroups";

/**
 * useTankGroups — the keeper's location-group list for the Logbook.
 *
 * Merges hand-created groups (Dexie `tankGroups`) with any group names already
 * present on tank records, so the chip bar and the tank card's "move to group"
 * menu always read from one list. `reload()` is called by the mutating UI after
 * a create/rename/delete; tank-derived names refresh automatically whenever the
 * tanks query does.
 */
export function useTankGroups(walletAccount, tanks) {
  const [customRows, setCustomRows] = useState([]);

  const reload = useCallback(async () => {
    const rows = await loadCustomGroups(walletAccount);
    setCustomRows(rows);
  }, [walletAccount]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const rows = await loadCustomGroups(walletAccount);
      if (!cancelled) setCustomRows(rows);
    })();
    return () => { cancelled = true; };
  }, [walletAccount]);

  const groups = useMemo(() => mergeGroups(customRows, tanks), [customRows, tanks]);

  return { groups, reload };
}
