import { instrumentRange } from "../../compose/instruments";
import type { NoteEvent } from "../../compose/types";
import type { EnsembleStore } from "../../ensemble/store";
import { midiName } from "../../theory/scales";
import { h } from "../dom";

type Tool = "select" | "draw" | "erase";

const ROW = 11;
const KEYS_W = 46;
const VEL_H = 54;
const GRID_H = 330;
const BLACK = new Set([1, 3, 6, 8, 10]);

export interface PianoRoll {
  el: HTMLElement;
  frame(follow: boolean): void;
  invalidate(): void;
}

export function buildPianoRoll(store: EnsembleStore): PianoRoll {
  const canvas = h("canvas", { tabindex: "0", "aria-label": "Piano roll: click notes to select, drag to move, drag the right edge to resize; Delete removes, arrows move, Ctrl/Cmd+C/V/D copy, paste, duplicate" }) as HTMLCanvasElement;
  const wrap = h("div", { class: "roll-wrap" }, canvas);
  const title = h("span", { class: "hint", style: "font-weight:700;color:var(--wood);" });
  let tool: Tool = "select";
  let snap = 0.25;
  let ghost = true;
  let pxPerBeat = 26;
  let scrollBeat = 0;
  let topPitch = 96;
  let W = 0;
  let clipboard: NoteEvent[] = [];
  let preview: Map<number, { start: number; midi: number; dur: number; vel: number }> | null = null;
  let draftNote: { start: number; midi: number; dur: number } | null = null;
  let marquee: { x0: number; y0: number; x1: number; y1: number } | null = null;
  let dirty = true;
  const dpr = () => Math.min(2, window.devicePixelRatio || 1);
  const H = GRID_H + VEL_H;

  const seg = <T extends string | number>(label: string, opts: { v: T; l: string; title?: string }[], get: () => T, set: (v: T) => void) => {
    const buttons = opts.map((o) => h("button", { class: "seg-button", type: "button", title: o.title ?? "", onClick: () => { set(o.v); render(); dirty = true; } }, o.l));
    const render = () => buttons.forEach((b, i) => b.classList.toggle("is-active", opts[i].v === get()));
    render();
    return h("div", { class: "row", style: "gap:4px;" }, h("span", { class: "field-label" }, label), ...buttons);
  };
  const tools = seg<Tool>("Tool", [{ v: "select", l: "Select", title: "Select, move (Alt-drag duplicates), resize" }, { v: "draw", l: "Draw", title: "Click to add notes, drag to set length" }, { v: "erase", l: "Erase" }], () => tool, (v) => (tool = v));
  const snaps = seg<number>("Snap", [{ v: 1, l: "1/4" }, { v: 0.5, l: "1/8" }, { v: 0.25, l: "1/16" }, { v: 1 / 3, l: "1/8T" }, { v: 0, l: "Off" }], () => snap, (v) => (snap = v));
  const ghostBtn = h("button", { class: "switch-button is-on", type: "button", title: "Show the other parts faintly", onClick: () => { ghost = !ghost; ghostBtn.classList.toggle("is-on", ghost); dirty = true; } }, "Ghosts");
  const quant = h("button", { class: "icon-button", type: "button", title: "Snap the selected notes' starts to the grid (Q)", onClick: () => quantize() }, "Quantize");
  const del = h("button", { class: "icon-button", type: "button", title: "Delete the selected notes (Delete)", onClick: () => deleteSel() }, "Delete");
  const dup = h("button", { class: "icon-button", type: "button", title: "Duplicate the selection after itself (Ctrl/Cmd+D)", onClick: () => duplicate() }, "Duplicate");
  const toolbar = h("div", { class: "roll-toolbar" }, title, tools, snaps, ghostBtn, quant, dup, del);

  const track = () => store.track(store.selectedTrack);
  const range = () => {
    const t = track();
    return t ? instrumentRange(t.instrumentId, "extended") : ([48, 96] as [number, number]);
  };
  const beatToX = (b: number) => KEYS_W + (b - scrollBeat) * pxPerBeat;
  const xToBeat = (x: number) => (x - KEYS_W) / pxPerBeat + scrollBeat;
  const pitchToY = (m: number) => (topPitch - m) * ROW;
  const yToPitch = (y: number) => Math.round(topPitch - y / ROW + 0.5) - 0;
  const snapBeat = (b: number) => (snap ? Math.round(b / snap) * snap : Math.round(b * 48) / 48);
  const editable = () => !store.endless && !!track();

  function resize(): void {
    const w = Math.max(240, wrap.clientWidth);
    if (w === W) return;
    W = w;
    canvas.width = Math.round(W * dpr());
    canvas.height = Math.round(H * dpr());
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    dirty = true;
  }

  function notesOf(): NoteEvent[] {
    const t = track();
    if (!t) return [];
    if (!preview) return t.notes;
    return t.notes.map((n) => {
      const p = preview!.get(n.id);
      return p ? { ...n, ...p } : n;
    });
  }

  function draw(): void {
    resize();
    const g = canvas.getContext("2d")!;
    g.setTransform(dpr(), 0, 0, dpr(), 0, 0);
    g.fillStyle = "#241812";
    g.fillRect(0, 0, W, H);
    const t = track();
    const [lo, hi] = range();
    const rows = Math.ceil(GRID_H / ROW);
    // rows: black-key rows darker, out-of-range rows hatched
    for (let i = 0; i <= rows; i++) {
      const m = topPitch - i;
      const y = i * ROW;
      g.fillStyle = m < lo || m > hi ? "#1a110b" : BLACK.has(((m % 12) + 12) % 12) ? "#2a1c13" : "#33241a";
      g.fillRect(KEYS_W, y, W - KEYS_W, ROW);
      if (((m % 12) + 12) % 12 === 0) {
        g.fillStyle = "rgba(243,232,210,0.12)";
        g.fillRect(KEYS_W, y + ROW - 1, W - KEYS_W, 1);
      }
    }
    // beat and bar lines
    const bb = store.bb;
    const b0 = Math.floor(scrollBeat);
    const b1 = Math.ceil(xToBeat(W));
    for (let b = b0; b <= b1; b++) {
      const x = beatToX(b);
      const bar = Math.abs(b / bb - Math.round(b / bb)) < 1e-6;
      g.fillStyle = bar ? "rgba(243,232,210,0.22)" : "rgba(243,232,210,0.07)";
      g.fillRect(Math.round(x), 0, 1, GRID_H);
      if (bar && pxPerBeat * bb > 30) {
        g.fillStyle = "#e8d9ba";
        g.font = "9px ui-monospace, monospace";
        g.fillText(String(Math.round(b / bb) + 1), x + 3, 10);
      }
    }
    // ghosts of the other parts
    if (ghost) {
      for (const o of store.composition.tracks) {
        if (o.id === t?.id) continue;
        g.fillStyle = o.color;
        g.globalAlpha = 0.16;
        for (const n of o.notes) {
          if (n.start + n.dur < scrollBeat || n.start > b1) continue;
          const y = pitchToY(n.midi);
          if (y < -ROW || y > GRID_H) continue;
          g.fillRect(beatToX(n.start), y + 2, Math.max(2, n.dur * pxPerBeat), ROW - 4);
        }
      }
      g.globalAlpha = 1;
    }
    // the part's notes
    if (t) {
      for (const n of notesOf()) {
        if (n.start + n.dur < scrollBeat || n.start > b1) continue;
        const x = beatToX(n.start);
        const y = pitchToY(n.midi);
        const w = Math.max(3, n.dur * pxPerBeat - 1);
        const selected = store.selectedNotes.has(n.id);
        g.fillStyle = t.color;
        g.globalAlpha = 0.55 + n.vel * 0.45;
        g.fillRect(x, y + 1, w, ROW - 2);
        g.globalAlpha = 1;
        g.strokeStyle = selected ? "#fff8ec" : "rgba(0,0,0,0.5)";
        g.lineWidth = selected ? 1.5 : 1;
        g.strokeRect(x + 0.5, y + 1.5, w - 1, ROW - 3);
        g.lineWidth = 1;
        // velocity lane
        const vh = n.vel * (VEL_H - 8);
        g.fillStyle = selected ? "#f0c874" : t.color;
        g.fillRect(x, GRID_H + VEL_H - 4 - vh, Math.max(2, Math.min(6, w)), vh);
      }
      if (draftNote) {
        g.fillStyle = "rgba(240,200,116,0.7)";
        g.fillRect(beatToX(draftNote.start), pitchToY(draftNote.midi) + 1, Math.max(3, draftNote.dur * pxPerBeat), ROW - 2);
      }
    }
    if (marquee) {
      g.strokeStyle = "#f0c874";
      g.fillStyle = "rgba(240,200,116,0.12)";
      const x = Math.min(marquee.x0, marquee.x1);
      const y = Math.min(marquee.y0, marquee.y1);
      g.fillRect(x, y, Math.abs(marquee.x1 - marquee.x0), Math.abs(marquee.y1 - marquee.y0));
      g.strokeRect(x + 0.5, y + 0.5, Math.abs(marquee.x1 - marquee.x0), Math.abs(marquee.y1 - marquee.y0));
    }
    // keyboard gutter
    for (let i = 0; i <= rows; i++) {
      const m = topPitch - i;
      const y = i * ROW;
      const black = BLACK.has(((m % 12) + 12) % 12);
      g.fillStyle = black ? "#3a2717" : "#e8d9ba";
      g.fillRect(0, y, KEYS_W - 2, ROW - 1);
      if (((m % 12) + 12) % 12 === 0) {
        g.fillStyle = "#3a2717";
        g.font = "8px ui-monospace, monospace";
        g.fillText(midiName(m), 3, y + ROW - 2);
      }
    }
    g.fillStyle = "#1c130c";
    g.fillRect(0, GRID_H, W, 2);
    g.fillStyle = "#e8d9ba";
    g.font = "8px ui-sans-serif, system-ui";
    g.fillText("VEL", 6, GRID_H + 16);
    dirty = false;
  }

  function frame(follow: boolean): void {
    const pos = store.transport.position();
    if (follow && store.transport.isPlaying()) {
      const visible = (W - KEYS_W) / pxPerBeat;
      if (pos < scrollBeat || pos > scrollBeat + visible * 0.92) {
        scrollBeat = Math.max(0, pos - visible * 0.08);
        dirty = true;
      }
    }
    if (dirty) draw();
    // playhead (drawn over the cached frame by redrawing it — the roll is small)
    const g = canvas.getContext("2d")!;
    if (store.transport.isPlaying()) {
      draw();
      g.setTransform(dpr(), 0, 0, dpr(), 0, 0);
      const x = beatToX(pos);
      if (x > KEYS_W) {
        g.strokeStyle = "#f0c874";
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x, H);
        g.stroke();
      }
    }
  }

  // ---------------------------------------------------------------- hit testing
  function noteAt(x: number, y: number): { note: NoteEvent; edge: boolean } | null {
    const t = track();
    if (!t || y > GRID_H) return null;
    const m = yToPitch(y);
    const b = xToBeat(x);
    for (let i = t.notes.length - 1; i >= 0; i--) {
      const n = t.notes[i];
      if (n.midi !== m) continue;
      if (b >= n.start - 1e-6 && b <= n.start + n.dur) return { note: n, edge: beatToX(n.start + n.dur) - x < 6 };
    }
    return null;
  }

  // ---------------------------------------------------------------- editing
  function commitPreview(): void {
    const t = track();
    if (!t || !preview) return;
    const p = preview;
    preview = null;
    store.editNotes(t.id, (ns) => ns.map((n) => (p.has(n.id) ? { ...n, ...p.get(n.id)! } : n)));
  }

  function deleteSel(): void {
    const t = track();
    if (!t || !editable() || !store.selectedNotes.size) return;
    store.deleteNotes(t.id, new Set(store.selectedNotes));
  }

  function quantize(): void {
    const t = track();
    if (!t || !editable() || !store.selectedNotes.size || !snap) return;
    const sel = store.selectedNotes;
    store.editNotes(t.id, (ns) => ns.map((n) => (sel.has(n.id) ? { ...n, start: snapBeat(n.start) } : n)));
  }

  function duplicate(): void {
    const t = track();
    if (!t || !editable() || !store.selectedNotes.size) return;
    const chosen = t.notes.filter((n) => store.selectedNotes.has(n.id));
    const a = Math.min(...chosen.map((n) => n.start));
    const z = Math.max(...chosen.map((n) => n.start + n.dur));
    const shift = snap ? Math.ceil((z - a) / snap - 1e-6) * snap : z - a;
    paste(chosen.map((n) => ({ ...n, start: n.start - a })), a + shift);
  }

  function paste(items: NoteEvent[], at: number): void {
    const t = track();
    if (!t || !editable() || !items.length) return;
    let id = store.nextNoteId(t.id);
    const added = items.map((n) => ({ ...n, id: id++, start: n.start + at }));
    store.editNotes(t.id, (ns) => [...ns, ...added]);
    store.selectedNotes = new Set(added.map((n) => n.id));
  }

  function nudge(dBeat: number, dPitch: number): void {
    const t = track();
    if (!t || !editable() || !store.selectedNotes.size) return;
    const sel = store.selectedNotes;
    store.editNotes(t.id, (ns) => ns.map((n) => (sel.has(n.id) ? { ...n, start: Math.max(0, n.start + dBeat), midi: n.midi + dPitch } : n)));
  }

  canvas.addEventListener("pointerdown", (e) => {
    canvas.focus();
    const t = track();
    if (!t) return;
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    if (x < KEYS_W) {
      store.audition(t.id, yToPitch(y));
      return;
    }
    canvas.setPointerCapture(e.pointerId);
    // velocity lane
    if (y > GRID_H) {
      if (!editable()) return;
      const setVel = (ev: PointerEvent) => {
        const bx = xToBeat(ev.clientX - r.left);
        const v = Math.max(0.02, Math.min(1, (GRID_H + VEL_H - 4 - (ev.clientY - r.top)) / (VEL_H - 8)));
        const hit = t.notes.filter((n) => Math.abs(beatToX(n.start) - beatToX(bx)) < 5);
        const targets = hit.length ? hit : [];
        preview = preview ?? new Map();
        for (const n of targets) preview.set(n.id, { start: n.start, midi: n.midi, dur: n.dur, vel: v });
        dirty = true;
      };
      setVel(e);
      const up = () => {
        canvas.removeEventListener("pointermove", setVel);
        canvas.removeEventListener("pointerup", up);
        commitPreview();
      };
      canvas.addEventListener("pointermove", setVel);
      canvas.addEventListener("pointerup", up);
      return;
    }
    const hit = noteAt(x, y);
    if (tool === "erase" && editable()) {
      if (hit) store.deleteNotes(t.id, new Set([hit.note.id]));
      return;
    }
    if (hit) {
      store.audition(t.id, hit.note.midi, hit.note.vel);
      if (!store.selectedNotes.has(hit.note.id)) store.selectedNotes = e.shiftKey ? new Set([...store.selectedNotes, hit.note.id]) : new Set([hit.note.id]);
      else if (e.shiftKey) store.selectedNotes.delete(hit.note.id);
      dirty = true;
      if (!editable()) return;
      const resizing = hit.edge;
      const copy = e.altKey;
      const startB = xToBeat(x);
      const startP = yToPitch(y);
      const chosen = t.notes.filter((n) => store.selectedNotes.has(n.id));
      const move = (ev: PointerEvent) => {
        const db = xToBeat(ev.clientX - r.left) - startB;
        const dp = yToPitch(ev.clientY - r.top) - startP;
        preview = new Map();
        for (const n of chosen) {
          if (resizing) preview.set(n.id, { start: n.start, midi: n.midi, dur: Math.max(snap || 0.0625, snapBeat(n.start + n.dur + db) - n.start), vel: n.vel });
          else preview.set(n.id, { start: Math.max(0, snap ? snapBeat(n.start + db) : n.start + db), midi: n.midi + dp, dur: n.dur, vel: n.vel });
        }
        dirty = true;
      };
      const up = () => {
        canvas.removeEventListener("pointermove", move);
        canvas.removeEventListener("pointerup", up);
        if (!preview) return;
        if (copy && !resizing) {
          const p = preview;
          preview = null;
          paste(chosen.map((n) => ({ ...n, ...p.get(n.id)!, start: p.get(n.id)!.start })), 0);
        } else commitPreview();
      };
      canvas.addEventListener("pointermove", move);
      canvas.addEventListener("pointerup", up);
      return;
    }
    if (tool === "draw" && editable()) {
      const start = Math.max(0, snapBeat(xToBeat(x) - (snap ? snap / 2 : 0)));
      const midi = yToPitch(y);
      draftNote = { start, midi, dur: snap || 0.5 };
      store.audition(t.id, midi);
      const move = (ev: PointerEvent) => {
        const end = snapBeat(xToBeat(ev.clientX - r.left));
        draftNote = { start, midi, dur: Math.max(snap || 0.0625, end - start) };
        dirty = true;
      };
      const up = () => {
        canvas.removeEventListener("pointermove", move);
        canvas.removeEventListener("pointerup", up);
        if (draftNote) store.addNote(t.id, { start: draftNote.start, dur: draftNote.dur, midi: draftNote.midi, vel: 0.75, tag: "edited" });
        draftNote = null;
      };
      canvas.addEventListener("pointermove", move);
      canvas.addEventListener("pointerup", up);
      dirty = true;
      return;
    }
    // marquee selection
    marquee = { x0: x, y0: y, x1: x, y1: y };
    if (!e.shiftKey) store.selectedNotes.clear();
    const move = (ev: PointerEvent) => {
      marquee = { ...marquee!, x1: ev.clientX - r.left, y1: ev.clientY - r.top };
      dirty = true;
    };
    const up = () => {
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      const m = marquee!;
      marquee = null;
      const a = xToBeat(Math.min(m.x0, m.x1));
      const z = xToBeat(Math.max(m.x0, m.x1));
      const pHi = yToPitch(Math.min(m.y0, m.y1));
      const pLo = yToPitch(Math.max(m.y0, m.y1));
      for (const n of t.notes) if (n.start + n.dur >= a && n.start <= z && n.midi >= pLo && n.midi <= pHi) store.selectedNotes.add(n.id);
      if (Math.abs(m.x1 - m.x0) < 3 && Math.abs(m.y1 - m.y0) < 3) store.seek(Math.max(0, snapBeat(a)));
      dirty = true;
    };
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    dirty = true;
  });

  canvas.addEventListener("dblclick", (e) => {
    const t = track();
    if (!t || !editable() || tool !== "select") return;
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    if (y > GRID_H || x < KEYS_W || noteAt(x, y)) return;
    store.addNote(t.id, { start: Math.max(0, snapBeat(xToBeat(x))), dur: snap || 0.5, midi: yToPitch(y), vel: 0.75, tag: "edited" });
  });

  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const r = canvas.getBoundingClientRect();
        const at = xToBeat(e.clientX - r.left);
        pxPerBeat = Math.max(4, Math.min(160, pxPerBeat * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
        scrollBeat = Math.max(0, at - (e.clientX - r.left - KEYS_W) / pxPerBeat);
      } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) scrollBeat = Math.max(0, scrollBeat + (e.deltaX || e.deltaY) / pxPerBeat);
      else topPitch = Math.max(24, Math.min(120, topPitch - Math.sign(e.deltaY) * 2));
      dirty = true;
    },
    { passive: false },
  );

  canvas.addEventListener("keydown", (e) => {
    const t = track();
    if (!t) return;
    const mod = e.ctrlKey || e.metaKey;
    const step = snap || 0.25;
    if (e.key === "Delete" || e.key === "Backspace") deleteSel();
    else if (mod && e.key.toLowerCase() === "a") {
      store.selectedNotes = new Set(t.notes.map((n) => n.id));
      dirty = true;
    } else if (mod && e.key.toLowerCase() === "c") {
      const chosen = t.notes.filter((n) => store.selectedNotes.has(n.id));
      const a = Math.min(...chosen.map((n) => n.start));
      clipboard = chosen.map((n) => ({ ...n, start: n.start - a }));
    } else if (mod && e.key.toLowerCase() === "v") paste(clipboard, snapBeat(store.transport.position()));
    else if (mod && e.key.toLowerCase() === "d") duplicate();
    else if (e.key === "ArrowLeft") nudge(-step, 0);
    else if (e.key === "ArrowRight") nudge(step, 0);
    else if (e.key === "ArrowUp") nudge(0, e.shiftKey ? 12 : 1);
    else if (e.key === "ArrowDown") nudge(0, e.shiftKey ? -12 : -1);
    else if (e.key.toLowerCase() === "q" && !mod) quantize();
    else if (e.key === "Escape") {
      store.selectedNotes.clear();
      dirty = true;
    } else return;
    e.preventDefault();
    e.stopPropagation();
  });

  function centre(): void {
    const t = track();
    if (!t) return;
    const ns = t.notes;
    const mid = ns.length ? ns.reduce((s, n) => s + n.midi, 0) / ns.length : (range()[0] + range()[1]) / 2;
    topPitch = Math.round(mid + GRID_H / ROW / 2);
    title.textContent = `${t.name} — ${t.notes.length} notes${t.locked ? " · locked" : ""}${store.endless ? " · read-only while performing" : ""}`;
  }
  store.events.on("selection", () => {
    centre();
    dirty = true;
  });
  store.events.on("composed", () => {
    centre();
    scrollBeat = 0;
    dirty = true;
  });
  store.events.on("notes", () => {
    const t = track();
    if (t) title.textContent = `${t.name} — ${t.notes.length} notes${t.locked ? " · locked" : ""}${store.endless ? " · read-only while performing" : ""}`;
    dirty = true;
  });
  store.events.on("change", () => (dirty = true));
  new ResizeObserver(() => resize()).observe(wrap);
  centre();

  const el = h("div", { class: "panel" }, h("div", { class: "panel-title" }, h("span", { class: "dot" }), "Piano Roll"), toolbar, wrap);
  return { el, frame, invalidate: () => (dirty = true) };
}
