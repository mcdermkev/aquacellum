/** Small shared pieces for the auction night screens. */

import { Warning } from "@phosphor-icons/react";

export function Note({ tone = "info", children }) {
  return (
    <div className={`an-note an-note-${tone}`} role={tone === "err" ? "alert" : "status"}>
      {tone === "err" && <Warning size={18} weight="bold" aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />}
      <div>{children}</div>
    </div>
  );
}
