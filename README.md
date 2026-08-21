# GLOCKWORK

**A browser-based Orff & mallet instrument sound laboratory.**

Xylophones, marimbas, vibraphones, glockenspiels, crotales, kalimbas, tongue drums and a
handful of unapologetically electronic mallets — all synthesized live with the Web Audio API.
No samples, no sample libraries, nothing to download but code.

> ### 📸 Screenshot
> _placeholder — drop a screenshot of the running app here, e.g. `docs/screenshot.png`, and
> reference it as `![Glockwork](docs/screenshot.png)`._

---

## What is this

Glockwork is not an emulation of one specific instrument. It's a sound laboratory built
around the mallet/bar family — Orff classroom instruments (xylophone, metallophone,
glockenspiel in soprano/alto/bass ranges), concert mallet percussion (marimba, vibraphone,
crotales, tubular bells, celesta, kalimba, tongue drums), and a set of intentionally strange
electronic mallets built from the same engine.

Every instrument is modeled with **additive/modal synthesis**: a bank of tuned partials (each
with its own ratio, gain and decay), a short noise-burst excitation shaped by "mallet
hardness," an optional resonant "body" formant, and optional FM shimmer — all built from
plain Web Audio nodes (oscillators, biquad filters, gain envelopes), plus a small
[AudioWorklet](public/worklets/clock-processor.js) that drives the arpeggiator's clock off
the audio thread for tight, jitter-free timing.

It runs as a static web page (installable, works offline, deployable to GitHub Pages) and as
a desktop app (Electron + electron-builder) for the most reliable MIDI experience.

## Features

- **22 distinct instrument models** across Orff, concert-mallet and experimental categories —
  each with its own hand-tuned partial structure, not a shared preset with different labels.
- **Deep sound-shaping controls**: strike (hardness, attack, strike noise, velocity
  sensitivity), bar/resonator (material, brightness, damping, decay, resonance,
  inharmonicity, body size/resonance, fundamental level, overtone amount), tone (filter,
  resonance, HF damping, warmth), pitch (octave/semitone/fine), stereo (width, voice spread,
  pan randomization), a vibraphone-style motor (usable on any instrument), and an FM shimmer
  layer.
- **≥16-voice polyphony** (28 voices by default) with proper voice stealing and click-free
  envelopes.
- **Orff Mode** — lock any MIDI/keyboard/mouse input to a scale (major, natural minor, major
  & minor pentatonic, dorian, mixolydian, lydian, or chromatic/off) around any root note.
- **A real arpeggiator** — 8 rates (whole note through 1/32, with triplets), 7 patterns (up,
  down, up/down, down/up, played-order, random, chord), 1–4 octave range, gate length vs. full
  "let ring," swing, velocity + variation, probability, humanize, and latch/hold — driven by a
  sample-accurate lookahead scheduler.
- **External MIDI**: device selection (any/specific), OMNI or per-channel filtering, note
  on/off with velocity, sustain pedal (CC64), pitch bend, mod wheel (CC1, remappable to
  brightness/filter/reverb/tremolo/motor depth/mallet hardness), incoming MIDI Clock sync
  (Start/Continue/Stop), and MIDI Learn on right-click for any knob.
- **On-screen + computer keyboard performance**: click/touch keyboard with velocity, octave
  shifting, glissando drag; computer-keyboard "musical typing" (A–' for notes, Z/X for
  octave); visual feedback for held keys and for every struck note (including arpeggiator
  output).
- **Effects**: reverb (procedurally generated impulse response — no sample IRs), tempo-syncable
  ping-pong delay, chorus, tempo-syncable tremolo, phaser, saturation, a 3-band EQ, and a
  master limiter — each independently bypassable.
- **Presets**: 30 factory presets across Orff/Mallet/Ambient/Experimental categories, full
  save/rename/delete for user presets (stored in `localStorage`), and JSON export/import with
  strict validation — a malformed file can't crash the synth.
- **Musical randomize** with per-domain scope (instrument/effects/arp/all) and undo.
- Warm, tactile, wood-and-brass UI — not a SaaS dashboard.

## Instruments

**Orff instruments** — Soprano/Alto/Bass Xylophone, Soprano/Alto/Bass Metallophone, Soprano/Alto
Glockenspiel.

**Mallet & percussion** — Concert Xylophone, Marimba, Vibraphone, Glockenspiel/Orchestral
Bells, Crotales, Tubular Bells, Celesta, Kalimba, Toy Piano, Steel Tongue Drum, Wooden Tongue
Drum, Bell.

**Experimental** — Glass Mallet (FM-enhanced), Synthetic Mallet (fully electronic).

Every instrument also exposes a **Material** control (Wood, Rosewood, Synthetic, Soft/Bright
Metal, Steel, Bronze, Glass, Digital) that recolors the strike-noise excitation and inharmonic
stretch independently of which instrument you picked — so you can put "Glass" material on a
Marimba body, etc.

## Orff Mode

Orff Mode is the scale-lock feature. Turn it on, pick a **root note** and a **scale**
(chromatic acts as "off"), and every note — from your MIDI keyboard, computer keyboard, mouse,
touch, *and* the arpeggiator — is snapped to the nearest note in that scale before it sounds.
Combine it with the arpeggiator's Latch mode for hands-free, evolving, Steve Reich-style
minimalist mallet patterns: hold a cluster of notes, let go, and it keeps cycling in-scale
until you touch a new chord.

The arpeggiator has its own **Scale Lock** toggle so you can run it in or out of Orff Mode
independently of what you're playing live.

## Arpeggiator

Turn it on in the Arpeggiator panel. While it's on, playing notes (from any input) feeds the
arpeggiator's held-note pool instead of sounding directly — you hear the arpeggiated pattern,
not the raw keypress (standard arpeggiator behavior). Turn it off to go back to normal direct
play.

- **Rate**: whole note down to 1/32, including 1/8 and 1/16 triplets. **BPM** is the single
  shared project tempo — it also drives tempo-synced Delay and Tremolo.
- **Pattern**: Up, Down, Up/Down, Down/Up, Played (order you pressed the notes), Random, Chord
  (all held notes at once, re-struck each step).
- **Octave Range** (1–4) stacks the held chord up additional octaves.
- **Gate Length** vs. **Note Length: Full Ring** — gated mode chokes each arp note after a
  fraction of the step; Full Ring lets every struck note ring out to its own natural decay
  regardless of tempo, which is what you want for dense, overlapping ambient textures.
- **Swing**, **Velocity** + **Velocity Variation**, **Probability** (chance a given step
  actually plays — great for generative sparseness), and **Humanize** (subtle timing jitter).
- **Latch/Hold**: keeps the last-played chord cycling after you release the keys; playing a
  brand-new chord (after fully releasing the previous one) replaces it.

Timing is handled by a small lookahead scheduler ticked by an AudioWorklet clock (falling back
to a timer if AudioWorklets aren't available), with every note booked at a precise
`AudioContext` time — so playback stays tight even under UI/GC load.

## MIDI

Open the **MIDI Settings** panel. If your browser supports the Web MIDI API, connected devices
appear automatically (hot-plug supported); pick **Any connected device** or a specific one.
Set the channel filter to **Omni** or a specific channel (1–16).

- **Note On/Off + velocity** trigger and shape every strike.
- **Sustain pedal (CC64)** holds notes past their key-release choke.
- **Pitch bend** affects the pitch of newly-struck notes (a struck mallet bar's pitch, like a
  real instrument, isn't something you bend after the fact).
- **Mod wheel (CC1)** maps to a destination you choose: Brightness, Filter Sweep, Reverb,
  Tremolo, Motor Depth, or Mallet Hardness.
- **MIDI Learn**: right-click (or long-press on touch) any knob to arm it, then move a
  control on your MIDI device — it's now mapped to that CC.
- **MIDI Clock**: set Clock Source to "MIDI Clock" in MIDI Settings to sync the arpeggiator's
  tempo to incoming clock pulses, and respond to Start/Continue/Stop. Leave it on "Internal"
  to use the BPM knob.

**Browser MIDI support varies.** Chrome and Edge (desktop) support the Web MIDI API well;
Firefox and Safari have limited or no support as of this writing. **The desktop (Electron)
app is the most reliable option for MIDI** — it's Chromium under the hood with MIDI
permissions pre-granted, so it behaves consistently regardless of the end user's installed
browser.

## Presets

Use the preset dropdown or the **Presets** button in the header to browse all 30 factory
presets plus anything you've saved. **Save** creates/updates a user preset (factory presets
are read-only — saving over one creates a new user preset instead). The Presets modal also
has:

- **Export Current JSON** — downloads the current patch as a `.json` file.
- **Export** next to any preset in the list — downloads that preset specifically.
- **Import JSON** — paste JSON or choose a file; it's validated and sanitized before loading,
  so a corrupted or hand-edited file can't crash the synth (invalid fields fall back to sane
  defaults, and completely malformed JSON is rejected with a clear error).
- **Delete** — removes a user preset (factory presets can't be deleted).

Preset files look like:

```json
{
  "format": "mallet-synth-preset",
  "version": 1,
  "id": "factory-glass-forest",
  "name": "Glass Forest",
  "category": "ambient",
  "engine": { "instrumentId": "glass-mallet", "strike": { "...": "..." }, "bar": {}, "tone": {}, "pitch": {}, "stereo": {}, "motor": {}, "fm": {} },
  "arp": { "on": true, "pattern": "random", "rate": "1/16", "...": "..." },
  "effects": { "reverb": {}, "delay": {}, "chorus": {}, "tremolo": {}, "phaser": {}, "saturation": {}, "eq": {}, "master": {} },
  "performance": { "orff": { "enabled": true, "root": 0, "scaleId": "lydian" }, "bpm": 90, "transpose": 0, "velocity": 0.85 }
}
```

User presets are stored in `localStorage`, so they survive a page refresh (and, on desktop,
an app restart) automatically — export anything you want to back up or share, since
`localStorage` is per-browser/per-profile.

## Keyboard & performance

- **Mouse/touch**: click or drag across the on-screen keyboard. Dragging while held produces
  a glissando across keys.
- **Computer keyboard**: `A W S E D F T G Y H U J K O L P ; '` play notes (GarageBand-style
  "musical typing" layout); `Z`/`X` shift the visible octave down/up.
- **Sustain** button on the keyboard panel behaves like a sustain pedal for mouse/keyboard
  play.
- **Panic** button stops all currently-sounding voices immediately.
- Held keys and every struck note (including arpeggiator output) light up on the on-screen
  keyboard.

## Effects

Reverb (with a procedurally-generated impulse response — no external IR samples), ping-pong
delay (free time or tempo-synced to the shared BPM), chorus, tremolo (tempo-syncable,
separate from the per-instrument "Motor"), phaser, saturation, a 3-band EQ, and a limiter on
the master bus. Every effect has its own On/Off switch.

## Browser compatibility

Works in any modern browser with Web Audio API + AudioWorklet support (Chrome, Edge, Firefox,
Safari — all current versions). Web MIDI API support is Chromium-only at the time of writing;
in browsers without it, everything else (mouse/touch/computer-keyboard play, effects,
arpeggiator, presets) still works — the MIDI panel will say so and suggest the desktop app.

## Desktop installation

Download the installer for your platform from the project's
[Releases](../../releases) page (built automatically by CI for macOS, Windows and Linux):

- **macOS**: `.dmg` (or `.zip`) — universal binary.
- **Windows**: `.exe` (NSIS installer).
- **Linux**: `.AppImage` or `.deb`.

The desktop app is a thin, security-hardened Electron wrapper around the same code as the web
app (`contextIsolation` on, `nodeIntegration` off, sandboxed renderer, no remote content, MIDI
permission pre-granted) — it works fully offline once installed.

## Development

```bash
npm install
npm run dev            # Vite dev server at http://localhost:5173
npm run electron:dev   # Vite dev server + Electron window pointed at it, together
```

### Project structure

```
src/
  audio/        engine, voice synthesis, instrument models, effects, arpeggiator, scales
  midi/         Web MIDI wrapper + MIDI clock BPM tracking
  presets/      preset schema/validation, factory presets, preset manager (localStorage)
  state/        the AppStore that wires audio/MIDI/presets together for the UI
  ui/           vanilla-TS UI components and panels (no framework)
  utils/        small shared helpers (math, note names, events)
electron/
  main.cjs      Electron main process (security config, window creation)
  preload.cjs   contextBridge preload (exposes a minimal isElectron/platform flag)
public/worklets/
  clock-processor.js   AudioWorklet that ticks the arpeggiator's lookahead scheduler
```

The audio engine has no UI dependencies — `AudioEngine`, `Arpeggiator`, `MidiManager` and
`PresetManager` are all plain TypeScript classes that could be driven from a completely
different UI.

## Build commands

```bash
npm run build           # type-check + production web build → dist/
npm run preview         # serve the production build locally

npm run dist             # desktop installer for the current OS → release/
npm run dist:mac         # macOS (.dmg, .zip)
npm run dist:win         # Windows (.exe / NSIS)
npm run dist:linux       # Linux (.AppImage, .deb)
```

Desktop installers land in `release/`. Building for another OS's installer format generally
requires running on that OS (or its CI runner) — see `.github/workflows/release.yml`, which
builds macOS/Windows/Linux on separate GitHub-hosted runners and attaches everything to a
GitHub Release when you push a `vX.Y.Z` tag.

## GitHub Pages

Vite is configured with `base: "./"` (see `vite.config.ts`), so the production build uses
relative asset paths and works unmodified from a repo subpath
(`https://USERNAME.github.io/REPOSITORY/`), a custom domain, or `file://` — no per-repo
configuration needed.

`.github/workflows/deploy-pages.yml` builds and deploys `dist/` to GitHub Pages automatically
on every push to `main`. To enable it on your fork/copy: **Settings → Pages → Source: GitHub
Actions**, then push to `main` (or run the workflow manually from the Actions tab).

To deploy manually instead: `npm run build`, then publish the contents of `dist/` with
whatever static host you like.

## Known limitations

- Pitch bend affects newly-struck notes, not notes already ringing — mallet bars are
  physically struck-and-decaying, not held/sustained tones, so there's nothing to bend once a
  bar is already ringing (this mirrors how a real vibraphone/marimba behaves).
- Web MIDI browser support is inconsistent outside Chromium — use the desktop app for
  guaranteed MIDI.
- User presets live in `localStorage`, which is per-browser-profile — export presets you want
  to keep permanently or move between machines/browsers.
- The AudioWorklet-driven arpeggiator clock falls back to a plain timer in browsers without
  AudioWorklet support; timing stays musically usable but is slightly less immune to
  main-thread jank in that fallback path.

## Troubleshooting

- **No sound at all**: browsers block audio until a user gesture. Click/tap anywhere on the
  page (or press a key) once — audio resumes automatically on first interaction.
- **MIDI device not showing up**: confirm your browser supports Web MIDI (or use the desktop
  app), that the device is connected before the page loads (or reopen the MIDI panel after
  plugging it in), and that no other application has it exclusively locked.
- **Arpeggiator doesn't play**: it only sounds while notes are actively held (or latched) —
  make sure Arp is switched On and you're holding/latching at least one note.
- **Imported preset was rejected**: the file must have `"format": "mallet-synth-preset"` at
  the top level and be valid JSON; anything else is rejected with an on-screen error rather
  than silently corrupting your session.
- **Console shows a MIDI/AudioWorklet warning in an unsupported browser**: expected and
  handled gracefully — the app falls back automatically (timer-based arpeggiator clock, or a
  clear "Web MIDI isn't available" message).

## License

MIT — see [LICENSE](LICENSE). No copyrighted samples, artwork, or proprietary code are used;
every sound is generated at runtime from oscillators, filters and noise. Third-party
dependencies (Vite, TypeScript, Electron, electron-builder, and their transitive deps) are
each under their own permissive (MIT/Apache-2.0/ISC-style) licenses — see `node_modules/*`
or run `npm ls` after `npm install` for the full dependency tree.
