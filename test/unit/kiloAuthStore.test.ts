/**
 * Unit tests for the Kilo credential store writer (auth.json) — including
 * the authenticated model re-render of kilo.jsonc.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

/** Windows emulates POSIX modes (chmod can only toggle read-only), so the
 * strict 0600 assertions are POSIX-only — runner-portable per the Kilo test
 * recipes. */
const expectPosix0600 = (stat: { mode: number }) => {
  expect(process.platform === 'win32' || (stat.mode & 0o777) === 0o600).toBe(true);
};

const {
  mockLoggerWarning,
  mockDiscoverModels,
  mockGetKiloConfigPath,
  failNextAuthWrite,
  failNextAuthChmod,
  configReadQueue
} = vi.hoisted(() => ({
  mockLoggerWarning: vi.fn(),
  mockDiscoverModels: vi.fn(),
  mockGetKiloConfigPath: vi.fn((): string | undefined => undefined),
  failNextAuthWrite: { value: false },
  failNextAuthChmod: { value: false },
  configReadQueue: { values: [] as string[] }
}));

// ESM namespaces cannot be spied on — wrap fs/promises with a test seam that
// fails the next writeFile call when requested.
vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  const readThrough = async (...args: Parameters<typeof actual.readFile>) => {
    const p = String(args[0]);
    if (configReadQueue.values.length > 0 && p.endsWith('kilo.jsonc')) {
      return configReadQueue.values.shift() as string;
    }
    return actual.readFile(...args);
  };
  return {
    ...actual,
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
      if (failNextAuthWrite.value) {
        failNextAuthWrite.value = false;
        throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' });
      }
      return actual.writeFile(...args);
    },
    readFile: readThrough,
    chmod: async (...args: Parameters<typeof actual.chmod>) => {
      if (failNextAuthChmod.value) {
        failNextAuthChmod.value = false;
        throw Object.assign(new Error('EOPNOTSUPP'), { code: 'EOPNOTSUPP' });
      }
      return actual.chmod(...args);
    },
    default: actual
  };
});

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
  reconcileModelEntries,
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
    failNextAuthChmod.value = false;
    configReadQueue.values.length = 0;
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
      expectPosix0600(stat);
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
      // Credential backups are always 0600 — a legacy 0644 source must not
      // leave a world-readable PAT copy behind (Codex 154 round 6).
      expectPosix0600(await fs.stat(result.backupPath!));
      const written = JSON.parse(await fs.readFile(authPath, 'utf-8'));
      // Never COALESCE-preserve the previous credential (Area 7.3).
      expect(written[KILO_PROVIDER_SLUG]).toEqual({ type: 'api', key: 'aid_pat_new' });
      expect(written.kilo).toEqual({ type: 'oauth', refresh: 'r', access: 'a' });
      const backup = JSON.parse(await fs.readFile(result.backupPath!, 'utf-8'));
      expect(backup[KILO_PROVIDER_SLUG]).toEqual({ type: 'api', key: 'OLD_PAT' });
    });

    it('enforces 0600 on an existing permissive auth.json (Codex 154 round 3)', async () => {
      await fs.mkdir(path.dirname(authPath), { recursive: true });
      await fs.writeFile(authPath, '{}', { mode: 0o644 });

      await writeKiloProviderAuth({
        baseUrl: 'https://gw.example.com/v1',
        apiKey: 'aid_pat_test',
        dataDir
      });

      // writeFile's mode only applies on CREATE — the atomic temp+rename
      // replacement is what narrows a legacy 0644 file back to 0600.
      expectPosix0600(await fs.stat(authPath));
    });

    it('preserves a DANGLING symlinked auth.json and materializes its target', async () => {
      const realDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kilo-dangle-'));
      const realPath = path.join(realDir, 'auth.json'); // target deliberately absent
      await fs.mkdir(path.dirname(authPath), { recursive: true });
      await fs.symlink(realPath, authPath);

      try {
        const result = await writeKiloProviderAuth({
          baseUrl: 'https://gw.example.com/v1',
          apiKey: 'aid_pat_dangle',
          dataDir
        });

        // The link itself survives (never replaced by a regular file).
        const linkStat = await fs.lstat(authPath);
        expect(linkStat.isSymbolicLink()).toBe(true);
        // The absent target now materializes with the credential.
        const target = JSON.parse(await fs.readFile(realPath, 'utf-8'));
        expect(target[KILO_PROVIDER_SLUG]).toEqual({ type: 'api', key: 'aid_pat_dangle' });
        // Generic rollback metadata points at the MATERIALIZED target with a
        // created-file marker, so a failure/user rollback removes the created
        // file and the dangling link survives untouched.
        expect(result.createdFile).toBe(true);
        expect(result.target).toBe(realPath);
      } finally {
        await fs.rm(realDir, { recursive: true, force: true });
      }
    });

    it('removes the materialized target when the model refresh fails (dangling link, Codex 154 round 11)', async () => {
      const realDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kilo-dangle2-'));
      const realPath = path.join(realDir, 'auth.json');
      await fs.mkdir(path.dirname(authPath), { recursive: true });
      await fs.symlink(realPath, authPath);
      await fs.writeFile(configPath, '{"provider":{}}');
      mockGetKiloConfigPath.mockReturnValue(configPath);
      mockDiscoverModels.mockRejectedValueOnce(new Error('gateway unreachable'));

      try {
        await expect(
          writeKiloProviderAuth({
            baseUrl: 'https://gw.example.com/v1',
            apiKey: 'aid_pat_rollback',
            dataDir,
            configPath
          })
        ).rejects.toThrow('gateway unreachable');

        // Back to the ORIGINAL dangling state: link present, target absent,
        // no PAT left behind anywhere.
        const linkStat = await fs.lstat(authPath);
        expect(linkStat.isSymbolicLink()).toBe(true);
        await expect(fs.stat(realPath)).rejects.toThrow();
      } finally {
        await fs.rm(realDir, { recursive: true, force: true });
      }
    });

    it('fails closed and deletes the backup when its mode cannot be tightened (Codex 154 round 11)', async () => {
      await fs.mkdir(path.dirname(authPath), { recursive: true });
      await fs.writeFile(authPath, JSON.stringify({ kilo: { type: 'oauth', refresh: 'r', access: 'a' } }), {
        mode: 0o644
      });
      failNextAuthChmod.value = true;

      await expect(
        writeKiloProviderAuth({
          baseUrl: 'https://gw.example.com/v1',
          apiKey: 'aid_pat_chmod',
          dataDir
        })
      ).rejects.toThrow('Could not restrict the credential backup');

      // The insecure backup was REMOVED and the credential file is untouched.
      const siblings = (await fs.readdir(path.dirname(authPath))).filter((f) => f !== 'auth.json');
      expect(siblings).toEqual([]);
      const stat = await fs.stat(authPath);
      // Windows emulates POSIX modes — only assert the strict POSIX mode off
      // Windows (the CONTENT is the portable guarantee here).
      expect(process.platform === 'win32' || (stat.mode & 0o777) === 0o644).toBe(true);
      const written = JSON.parse(await fs.readFile(authPath, 'utf-8'));
      expect(written.kilo).toEqual({ type: 'oauth', refresh: 'r', access: 'a' });
      expect(written[KILO_PROVIDER_SLUG]).toBeUndefined();
    });

    it('re-reads kilo.jsonc before committing models so a concurrent edit is preserved (Codex 154 round 11)', async () => {
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      const before =
        '{\n  "provider": {\n    "aidome-gateway": { "name": "AIdome", "npm": "@ai-sdk/openai-compatible", "options": { "baseURL": "https://old.example.com/v1" }, "models": { "m-1": { "name": "m-1" } } },\n    "other-provider": { "name": "Other", "npm": "@ai-sdk/openai-compatible", "models": { "o-1": { "name": "o-1" } } }\n  }\n}';
      const concurrent =
        '{\n  "provider": {\n    "aidome-gateway": { "name": "AIdome", "npm": "@ai-sdk/openai-compatible", "options": { "baseURL": "https://new.example.com/v1" }, "models": { "user-added": { "name": "User added" } } },\n    "other-provider": { "name": "Other", "npm": "@ai-sdk/openai-compatible", "models": { "o-1": { "name": "o-1" } } }\n  }\n}';
      await fs.writeFile(configPath, before);
      mockGetKiloConfigPath.mockReturnValue(configPath);
      mockDiscoverModels.mockResolvedValue(['m-2']);
      // First read (existingContent) sees BEFORE; the guarded re-read sees
      // the concurrent edit.
      configReadQueue.values = [before, concurrent];

      await writeKiloProviderAuth({
        baseUrl: 'https://gw.example.com/v1',
        apiKey: 'aid_pat_race',
        dataDir,
        configPath
      });

      const final = await fs.readFile(configPath, 'utf-8');
      const parsed = JSON.parse(final);
      const gw = parsed.provider['aidome-gateway'];
      // Reconciled onto the FRESH content: the gateway list is authoritative
      // over OUR provider's models map, and the concurrent edit's unrelated
      // third-party provider entry survives the write.
      // (options.baseURL stays profile-authoritative by design.)
      expect(gw.options.baseURL).toBe('https://gw.example.com/v1');
      expect(Object.keys(gw.models)).toEqual(['m-2']);
      expect(parsed.provider['other-provider'].models['o-1']).toEqual({ name: 'o-1' });
    });

    it('preserves a symlinked auth.json and writes through to its target (dotfiles setups)', async () => {
      const realDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kilo-real-'));
      const realPath = path.join(realDir, 'auth.json');
      await fs.writeFile(realPath, '{}', { mode: 0o600 });
      await fs.mkdir(path.dirname(authPath), { recursive: true });
      await fs.symlink(realPath, authPath);

      try {
        await writeKiloProviderAuth({
          baseUrl: 'https://gw.example.com/v1',
          apiKey: 'aid_pat_sym',
          dataDir
        });

        // The link itself must still be a symlink pointing at the target.
        const linkStat = await fs.lstat(authPath);
        expect(linkStat.isSymbolicLink()).toBe(true);
        // The managed target received the credential.
        const target = JSON.parse(await fs.readFile(realPath, 'utf-8'));
        expect(target[KILO_PROVIDER_SLUG]).toEqual({ type: 'api', key: 'aid_pat_sym' });
      } finally {
        await fs.rm(realDir, { recursive: true, force: true });
      }
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

    it('treats a whitespace-only token as missing (Codex 154 round 7)', async () => {
      await fs.mkdir(path.dirname(authPath), { recursive: true });
      await fs.writeFile(
        authPath,
        JSON.stringify({ kilo: { type: 'oauth', refresh: 'r', access: 'a' } }),
        { mode: 0o600 }
      );

      const result = await writeKiloProviderAuth({
        baseUrl: 'https://gw.example.com/v1',
        apiKey: '   ',
        dataDir
      });

      // A blank credential is normalized to missing: with no managed entry
      // present this is a confirmed no-op whose outcome signals the
      // authentication gap (authRequired).
      expect(result.noOp).toBe(true);
      expect(result.authRequired).toBe(true);
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

    it('restores the pre-write content when the auth write itself fails mid-way', async () => {
      await fs.mkdir(path.dirname(authPath), { recursive: true });
      const original = '{"kilo":{"type":"oauth","refresh":"r","access":"a"}}';
      await fs.writeFile(authPath, original, { mode: 0o600 });

      failNextAuthWrite.value = true;
      await expect(
        writeKiloProviderAuth({ baseUrl: 'https://gw.example.com/v1', apiKey: 'k', dataDir })
      ).rejects.toThrow(/Failed to write/);
      // The pre-write content was restored from the backup (Codex 154-a).
      expect(await fs.readFile(authPath, 'utf-8')).toBe(original);
      expect(mockLoggerWarning).not.toHaveBeenCalled();
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
      expect(result.modelsApplied).toBe(true);
      expect(result.modelsRequired).toBe(true);
      expect(result.authRequired).toBe(true);

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
      // An empty probe is a discovery failure, NOT an empty catalog: models
      // are reported unapplied and the config is untouched.
      expect(result.modelsApplied).toBe(false);
      expect(result.modelsRequired).toBe(true);
      expect(await fs.readFile(configPath, 'utf-8')).toBe('{"provider":{}}');
    });

    it('counts PLANNING-supplied or user-curated models as applied even when this refresh cannot run', async () => {
      // Codex 154 round 4: the models gap is judged from the RESULTING
      // config — the planning probe (or the user) may already have populated
      // models; a failed/absent refresh must not withhold the mapping.
      await fs.mkdir(path.dirname(authPath), { recursive: true });
      await fs.writeFile(
        configPath,
        `{"provider": { "${KILO_PROVIDER_SLUG}": { "options": {"baseURL": "https://gw.example.com/v1"}, "models": { "m-1": {"name":"m-1"} } } }}`
      );
      mockGetKiloConfigPath.mockReturnValue(configPath);

      const result = await writeKiloProviderAuth({
        baseUrl: 'https://gw.example.com/v1',
        dataDir,
        configPath
      });

      expect(mockDiscoverModels).not.toHaveBeenCalled();
      expect(result.modelsApplied).toBe(true);
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

      // No credential AND no managed entry present: a confirmed no-op — the
      // applier classifies this as guided-required (GAP 9), not configured.
      expect(result.noOp).toBe(true);
      expect(result.authRequired).toBe(true);
      expect(result.extraRollbacks).toBeUndefined();
      expect(mockDiscoverModels).not.toHaveBeenCalled();
      const written = JSON.parse(await fs.readFile(authPath, 'utf-8'));
      expect(written[KILO_PROVIDER_SLUG]).toBeUndefined();
    });

    it('clears a stale managed entry for a credential-less profile (real mutation, not a no-op)', async () => {
      await fs.mkdir(path.dirname(authPath), { recursive: true });
      await fs.writeFile(
        authPath,
        JSON.stringify({ [KILO_PROVIDER_SLUG]: { type: 'api', key: 'OLD_PAT' } }),
        { mode: 0o600 }
      );
      await fs.writeFile(configPath, '{"provider":{}}');
      mockGetKiloConfigPath.mockReturnValue(configPath);

      const result = await writeKiloProviderAuth({
        baseUrl: 'https://gw.example.com/v1',
        dataDir,
        configPath
      });

      expect(result.noOp).toBeUndefined();
      expect(result.createdFile).toBe(false);
      expect(result.backupPath).toBeDefined();
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

  describe('reconcileModelEntries', () => {
    it('reconciles to the discovered list: surviving entries stay WHOLE, stale ones are removed', () => {
      const reconciled = reconcileModelEntries(
        `{\n // comment\n "provider": { "aidome-gateway": { "models": { "a": { "name": "A", "limit": { "context": 128000 } }, "stale": { "name": "gone" } } } } }`,
        ['a', 'c']
      );
      // Still served: whole existing metadata survives.
      expect(reconciled['a']).toEqual({ name: 'A', limit: { context: 128000 } });
      // No longer served: removed (Activate Profile picks up removals).
      expect(reconciled['stale']).toBeUndefined();
      // Newly served: name-only fallback.
      expect(reconciled['c']).toEqual({ name: 'c' });
    });

    it('returns discovered-only entries for an unparsable or missing provider section', () => {
      expect(reconcileModelEntries('not json', ['x'])).toEqual({ x: { name: 'x' } });
      expect(reconcileModelEntries('{"other":1}', ['x'])).toEqual({ x: { name: 'x' } });
    });

    it('keeps Object.prototype-named gateway model IDs as OWN entries', () => {
      const reconciled = reconcileModelEntries('{}', ['constructor', 'toString', '__proto__']);
      // Object.create(null) records: no inherited-member collision, no
      // prototype mutation through a '__proto__' key.
      expect(Object.keys(reconciled).sort()).toEqual(['__proto__', 'constructor', 'toString']);
      expect(reconciled['constructor']).toEqual({ name: 'constructor' });
      expect(reconciled['toString']).toEqual({ name: 'toString' });
      expect(reconciled['__proto__']).toEqual({ name: '__proto__' });
      // JSON round-trip: object literals would turn a '__proto__' key into a
      // prototype mutation, so build the expectation via JSON.parse.
      expect(JSON.parse(JSON.stringify(reconciled))).toEqual(
        JSON.parse(
          '{"constructor":{"name":"constructor"},"toString":{"name":"toString"},"__proto__":{"name":"__proto__"}}'
        )
      );
    });
  });
});
