import "./ensemble.css";
import type { EnsembleStore } from "../../ensemble/store";
import type { AppStore } from "../../state/store";
import { h } from "../dom";
import { buildArrangement } from "./arrangement";
import { buildComposerPanel } from "./composerPanel";
import { buildPianoRoll } from "./pianoRoll";
import { buildSidePanel } from "./sidePanel";
import { buildTransportBar } from "./transportBar";

export interface EnsembleWorkspace {
  el: HTMLElement;
  setVisible(on: boolean): void;
}

export function buildEnsembleWorkspace(store: EnsembleStore, app: AppStore): EnsembleWorkspace {
  const side = buildSidePanel(store, app);
  const composer = buildComposerPanel(store, app);
  const transport = buildTransportBar(store, app);
  const arrangement = buildArrangement(store, (id) => side.showSound(id));
  const roll = buildPianoRoll(store);
  const el = h("section", { class: "ens", "aria-label": "Ensemble workspace" }, composer, transport.el, arrangement.el, h("div", { class: "ens-lower" }, roll.el, side.el));
  let visible = false;

  const loop = () => {
    if (visible) {
      const follow = transport.follow();
      transport.frame();
      arrangement.frame(follow);
      roll.frame(follow);
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  window.addEventListener("keydown", (e) => {
    if (!visible) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
    const mod = e.ctrlKey || e.metaKey;
    if (e.code === "Space" && !mod) {
      e.preventDefault();
      store.toggle();
    } else if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) store.redo();
      else store.undo();
    } else if (mod && e.key.toLowerCase() === "y") {
      e.preventDefault();
      store.redo();
    } else if (e.key === "Home") {
      e.preventDefault();
      store.seek(store.loop.on ? store.loop.start : 0);
    }
  });

  return {
    el,
    setVisible(on: boolean) {
      visible = on;
      el.hidden = !on;
      if (on) {
        arrangement.invalidate();
        roll.invalidate();
      }
    },
  };
}
