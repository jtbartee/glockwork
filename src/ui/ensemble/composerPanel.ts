import { FORMS } from "../../compose/form";
import { PROFILE_IDS, PROFILES } from "../../compose/profiles";
import type { ComposeSettings, FormId, ProfileId } from "../../compose/types";
import type { EnsembleStore, LockDomain } from "../../ensemble/store";
import type { AppStore } from "../../state/store";
import { METER_IDS } from "../../theory/meter";
import { KEY_NAMES, SCALE_IDS, SCALES } from "../../theory/scales";
import type { MeterId, ScaleId } from "../../theory/types";
import { Knob } from "../components/Knob";
import { h } from "../dom";
import * as fmt from "../format";
import { EnsembleHost } from "./host";
import { icon } from "./icons";

const LENGTHS = [16, 24, 32, 48, 64, 96, 128, 192, 256];

const CONTROL_SPECS: { key: keyof ComposeSettings["controls"]; label: string; title: string }[] = [
  { key: "density", label: "Note Density", title: "How many notes each part plays" },
  { key: "harmonicComplexity", label: "Harmonic Cx", title: "Chord size, harmonic rhythm and borrowed chords" },
  { key: "rhythmicComplexity", label: "Rhythmic Cx", title: "Plain quarters and eighths ↔ sixteenths, syncopation and dotted rhythms" },
  { key: "counterpoint", label: "Counterpoint", title: "How often lines imitate each other and how independent counter-melodies are" },
  { key: "motifVariation", label: "Motif Variation", title: "How much returning themes are ornamented, inverted or substituted" },
  { key: "evolution", label: "Evolution", title: "How strongly the form arcs, how fast processes mutate, how often the endless performance moves on" },
  { key: "humanize", label: "Humanize", title: "Seeded timing and velocity deviation (resolved into the notes)" },
  { key: "arrangementDensity", label: "Arr. Density", title: "How many parts play at once" },
  { key: "dissonance", label: "Dissonance", title: "Budget of intentional dissonance at points of tension" },
];

function select<T extends string | number>(options: { value: T; label: string }[], value: T, onChange: (v: T) => void, cls = "select-control"): HTMLSelectElement {
  const el = h("select", { class: cls }, ...options.map((o) => h("option", { value: String(o.value) }, o.label))) as HTMLSelectElement;
  el.value = String(value);
  el.addEventListener("change", () => {
    const o = options.find((x) => String(x.value) === el.value);
    if (o) onChange(o.value);
  });
  return el;
}

const field = (label: string, ...children: (HTMLElement | null)[]) => h("div", { class: "ens-field" }, h("div", { class: "field-label" }, label), ...children);

export function buildComposerPanel(store: EnsembleStore, app: AppStore): HTMLElement {
  const host = new EnsembleHost(store, app);
  const s = () => store.settings;
  const autoLabel = (resolved: string) => `Auto · ${resolved}`;

  const mode = h("div", { class: "seg-row", role: "radiogroup", "aria-label": "Mode" });
  const modeBtns = (["arrangement", "endless"] as const).map((m) =>
    h("button", { class: "seg-button", type: "button", role: "radio", onClick: () => { store.setSetting("mode", m); store.composeNow(false); } }, m === "arrangement" ? "Finished arrangement" : "Endless performance"),
  );
  mode.append(...modeBtns);

  const profile = select(PROFILE_IDS.map((id) => ({ value: id, label: PROFILES[id].label })), s().profile, (v: ProfileId) => store.setSetting("profile", v));
  const profileHint = h("div", { class: "ens-hint" });
  const form = select<FormId | "auto">([{ value: "auto", label: "Auto" }, ...FORMS.map((f) => ({ value: f.id, label: f.label }))], s().form, (v) => store.setSetting("form", v));
  const key = select<number | "auto">([{ value: "auto", label: "Auto" }, ...KEY_NAMES.map((k, i) => ({ value: i, label: k }))], s().key, (v) => store.setSetting("key", v));
  const scale = select<ScaleId | "auto">([{ value: "auto", label: "Auto" }, ...SCALE_IDS.filter((x) => x !== "custom").map((x) => ({ value: x, label: SCALES[x].name }))], s().scale, (v) => store.setSetting("scale", v));
  const meter = select<MeterId | "auto">([{ value: "auto", label: "Auto" }, ...METER_IDS.map((m) => ({ value: m, label: m }))], s().meter, (v) => store.setSetting("meter", v));
  const tempoAuto = h("button", { class: "switch-button", type: "button", onClick: () => store.setSetting("bpm", s().bpm === "auto" ? store.plan.bpm : "auto") }, "Auto");
  const tempo = new Knob(host, { path: "settings.bpm", label: "Tempo", min: 40, max: 200, default: 100, step: 1, integer: true, formatter: fmt.bpmFmt });

  const lenMode = select<"bars" | "duration">([{ value: "bars", label: "Bars" }, { value: "duration", label: "Duration" }], s().lengthMode, (v) => store.setSetting("lengthMode", v));
  const bars = select<number>(LENGTHS.map((b) => ({ value: b, label: `${b} bars` })), s().bars, (v) => store.setSetting("bars", v));
  const barsCustom = h("input", { class: "ens-input", type: "number", min: "4", max: "512", step: "1", "aria-label": "Bars" }) as HTMLInputElement;
  barsCustom.addEventListener("change", () => store.setSetting("bars", Math.max(4, Math.min(512, Math.round(Number(barsCustom.value) || 32)))));
  const duration = h("input", { class: "ens-input", type: "text", placeholder: "m:ss", "aria-label": "Duration (minutes:seconds)" }) as HTMLInputElement;
  duration.addEventListener("change", () => {
    const m = /^(\d+):(\d{1,2})$/.exec(duration.value.trim());
    const secs = m ? Number(m[1]) * 60 + Number(m[2]) : Number(duration.value);
    if (Number.isFinite(secs) && secs >= 10) store.setSetting("seconds", Math.min(3600, secs));
  });
  const instruments = new Knob(host, { path: "settings.instruments", label: "Instruments", min: 1, max: 16, default: 8, step: 1, integer: true, formatter: (v) => String(Math.round(v)) });
  const realism = h("button", { class: "switch-button", type: "button", title: "Playable: real Orff/concert ranges, mallet counts and striking speed. Extended: the synthesis's full range, no physical limits.", onClick: () => store.setSetting("realism", s().realism === "orff" ? "extended" : "orff") }, "");

  const knobs = h("div", { class: "control-grid", style: "grid-template-columns: repeat(auto-fill, minmax(78px, 1fr)); flex:1; min-width: 320px;" },
    ...CONTROL_SPECS.map((c) => {
      const k = new Knob(host, { path: `controls.${c.key}`, label: c.label, min: 0, max: 1, default: 0.5, formatter: fmt.pct });
      k.el.title = `${c.title} — drag, double-click to reset, right-click for MIDI Learn`;
      return k.el;
    }),
  );

  const seed = h("input", { class: "ens-input", type: "number", min: "0", step: "1", "aria-label": "Seed" }) as HTMLInputElement;
  seed.addEventListener("change", () => store.composeNow(false, Math.max(0, Math.round(Number(seed.value) || 0))));
  const dice = h("button", { class: "icon-button", type: "button", title: "New seed for every unlocked element, then compose", onClick: () => store.composeNow(true) }, icon("dice"), " New");
  const composeBtn = h("button", { class: "icon-button primary ens-compose", type: "button", title: "Compose with these settings (locked elements are kept)", onClick: () => store.composeNow(false) }, "COMPOSE");
  const undo = h("button", { class: "icon-button", type: "button", title: "Undo (Ctrl/Cmd+Z)", onClick: () => store.undo() }, "Undo");
  const redo = h("button", { class: "icon-button", type: "button", title: "Redo (Ctrl/Cmd+Shift+Z)", onClick: () => store.redo() }, "Redo");
  const LOCKS: { d: LockDomain; label: string; title: string }[] = [
    { d: "harmony", label: "Harmony", title: "Keep the chord timeline" },
    { d: "melody", label: "Melody", title: "Keep the principal lines (and harmonise around them)" },
    { d: "rhythm", label: "Rhythm", title: "Keep every part's onsets; re-fit pitches" },
    { d: "arrangement", label: "Arrangement", title: "Keep form, sections and who plays where" },
    { d: "instruments", label: "Instruments", title: "Keep lineup, roles and sound design" },
  ];
  const lockBtns = LOCKS.map((l) => h("button", { class: "lock-chip", type: "button", title: l.title, "aria-pressed": "false", onClick: () => store.setLock(l.d, !store.locks[l.d]) }, icon("lock"), l.label));
  const notice = h("div", { class: "ens-notice", hidden: true, role: "status" });
  let noticeTimer = 0;
  store.events.on("notice", ({ text, kind }) => {
    notice.textContent = text;
    notice.className = `ens-notice${kind === "warn" ? " warn" : ""}`;
    notice.hidden = false;
    window.clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(() => (notice.hidden = true), 6000);
  });

  function refresh(): void {
    const st = s();
    const plan = store.plan;
    modeBtns.forEach((b, i) => {
      const on = (i === 0 ? "arrangement" : "endless") === st.mode;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-checked", String(on));
    });
    profile.value = st.profile;
    profileHint.textContent = PROFILES[st.profile].description;
    form.options[0].textContent = autoLabel(FORMS.find((f) => f.id === plan.form)?.label ?? plan.form);
    form.value = String(st.form);
    // an endless performance walks from chapter to chapter instead of following one form
    form.toggleAttribute("disabled", st.mode === "endless");
    key.options[0].textContent = autoLabel(KEY_NAMES[plan.key]);
    key.value = String(st.key);
    scale.options[0].textContent = autoLabel(SCALES[plan.scale].name);
    scale.value = st.scale;
    meter.options[0].textContent = autoLabel(plan.meter);
    meter.value = st.meter;
    tempoAuto.classList.toggle("is-on", st.bpm === "auto");
    tempoAuto.textContent = st.bpm === "auto" ? `Auto ${plan.bpm}` : "Auto";
    lenMode.value = st.lengthMode;
    bars.hidden = st.lengthMode !== "bars" || st.mode === "endless";
    barsCustom.hidden = st.lengthMode !== "bars" || st.mode === "endless";
    duration.hidden = st.lengthMode !== "duration" || st.mode === "endless";
    lenMode.hidden = st.mode === "endless";
    if (LENGTHS.includes(st.bars)) bars.value = String(st.bars);
    if (document.activeElement !== barsCustom) barsCustom.value = String(st.bars);
    if (document.activeElement !== duration) duration.value = `${Math.floor(st.seconds / 60)}:${String(Math.round(st.seconds % 60)).padStart(2, "0")}`;
    realism.textContent = st.realism === "orff" ? "Playable" : "Extended";
    realism.classList.toggle("is-on", st.realism === "orff");
    if (document.activeElement !== seed) seed.value = String(store.composition.seeds.master);
    LOCKS.forEach((l, i) => {
      lockBtns[i].classList.toggle("is-on", store.locks[l.d]);
      lockBtns[i].setAttribute("aria-pressed", String(store.locks[l.d]));
    });
    undo.toggleAttribute("disabled", !store.canUndo());
    redo.toggleAttribute("disabled", !store.canRedo());
  }
  store.events.on("change", refresh);
  store.events.on("composed", refresh);
  refresh();

  return h(
    "div",
    { class: "panel ens-composer" },
    h("div", { class: "panel-title" }, h("span", { class: "dot" }), "Ensemble Composer"),
    h("div", { class: "ens-row" }, field("Mode", mode), field("Style", profile), h("div", { class: "ens-field", style: "flex:1;min-width:240px;" }, profileHint)),
    h(
      "div",
      { class: "ens-row" },
      field("Form", form),
      field("Key", key),
      field("Scale", scale),
      field("Meter", meter),
      h("div", { class: "row", style: "gap:6px;align-items:flex-end;" }, tempo.el, field("", tempoAuto)),
      field("Length", h("div", { class: "row", style: "gap:4px;" }, lenMode, bars, barsCustom, duration)),
      instruments.el,
      field("Ranges", realism),
    ),
    h("div", { class: "ens-row" }, knobs),
    h(
      "div",
      { class: "ens-row", style: "align-items:center;" },
      field("Seed", h("div", { class: "row", style: "gap:4px;" }, seed, dice)),
      composeBtn,
      h("div", { class: "row", style: "gap:4px;", role: "group", "aria-label": "Locks" }, h("span", { class: "field-label" }, "Locks"), ...lockBtns),
      h("div", { class: "row", style: "gap:4px;" }, undo, redo),
      notice,
    ),
  );
}
