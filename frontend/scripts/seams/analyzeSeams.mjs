/**
 * analyzeSeams.mjs — find one-sided seams between modules.
 *
 * WHAT A "SEAM" IS AND WHY IT MATTERS. Most of this app's defects are not wrong
 * logic inside a function; they are two modules disagreeing about a name. A control
 * writes `aquadex_foo` and nothing ever reads it (a dead control — the user flips a
 * switch and nothing happens). A component listens for `aquadex_navigate` while the
 * app dispatches `aquadex:navigate-tab` (a feature that can never fire). Neither
 * throws. Neither fails a unit test, because each side is tested in isolation
 * against a fixture that encodes the same wrong assumption.
 *
 * This module answers one question mechanically, across the whole codebase:
 *   for every persisted key and every custom event, does BOTH SIDES exist?
 *
 * WHY AN AST AND NOT grep, AND WHY THE RESOLVER IS THE WHOLE JOB. Keys are rarely
 * literals at the call site. All of these appear in this codebase:
 *
 *   localStorage.getItem("aquadex_casual_mode")             // literal
 *   const WATCHLIST_KEY = "aquadex_watchlist";               // file-local const
 *   import { ONBOARDING_CACHE_KEY } from "...";              // imported const
 *   localStorage.setItem(`aquadex_photo_${id}`, ...)         // computed suffix
 *   const key = AI_PREF_KEYS[feature];                       // key map, dynamic
 *   storage.setItem(key, ...)                                // aliased storage
 *
 * FALSE POSITIVES ARE THE FAILURE MODE THAT MATTERS. A report that cries wolf gets
 * ignored, and then it is worth less than nothing because it provides false
 * assurance. So:
 *   - a dynamic key-map access is attributed to EVERY value in that map, since we
 *     cannot know which branch runs and must not claim a key is unused;
 *   - anything unresolvable is listed separately for human review rather than
 *     silently counted as absent;
 *   - native DOM events are excluded, because the browser dispatches those, not us.
 *
 * Deliberately NOT a general dead-code detector. It reports only asymmetry, which is
 * the specific shape that hides user-visible breakage.
 */

import { readFileSync } from "node:fs";
import * as acorn from "acorn";
import jsx from "acorn-jsx";

const Parser = acorn.Parser.extend(jsx());

const READ_METHODS = new Set(["getItem"]);
const WRITE_METHODS = new Set(["setItem"]);
const REMOVE_METHODS = new Set(["removeItem"]);
const STORAGE_METHODS = new Set([...READ_METHODS, ...WRITE_METHODS, ...REMOVE_METHODS]);

/**
 * Events the BROWSER dispatches. A listener for one of these is not a seam, so
 * including them would bury the app-owned events that actually are.
 */
const NATIVE_EVENTS = new Set([
  "abort", "afterprint", "animationend", "animationiteration", "animationstart",
  "appinstalled", "beforeinstallprompt", "beforeprint", "beforeunload", "blur",
  "cancel", "canplay", "canplaythrough", "change", "click", "close", "contextmenu",
  "controllerchange", "copy", "cut", "dblclick", "devicemotion", "deviceorientation",
  "drag", "dragend", "dragenter", "dragleave", "dragover", "dragstart", "drop",
  "durationchange", "emptied", "ended", "error", "focus", "focusin", "focusout",
  "fullscreenchange", "gesturechange", "gestureend", "gesturestart", "hashchange",
  "input", "install", "invalid", "keydown", "keypress", "keyup", "load",
  "loadeddata", "loadedmetadata", "loadstart", "message", "messageerror", "mousedown",
  "mouseenter", "mouseleave", "mousemove", "mouseout", "mouseover", "mouseup",
  "offline", "online", "orientationchange", "pagehide", "pageshow", "paste", "pause",
  "play", "playing", "pointercancel", "pointerdown", "pointerenter", "pointerleave",
  "pointermove", "pointerout", "pointerover", "pointerup", "popstate", "progress",
  "push", "pushsubscriptionchange", "ratechange", "readystatechange", "resize",
  "scroll", "scrollend", "securitypolicyviolation", "seeked", "seeking", "select",
  "storage", "submit", "suspend", "timeupdate", "touchcancel", "touchend",
  "touchmove", "touchstart", "transitionend", "unhandledrejection", "unload",
  "visibilitychange", "voiceschanged", "volumechange", "waiting", "wheel",
  // Service-worker scope — dispatched by the browser, same as the above.
  "activate", "fetch", "notificationclick", "notificationclose", "sync",
  "periodicsync", "backgroundfetchsuccess",
]);

// ─────────────────────────────────────────────────────────────────────────────
// Parsing + walking
// ─────────────────────────────────────────────────────────────────────────────

function parse(source, file) {
  try {
    return Parser.parse(source, {
      ecmaVersion: "latest",
      sourceType: "module",
      locations: true,
      allowHashBang: true,
    });
  } catch (err) {
    // Loud on purpose: silently skipping a file would let a seam hide in exactly
    // the file we could not read.
    throw new Error(`Failed to parse ${file}: ${err.message}`);
  }
}

/** Minimal generic AST walk — avoids depending on acorn-walk. */
function walk(node, visit) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (typeof node.type === "string") visit(node);
  for (const key of Object.keys(node)) {
    if (key === "loc" || key === "range" || key === "parent") continue;
    walk(node[key], visit);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolver
// ─────────────────────────────────────────────────────────────────────────────

/** `Object.freeze({...})` / `{...}` → the ObjectExpression, else null. */
function unwrapObjectExpression(node) {
  if (!node) return null;
  if (node.type === "ObjectExpression") return node;
  if (
    node.type === "CallExpression" &&
    node.callee?.type === "MemberExpression" &&
    node.callee.object?.name === "Object" &&
    node.callee.property?.name === "freeze"
  ) {
    return unwrapObjectExpression(node.arguments?.[0]);
  }
  return null;
}

/** All string values in an object literal, plus a property→value map. */
function stringMapFrom(objectExpression) {
  const byProp = new Map();
  const values = [];
  for (const prop of objectExpression.properties || []) {
    if (prop.type !== "Property") continue;
    if (prop.value?.type !== "Literal" || typeof prop.value.value !== "string") continue;
    const name =
      prop.key?.type === "Identifier" ? prop.key.name
      : prop.key?.type === "Literal" ? String(prop.key.value)
      : null;
    values.push(prop.value.value);
    if (name) byProp.set(name, prop.value.value);
  }
  return values.length > 0 ? { byProp, values } : null;
}

/**
 * Per-file bindings: plain string consts, string-valued key maps, and consts whose
 * value is derived from a key map (`const key = AI_PREF_KEYS[feature]`).
 *
 * Ambiguity is dropped rather than guessed: a name bound to two different strings in
 * one file would be a coin flip, so it is treated as unresolvable and surfaces in the
 * review list instead of producing a wrong finding.
 */
function collectBindings(ast, inherited = {}) {
  const strings = new Map(inherited.strings || []);
  const maps = new Map(inherited.maps || []);
  const derived = new Map();
  const ambiguous = new Set();

  walk(ast, (node) => {
    if (node.type !== "VariableDeclarator" || node.id?.type !== "Identifier") return;
    const name = node.id.name;

    if (node.init?.type === "Literal" && typeof node.init.value === "string") {
      if (strings.has(name) && strings.get(name) !== node.init.value) ambiguous.add(name);
      strings.set(name, node.init.value);
      return;
    }

    const obj = unwrapObjectExpression(node.init);
    if (obj) {
      const map = stringMapFrom(obj);
      if (map) maps.set(name, map);
    }
  });

  // Second pass: keys derived from something already known.
  //
  //   const key      = MAP[expr]                       → any value in MAP
  //   const key      = MAP.prop                        → that value
  //   const claimKey = `aquadex_campaign_claimed_${id}` → prefix
  //
  // The template-literal case matters as much as the map case: a writer that builds
  // its key into a const first would otherwise look absent, and the key would be
  // reported as read-but-never-written when it is written two lines above.
  const derivedDynamic = new Set();
  walk(ast, (node) => {
    if (node.type !== "VariableDeclarator" || node.id?.type !== "Identifier") return;

    if (node.init?.type === "MemberExpression") {
      const objName = node.init.object?.type === "Identifier" ? node.init.object.name : null;
      if (objName && maps.has(objName)) {
        derived.set(node.id.name, memberCandidates(node.init, maps.get(objName)));
      }
      return;
    }

    if (node.init?.type === "TemplateLiteral") {
      const head = node.init.quasis?.[0]?.value?.cooked ?? "";
      if (head) {
        derived.set(node.id.name, [head]);
        derivedDynamic.add(node.id.name);
      }
    }
  });

  for (const name of ambiguous) strings.delete(name);
  return { strings, maps, derived, derivedDynamic };
}

/**
 * Which values a member access could yield.
 *
 * A computed, non-literal property (`MAP[feature]`) could be any entry, so ALL of
 * them are returned. Attributing the operation to every candidate is what stops this
 * tool from reporting a key as unwritten merely because the write is dynamic.
 */
function memberCandidates(memberNode, map) {
  if (!memberNode.computed && memberNode.property?.type === "Identifier") {
    const single = map.byProp.get(memberNode.property.name);
    return single === undefined ? map.values : [single];
  }
  if (memberNode.property?.type === "Literal") {
    const single = map.byProp.get(String(memberNode.property.value));
    return single === undefined ? map.values : [single];
  }
  return map.values;
}

/**
 * Resolve a call argument to candidate key strings.
 * @returns {{keys: string[], dynamic: boolean}|null} null when unresolvable.
 */
function resolveKeyArg(arg, bindings) {
  if (!arg) return null;
  const { strings, maps, derived } = bindings;

  if (arg.type === "Literal" && typeof arg.value === "string") {
    return { keys: [arg.value], dynamic: false };
  }

  if (arg.type === "Identifier") {
    if (strings.has(arg.name)) return { keys: [strings.get(arg.name)], dynamic: false };
    if (derived.has(arg.name)) {
      return { keys: derived.get(arg.name), dynamic: !!bindings.derivedDynamic?.has(arg.name) };
    }
    if (maps.has(arg.name)) return { keys: maps.get(arg.name).values, dynamic: false };
    return null;
  }

  if (arg.type === "MemberExpression") {
    const objName = arg.object?.type === "Identifier" ? arg.object.name : null;
    if (objName && maps.has(objName)) {
      return { keys: memberCandidates(arg, maps.get(objName)), dynamic: false };
    }
    return null;
  }

  // `aquadex_photo_${id}` — the stable prefix IS the seam; the suffix varies per row.
  if (arg.type === "TemplateLiteral") {
    const head = arg.quasis?.[0]?.value?.cooked ?? "";
    return head ? { keys: [head], dynamic: true } : null;
  }

  // "aquadex_photo_" + id
  if (arg.type === "BinaryExpression" && arg.operator === "+") {
    const left = resolveKeyArg(arg.left, bindings);
    return left ? { keys: left.keys, dynamic: true } : null;
  }

  // `cond ? "a" : "b"` — both branches are real.
  if (arg.type === "ConditionalExpression") {
    const a = resolveKeyArg(arg.consequent, bindings);
    const b = resolveKeyArg(arg.alternate, bindings);
    if (!a && !b) return null;
    return {
      keys: [...(a?.keys || []), ...(b?.keys || [])],
      dynamic: !!(a?.dynamic || b?.dynamic),
    };
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pass 1: exported constants and key maps, so cross-file aliases resolve
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `export const ONBOARDING_CACHE_KEY = "aquadex_onboarding_v1"` in one file, used as
 * a bare identifier in another. Without this pass that key looks unread.
 */
export function collectExports(files, readFile = defaultRead) {
  const strings = new Map();
  const maps = new Map();
  const ambiguous = new Set();

  for (const file of files) {
    const ast = parse(readFile(file), file);
    walk(ast, (node) => {
      if (node.type !== "ExportNamedDeclaration") return;
      const decl = node.declaration;
      if (decl?.type !== "VariableDeclaration") return;
      for (const d of decl.declarations) {
        if (d.id?.type !== "Identifier") continue;
        if (d.init?.type === "Literal" && typeof d.init.value === "string") {
          if (strings.has(d.id.name) && strings.get(d.id.name) !== d.init.value) {
            ambiguous.add(d.id.name);
          }
          strings.set(d.id.name, d.init.value);
          continue;
        }
        const obj = unwrapObjectExpression(d.init);
        if (obj) {
          const map = stringMapFrom(obj);
          if (map) maps.set(d.id.name, map);
        }
      }
    });
  }

  for (const name of ambiguous) strings.delete(name);
  return { strings, maps };
}

function defaultRead(file) {
  return readFileSync(file, "utf8");
}

// ─────────────────────────────────────────────────────────────────────────────
// Pass 2: the seams themselves
// ─────────────────────────────────────────────────────────────────────────────

function site(file, node, relativize) {
  return `${relativize(file)}:${node.loc?.start?.line ?? 0}`;
}

/**
 * @param {string[]} files absolute paths to source files
 * @param {object} [opts]
 * @param {(f:string)=>string} [opts.readFile]
 * @param {(f:string)=>string} [opts.relativize] for readable report paths
 * @returns {{storage: Map, events: Map, unresolved: Array}}
 */
export function analyzeSeams(files, opts = {}) {
  const readFile = opts.readFile || defaultRead;
  const relativize = opts.relativize || ((f) => f);

  const exported = collectExports(files, readFile);

  /** key -> { reads, writes, removes, dynamic } */
  const storage = new Map();
  /** event name -> { dispatches, listeners } */
  const events = new Map();
  /** call sites whose key could not be resolved statically */
  const unresolved = [];
  /**
   * Every other place a string literal appears, excluding the dispatch/listen
   * arguments themselves.
   *
   * This is what keeps the tool sound in the presence of INDIRECT listeners. The
   * onboarding tour steps declare `completeOn: "aquadex:specimen_added"` and a
   * generic runner calls `addEventListener(step.completeOn)` — a registration no
   * static resolver can attribute to a name. Without this, three genuinely-handled
   * events were reported as fired into the void. So rather than assert "nothing
   * handles this", a name that appears as a literal elsewhere is downgraded to
   * "cannot conclude" and shown with the location, which is the honest answer.
   */
  const literalSites = new Map();

  const storageEntry = (key) => {
    if (!storage.has(key)) {
      storage.set(key, { reads: [], writes: [], removes: [], dynamic: false });
    }
    return storage.get(key);
  };
  const eventEntry = (name) => {
    if (!events.has(name)) events.set(name, { dispatches: [], listeners: [] });
    return events.get(name);
  };

  for (const file of files) {
    const ast = parse(readFile(file), file);
    const bindings = collectBindings(ast, exported);

    // Argument nodes already accounted for as an event name or storage key. The walk
    // is parent-first, so a node is always marked before the walk descends into it.
    const consumed = new WeakSet();

    walk(ast, (node) => {
      // Collect "the name appears here too" evidence for indirect listeners.
      if (node.type === "Literal" && typeof node.value === "string" && !consumed.has(node)) {
        if (!literalSites.has(node.value)) literalSites.set(node.value, []);
        literalSites.get(node.value).push(site(file, node, relativize));
      }

      // ── new CustomEvent("aquadex:...") ──────────────────────────────────
      if (node.type === "NewExpression" || node.type === "CallExpression") {
        const name = node.callee?.type === "Identifier" ? node.callee.name : null;
        if (name === "CustomEvent" || name === "Event") {
          const arg = node.arguments?.[0];
          if (arg) consumed.add(arg);
          const resolved = resolveKeyArg(arg, bindings);
          if (resolved) {
            for (const key of resolved.keys) {
              eventEntry(key).dispatches.push(site(file, node, relativize));
            }
          }
          return;
        }
      }

      if (node.type !== "CallExpression") return;
      const callee = node.callee;
      if (callee?.type !== "MemberExpression" || callee.property?.type !== "Identifier") return;
      const method = callee.property.name;

      // ── storage ─────────────────────────────────────────────────────────
      //
      // Matched on the METHOD NAME rather than the object, because storage is often
      // reached through an alias (`const storage = window.localStorage`) or a
      // safe-access wrapper. getItem/setItem/removeItem are effectively only the
      // Storage API here, and a custom cache with the same shape is still a real
      // key seam worth reporting.
      if (STORAGE_METHODS.has(method)) {
        const keyArg = node.arguments?.[0];
        if (keyArg) consumed.add(keyArg);
        const resolved = resolveKeyArg(keyArg, bindings);
        if (!resolved) {
          unresolved.push({ kind: "storage", method, at: site(file, node, relativize) });
          return;
        }
        const where = site(file, node, relativize);
        for (const key of resolved.keys) {
          const entry = storageEntry(key);
          if (resolved.dynamic) entry.dynamic = true;
          if (READ_METHODS.has(method)) entry.reads.push(where);
          else if (WRITE_METHODS.has(method)) entry.writes.push(where);
          else entry.removes.push(where);
        }
        return;
      }

      // ── addEventListener("aquadex:...") ─────────────────────────────────
      if (method === "addEventListener") {
        const nameArg = node.arguments?.[0];
        if (nameArg) consumed.add(nameArg);
        const resolved = resolveKeyArg(nameArg, bindings);
        if (resolved) {
          for (const key of resolved.keys) {
            eventEntry(key).listeners.push(site(file, node, relativize));
          }
          return;
        }
        // An unresolvable listener name means SOME event is handled here and we
        // cannot say which. Recorded rather than dropped, because silently ignoring
        // it is what made three handled events look orphaned.
        unresolved.push({ kind: "listener", method, at: site(file, node, relativize) });
      }
    });
  }

  return { storage, events, unresolved, literalSites };
}

// ─────────────────────────────────────────────────────────────────────────────
// Findings
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Turn the raw maps into the asymmetries worth acting on.
 *
 * A key that is only ever REMOVED is not a finding: cleanup-on-logout legitimately
 * deletes keys owned by code that may since have been retired, and reporting those
 * would bury the real signal.
 *
 * Prefix pairing applies ONLY when one side is dynamic. Comparing every key against
 * every other by prefix would let `aquadex_xp_points` be "explained" by an unrelated
 * `aquadex_xp` key and hide a genuine dead write.
 */
export function findings({ storage, events, literalSites = new Map() }) {
  const entries = [...storage.entries()];

  const pairedByPrefix = (key, entry, side) =>
    entries.some(([other, otherEntry]) => {
      if (other === key) return false;
      if (!entry.dynamic && !otherEntry.dynamic) return false;
      const related = other.startsWith(key) || key.startsWith(other);
      return related && otherEntry[side].length > 0;
    });

  const writtenNeverRead = [];
  const readNeverWritten = [];

  for (const [key, entry] of entries) {
    const hasRead = entry.reads.length > 0 || pairedByPrefix(key, entry, "reads");
    const hasWrite = entry.writes.length > 0 || pairedByPrefix(key, entry, "writes");

    if (entry.writes.length > 0 && !hasRead) {
      writtenNeverRead.push({ key, sites: entry.writes, dynamic: entry.dynamic });
    }
    if (entry.reads.length > 0 && !hasWrite) {
      readNeverWritten.push({ key, sites: entry.reads, dynamic: entry.dynamic });
    }
  }

  const dispatchedNeverHandled = [];
  const handledNeverDispatched = [];
  const possiblyHandledIndirectly = [];

  for (const [name, entry] of events) {
    if (NATIVE_EVENTS.has(name)) continue;

    if (entry.dispatches.length > 0 && entry.listeners.length === 0) {
      // The name showing up as a literal somewhere else usually means a declarative
      // registration (`completeOn: "..."`) feeding a dynamic addEventListener. That
      // is not proof of a handler, but it IS proof we cannot claim there is none.
      const elsewhere = literalSites.get(name) || [];
      if (elsewhere.length > 0) {
        possiblyHandledIndirectly.push({ key: name, sites: entry.dispatches, alsoAt: elsewhere });
      } else {
        dispatchedNeverHandled.push({ key: name, sites: entry.dispatches });
      }
    }

    if (entry.listeners.length > 0 && entry.dispatches.length === 0) {
      handledNeverDispatched.push({ key: name, sites: entry.listeners });
    }
  }

  const byKey = (a, b) => a.key.localeCompare(b.key);
  return {
    writtenNeverRead: writtenNeverRead.sort(byKey),
    readNeverWritten: readNeverWritten.sort(byKey),
    dispatchedNeverHandled: dispatchedNeverHandled.sort(byKey),
    handledNeverDispatched: handledNeverDispatched.sort(byKey),
    possiblyHandledIndirectly: possiblyHandledIndirectly.sort(byKey),
  };
}

/**
 * Buckets that represent an actual asymmetry. `possiblyHandledIndirectly` is
 * deliberately NOT one: it exists to say "we cannot conclude", so counting it as a
 * finding would reintroduce the false positives it was added to remove.
 */
export const FINDING_BUCKETS = [
  "writtenNeverRead",
  "readNeverWritten",
  "dispatchedNeverHandled",
  "handledNeverDispatched",
];

/** Flat list of `"<bucket>:<key>"` ids — the shape the CI ratchet compares. */
export function findingIds(found) {
  const ids = [];
  for (const bucket of FINDING_BUCKETS) {
    for (const item of found[bucket] || []) ids.push(`${bucket}:${item.key}`);
  }
  return ids.sort();
}
