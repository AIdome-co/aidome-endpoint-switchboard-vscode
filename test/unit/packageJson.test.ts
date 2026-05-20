/**
 * Unit tests for package.json marketplace readiness.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const packageJsonPath = path.join(__dirname, '../../package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

describe('package.json Marketplace Readiness', () => {
  it('should have publisher field', () => {
    expect(packageJson.publisher).toBeDefined();
    expect(packageJson.publisher).toBe('aidome');
  });

  it('should have displayName field', () => {
    expect(packageJson.displayName).toBeDefined();
    expect(packageJson.displayName.length).toBeGreaterThan(0);
    expect(packageJson.displayName).toContain('LLM Endpoint Switchboard');
  });

  it('should have description field', () => {
    expect(packageJson.description).toBeDefined();
    expect(packageJson.description.length).toBeGreaterThan(50);
    expect(packageJson.description.length).toBeLessThan(350); // VS Code marketplace limit
  });

  it('should have icon field pointing to existing file', () => {
    expect(packageJson.icon).toBeDefined();
    const iconPath = path.join(__dirname, '../../', packageJson.icon);
    expect(fs.existsSync(iconPath)).toBe(true);
  });

  it('should have galleryBanner configuration', () => {
    expect(packageJson.galleryBanner).toBeDefined();
    expect(packageJson.galleryBanner.color).toBeDefined();
    expect(packageJson.galleryBanner.theme).toBeDefined();
    expect(['dark', 'light']).toContain(packageJson.galleryBanner.theme);
  });

  it('should have repository field with correct URL', () => {
    expect(packageJson.repository).toBeDefined();
    expect(packageJson.repository.type).toBe('git');
    expect(packageJson.repository.url).toContain('github.com/AIdome-co/aidome-endpoint-switchboard-vscode');
  });

  it('should have homepage field', () => {
    expect(packageJson.homepage).toBeDefined();
    expect(packageJson.homepage).toContain('github.com');
  });

  it('should have bugs field', () => {
    expect(packageJson.bugs).toBeDefined();
    expect(packageJson.bugs.url).toBeDefined();
    expect(packageJson.bugs.url).toContain('issues');
  });

  it('should have categories array with AI category', () => {
    expect(packageJson.categories).toBeDefined();
    expect(Array.isArray(packageJson.categories)).toBe(true);
    expect(packageJson.categories).toContain('AI');
  });

  it('should have keywords array with at least 10 entries', () => {
    expect(packageJson.keywords).toBeDefined();
    expect(Array.isArray(packageJson.keywords)).toBe(true);
    expect(packageJson.keywords.length).toBeGreaterThanOrEqual(10);
    expect(packageJson.keywords).toContain('llm');
    expect(packageJson.keywords).toContain('ai');
    expect(packageJson.keywords).toContain('aidome');
  });

  it('should have license field set to MIT', () => {
    expect(packageJson.license).toBeDefined();
    expect(packageJson.license).toBe('MIT');
  });

  it('should have qna field', () => {
    expect(packageJson.qna).toBeDefined();
    expect(packageJson.qna).toBe('marketplace');
  });

  it('should have engines.vscode field', () => {
    expect(packageJson.engines).toBeDefined();
    expect(packageJson.engines.vscode).toBeDefined();
    expect(packageJson.engines.vscode).toMatch(/^\^?\d+\.\d+\.\d+$/);
  });

  it('should have the wizard-first command set registered', () => {
    expect(packageJson.contributes).toBeDefined();
    expect(packageJson.contributes.commands).toBeDefined();
    expect(Array.isArray(packageJson.contributes.commands)).toBe(true);

    const commandIds = packageJson.contributes.commands.map((c: any) => c.command);
    expect(commandIds).toEqual(expect.arrayContaining([
      'aidome-switchboard.setupSwitchboard',
      'aidome-switchboard.verifyRouting',
      'aidome-switchboard.showModelsProviders',
      'aidome-switchboard.showModels',
      'aidome-switchboard.manageProfiles',
      'aidome-switchboard.resetSwitchboard',
      'aidome-switchboard.exportDiagnostics'
    ]));
  });

  it('should contribute advanced runtime configuration settings', () => {
    expect(packageJson.contributes.configuration).toBeDefined();
    expect(packageJson.contributes.configuration.title).toBe('AIdome Endpoint Switchboard');

    const properties = packageJson.contributes.configuration.properties;
    expect(properties['aidome-switchboard.advanced.cliDetectionTimeoutMs'].default).toBe(2000);
    expect(properties['aidome-switchboard.advanced.httpTimeoutMs'].default).toBe(10000);
    expect(properties['aidome-switchboard.advanced.httpRetryBackoffMaxMs'].default).toBe(5000);
    expect(properties['aidome-switchboard.advanced.aidomeClientCacheTtlMs'].default).toBe(60000);
    expect(properties['aidome-switchboard.advanced.logBufferSize'].default).toBe(200);
  });

  it('should expose verifier timeout settings with documented defaults', () => {
    const properties = packageJson.contributes.configuration.properties;

    expect(properties['aidome-switchboard.advanced.verifier.tlsTimeoutMs'].default).toBe(5000);
    expect(properties['aidome-switchboard.advanced.verifier.endpointReachabilityTimeoutMs'].default).toBe(10000);
    expect(properties['aidome-switchboard.advanced.verifier.healthCheckTimeoutMs'].default).toBe(5000);
    expect(properties['aidome-switchboard.advanced.verifier.modelListTimeoutMs'].default).toBe(10000);
    expect(properties['aidome-switchboard.advanced.verifier.dialectValidationTimeoutMs'].default).toBe(5000);
    expect(properties['aidome-switchboard.advanced.verifier.testPromptTimeoutMs'].default).toBe(15000);
  });

  it('should define dedicated adapter coverage gate scripts for Continue, Kilo, and Roo Code', () => {
    expect(packageJson.scripts['test:continue:coverage']).toContain('test/unit/continueAdapter.test.ts');
    expect(packageJson.scripts['test:continue:coverage']).toContain('--coverage.include=src/adapters/continue/adapter.ts');
    expect(packageJson.scripts['test:continue:coverage']).toContain('--coverage.thresholds.branches=100');

    expect(packageJson.scripts['test:kilo:coverage']).toContain('test/unit/kilocodeAdapter.test.ts');
    expect(packageJson.scripts['test:kilo:coverage']).toContain('--coverage.include=src/adapters/kilocode/adapter.ts');
    expect(packageJson.scripts['test:kilo:coverage']).toContain('--coverage.thresholds.branches=100');

    expect(packageJson.scripts['test:roo:coverage']).toContain('test/unit/roocodeAdapter.test.ts');
    expect(packageJson.scripts['test:roo:coverage']).toContain('--coverage.include=src/adapters/roocode/adapter.ts');
    expect(packageJson.scripts['test:roo:coverage']).toContain('--coverage.thresholds.branches=100');
  });

  it('should have walkthroughs contribution', () => {
    expect(packageJson.contributes.walkthroughs).toBeDefined();
    expect(Array.isArray(packageJson.contributes.walkthroughs)).toBe(true);
    expect(packageJson.contributes.walkthroughs.length).toBeGreaterThan(0);
  });

  it('should have walkthrough with 4 steps', () => {
    const walkthrough = packageJson.contributes.walkthroughs[0];
    expect(walkthrough).toBeDefined();
    expect(walkthrough.id).toBe('aidome-switchboard-getting-started');
    expect(walkthrough.title).toBeDefined();
    expect(walkthrough.description).toBeDefined();
    expect(walkthrough.steps).toBeDefined();
    expect(Array.isArray(walkthrough.steps)).toBe(true);
    expect(walkthrough.steps.length).toBe(4);

    // Check step IDs
    const stepIds = walkthrough.steps.map((s: any) => s.id);
    expect(stepIds).toContain('welcome');
    expect(stepIds).toContain('run-wizard');
    expect(stepIds).toContain('verify');
    expect(stepIds).toContain('explore-models');
  });

  it('should have walkthrough steps with valid markdown references', () => {
    const walkthrough = packageJson.contributes.walkthroughs[0];
    walkthrough.steps.forEach((step: any) => {
      expect(step.media).toBeDefined();
      expect(step.media.markdown).toBeDefined();
      expect(step.media.markdown).toMatch(/^resources\/walkthrough\/.+\.md$/);

      // Check that markdown file exists
      const mdPath = path.join(__dirname, '../../', step.media.markdown);
      expect(fs.existsSync(mdPath)).toBe(true);
    });
  });
});
