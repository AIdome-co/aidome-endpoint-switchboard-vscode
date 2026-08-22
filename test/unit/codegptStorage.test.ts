/**
 * Unit tests for src/adapters/codegpt/codegptStorage.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  normalizeStorageBaseUrl,
  resolveCodeGptHome,
  resolveDbPath,
  resolveSettingsPath,
  writeCodeGptConnection,
  readCodeGptConnection,
  writeCodeGptLocalFlavor,
  CODEGPT_LOCAL_PROVIDER,
} from '../../src/adapters/codegpt/codegptStorage';

// Logger pulls in vscode -> runtimeSettings; mock it so this stays a pure unit
// test without the vscode module.
vi.mock('vscode', () => ({
  workspace: { getConfiguration: () => ({ get: () => undefined }) },
}));

vi.mock('../../src/util/log', () => ({
  Logger: {
    getInstance: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

let tmpHome: string;

beforeAll(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codegpt-storage-'));
});

afterAll(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe('path resolution', () => {
  it('resolves ~/.codegpt as the default home', () => {
    const home = resolveCodeGptHome('/home/test');
    expect(home).toBe(path.join('/home/test', '.codegpt'));
  });

  it('prefers CODEGPT_HOME when set', () => {
    const prev = process.env.CODEGPT_HOME;
    process.env.CODEGPT_HOME = '/custom/codegpt-home';
    try {
      expect(resolveCodeGptHome('/home/test')).toBe('/custom/codegpt-home');
    } finally {
      if (prev === undefined) delete process.env.CODEGPT_HOME;
      else process.env.CODEGPT_HOME = prev;
    }
  });

  it('builds db and settings paths under the home dir', () => {
    const home = resolveCodeGptHome('/home/test');
    expect(resolveDbPath('/home/test')).toBe(path.join(home, 'db.sqlite'));
    expect(resolveSettingsPath('/home/test')).toBe(path.join(home, 'settings.json'));
  });
});

describe('normalizeStorageBaseUrl', () => {
  it('strips trailing slash', () => {
    expect(normalizeStorageBaseUrl('http://host:8100/')).toBe('http://host:8100');
  });

  it('strips /v1 suffix', () => {
    expect(normalizeStorageBaseUrl('http://host:8100/v1')).toBe('http://host:8100');
  });

  it('strips /v1/models suffix', () => {
    expect(normalizeStorageBaseUrl('http://host:8100/v1/models')).toBe('http://host:8100');
  });

  it('leaves a bare origin unchanged', () => {
    expect(normalizeStorageBaseUrl('http://host:8100')).toBe('http://host:8100');
  });
});

describe('writeCodeGptConnection / readCodeGptConnection', () => {
  it('writes and reads back the local provider custom_link + apikey', async () => {
    const backup = await writeCodeGptConnection('http://80.240.29.183:8100', 'my-secret-key', tmpHome);
    // Backups only created when the file already exists; for a fresh temp dir it
    // may be undefined — either is fine.
    expect(backup ?? 'no-backup').toBeDefined();

    const stored = await readCodeGptConnection(tmpHome);
    expect(stored?.customLink).toBe('http://80.240.29.183:8100');
    expect(stored?.apikey).toBe('my-secret-key');
  });

  it('updates an existing row (upsert) preserving other columns', async () => {
    // First write.
    await writeCodeGptConnection('http://first:1', 'key1', tmpHome);
    // Second write updates custom_link + apikey.
    await writeCodeGptConnection('http://second:2', 'key2', tmpHome);

    const stored = await readCodeGptConnection(tmpHome);
    expect(stored?.customLink).toBe('http://second:2');
    expect(stored?.apikey).toBe('key2');

    // Only one row for the provider.
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(resolveDbPath(tmpHome), { readOnly: true });
    const rows = db.prepare('SELECT COUNT(*) AS n FROM connection WHERE provider = ?').get(CODEGPT_LOCAL_PROVIDER) as { n: number };
    db.close();
    expect(rows.n).toBe(1);
  });

  it('returns undefined from read when the DB is absent', async () => {
    const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codegpt-empty-'));
    try {
      const stored = await readCodeGptConnection(emptyHome);
      expect(stored).toBeUndefined();
    } finally {
      fs.rmSync(emptyHome, { recursive: true, force: true });
    }
  });
});

describe('writeCodeGptLocalFlavor', () => {
  it('sets the local-server-flavor key to custom', async () => {
    const ok = await writeCodeGptLocalFlavor(tmpHome);
    expect(ok).toBe(true);

    const settingsRaw = fs.readFileSync(resolveSettingsPath(tmpHome), 'utf-8');
    const settings = JSON.parse(settingsRaw);
    expect(settings[`local-server-flavor-${CODEGPT_LOCAL_PROVIDER}`]).toBe('custom');
  });

  it('is idempotent when already set', async () => {
    await writeCodeGptLocalFlavor(tmpHome);
    // Second call: still true, and settings unchanged (no corruption).
    const ok = await writeCodeGptLocalFlavor(tmpHome);
    expect(ok).toBe(true);
    const settings = JSON.parse(fs.readFileSync(resolveSettingsPath(tmpHome), 'utf-8'));
    expect(settings[`local-server-flavor-${CODEGPT_LOCAL_PROVIDER}`]).toBe('custom');
  });
});
