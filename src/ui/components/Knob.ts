import type { AppStore } from "../../state/store";
import { clamp } from "../../utils/math";
import { h } from "../dom";

export interface KnobOptions {
  path: string;
  label: string;
  min: number;
  max: number;
  default: number;
  step?: number;
  integer?: boolean;
  formatter?: (v: number) => string;
}

const DRAG_PIXELS_FOR_FULL_RANGE = 160;

/** A rotary knob bound to a store dot-path: drag to change, double-click to reset,
 * right-click to arm MIDI Learn, scroll wheel for fine adjustment. */
export class Knob {
  readonly el: HTMLElement;
  private dial: HTMLElement;
  private valueEl: HTMLElement;
  private value: number;

  constructor(private store: AppStore, private opts: KnobOptions) {
    this.value = this.readValue();
    this.dial = h("div", { class: "knob-dial" }, h("div", { class: "knob-pointer" }));
    this.valueEl = h("div", { class: "knob-value" }, this.formatted());
    this.el = h(
      "div",
      { class: "knob-control", title: `${opts.label} — drag to adjust, double-click to reset, right-click for MIDI Learn` },
      this.dial,
      h("div", { class: "knob-label" }, opts.label),
      this.valueEl,
    );
    this.attach();
    this.updateVisual();
    store.events.on("change", () => this.refresh());
  }

  private readValue(): number {
    const raw = this.store.getByPath(this.opts.path);
    return typeof raw === "number" ? raw : this.opts.default;
  }

  private formatted(): string {
    return this.opts.formatter ? this.opts.formatter(this.value) : this.value.toFixed(this.opts.integer ? 0 : 2);
  }

  private updateVisual(): void {
    const { min, max } = this.opts;
    const frac = clamp((this.value - min) / (max - min || 1), 0, 1);
    const deg = -135 + frac * 270;
    this.dial.style.setProperty("--angle", `${deg}deg`);
    this.dial.style.setProperty("--fraction", `${frac}`);
    this.valueEl.textContent = this.formatted();
  }

  private refresh(): void {
    const v = this.readValue();
    if (v !== this.value) {
      this.value = v;
      this.updateVisual();
    }
  }

  private commit(v: number): void {
    const { min, max, step, integer } = this.opts;
    let next = clamp(v, min, max);
    if (integer || step) next = Math.round(next / (step ?? 1)) * (step ?? 1);
    this.value = next;
    this.updateVisual();
    this.store.setByPath(this.opts.path, next);
  }

  private attach(): void {
    const { min, max } = this.opts;
    this.dial.addEventListener("pointerdown", (e: PointerEvent) => {
      e.preventDefault();
      this.dial.setPointerCapture(e.pointerId);
      const startY = e.clientY;
      const startValue = this.value;
      const fine = e.shiftKey ? 4 : 1;
      const onMove = (ev: PointerEvent) => {
        const dy = startY - ev.clientY;
        const range = max - min;
        const delta = (dy / (DRAG_PIXELS_FOR_FULL_RANGE * fine)) * range;
        this.commit(startValue + delta);
      };
      const onUp = (ev: PointerEvent) => {
        this.dial.releasePointerCapture(ev.pointerId);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });
    this.dial.addEventListener("dblclick", () => this.commit(this.opts.default));
    this.dial.addEventListener("contextmenu", (e: Event) => {
      e.preventDefault();
      this.store.beginMidiLearn(this.opts.path, min, max, this.opts.label);
    });
    this.dial.addEventListener(
      "wheel",
      (e: WheelEvent) => {
        e.preventDefault();
        const step = this.opts.step ?? (max - min) / 100;
        this.commit(this.value + (e.deltaY < 0 ? step : -step));
      },
      { passive: false },
    );
  }
}
