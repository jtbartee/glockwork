import type { AppStore } from "../../state/store";
import { SCALES } from "../../audio/scales";
import { pitchClassName } from "../../utils/notes";
import { h } from "../dom";
import { knobGrid } from "../components/knobRow";
import { Switch } from "../components/Switch";
import { SelectControl } from "../components/Select";
import * as fmt from "../format";

export function buildPerformancePanel(store: AppStore): HTMLElement {
  const rootOptions = Array.from({ length: 12 }, (_, i) => ({ value: String(i), label: pitchClassName(i) }));
  const rootSelect = h("select", { class: "select-control" }) as HTMLSelectElement;
  for (const o of rootOptions) rootSelect.appendChild(h("option", { value: o.value }, o.label));
  rootSelect.value = String(store.getOrffState().root);
  rootSelect.addEventListener("change", () => store.setOrffRoot(Number(rootSelect.value)));
  store.events.on("change", () => {
    const v = String(store.getOrffState().root);
    if (rootSelect.value !== v) rootSelect.value = v;
  });

  const scaleSelect = new SelectControl(store, {
    path: "orff.scaleId",
    label: "Scale",
    options: SCALES.map((s) => ({ value: s.id, label: s.name })),
    default: "major-pentatonic",
  });

  return h(
    "div",
    { class: "panel" },
    h("div", { class: "panel-title" }, h("span", { class: "dot" }), "Performance"),
    knobGrid(store, [
      { path: "performance.transpose", label: "Transpose", min: -24, max: 24, default: 0, integer: true, step: 1, formatter: fmt.semis },
      { path: "performance.velocity", label: "Velocity", min: 0, max: 1, default: 0.85, formatter: fmt.pct },
    ]),
    h("div", { class: "section-divider" }, "Orff Mode — Scale Lock"),
    h(
      "div",
      { class: "row" },
      new Switch(store, { path: "orff.enabled", label: "Orff Mode", onLabel: "Locked", offLabel: "Chromatic" }).el,
      h("div", { class: "field-control" }, h("div", { class: "field-label" }, "Root"), rootSelect),
      scaleSelect.el,
    ),
    h(
      "p",
      { class: "hint", style: "margin-top:8px;" },
      "When Orff Mode is on, every incoming note — MIDI, keyboard, mouse, or arpeggiator — is snapped to the nearest note in the selected scale.",
    ),
  );
}
