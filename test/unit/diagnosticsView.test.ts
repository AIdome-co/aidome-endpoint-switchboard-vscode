/**
 * Unit tests for diagnostics view.
 */

import { describe, it, expect, vi } from 'vitest';
import { generateDiagnosticsHtml } from '../../src/ui/diagnosticsView';

vi.mock('vscode', () => ({
  window: {
    createWebviewPanel: vi.fn(() => ({
      webview: { html: '' },
      dispose: vi.fn()
    }))
  },
  ViewColumn: { One: 1 }
}));

describe('generateDiagnosticsHtml', () => {
  it('should escape HTML special characters to prevent XSS', () => {
    const malicious = { key: '</pre><script>alert("xss")</script>' };
    const html = generateDiagnosticsHtml(malicious);

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;/pre&gt;');
  });

  it('should include Content-Security-Policy meta tag', () => {
    const html = generateDiagnosticsHtml({ status: 'ok' });

    expect(html).toContain('Content-Security-Policy');
    expect(html).toContain("default-src 'none'");
  });

  it('should render valid diagnostics data', () => {
    const data = { adapter: 'cline', detected: true, tier: 'A' };
    const html = generateDiagnosticsHtml(data);

    expect(html).toContain('&quot;adapter&quot;: &quot;cline&quot;');
    expect(html).toContain('&quot;detected&quot;: true');
    expect(html).toContain('AIdome Switchboard Diagnostics');
  });

  it('should handle null diagnostics', () => {
    const html = generateDiagnosticsHtml(null);

    expect(html).toContain('null');
    expect(html).toContain('Content-Security-Policy');
  });
});
