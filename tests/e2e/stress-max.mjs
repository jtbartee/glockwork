import { BASE, launch, sleep, startServer } from "./harness.mjs";
import { existsSync } from "node:fs";
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const server = await startServer();
const browser = await launch({ headful: true, executablePath: existsSync(chrome) ? chrome : undefined });
try {
  const page = await (await browser.newContext({ viewport: { width: 1300, height: 900 } })).newPage();
  await page.goto(BASE + "#ensemble");
  await page.waitForFunction(() => window.glockworkEnsemble);
  await page.mouse.click(4, 4);
  for (const [profile, quality] of [["minimal", "high"], ["ambient", "high"], ["cinematic", "high"], ["minimal", "balanced"]]) {
    const r = await page.evaluate(async ({ profile, quality }) => {
      const st = window.glockworkEnsemble;
      st.setQuality(quality);
      const c = { ...st.settings.controls, density: 1, arrangementDensity: 1, rhythmicComplexity: 1, counterpoint: 1, harmonicComplexity: 1 };
      st.settings = { ...st.settings, profile, instruments: 16, bars: 64, mode: "arrangement", realism: "extended", controls: c };
      st.composeNow(false, 99);
      const notes = st.composition.tracks.reduce((s, t) => s + t.notes.length, 0);
      st.setMaster({ gain: 0 });
      await st.play(16 * st.bb);
      const ps = st.ctx.playbackStats;
      const e0 = ps.underrunEvents, d0 = ps.underrunDuration;
      let peak = 0;
      const t0 = performance.now();
      while (performance.now() - t0 < 20000) { await new Promise((r) => setTimeout(r, 200)); peak = Math.max(peak, st.mixer.activeVoices()); }
      const out = { underruns: ps.underrunEvents - e0, sec: ps.underrunDuration - d0, peak, notes, perSec: notes / (64 * st.bb * 60 / st.plan.bpm) };
      st.stop();
      st.setMaster({ gain: 0.9 });
      return out;
    }, { profile, quality });
    console.log(`${profile} ×16, everything at maximum, ${quality}: underruns ${r.underruns} (${r.sec.toFixed(3)} s), peak voices ${r.peak}, ${r.perSec.toFixed(1)} notes/s`);
    await sleep(1500);
  }
} finally { await browser.close(); server.stop(); }
