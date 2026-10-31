// Listening examples for human review: one or two pieces per profile and a captured endless
// performance, rendered to WAV (+ m4a), MIDI and project files, with a report of what to listen for.
// Seeds are chosen among candidates by measurement (cadences, theme returns, clashes) — not by ear.
// Usage: npm run build && node tests/e2e/listening.mjs

import { BASE, launch, OUT, startServer } from "./harness.mjs";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const DIR = OUT + "listening/";
mkdirSync(DIR, { recursive: true });
const EXAMPLES = [
  { file: "01-traditional-rondo", title: "Traditional Orff — rondo", settings: { profile: "traditional", instruments: 8, bars: 48, form: "rondo" } },
  { file: "02-traditional-canon", title: "Traditional Orff — canon / round", settings: { profile: "traditional", instruments: 7, bars: 40, form: "canon", meter: "6/8" } },
  { file: "03-traditional-full-ensemble", title: "Traditional Orff — 12-part classroom ensemble, ABA", settings: { profile: "traditional", instruments: 12, bars: 64, form: "aba" } },
  { file: "04-minimalism", title: "Evolving Minimalism — process form", settings: { profile: "minimal", instruments: 8, bars: 72 } },
  { file: "05-polyrhythmic", title: "Polyrhythmic Ensemble — 12/8", settings: { profile: "polyrhythmic", instruments: 8, bars: 48, meter: "12/8" } },
  { file: "06-ambient", title: "Ambient / Atmospheric", settings: { profile: "ambient", instruments: 8, bars: 48 } },
  { file: "07-cinematic", title: "Cinematic Mallets — ABA", settings: { profile: "cinematic", instruments: 10, bars: 64, form: "aba" } },
  { file: "08-experimental", title: "Experimental — through-composed", settings: { profile: "experimental", instruments: 8, bars: 48 } },
  { file: "09-endless-captured", title: "Endless performance (Traditional), first 80 bars captured", endless: true, settings: { profile: "traditional", instruments: 8 } },
];

const server = await startServer();
const browser = await launch();
const lines = ["# GLOCKWORK ensemble — listening examples", "", "Rendered offline at 44.1 kHz / 16-bit by the same engine the app plays live. Seeds were picked from 10 candidates per example by measurement (cadence accuracy, theme return vs contrast, strong-beat chord tones, clashes). **Nobody has listened to these yet** — the numbers say what the notes are, not whether the music works.", ""];
try {
  const page = await (await browser.newContext({ viewport: { width: 1200, height: 800 } })).newPage();
  await page.goto(BASE + "#ensemble");
  await page.waitForFunction(() => window.glockworkEnsembleLab);
  for (const ex of EXAMPLES) {
    const r = await page.evaluate(async (ex) => {
      const L = window.glockworkEnsembleLab;
      const make = (seed) => {
        const settings = { ...L.defaultSettings(), ...ex.settings };
        if (ex.endless) {
          const e = new L.EndlessComposer({ ...settings, mode: "endless" }, L.seedsFrom(seed), { harmony: false, rhythm: false, melody: false, arrangement: false, instruments: false });
          e.ensure(84);
          return e.capture(0, 80);
        }
        return L.compose({ settings, seeds: L.seedsFrom(seed) }).composition;
      };
      let best = null;
      for (let seed = 1; seed <= 10; seed++) {
        const c = make(seed * 97 + 13);
        const a = L.analyse(c);
        const score = a.cadenceAccuracy * 2 + a.chordToneStrong + (a.returnSimilarity - a.contrastSimilarity) - a.clashesPer100 * 0.2 + Math.min(1, a.distinctTextures / 4) * 0.5;
        if (!best || score > best.score) best = { seed: seed * 97 + 13, c, a, score };
      }
      const { c, a } = best;
      const buf = await L.renderComposition(c, { sampleRate: 44100, quality: "high", tailSeconds: 5 });
      const audit = L.auditBuffer(buf);
      const wav = L.encodeWav(buf, 16);
      const b64 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
      const chunks = [];
      for (let i = 0; i < wav.length; i += 4 << 20) chunks.push(b64(wav.subarray(i, i + (4 << 20))));
      const p = c.plan;
      const bb = Number(p.meter.split("/")[0]) * 4 / Number(p.meter.split("/")[1]);
      const name = (id) => c.tracks.find((t) => t.id === id)?.name ?? id;
      const sections = p.sections.map((s) => ({ label: s.label, name: s.name, bars: `${s.startBar + 1}–${s.startBar + s.bars}`, language: s.language, key: s.key, scale: s.scale, intensity: s.intensity, carrier: s.carrier ? name(s.carrier) : null, imitation: s.imitation.kind, followers: s.imitation.followers.map(name), playing: Object.values(s.parts).filter((x) => x.technique).length }));
      const tags = {};
      for (const t of c.tracks) for (const n of t.notes) { const k = (n.tag ?? "").replace(/\d+$/, ""); tags[k] = (tags[k] ?? 0) + 1; }
      return { seed: best.seed, wav: chunks, midi: b64(L.compositionToMidi(c)), project: L.serializeProject({ ...c, name: ex.title }), plan: { form: p.form, key: p.key, scale: p.scale, meter: p.meter, bpm: p.bpm, bars: p.bars, behavior: p.behavior, seconds: (p.bars * bb * 60) / p.bpm }, sections, themes: Object.values(p.themes).map((t) => `${t.id}: ${t.motif.notes.length} notes / ${t.bars} bar(s), ${t.origin}`), lineup: c.tracks.map((t) => `${t.name} (${t.role})`), a, audit, tags };
    }, ex);
    const wav = Buffer.concat(r.wav.map((c) => Buffer.from(c, "base64")));
    writeFileSync(`${DIR}${ex.file}.wav`, wav);
    writeFileSync(`${DIR}${ex.file}.mid`, Buffer.from(r.midi, "base64"));
    writeFileSync(`${DIR}${ex.file}.glockwork.json`, r.project);
    try { execFileSync("afconvert", ["-f", "m4af", "-d", "aac", "-b", "192000", `${DIR}${ex.file}.wav`, `${DIR}${ex.file}.m4a`]); } catch { /* afconvert unavailable */ }
    const KEYS = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
    const p = r.plan;
    lines.push(`## ${ex.title}`, "", `\`${ex.file}.wav\` · seed ${r.seed} · ${p.form} · ${KEYS[p.key]} ${p.scale} · ${p.meter} · ${p.bpm} bpm · ${p.bars} bars (${Math.floor(p.seconds / 60)}:${String(Math.round(p.seconds % 60)).padStart(2, "0")}) · ${p.behavior} harmony`, "");
    lines.push(`**Lineup:** ${r.lineup.join(", ")}`, "", `**Themes:** ${r.themes.join("; ")}`, "", "| Section | Bars | Harmony | Key | Intensity | Principal line | Imitation | Parts |", "|---|---|---|---|---|---|---|---|");
    for (const s of r.sections) lines.push(`| ${s.label} ${s.name} | ${s.bars} | ${s.language} | ${KEYS[s.key]} ${s.scale} | ${s.intensity.toFixed(2)} | ${s.carrier ?? "—"} | ${s.imitation}${s.followers.length ? ` → ${s.followers.join(", ")}` : ""} | ${s.playing} |`);
    const top = Object.entries(r.tags).filter(([k]) => k).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k} ${v}`).join(", ");
    lines.push("", `**Techniques (notes by tag):** ${top}`, "", `**Measured:** strong-beat chord tones ${(r.a.chordToneStrong * 100).toFixed(0)}%, out of scale ${r.a.outOfScale}, semitone rubs ${r.a.clashesPer100.toFixed(1)}/100 onsets, cadences ${(r.a.cadenceAccuracy * 100).toFixed(0)}%, returns ${(r.a.returnSimilarity * 100).toFixed(0)}% vs contrasts ${(r.a.contrastSimilarity * 100).toFixed(0)}%, parts playing ${r.a.meanActive.toFixed(1)} mean / ${r.a.maxActive} max, tutti bars ${(r.a.tuttiBars * 100).toFixed(0)}%, distinct textures ${r.a.distinctTextures}.`, "", `**Audio:** peak ${r.audit.peakDb.toFixed(1)} dBFS, RMS ${r.audit.rmsDb.toFixed(1)} dBFS, clicks ${r.audit.clicks}, samples near full scale ${(r.audit.nearCeiling * 100).toFixed(3)}%.`, "");
    console.log(`${ex.file}: seed ${r.seed}, ${p.form}, ${p.bars} bars, peak ${r.audit.peakDb.toFixed(1)} dBFS, clicks ${r.audit.clicks}, cad ${(r.a.cadenceAccuracy * 100).toFixed(0)}%, ret ${(r.a.returnSimilarity * 100).toFixed(0)}% / con ${(r.a.contrastSimilarity * 100).toFixed(0)}%`);
  }
} finally {
  writeFileSync(DIR + "README.md", lines.join("\n"));
  await browser.close();
  server.stop();
}
