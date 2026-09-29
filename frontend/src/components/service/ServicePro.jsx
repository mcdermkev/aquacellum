/**
 * ServicePro — tank maintenance for clients, full screen (docs/SERVICE_PROS_SPEC.md).
 *
 *   /app/service                 my clients and what's due
 *   /app/service/<clientId>      a client: sites, tanks, log a visit, share link
 *   /app/service/view/<token>    the client's read-only history (public)
 *
 * Client tanks are server records owned by the pro, separate from the pro's own
 * husbandry tanks. The server scopes everything to the signed-in wallet; this
 * page only shows what it's given.
 */

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive, ArrowLeft, CalendarCheck, Copy, MapPin, Plus, Printer, ShareNetwork, SignIn, SpinnerGap, Trash, Wrench,
} from "@phosphor-icons/react";
import { useAuth } from "../../contexts/AuthContext";
import { Note } from "../auctions/AuctionNightUi";
import {
  KIND_LABELS, READING_LABELS, TASK_LABELS, addVisit, archiveClient, deleteVisit, getServiceClient, getServiceHistory,
  getServiceHome, readingsSummary, saveClient, saveSite, saveTank, serviceClientPath, serviceHomePath, setShare, volumeLabel,
} from "../../services/serviceProApi";
import "../auctions/auctionNight.css";
import "./service.css";

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString([], { dateStyle: "medium" }) : "");
const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "");

function toLocalInput(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function Brand({ title, sub }) {
  return (
    <div className="an-brand">
      <span className="an-brand-mark"><Wrench size={22} weight="bold" aria-hidden="true" /></span>
      <div>
        <h1 className="an-title">{title}</h1>
        {sub && <div className="an-sub">{sub}</div>}
      </div>
    </div>
  );
}

function Loading() {
  return (
    <div className="an-row an-soft" style={{ padding: "2rem 0", justifyContent: "center" }} role="status">
      <SpinnerGap size={22} className="spin" aria-hidden="true" /> Loading…
    </div>
  );
}

export function DueChip({ due }) {
  if (!due || due.status === "unscheduled") return null;
  if (due.status === "overdue") return <span className="an-chip sp-chip-overdue">{due.neverVisited ? "First visit due" : "Overdue"}</span>;
  if (due.status === "due_soon") return <span className="an-chip sp-chip-soon">Due {fmtDate(due.dueAt)}</span>;
  return <span className="an-chip sp-chip-ok">Next {fmtDate(due.dueAt)}</span>;
}

function Field({ label, children, hint }) {
  return (
    <label className="an-field"><span className="an-label">{label}</span>{children}{hint && <span className="an-small an-muted">{hint}</span>}</label>
  );
}

// ─── Home ──────────────────────────────────────────────────────────────────

function NewClientForm({ onCreated }) {
  const empty = { name: "", contactName: "", phone: "", email: "", address: "" };
  const [f, setF] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    const r = await saveClient(f);
    setBusy(false);
    if (!r.success) return setErr(r.error);
    setF(empty);
    onCreated(r.clientId);
  };
  return (
    <form className="an-card an-stack" onSubmit={submit}>
      <h2 className="an-h"><Plus size={18} weight="bold" aria-hidden="true" /> New client</h2>
      <Field label="Client or business"><input className="an-input" required maxLength={120} value={f.name} onChange={set("name")} placeholder="Harbor Dental" /></Field>
      <div className="an-grid an-grid-halves">
        <Field label="Contact"><input className="an-input" maxLength={120} value={f.contactName} onChange={set("contactName")} /></Field>
        <Field label="Phone"><input className="an-input" type="tel" maxLength={40} value={f.phone} onChange={set("phone")} /></Field>
      </div>
      <Field label="Email"><input className="an-input" type="email" maxLength={200} value={f.email} onChange={set("email")} /></Field>
      <Field label="Address"><input className="an-input" maxLength={300} value={f.address} onChange={set("address")} /></Field>
      {err && <Note tone="err">{err}</Note>}
      <button type="submit" className="an-btn an-btn-primary" disabled={busy || !f.name.trim()}>{busy ? "Adding…" : "Add client"}</button>
    </form>
  );
}

function ServiceHome({ onNavigate, enabled }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["service-home"], queryFn: getServiceHome, enabled });
  const data = q.data?.success ? q.data : null;
  const [showArchived, setShowArchived] = useState(false);
  const clients = data ? data.clients.filter((c) => showArchived || !c.archived) : [];

  return (
    <div className="an"><div className="an-wrap">
      <div className="an-top">
        <Brand title="Tank service" sub="Your clients' tanks, what's due, and a visit log they can see." />
        <span className="an-spacer" />
        <a className="an-btn an-btn-ghost an-btn-sm" href="/app">Back to Aquacellum</a>
      </div>
      {(!enabled || q.isLoading) && <Loading />}
      {q.data && !q.data.success && <Note tone="err">{q.data.error}</Note>}
      {data && (
        <div className="an-grid an-grid-2">
          <div className="an-stack">
            <div className="an-card">
              <h2 className="an-h"><CalendarCheck size={18} weight="bold" aria-hidden="true" /> Due</h2>
              {data.due.length === 0 && <p className="an-soft">Nothing due in the next two days. Set a visit schedule on a tank to see it here.</p>}
              <div className="an-stack">
                {data.due.map((t) => (
                  <button key={t.id} type="button" className="an-btn" style={{ justifyContent: "space-between", textAlign: "left", minHeight: 60 }} onClick={() => onNavigate(serviceClientPath(t.clientId))}>
                    <span>
                      <span style={{ display: "block" }}>{t.name}</span>
                      <span className="an-small an-soft">{t.clientName}{t.lastVisitAt ? ` · last ${fmtDate(t.lastVisitAt)}` : " · never visited"}</span>
                    </span>
                    <DueChip due={t} />
                  </button>
                ))}
              </div>
            </div>
            <div className="an-card">
              <div className="an-row" style={{ justifyContent: "space-between" }}>
                <h2 className="an-h" style={{ margin: 0 }}>Clients</h2>
                {data.clients.some((c) => c.archived) && (
                  <button type="button" className="an-btn an-btn-ghost an-btn-sm" aria-pressed={showArchived} onClick={() => setShowArchived((v) => !v)}>
                    {showArchived ? "Hide archived" : "Show archived"}
                  </button>
                )}
              </div>
              {clients.length === 0 && <p className="an-soft">No clients yet. Add one to start logging visits.</p>}
              <div className="an-stack" style={{ marginTop: "0.5rem" }}>
                {clients.map((c) => (
                  <button key={c.id} type="button" className="an-btn" style={{ justifyContent: "space-between", textAlign: "left", minHeight: 60 }} onClick={() => onNavigate(serviceClientPath(c.id))}>
                    <span>
                      <span style={{ display: "block" }}>{c.name}</span>
                      <span className="an-small an-soft">{c.tanks} tank{c.tanks === 1 ? "" : "s"}{c.contactName ? ` · ${c.contactName}` : ""}</span>
                    </span>
                    <span className="an-row">
                      {c.archived && <span className="an-chip">Archived</span>}
                      {c.overdue > 0 && <span className="an-chip sp-chip-overdue">{c.overdue} overdue</span>}
                      {c.dueSoon > 0 && <span className="an-chip sp-chip-soon">{c.dueSoon} due</span>}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="an-stack">
            <NewClientForm onCreated={(id) => { qc.invalidateQueries({ queryKey: ["service-home"] }); onNavigate(serviceClientPath(id)); }} />
            <Note tone="info">Client tanks are kept separate from your own tanks. Nothing here is for sale, and nothing is shared until you turn on a client&apos;s history link.</Note>
          </div>
        </div>
      )}
    </div></div>
  );
}

// ─── Client ────────────────────────────────────────────────────────────────

function VisitForm({ tank, onDone, onCancel }) {
  const [f, setF] = useState({
    visitedAt: toLocalInput(new Date()), tasks: [], waterChangePercent: "", readings: { tempUnit: "F" }, clientNote: "", privateNote: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const toggle = (t) => setF((p) => ({ ...p, tasks: p.tasks.includes(t) ? p.tasks.filter((x) => x !== t) : [...p.tasks, t] }));
  const setReading = (k) => (e) => setF((p) => ({ ...p, readings: { ...p.readings, [k]: e.target.value } }));
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    const r = await addVisit({ ...f, tankId: tank.id, visitedAt: new Date(f.visitedAt).toISOString() });
    setBusy(false);
    if (!r.success) return setErr(r.error);
    onDone();
  };
  const isSalt = tank.kind === "saltwater" || tank.kind === "reef";
  return (
    <form className="an-stack" onSubmit={submit} aria-label={`Log a visit for ${tank.name}`}>
      <Field label="When"><input className="an-input" type="datetime-local" required value={f.visitedAt} onChange={(e) => setF((p) => ({ ...p, visitedAt: e.target.value }))} /></Field>
      <fieldset className="an-field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="an-label">What you did</legend>
        <div className="sp-tasks">
          {Object.entries(TASK_LABELS).map(([id, label]) => (
            <button key={id} type="button" className="an-btn an-btn-sm sp-task" aria-pressed={f.tasks.includes(id)} onClick={() => toggle(id)}>{label}</button>
          ))}
        </div>
      </fieldset>
      <Field label="Water changed (%)"><input className="an-input" type="number" min="1" max="100" inputMode="numeric" value={f.waterChangePercent} onChange={(e) => setF((p) => ({ ...p, waterChangePercent: e.target.value }))} /></Field>
      <fieldset className="an-field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="an-label">Readings (optional)</legend>
        <div className="sp-readings">
          {READING_LABELS.filter(([k]) => k !== "salinity" || isSalt).map(([k, label]) => (
            <label key={k} className="an-field">
              <span className="an-small an-soft">{k === "temp" ? `Temp (°${f.readings.tempUnit})` : label}</span>
              <input className="an-input" type="number" step="any" inputMode="decimal" value={f.readings[k] ?? ""} onChange={setReading(k)} />
            </label>
          ))}
          <label className="an-field">
            <span className="an-small an-soft">Temp unit</span>
            <select className="an-select" value={f.readings.tempUnit} onChange={setReading("tempUnit")}>
              <option value="F">°F</option>
              <option value="C">°C</option>
            </select>
          </label>
        </div>
      </fieldset>
      <div className="an-grid an-grid-halves">
        <Field label="Note for the client" hint="Shown on their history link.">
          <textarea className="an-input sp-note" maxLength={2000} value={f.clientNote} onChange={(e) => setF((p) => ({ ...p, clientNote: e.target.value }))} />
        </Field>
        <Field label="Private note" hint="Only you see this.">
          <textarea className="an-input sp-note" maxLength={2000} value={f.privateNote} onChange={(e) => setF((p) => ({ ...p, privateNote: e.target.value }))} />
        </Field>
      </div>
      {err && <Note tone="err">{err}</Note>}
      <div className="an-row">
        <button type="submit" className="an-btn an-btn-primary" disabled={busy}>{busy ? "Saving…" : "Save visit"}</button>
        <button type="button" className="an-btn an-btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function TankForm({ siteId, tank = null, onDone, onCancel }) {
  const [f, setF] = useState({
    name: tank?.name || "", kind: tank?.kind || "freshwater",
    gallons: tank?.volume_liters ? String(Math.round(Number(tank.volume_liters) / 3.78541)) : "",
    livestock: tank?.livestock || "", equipment: tank?.equipment || "",
    visitEveryDays: tank?.visit_every_days ? String(tank.visit_every_days) : "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    const r = await saveTank({
      ...(tank ? { id: tank.id } : { siteId }),
      name: f.name, kind: f.kind, livestock: f.livestock, equipment: f.equipment,
      volumeLiters: f.gallons ? Math.round(Number(f.gallons) * 3.78541 * 10) / 10 : null,
      visitEveryDays: f.visitEveryDays || null,
    });
    setBusy(false);
    if (!r.success) return setErr(r.error);
    onDone();
  };
  return (
    <form className="an-stack" onSubmit={submit}>
      <div className="an-grid an-grid-halves">
        <Field label="Tank name"><input className="an-input" required maxLength={120} value={f.name} onChange={set("name")} placeholder="Lobby 75 gal" /></Field>
        <Field label="Type">
          <select className="an-select" value={f.kind} onChange={set("kind")}>
            {Object.entries(KIND_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </Field>
      </div>
      <div className="an-grid an-grid-halves">
        <Field label="Gallons"><input className="an-input" type="number" min="1" inputMode="numeric" value={f.gallons} onChange={set("gallons")} /></Field>
        <Field label="Visit every (days)" hint="Leave blank if there's no schedule.">
          <input className="an-input" type="number" min="1" max="365" inputMode="numeric" value={f.visitEveryDays} onChange={set("visitEveryDays")} />
        </Field>
      </div>
      <Field label="Livestock"><textarea className="an-input sp-note" maxLength={2000} value={f.livestock} onChange={set("livestock")} placeholder="6 cardinal tetras, 1 bristlenose pleco" /></Field>
      <Field label="Equipment"><textarea className="an-input sp-note" maxLength={2000} value={f.equipment} onChange={set("equipment")} placeholder="Fluval 307, 200W heater" /></Field>
      {err && <Note tone="err">{err}</Note>}
      <div className="an-row">
        <button type="submit" className="an-btn an-btn-primary" disabled={busy || !f.name.trim()}>{busy ? "Saving…" : tank ? "Save tank" : "Add tank"}</button>
        <button type="button" className="an-btn an-btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function VisitRow({ v, onDelete }) {
  return (
    <div className="sp-visit">
      <div className="an-row" style={{ justifyContent: "space-between" }}>
        <b>{fmtDateTime(v.visited_at || v.visitedAt)}</b>
        {onDelete && <button type="button" className="an-btn an-btn-ghost an-btn-sm an-noprint" onClick={onDelete} aria-label="Delete this visit"><Trash size={16} aria-hidden="true" /></button>}
      </div>
      {(v.tasks || []).length > 0 && (
        <div className="an-small">{v.tasks.map((t) => (t === "water_change" && (v.water_change_percent ?? v.waterChangePercent) ? `Water change ${v.water_change_percent ?? v.waterChangePercent}%` : TASK_LABELS[t] || t)).join(" · ")}</div>
      )}
      {readingsSummary(v.readings) && <div className="an-small an-soft">{readingsSummary(v.readings)}</div>}
      {(v.client_note ?? v.note) && <div className="an-small" style={{ whiteSpace: "pre-wrap" }}>{v.client_note ?? v.note}</div>}
      {v.private_note && <div className="an-small an-muted" style={{ whiteSpace: "pre-wrap" }}>Private: {v.private_note}</div>}
    </div>
  );
}

function TankCard({ tank, visits, refresh }) {
  const [mode, setMode] = useState(null); // 'visit' | 'edit'
  const [showAll, setShowAll] = useState(false);
  const [err, setErr] = useState(null);
  const mine = visits.filter((v) => v.tank_id === tank.id);
  const shown = showAll ? mine : mine.slice(0, 3);
  const remove = async (v) => {
    if (!window.confirm(`Delete the visit on ${fmtDateTime(v.visited_at)}?`)) return;
    const r = await deleteVisit(v.id);
    if (!r.success) return setErr(r.error);
    refresh();
  };
  const archive = async () => {
    const archiving = !tank.archived_at;
    if (archiving && !window.confirm(`Archive ${tank.name}? Its history is kept, and it drops off the client's link.`)) return;
    const r = await saveTank({
      id: tank.id, name: tank.name, kind: tank.kind, volumeLiters: tank.volume_liters, livestock: tank.livestock,
      equipment: tank.equipment, visitEveryDays: tank.visit_every_days, archived: archiving,
    });
    if (!r.success) return setErr(r.error);
    refresh();
  };
  return (
    <div className="sp-tank an-stack">
      <div className="an-row" style={{ justifyContent: "space-between" }}>
        <div>
          <div style={{ fontWeight: 800 }}>{tank.name}</div>
          <div className="an-small an-soft">
            {[KIND_LABELS[tank.kind], volumeLabel(tank.volume_liters), tank.visit_every_days ? `every ${tank.visit_every_days} days` : null].filter(Boolean).join(" · ")}
          </div>
        </div>
        <span className="an-row">
          {tank.archived_at ? <span className="an-chip">Archived</span> : <DueChip due={tank.due} />}
        </span>
      </div>
      {tank.livestock && <div className="an-small" style={{ whiteSpace: "pre-wrap" }}>{tank.livestock}</div>}
      {tank.equipment && <div className="an-small an-soft" style={{ whiteSpace: "pre-wrap" }}>{tank.equipment}</div>}
      {!mode && (
        <div className="an-row">
          {!tank.archived_at && <button type="button" className="an-btn an-btn-primary an-btn-sm" onClick={() => setMode("visit")}>Log visit</button>}
          <button type="button" className="an-btn an-btn-sm" onClick={() => setMode("edit")}>Edit</button>
          <button type="button" className="an-btn an-btn-ghost an-btn-sm" onClick={archive}><Archive size={16} aria-hidden="true" /> {tank.archived_at ? "Restore" : "Archive"}</button>
        </div>
      )}
      {mode === "visit" && <VisitForm tank={tank} onCancel={() => setMode(null)} onDone={() => { setMode(null); refresh(); }} />}
      {mode === "edit" && <TankForm tank={tank} onCancel={() => setMode(null)} onDone={() => { setMode(null); refresh(); }} />}
      {err && <Note tone="err">{err}</Note>}
      {mine.length === 0 ? <p className="an-small an-muted">No visits yet.</p> : (
        <div>
          {shown.map((v) => <VisitRow key={v.id} v={v} onDelete={() => remove(v)} />)}
          {mine.length > 3 && (
            <button type="button" className="an-btn an-btn-ghost an-btn-sm" onClick={() => setShowAll((s) => !s)}>
              {showAll ? "Show fewer" : `Show all ${mine.length} visits`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function SiteForm({ clientId, site = null, onDone, onCancel }) {
  const [f, setF] = useState({ name: site?.name || "", address: site?.address || "", accessNotes: site?.access_notes || "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    const r = await saveSite({ ...(site ? { id: site.id } : { clientId }), ...f });
    setBusy(false);
    if (!r.success) return setErr(r.error);
    onDone();
  };
  return (
    <form className="an-stack" onSubmit={submit}>
      <div className="an-grid an-grid-halves">
        <Field label="Site name"><input className="an-input" required maxLength={120} value={f.name} onChange={set("name")} placeholder="Downtown office" /></Field>
        <Field label="Address"><input className="an-input" maxLength={300} value={f.address} onChange={set("address")} /></Field>
      </div>
      <Field label="Access notes" hint="Gate codes, keys, who to ask. Only you see this.">
        <textarea className="an-input sp-note" maxLength={1000} value={f.accessNotes} onChange={set("accessNotes")} />
      </Field>
      {err && <Note tone="err">{err}</Note>}
      <div className="an-row">
        <button type="submit" className="an-btn an-btn-primary" disabled={busy || !f.name.trim()}>{busy ? "Saving…" : site ? "Save site" : "Add site"}</button>
        <button type="button" className="an-btn an-btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function SiteSection({ site, tanks, visits, clientId, refresh, showArchived }) {
  const [mode, setMode] = useState(null); // 'tank' | 'edit'
  const list = tanks.filter((t) => t.site_id === site.id && (showArchived || !t.archived_at));
  return (
    <div className="an-card an-stack">
      <div className="an-row" style={{ justifyContent: "space-between" }}>
        <div>
          <h2 className="an-h" style={{ margin: 0 }}><MapPin size={18} weight="bold" aria-hidden="true" /> {site.name}</h2>
          {site.address && <div className="an-small an-soft">{site.address}</div>}
          {site.access_notes && <div className="an-small an-muted" style={{ whiteSpace: "pre-wrap" }}>Access: {site.access_notes}</div>}
        </div>
        {!mode && (
          <div className="an-row">
            <button type="button" className="an-btn an-btn-sm" onClick={() => setMode("tank")}><Plus size={16} aria-hidden="true" /> Tank</button>
            <button type="button" className="an-btn an-btn-ghost an-btn-sm" onClick={() => setMode("edit")}>Edit site</button>
          </div>
        )}
      </div>
      {mode === "tank" && <TankForm siteId={site.id} onCancel={() => setMode(null)} onDone={() => { setMode(null); refresh(); }} />}
      {mode === "edit" && <SiteForm clientId={clientId} site={site} onCancel={() => setMode(null)} onDone={() => { setMode(null); refresh(); }} />}
      {list.length === 0 && mode !== "tank" && <p className="an-soft">No tanks at this site yet.</p>}
      {list.map((t) => <TankCard key={t.id} tank={t} visits={visits} refresh={refresh} />)}
    </div>
  );
}

function SharePanel({ client, refresh }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const run = async (enabled, rotate = false) => {
    if (rotate && !window.confirm("Make a new link? The old one stops working.")) return;
    setBusy(true); setMsg(null);
    const r = await setShare(client.id, enabled, rotate);
    setBusy(false);
    if (!r.success) return setMsg({ tone: "err", text: r.error });
    refresh();
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(client.shareUrl); setMsg({ tone: "ok", text: "Link copied." }); }
    catch { setMsg({ tone: "err", text: "Couldn't copy. Select the link and copy it." }); }
  };
  return (
    <div className="an-card an-stack">
      <h2 className="an-h"><ShareNetwork size={18} weight="bold" aria-hidden="true" /> Client history link</h2>
      <p className="an-small an-soft">A read-only page of this client&apos;s tanks and visits: dates, what you did, readings, and your notes for them. Private notes, access notes and contact details are never on it.</p>
      {client.shareUrl ? (
        <>
          <input className="an-input" readOnly value={client.shareUrl} aria-label="History link" onFocus={(e) => e.target.select()} />
          <div className="an-row">
            <button type="button" className="an-btn an-btn-primary an-btn-sm" onClick={copy}><Copy size={16} aria-hidden="true" /> Copy</button>
            <a className="an-btn an-btn-sm" href={client.shareUrl} target="_blank" rel="noreferrer">Open</a>
            <button type="button" className="an-btn an-btn-ghost an-btn-sm" onClick={() => run(true, true)} disabled={busy}>New link</button>
            <button type="button" className="an-btn an-btn-danger an-btn-sm" onClick={() => run(false)} disabled={busy}>Turn off</button>
          </div>
        </>
      ) : (
        <button type="button" className="an-btn an-btn-primary" onClick={() => run(true)} disabled={busy || !!client.archived_at}>Turn on the link</button>
      )}
      {msg && <Note tone={msg.tone}>{msg.text}</Note>}
    </div>
  );
}

function ClientDetails({ client, refresh, onNavigate }) {
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState(null);
  const [err, setErr] = useState(null);
  const begin = () => {
    setF({ name: client.name, contactName: client.contact_name || "", phone: client.phone || "", email: client.email || "", notes: client.notes || "" });
    setEditing(true);
  };
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    const r = await saveClient({ id: client.id, ...f });
    if (!r.success) return setErr(r.error);
    setEditing(false); setErr(null); refresh();
  };
  const archive = async () => {
    const archiving = !client.archived_at;
    if (archiving && !window.confirm(`Archive ${client.name}? Their history is kept and their link is turned off.`)) return;
    const r = await archiveClient(client.id, archiving);
    if (!r.success) return setErr(r.error);
    if (archiving) onNavigate(serviceHomePath()); else refresh();
  };
  if (editing) {
    return (
      <form className="an-card an-stack" onSubmit={submit}>
        <Field label="Client or business"><input className="an-input" required maxLength={120} value={f.name} onChange={set("name")} /></Field>
        <div className="an-grid an-grid-halves">
          <Field label="Contact"><input className="an-input" maxLength={120} value={f.contactName} onChange={set("contactName")} /></Field>
          <Field label="Phone"><input className="an-input" type="tel" maxLength={40} value={f.phone} onChange={set("phone")} /></Field>
        </div>
        <Field label="Email"><input className="an-input" type="email" maxLength={200} value={f.email} onChange={set("email")} /></Field>
        <Field label="Notes" hint="Only you see this."><textarea className="an-input sp-note" maxLength={2000} value={f.notes} onChange={set("notes")} /></Field>
        {err && <Note tone="err">{err}</Note>}
        <div className="an-row">
          <button type="submit" className="an-btn an-btn-primary" disabled={!f.name.trim()}>Save</button>
          <button type="button" className="an-btn an-btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
        </div>
      </form>
    );
  }
  return (
    <div className="an-card an-stack">
      <h2 className="an-h">Contact</h2>
      <div className="an-small">
        {[client.contact_name, client.phone, client.email].filter(Boolean).join(" · ") || <span className="an-soft">No contact details.</span>}
      </div>
      {client.notes && <div className="an-small an-soft" style={{ whiteSpace: "pre-wrap" }}>{client.notes}</div>}
      <div className="an-row">
        <button type="button" className="an-btn an-btn-sm" onClick={begin}>Edit</button>
        <button type="button" className="an-btn an-btn-ghost an-btn-sm" onClick={archive}><Archive size={16} aria-hidden="true" /> {client.archived_at ? "Restore client" : "Archive client"}</button>
      </div>
      {err && <Note tone="err">{err}</Note>}
    </div>
  );
}

function ServiceClient({ clientId, onNavigate, enabled }) {
  const qc = useQueryClient();
  const key = ["service-client", clientId];
  const q = useQuery({ queryKey: key, queryFn: () => getServiceClient(clientId), enabled });
  const data = q.data?.success ? q.data : null;
  const refresh = () => { qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: ["service-home"] }); };
  const [addingSite, setAddingSite] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const sites = data ? data.sites.filter((s) => showArchived || !s.archived_at) : [];

  return (
    <div className="an"><div className="an-wrap">
      <div className="an-top">
        <button type="button" className="an-btn an-btn-ghost an-btn-sm" onClick={() => onNavigate(serviceHomePath())} aria-label="All clients">
          <ArrowLeft size={18} weight="bold" aria-hidden="true" />
        </button>
        <Brand title={data?.client.name || "Client"} sub={data ? `${data.tanks.filter((t) => !t.archived_at).length} tanks · ${data.visits.length} visits logged` : ""} />
        <span className="an-spacer" />
        {data && (data.tanks.some((t) => t.archived_at) || data.sites.some((s) => s.archived_at)) && (
          <button type="button" className="an-btn an-btn-ghost an-btn-sm" aria-pressed={showArchived} onClick={() => setShowArchived((v) => !v)}>
            {showArchived ? "Hide archived" : "Show archived"}
          </button>
        )}
      </div>
      {(!enabled || q.isLoading) && <Loading />}
      {q.data && !q.data.success && <Note tone="err">{q.data.error}</Note>}
      {data && (
        <div className="an-grid an-grid-2">
          <div className="an-stack">
            {data.client.archived_at && <Note tone="info">This client is archived. Restore them to log visits or share their history.</Note>}
            {sites.map((s) => (
              <SiteSection key={s.id} site={s} tanks={data.tanks} visits={data.visits} clientId={clientId} refresh={refresh} showArchived={showArchived} />
            ))}
            {addingSite ? (
              <div className="an-card"><SiteForm clientId={clientId} onCancel={() => setAddingSite(false)} onDone={() => { setAddingSite(false); refresh(); }} /></div>
            ) : (
              <button type="button" className="an-btn" onClick={() => setAddingSite(true)}><Plus size={18} aria-hidden="true" /> Add another site</button>
            )}
          </div>
          <div className="an-stack">
            <ClientDetails client={data.client} refresh={refresh} onNavigate={onNavigate} />
            <SharePanel client={data.client} refresh={refresh} />
          </div>
        </div>
      )}
    </div></div>
  );
}

// ─── Client's read-only history (public) ───────────────────────────────────

function ServiceHistory({ shareToken }) {
  const q = useQuery({ queryKey: ["service-history", shareToken], queryFn: () => getServiceHistory(shareToken) });
  const data = q.data?.success ? q.data : null;
  return (
    <div className="an"><div className="an-wrap">
      <div className="an-top">
        <Brand title={data ? `${data.client.name}: tank service` : "Tank service history"} sub={data?.pro.name ? `Kept by ${data.pro.name}` : ""} />
        <span className="an-spacer" />
        {data && <button type="button" className="an-btn an-btn-sm an-noprint" onClick={() => window.print()}><Printer size={16} aria-hidden="true" /> Print</button>}
      </div>
      {q.isLoading && <Loading />}
      {q.data && !q.data.success && (
        <Note tone="err">{q.data.status === 404 ? "This link isn't active. Ask your tank service for a new one." : q.data.error}</Note>
      )}
      {data && (
        <div className="an-stack">
          {data.tanks.length === 0 && <p className="an-soft">No tanks yet.</p>}
          {data.sites.map((s) => {
            const tanks = data.tanks.filter((t) => t.siteId === s.id);
            if (!tanks.length) return null;
            return (
              <section key={s.id} className="an-card an-stack" aria-label={s.name}>
                {data.sites.length > 1 && <h2 className="an-h"><MapPin size={18} weight="bold" aria-hidden="true" /> {s.name}</h2>}
                {tanks.map((t) => {
                  const visits = data.visits.filter((v) => v.tankId === t.id);
                  return (
                    <div key={t.id} className="sp-tank an-stack">
                      <div className="an-row" style={{ justifyContent: "space-between" }}>
                        <div>
                          <div style={{ fontWeight: 800 }}>{t.name}</div>
                          <div className="an-small an-soft">{[KIND_LABELS[t.kind], volumeLabel(t.volumeLiters)].filter(Boolean).join(" · ")}</div>
                        </div>
                        {t.nextDueAt && <span className="an-small an-soft">Next visit {fmtDate(t.nextDueAt)}</span>}
                      </div>
                      {t.livestock && <div className="an-small" style={{ whiteSpace: "pre-wrap" }}>{t.livestock}</div>}
                      {visits.length === 0 ? <p className="an-small an-muted">No visits yet.</p> : visits.map((v) => <VisitRow key={v.id} v={v} />)}
                    </div>
                  );
                })}
              </section>
            );
          })}
          <p className="an-small an-muted">Kept on aquacellum.com</p>
        </div>
      )}
    </div></div>
  );
}

// ─── Entry ─────────────────────────────────────────────────────────────────

function SignInGate({ onSignIn, ready }) {
  return (
    <div className="an"><div className="an-wrap">
      <div className="an-top"><Brand title="Tank service" sub="For people who look after other people's tanks." /></div>
      <div className="an-card an-stack" style={{ maxWidth: 520 }}>
        <h2 className="an-h">Sign in to see your clients</h2>
        <p className="an-soft">Register the tanks you service, log each visit, and give clients a history link.</p>
        <button type="button" className="an-btn an-btn-primary" onClick={onSignIn} disabled={!ready}>
          <SignIn size={20} weight="bold" aria-hidden="true" /> Sign in
        </button>
      </div>
    </div></div>
  );
}

export function ServicePro({ view, clientId = null, shareToken = null, onNavigate }) {
  const { account, authenticated, ready, connectPrivy, sessionBridgeReady } = useAuth();
  if (view === "service-history") return <ServiceHistory shareToken={shareToken} />;
  if (!account || !authenticated) return <SignInGate onSignIn={connectPrivy} ready={ready} />;
  if (view === "service-client") return <ServiceClient clientId={clientId} onNavigate={onNavigate} enabled={!!sessionBridgeReady} />;
  return <ServiceHome onNavigate={onNavigate} enabled={!!sessionBridgeReady} />;
}

export default ServicePro;
