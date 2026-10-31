import type { ControlHost } from "./host";
import { h } from "../dom";

export interface SelectOptions {
  path: string;
  label: string;
  options: { value: string; label: string }[];
  default?: string;
  onChange?: (value: string) => void;
}

/** A labelled dropdown bound to a string store path. */
export class SelectControl {
  readonly el: HTMLElement;
  private select: HTMLSelectElement;

  constructor(private store: ControlHost, private opts: SelectOptions) {
    this.select = h(
      "select",
      { class: "select-control" },
      ...opts.options.map((o) => h("option", { value: o.value }, o.label)),
    ) as HTMLSelectElement;
    this.el = h("div", { class: "field-control" }, h("div", { class: "field-label" }, opts.label), this.select);
    this.select.value = this.readValue();
    this.select.addEventListener("change", () => {
      this.store.setByPath(this.opts.path, this.select.value);
      this.opts.onChange?.(this.select.value);
    });
    store.events.on("change", () => {
      const v = this.readValue();
      if (this.select.value !== v) this.select.value = v;
    });
  }

  private readValue(): string {
    const raw = this.store.getByPath(this.opts.path);
    return typeof raw === "string" ? raw : (this.opts.default ?? this.opts.options[0]?.value ?? "");
  }
}
