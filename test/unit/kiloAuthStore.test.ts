/**
 * Unit tests for the Kilo credential store writer (auth.json) — including
 * the authenticated model re-render of kilo.jsonc.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

const { mockLoggerWarning, mockDiscoverModels, mockGetKiloConfigPath } = vi.hoisted(() => ({
  mockLoggerWarning: vi.fn(),
  mockDiscoverModels: vi.fn(),
  mockGetKiloConfigPath: vi.fn((): string | undefined => undefined)
}));

vi.mock('../../src/util/log', () => ({
  Logger: {
    getInstance: () => ({
      error: vi.fn(),
      warning: mockLoggerWarning,
      info: vi.fn()
    })
  }
}));

vi.mock('../../src/adapters/kilocode/kiloConfigPatcher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/adapters/kilocode/kiloConfigPatcher')>();
  return {
    ...actual,
    discoverModels: mockDiscoverModels,
    getKiloConfigPath: mockGetKiloConfigPath
  };
});

import {
  KILO_PROVIDER_SLUG,
  mergeModelEntries,
  resolveKiloAuthPath,
  writeKiloProviderAuth
} from '../../src/adapters/kilocode/kiloAuthStore';

describe('kiloAuthStore', () => {
  let dataDir: string;
  let configDir: string;
  let authPath: string;
  let configPath: string;
  const savedXdgData = process.env.XDG_DATA_HOME;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kilo-auth-'));
    configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kilo-cfg-'));
    authPath = path.join(dataDir, 'kilo', 'auth.json');
    configPath = path.join(configDir, 'kilo.jsonc');
    delete process.env.XDG_DATA_HOME;
    mockLoggerWarning.mockReset();
    mockDiscoverModels.mockReset();
    mockGetKiloConfigPath.mockReset();
    mockGetKiloConfigPath.mockReturnValue(undefined);
  });

  afterEach(async () => {
    if (savedXdgData === undefined) {
      delete process.env.XDG_DATA_HOME;
    } else {
      process.env.XDG_DATA_HOME = savedXdgData;
    }
    await fs.rm(dataDir, { recursive: true, force: true });
    await fs.rm(configDir, { recursive: true, force: true });
  });

  describe('resolveKiloAuthPath', () => {
    it('uses XDG_DATA_HOME when set', () => {
      process.env.XDG_DATA_HOME = '/xdg/data';
      expect(resolveKiloAuthPath()).toBe(path.join('/xdg/data', 'kilo', 'auth.json'));
    });

    it('falls back to ~/.local/share and honours the injected dataDir', () => {
      expect(resolveKiloAuthPath()).toBe(
        path.join(os.homedir(), '.local', 'share', 'kilo', 'auth.json')
      );
      expect(resolveKiloAuthPath('/custom/data')).toBe(
        path.join('/custom/data', 'kilo', 'auth.json')
      );
    });
  });

  describe('writeKiloProviderAuth — fresh file', () => {
    it('creates auth.json at mode 0600 with the provider entry and reports createdFile', async () => {
      const result = await writeKiloProviderAuth({
        baseUrl: 'https://gw.example.com/v1',
        apiKey: 'aid_pat_test',
        dataDir
      });

      expect(result.createdFile).toBe(true);
      expect(result.backupPath).toBeUndefined();
      expect(result.target).toBe(authPath);

      const written = JSON.parse(await fs.readFile(authPath, 'utf-8'));
      expect(written[KILO_PROVIDER_SLUG]).toEqual({ type: 'api', key: 'aid_pat_test' });
      const stat = await fs.stat(authPath);
      expect(stat.mode & 0o777).toBe(0o600);
    });
  });

  describe('writeKiloProviderAuth — existing file', () => {
    it('preserves unrelated providers and overwrites our entry explicitly', async () => {
      await fs.mkdir(path.dirname(authPath), { recursive: true });
      await fs.writeFile(
        authPath,
        JSON.stringify({
          kilo: { type: 'oauth', refresh: 'r', access: 'a' },
          [KILO_PROVIDER_SLUG]: { type: 'api', key: 'OLD_PAT' }
        }),
        { mode: 0o600 }
      );

      const result = await writeKiloProviderAuth({
        baseUrl: 'https://gw.example.com/v1',
        apiKey: 'aid_pat_new',
        dataDir
      });

      expect(result.createdFile).toBe(false);
      expect(result.backupPath).toBeDefined();
      const written = JSON.parse(await fs.readFile(authPath, 'utf-8'));
      // Never COALESCE-preserve the previous credential (Area 7.3).
      expect(written[KILO_PROVIDER_SLUG]).toEqual({ type: 'api', key: 'aid_pat_new' });
      expect(written.kilo).toEqual({ type: 'oauth', refresh: 'r', access: 'a' });
      const backup = JSON.parse(await fs.readFile(result.backupPath!, 'utf-8'));
      expect(backup[KILO_PROVIDER_SLUG]).toEqual({ type: 'api', key: 'OLD_PAT' });
    });

    it('clears our entry for a credential-less profile while keeping others', async () => {
      await fs.mkdir(path.dirname(authPath), { recursive: true });
      await fs.writeFile(
        authPath,
        JSON.stringify({
          kilo: { type: 'oauth', refresh: 'r', access: 'a' },
          [KILO_PROVIDER_SLUG]: { type: 'api', key: 'OLD_PAT' }
        }),
        { mode: 0o600 }
      );

      await writeKiloProviderAuth({ baseUrl: 'https://gw.example.com/v1', dataDir });

      const written = JSON.parse(await fs.readFile(authPath, 'utf-8'));
      expect(written[KILO_PROVIDER_SLUG]).toBeUndefined();
      expect(written.kilo).toEqual({ type: 'oauth', refresh: 'r', access: 'a' });
    });
  });

  describe('writeKiloProviderAuth — fail-closed guards', () => {
    it('refuses to replace an unparsable auth.json', async () => {
      await fs.mkdir(path.dirname(authPath), { recursive: true });
      await fs.writeFile(authPath, '{not json', { mode: 0o600 });

      await expect(
        writeKiloProviderAuth({ baseUrl: 'https://gw.example.com/v1', apiKey: 'k', dataDir })
      ).rejects.toThrow(/not valid JSON; refusing to overwrite/);

      expect(await fs.readFile(authPath, 'utf-8')).toBe('{not json');
    });

    it('refuses to mutate an existing file when the backup cannot be created', async () => {
      await fs.mkdir(path.dirname(authPath), { recursive: true });
      await fs.writeFile(authPath, '{}', { mode: 0o600 });

      const fsSafe = await import('../../src/util/fsSafe');
      const spy = vi.spyOn(fsSafe, 'createBackup').mockResolvedValue(undefined);

      try {
        await expect(
          writeKiloProviderAuth({ baseUrl: 'https://gw.example.com/v1', apiKey: 'k', dataDir })
        ).rejects.toThrow(/refusing to mutate it without a recoverable copy/);
        expect(await fs.readFile(authPath, 'utf-8')).toBe('{}');
      } finally {
        spy.mockRestore();
      }
    });

    it('refuses to mutate a non-object auth.json (array)', async () => {
      await fs.mkdir(path.dirname(authPath), { recursive: true });
      await fs.writeFile(authPath, '[]', { mode: 0o600 });

      await expect(
        writeKiloProviderAuth({ baseUrl: 'https://gw.example.com/v1', apiKey: 'k', dataDir })
      ).rejects.toThrow(/not valid JSON; refusing to overwrite/);
      expect(await fs.readFile(authPath, 'utf-8')).toBe('[]');
    });
  });

  describe('authenticated model re-render', () => {
    it('merges discovered models into the provider entry, existing entries win', async () => {
      await fs.mkdir(path.dirname(authPath), { recursive: true });
      await fs.writeFile(authPath, '{}', { mode: 0o600 });
      await fs.writeFile(
        configPath,
        `{\n  "provider": {\n    // user comment must survive\n    "${KILO_PROVIDER_SLUG}": {\n      "name": "AIdome Gateway",\n      "options": { "baseURL": "https://gw.example.com/v1" },\n      "models": { "custom-model": { "name": "My Custom" } }\n    }\n  }\n}\n`
      );
      mockGetKiloConfigPath.mockReturnValue(configPath);
      mockDiscoverModels.mockResolvedValue(['custom-model', 'anthropic/claude-sonnet-4-6']);

      const result = await writeKiloProviderAuth({
        baseUrl: 'https://gw.example.com/v1',
        apiKey: 'aid_pat_x',
        dataDir,
        configPath
      });

      expect(result.extraRollbacks).toHaveLength(1);
      expect(result.extraRollbacks![0].target).toBe(configPath);
      expect(result.extraRollbacks![0].createdFile).toBe(false);

      const config = await fs.readFile(configPath, 'utf-8');
      expect(config).toContain('user comment must survive');
      const { parseJsonc } = await import('../../src/util/jsonc');
      const parsed = parseJsonc<Record<string, never>>(config) as unknown as {
        provider: Record<string, { models: Record<string, { name: string }> }>;
      };
      const models = parsed.provider[KILO_PROVIDER_SLUG].models;
      // existing entry wins, discovered entry added
      expect(models['custom-model']).toEqual({ name: 'My Custom' });
      expect(models['anthropic/claude-sonnet-4-6']).toEqual({
        name: 'anthropic/claude-sonnet-4-6'
      });
      expect(mockDiscoverModels).toHaveBeenCalledWith('https://gw.example.com/v1', 'aid_pat_x');
    });

    it('leaves the config untouched when discovery returns nothing', async () => {
      await fs.mkdir(path.dirname(authPath), { recursive: true });
      await fs.writeFile(authPath, '{}', { mode: 0o600 });
      await fs.writeFile(configPath, '{"provider":{}}');
      mockGetKiloConfigPath.mockReturnValue(configPath);
      mockDiscoverModels.mockResolvedValue([]);

      const result = await writeKiloProviderAuth({
        baseUrl: 'https://gw.example.com/v1',
        apiKey: 'k',
        dataDir,
        configPath
      });

      expect(result.extraRollbacks).toHaveLength(0);
      expect(await fs.readFile(configPath, 'utf-8')).toBe('{"provider":{}}');
    });

    it('leaves the config untouched when no credential is available', async () => {
      await fs.mkdir(path.dirname(authPath), { recursive: true });
      await fs.writeFile(authPath, '{}', { mode: 0o600 });
      await fs.writeFile(configPath, '{"provider":{}}');
      mockGetKiloConfigPath.mockReturnValue(configPath);

      const result = await writeKiloProviderAuth({
        baseUrl: 'https://gw.example.com/v1',
        dataDir,
        configPath
      });

      expect(result.extraRollbacks).toHaveLength(0);
      expect(mockDiscoverModels).not.toHaveBeenCalled();
      const written = JSON.parse(await fs.readFile(authPath, 'utf-8'));
      expect(written[KILO_PROVIDER_SLUG]).toBeUndefined();
    });

    it('self-restores the auth write when the config model write fails', async () => {
      await fs.mkdir(path.dirname(authPath), { recursive: true });
      await fs.writeFile(authPath, '{"kilo":{"type":"oauth","refresh":"r","access":"a"}}', {
        mode: 0o600
      });
      await fs.writeFile(configPath, '{"provider":{}}');
      mockGetKiloConfigPath.mockReturnValue(configPath);
      mockDiscoverModels.mockResolvedValue(['m-1']);

      const fsSafe = await import('../../src/util/fsSafe');
      const realCreateBackup = fsSafe.createBackup;
      let call = 0;
      const spy = vi
        .spyOn(fsSafe, 'createBackup')
        .mockImplementation((async (filePath: string) => {
          call += 1;
          if (filePath === configPath) {
            return undefined; // simulate backup failure on the config write
          }
          return realCreateBackup(filePath);
        }) as typeof fsSafe.createBackup);

      try {
        await expect(
          writeKiloProviderAuth({
            baseUrl: 'https://gw.example.com/v1',
            apiKey: 'k',
            dataDir,
            configPath
          })
        ).rejects.toThrow(/refusing to mutate it without a recoverable copy/);

        // The already-committed auth write was self-restored.
        const restored = JSON.parse(await fs.readFile(authPath, 'utf-8'));
        expect(restored[KILO_PROVIDER_SLUG]).toBeUndefined();
        expect(restored.kilo).toEqual({ type: 'oauth', refresh: 'r', access: 'a' });
        expect(call).toBeGreaterThan(0);
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('mergeModelEntries', () => {
    it('parses JSONC with comments and falls back to the id for nameless entries', () => {
      const merged = mergeModelEntries(
        `{\n // comment\n "provider": { "aidome-gateway": { "models": { "a": { "name": "A" }, "b": {} } } } }`,
        ['b', 'c']
      );
      expect(merged['a']).toEqual({ name: 'A' });
      expect(merged['b']).toEqual({ name: 'b' });
      expect(merged['c']).toEqual({ name: 'c' });
    });

    it('returns discovered-only entries for an unparsable or missing provider section', () => {
      expect(mergeModelEntries('not json', ['x'])).toEqual({ x: { name: 'x' } });
      expect(mergeModelEntries('{"other":1}', ['x'])).toEqual({ x: { name: 'x' } });
    });
  });
});
