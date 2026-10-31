# GLOCKWORK Ensemble Composer

The **ENSEMBLE** workspace turns GLOCKWORK from a playable mallet synthesizer into a composition
instrument. It plans and writes complete pieces for up to 16 independently modelled Orff and mallet
instruments, or performs an endless, evolving piece that never repeats. It plays them on GLOCKWORK's
own synthesis voices and lets you edit, lock, regenerate, vary and export every part.

The Sound Lab (the original synthesizer, arpeggiator, effects, MIDI and presets) is unchanged. Both
workspaces share one AudioContext, so you can play along on the keyboard or a MIDI controller while
the ensemble performs.

---

## Using it

1. **Pick a style** (Traditional Orff, Evolving Minimalism, Polyrhythmic Ensemble, Ambient, Cinematic
   Mallets, Experimental) and a **mode**: *Finished arrangement* (a complete piece with a beginning
   and an end) or *Endless performance* (an evolving performance written ahead of the playhead).
2. Leave **Form, Key, Scale, Meter and Tempo** on *Auto* or set them. Set the **length** in bars
   (16–256 presets, or any number) or as a **duration** (m:ss). Choose how many **instruments**, and
   whether ranges are **Playable** (real Orff/concert ranges, mallet counts and striking speed) or
   **Extended** (the synthesis's full range, no physical limits).
3. Shape it with the nine knobs: note density, harmonic complexity, rhythmic complexity,
   counterpoint, motif variation, evolution, humanize, arrangement density, dissonance.
4. **COMPOSE**. *New* rolls a new seed for every unlocked element. The **seed** reproduces a piece
   exactly.
5. **Lock** what you like (Harmony, Melody, Rhythm, Arrangement, Instruments, or any single track's
   padlock) and compose again: only the unlocked parts change.
6. Per track: **regenerate** (⟳) writes that instrument's part afresh; **vary** (∿) keeps most
   phrases and rewrites some; **✎** opens the instrument's full sound editor (the Sound Lab's own
   panel, MIDI Learn included) with damping and send controls.
7. **Edit** in the piano roll (select / draw / erase, move, resize, Alt-drag to duplicate, velocity
   lane, arrows to nudge, Shift+↑↓ for octaves, Ctrl/Cmd+C/V/D, Q to quantize). Editing a track locks
   it, so regenerating the rest keeps your edits. Every generated note is an ordinary event.
8. In the **arrangement**, click the ruler to move the playhead, drag on it to set the loop, click a
   section to select it, and drag across tracks to select bars for duplicate / copy / delete / loop.
9. **Export**: MIDI (one named track per instrument, tempo, meter, key signature, section markers),
   **WAV** (the mix, or the loop region), **Stems** (one WAV per instrument, in a ZIP), and **Save /
   Open** for lossless project files (`.glockwork.json`). The session also autosaves (IndexedDB).
10. In an endless performance, **Capture** freezes the last minutes as an arrangement you can edit
    and export.

Shortcuts (Ensemble workspace): Space play/stop · Home back to start · Ctrl/Cmd+Z undo ·
Ctrl/Cmd+Shift+Z redo.

---

## Architecture

```
src/theory/      reusable theory layer (adapted from APERTURE; no DOM, no audio)
  rng            seeded streams (mulberry32 + labelled forks)
  meter          bar lengths and groupings (2/4 … 12/8, 5/8, 7/8), metric weight, beat strength
  scales         27 scales incl. the five pentatonic modes, the hexachord, hemitonic pentatonics
  chords         honest chords: sounding pitch classes are the truth; voice leading
  progression    cadence and colour degrees, Markov walk, chromatic mediants, key retargeting
  context        the shared musical context: chord at a beat, chord tones, choosePitch, adaptNotes
  motif          motif representation and development (invert, fragment, answer, augment …)
  rhythm         Euclidean rhythms, rotation, lcm

src/compose/     the ensemble composer (pure functions over plain data; runs in node for tests)
  types          Composition / Plan / Section / Phrase / Track / NoteEvent
  profiles       the six style grammars
  instruments    ensemble knowledge of GLOCKWORK's 22 models: ranges, mallets, speed, role fitness
  form           nine form templates, growth with length, phrase plans with cadences
  harmony        section/phrase harmony in nine languages
  themes         Orff rhythm cells, chant contours, contrasting and derived themes
  roles          lineups and optimal role assignment (Hungarian algorithm)
  orchestration  who plays, carrier, entrances/exits, imitation, planned rests
  parts/         the part writers (melody, imitation, counter, accompaniment, ostinato, colour)
  polish         ensemble consonance pass, playable constraints, dynamics, humanisation
  composer       compose(): settings → plan → write → polish; locks; the Writer
  endless        the endless performer (same Writer, chapter by chapter)
  analysis       measurements used by tests, the UI and the listening report

src/ensemble/    audio and files
  mixer          channel strips, sends, shared reverb/delay, headroom, limiter, voice manager
  schedule       pure scheduling windows (loop-aware)
  transport      live lookahead scheduler on the clock AudioWorklet
  render         offline render (chunked at suspend points), stems, audio audit
  wav, zip, midi WAV encoder, store-only ZIP, Standard MIDI File writer/reader
  project        lossless project save/load with validation
  store          the workspace's state: compose, locks, edits, undo, endless, export, autosave

src/ui/ensemble/ composer panel, transport bar, arrangement (rack + timeline), piano roll, side panel
```

### One source of truth

Every part is a `NoteEvent[]` (start and duration in beats, sounding pitch, velocity, plus the motif
and technique that wrote it). Live playback, offline WAV/stems, MIDI export, the piano roll, the
timeline and project files all read the same arrays. Nothing about the music is decided by random
numbers during playback. Humanisation is resolved into the notes when they are written.

### How a piece is written

1. **Settings resolved.** Auto values for key, scale, meter, tempo and form are drawn from the
   profile's weights with seeded streams. Traditional Orff stays in C, F, G and their relative minors,
   the keys diatonic Orff bars are built in.
2. **Lineup and roles.** Instruments come from the profile's lineup order. Roles are assigned by
   optimal matching between instruments and the profile's priority list of roles, weighting each
   instrument's fitness by how essential the role is. Four glockenspiels and a classroom Orff set get
   different roles, and roles no instrument suits are left out.
3. **Form.** One of nine templates (rondo, ABA, AABA, arch, through-composed, binary, theme and
   variations, minimalist process, canon/round) grows to the length by adding sections, not by
   stretching them. Bars are allocated in whole phrases. Section intensities follow the template,
   bent toward one arc by the evolution control and mapped into the profile's dynamic range.
4. **Phrases and cadences.** Themes pair question phrases (half cadence) with answers (full
   cadence). Development spins open continuation phrases. A section that leads back to a refrain ends
   open. The piece ends closed.
5. **Harmony, phrase by phrase**, in the section's language. A returning theme brings its own
   harmony back (transposed if it returns in a new key).
6. **Themes.** A is invented from rhythm cells and a contour; B is its contrast (opposite density and
   direction); later letters are derived from earlier ones.
7. **Orchestration** decides every section's active parts, carrier, entrances, exits, imitation and
   phrase rests before any note exists.
8. **Writing.** Inside each section the carrier's melody comes first. Then come its imitations, then
   the parts that react to it (counter-melody, parallel lines), then bass, bordun, harmony, arpeggio,
   ostinatos, texture, punctuation and the experimental voice. Each track keeps a memory across
   sections (ostinato cells and bordun types per theme, voicings, last pitches), so a refrain returns
   with its own accompaniment.
9. **Polish.**
   - **Consonance:** parts are checked against every higher-priority note sounding at the same time,
     including bars still ringing, weighted by decay. Notes that rub beyond what the harmonic
     behaviour allows at that metric position move to the nearest fitting tone or, for colour parts,
     are dropped. Expressive and Experimental keep a budget of intentional dissonance at points of
     harmonic tension.
   - **Constraints:** playable range, mallet count, striking speed, and no bar re-struck while held.
   - **Dynamics:** section terraces, crescendos into louder sections, tapering endings, phrase arches.
   - **Humanisation:** seeded, so it is reproducible.

### Orff techniques, as operations

| Technique | Where | What it actually does |
|---|---|---|
| Pentatonic and modal writing | `theory/scales`, `themes` | do/re/mi/sol/la pentatonics, hexachord, the modes; chant contours mapped onto any scale |
| Bordun: simple, broken, level, crossover, arpeggiated, moving | `parts/accompaniment` | distinct mallet patterns; tonic over bordun/drone harmony, chord bordun when chords move, tonic alone under a pedal |
| Shifting chords | `harmony` | tonic chord rocking with the chord a step away (I–ii, i–♭VII); the cadence decides which one a phrase ends on |
| Melodic and rhythmic ostinato | `parts/ostinato` | a cell written against the theme's rhythm (interlocking), repeated literally; moved to each chord when harmony moves |
| Interlocking parts | `parts/ostinato`, `parts/imitation` | a second ostinato fills the first one's gaps; hocket splits one line between players |
| Call and response; question and answer | `form`, `parts/imitation` | questions on the carrier, answers on another instrument; half and full cadences |
| Echo | `parts/melody`, `parts/imitation` | the carrier leaves its last statement silent; the follower echoes it there and makes the cadence |
| Canon / round | `parts/imitation`, `form` | the line delayed and transposed by octaves; the delay chosen by measuring clashes; the canon form adds a voice per section |
| Hocket | `parts/imitation` | note-by-note split (round-robin across several players in Experimental); long and cadence notes stay with the carrier |
| Imitation, parallel motion, heterophony | `parts/imitation` | the head answered at the fourth or fifth; the line a third or a pentatonic step away; the strong-beat skeleton held |
| Layered entrances and exits | `orchestration` | build-ups enter foundation → ostinato → melody → colour, one per phrase; endings shed parts in reverse |
| Rondo, ABA, AABA, arch, through-composed | `form` | templates with sections, functions, intensities and phrase plans |
| Contrast, tension, resolution | `form`, `harmony`, `orchestration` | relative-mode contrast sections, a change of carrier and family, cadential harmony, retransition half cadences |

### The six profiles change the algorithm

- **Traditional Orff:** bordun and shifting harmony, chant-based period phrases, echo,
  call-and-response and canon, glockenspiel answers at cadences, layered build-ups.
- **Evolving Minimalism:** process form; additive build-up, discrete phase shifting, one-note
  mutation per section, subtractive reduction; very slow pedal/sparse harmony; interlocking ostinatos.
- **Polyrhythmic Ensemble:** Euclidean timelines on cycles that differ from the bar, chosen so they
  realign at section ends. Isorhythm: the pitch "colour" length differs from the rhythm "talea" length.
- **Ambient:** drone/sparse/pedal harmony; long-ringing metals; "constellation" textures with minimum
  spacing; whole phrases of rest; layers that fade in; a quieter dynamic range.
- **Cinematic Mallets:** functional harmony with borrowed chords and sus4 dominants; sentence-form
  themes recalled augmented; a key lift at the climax; the widest sectional dynamics.
- **Experimental:** hemitonic and symmetric scales, asymmetric meters, planing and chromatic mediants,
  rotating Euclidean experimental voices with registral invariance, pointillist hocket, a dissonance
  budget.

### Arrangement and endless performance

Both modes use the same `Writer`, harmony planner, orchestration and polish. The endless performer
plans a *chapter* (a few sections) at a time, ahead of the playhead. A walker chooses exposition,
contrast, development, interlude, return, climax or new material along a long-range intensity wave
(two slow incommensurate sinusoids). It never places two climaxes in a row, follows a peak with an
interlude, recalls the main theme every few sections, and derives new themes as evolution allows. At
chapter boundaries it may move to a related key (relative mode, dominant, subdominant) and drifts
back home. Chapter k is seeded from the seed and k, so a performance is exactly reproducible however
it is generated (tested). Material more than 96 bars behind the playhead is forgotten.

Locks during a performance: Harmony freezes the tonal centre and cycles the harmony; Melody stops
new themes and repeats statements literally; Rhythm stops process mutation; Arrangement repeats the
last chapter's shape; Instruments freezes who plays; a locked track repeats its last section.

### Locks and regeneration

Each domain has its own seed (arrangement, harmony, melody, rhythm, instruments), and every part's
random choices come from a stream keyed by domain, track seed, variation number, section and
technique. Melody statements are keyed by theme and phrase position rather than by section, so a
returning theme re-derives the same statement instead of re-rolling it.

- **Harmony lock:** keeps the chord timeline (and the meter). With a locked melody, unlocked harmony
  is chosen to contain the melody's strong tones.
- **Melody lock:** keeps the carrier lines and their imitations note for note.
- **Rhythm lock:** keeps every onset, length and velocity. Pitches are re-fitted to the new music;
  chords stay chords.
- **Arrangement lock:** keeps form, sections and orchestration.
- **Instruments lock:** keeps lineup, roles and sound design.
- **Track lock:** keeps a track's notes verbatim, including your edits.
- A key or scale change carries locked material with it.

### Audio

- Voices are GLOCKWORK's own `MalletVoice`. Small, opt-in extensions let it run in an
  OfflineAudioContext, stop at a scheduled time, clean up on `onended` and use a seeded noise slice.
  The Sound Lab's behaviour is unchanged.
- Each track has a channel strip: the vibraphone-style motor when the patch has it on, pan, a fader
  with mute/solo, and reverb and delay sends. The shared reverb's impulse is seeded, cut at −90 dB
  and normalised to unit energy.
- The master chain is headroom scaled by ensemble size → 18 Hz DC blocker → master gain → limiter
  (threshold 0 dB, so Web Audio's automatic makeup gain is exactly 1) → a soft ceiling at −0.45 dBFS
  that the measured renders never reach.
- Voices are allocated in event time, so live playback and export make the same decisions. A bar
  struck again is damped first. Sustaining instruments are hand-damped at note ends where the part
  asks for it. Per-track and global budgets (Performance / Balanced / High) steal the quietest voice.
- The live transport books notes 60–180 ms ahead on the clock AudioWorklet. A generation token makes
  stop, seek and regeneration atomic.

---

## Verification

| Command | What it checks |
|---|---|
| `npm test` | 90 unit tests: theory correctness, instrument ranges and role assignment, determinism, 4/6/8/12-instrument compositions in every profile (range, chord tones on strong beats, scale membership, clashes, tutti share, silence, cadences, textures), lengths 16–256 and durations, phrase cadences, motif continuity vs contrast, structural variation, techniques (bordun, canon, echo, call-and-response, hocket, literal ostinato, additive and phase processes, polyrhythmic cycles), all locks, endless reproducibility, trimming and capture, scheduling windows, MIDI round trip, lossless project files, WAV, ZIP |
| `npm run e2e` | Browser suite on the built app (Chrome for Testing): UI composes every profile; offline renders of every profile at 4/6/8/12 instruments audited for peak, RMS, knee engagement, clicks, DC, non-finite samples; onset timing across tracks; live scheduler accuracy and no duplicates; no hanging voices and no leaked audio nodes (CDP); a single schedule after rapid regeneration; exports through the real buttons; piano-roll edit and undo; endless performance and capture; the Sound Lab still plays |
| `node tests/e2e/stress.mjs` | Real-time underruns on the real output device in installed Chrome (headful), dense 12–16 instrument pieces at two voice budgets |
| `node tests/e2e/electron.mjs` | The desktop build: Electron on `dist/`, compose, play, render |
| `node tests/e2e/listening.mjs` | Renders nine listening examples (WAV, m4a, MIDI, project) with a report to `tests/out/listening/` |

Measured on 2026-10-30 (Apple silicon, Chrome for Testing 151 for e2e, Google Chrome 156 for stress):

- **Levels:** every profile at 4–12 instruments peaks −2.2 to −9.4 dBFS, RMS −21 to −28 dBFS. Zero
  clicks, DC below 10⁻⁵, the soft ceiling never engaged.
- **Timing:** 128 strikes across four tracks land within 0.13 ms of each other. There is a constant
  8.8 ms output latency (limiter look-ahead plus the strike's rise), shared by every part.
- **Real time:** 0 underruns in 25 s each of five dense pieces at Balanced and High. 0 underruns with
  16 instruments and every density control at maximum (34 notes/s, 51 voices).
- **Speed:** composing 64 bars takes 5–20 ms; 400 bars of endless performance ~45 ms; offline render
  runs 10–20× faster than real time.

**What the tests cannot say:** whether the music is good. The listening examples were chosen by
measurement and **have not yet been heard by a person**.

---

## What came from APERTURE

**Reused (adapted only for imports and project types):** the seeded RNG; honest chord construction
and naming, colour chords and voice leading; cadence and colour degrees, the functional Markov
table, chromatic mediant logic, key/scale retargeting; the musical context (chord at a beat, stable
tones, `choosePitch`, `adaptNotes`, explanations); motif representation and development operations;
`planPhrase` and `realiseUnit` (chord tones where exposed, passing and neighbour tones on weak
positions); metric weight vs beat strength; Euclidean rhythm; the click-audit method (isolated
second-difference spikes).

**Adapted:** meters extended with 2/4, 12/8 and 5/8; scales extended with the pentatonic modes, the
hexachord and hemitonic pentatonics, with modes spelled by their parent major key. The progression
generator's ideas were rebuilt as a phrase-aware planner that puts cadences where the form needs them.
The musical context was decoupled from APERTURE's project model.

**New for Orff ensemble composition:** the bordun, shifting-chord and drone languages; Orff rhythm
cells and chant contours; question/answer phrase plans with melodic half cadences on re or sol;
forms that grow; orchestration with layered entrances, exits and planned silence; optimal role
assignment from instrument knowledge; echo, call-and-response, canon (clash-measured delay), hocket,
imitation, parallel and heterophony; ostinato interlocking, minimalist processes and polyrhythmic
isorhythm; ensemble-wide consonance management with decay-weighted ringing bars; playable
constraints; locks with re-fitted rhythm; the endless performer; the multitrack audio engine, MIDI,
stems and project files; the ENSEMBLE workspace.

---

## Known limitations

- **No human listening yet** (see above).
- Tested in Chromium-based browsers and Electron only. Safari and Firefox, touch devices and
  hardware MIDI controllers have not been tested with the Ensemble workspace.
- Diatonic Orff bars (C with F♯/B♭) are not modelled as a constraint. Traditional Orff picks keys
  that fit them, but other settings assume chromatic instruments.
- MIDI export writes the humanised timing as played, has no tempo map (tempo is constant per
  piece), and uses General MIDI programs that approximate the instruments.
- Stems are rendered without the master limiter, which never engaged in measured renders. A
  captured endless performance contains only what has not been trimmed (about the last 96 bars).
- Undo keeps 40 snapshots of the whole composition. Very long 16-part pieces use more memory.
