const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function noteName(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[midi % 12]}${octave}`;
}

export function pitchClassName(pc: number): string {
  return NOTE_NAMES[((pc % 12) + 12) % 12];
}

/** Computer-keyboard "musical typing" layout modeled on GarageBand's familiar scheme:
 * the home row plays white keys starting at C, the row above fills in the black keys,
 * and Z/X shift the octave down/up (handled separately, not part of this note map). */
export const COMPUTER_KEY_MAP: Record<string, number> = {
  KeyA: 0, // C
  KeyW: 1, // C#
  KeyS: 2, // D
  KeyE: 3, // D#
  KeyD: 4, // E
  KeyF: 5, // F
  KeyT: 6, // F#
  KeyG: 7, // G
  KeyY: 8, // G#
  KeyH: 9, // A
  KeyU: 10, // A#
  KeyJ: 11, // B
  KeyK: 12, // C
  KeyO: 13, // C#
  KeyL: 14, // D
  KeyP: 15, // D#
  Semicolon: 16, // E
  Quote: 17, // F
};

export const OCTAVE_DOWN_KEY = "KeyZ";
export const OCTAVE_UP_KEY = "KeyX";
