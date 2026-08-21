import type { AppStore } from "../../state/store";
import { h, clear } from "../dom";

const CATEGORY_LABEL: Record<string, string> = { orff: "Orff", mallet: "Mallet", ambient: "Ambient", experimental: "Experimental", user: "User" };

export class PresetModal {
  readonly el: HTMLElement;
  private backdrop: HTMLElement;
  private nameInput: HTMLInputElement;
  private list: HTMLElement;
  private status: HTMLElement;
  private importBox: HTMLTextAreaElement;
  private fileInput: HTMLInputElement;

  constructor(private store: AppStore) {
    this.nameInput = h("input", { type: "text", class: "select-control", style: "flex:1;" }) as HTMLInputElement;
    this.list = h("div", { class: "preset-list" });
    this.status = h("div", { style: "display:none;" });
    this.importBox = h("textarea", { class: "json-box", placeholder: "Paste preset JSON here…" }) as HTMLTextAreaElement;
    this.fileInput = h("input", { type: "file", accept: "application/json,.json" }) as HTMLInputElement;

    const saveBtn = h(
      "button",
      { class: "icon-button primary", type: "button", onClick: () => this.saveCurrent() },
      "Save As Preset",
    );
    const exportCurrentBtn = h(
      "button",
      { class: "icon-button", type: "button", onClick: () => this.exportCurrent() },
      "Export Current JSON",
    );
    const importBtn = h("button", { class: "icon-button", type: "button", onClick: () => this.importText() }, "Import JSON");
    const closeBtn = h("button", { class: "icon-button", type: "button", onClick: () => this.close() }, "Close");

    this.fileInput.addEventListener("change", async () => {
      const file = this.fileInput.files?.[0];
      if (!file) return;
      const text = await file.text();
      this.importBox.value = text;
      this.importText();
    });

    this.el = h(
      "div",
      { class: "modal" },
      h("h2", {}, "Presets"),
      h("div", { class: "row" }, this.nameInput, saveBtn),
      h("p", { class: "hint" }, "Rename by typing a new name above and saving — this always creates or updates a user preset; factory presets are read-only."),
      this.list,
      h("div", { class: "section-divider" }, "Import / Export"),
      h("div", { class: "row" }, exportCurrentBtn, this.fileInput),
      this.importBox,
      h("div", { class: "row", style: "margin-top:6px;" }, importBtn),
      this.status,
      h("div", { class: "row", style: "justify-content:flex-end;margin-top:10px;" }, closeBtn),
    );
    this.backdrop = h("div", { class: "modal-backdrop", style: "display:none;", onClick: (e: MouseEvent) => { if (e.target === this.backdrop) this.close(); } }, this.el);
    document.body.appendChild(this.backdrop);

    store.events.on("presets-changed", () => this.renderList());
    store.events.on("preset-loaded", () => this.renderList());
  }

  open(): void {
    this.nameInput.value = this.store.getCurrentPresetMeta().name;
    this.renderList();
    this.backdrop.style.display = "flex";
  }

  close(): void {
    this.backdrop.style.display = "none";
    this.setStatus(null);
  }

  private setStatus(msg: { ok: boolean; text: string } | null): void {
    if (!msg) {
      this.status.style.display = "none";
      return;
    }
    this.status.style.display = "block";
    this.status.className = `status-msg ${msg.ok ? "ok" : "error"}`;
    this.status.textContent = msg.text;
  }

  private saveCurrent(): void {
    const name = this.nameInput.value.trim() || "Untitled Preset";
    this.store.saveCurrentAsPreset(name);
    this.setStatus({ ok: true, text: `Saved "${name}".` });
    this.renderList();
  }

  private exportCurrent(): void {
    const name = this.nameInput.value.trim() || this.store.getCurrentPresetMeta().name;
    const json = this.store.exportCurrentPresetJSON(name);
    downloadJSON(json, name);
    this.setStatus({ ok: true, text: `Exported "${name}.json".` });
  }

  private importText(): void {
    const text = this.importBox.value.trim();
    if (!text) {
      this.setStatus({ ok: false, text: "Paste or choose a preset JSON file first." });
      return;
    }
    const result = this.store.importPresetJSON(text);
    if (result.ok && result.preset) {
      this.setStatus({ ok: true, text: `Imported "${result.preset.name}" and loaded it.` });
      this.importBox.value = "";
      this.nameInput.value = result.preset.name;
    } else {
      this.setStatus({ ok: false, text: result.error ?? "That preset file couldn't be loaded." });
    }
  }

  private renderList(): void {
    clear(this.list);
    const current = this.store.getCurrentPresetMeta();
    const all = this.store.presets.getAll();
    for (const preset of all) {
      const isUser = this.store.presets.isUserPreset(preset.id);
      const row = h(
        "div",
        { class: `preset-row ${preset.id === current.id ? "is-current" : ""}`, onClick: () => this.store.loadPreset(preset.id) },
        h("span", { class: "cat" }, CATEGORY_LABEL[preset.category] ?? preset.category),
        h("span", {}, preset.name),
        h("span", { class: "spacer" }),
        h("button", { class: "small-btn", type: "button", onClick: (e: Event) => { e.stopPropagation(); downloadJSON(this.store.exportPresetJSON(preset.id) ?? "", preset.name); } }, "export"),
        isUser ? h("button", { class: "small-btn", type: "button", onClick: (e: Event) => { e.stopPropagation(); this.deletePreset(preset.id); } }, "delete") : null,
      );
      this.list.appendChild(row);
    }
  }

  private deletePreset(id: string): void {
    this.store.deletePreset(id);
    this.setStatus({ ok: true, text: "Preset deleted." });
  }
}

function downloadJSON(json: string, name: string): void {
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: `${sanitizeFileName(name)}.json` }) as HTMLAnchorElement;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-z0-9-_]+/gi, "-").replace(/-+/g, "-").toLowerCase() || "preset";
}
