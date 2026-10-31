// The desktop build: launch Electron on dist/ (file://, the app's CSP, sandboxed renderer), then
// drive it over CDP — switch to the ENSEMBLE workspace, compose, play, render audio, save to IndexedDB.
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { sleep } from "./harness.mjs";

const port = 9334;
// (editors built on Electron export ELECTRON_RUN_AS_NODE to their children; the app must not inherit it)
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = spawn("npx", ["electron", ".", `--remote-debugging-port=${port}`], { stdio: "ignore", detached: true, env });
let browser;
try {
  for (let i = 0; i < 60; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) break; } catch { /* starting */ } await sleep(500); }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page = browser.contexts()[0].pages()[0];
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.waitForFunction(() => window.glockworkEnsemble, null, { timeout: 20000 });
  const url = page.url();
  await page.click('.workspace-tab:has-text("Ensemble")');
  const r = await page.evaluate(async () => {
    const st = window.glockworkEnsemble;
    st.settings = { ...st.settings, profile: "cinematic", instruments: 8, bars: 16 };
    st.composeNow(false, 5);
    await st.play(0);
    await new Promise((res) => setTimeout(res, 2500));
    const voices = st.mixer.activeVoices();
    const pos = st.transport.position();
    st.stop();
    const wav = await st.renderWav(16);
    return { voices, pos, wavBytes: wav.length, notes: st.composition.tracks.reduce((s, t) => s + t.notes.length, 0) };
  });
  console.log(`Electron loaded ${url.slice(0, 60)}…`);
  console.log(`compose: ${r.notes} notes; live: ${r.voices} voices at beat ${r.pos.toFixed(2)}; WAV render ${(r.wavBytes / 1e6).toFixed(1)} MB; console errors: ${errors.length ? errors.join(" | ") : "none"}`);
  process.exitCode = r.notes > 0 && r.pos > 1 && r.wavBytes > 1e6 && !errors.length ? 0 : 1;
} finally {
  await browser?.close().catch(() => {});
  try { process.kill(-app.pid, "SIGTERM"); } catch { /* gone */ }
}
