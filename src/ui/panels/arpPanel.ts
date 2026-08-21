import type { AppStore } from "../../state/store";
import { ARP_PATTERNS, ARP_RATES } from "../../audio/arpeggiator";
import { h } from "../dom";
import { knobGrid } from "../components/knobRow";
import { Switch } from "../components/Switch";
import { SegButtons } from "../components/SegButtons";
import { Knob } from "../components/Knob";
import * as fmt from "../format";

const PATTERN_LABELS: Record<string, string> = {
  up: "Up",
  down: "Down",
  "up-down": "Up/Down",
  "down-up": "Down/Up",
  played: "Played",
  random: "Random",
  chord: "Chord",
};

export function buildArpPanel(store: AppStore): HTMLElement {
  const patternSeg = new SegButtons(store, {
    path: "arp.pattern",
    label: "Pattern",
    options: ARP_PATTERNS.map((p) => ({ value: p, label: PATTERN_LABELS[p] })),
  });
  const rateSeg = new SegButtons(store, {
    path: "arp.rate",
    label: "Rate",
    options: ARP_RATES.map((r) => ({ value: r, label: r })),
  });
  const bpmKnob = new Knob(store, { path: "transport.bpm", label: "BPM", min: 40, max: 240, default: 96, step: 1, integer: true, formatter: fmt.bpmFmt });

  return h(
    "div",
    { class: "panel" },
    h("div", { class: "panel-title" }, h("span", { class: "dot" }), "Arpeggiator"),
    h(
      "div",
      { class: "row", style: "margin-bottom:10px;" },
      new Switch(store, { path: "arp.on", label: "Arp" }).el,
      new Switch(store, { path: "arp.latch", label: "Latch" }).el,
      new Switch(store, { path: "arp.letRing", label: "Note Length", onLabel: "Full Ring", offLabel: "Gated" }).el,
      new Switch(store, { path: "arp.useScaleLock", label: "Scale Lock" }).el,
      bpmKnob.el,
    ),
    rateSeg.el,
    h("div", { style: "height:8px;" }),
    patternSeg.el,
    h("div", { class: "section-divider" }, "Feel"),
    knobGrid(store, [
      { path: "arp.octaveRange", label: "Octave Range", min: 1, max: 4, default: 1, integer: true, step: 1, formatter: (v) => `${Math.round(v)}` },
      { path: "arp.gateLength", label: "Gate Length", min: 0.05, max: 1, default: 0.6, formatter: fmt.pct },
      { path: "arp.swing", label: "Swing", min: 0, max: 1, default: 0, formatter: fmt.pct },
      { path: "arp.velocity", label: "Velocity", min: 0, max: 1, default: 0.8, formatter: fmt.pct },
      { path: "arp.velocityVariation", label: "Velocity Var.", min: 0, max: 1, default: 0.15, formatter: fmt.pct },
      { path: "arp.probability", label: "Probability", min: 0, max: 1, default: 1, formatter: fmt.pct },
      { path: "arp.humanize", label: "Humanize", min: 0, max: 1, default: 0.05, formatter: fmt.pct },
    ]),
    h(
      "p",
      { class: "hint", style: "margin-top:8px;" },
      "Hold a chord to arpeggiate it. Combine Latch with Scale Lock for evolving, hands-free minimalist mallet patterns.",
    ),
  );
}
