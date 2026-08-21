import type { AppStore } from "../../state/store";
import { h } from "../dom";
import { Knob } from "../components/Knob";
import { PresetModal } from "./presetModal";
import * as fmt from "../format";

export function buildHeader(store: AppStore): HTMLElement {
  const modal = new PresetModal(store);

  const presetSelect = h("select", { class: "preset-select" }) as HTMLSelectElement;
  function rebuildPresetOptions(): void {
    presetSelect.replaceChildren();
    const groups: Record<string, HTMLElement> = {};
    for (const preset of store.presets.getAll()) {
      const catLabel = preset.category[0].toUpperCase() + preset.category.slice(1);
      if (!groups[catLabel]) {
        groups[catLabel] = h("optgroup", { label: catLabel });
        presetSelect.appendChild(groups[catLabel]);
      }
      groups[catLabel].appendChild(h("option", { value: preset.id }, preset.name));
    }
    updatePresetSelection();
  }
  function updatePresetSelection(): void {
    const current = store.getCurrentPresetMeta();
    if (current.id) presetSelect.value = current.id;
    presetLabel.textContent = current.name + (current.dirty ? " •" : "");
  }
  presetSelect.addEventListener("change", () => store.loadPreset(presetSelect.value));
  const presetLabel = h("span", { class: "hint", style: "min-width:130px;" });

  const saveBtn = h(
    "button",
    { class: "icon-button", type: "button", onClick: () => quickSave() },
    "Save",
  );
  function quickSave(): void {
    const meta = store.getCurrentPresetMeta();
    if (meta.id && store.presets.isUserPreset(meta.id)) {
      store.saveCurrentAsPreset(meta.name);
    } else {
      modal.open();
    }
  }
  const presetsBtn = h("button", { class: "icon-button", type: "button", onClick: () => modal.open() }, "Presets");

  const undoBtn = h("button", { class: "icon-button", type: "button", style: "display:none;", onClick: () => { store.undoRandomize(); refreshUndo(); } }, "Undo");
  function refreshUndo(): void {
    undoBtn.style.display = store.canUndoRandomize() ? "inline-block" : "none";
  }
  const randomizeMenu = h(
    "div",
    { class: "row", style: "gap:4px;" },
    h("button", { class: "icon-button primary", type: "button", onClick: () => { store.randomize("all"); refreshUndo(); } }, "🎲 Randomize"),
    h("button", { class: "icon-button", type: "button", onClick: () => { store.randomize("instrument"); refreshUndo(); } }, "Timbre"),
    h("button", { class: "icon-button", type: "button", onClick: () => { store.randomize("effects"); refreshUndo(); } }, "FX"),
    h("button", { class: "icon-button", type: "button", onClick: () => { store.randomize("arp"); refreshUndo(); } }, "Arp"),
    undoBtn,
  );

  const led = h("span", { class: "midi-led" });
  store.midi.events.on("activity", () => {
    led.classList.add("active");
    window.setTimeout(() => led.classList.remove("active"), 100);
  });
  store.events.on("midi-changed", () => led.classList.toggle("supported", store.getMidiUiState().supported));

  const volumeKnob = new Knob(store, { path: "effects.master.gain", label: "Master", min: 0, max: 1.5, default: 0.85, formatter: fmt.pct });

  const meterFill = h("div", { class: "meter-fill" });
  startMeterLoop(store, meterFill);

  store.events.on("change", updatePresetSelection);
  store.events.on("presets-changed", rebuildPresetOptions);
  store.events.on("preset-loaded", rebuildPresetOptions);
  rebuildPresetOptions();

  return h(
    "header",
    { class: "app-header" },
    h("div", { class: "brand" }, h("span", { class: "brand-mark" }, "GLOCKWORK"), h("span", { class: "brand-sub" }, "Orff & Mallet Lab")),
    h("div", { class: "header-group" }, presetSelect, presetLabel, presetsBtn, saveBtn),
    h("div", { class: "header-group" }, randomizeMenu),
    h("div", { class: "header-group" }, led, h("span", { class: "hint" }, "MIDI")),
    h("div", { class: "header-group" }, h("div", { class: "meter" }, meterFill), volumeKnob.el),
  );
}

function startMeterLoop(store: AppStore, fill: HTMLElement): void {
  const analyser = store.engine.effects.meter;
  const buffer = new Float32Array(analyser.fftSize);
  function tick(): void {
    analyser.getFloatTimeDomainData(buffer);
    let peak = 0;
    for (let i = 0; i < buffer.length; i++) peak = Math.max(peak, Math.abs(buffer[i]));
    fill.style.width = `${Math.min(100, peak * 120)}%`;
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
