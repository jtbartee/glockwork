import type { ControlHost } from "./host";
import { h } from "../dom";

export interface SegButtonsOptions {
  path: string;
  label: string;
  options: { value: string; label: string }[];
  default?: string;
}

/** A row of mutually-exclusive buttons bound to a string store path — used where a dropdown
 * would undersell how important the choice is (arp pattern, rate, material). */
export class SegButtons {
  readonly el: HTMLElement;
  private buttons: HTMLElement[];
  private value: string;

  constructor(private store: ControlHost, private opts: SegButtonsOptions) {
    this.value = this.readValue();
    this.buttons = opts.options.map((o) =>
      h(
        "button",
        {
          class: "seg-button",
          type: "button",
          onClick: () => {
            this.value = o.value;
            this.render();
            this.store.setByPath(this.opts.path, o.value);
          },
        },
        o.label,
      ),
    );
    this.el = h("div", { class: "seg-control" }, h("div", { class: "field-label" }, opts.label), h("div", { class: "seg-row" }, ...this.buttons));
    this.render();
    store.events.on("change", () => {
      const v = this.readValue();
      if (v !== this.value) {
        this.value = v;
        this.render();
      }
    });
  }

  private readValue(): string {
    const raw = this.store.getByPath(this.opts.path);
    return typeof raw === "string" ? raw : (this.opts.default ?? this.opts.options[0]?.value ?? "");
  }

  private render(): void {
    this.buttons.forEach((btn, i) => btn.classList.toggle("is-active", this.opts.options[i].value === this.value));
  }
}
