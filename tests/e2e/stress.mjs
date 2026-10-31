// Real-time performance on the real output device. Headless Chrome never underruns (its fake sink
// waits for the renderer), so this launches the installed Google Chrome in a visible window and
// reads AudioContext.playbackStats (underrun events and duration) while dense 12-instrument
// pieces play. The ensemble's master is muted (the graph still does all its work).
// Usage: npm run build && node tests/e2e/stress.mjs [seconds]

import { BASE, launch, OUT, sleep, startServer } from "./harness.mjs";
import { existsSync, writeFileSync } from "node:fs";

const SECONDS = Number(process.argv[2] ?? 25);
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const server = await startServer();
const browser = await launch({ headful: true, executablePath: existsSync(chrome) ? chrome : undefined });
const rows = [];
try {
  const page = await (await browser.newContext({ viewport: { width: 1300, height: 900 } })).newPage();
  await page.goto(BASE + "#ensemble");
  await page.waitForFunction(() => window.glockworkEnsemble);
  await page.mouse.click(4, 4);
  const version = await page.evaluate(() => navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1]);
  for (const quality of ["balanced", "high"]) {
    for (const [profile, n] of [["ambient", 12], ["minimal", 12], ["cinematic", 12], ["experimental", 12], ["traditional", 16]]) {
      const r = await page.evaluate(async ({ profile, n, seconds, quality }) => {
        const st = window.glockworkEnsemble;
        st.setQuality(quality);
        st.settings = { ...st.settings, profile, instruments: n, bars: 64, mode: "arrangement", lengthMode: "bars" };
        st.composeNow(false, 4242);
        st.setMaster({ gain: 0 });
        await st.play(8 * st.bb);
        const ps = st.ctx.playbackStats;
        const u0 = ps ? { e: ps.underrunEvents, d: ps.underrunDuration } : null;
        let peak = 0;
        const t0 = performance.now();
        while (performance.now() - t0 < seconds * 1000) {
          await new Promise((res) => setTimeout(res, 250));
          peak = Math.max(peak, st.mixer.activeVoices());
        }
        const u1 = ps ? { e: ps.underrunEvents, d: ps.underrunDuration } : null;
        st.stop();
        st.setMaster({ gain: 0.9 });
        return { underruns: u1 && u0 ? u1.e - u0.e : null, underrunSec: u1 && u0 ? u1.d - u0.d : null, peakVoices: peak, latency: st.ctx.baseLatency + (st.ctx.outputLatency ?? 0) };
      }, { profile, n, seconds: SECONDS, quality });
      rows.push({ quality, profile, n, ...r });
      console.log(`${quality.padEnd(9)} ${profile.padEnd(13)} ×${n}: underruns ${r.underruns} (${(r.underrunSec ?? 0).toFixed(3)} s), peak voices ${r.peakVoices}, latency ${(r.latency * 1000).toFixed(0)} ms`);
      await sleep(1500);
    }
  }
  console.log("Chrome", version);
} finally {
  writeFileSync(OUT + "stress-report.json", JSON.stringify(rows, null, 2));
  await browser.close();
  server.stop();
}
