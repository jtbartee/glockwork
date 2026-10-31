// Shared harness for the browser checks: serves the BUILT app on its own port (verifying the server
// serves this checkout's dist/index.html), launches the cached Chrome for Testing via playwright-core,
// and collects console errors.

import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const PORT = Number(process.env.E2E_PORT ?? 8791);
export const BASE = `http://localhost:${PORT}/`;
export const OUT = new URL("../out/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const root = join(homedir(), "Library/Caches/ms-playwright");
  for (const d of existsSync(root) ? readdirSync(root).filter((x) => x.startsWith("chromium-")).sort().reverse() : []) {
    const p = join(root, d, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
    if (existsSync(p)) return p;
  }
  return undefined;
}

export async function startServer() {
  const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { stdio: ["ignore", "pipe", "pipe"], detached: true });
  const local = readFileSync(new URL("../../dist/index.html", import.meta.url), "utf8");
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(BASE);
      if (r.ok) {
        const served = await r.text();
        if (served !== local) throw new Error(`the server on ${PORT} is not serving this checkout's dist/ (stale server?)`);
        return { stop: () => { try { process.kill(-server.pid, "SIGTERM"); } catch { /* gone */ } } };
      }
    } catch (e) {
      if (String(e).includes("stale")) throw e;
    }
    await sleep(250);
  }
  throw new Error("preview server did not start");
}

export async function launch({ headful = false, executablePath = chromePath(), args = [] } = {}) {
  return chromium.launch({ executablePath, headless: !headful, args: ["--autoplay-policy=no-user-gesture-required", ...args], ignoreDefaultArgs: headful ? ["--mute-audio"] : [] });
}

export function results() {
  const list = [];
  const check = (name, ok, detail = "") => {
    list.push({ name, ok: !!ok, detail });
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  };
  return { list, check };
}
