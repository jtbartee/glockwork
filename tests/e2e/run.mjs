// End-to-end checks of the BUILT app in Chrome for Testing. Usage: npm run build && npm run e2e
// [group …]. Groups: ui audio timing voices export edit endless lab. Output (screenshots, report)
// lands in tests/out/. Audio is checked by measuring it — rendered buffers, live meters, scheduler
// records, CDP node counts — not by trusting DOM state. Exits non-zero if any check fails.

import { BASE, launch, OUT, results, sleep, startServer } from "./harness.mjs";
import { writeFileSync } from "node:fs";

const ONLY = process.argv.slice(2);
const want = (g) => !ONLY.length || ONLY.includes(g);
const { list, check } = results();
const report = [];

const server = await startServer();
const browser = await launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(BASE + "#ensemble");
  await page.evaluate(async () => { localStorage.clear(); await new Promise((r) => { const q = indexedDB.deleteDatabase("glockwork-ensemble"); q.onsuccess = q.onerror = q.onblocked = r; }); });
  await page.goto(BASE + "#ensemble");
  await page.waitForFunction(() => window.glockworkEnsemble && window.glockworkEnsembleLab);
  await page.mouse.click(4, 4);
  const S = (fn, arg) => page.evaluate(fn, arg);

  // ------------------------------------------------------------------ ui
  if (want("ui")) {
    const rows = await S(() => document.querySelectorAll(".rack-row").length);
    const tracks = await S(() => window.glockworkEnsemble.composition.tracks.length);
    check("rack shows one row per track", rows === tracks && rows > 0, `${rows} rows / ${tracks} tracks`);
    // the timeline actually drew notes: sample canvas pixels in the lanes
    const drawn = await S(() => {
      const c = document.querySelector(".ens-timeline-wrap canvas");
      const g = c.getContext("2d");
      const d = g.getImageData(0, 60, c.width, c.height - 60).data;
      let lit = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 300) lit++;
      return lit;
    });
    check("timeline canvas draws notes", drawn > 500, `${drawn} bright pixels`);
    for (const profile of ["traditional", "minimal", "polyrhythmic", "ambient", "cinematic", "experimental"]) {
      await page.selectOption(".ens-composer select >> nth=0", profile);
      await page.click(".ens-compose");
      await sleep(250);
      const st = await S(() => ({ p: window.glockworkEnsemble.plan.profile, n: window.glockworkEnsemble.composition.tracks.reduce((s, t) => s + t.notes.length, 0) }));
      check(`compose ${profile} from the UI`, st.p === profile && st.n > 50, `${st.n} notes`);
      await page.screenshot({ path: `${OUT}ui-${profile}.png`, fullPage: true });
    }
    await page.click('.side-tabs button:has-text("Sound")');
    await sleep(200);
    const soundKnobs = await S(() => document.querySelectorAll(".side-scroll .knob-control").length);
    check("Sound tab shows the track's instrument panel", soundKnobs > 20, `${soundKnobs} knobs`);
    await page.screenshot({ path: `${OUT}ui-sound.png`, fullPage: true });
    await page.click('.side-tabs button:has-text("Score plan")');
    // locks toggle and survive a compose
    await page.click('.lock-chip:has-text("Harmony")');
    const before = await S(() => JSON.stringify(window.glockworkEnsemble.plan.harmony));
    await page.click('.ens-composer button:has-text("New")');
    await sleep(200);
    const after = await S(() => JSON.stringify(window.glockworkEnsemble.plan.harmony));
    check("Harmony lock keeps the chords through New seed", before === after);
    await page.click('.lock-chip:has-text("Harmony")');
  }

  // ------------------------------------------------------------------ audio: offline renders, 4/6/8/12 instruments, every profile
  if (want("audio")) {
    for (const profile of ["traditional", "minimal", "polyrhythmic", "ambient", "cinematic", "experimental"]) {
      for (const n of [4, 6, 8, 12]) {
        const r = await S(async ({ profile, n }) => {
          const L = window.glockworkEnsembleLab;
          const c = L.compose({ settings: { ...L.defaultSettings(), profile, instruments: n, bars: 24 }, seeds: L.seedsFrom(100 + n) }).composition;
          const t0 = performance.now();
          const buf = await L.renderComposition(c, { sampleRate: 44100, quality: "high" });
          const ms = performance.now() - t0;
          const bb = c.plan.meter === "6/8" ? 3 : null;
          const musicEnd = (c.plan.bars * (Number(c.plan.meter.split("/")[0]) * 4 / Number(c.plan.meter.split("/")[1]))) * 60 / c.plan.bpm;
          const a = L.auditBuffer(buf, musicEnd);
          void bb;
          return { ...a, ms, seconds: buf.duration, notes: c.tracks.reduce((s, t) => s + t.notes.length, 0) };
        }, { profile, n });
        report.push({ profile, n, ...r });
        const ok = r.nonFinite === 0 && r.peakDb <= -1 && r.overKnee < 0.0005 && r.clicks === 0 && r.rmsDb > -32 && r.rmsDb < -12 && Math.abs(r.dc) < 0.001;
        check(`render ${profile} × ${n}`, ok, `peak ${r.peakDb.toFixed(1)} dBFS, rms ${r.rmsDb.toFixed(1)} dBFS, over knee ${(r.overKnee * 100).toFixed(3)}%, dc ${r.dc.toFixed(5)}, clicks ${r.clicks}, silence ${r.longestSilence.toFixed(2)} s, ${r.notes} notes, render ${(r.ms / 1000).toFixed(1)} s for ${r.seconds.toFixed(0)} s`);
      }
    }
  }

  // ------------------------------------------------------------------ timing: rendered onsets and the live scheduler
  if (want("timing")) {
    const t = await S(async () => {
      const L = window.glockworkEnsembleLab;
      const c = L.compose({ settings: { ...L.defaultSettings(), profile: "traditional", instruments: 4, bars: 8, bpm: 120, meter: "4/4" }, seeds: L.seedsFrom(5) }).composition;
      // four tracks strike in turn, a sixteenth apart, on every beat; each stem is measured alone
      c.tracks.forEach((tr, k) => {
        // crisp strikes with a short ring: this measures scheduling, not an instrument's attack
        tr.mix.reverb = 0; tr.mix.delay = 0; tr.damp = "ring"; tr.instrumentId = "orff-alto-xylo";
        tr.engine.strike.attack = 1; tr.engine.bar.decay = 0.1; tr.engine.motor.on = false;
        tr.notes = Array.from({ length: 32 }, (_, i) => ({ id: i + 1, start: i + k * 0.25, dur: 0.2, midi: 64 + k * 3, vel: 0.9 }));
      });
      c.master.reverbDecay = 0; c.master.delayFeedback = 0;
      const sr = 48000, errs = [];
      for (const [k, tr] of c.tracks.entries()) {
        const buf = await L.renderComposition(c, { sampleRate: sr, tailSeconds: 1, trackIds: [tr.id] });
        const l = buf.getChannelData(0), r = buf.getChannelData(1);
        for (let i = 0; i < 32; i++) {
          const w = (i + k * 0.25) * 0.5;
          // onset: first sample above 5% of the strike's own peak, searched from 30 ms before
          const s0 = Math.max(0, Math.round((w - 0.03) * sr)), s1 = Math.round((w + 0.03) * sr);
          let pk = 0; for (let j = s0; j < s1; j++) pk = Math.max(pk, Math.abs(l[j]) + Math.abs(r[j]));
          // the previous strike may still ring: the onset must rise well above that level
          let pre = 0; for (let j = s0; j < Math.max(s0 + 1, Math.round((w - 0.008) * sr)); j++) pre = Math.max(pre, Math.abs(l[j]) + Math.abs(r[j]));
          const thr = Math.max(pk * 0.05, pre * 1.6);
          let on = -1; for (let j = Math.max(s0, Math.round((w - 0.008) * sr)); j < s1; j++) if (Math.abs(l[j]) + Math.abs(r[j]) > thr) { on = j; break; }
          errs.push(on < 0 ? 1 : on / sr - w);
        }
      }
      const mean = errs.reduce((a, b) => a + b, 0) / errs.length;
      return { spread: Math.max(...errs) - Math.min(...errs), mean, n: errs.length };
    });
    // a constant offset is output latency (the limiter's look-ahead + the strike's rise), shared by
    // every part; what scheduling must keep tiny is the spread
    check("rendered onsets are sample-tight across 4 tracks (128 strikes)", t.spread < 0.001 && t.n === 128 && Math.abs(t.mean) < 0.012, `spread ${(t.spread * 1000).toFixed(2)} ms, constant latency ${(t.mean * 1000).toFixed(2)} ms`);
    report.push({ onsetSpreadMs: t.spread * 1000, latencyMs: t.mean * 1000 });

    const live = await S(async () => {
      const st = window.glockworkEnsemble;
      st.settings.mode = "arrangement";
      st.composeNow(false, 77);
      const rec = [];
      const orig = st.mixer.playNote.bind(st.mixer);
      st.mixer.playNote = (t, n, when, spb) => { rec.push({ id: `${t.id}:${n.id}`, start: n.start, when, now: st.ctx.currentTime }); return orig(t, n, when, spb); };
      const from = 8 * st.bb;
      await st.play(from);
      await new Promise((r) => setTimeout(r, 3500));
      st.stop();
      st.mixer.playNote = orig;
      const spb = 60 / st.plan.bpm;
      const t0 = rec[0].when - (rec[0].start - from) * spb;
      const dev = rec.map((r) => Math.abs(r.when - (t0 + (r.start - from) * spb)));
      const ids = new Set(rec.map((r) => r.id));
      const lead = rec.map((r) => r.when - r.now);
      // every note due in the first 2.5 s must have been booked
      const due = st.composition.tracks.flatMap((t) => t.notes.filter((n) => n.start >= from && n.start < from + 2.5 / spb).map((n) => `${t.id}:${n.id}`));
      const missing = due.filter((k) => !ids.has(k)).length;
      return { n: rec.length, dup: rec.length - ids.size, maxDev: Math.max(...dev), minLead: Math.min(...lead), maxLead: Math.max(...lead), due: due.length, missing };
    });
    check("live scheduler books every due note once, on the ideal clock", live.due > 5 && live.missing === 0 && live.dup === 0 && live.maxDev < 1e-6, `${live.n} booked, ${live.due} due in 2.5 s, ${live.missing} missing, ${live.dup} duplicates, max deviation ${(live.maxDev * 1e6).toFixed(3)} µs`);
    check("live scheduler books ahead of the audio clock", live.minLead > 0, `lookahead ${(live.minLead * 1000).toFixed(0)}–${(live.maxLead * 1000).toFixed(0)} ms`);
  }

  // ------------------------------------------------------------------ voices: hanging voices, leaks, duplicates after regeneration
  if (want("voices")) {
    const cdp = await ctx.newCDPSession(page);
    let alive = 0;
    await cdp.send("WebAudio.enable");
    cdp.on("WebAudio.audioNodeCreated", () => alive++);
    cdp.on("WebAudio.audioNodeWillBeDestroyed", () => alive--);
    await S(async () => { const st = window.glockworkEnsemble; st.settings = { ...st.settings, profile: "ambient", instruments: 12, mode: "arrangement" }; st.composeNow(false, 9); });
    await sleep(300);
    await cdp.send("HeapProfiler.enable");
    await cdp.send("HeapProfiler.collectGarbage");
    await sleep(500);
    const base = alive;
    const playing = await S(async () => { const st = window.glockworkEnsemble; await st.play(16); await new Promise((r) => setTimeout(r, 4000)); const v = st.mixer.activeVoices(); const buf = new Float32Array(1024); st.mixer.meter.getFloatTimeDomainData(buf); let pk = 0; for (const x of buf) pk = Math.max(pk, Math.abs(x)); return { v, pk }; });
    check("ensemble is audible while playing (live meter)", playing.pk > 0.005 && playing.v > 0, `${playing.v} voices, peak ${playing.pk.toFixed(3)}`);
    // rapid regeneration while playing must not stack schedules
    const regen = await S(async () => {
      const st = window.glockworkEnsemble;
      for (let i = 0; i < 5; i++) { st.composeNow(true); await new Promise((r) => setTimeout(r, 150)); }
      st.mixer.stats.scheduled.clear();
      await new Promise((r) => setTimeout(r, 2500));
      const counts = [...st.mixer.stats.scheduled.values()];
      return { max: Math.max(0, ...counts), n: counts.length, playing: st.transport.isPlaying() };
    });
    check("regenerating while playing leaves a single schedule", regen.max === 1 && regen.n > 0 && regen.playing, `${regen.n} notes scheduled after 5 rapid recomposes, max ${regen.max} booking(s) each`);
    const stopped = await S(async () => { const st = window.glockworkEnsemble; st.stop(); await new Promise((r) => setTimeout(r, 700)); return st.mixer.activeVoices(); });
    check("stop leaves no sounding voices", stopped === 0, `${stopped} voices 0.7 s after stop`);
    await sleep(2500);
    await cdp.send("HeapProfiler.collectGarbage");
    await sleep(800);
    check("audio nodes are released after playback (no voice leak)", alive - base < 60, `${alive - base} nodes above the pre-play baseline (baseline ${base})`);
    const peak = await S(() => window.glockworkEnsemble.mixer.stats);
    report.push({ voices: { peak: peak.peakVoices, stolen: peak.stolen, restruck: peak.restruck, started: peak.voicesStarted } });
    check("voice budget respected", peak.peakVoices <= 64, `peak ${peak.peakVoices} of 64 (balanced), stolen ${peak.stolen}, re-struck ${peak.restruck}`);
  }

  // ------------------------------------------------------------------ export through the UI
  if (want("export")) {
    await S(() => { const st = window.glockworkEnsemble; st.settings = { ...st.settings, profile: "traditional", instruments: 6, bars: 16, mode: "arrangement" }; st.composeNow(false, 3); });
    const dl = async (label) => { const [d] = await Promise.all([page.waitForEvent("download"), page.click(`.ens-transport button:has-text("${label}")`)]); const p = await d.path(); const { readFileSync } = await import("node:fs"); return { name: d.suggestedFilename(), bytes: readFileSync(p) }; };
    const midi = await dl("MIDI");
    check("MIDI download is a standard MIDI file", midi.bytes.subarray(0, 4).toString() === "MThd" && midi.name.endsWith(".mid"), `${midi.name}, ${midi.bytes.length} bytes, ${midi.bytes.readUInt16BE(10)} tracks`);
    await S(() => window.glockworkEnsemble.setLoop({ start: 0, end: 16, on: true }));
    const wav = await dl("WAV");
    const ch = wav.bytes.readUInt16LE(22), sr = wav.bytes.readUInt32LE(24), dataLen = wav.bytes.readUInt32LE(40);
    check("WAV download is PCM of the expected length", wav.bytes.subarray(0, 4).toString() === "RIFF" && ch === 2 && sr === 48000 && dataLen / 4 / sr > 4, `${(dataLen / 4 / sr).toFixed(1)} s stereo`);
    const stems = await dl("Stems");
    let p = 0, entries = 0; while (p + 30 < stems.bytes.length && stems.bytes.readUInt32LE(p) === 0x04034b50) { const size = stems.bytes.readUInt32LE(p + 18); const nl = stems.bytes.readUInt16LE(p + 26); entries++; p += 30 + nl + size; }
    const withNotes = await S(() => window.glockworkEnsemble.composition.tracks.filter((t) => t.notes.length).length);
    check("stems ZIP has one WAV per instrument", entries === withNotes, `${entries} stems`);
    await S(() => window.glockworkEnsemble.setLoop({ on: false }));
    const proj = await dl("Save");
    const original = await S(() => window.glockworkEnsemble.saveProject());
    await S(() => { const st = window.glockworkEnsemble; st.composeNow(true); });
    const { writeFileSync } = await import("node:fs");
    writeFileSync(OUT + "project.glockwork.json", proj.bytes);
    await page.setInputFiles(".ens-transport input[type=file]", OUT + "project.glockwork.json");
    await sleep(300);
    const reloaded = await S(() => window.glockworkEnsemble.saveProject());
    check("save → open restores the project exactly", reloaded === original, `${proj.bytes.length} bytes`);
  }

  // ------------------------------------------------------------------ editing through the piano roll
  if (want("edit")) {
    const before = await S(() => { const st = window.glockworkEnsemble; st.selectTrack(st.composition.tracks[2].id); st.setTrackLock(st.composition.tracks[2].id, false); return st.composition.tracks[2].notes.length; });
    await sleep(200);
    await page.click(".roll-toolbar button:has-text('Draw')");
    const box = await page.locator(".roll-wrap canvas").boundingBox();
    await page.mouse.click(box.x + 46 + 40, box.y + 100);
    await sleep(150);
    const after = await S(() => ({ n: window.glockworkEnsemble.composition.tracks[2].notes.length, locked: window.glockworkEnsemble.composition.tracks[2].locked }));
    check("drawing in the piano roll adds a note and locks the track", after.n === before + 1 && after.locked, `${before} → ${after.n} notes`);
    await page.locator(".roll-wrap canvas").focus();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
    await sleep(150);
    const undone = await S(() => window.glockworkEnsemble.composition.tracks[2].notes.length);
    check("undo removes it again", undone === before, `${undone} notes`);
    await page.click(".roll-toolbar button:has-text('Select')");
    await page.screenshot({ path: `${OUT}ui-edit.png`, fullPage: true });
  }

  // ------------------------------------------------------------------ endless performance
  if (want("endless")) {
    await page.click('.ens-composer button:has-text("Endless performance")');
    await sleep(300);
    await page.click(".transport-btn[aria-label=Play]");
    await sleep(5000);
    const e = await S(() => ({ endless: !!window.glockworkEnsemble.endless, bars: window.glockworkEnsemble.plan.bars, pos: window.glockworkEnsemble.transport.position(), status: document.querySelector(".ens-status").textContent }));
    check("endless performance plays and writes ahead", e.endless && e.bars >= 24 && e.pos > 2 && e.status.includes("Performing"), `${e.bars} bars written, status “${e.status}”`);
    await page.screenshot({ path: `${OUT}ui-endless.png`, fullPage: true });
    await page.click('.ens-transport button:has-text("Capture")');
    await sleep(300);
    const cap = await S(() => ({ endless: !!window.glockworkEnsemble.endless, bars: window.glockworkEnsemble.plan.bars, mode: window.glockworkEnsemble.settings.mode, notes: window.glockworkEnsemble.composition.tracks.reduce((s, t) => s + t.notes.length, 0) }));
    check("capture turns the performance into an editable arrangement", !cap.endless && cap.mode === "arrangement" && cap.bars >= 8 && cap.notes > 0, `${cap.bars} bars, ${cap.notes} notes`);
  }

  // ------------------------------------------------------------------ the Sound Lab still plays
  if (want("lab")) {
    await page.click('.workspace-tab:has-text("Sound Lab")');
    await sleep(200);
    await page.keyboard.down("KeyA");
    await sleep(150);
    const v = await S(() => window.glockwork.engine.getActiveNoteCount());
    await page.keyboard.up("KeyA");
    check("Sound Lab keyboard still plays its instrument", v > 0, `${v} voice(s)`);
    await page.click('.workspace-tab:has-text("Ensemble")');
  }

  check("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  writeFileSync(OUT + "e2e-report.json", JSON.stringify({ results: list, report }, null, 2));
  await browser.close();
  server.stop();
}
const failed = list.filter((r) => !r.ok);
console.log(`\n${list.length - failed.length}/${list.length} passed`);
process.exit(failed.length ? 1 : 0);
