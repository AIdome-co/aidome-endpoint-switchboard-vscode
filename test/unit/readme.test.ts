/**
 * Unit tests for README.md marketplace readiness.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const readmePath = path.join(__dirname, '../../README.md');
const readmeContent = fs.readFileSync(readmePath, 'utf8');

describe('README.md Marketplace Readiness', () => {
  it('should exist and be non-empty', () => {
    expect(readmeContent).toBeDefined();
    expect(readmeContent.length).toBeGreaterThan(1000);
  });

  it('should have hero section with badges', () => {
    expect(readmeContent).toContain('# LLM Endpoint Switchboard');
    expect(readmeContent).toContain('[![VS Code Marketplace]');
    expect(readmeContent).toContain('[![License: MIT]');
  });

  it('should contain "What is this?" section', () => {
    expect(readmeContent).toContain('## What is this?');
    expect(readmeContent.toLowerCase()).toContain('configuration tool');
  });

  it('should contain architecture diagram', () => {
    expect(readmeContent).toContain('## How It Works');
    expect(readmeContent).toContain('VS Code');
    expect(readmeContent).toContain('Switchboard');
    expect(readmeContent).toContain('Your Gateway');
  });

  it('should contain Supported Assistants table', () => {
    expect(readmeContent).toContain('## Supported Assistants');
    expect(readmeContent).toContain('| Assistant');
    expect(readmeContent).toContain('Continue.dev');
    expect(readmeContent).toContain('Cline');
    expect(readmeContent).toContain('Roo Code');
    expect(readmeContent).toContain('Kilo Code');
    expect(readmeContent).toContain('OpenAI Codex CLI');
    expect(readmeContent).toContain('CodeGPT');
    expect(readmeContent).toContain('AnythingLLM');
    expect(readmeContent).toContain('Claude Code');
    expect(readmeContent).toContain('GitHub Copilot');
    expect(readmeContent).toContain('Gemini CLI');
    expect(readmeContent).toContain('Tabnine');
  });

  it('should contain Tier Explanation', () => {
    expect(readmeContent).toContain('### Tier Explanation');
    expect(readmeContent).toContain('Tier A');
    expect(readmeContent).toContain('Tier B');
    expect(readmeContent).toContain('Tier C');
    expect(readmeContent).toContain('Full Automation');
  });

  it('should contain Dialects section', () => {
    expect(readmeContent).toContain('## Dialects');
    expect(readmeContent).toContain('openai.chat_completions');
    expect(readmeContent).toContain('openai.responses');
    expect(readmeContent).toContain('anthropic.messages');
    expect(readmeContent).toContain('google.gemini');
  });

  it('should contain Quick Start section', () => {
    expect(readmeContent).toContain('## Quick Start');
    expect(readmeContent).toContain('Install the Extension');
    expect(readmeContent).toContain('Run the Setup Wizard');
  });

  it('should contain Commands reference', () => {
    expect(readmeContent).toContain('## Commands');
    expect(readmeContent).toContain('AIdome: Setup Switchboard');
    expect(readmeContent).toContain('AIdome: Verify Routing');
    expect(readmeContent).toContain('AIdome: Show Models & Providers');
    expect(readmeContent).toContain('AIdome: Manage Profiles');
    expect(readmeContent).toContain('AIdome: Reset Switchboard');
    expect(readmeContent).toContain('AIdome: Export Diagnostics');
  });

  it('should contain Enterprise Safety section', () => {
    expect(readmeContent).toContain('## Enterprise Safety');
    expect(readmeContent).toContain('SecretStorage');
    expect(readmeContent).toContain('No Telemetry');
    expect(readmeContent).toContain('Backup Before Modify');
    expect(readmeContent).toContain('Audit Trail');
    expect(readmeContent).toContain('Secret Redaction');
  });

  it('should contain Generic Scanner section', () => {
    expect(readmeContent).toContain('## Generic Scanner');
    expect(readmeContent).toContain('heuristic');
    expect(readmeContent.toLowerCase()).toContain('confidence');
  });

  it('should contain FAQ section', () => {
    expect(readmeContent).toContain('## FAQ');
    expect(readmeContent).toContain('replace my AI assistant');
    expect(readmeContent).toContain('send my code');
    expect(readmeContent).toContain('gateway goes down');
  });

  it('should contain "NOT a Gateway" disclaimer prominently', () => {
    expect(readmeContent).toContain('This Extension is NOT');
    expect(readmeContent.toLowerCase()).toContain('not a gateway');
    expect(readmeContent).toContain('configuration tool');
    expect(readmeContent).toContain('does not proxy');
  });

  it('should contain Contributing section', () => {
    expect(readmeContent).toContain('## Contributing');
    expect(readmeContent).toContain('npm install');
    expect(readmeContent).toContain('npm test');
  });

  it('should contain License section', () => {
    expect(readmeContent).toContain('## License');
    expect(readmeContent).toContain('MIT');
  });

  it('should not contain placeholder or TODO text', () => {
    expect(readmeContent.toLowerCase()).not.toContain('todo');
    expect(readmeContent.toLowerCase()).not.toContain('fixme');
    expect(readmeContent.toLowerCase()).not.toContain('placeholder');
  });

  it('should have proper markdown structure', () => {
    // Check for proper heading hierarchy
    const headingMatches = readmeContent.match(/^#+\s/gm);
    expect(headingMatches).toBeDefined();
    expect(headingMatches!.length).toBeGreaterThan(10);

    // Check for proper list structure
    expect(readmeContent).toMatch(/^[-*]\s/gm);
  });
});
