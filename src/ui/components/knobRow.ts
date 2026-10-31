import type { ControlHost } from "./host";
import { h } from "../dom";
import { Knob, type KnobOptions } from "./Knob";

export function knobGrid(store: ControlHost, specs: KnobOptions[]): HTMLElement {
  return h(
    "div",
    { class: "control-grid" },
    ...specs.map((spec) => new Knob(store, spec).el),
  );
}
