import type { AppStore } from "../../state/store";
import { ARP_RATES } from "../../audio/arpeggiator";
import { h } from "../dom";
import { knobGrid } from "../components/knobRow";
import { Switch } from "../components/Switch";
import { SegButtons } from "../components/SegButtons";
import * as fmt from "../format";

function section(store: AppStore, title: string, onPath: string, body: HTMLElement[]): HTMLElement {
  return h(
    "div",
    { class: "fx-section" },
    h("div", { class: "row", style: "justify-content:space-between;align-items:center;" }, h("div", { class: "section-divider", style: "margin:0;border:none;padding:0;" }, title), new Switch(store, { path: onPath, label: "" }).el),
    ...body,
  );
}

export function buildEffectsPanel(store: AppStore): HTMLElement {
  return h(
    "div",
    { class: "panel" },
    h("div", { class: "panel-title" }, h("span", { class: "dot" }), "Effects"),

    section(store, "Reverb", "effects.reverb.on", [
      knobGrid(store, [
        { path: "effects.reverb.mix", label: "Mix", min: 0, max: 1, default: 0.28, formatter: fmt.pct },
        { path: "effects.reverb.size", label: "Size", min: 0, max: 1, default: 0.5, formatter: fmt.pct },
        { path: "effects.reverb.decay", label: "Decay", min: 0, max: 1, default: 0.45, formatter: fmt.secFromDecay },
        { path: "effects.reverb.damping", label: "Damping", min: 0, max: 1, default: 0.4, formatter: fmt.pct },
      ]),
    ]),

    section(store, "Delay", "effects.delay.on", [
      h(
        "div",
        { class: "row", style: "margin-bottom:8px;" },
        new Switch(store, { path: "effects.delay.sync", label: "Tempo Sync" }).el,
        new Switch(store, { path: "effects.delay.pingPong", label: "Ping Pong" }).el,
      ),
      new SegButtons(store, { path: "effects.delay.rate", label: "Synced Rate", options: ARP_RATES.map((r) => ({ value: r, label: r })) }).el,
      h("div", { style: "height:8px;" }),
      knobGrid(store, [
        { path: "effects.delay.mix", label: "Mix", min: 0, max: 1, default: 0.25, formatter: fmt.pct },
        { path: "effects.delay.time", label: "Time (free)", min: 0, max: 1, default: 0.3, formatter: (v) => `${Math.round(80 + v * 1200)}ms` },
        { path: "effects.delay.feedback", label: "Feedback", min: 0, max: 0.92, default: 0.35, formatter: fmt.pct },
      ]),
    ]),

    section(store, "Chorus", "effects.chorus.on", [
      knobGrid(store, [
        { path: "effects.chorus.mix", label: "Mix", min: 0, max: 1, default: 0.25, formatter: fmt.pct },
        { path: "effects.chorus.rate", label: "Rate", min: 0, max: 1, default: 0.3, formatter: fmt.pct },
        { path: "effects.chorus.depth", label: "Depth", min: 0, max: 1, default: 0.4, formatter: fmt.pct },
      ]),
    ]),

    section(store, "Tremolo", "effects.tremolo.on", [
      new Switch(store, { path: "effects.tremolo.sync", label: "Tempo Sync" }).el,
      h("div", { style: "height:8px;" }),
      knobGrid(store, [
        { path: "effects.tremolo.rate", label: "Rate", min: 0, max: 1, default: 0.4, formatter: fmt.pct },
        { path: "effects.tremolo.depth", label: "Depth", min: 0, max: 1, default: 0.5, formatter: fmt.pct },
      ]),
    ]),

    section(store, "Phaser", "effects.phaser.on", [
      knobGrid(store, [
        { path: "effects.phaser.mix", label: "Mix", min: 0, max: 1, default: 0.35, formatter: fmt.pct },
        { path: "effects.phaser.rate", label: "Rate", min: 0, max: 1, default: 0.25, formatter: fmt.pct },
        { path: "effects.phaser.depth", label: "Depth / Feedback", min: 0, max: 1, default: 0.5, formatter: fmt.pct },
      ]),
    ]),

    section(store, "Saturation", "effects.saturation.on", [
      knobGrid(store, [{ path: "effects.saturation.amount", label: "Amount", min: 0, max: 1, default: 0.2, formatter: fmt.pct }]),
    ]),

    h("div", { class: "section-divider" }, "EQ / Tone"),
    knobGrid(store, [
      { path: "effects.eq.low", label: "Low", min: 0, max: 1, default: 0.5, formatter: (v) => `${Math.round((v - 0.5) * 28)}dB` },
      { path: "effects.eq.mid", label: "Mid", min: 0, max: 1, default: 0.5, formatter: (v) => `${Math.round((v - 0.5) * 28)}dB` },
      { path: "effects.eq.high", label: "High", min: 0, max: 1, default: 0.5, formatter: (v) => `${Math.round((v - 0.5) * 28)}dB` },
    ]),

    h("div", { class: "section-divider" }, "Master"),
    h(
      "div",
      { class: "row" },
      knobGrid(store, [{ path: "effects.master.gain", label: "Output Gain", min: 0, max: 1.5, default: 0.85, formatter: fmt.pct }]),
      new Switch(store, { path: "effects.master.limiterOn", label: "Limiter" }).el,
    ),
  );
}
