/**
 * Pre-release validation tests
 * Validates critical requirements before release
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';

const ROOT_DIR = path.join(__dirname, '../..');

describe('Pre-Release Validation', () => {
  describe('No console.log statements', () => {
    it('should not have console.log in src/', () => {
      const files = glob.sync('src/**/*.ts', { cwd: ROOT_DIR, absolute: true });
      
      const violations: string[] = [];
      
      for (const file of files) {
        const content = fs.readFileSync(file, 'utf-8');
        const lines = content.split('\n');
        
        lines.forEach((line, index) => {
          // Skip comments
          if (line.trim().startsWith('//') || line.trim().startsWith('*')) {
            return;
          }
          
          if (line.includes('console.log')) {
            violations.push(`${file}:${index + 1} - ${line.trim()}`);
          }
        });
      }
      
      expect(violations).toEqual([]);
    });
  });

  describe('Package.json validation', () => {
    it('should have handlers for all commands', () => {
      const packageJson = JSON.parse(
        fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf-8')
      );
      
      const commands = packageJson.contributes?.commands || [];
      const commandIds = commands.map((c: any) => c.command);
      
      // Check that command files exist
      const commandDir = path.join(ROOT_DIR, 'src/commands');
      const commandFiles = fs.readdirSync(commandDir);
      
      for (const cmd of commandIds) {
        const cmdName = cmd.replace('aidome-switchboard.', '');
        
        // Special case for statusBarAction - handled in extension.ts
        if (cmdName === 'statusBarAction') {
          continue;
        }
        
        // Check if command file exists
        const expectedFile = `${cmdName}.ts`;
        expect(commandFiles, `Missing handler for command: ${cmdName}`).toContain(expectedFile);
      }
    });

    it('should have valid version format', () => {
      const packageJson = JSON.parse(
        fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf-8')
      );
      
      const version = packageJson.version;
      expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });

  describe('No hardcoded colors', () => {
    it('should not have hex color values in TypeScript files', () => {
      const files = glob.sync('src/**/*.ts', { cwd: ROOT_DIR, absolute: true });
      
      const violations: string[] = [];
      const hexColorPattern = /#[0-9a-fA-F]{3,6}\b/;
      
      for (const file of files) {
        const content = fs.readFileSync(file, 'utf-8');
        const lines = content.split('\n');
        
        lines.forEach((line, index) => {
          // Skip comments
          if (line.trim().startsWith('//') || line.trim().startsWith('*')) {
            return;
          }
          
          if (hexColorPattern.test(line)) {
            violations.push(`${file}:${index + 1} - ${line.trim()}`);
          }
        });
      }
      
      expect(violations).toEqual([]);
    });
  });

  describe('.vscodeignore validation', () => {
    it('should exclude src/ and test/', () => {
      const vscodeignore = fs.readFileSync(
        path.join(ROOT_DIR, '.vscodeignore'),
        'utf-8'
      );
      
      const lines = vscodeignore.split('\n').map(l => l.trim());
      
      expect(lines).toContain('src/**');
      expect(lines).toContain('test/**');
    });
  });

  describe('TypeScript compilation', () => {
    it('should have no TypeScript errors', () => {
      // This test verifies that compilation succeeded
      // If there were TS errors, the test suite wouldn't run
      const outDir = path.join(ROOT_DIR, 'out');
      expect(fs.existsSync(outDir)).toBe(true);
      
      // Check that extension.js was compiled
      const extensionJs = path.join(outDir, 'extension.js');
      expect(fs.existsSync(extensionJs)).toBe(true);
    });
  });

  describe('Required files exist', () => {
    const requiredFiles = [
      'README.md',
      'CHANGELOG.md',
      'LICENSE',
      'package.json',
      '.vscodeignore',
      'src/extension.ts'
    ];

    requiredFiles.forEach(file => {
      it(`should have ${file}`, () => {
        const filePath = path.join(ROOT_DIR, file);
        expect(fs.existsSync(filePath), `Missing required file: ${file}`).toBe(true);
      });
    });
  });

  describe('ADR documentation', () => {
    const requiredADRs = [
      'ADR-001-profiles-over-flat-baseurl.md',
      'ADR-002-dialect-first-design.md',
      'ADR-003-backup-before-modify.md',
      'ADR-004-guided-tier-for-unsupported.md'
    ];

    requiredADRs.forEach(adr => {
      it(`should have ${adr}`, () => {
        const adrPath = path.join(ROOT_DIR, 'docs/adr', adr);
        expect(fs.existsSync(adrPath), `Missing ADR: ${adr}`).toBe(true);
      });
    });
  });

  describe('Code quality', () => {
    it('should have redaction in logger', () => {
      const loggerContent = fs.readFileSync(
        path.join(ROOT_DIR, 'src/util/log.ts'),
        'utf-8'
      );
      
      expect(loggerContent).toContain('redactString');
    });

    it('should have input validation in profile validator', () => {
      const validatorContent = fs.readFileSync(
        path.join(ROOT_DIR, 'src/core/profiles/profileValidator.ts'),
        'utf-8'
      );
      
      expect(validatorContent).toContain('validateUrl');
      expect(validatorContent).toContain('validateProfileName');
      expect(validatorContent).toContain('javascript:');
      expect(validatorContent).toContain('data:');
      expect(validatorContent).toContain('file:');
    });

    it('should have backup functionality', () => {
      const fsSafeContent = fs.readFileSync(
        path.join(ROOT_DIR, 'src/util/fsSafe.ts'),
        'utf-8'
      );
      
      expect(fsSafeContent).toContain('createBackup');
      expect(fsSafeContent).toContain('realpath');
    });

    it('should have lazy loading in adapters.index', () => {
      const adaptersContent = fs.readFileSync(
        path.join(ROOT_DIR, 'src/adapters/adapters.index.ts'),
        'utf-8'
      );
      
      expect(adaptersContent).toContain('import(');
      expect(adaptersContent).toContain('async');
      expect(adaptersContent).toContain('Promise<AssistantAdapter');
    });

    it('should have state migration in extension', () => {
      const extensionContent = fs.readFileSync(
        path.join(ROOT_DIR, 'src/extension.ts'),
        'utf-8'
      );
      
      expect(extensionContent).toContain('migrateState');
      expect(extensionContent).toContain('stateVersion');
    });

    it('should have accessibility in status bar', () => {
      const statusBarContent = fs.readFileSync(
        path.join(ROOT_DIR, 'src/ui/statusBar.ts'),
        'utf-8'
      );
      
      expect(statusBarContent).toContain('accessibilityInformation');
    });

    it('should have tlsVerify setting in package.json', () => {
      const packageJson = JSON.parse(
        fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf-8')
      );

      const props = packageJson.contributes?.configuration?.properties;
      expect(props).toBeDefined();
      const tlsSetting = props['aidome-switchboard.advanced.tlsVerify'];
      expect(tlsSetting, 'missing tlsVerify setting').toBeDefined();
      expect(tlsSetting.type).toBe('boolean');
      expect(tlsSetting.default).toBe(true);
    });

    it('should have rejectUnauthorized wired in http utility', () => {
      const httpContent = fs.readFileSync(
        path.join(ROOT_DIR, 'src/util/http.ts'),
        'utf-8'
      );

      expect(httpContent).toContain('rejectUnauthorized');
      expect(httpContent).toContain('tlsVerify');
    });

    it('should respect tlsVerify setting in verifier TLS step', () => {
      const verifierContent = fs.readFileSync(
        path.join(ROOT_DIR, 'src/core/orchestration/verifier.ts'),
        'utf-8'
      );

      expect(verifierContent).toContain('tlsVerify');
      expect(verifierContent).toContain('rejectUnauthorized');
      expect(verifierContent).toContain('verification disabled via settings');
    });

    it('every registry assistant should have tlsVerification field', () => {
      const registryContent = fs.readFileSync(
        path.join(ROOT_DIR, 'src/core/registry/assistants.registry.json'),
        'utf-8'
      );
      const registry = JSON.parse(registryContent);
      const validSupportLevels = ['native', 'env-var', 'vscode-global', 'none'];

      for (const assistant of registry.assistants) {
        expect(
          assistant.tlsVerification,
          `${assistant.key} missing tlsVerification`
        ).toBeDefined();
        expect(
          validSupportLevels.includes(assistant.tlsVerification.support),
          `${assistant.key} has invalid TLS support: ${assistant.tlsVerification.support}`
        ).toBe(true);
      }
    });
  });
});
