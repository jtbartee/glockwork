import type { AppStore } from "../../state/store";
import { noteName } from "../../utils/notes";
import { h } from "../dom";

const OCTAVES_SHOWN = 3;
const BLACK_OFFSETS = new Set([1, 3, 6, 8, 10]);

export function buildKeyboardPanel(store: AppStore): HTMLElement {
  const keyboard = h("div", { class: "keyboard" });
  const keyEls = new Map<number, HTMLElement>();
  let activePointerNote: number | null = null;

  function baseNote(): number {
    return 60 + store.getComputerOctaveShift() * 12 - 12;
  }

  function render(): void {
    keyboard.replaceChildren();
    keyEls.clear();
    const base = baseNote();
    const total = OCTAVES_SHOWN * 12 + 1;
    for (let i = 0; i < total; i++) {
      const note = base + i;
      const offset = ((note % 12) + 12) % 12;
      const isBlack = BLACK_OFFSETS.has(offset);
      const key = h(
        "div",
        {
          class: `key ${isBlack ? "black" : "white"}`,
          "data-note": String(note),
        },
        offset === 0 ? noteName(note) : "",
      );
      keyEls.set(note, key);
      keyboard.appendChild(key);
    }
  }

  function noteAtPoint(x: number, y: number): number | null {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const key = el?.closest<HTMLElement>(".key");
    const attr = key?.getAttribute("data-note");
    return attr ? Number(attr) : null;
  }

  function pressNote(note: number): void {
    if (activePointerNote === note) return;
    if (activePointerNote !== null) store.noteOff(activePointerNote, "mouse");
    activePointerNote = note;
    store.noteOn(note, store.getPerformanceState().velocity, "mouse");
  }

  function releasePointer(): void {
    if (activePointerNote !== null) {
      store.noteOff(activePointerNote, "mouse");
      activePointerNote = null;
    }
  }

  keyboard.addEventListener("pointerdown", (e: PointerEvent) => {
    e.preventDefault();
    const note = noteAtPoint(e.clientX, e.clientY);
    if (note !== null) pressNote(note);
  });
  keyboard.addEventListener("pointermove", (e: PointerEvent) => {
    if (e.buttons === 0 || activePointerNote === null) return;
    const note = noteAtPoint(e.clientX, e.clientY);
    if (note !== null) pressNote(note);
  });
  window.addEventListener("pointerup", releasePointer);
  keyboard.addEventListener("pointerleave", (e: PointerEvent) => {
    if (e.buttons === 0) releasePointer();
  });

  store.events.on("key-visual", ({ note, on }) => {
    const el = keyEls.get(note);
    el?.classList.toggle("active", on);
  });

  store.events.on("voice-visual", ({ note, on }) => {
    const el = keyEls.get(note);
    if (!el || !on) return;
    el.classList.add("arp-active");
    window.setTimeout(() => el.classList.remove("arp-active"), 160);
  });

  let lastBase = baseNote();
  store.events.on("change", () => {
    const b = baseNote();
    if (b !== lastBase) {
      lastBase = b;
      render();
    }
  });
  render();

  const octDown = h("button", { class: "icon-button", type: "button", onClick: () => store.shiftComputerOctave(-1) }, "◂ Oct");
  const octUp = h("button", { class: "icon-button", type: "button", onClick: () => store.shiftComputerOctave(1) }, "Oct ▸");

  // Sustain is a momentary performance control, not part of the saved patch, so it's wired
  // directly to the engine rather than through a store path.
  let sustainOn = false;
  const sustainBtn = h(
    "button",
    {
      class: "switch-button",
      type: "button",
      onClick: () => {
        sustainOn = !sustainOn;
        sustainBtn.textContent = sustainOn ? "Held" : "Off";
        sustainBtn.classList.toggle("is-on", sustainOn);
        store.engine.setSustain(sustainOn);
      },
    },
    "Off",
  );
  const sustainSwitch = h("div", { class: "switch-control" }, h("div", { class: "switch-label" }, "Sustain"), sustainBtn);

  const panicBtn = h("button", { class: "icon-button", type: "button", onClick: () => store.panic() }, "Panic");

  return h(
    "div",
    { class: "panel" },
    h("div", { class: "panel-title" }, h("span", { class: "dot" }), "Keyboard"),
    h(
      "p",
      { class: "hint", style: "margin:-4px 0 8px;" },
      "Play with your mouse, touch, or computer keyboard (A–' for notes, Z/X to shift octave). When the arpeggiator is on, held notes feed the pattern instead of sounding directly.",
    ),
    h(
      "div",
      { class: "keyboard-wrap" },
      keyboard,
      h("div", { class: "keyboard-side" }, octUp, octDown, sustainSwitch, panicBtn),
    ),
  );
}
