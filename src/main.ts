import "./ui/theme.css";
import { AppStore } from "./state/store";
import { EnsembleStore } from "./ensemble/store";
import { h } from "./ui/dom";
import { buildHeader } from "./ui/panels/header";
import { buildInstrumentPanel } from "./ui/panels/instrumentPanel";
import { buildPerformancePanel } from "./ui/panels/performancePanel";
import { buildArpPanel } from "./ui/panels/arpPanel";
import { buildEffectsPanel } from "./ui/panels/effectsPanel";
import { buildMidiPanel } from "./ui/panels/midiPanel";
import { buildKeyboardPanel } from "./ui/panels/keyboard";
import { buildEnsembleWorkspace } from "./ui/ensemble/workspace";
import { ensembleGet, ensembleSet } from "./ui/ensemble/host";
import { analyse } from "./compose/analysis";
import { compose, defaultSettings, seedsFrom } from "./compose/composer";
import { auditBuffer, renderComposition, renderStems } from "./ensemble/render";
import { encodeWav } from "./ensemble/wav";
import { compositionToMidi } from "./ensemble/midi";
import { serializeProject } from "./ensemble/project";
import { EndlessComposer } from "./compose/endless";

const store = new AppStore();
void store.init();

// The ENSEMBLE workspace shares the Sound Lab's AudioContext (and its gesture-resume), so a player
// can play along on the keyboard or a MIDI controller while the ensemble performs.
const ensemble = new EnsembleStore(store.engine.ctx);
store.registerPathDelegate("ensemble", { get: (p) => ensembleGet(ensemble, p), set: (p, v) => ensembleSet(ensemble, p, v) });

const lab = h(
  "div",
  { class: "workspace-lab" },
  h(
    "div",
    { class: "main-grid" },
    h("div", { class: "column" }, buildInstrumentPanel(store)),
    h("div", { class: "column" }, buildPerformancePanel(store), buildArpPanel(store)),
    h("div", { class: "column col-3" }, buildEffectsPanel(store), buildMidiPanel(store)),
  ),
  buildKeyboardPanel(store),
);
const ens = buildEnsembleWorkspace(ensemble, store);

type Workspace = "lab" | "ensemble";
const WS_KEY = "glockwork.workspace";
const tabButtons: Record<Workspace, HTMLElement> = {
  lab: h("button", { class: "workspace-tab", type: "button", role: "tab", onClick: () => show("lab") }, "Sound Lab"),
  ensemble: h("button", { class: "workspace-tab", type: "button", role: "tab", onClick: () => show("ensemble") }, "Ensemble"),
};
const tabs = h("div", { class: "workspace-tabs", role: "tablist", "aria-label": "Workspace" }, tabButtons.lab, tabButtons.ensemble);
const header = buildHeader(store, tabs);

function show(ws: Workspace): void {
  lab.hidden = ws !== "lab";
  ens.setVisible(ws === "ensemble");
  for (const g of header.querySelectorAll<HTMLElement>(".lab-only")) g.hidden = ws !== "lab";
  for (const [k, b] of Object.entries(tabButtons)) {
    b.classList.toggle("is-active", k === ws);
    b.setAttribute("aria-selected", String(k === ws));
  }
  try {
    localStorage.setItem(WS_KEY, ws);
  } catch {
    /* storage unavailable */
  }
  if (location.hash !== (ws === "ensemble" ? "#ensemble" : "")) history.replaceState(null, "", ws === "ensemble" ? "#ensemble" : location.pathname + location.search);
}

const app = document.querySelector<HTMLDivElement>("#app")!;
app.replaceChildren(
  header,
  lab,
  ens.el,
  h(
    "p",
    { class: "footer-note" },
    "GLOCKWORK — a mallet & Orff instrument sound laboratory and ensemble composer. Synthesized entirely in the browser, no sample libraries. MIT licensed.",
  ),
);

let initial: Workspace = location.hash === "#ensemble" ? "ensemble" : "lab";
try {
  if (!location.hash && localStorage.getItem(WS_KEY) === "ensemble") initial = "ensemble";
} catch {
  /* storage unavailable */
}
show(initial);
void ensemble.restore();

// Expose for debugging in the console; harmless in production.
(window as unknown as { glockwork: AppStore; glockworkEnsemble: EnsembleStore }).glockwork = store;
(window as unknown as { glockworkEnsemble: EnsembleStore }).glockworkEnsemble = ensemble;
(window as unknown as { glockworkEnsembleLab: unknown }).glockworkEnsembleLab = { compose, defaultSettings, seedsFrom, analyse, renderComposition, renderStems, auditBuffer, encodeWav, compositionToMidi, serializeProject, EndlessComposer };
