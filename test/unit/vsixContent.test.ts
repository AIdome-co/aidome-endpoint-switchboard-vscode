/**
 * Unit tests for .vscodeignore and VSIX content validation.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const vscodeignorePath = path.join(__dirname, '../../.vscodeignore');
const vscodeignoreContent = fs.readFileSync(vscodeignorePath, 'utf8');

describe('.vscodeignore VSIX Content Validation', () => {
  it('should exist', () => {
    expect(fs.existsSync(vscodeignorePath)).toBe(true);
  });

  it('should exclude src/ directory', () => {
    expect(vscodeignoreContent).toMatch(/^src\/\*\*$/m);
  });

  it('should exclude test/ directory', () => {
    expect(vscodeignoreContent).toMatch(/^test\/\*\*$/m);
  });

  it('should exclude .github/ directory', () => {
    expect(vscodeignoreContent).toMatch(/^\.github\/\*\*$/m);
  });

  it('should exclude TypeScript source files', () => {
    expect(vscodeignoreContent).toContain('*.ts');
  });

  it('should NOT exclude node_modules (production deps must ship with tsc builds)', () => {
    expect(vscodeignoreContent).not.toMatch(/^node_modules\/\*\*$/m);
  });

  it('should exclude tsconfig.json', () => {
    expect(vscodeignoreContent).toContain('tsconfig.json');
  });

  it('should exclude eslint configuration', () => {
    expect(vscodeignoreContent).toContain('eslint.config.js');
  });

  it('should exclude vitest configuration', () => {
    expect(vscodeignoreContent).toContain('vitest.config.ts');
  });

  it('should exclude .gitignore', () => {
    expect(vscodeignoreContent).toContain('.gitignore');
  });

  it('should exclude source maps', () => {
    expect(vscodeignoreContent).toContain('**/*.map');
  });

  it('should exclude test output', () => {
    expect(vscodeignoreContent).toMatch(/out\/test/);
  });

  it('should NOT exclude out/ directory (compiled JavaScript)', () => {
    // Check that there's no line that excludes the entire out/ directory
    const lines = vscodeignoreContent.split('\n').map(l => l.trim());
    expect(lines).not.toContain('out/**');
    expect(lines).not.toContain('out/');
  });

  it('should NOT exclude resources/ directory entirely', () => {
    const lines = vscodeignoreContent.split('\n').map(l => l.trim());
    // Check that we don't exclude the entire resources/ directory
    expect(lines).not.toContain('resources/');
    expect(lines).not.toContain('resources/**');
    // It's OK to exclude specific files within resources/
    // like resources/screenshots/README.md
  });

  it('should NOT exclude README.md entirely', () => {
    const lines = vscodeignoreContent.split('\n').map(l => l.trim());
    // Check that README.md is not excluded
    expect(lines).not.toContain('README.md');
    // It's OK if it appears in paths like resources/screenshots/README.md
  });

  it('should NOT exclude CHANGELOG.md', () => {
    expect(vscodeignoreContent).not.toContain('CHANGELOG.md');
  });

  it('should NOT exclude LICENSE', () => {
    expect(vscodeignoreContent).not.toMatch(/^LICENSE$/m);
  });

  it('should NOT exclude package.json', () => {
    expect(vscodeignoreContent).not.toContain('package.json');
  });
});

describe('Required Runtime Files Exist', () => {
  it('should have README.md', () => {
    const readmePath = path.join(__dirname, '../../README.md');
    expect(fs.existsSync(readmePath)).toBe(true);
  });

  it('should have CHANGELOG.md', () => {
    const changelogPath = path.join(__dirname, '../../CHANGELOG.md');
    expect(fs.existsSync(changelogPath)).toBe(true);
  });

  it('should have LICENSE', () => {
    const licensePath = path.join(__dirname, '../../LICENSE');
    expect(fs.existsSync(licensePath)).toBe(true);
  });

  it('should have package.json', () => {
    const packagePath = path.join(__dirname, '../../package.json');
    expect(fs.existsSync(packagePath)).toBe(true);
  });

  it('should have icon.png', () => {
    const iconPath = path.join(__dirname, '../../resources/icon.png');
    expect(fs.existsSync(iconPath)).toBe(true);
  });

  it('should have walkthrough markdown files', () => {
    const walkthroughDir = path.join(__dirname, '../../resources/walkthrough');
    expect(fs.existsSync(walkthroughDir)).toBe(true);
    
    const expectedFiles = ['welcome.md', 'setup.md', 'verify.md', 'models.md'];
    expectedFiles.forEach(file => {
      const filePath = path.join(walkthroughDir, file);
      expect(fs.existsSync(filePath)).toBe(true);
    });
  });

  it('should have compiled output directory', () => {
    const outDir = path.join(__dirname, '../../out');
    expect(fs.existsSync(outDir)).toBe(true);
  });

  it('should have assistant registry JSON', () => {
    const registryPath = path.join(__dirname, '../../src/core/registry/assistants.registry.json');
    expect(fs.existsSync(registryPath)).toBe(true);
  });
});
