import type { ControlHost } from "./host";
import { h } from "../dom";

export interface SwitchOptions {
  path: string;
  label: string;
  default?: boolean;
  onLabel?: string;
  offLabel?: string;
}

/** A tactile on/off toggle bound to a boolean store path. */
export class Switch {
  readonly el: HTMLElement;
  private button: HTMLElement;
  private value: boolean;

  constructor(private store: ControlHost, private opts: SwitchOptions) {
    this.value = this.readValue();
    this.button = h("button", { class: "switch-button", type: "button" }, this.stateLabel());
    this.el = h("div", { class: "switch-control" }, h("div", { class: "switch-label" }, opts.label), this.button);
    this.button.addEventListener("click", () => {
      this.value = !this.value;
      this.render();
      this.store.setByPath(this.opts.path, this.value);
    });
    this.render();
    store.events.on("change", () => {
      const v = this.readValue();
      if (v !== this.value) {
        this.value = v;
        this.render();
      }
    });
  }

  private readValue(): boolean {
    const raw = this.store.getByPath(this.opts.path);
    return typeof raw === "boolean" ? raw : (this.opts.default ?? false);
  }

  private stateLabel(): string {
    return this.value ? (this.opts.onLabel ?? "On") : (this.opts.offLabel ?? "Off");
  }

  private render(): void {
    this.button.textContent = this.stateLabel();
    this.button.classList.toggle("is-on", this.value);
  }
}
