import { ROLE_LABELS } from "../../compose/roles";
import type { EnsembleStore } from "../../ensemble/store";
import type { AppStore } from "../../state/store";
import { KEY_NAMES, SCALES } from "../../theory/scales";
import { knobGrid } from "../components/knobRow";
import { h } from "../dom";
import * as fmt from "../format";
import { buildInstrumentPanel } from "../panels/instrumentPanel";
import { EnsembleHost, TrackHost } from "./host";

const LANGUAGE: Record<string, string> = {
  bordun: "Bordun (tonic drone)", shifting: "Shifting chords", modal: "Modal", functional: "Functional", pedal: "Pedal point",
  drone: "Drone colours", sparse: "Slow common-tone", planing: "Planing", chromatic: "Chromatic mediants",
};
const IMITATION: Record<string, string> = { none: "—", echo: "Echo", call: "Call & response", canon: "Canon", hocket: "Hocket", imitation: "Imitation", parallel: "Parallel", heterophony: "Heterophony" };

export interface SidePanel {
  el: HTMLElement;
  showSound(trackId: string): void;
}

export function buildSidePanel(store: EnsembleStore, app: AppStore): SidePanel {
  const ens = new EnsembleHost(store, app);
  let tab: "sound" | "plan" = "plan";
  const soundBody = h("div", { class: "side-scroll" });
  const planBody = h("div", { class: "side-scroll" });
  const tabs = (["plan", "sound"] as const).map((t) => h("button", { class: "seg-button", type: "button", onClick: () => setTab(t) }, t === "plan" ? "Score plan" : "Sound"));
  let host: TrackHost | null = null;
  let soundFor: string | null = null;

  function setTab(t: "sound" | "plan"): void {
    tab = t;
    tabs.forEach((b, i) => b.classList.toggle("is-active", (i === 0 ? "plan" : "sound") === t));
    soundBody.hidden = t !== "sound";
    planBody.hidden = t !== "plan";
    if (t === "sound") buildSound();
    else buildPlan();
  }

  function buildSound(): void {
    const t = store.track(store.selectedTrack);
    if (!t) {
      soundBody.replaceChildren(h("p", { class: "hint" }, "Select a track."));
      return;
    }
    if (soundFor === t.id && soundBody.childElementCount) return;
    host?.dispose();
    host = new TrackHost(store, app, t.id);
    soundFor = t.id;
    const damp = h("select", { class: "select-control", title: "Auto: sustaining bars are damped by hand where a part's notes end; textures ring" }, h("option", { value: "auto" }, "Auto damping"), h("option", { value: "damp" }, "Damp at note end"), h("option", { value: "ring" }, "Let every bar ring")) as HTMLSelectElement;
    damp.value = t.damp;
    damp.addEventListener("change", () => store.setTrackDamp(t.id, damp.value as typeof t.damp));
    soundBody.replaceChildren(
      h("div", { class: "row", style: "margin-bottom:8px;" }, h("b", { style: "font-size:0.78rem;color:var(--wood);" }, t.name), h("span", { class: "hint" }, ROLE_LABELS[t.role]), damp),
      knobGrid(ens, [
        { path: `track.${t.id}.mix.gain`, label: "Volume", min: 0, max: 1.6, default: 0.8, formatter: fmt.pct },
        { path: `track.${t.id}.mix.pan`, label: "Pan", min: -1, max: 1, default: 0, formatter: (v) => (Math.abs(v) < 0.02 ? "C" : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`) },
        { path: `track.${t.id}.mix.reverb`, label: "Reverb Send", min: 0, max: 1, default: 0.25, formatter: fmt.pct },
        { path: `track.${t.id}.mix.delay`, label: "Echo Send", min: 0, max: 1, default: 0, formatter: fmt.pct },
      ]),
      buildInstrumentPanel(host),
    );
  }

  function buildPlan(): void {
    const c = store.composition;
    const p = c.plan;
    const a = store.analysis();
    const nameOf = (id: string | null) => (id ? c.tracks.find((t) => t.id === id)?.name ?? id : "—");
    const pos = store.transport.position();
    const rows = p.sections.slice(0, 80).map((s) => {
      const active = Object.entries(s.parts).filter(([, x]) => x.technique).length;
      const cur = pos >= s.startBar * store.bb && pos < (s.startBar + s.bars) * store.bb;
      return h(
        "tr",
        { class: cur ? "is-current" : "" },
        h("td", {}, h("b", {}, s.label), h("div", { class: "hint" }, s.name)),
        h("td", {}, `${s.startBar + 1}–${s.startBar + s.bars}`),
        h("td", {}, LANGUAGE[s.language] ?? s.language, h("div", { class: "hint" }, `${KEY_NAMES[s.key]} ${SCALES[s.scale].name}`)),
        h("td", {}, h("span", { class: "intensity-bar", style: `width:${Math.round(s.intensity * 40)}px;` })),
        h("td", {}, nameOf(s.carrier), h("div", { class: "hint" }, IMITATION[s.imitation.kind] + (s.imitation.followers.length ? ` → ${s.imitation.followers.map(nameOf).join(", ")}` : ""))),
        h("td", {}, `${active}/${c.tracks.length}`),
      );
    });
    const themes = Object.values(p.themes).map((t) => h("li", {}, h("b", {}, t.id), ` — ${t.motif.notes.length} notes over ${t.bars} bar${t.bars > 1 ? "s" : ""}; ${t.origin}`));
    const pct = (x: number) => `${Math.round(x * 100)}%`;
    planBody.replaceChildren(
      h("p", { class: "hint", style: "margin:0 0 6px;" }, `${c.name} · ${p.form} form · ${KEY_NAMES[p.key]} ${SCALES[p.scale].name} · ${p.meter} · ${p.bpm} bpm · ${p.behavior} harmony`),
      h("table", { class: "plan-table" }, h("thead", {}, h("tr", {}, ...["Section", "Bars", "Harmony", "Intensity", "Principal line", "Parts"].map((x) => h("th", {}, x)))), h("tbody", {}, ...rows)),
      h("div", { class: "section-divider" }, "Themes"),
      h("ul", { class: "hint", style: "margin:0;padding-left:16px;" }, ...themes),
      h("div", { class: "section-divider" }, "Measured (not a verdict on how it sounds)"),
      h(
        "div",
        { class: "metric-grid" },
        h("div", {}, "Chord tones on strong beats ", h("b", {}, pct(a.chordToneStrong))),
        h("div", {}, "Notes outside the scale ", h("b", {}, String(a.outOfScale))),
        h("div", {}, "Semitone rubs / 100 onsets ", h("b", {}, a.clashesPer100.toFixed(1))),
        h("div", {}, "Cadences that land ", h("b", {}, pct(a.cadenceAccuracy))),
        h("div", {}, "Parts playing (mean / max) ", h("b", {}, `${a.meanActive.toFixed(1)} / ${a.maxActive}`)),
        h("div", {}, "Bars with everyone playing ", h("b", {}, pct(a.tuttiBars))),
        h("div", {}, "Returns like their theme ", h("b", {}, pct(a.returnSimilarity))),
        h("div", {}, "Contrasting themes alike ", h("b", {}, pct(a.contrastSimilarity))),
        h("div", {}, "Distinct textures ", h("b", {}, String(a.distinctTextures))),
        h("div", {}, "Peak sounding voices ", h("b", {}, String(a.peakVoices))),
      ),
    );
  }

  let planTimer = 0;
  const refreshPlan = () => {
    if (tab !== "plan") return;
    window.clearTimeout(planTimer);
    planTimer = window.setTimeout(buildPlan, 120);
  };
  store.events.on("composed", () => {
    soundFor = null;
    if (tab === "sound") buildSound();
    refreshPlan();
  });
  store.events.on("notes", refreshPlan);
  store.events.on("selection", () => {
    if (tab === "sound") buildSound();
  });
  let lastSection = -1;
  window.setInterval(() => {
    if (tab !== "plan" || !store.transport.isPlaying()) return;
    const pos = store.transport.position();
    const i = store.plan.sections.findIndex((s) => pos >= s.startBar * store.bb && pos < (s.startBar + s.bars) * store.bb);
    if (i !== lastSection) {
      lastSection = i;
      buildPlan();
    }
  }, 500);
  setTab("plan");

  const el = h("div", { class: "panel" }, h("div", { class: "side-tabs" }, ...tabs), soundBody, planBody);
  return {
    el,
    showSound(trackId: string) {
      store.selectTrack(trackId);
      soundFor = null;
      setTab("sound");
    },
  };
}
