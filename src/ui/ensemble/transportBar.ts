import { formatPosition } from "../../theory/meter";
import { KEY_NAMES, SCALES } from "../../theory/scales";
import { PROJECT_EXTENSION } from "../../ensemble/project";
import type { EnsembleStore } from "../../ensemble/store";
import type { Quality } from "../../ensemble/mixer";
import type { AppStore } from "../../state/store";
import { Knob } from "../components/Knob";
import { h } from "../dom";
import * as fmt from "../format";
import { EnsembleHost } from "./host";
import { icon } from "./icons";

export function download(data: BlobPart | Blob, name: string, type: string): void {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: name }) as HTMLAnchorElement;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export const fileBase = (name: string) => name.replace(/[^\w -]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "ensemble";

const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

export interface TransportBar {
  el: HTMLElement;
  frame(): void;
  follow(): boolean;
}

export function buildTransportBar(store: EnsembleStore, app: AppStore): TransportBar {
  const host = new EnsembleHost(store, app);
  const toStart = h("button", { class: "transport-btn", type: "button", title: "Back to the start (Home)", "aria-label": "Back to start", onClick: () => store.seek(store.loop.on ? store.loop.start : 0) }, icon("start"));
  const play = h("button", { class: "transport-btn", type: "button", title: "Play / stop (Space)", "aria-label": "Play" }, icon("play"));
  play.addEventListener("click", () => store.toggle());
  const loop = h("button", { class: "transport-btn", type: "button", title: "Loop the selected region (drag on the ruler to set it)", "aria-label": "Loop", "aria-pressed": "false", onClick: () => store.setLoop({ on: !store.loop.on }) }, icon("loop"));
  let following = true;
  const follow = h("button", { class: "transport-btn is-on", type: "button", title: "Follow the playhead", "aria-label": "Follow", "aria-pressed": "true" }, icon("follow"));
  follow.addEventListener("click", () => {
    following = !following;
    follow.classList.toggle("is-on", following);
    follow.setAttribute("aria-pressed", String(following));
  });
  const pos = h("div", { class: "ens-position", "aria-live": "off" }, "1.1  0:00");
  const status = h("div", { class: "ens-status" });
  const capture = h("button", { class: "icon-button", type: "button", title: "Freeze the last minutes of the performance as an arrangement you can edit and export", onClick: () => store.capture() }, icon("capture"), " Capture");

  const quality = h("select", { class: "select-control", title: "Voice budget: more voices let long resonances overlap; fewer keep slower machines smooth" },
    h("option", { value: "performance" }, "Performance"), h("option", { value: "balanced" }, "Balanced"), h("option", { value: "high" }, "High quality")) as HTMLSelectElement;
  quality.value = store.quality;
  quality.addEventListener("change", () => store.setQuality(quality.value as Quality));
  const voices = h("span", { class: "ens-status", title: "Voices sounding" }, "0 voices");
  const meterFill = h("div");
  const meter = h("div", { class: "ens-meter", title: "Ensemble output level" }, meterFill);
  const gain = new Knob(host, { path: "master.gain", label: "Master", min: 0, max: 1.5, default: 0.9, formatter: fmt.pct });
  const reverb = new Knob(host, { path: "master.reverbDecay", label: "Reverb", min: 0, max: 1, default: 0.42, formatter: fmt.pct });
  const delayFb = new Knob(host, { path: "master.delayFeedback", label: "Echo FB", min: 0, max: 0.8, default: 0.32, formatter: fmt.pct });

  const progress = h("span", { class: "ens-progress", hidden: true });
  let abort: AbortController | null = null;
  const cancel = h("button", { class: "icon-button", type: "button", hidden: true, onClick: () => abort?.abort() }, "Cancel");
  async function run(label: string, job: (onP: (f: number) => void, signal: AbortSignal) => Promise<void>): Promise<void> {
    if (abort) return;
    abort = new AbortController();
    progress.hidden = false;
    cancel.hidden = false;
    progress.textContent = `${label}… 0%`;
    try {
      await job((f) => (progress.textContent = `${label}… ${Math.round(f * 100)}%`), abort.signal);
      progress.textContent = `${label}: done`;
    } catch (e) {
      progress.textContent = (e as Error).name === "AbortError" ? `${label}: cancelled` : `${label} failed: ${(e as Error).message}`;
    } finally {
      abort = null;
      cancel.hidden = true;
      window.setTimeout(() => (progress.hidden = true), 4000);
    }
  }
  const name = () => fileBase(store.composition.name);
  const midiBtn = h("button", { class: "icon-button", type: "button", title: "Standard MIDI file: one track per instrument, tempo, meter, key and section markers", onClick: () => download(store.exportMidi() as Uint8Array<ArrayBuffer>, `${name()}.mid`, "audio/midi") }, "MIDI");
  const wavBtn = h("button", { class: "icon-button", type: "button", title: "Render the full mix to a WAV file (the loop region only, when looping)", onClick: () => void run("WAV", async (p, sig) => download((await store.renderWav(16, p, sig)) as Uint8Array<ArrayBuffer>, `${name()}.wav`, "audio/wav")) }, "WAV");
  const stemsBtn = h("button", { class: "icon-button", type: "button", title: "Render every instrument to its own WAV file (ZIP)", onClick: () => void run("Stems", async (p, sig) => download(await store.renderStemsZip(16, p, sig), `${name()}-stems.zip`, "application/zip")) }, "Stems");
  const saveBtn = h("button", { class: "icon-button", type: "button", title: "Save the whole project: notes, instruments, sound design, seeds, structure", onClick: () => download(store.saveProject(), `${name()}${PROJECT_EXTENSION}`, "application/json") }, "Save");
  const fileInput = h("input", { type: "file", accept: ".json,application/json", hidden: true }) as HTMLInputElement;
  fileInput.addEventListener("change", async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    const err = store.loadProject(await f.text());
    store.events.emit("notice", { text: err ?? `Opened “${store.composition.name}”.`, kind: err ? "warn" : "info" });
    fileInput.value = "";
  });
  const openBtn = h("button", { class: "icon-button", type: "button", title: "Open a saved project", onClick: () => fileInput.click() }, "Open");

  function refresh(): void {
    const playing = store.transport.isPlaying();
    play.replaceChildren(icon(playing ? "stop" : "play"));
    play.classList.toggle("is-on", playing);
    play.setAttribute("aria-label", playing ? "Stop" : "Play");
    loop.classList.toggle("is-on", store.loop.on);
    loop.setAttribute("aria-pressed", String(store.loop.on));
    loop.toggleAttribute("disabled", !!store.endless);
    capture.hidden = !store.endless;
    // a performance is exported by capturing it first
    for (const b of [midiBtn, wavBtn, stemsBtn, saveBtn]) {
      b.toggleAttribute("disabled", !!store.endless);
      if (store.endless) b.title = "Capture the performance first, then export the arrangement";
    }
    quality.value = store.quality;
  }
  store.events.on("transport", refresh);
  store.events.on("composed", refresh);
  store.events.on("change", refresh);
  refresh();

  const buf = new Float32Array(store.mixer.meter.fftSize);
  function frame(): void {
    const b = store.transport.position();
    const sec = b * (60 / store.plan.bpm);
    const total = store.endless ? "∞" : clock(store.lengthBeats * (60 / store.plan.bpm));
    pos.textContent = `${formatPosition(b, store.plan.meter).padEnd(7)} ${clock(sec)} / ${total}`;
    store.mixer.meter.getFloatTimeDomainData(buf);
    let peak = 0;
    for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]));
    meterFill.style.width = `${Math.min(100, peak * 110)}%`;
    voices.textContent = `${store.mixer.activeVoices()} voices`;
    if (store.endless) {
      const st = store.endless.status();
      status.textContent = `Performing · chapter ${st.chapters} · ${KEY_NAMES[st.key]} ${SCALES[st.scale].name}${st.lastChapter ? ` · ${st.lastChapter}` : ""}`;
    } else {
      const p = store.plan;
      status.textContent = `${KEY_NAMES[p.key]} ${SCALES[p.scale].name} · ${p.meter} · ${p.bpm} bpm · ${p.bars} bars`;
    }
    if (!store.transport.isPlaying() && play.classList.contains("is-on")) refresh();
  }

  const el = h(
    "div",
    { class: "ens-transport", role: "toolbar", "aria-label": "Transport" },
    toStart, play, loop, follow, pos, status, capture,
    h("div", { class: "ens-spacer" }),
    meter, voices, quality, gain.el, reverb.el, delayFb.el,
    h("div", { class: "row", style: "gap:4px;" }, midiBtn, wavBtn, stemsBtn, saveBtn, openBtn, fileInput),
    progress, cancel,
  );
  return { el, frame, follow: () => following };
}
