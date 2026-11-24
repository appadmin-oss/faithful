/**
 * The server spoken to the way a client speaks to it: a child process over stdio, JSON-RPC
 * lines in and out. A unit test of `createServer()` would pass while the bin failed to start.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const BIN = resolve(__dirname, '../dist/bin.js');

function client(cwd: string) {
  const p = spawn(process.execPath, [BIN], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '';
  const waiting = new Map<number, (m: Record<string, unknown>) => void>();
  p.stdout.on('data', (d) => {
    buf += d;
    for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      const m = JSON.parse(line);
      waiting.get(m.id)?.(m);
    }
  });
  let id = 0;
  const call = (method: string, params: unknown = {}) =>
    // biome-ignore lint/suspicious/noExplicitAny: JSON-RPC replies are untyped wire data
    new Promise<Record<string, any>>((ok) => {
      const n = ++id;
      waiting.set(n, ok);
      p.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: n, method, params })}\n`);
    });
  const notify = (method: string) => p.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`);
  return { call, notify, close: () => p.kill() };
}

describe('faithful-mcp over stdio', () => {
  it('lists six tools and answers a verify, an outline, an explain and a guard', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'faithful-mcp-'));
    const page = (h: string, c: string) =>
      `<!doctype html><html><body style="margin:0;font:16px sans-serif"><h1 style="margin:40px;color:${c}">${h}</h1><p style="margin:0 40px">Cancel any time.</p></body></html>`;
    writeFileSync(join(dir, 'design.html'), page('Choose your plan', '#10292c'));
    writeFileSync(join(dir, 'build.html'), page('Choose a plan', '#10292c'));
    writeFileSync(join(dir, 'app.css'), '.x{color:#123456 !important}\n');
    const c = client(dir);
    try {
      const init = await c.call('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test', version: '0' },
      });
      expect(init.result.serverInfo.name).toBe('faithful');
      c.notify('notifications/initialized');

      const list = await c.call('tools/list');
      expect(list.result.tools.map((t: { name: string }) => t.name).sort()).toEqual([
        'faithful_audit',
        'faithful_explain',
        'faithful_guard',
        'faithful_outline',
        'faithful_parity',
        'faithful_verify',
      ]);
      // Every description is paid for on every turn of every session: keep them short.
      const words = list.result.tools.reduce(
        (n: number, t: { description: string }) => n + t.description.split(/\s+/).length,
        0,
      );
      expect(words).toBeLessThan(180);

      const v = await c.call('tools/call', {
        name: 'faithful_verify',
        arguments: { design: 'design.html', build: 'build.html', viewports: '800x600' },
      });
      expect(v.result.isError).toBeFalsy();
      expect(v.result.content[0].text).toMatch(/^faithful FAIL /);
      expect(v.result.structuredContent.pass).toBe(false);
      expect(v.result.structuredContent.top.some((f: { k: string }) => f.k === 'text')).toBe(true);

      const e = await c.call('tools/call', { name: 'faithful_explain', arguments: { finding: 'F1' } });
      expect(e.result.content[0].text).toMatch(/^F1 E /);

      const o = await c.call('tools/call', { name: 'faithful_outline', arguments: { design: 'design.html' } });
      expect(o.result.content[0].text).toContain('Choose your plan');

      const g = await c.call('tools/call', { name: 'faithful_guard', arguments: { files: ['app.css'] } });
      expect(g.result.structuredContent.pass).toBe(false);

      const bad = await c.call('tools/call', { name: 'faithful_outline', arguments: { design: 'nope.xyz' } });
      expect(bad.result.isError).toBe(true);

      // colorScheme reaches the renderer: text that vanishes only in dark is caught only in dark.
      writeFileSync(
        join(dir, 'theme.html'),
        '<!doctype html><html lang="en"><head><title>t</title><style>body{background:#fff;color:#111;font:17px/1.5 Georgia}@media (prefers-color-scheme: dark){body{background:#151515}}</style></head><body><main><p>Readable only in the light theme.</p></main></body></html>',
      );
      const light = await c.call('tools/call', {
        name: 'faithful_audit',
        arguments: { target: 'theme.html', viewports: '800x600' },
      });
      expect(light.result.content[0].text).toMatch(/^faithful PASS/);
      const dark = await c.call('tools/call', {
        name: 'faithful_audit',
        arguments: { target: 'theme.html', viewports: '800x600', colorScheme: 'dark' },
      });
      expect(dark.result.structuredContent.top.map((f: { k: string }) => f.k)).toEqual(['contrast']);
      const darkVerify = await c.call('tools/call', {
        name: 'faithful_verify',
        arguments: { design: 'design.html', build: 'design.html', viewports: '800x600', colorScheme: 'dark' },
      });
      expect(darkVerify.result.content[0].text).toMatch(/^faithful PASS/);
      const wrong = await c.call('tools/call', {
        name: 'faithful_audit',
        arguments: { target: 'theme.html', colorScheme: 'sepia' },
      });
      expect(wrong.result.isError).toBe(true);

      // stress reaches the renderer: a fixed-height box that fits its text clips it with WCAG
      // spacing, and with 200% text, which every audit now tries unless told otherwise.
      writeFileSync(
        join(dir, 'spacing.html'),
        '<!doctype html><html lang="en"><head><title>t</title><style>body{margin:0;font:16px/1.5 Georgia;background:#fff;color:#111}main{padding:20px}.note{height:40px;width:300px;overflow:hidden;font:16px/20px Georgia}</style></head><body><main><div class="note">Bins go out on Tuesday night. Garden waste is collected every other week.</div></main></body></html>',
      );
      const plain = await c.call('tools/call', {
        name: 'faithful_audit',
        arguments: { target: 'spacing.html', viewports: '800x600' },
      });
      expect(plain.result.content[0].text).toMatch(/^faithful FAIL 1E 0W/);
      expect(plain.result.content[0].text).toMatch(/clipped: with text at 200% \(WCAG 1\.4\.4\)/);
      const spaced = await c.call('tools/call', {
        name: 'faithful_audit',
        arguments: { target: 'spacing.html', viewports: '800x600', stress: ['spacing'] },
      });
      expect(spaced.result.structuredContent.top.map((f: { k: string }) => f.k)).toEqual(['clipped']);
      expect(spaced.result.content[0].text).not.toMatch(/200%/);
      expect(spaced.result.content[0].text).toMatch(/with WCAG 1\.4\.12 text spacing/);
      const unknown = await c.call('tools/call', {
        name: 'faithful_audit',
        arguments: { target: 'spacing.html', stress: ['huge'] },
      });
      expect(unknown.result.isError).toBe(true);
    } finally {
      c.close();
    }
  }, 120_000);
});
