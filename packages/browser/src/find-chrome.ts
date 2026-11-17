/**
 * Find a Chromium to drive. Faithful does not insist on the exact browser build its Playwright
 * version ships with: a machine that already has Chrome, or an older Playwright download, can
 * render a page perfectly well, and "download 150MB first" is where a tool loses most people.
 *
 * Order: FAITHFUL_CHROMIUM, CHROME_PATH, Playwright's own download folders (newest first),
 * then the system browsers on macOS, Windows and Linux.
 */
import { existsSync, readdirSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

const PER_REVISION: Record<string, string[]> = {
  linux: [
    'chrome-linux64/chrome',
    'chrome-linux/chrome',
    'chrome-headless-shell-linux64/chrome-headless-shell',
    'chrome-linux/headless_shell',
  ],
  darwin: [
    'chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium',
    'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
    'chrome-mac-x64/Chromium.app/Contents/MacOS/Chromium',
    'chrome-headless-shell-mac-arm64/chrome-headless-shell',
    'chrome-headless-shell-mac-x64/chrome-headless-shell',
  ],
  win32: ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-headless-shell-win64/chrome-headless-shell.exe'],
};

const SYSTEM: Record<string, string[]> = {
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
  ],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ],
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ],
};

function playwrightDirs(): string[] {
  const out: string[] = [];
  if (process.env.PLAYWRIGHT_BROWSERS_PATH && process.env.PLAYWRIGHT_BROWSERS_PATH !== '0')
    out.push(process.env.PLAYWRIGHT_BROWSERS_PATH);
  const home = homedir();
  if (platform() === 'darwin') out.push(join(home, 'Library', 'Caches', 'ms-playwright'));
  else if (platform() === 'win32')
    out.push(join(process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'), 'ms-playwright'));
  else out.push(join(process.env.XDG_CACHE_HOME ?? join(home, '.cache'), 'ms-playwright'));
  return out;
}

/** Every candidate executable, best first. Exported for `faithful doctor`. */
export function chromeCandidates(): string[] {
  const os = platform();
  const out: string[] = [];
  for (const v of [process.env.FAITHFUL_CHROMIUM, process.env.CHROME_PATH]) if (v) out.push(v);
  for (const dir of playwrightDirs()) {
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    // Full Chromium before the headless shell (it draws fonts the same way a person's browser
    // does); newest revision first.
    const rev = (n: string) => Number.parseInt(n.split('-').pop() ?? '0', 10) || 0;
    const full = entries.filter((e) => /^chromium-\d+$/.test(e)).sort((a, b) => rev(b) - rev(a));
    const shell = entries.filter((e) => /^chromium_headless_shell-\d+$/.test(e)).sort((a, b) => rev(b) - rev(a));
    for (const e of [...full, ...shell]) for (const rel of PER_REVISION[os] ?? []) out.push(join(dir, e, rel));
  }
  out.push(...(SYSTEM[os] ?? []));
  return out;
}

export function findChrome(): string | undefined {
  return chromeCandidates().find((p) => existsSync(p));
}
