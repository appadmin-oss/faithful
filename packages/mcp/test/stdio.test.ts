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
  it('lists five tools and answers a verify, an outline, an explain and a guard', async () => {
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
        'faithful_verify',
      ]);
      // Every description is paid for on every turn of every session: keep them short.
      const words = list.result.tools.reduce(
        (n: number, t: { description: string }) => n + t.description.split(/\s+/).length,
        0,
      );
      expect(words).toBeLessThan(150);

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
    } finally {
      c.close();
    }
  }, 120_000);
});
