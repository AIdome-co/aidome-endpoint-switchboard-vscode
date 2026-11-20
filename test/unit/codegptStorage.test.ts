/**
 * Unit tests for src/adapters/codegpt/codegptStorage.ts
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
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
  writeCodeGptConnectionViaSidecar,
  checkpointCodeGptDb,
  backupCodeGptDb,
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

  it('clears the previous credential when the new profile has none (no token carry-over)', async () => {
    // Profile A with a credential...
    await writeCodeGptConnection('http://a:1', 'secret-A', tmpHome);
    // ...then switch to profile B without a saved credential.
    await writeCodeGptConnection('http://b:2', undefined, tmpHome);

    const stored = await readCodeGptConnection(tmpHome);
    expect(stored?.customLink).toBe('http://b:2');
    // The old token must NOT survive the switch (Codex 4648050946).
    expect(stored?.apikey).toBeUndefined();
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

describe('writeCodeGptConnectionViaSidecar / checkpointCodeGptDb / backupCodeGptDb', () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('prefers the sidecar API and sends the connection payload', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 } as Response));
    globalThis.fetch = fetchMock as typeof fetch;

    const ok = await writeCodeGptConnectionViaSidecar('https://gw.example.com', 'key-x', tmpHome);
    expect(ok).toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/api/migrate-sqlite');
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      type: 'connection',
      provider: CODEGPT_LOCAL_PROVIDER,
      custom_link: 'https://gw.example.com',
      apikey: 'key-x'
    });
  });

  it('falls back to the direct write when the sidecar is unreachable', async () => {
    // Make the sidecar unreachable, then exercise the registered writer path
    // end to end: checkpoint -> backup -> sidecar fail -> direct write.
    globalThis.fetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;

    // Give the DB an existing row so the backup path is exercised.
    await writeCodeGptConnection('http://before:1', 'k1', tmpHome);

    const backupPath = await backupCodeGptDb(tmpHome);
    expect(backupPath).toBeDefined();

    const viaSidecar = await writeCodeGptConnectionViaSidecar('http://after:2', 'k2', tmpHome);
    expect(viaSidecar).toBe(false);

    await writeCodeGptConnection('http://after:2', 'k2', tmpHome, { skipBackup: true });
    const stored = await readCodeGptConnection(tmpHome);
    expect(stored?.customLink).toBe('http://after:2');
    expect(stored?.apikey).toBe('k2');
  });

  it('checkpoint is advisory: true on an existing db, tolerant on a missing one', async () => {
    expect(await checkpointCodeGptDb(tmpHome)).toBe(true);
    const missing = fs.mkdtempSync(path.join(os.tmpdir(), 'codegpt-missing-'));
    try {
      expect(await checkpointCodeGptDb(missing)).toBe(true);
    } finally {
      fs.rmSync(missing, { recursive: true, force: true });
    }
  });

  it('backupCodeGptDb returns undefined when the DB does not exist yet', async () => {
    const missing = fs.mkdtempSync(path.join(os.tmpdir(), 'codegpt-missing2-'));
    try {
      expect(await backupCodeGptDb(missing)).toBeUndefined();
    } finally {
      fs.rmSync(missing, { recursive: true, force: true });
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

  it('fails closed on an unparsable settings.json and preserves its content', async () => {
    const corruptHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codegpt-corrupt-'));
    try {
      const settingsPath = resolveSettingsPath(corruptHome);
      fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
      const corrupt = '{ almost json "local-server-flavor-lmstudio": "openai" }';
      fs.writeFileSync(settingsPath, corrupt);

      await expect(writeCodeGptLocalFlavor(corruptHome)).resolves.toBe(false);

      // The corrupt file must be untouched — never replaced by a default object.
      expect(fs.readFileSync(settingsPath, 'utf-8')).toBe(corrupt);
    } finally {
      fs.rmSync(corruptHome, { recursive: true, force: true });
    }
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
