import { FACTORY_PRESETS } from "./factoryPresets";
import { parsePresetJSON, presetToJSON, sanitizePreset, type GlockworkPreset, type ImportResult } from "./schema";
import { uid } from "../utils/math";

const USER_PRESETS_KEY = "glockwork.userPresets.v1";

/** Owns the factory preset list plus locally-stored user presets (localStorage), and every
 * JSON import/export path. Nothing here ever throws on bad input. */
export class PresetManager {
  private userPresets: GlockworkPreset[] = [];

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(USER_PRESETS_KEY);
      if (!raw) return;
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) this.userPresets = arr.map((p) => sanitizePreset(p, "Untitled"));
    } catch {
      this.userPresets = [];
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(USER_PRESETS_KEY, JSON.stringify(this.userPresets));
    } catch {
      /* storage unavailable or full — user presets simply won't persist this session */
    }
  }

  getFactoryPresets(): GlockworkPreset[] {
    return FACTORY_PRESETS;
  }

  getUserPresets(): GlockworkPreset[] {
    return this.userPresets.slice();
  }

  getAll(): GlockworkPreset[] {
    return [...FACTORY_PRESETS, ...this.userPresets];
  }

  findById(id: string): GlockworkPreset | undefined {
    return this.getAll().find((p) => p.id === id);
  }

  /** Saves as a new user preset (or overwrites an existing user preset with the same id). */
  saveAsUserPreset(preset: GlockworkPreset, name: string): GlockworkPreset {
    const isExistingUserPreset = this.userPresets.some((p) => p.id === preset.id);
    const toSave: GlockworkPreset = { ...preset, id: isExistingUserPreset ? preset.id : uid("user"), name, category: "user" };
    const idx = this.userPresets.findIndex((p) => p.id === toSave.id);
    if (idx >= 0) this.userPresets[idx] = toSave;
    else this.userPresets.push(toSave);
    this.persist();
    return toSave;
  }

  rename(id: string, newName: string): boolean {
    const preset = this.userPresets.find((p) => p.id === id);
    if (!preset) return false;
    preset.name = newName;
    this.persist();
    return true;
  }

  delete(id: string): boolean {
    const before = this.userPresets.length;
    this.userPresets = this.userPresets.filter((p) => p.id !== id);
    if (this.userPresets.length !== before) {
      this.persist();
      return true;
    }
    return false;
  }

  isUserPreset(id: string): boolean {
    return this.userPresets.some((p) => p.id === id);
  }

  importJSON(text: string): ImportResult {
    const result = parsePresetJSON(text);
    if (!result.preset) return result;
    const saved = this.saveAsUserPreset({ ...result.preset, id: uid("user") }, result.preset.name);
    return { preset: saved, error: null };
  }

  exportJSON(preset: GlockworkPreset): string {
    return presetToJSON(preset);
  }
}
