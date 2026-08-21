import type { AppStore } from "../../state/store";
import { h } from "../dom";
import { Knob, type KnobOptions } from "./Knob";

export function knobGrid(store: AppStore, specs: KnobOptions[]): HTMLElement {
  return h(
    "div",
    { class: "control-grid" },
    ...specs.map((spec) => new Knob(store, spec).el),
  );
}
