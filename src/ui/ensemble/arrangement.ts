import { INSTRUMENTS } from "../../audio/instruments";
import { ROLE_IDS, ROLE_LABELS } from "../../compose/roles";
import type { RoleId, Track } from "../../compose/types";
import type { EnsembleStore } from "../../ensemble/store";
import { chordSymbol } from "../../theory/chords";
import { pcName } from "../../theory/scales";
import { h } from "../dom";
import { icon } from "./icons";

export const RULER_H = 18;
export const SECTION_H = 22;
export const CHORD_H = 18;
export const HEAD_H = RULER_H + SECTION_H + CHORD_H;
export const LANE_H = 46;

export const THEME_COLORS: Record<string, string> = { A: "#3f9088", B: "#d9722c", C: "#8163a8", D: "#d9ab3c", E: "#c85a4a", F: "#5a8f4e", G: "#4f7fb0", H: "#a8763e" };
export const themeColor = (letter: string | null) => (letter ? THEME_COLORS[letter[0]] ?? "#7a6a52" : "#5a4632");

export interface ArrangementView {
  el: HTMLElement;
  frame(follow: boolean): void;
  invalidate(): void;
  /** current bar-range selection, if any */
  range(): { from: number; to: number } | null;
}

export function buildArrangement(store: EnsembleStore, openSound: (trackId: string) => void): ArrangementView {
  const rackBody = h("div");
  const rack = h("div", { class: "ens-rack" }, h("div", { class: "ens-rack-head", style: `height:${HEAD_H}px;box-sizing:border-box;` }, h("span", {}, "Ensemble"), addTrackControl(store)), rackBody);
  const canvas = h("canvas", { tabindex: "0", "aria-label": "Arrangement timeline: click the ruler to move the playhead, drag on it to set the loop, drag across tracks to select bars" }) as HTMLCanvasElement;
  const wrap = h("div", { class: "ens-timeline-wrap" }, canvas);
  const body = h("div", { class: "ens-arrange-body" }, rack, wrap);
  const rangeInfo = h("span", {}, "");
  const rangeBar = h("div", { class: "ens-range-bar" });

  let pxPerBar = 22;
  let scrollBar = 0;
  let sel: { from: number; to: number; tracks: string[] } | null = null;
  let staticCanvas: HTMLCanvasElement | null = null;
  let dirty = true;
  let W = 0;
  let H = 0;
  const dpr = () => Math.min(2, window.devicePixelRatio || 1);

  // ---------------------------------------------------------------- rack
  function buildRack(): void {
    rackBody.replaceChildren(...store.composition.tracks.map((t) => rackRow(t)));
  }

  function rackRow(t: Track): HTMLElement {
    const mute = h("button", { class: "mini-btn mute", type: "button", title: "Mute", "aria-label": `Mute ${t.name}`, onClick: (e: Event) => { e.stopPropagation(); store.setTrackMix(t.id, { mute: !t.mix.mute }); } }, "M");
    const solo = h("button", { class: "mini-btn solo", type: "button", title: "Solo", "aria-label": `Solo ${t.name}`, onClick: (e: Event) => { e.stopPropagation(); store.setTrackMix(t.id, { solo: !t.mix.solo }); } }, "S");
    const lock = h("button", { class: "mini-btn lock", type: "button", title: "Lock this track: regenerating keeps its notes", "aria-label": `Lock ${t.name}`, onClick: (e: Event) => { e.stopPropagation(); store.setTrackLock(t.id, !t.locked); } }, icon("lock", 10));
    const regen = h("button", { class: "mini-btn", type: "button", title: "Regenerate this instrument's part only", "aria-label": `Regenerate ${t.name}`, onClick: (e: Event) => { e.stopPropagation(); store.regenerateTrack(t.id); } }, icon("regen", 10));
    const vary = h("button", { class: "mini-btn", type: "button", title: "Vary this part (keeps most phrases, rewrites some)", "aria-label": `Vary ${t.name}`, onClick: (e: Event) => { e.stopPropagation(); store.varyTrack(t.id); } }, icon("vary", 10));
    const edit = h("button", { class: "mini-btn", type: "button", title: "Edit this instrument's sound", "aria-label": `Edit the sound of ${t.name}`, onClick: (e: Event) => { e.stopPropagation(); openSound(t.id); } }, icon("edit", 10));
    const role = h("select", { class: "mini-select", title: "Musical role", "aria-label": `Role of ${t.name}` }, ...ROLE_IDS.map((r) => h("option", { value: r }, ROLE_LABELS[r]))) as HTMLSelectElement;
    role.value = t.role;
    role.addEventListener("click", (e) => e.stopPropagation());
    role.addEventListener("change", () => store.setTrackRole(t.id, role.value as RoleId));
    const inst = h("select", { class: "mini-select", title: "Instrument", "aria-label": `Instrument of ${t.name}` }, ...INSTRUMENTS.map((i) => h("option", { value: i.id }, i.name))) as HTMLSelectElement;
    inst.value = t.instrumentId;
    inst.addEventListener("click", (e) => e.stopPropagation());
    inst.addEventListener("change", () => store.setTrackInstrument(t.id, inst.value));
    const vol = h("input", { class: "mini-range", type: "range", min: "0", max: "1.6", step: "0.01", title: "Volume", "aria-label": `Volume of ${t.name}` }) as HTMLInputElement;
    vol.value = String(t.mix.gain);
    vol.addEventListener("input", () => store.setTrackMix(t.id, { gain: Number(vol.value) }));
    vol.addEventListener("click", (e) => e.stopPropagation());
    const row = h(
      "div",
      { class: "rack-row", style: `height:${LANE_H}px;`, "data-track": t.id, onClick: () => store.selectTrack(t.id) },
      h("div", { class: "stripe", style: `background:${t.color};` }),
      h(
        "div",
        { class: "rack-main" },
        h("div", { class: "rack-line" }, h("span", { class: "rack-name", title: t.name }, t.name), h("span", { class: "rack-role" }, ""), vol, mute, solo, lock),
        h("div", { class: "rack-line" }, inst, role, regen, vary, edit),
      ),
    );
    const update = () => {
      const x = store.track(t.id);
      if (!x) return;
      mute.classList.toggle("is-on", x.mix.mute);
      solo.classList.toggle("is-on", x.mix.solo);
      lock.classList.toggle("is-on", x.locked);
      mute.setAttribute("aria-pressed", String(x.mix.mute));
      solo.setAttribute("aria-pressed", String(x.mix.solo));
      lock.setAttribute("aria-pressed", String(x.locked));
      row.classList.toggle("is-selected", store.selectedTrack === x.id);
      (row.querySelector(".rack-role") as HTMLElement).textContent = x.pinned ? "pinned" : "";
      if (document.activeElement !== vol) vol.value = String(x.mix.gain);
      role.value = x.role;
      inst.value = x.instrumentId;
      for (const b of [regen, vary]) b.toggleAttribute("disabled", !!store.endless);
    };
    rowUpdaters.set(t.id, update);
    update();
    return row;
  }
  const rowUpdaters = new Map<string, () => void>();

  // ---------------------------------------------------------------- geometry
  const bb = () => store.bb;
  const beatToX = (beat: number) => (beat / bb() - scrollBar) * pxPerBar;
  const xToBeat = (x: number) => (x / pxPerBar + scrollBar) * bb();
  const visibleBars = () => W / pxPerBar;
  const totalBars = () => (store.endless ? Math.max(store.plan.bars, 1) : store.plan.bars);

  function resize(): void {
    const w = Math.max(200, wrap.clientWidth);
    const hgt = HEAD_H + store.composition.tracks.length * LANE_H;
    if (w === W && hgt === H) return;
    W = w;
    H = hgt;
    canvas.width = Math.round(W * dpr());
    canvas.height = Math.round(H * dpr());
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    dirty = true;
  }

  // ---------------------------------------------------------------- drawing
  function drawStatic(): void {
    if (!staticCanvas) staticCanvas = document.createElement("canvas");
    staticCanvas.width = canvas.width;
    staticCanvas.height = canvas.height;
    const g = staticCanvas.getContext("2d")!;
    g.setTransform(dpr(), 0, 0, dpr(), 0, 0);
    g.fillStyle = "#241812";
    g.fillRect(0, 0, W, H);
    const c = store.composition;
    const plan = c.plan;
    const B = bb();
    const first = Math.max(0, Math.floor(scrollBar));
    const last = Math.min(totalBars(), Math.ceil(scrollBar + visibleBars()) + 1);
    // sections ribbon
    for (const s of plan.sections) {
      const x0 = beatToX(s.startBar * B);
      const x1 = beatToX((s.startBar + s.bars) * B);
      if (x1 < 0 || x0 > W) continue;
      g.fillStyle = themeColor(s.theme);
      g.globalAlpha = 0.85;
      g.fillRect(x0 + 0.5, RULER_H + 1, Math.max(1, x1 - x0 - 1), SECTION_H - 2);
      g.globalAlpha = 1;
      g.fillStyle = "#fff8ec";
      g.font = "bold 10px ui-sans-serif, system-ui";
      const label = x1 - x0 > 90 ? `${s.label} · ${s.name}` : s.label;
      g.save();
      g.beginPath();
      g.rect(x0 + 2, RULER_H, Math.max(0, x1 - x0 - 4), SECTION_H);
      g.clip();
      g.fillText(label, x0 + 5, RULER_H + 15);
      g.restore();
    }
    // ruler with loop region
    g.fillStyle = "#3a2717";
    g.fillRect(0, 0, W, RULER_H);
    if (!store.endless) {
      const lx0 = beatToX(store.loop.start);
      const lx1 = beatToX(store.loop.end);
      g.fillStyle = store.loop.on ? "rgba(240,200,116,0.55)" : "rgba(240,200,116,0.18)";
      g.fillRect(lx0, 2, lx1 - lx0, RULER_H - 4);
    }
    const step = pxPerBar >= 24 ? 1 : pxPerBar >= 10 ? 4 : pxPerBar >= 4 ? 8 : 16;
    g.font = "9px ui-monospace, monospace";
    for (let b = first; b <= last; b++) {
      const x = beatToX(b * B);
      g.strokeStyle = b % 4 === 0 ? "rgba(243,232,210,0.16)" : "rgba(243,232,210,0.06)";
      g.beginPath();
      g.moveTo(x + 0.5, HEAD_H);
      g.lineTo(x + 0.5, H);
      g.stroke();
      if (b % step === 0) {
        g.fillStyle = "#e8d9ba";
        g.fillText(String(b + 1), x + 3, 12);
      }
    }
    // chord lane
    const names = (pc: number) => pcName(pc, plan.key, plan.scale);
    g.fillStyle = "#2c1f15";
    g.fillRect(0, RULER_H + SECTION_H, W, CHORD_H);
    g.font = "10px ui-serif, Georgia, serif";
    for (const sl of plan.harmony) {
      const x0 = beatToX(sl.start);
      const x1 = beatToX(sl.start + sl.dur);
      if (x1 < 0 || x0 > W) continue;
      g.strokeStyle = "rgba(240,200,116,0.35)";
      g.beginPath();
      g.moveTo(x0 + 0.5, RULER_H + SECTION_H + 3);
      g.lineTo(x0 + 0.5, HEAD_H - 3);
      g.stroke();
      if (x1 - x0 > 26) {
        g.fillStyle = sl.chord.outside?.length ? "#f0a070" : "#f0c874";
        g.fillText(chordSymbol(sl.chord, names), x0 + 4, HEAD_H - 5);
      }
    }
    // lanes
    c.tracks.forEach((t, i) => {
      const y0 = HEAD_H + i * LANE_H;
      g.fillStyle = i % 2 ? "#2a1c13" : "#2f2016";
      g.fillRect(0, y0, W, LANE_H);
      // tacet sections (entries and exits are where the hatching starts and stops)
      for (const s of plan.sections) {
        const p = s.parts[t.id];
        const x0 = beatToX(s.startBar * B);
        const x1 = beatToX((s.startBar + s.bars) * B);
        if (x1 < 0 || x0 > W) continue;
        if (!p?.technique) {
          g.fillStyle = "rgba(0,0,0,0.28)";
          g.fillRect(x0, y0, x1 - x0, LANE_H);
          g.strokeStyle = "rgba(243,232,210,0.05)";
          for (let x = x0 - LANE_H; x < x1; x += 7) {
            g.beginPath();
            g.moveTo(Math.max(x0, x), y0 + Math.max(0, x0 - x));
            g.lineTo(Math.min(x1, x + LANE_H), y0 + LANE_H - Math.max(0, x + LANE_H - x1));
            g.stroke();
          }
        } else if (p.enterBar > 0) {
          g.fillStyle = "rgba(0,0,0,0.22)";
          g.fillRect(x0, y0, beatToX((s.startBar + p.enterBar) * B) - x0, LANE_H);
        }
      }
      const ns = t.notes;
      if (ns.length) {
        let lo = 127;
        let hi = 0;
        for (const n of ns) {
          if (n.midi < lo) lo = n.midi;
          if (n.midi > hi) hi = n.midi;
        }
        const span = Math.max(12, hi - lo);
        const yOf = (m: number) => y0 + LANE_H - 5 - ((m - lo) / span) * (LANE_H - 10);
        const b0 = xToBeat(-4);
        const b1 = xToBeat(W + 4);
        const pxBeat = pxPerBar / B;
        for (const n of ns) {
          if (n.start + n.dur < b0 || n.start > b1) continue;
          const x = beatToX(n.start);
          const w = Math.max(1.5, Math.min(n.dur * pxBeat, 60));
          const isTheme = n.motif && !n.motif.includes(":");
          g.fillStyle = isTheme ? themeColor(n.motif!) : t.color;
          g.globalAlpha = 0.45 + n.vel * 0.55;
          g.fillRect(x, yOf(n.midi) - 1.5, w, 3);
          if (n.tag === "cadence" && pxPerBar > 8) {
            g.globalAlpha = 1;
            g.fillStyle = "#fff8ec";
            g.fillRect(x, yOf(n.midi) - 3, 1.5, 6);
          }
        }
        g.globalAlpha = 1;
      }
      if (t.mix.mute || (c.tracks.some((x) => x.mix.solo) && !t.mix.solo)) {
        g.fillStyle = "rgba(20,12,5,0.55)";
        g.fillRect(0, y0, W, LANE_H);
      }
      if (store.selectedTrack === t.id) {
        g.strokeStyle = "rgba(217,114,44,0.9)";
        g.lineWidth = 1.5;
        g.strokeRect(1, y0 + 1, W - 2, LANE_H - 2);
        g.lineWidth = 1;
      }
      g.strokeStyle = "rgba(0,0,0,0.35)";
      g.beginPath();
      g.moveTo(0, y0 + LANE_H - 0.5);
      g.lineTo(W, y0 + LANE_H - 0.5);
      g.stroke();
    });
    // range selection
    if (sel) {
      const x0 = beatToX(sel.from * B);
      const x1 = beatToX(sel.to * B);
      g.fillStyle = "rgba(240,200,116,0.14)";
      g.strokeStyle = "rgba(240,200,116,0.8)";
      c.tracks.forEach((t, i) => {
        if (sel!.tracks.length && !sel!.tracks.includes(t.id)) return;
        g.fillRect(x0, HEAD_H + i * LANE_H, x1 - x0, LANE_H);
      });
      g.strokeRect(x0 + 0.5, HEAD_H, x1 - x0, H - HEAD_H);
    }
    // the end of the piece
    if (!store.endless) {
      const xe = beatToX(store.lengthBeats);
      if (xe < W) {
        g.fillStyle = "rgba(0,0,0,0.45)";
        g.fillRect(xe, 0, W - xe, H);
      }
    }
    dirty = false;
  }

  function frame(follow: boolean): void {
    resize();
    const pos = store.transport.position();
    if (follow && store.transport.isPlaying()) {
      const bar = pos / bb();
      if (bar < scrollBar || bar > scrollBar + visibleBars() * 0.9) {
        scrollBar = Math.max(0, bar - visibleBars() * 0.1);
        dirty = true;
      }
    }
    if (dirty || !staticCanvas) drawStatic();
    const g = canvas.getContext("2d")!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(staticCanvas!, 0, 0);
    g.setTransform(dpr(), 0, 0, dpr(), 0, 0);
    const x = beatToX(pos);
    if (x >= 0 && x <= W) {
      g.strokeStyle = "#f0c874";
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, H);
      g.stroke();
      g.lineWidth = 1;
    }
  }

  // ---------------------------------------------------------------- interaction
  const snapBar = (beat: number) => Math.max(0, Math.round(beat / bb()));
  canvas.addEventListener("pointerdown", (e) => {
    canvas.focus();
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const beat = xToBeat(x);
    canvas.setPointerCapture(e.pointerId);
    if (y < RULER_H && !store.endless) {
      // click: scrub; drag: set the loop region
      const startBar = snapBar(beat);
      let moved = false;
      const move = (ev: PointerEvent) => {
        const b = snapBar(xToBeat(ev.clientX - r.left));
        if (Math.abs(ev.clientX - e.clientX) > 4) moved = true;
        if (moved) {
          store.setLoop({ start: Math.min(startBar, b) * bb(), end: Math.max(Math.max(startBar, b), Math.min(startBar, b) + 1) * bb(), on: true });
          dirty = true;
        }
      };
      const up = () => {
        canvas.removeEventListener("pointermove", move);
        canvas.removeEventListener("pointerup", up);
        if (!moved) store.seek(Math.max(0, Math.round(beat)));
      };
      canvas.addEventListener("pointermove", move);
      canvas.addEventListener("pointerup", up);
      return;
    }
    if (y < RULER_H + SECTION_H) {
      const s = store.plan.sections.find((x) => x.startBar * bb() <= beat && (x.startBar + x.bars) * bb() > beat);
      if (s) {
        sel = { from: s.startBar, to: s.startBar + s.bars, tracks: [] };
        dirty = true;
        updateRangeBar();
      }
      return;
    }
    if (y < HEAD_H) {
      store.seek(Math.max(0, Math.round(beat)));
      return;
    }
    const lane = Math.floor((y - HEAD_H) / LANE_H);
    const t = store.composition.tracks[lane];
    if (t) store.selectTrack(t.id);
    const startBar = Math.floor(beat / bb());
    let dragging = false;
    const move = (ev: PointerEvent) => {
      if (Math.abs(ev.clientX - e.clientX) < 5 && !dragging) return;
      dragging = true;
      const b = xToBeat(ev.clientX - r.left) / bb();
      const lane2 = Math.max(0, Math.min(store.composition.tracks.length - 1, Math.floor((ev.clientY - r.top - HEAD_H) / LANE_H)));
      const a = Math.min(lane, lane2);
      const z = Math.max(lane, lane2);
      const ids = ev.shiftKey ? [] : store.composition.tracks.slice(a, z + 1).map((x) => x.id);
      sel = { from: Math.max(0, Math.min(startBar, Math.floor(b))), to: Math.max(startBar + 1, Math.ceil(b)), tracks: ids };
      dirty = true;
      updateRangeBar();
    };
    const up = () => {
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      if (!dragging) {
        sel = null;
        updateRangeBar();
        dirty = true;
      }
    };
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
  });
  canvas.addEventListener("dblclick", (e) => {
    const r = canvas.getBoundingClientRect();
    store.seek(Math.max(0, Math.round(xToBeat(e.clientX - r.left))));
  });
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const r = canvas.getBoundingClientRect();
        const at = (e.clientX - r.left) / pxPerBar + scrollBar;
        pxPerBar = Math.max(3, Math.min(120, pxPerBar * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
        scrollBar = Math.max(0, at - (e.clientX - r.left) / pxPerBar);
      } else scrollBar = Math.max(0, Math.min(Math.max(0, totalBars() - 4), scrollBar + (e.deltaX + e.deltaY) / pxPerBar));
      dirty = true;
    },
    { passive: false },
  );
  canvas.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") scrollBar += 4;
    else if (e.key === "ArrowLeft") scrollBar = Math.max(0, scrollBar - 4);
    else if (e.key === "+" || e.key === "=") pxPerBar = Math.min(120, pxPerBar * 1.25);
    else if (e.key === "-") pxPerBar = Math.max(3, pxPerBar / 1.25);
    else return;
    e.preventDefault();
    dirty = true;
  });

  // ---------------------------------------------------------------- range operations
  const btn = (label: string, title: string, fn: () => void) => h("button", { class: "icon-button", type: "button", title, onClick: fn }, label);
  function updateRangeBar(): void {
    if (!sel || store.endless) {
      rangeBar.replaceChildren(h("span", { class: "hint" }, store.endless ? "Endless performance: the timeline follows the music as it is written. Capture freezes it as an arrangement." : "Drag across tracks to select bars (Shift: all tracks). Click a section to select it. Ctrl/Cmd + wheel zooms."));
      return;
    }
    const s = sel;
    const who = s.tracks.length ? `${s.tracks.length} track${s.tracks.length > 1 ? "s" : ""}` : "all tracks";
    rangeInfo.textContent = `Bars ${s.from + 1}–${s.to} · ${who}`;
    rangeBar.replaceChildren(
      rangeInfo,
      btn("Duplicate after", "Copy these bars over the bars that follow", () => store.rangeOp("duplicate", s.from, s.to, s.tracks)),
      btn("Copy to playhead", "Copy these bars to the bar at the playhead", () => store.rangeOp("copy-to", s.from, s.to, s.tracks, Math.floor(store.transport.position() / bb()))),
      btn("Delete", "Remove the notes in these bars", () => store.rangeOp("delete", s.from, s.to, s.tracks)),
      btn("Loop", "Loop these bars", () => store.setLoop({ start: s.from * bb(), end: s.to * bb(), on: true })),
      btn("Clear", "Clear the selection", () => {
        sel = null;
        dirty = true;
        updateRangeBar();
      }),
    );
  }

  store.events.on("composed", () => {
    buildRack();
    sel = null;
    scrollBar = 0;
    updateRangeBar();
    dirty = true;
  });
  store.events.on("notes", () => {
    if (store.composition.tracks.length !== rackBody.childElementCount) buildRack();
    dirty = true;
  });
  store.events.on("change", () => {
    if (store.composition.tracks.length !== rackBody.childElementCount || [...rackBody.children].some((row, i) => (row as HTMLElement).dataset.track !== store.composition.tracks[i]?.id)) buildRack();
    for (const u of rowUpdaters.values()) u();
    dirty = true;
  });
  store.events.on("selection", () => {
    for (const u of rowUpdaters.values()) u();
    dirty = true;
  });
  store.events.on("transport", () => (dirty = true));
  new ResizeObserver(() => resize()).observe(wrap);
  buildRack();
  updateRangeBar();

  const el = h("div", { class: "panel ens-arrange" }, h("div", { class: "panel-title" }, h("span", { class: "dot" }), "Arrangement"), body, rangeBar);
  return { el, frame, invalidate: () => (dirty = true), range: () => (sel ? { from: sel.from, to: sel.to } : null) };
}

function addTrackControl(store: EnsembleStore): HTMLElement {
  const sel = h("select", { class: "mini-select", title: "Add an instrument", "aria-label": "Add an instrument" }, h("option", { value: "" }, "+ Add instrument"), ...INSTRUMENTS.map((i) => h("option", { value: i.id }, i.name))) as HTMLSelectElement;
  sel.addEventListener("change", () => {
    if (sel.value) store.addTrack(sel.value);
    sel.value = "";
  });
  return sel;
}
