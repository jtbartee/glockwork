import type { AppStore } from "../../state/store";
import { INSTRUMENTS, MATERIAL_LABELS } from "../../audio/instruments";
import { h } from "../dom";
import { knobGrid } from "../components/knobRow";
import { SegButtons } from "../components/SegButtons";
import { Switch } from "../components/Switch";
import * as fmt from "../format";

const CATEGORY_LABEL: Record<string, string> = { orff: "Orff Instruments", mallet: "Mallet & Percussion", experimental: "Experimental" };

export function buildInstrumentPanel(store: AppStore): HTMLElement {
  const select = h("select", { class: "select-control", style: "min-width:220px;font-size:0.85rem;" }) as HTMLSelectElement;
  for (const cat of ["orff", "mallet", "experimental"]) {
    const group = h("optgroup", { label: CATEGORY_LABEL[cat] });
    for (const inst of INSTRUMENTS.filter((i) => i.category === cat)) {
      group.appendChild(h("option", { value: inst.id }, inst.name));
    }
    select.appendChild(group);
  }
  select.value = store.getEngineParams().instrumentId;
  select.addEventListener("change", () => store.setInstrument(select.value));

  const description = h("p", { class: "hint", style: "margin:6px 0 12px;" }, describeInstrument(store));

  store.events.on("change", () => {
    const id = store.getEngineParams().instrumentId;
    if (select.value !== id) select.value = id;
    description.textContent = describeInstrument(store);
  });

  const materialSeg = new SegButtons(store, {
    path: "engine.bar.material",
    label: "Material",
    options: Object.entries(MATERIAL_LABELS).map(([value, label]) => ({ value, label })),
  });

  return h(
    "div",
    { class: "panel" },
    h("div", { class: "panel-title" }, h("span", { class: "dot" }), "Instrument"),
    h("div", { class: "row", style: "margin-bottom:4px;" }, select),
    description,

    h("div", { class: "section-divider" }, "Strike"),
    knobGrid(store, [
      { path: "engine.strike.hardness", label: "Mallet Hardness", min: 0, max: 1, default: 0.5, formatter: fmt.pct },
      { path: "engine.strike.attack", label: "Attack / Transient", min: 0, max: 1, default: 0.4, formatter: fmt.pct },
      { path: "engine.strike.strikeNoise", label: "Strike Noise", min: 0, max: 1, default: 0.25, formatter: fmt.pct },
      { path: "engine.strike.velocitySensitivity", label: "Velocity Sens.", min: 0, max: 1, default: 0.7, formatter: fmt.pct },
    ]),

    h("div", { class: "section-divider" }, "Bar / Resonator"),
    materialSeg.el,
    h("div", { style: "height:8px;" }),
    knobGrid(store, [
      { path: "engine.bar.brightness", label: "Brightness", min: 0, max: 1, default: 0.5, formatter: fmt.pct },
      { path: "engine.bar.damping", label: "Damping", min: 0, max: 1, default: 0.4, formatter: fmt.pct },
      { path: "engine.bar.decay", label: "Decay", min: 0, max: 1, default: 0.45, formatter: fmt.secFromDecay },
      { path: "engine.bar.resonance", label: "Resonance", min: 0, max: 1, default: 0.3, formatter: fmt.pct },
      { path: "engine.bar.inharmonicity", label: "Inharmonicity", min: 0, max: 1, default: 0.15, formatter: fmt.pct },
      { path: "engine.bar.bodySize", label: "Body Size", min: 0, max: 1, default: 0.4, formatter: fmt.pct },
      { path: "engine.bar.bodyResonance", label: "Body Resonance", min: 0, max: 1, default: 0.25, formatter: fmt.pct },
      { path: "engine.bar.fundamentalLevel", label: "Fundamental Lvl", min: 0, max: 1.5, default: 0.85, formatter: fmt.pct },
      { path: "engine.bar.partialAmount", label: "Overtone Amount", min: 0, max: 1.5, default: 0.6, formatter: fmt.pct },
    ]),

    h("div", { class: "section-divider" }, "Tone"),
    knobGrid(store, [
      { path: "engine.tone.filterCutoff", label: "Filter Cutoff", min: 0, max: 1, default: 0.75, formatter: fmt.hzFromCutoff },
      { path: "engine.tone.filterResonance", label: "Filter Resonance", min: 0, max: 1, default: 0.15, formatter: fmt.qFmt },
      { path: "engine.tone.hfDamping", label: "HF Damping", min: 0, max: 1, default: 0.3, formatter: fmt.pct },
      { path: "engine.tone.warmth", label: "Warmth", min: 0, max: 1, default: 0.3, formatter: fmt.pct },
    ]),

    h("div", { class: "section-divider" }, "Pitch"),
    knobGrid(store, [
      { path: "engine.pitch.octave", label: "Octave", min: -3, max: 3, default: 0, integer: true, step: 1, formatter: fmt.octaves },
      { path: "engine.pitch.semitone", label: "Semitone", min: -12, max: 12, default: 0, integer: true, step: 1, formatter: fmt.semis },
      { path: "engine.pitch.fine", label: "Fine Tune", min: -100, max: 100, default: 0, integer: true, step: 1, formatter: fmt.cents },
    ]),

    h("div", { class: "section-divider" }, "Stereo"),
    knobGrid(store, [
      { path: "engine.stereo.width", label: "Stereo Width", min: 0, max: 1, default: 0.4, formatter: fmt.pct },
      { path: "engine.stereo.voiceSpread", label: "Voice Spread", min: 0, max: 1, default: 0.3, formatter: fmt.pct },
      { path: "engine.stereo.panRandom", label: "Pan Random", min: 0, max: 1, default: 0.15, formatter: fmt.pct },
    ]),

    h("div", { class: "section-divider" }, "Motor (Vibrato / Tremolo)"),
    new Switch(store, { path: "engine.motor.on", label: "Motor" }).el,
    h("div", { style: "height:8px;" }),
    knobGrid(store, [
      { path: "engine.motor.speed", label: "Motor Speed", min: 0, max: 1, default: 0.35, formatter: fmt.hzFromMotor },
      { path: "engine.motor.depth", label: "Motor Depth", min: 0, max: 1, default: 0.5, formatter: fmt.pct },
    ]),

    h("div", { class: "section-divider" }, "FM Shimmer"),
    new Switch(store, { path: "engine.fm.enabled", label: "FM" }).el,
    h("div", { style: "height:8px;" }),
    knobGrid(store, [
      { path: "engine.fm.ratio", label: "FM Ratio", min: 0.1, max: 12, default: 3, step: 0.01, formatter: fmt.ratioFmt },
      { path: "engine.fm.index", label: "FM Index", min: 0, max: 1, default: 0.2, formatter: fmt.pct },
    ]),
  );
}

function describeInstrument(store: AppStore): string {
  const inst = INSTRUMENTS.find((i) => i.id === store.getEngineParams().instrumentId);
  return inst?.description ?? "";
}
