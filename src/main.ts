import "./ui/theme.css";
import { AppStore } from "./state/store";
import { h } from "./ui/dom";
import { buildHeader } from "./ui/panels/header";
import { buildInstrumentPanel } from "./ui/panels/instrumentPanel";
import { buildPerformancePanel } from "./ui/panels/performancePanel";
import { buildArpPanel } from "./ui/panels/arpPanel";
import { buildEffectsPanel } from "./ui/panels/effectsPanel";
import { buildMidiPanel } from "./ui/panels/midiPanel";
import { buildKeyboardPanel } from "./ui/panels/keyboard";

const store = new AppStore();
void store.init();

const app = document.querySelector<HTMLDivElement>("#app")!;
app.replaceChildren(
  buildHeader(store),
  h(
    "div",
    { class: "main-grid" },
    h("div", { class: "column" }, buildInstrumentPanel(store)),
    h("div", { class: "column" }, buildPerformancePanel(store), buildArpPanel(store)),
    h("div", { class: "column col-3" }, buildEffectsPanel(store), buildMidiPanel(store)),
  ),
  buildKeyboardPanel(store),
  h(
    "p",
    { class: "footer-note" },
    "GLOCKWORK — a mallet & Orff instrument sound laboratory. Synthesized entirely in the browser, no sample libraries. MIT licensed.",
  ),
);

// Expose for debugging in the console; harmless in production.
(window as unknown as { glockwork: AppStore }).glockwork = store;
