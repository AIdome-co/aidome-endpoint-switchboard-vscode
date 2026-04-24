/**
 * Diagnostics view for troubleshooting.
 */

import * as vscode from 'vscode';

/**
 * Shows diagnostics in a webview panel.
 * @param diagnostics The diagnostics data
 * @returns Promise resolving when complete
 */
export async function showDiagnosticsView(diagnostics: unknown): Promise<void> {
  const panel = createDiagnosticsPanel();
  panel.webview.html = generateDiagnosticsHtml(diagnostics);
}

/**
 * Creates a webview panel for diagnostics.
 * @returns The webview panel
 */
export function createDiagnosticsPanel(): vscode.WebviewPanel {
  return vscode.window.createWebviewPanel(
    'aidomeDiagnostics',
    'AIdome Diagnostics',
    vscode.ViewColumn.One,
    {
      enableScripts: false
    }
  );
}

/**
 * Escapes HTML special characters to prevent XSS injection.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * Generates HTML content for diagnostics view.
 * @param diagnostics The diagnostics data
 * @returns HTML string
 */
export function generateDiagnosticsHtml(diagnostics: unknown): string {
  const diagnosticsJson = JSON.stringify(diagnostics, null, 2) ?? 'undefined';
  const escaped = escapeHtml(diagnosticsJson);
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
        <title>AIdome Diagnostics</title>
        <style>
          body { font-family: var(--vscode-font-family); padding: 20px; }
          pre { background: var(--vscode-editor-background); padding: 10px; }
        </style>
      </head>
      <body>
        <h1>AIdome Switchboard Diagnostics</h1>
        <pre>${escaped}</pre>
      </body>
    </html>
  `;
}
