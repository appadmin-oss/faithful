/**
 * faithful_verify on a Claude Design canvas over stdio: `screen` reaches the verifier, and a
 * canvas of several boards without it is an error naming the ids, not a run.
 */
import { spawn } from 'node:child_process';
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const BIN = resolve(__dirname, '../dist/bin.js');

function client(cwd: string) {
  const p = spawn(process.execPath, [BIN], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '';
  // biome-ignore lint/suspicious/noExplicitAny: JSON-RPC replies are untyped wire data
  const waiting = new Map<number, (m: Record<string, any>) => void>();
  p.stdout.on('data', (d) => {
    buf += d;
    for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (line.trim()) {
        const m = JSON.parse(line);
        waiting.get(m.id)?.(m);
      }
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
  return {
    call,
    notify: (m: string) => p.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: m })}\n`),
    close: () => p.kill(),
  };
}

describe('faithful_verify on a canvas', () => {
  it('needs `screen` when the canvas has several boards, and compares only that board', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'faithful-mcp-canvas-'));
    cpSync(resolve(__dirname, '../../../fixtures/canvas'), dir, { recursive: true });
    const c = client(dir);
    try {
      await c.call('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 't', version: '0' },
      });
      c.notify('notifications/initialized');
      const verify = (args: Record<string, string>) =>
        c.call('tools/call', {
          name: 'faithful_verify',
          arguments: { design: 'project/canvas.json', build: 'build-home.html', ...args },
        });
      const none = await verify({});
      expect(none.result.isError).toBe(true);
      expect(none.result.content[0].text).toMatch(/--screen <id>: home, pricing/);
      const home = await verify({ screen: 'home' });
      expect(home.result.isError).toBeFalsy();
      expect(home.result.structuredContent.pass).toBe(true);
      const bad = await verify({ screen: 'home', build: 'build-home-faulty.html' });
      expect(bad.result.structuredContent.pass).toBe(false);
    } finally {
      c.close();
    }
  }, 120_000);
});
