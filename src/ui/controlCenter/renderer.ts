import {
  AssistantSurfaceState,
  ChangeEntrySurfaceState,
  ControlCenterNavigationItem,
  ControlCenterPageId,
  ControlCenterState,
  GuidedSection,
  ProfileSurfaceState
} from './types';

export function renderControlCenterHtml(state: ControlCenterState): string {
  const nonce = createNonce();
  const pageTitle = pageTitleFor(state.page);

  return `<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
      <title>AIdome Control Center</title>
      <style>
        :root { color-scheme: light dark; }
        * { box-sizing: border-box; }
        body {
          margin: 0;
          font-family: var(--vscode-font-family);
          color: var(--vscode-editor-foreground);
          background:
            radial-gradient(circle at top right, color-mix(in srgb, var(--vscode-button-background) 14%, transparent), transparent 28%),
            linear-gradient(180deg, var(--vscode-editor-background) 0%, color-mix(in srgb, var(--vscode-sideBar-background) 78%, var(--vscode-editor-background)) 100%);
        }
        .shell { min-height: 100vh; display: grid; grid-template-columns: 280px minmax(0, 1fr); }
        .sidebar {
          position: sticky;
          top: 0;
          height: 100vh;
          padding: 20px 16px;
          border-right: 1px solid color-mix(in srgb, var(--vscode-panel-border) 72%, transparent);
          background: color-mix(in srgb, var(--vscode-sideBar-background) 94%, transparent);
          display: grid;
          grid-template-rows: auto auto 1fr auto;
          gap: 18px;
          overflow-y: auto;
          overscroll-behavior: contain;
          scrollbar-gutter: stable;
        }
        .content { padding: 28px 32px 40px; display: grid; gap: 20px; }
        .eyebrow {
          display: inline-flex;
          padding: 6px 10px;
          border-radius: 999px;
          background: color-mix(in srgb, var(--vscode-button-background) 15%, transparent);
          color: var(--vscode-descriptionForeground);
          text-transform: uppercase;
          font-size: 12px;
          letter-spacing: 0.04em;
          justify-self: start;
        }
        .brand { display: grid; gap: 8px; }
        .brand h1 { margin: 0; font-size: 24px; line-height: 1.1; }
        .brand p { margin: 0; font-size: 13px; line-height: 1.45; }
        .muted { color: var(--vscode-descriptionForeground); }
        .active-profile-card,
        .header-card,
        .summary-card,
        .content-card,
        .detail-card,
        .list-card,
        .log-card,
        .change-card,
        .setting-card,
        .page-banner {
          background: color-mix(in srgb, var(--vscode-editorWidget-background) 88%, transparent);
          border: 1px solid color-mix(in srgb, var(--vscode-panel-border) 72%, transparent);
          border-radius: 18px;
          box-shadow: 0 12px 32px rgba(0, 0, 0, 0.12);
          padding: 18px;
        }
        .active-profile-card { padding: 14px; display: grid; gap: 8px; }
        .nav { display: grid; gap: 8px; }
        .nav-button,
        .assistant-tile,
        .profile-tile {
          appearance: none;
          width: 100%;
          border: 1px solid transparent;
          background: color-mix(in srgb, var(--vscode-editor-background) 55%, transparent);
          color: inherit;
          font: inherit;
          text-align: left;
          cursor: pointer;
          border-radius: 12px;
        }
        .primary-button,
        .outline-button {
          appearance: none;
          border: 1px solid transparent;
          color: inherit;
          font: inherit;
          cursor: pointer;
          border-radius: 12px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          width: auto;
          max-width: 100%;
        }
        .nav-button {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 12px 14px;
        }
        .nav-button.active,
        .assistant-tile.active,
        .profile-tile.active {
          border-color: color-mix(in srgb, var(--vscode-button-background) 56%, transparent);
          background: color-mix(in srgb, var(--vscode-button-background) 18%, transparent);
        }
        .nav-button:hover,
        .primary-button:hover,
        .outline-button:hover,
        .assistant-tile:hover,
        .profile-tile:hover {
          background: color-mix(in srgb, var(--vscode-button-hoverBackground) 26%, transparent);
          border-color: color-mix(in srgb, var(--vscode-button-background) 35%, transparent);
        }
        .badge,
        .chip,
        .status-pill {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 4px 10px;
          border-radius: 999px;
          font-size: 12px;
          line-height: 1.2;
        }
        .badge,
        .chip {
          background: color-mix(in srgb, var(--vscode-textBlockQuote-background) 70%, transparent);
          color: var(--vscode-descriptionForeground);
        }
          .status-pill.configured { background: color-mix(in srgb, var(--vscode-terminal-ansiGreen) 24%, transparent); }
          .status-pill.needs-manual { background: color-mix(in srgb, var(--vscode-editorWarning-foreground) 24%, transparent); }
          .status-pill.ready { background: color-mix(in srgb, var(--vscode-editorInfo-foreground) 24%, transparent); }
          .status-pill.info-only { background: color-mix(in srgb, var(--vscode-descriptionForeground) 26%, transparent); }
          .status-pill.not-detected { background: color-mix(in srgb, var(--vscode-editorError-foreground) 18%, transparent); }
        .header-actions,
        .button-row,
        .section-actions,
        .chips { display: flex; flex-wrap: wrap; gap: 10px; }
        .sidebar-actions { display: grid; gap: 10px; }
        .primary-button,
        .outline-button { padding: 10px 14px; }
        .primary-button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
        .outline-button { background: transparent; border-color: color-mix(in srgb, var(--vscode-panel-border) 75%, transparent); }
        .sidebar-actions .primary-button,
        .sidebar-actions .outline-button {
          width: 100%;
          justify-content: flex-start;
        }
        .header-card { display: grid; gap: 18px; }
        .header-card.compact { gap: 12px; }
        .header-top {
          display: flex;
          align-items: start;
          justify-content: space-between;
          gap: 16px;
          flex-wrap: wrap;
        }
        .header-title { display: grid; gap: 8px; }
        .header-title h2 { margin: 0; font-size: 32px; line-height: 1.08; }
        .header-title p { margin: 0; color: var(--vscode-descriptionForeground); max-width: 76ch; }
        .header-actions { align-items: center; justify-content: flex-end; }
        .sidebar-profile-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          flex-wrap: wrap;
        }
        .sidebar-footnote {
          font-size: 12px;
          line-height: 1.45;
          padding-bottom: 4px;
        }
        .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; }
        .summary-card { display: grid; gap: 8px; }
        .summary-value { font-size: 28px; font-weight: 700; }
        .summary-label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--vscode-descriptionForeground); }
        .page-grid,
        .split-grid,
        .triple-grid,
        .stack { display: grid; gap: 18px; }
        .split-grid { grid-template-columns: minmax(280px, 0.9fr) minmax(0, 1.3fr); }
        .triple-grid { grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
        .section-head {
          display: flex;
          justify-content: space-between;
          gap: 14px;
          align-items: start;
          flex-wrap: wrap;
          margin-bottom: 14px;
        }
        .section-head h3,
        .section-head h4,
        .content-card h3,
        .detail-card h3,
        .list-card h3,
        .log-card h3,
        .change-card h3,
        .setting-card h3,
        .page-banner h3 { margin: 0; }
        .section-head p,
        .detail-card p,
        .content-card p,
        .page-banner p { margin: 4px 0 0; color: var(--vscode-descriptionForeground); }
        .assistant-tile,
        .profile-tile { padding: 14px; display: grid; gap: 6px; }
        .row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
        }
        .meta { font-size: 13px; color: var(--vscode-descriptionForeground); }
        .title-line { font-weight: 600; }
        .hint-list,
        .note-list,
        .log-list,
        .change-list,
        .status-list,
        .guidance-list {
          list-style: none;
          padding: 0;
          margin: 0;
          display: grid;
          gap: 10px;
        }
        .hint-item,
        .note-item,
        .log-item,
        .change-item,
        .status-item,
        .guidance-item {
          padding: 12px 14px;
          border-radius: 14px;
          background: color-mix(in srgb, var(--vscode-sideBar-background) 58%, transparent);
        }
        .key-value-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 12px;
        }
        .key-value {
          padding: 12px 14px;
          border-radius: 14px;
          background: color-mix(in srgb, var(--vscode-sideBar-background) 58%, transparent);
          display: grid;
          gap: 4px;
        }
        .key-value strong,
        .setting-name,
        .guidance-index { font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--vscode-descriptionForeground); }
        code {
          font-family: var(--vscode-editor-font-family, monospace);
          font-size: 12px;
          padding: 2px 6px;
          border-radius: 6px;
          background: color-mix(in srgb, var(--vscode-textCodeBlock-background) 76%, transparent);
          word-break: break-all;
        }
        .guidance-grid { display: grid; gap: 16px; }
        .guidance-card {
          padding: 18px;
          border-radius: 16px;
          background: color-mix(in srgb, var(--vscode-sideBar-background) 55%, transparent);
          border: 1px solid color-mix(in srgb, var(--vscode-panel-border) 65%, transparent);
        }
        .guidance-list { margin-top: 14px; }
        .guidance-item { display: grid; grid-template-columns: 30px minmax(0, 1fr); align-items: start; gap: 12px; }
        .guidance-index {
          width: 30px;
          height: 30px;
          border-radius: 50%;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
          font-weight: 700;
        }
        .settings-table { display: grid; gap: 10px; }
        .setting-card { display: grid; gap: 4px; }
        .setting-value { font-weight: 600; }
        .empty-state {
          padding: 18px;
          border-radius: 16px;
          background: color-mix(in srgb, var(--vscode-sideBar-background) 55%, transparent);
          color: var(--vscode-descriptionForeground);
        }
        @media (max-width: 960px) {
          .shell { grid-template-columns: 1fr; }
          .sidebar {
            position: static;
            height: auto;
            border-right: none;
            border-bottom: 1px solid color-mix(in srgb, var(--vscode-panel-border) 72%, transparent);
            overflow: visible;
          }
          .content { padding: 18px; }
          .split-grid { grid-template-columns: 1fr; }
          .header-actions { justify-content: flex-start; }
        }
      </style>
    </head>
    <body>
      <div class="shell">
        <aside class="sidebar">
          ${renderSidebar(state.navigation, state.page, state.activeProfileName)}
          <div class="sidebar-actions">
            <button class="primary-button" data-kind="command" data-command="aidome-switchboard.setupSwitchboard">Run Setup Wizard</button>
            <button class="outline-button" data-kind="command" data-command="aidome-switchboard.verifyRouting">Verify Routing</button>
          </div>
        </aside>
        <main class="content">
          ${renderHeader(state, pageTitle)}
          ${renderPage(state)}
        </main>
      </div>
      <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        document.addEventListener('click', (event) => {
          const target = event.target.closest('[data-kind]');
          if (!target) {
            return;
          }

          const kind = target.getAttribute('data-kind');
          if (kind === 'navigate') {
            vscode.postMessage({ type: 'navigate', page: target.getAttribute('data-page') });
            return;
          }
          if (kind === 'assistant') {
            vscode.postMessage({ type: 'select-assistant', assistantKey: target.getAttribute('data-assistant') });
            return;
          }
          if (kind === 'profile') {
            vscode.postMessage({ type: 'select-profile', profileId: target.getAttribute('data-profile') });
            return;
          }
          if (kind === 'activate-profile') {
            vscode.postMessage({ type: 'activate-profile', profileId: target.getAttribute('data-profile') });
            return;
          }
          if (kind === 'copy') {
            vscode.postMessage({
              type: 'copy',
              value: target.getAttribute('data-value') || '',
              label: target.getAttribute('data-label') || 'Value'
            });
            return;
          }
          if (kind === 'open-file') {
            vscode.postMessage({ type: 'open-file', path: target.getAttribute('data-path') || '' });
            return;
          }
          if (kind === 'command') {
            const arg = target.getAttribute('data-command-arg');
            vscode.postMessage({
              type: 'run-command',
              command: target.getAttribute('data-command') || '',
              args: arg ? [arg] : []
            });
            return;
          }
          if (kind === 'show-output') {
            vscode.postMessage({ type: 'show-output' });
          }
        });
      </script>
    </body>
  </html>`;
}

function renderSidebar(
  navigation: ControlCenterNavigationItem[],
  currentPage: ControlCenterPageId,
  activeProfileName?: string
): string {
  return `
    <div class="brand">
      <div class="eyebrow">AIdome Switchboard</div>
      <h1>Control Center</h1>
      <p class="muted">Profiles, assistants, guided setup, verification, and diagnostics in one place.</p>
    </div>
    <div class="active-profile-card">
      <div class="summary-label">Active profile</div>
      <div class="sidebar-profile-row">
        <div class="title-line">${escapeHtml(activeProfileName || 'No active profile')}</div>
        <span class="badge">${activeProfileName ? 'Live' : 'None'}</span>
      </div>
      <div class="meta">Managed from Profiles or Setup Wizard.</div>
    </div>
    <nav class="nav">
      ${navigation.map(item => `
        <button class="nav-button ${item.id === currentPage ? 'active' : ''}" data-kind="navigate" data-page="${item.id}">
          <span>${escapeHtml(item.label)}</span>
          ${item.badge ? `<span class="badge">${item.badge}</span>` : ''}
        </button>
      `).join('')}
    </nav>
    <div class="muted sidebar-footnote">Quick actions stay available from the bottom-right status bar menu as well.</div>
  `;
}

function renderHeader(
  state: ControlCenterState,
  pageTitle: { kicker: string; title: string; description: string }
): string {
  const isOverview = state.page === 'overview';
  return `
    <section class="header-card ${isOverview ? '' : 'compact'}">
      <div class="header-top">
        <div class="header-title">
          <div class="eyebrow">${escapeHtml(pageTitle.kicker)}</div>
          <h2>${escapeHtml(pageTitle.title)}</h2>
          <p>${escapeHtml(pageTitle.description)}</p>
        </div>
        ${renderHeaderActions(state.page)}
      </div>
      ${isOverview ? renderOverviewSummaryGrid(state) : ''}
    </section>
  `;
}

function renderHeaderActions(page: ControlCenterPageId): string {
  switch (page) {
    case 'profiles':
      return `
        <div class="header-actions">
          <button class="primary-button" data-kind="command" data-command="aidome-switchboard.manageProfiles">Manage Profiles</button>
          <button class="outline-button" data-kind="command" data-command="aidome-switchboard.verifyRouting">Verify Routings</button>
        </div>
      `;
    case 'assistants':
      return `
        <div class="header-actions">
          <button class="primary-button" data-kind="command" data-command="aidome-switchboard.setupSwitchboard">Run Setup</button>
          <button class="outline-button" data-kind="command" data-command="aidome-switchboard.openGuidedSetup">Guided Setup</button>
        </div>
      `;
    case 'guided-setup':
      return `
        <div class="header-actions">
          <button class="primary-button" data-kind="command" data-command="aidome-switchboard.setupSwitchboard">Run Setup Wizard</button>
          <button class="outline-button" data-kind="command" data-command="aidome-switchboard.verifyRouting">Verify Routings</button>
        </div>
      `;
    case 'verification':
      return `
        <div class="header-actions">
          <button class="primary-button" data-kind="command" data-command="aidome-switchboard.verifyRouting">Verify Routings</button>
          <button class="outline-button" data-kind="command" data-command="aidome-switchboard.manageProfiles">Manage Profiles</button>
        </div>
      `;
    case 'models':
      return `
        <div class="header-actions">
          <button class="primary-button" data-kind="command" data-command="aidome-switchboard.showModelsProviders">Show Models</button>
          <button class="outline-button" data-kind="command" data-command="aidome-switchboard.verifyRouting">Verify Routings</button>
        </div>
      `;
    case 'diagnostics':
      return `
        <div class="header-actions">
          <button class="primary-button" data-kind="command" data-command="aidome-switchboard.exportDiagnostics">Export Diagnostics</button>
          <button class="outline-button" data-kind="show-output">Open Output</button>
        </div>
      `;
    case 'history-reset':
      return `
        <div class="header-actions">
          <button class="primary-button" data-kind="command" data-command="aidome-switchboard.resetSwitchboard">Reset Switchboard</button>
          <button class="outline-button" data-kind="command" data-command="aidome-switchboard.manageProfiles">Manage Profiles</button>
        </div>
      `;
    case 'advanced':
      return `
        <div class="header-actions">
          <button class="primary-button" data-kind="command" data-command="workbench.action.openSettings" data-command-arg="aidome-switchboard">Open Settings</button>
        </div>
      `;
    case 'overview':
    default:
      return `
        <div class="header-actions">
          <button class="primary-button" data-kind="command" data-command="aidome-switchboard.openControlCenter">Refresh</button>
          <button class="outline-button" data-kind="command" data-command="aidome-switchboard.openGuidedSetup">Open Guided Setup</button>
          <button class="outline-button" data-kind="command" data-command="aidome-switchboard.manageProfiles">Manage Profiles</button>
        </div>
      `;
  }
}

function renderOverviewSummaryGrid(state: ControlCenterState): string {
  return `
    <div class="summary-grid">
      <div class="summary-card">
        <div class="summary-label">Profiles</div>
        <div class="summary-value">${state.overview.profileCount}</div>
        <div class="muted">Stored endpoint profiles</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Detected assistants</div>
        <div class="summary-value">${state.overview.detectedAssistantCount}</div>
        <div class="muted">Installed extensions and CLIs</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Configured assistants</div>
        <div class="summary-value">${state.overview.configuredAssistantCount}</div>
        <div class="muted">Assistants with applied mappings</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Manual follow-up</div>
        <div class="summary-value">${state.overview.manualFollowUpCount}</div>
        <div class="muted">Assistants still needing guided work</div>
      </div>
    </div>
  `;
}

function renderPage(state: ControlCenterState): string {
  switch (state.page) {
    case 'profiles':
      return renderProfilesPage(state);
    case 'assistants':
      return renderAssistantsPage(state);
    case 'guided-setup':
      return renderGuidedSetupPage(state);
    case 'diagnostics':
      return renderDiagnosticsPage(state);
    case 'history-reset':
      return renderHistoryResetPage(state);
    case 'advanced':
      return renderAdvancedPage(state);
    case 'overview':
    default:
      return renderOverviewPage(state);
  }
}

function renderOverviewPage(state: ControlCenterState): string {
  return `
    <section class="page-grid">
      <div class="page-banner">
        <div class="section-head">
          <div>
            <h3>Overview</h3>
            <p>This page answers the basic product questions: what profile is active, which assistants are configured, and what still needs attention.</p>
          </div>
          <div class="button-row">
            <button class="primary-button" data-kind="navigate" data-page="guided-setup">Review Guided Setup</button>
            <button class="outline-button" data-kind="command" data-command="aidome-switchboard.verifyRouting">Run Verification</button>
          </div>
        </div>
        <div class="key-value-grid">
          <div class="key-value">
            <strong>Active profile</strong>
            <span>${escapeHtml(state.overview.activeProfileName || 'No active profile')}</span>
          </div>
          <div class="key-value">
            <strong>Endpoint</strong>
            <span>${state.overview.activeProfileBaseUrl ? `<code>${escapeHtml(state.overview.activeProfileBaseUrl)}</code>` : 'No active endpoint'}</span>
          </div>
        </div>
      </div>
      <div class="split-grid">
        <section class="content-card">
          <div class="section-head">
            <div>
              <h3>Needs attention</h3>
              <p>Assistants with manual follow-up still pending.</p>
            </div>
          </div>
          ${state.overview.pendingAssistants.length > 0
            ? `<div class="stack">${state.overview.pendingAssistants.map(assistant => renderAssistantTile(assistant, 'guided-setup', true)).join('')}</div>`
            : '<div class="empty-state">No guided follow-up is pending right now.</div>'}
        </section>
        <section class="content-card">
          <div class="section-head">
            <div>
              <h3>Configured assistants</h3>
              <p>Assistants that already have a profile mapping applied.</p>
            </div>
          </div>
          ${state.overview.configuredAssistants.length > 0
            ? `<div class="stack">${state.overview.configuredAssistants.map(assistant => renderAssistantTile(assistant, 'assistants', true)).join('')}</div>`
            : '<div class="empty-state">No assistants are configured yet. Run setup to create the first routed mapping.</div>'}
        </section>
      </div>
      <section class="content-card">
        <div class="section-head">
          <div>
            <h3>Detected assistants snapshot</h3>
            <p>The extension and CLI assistants currently visible from this environment.</p>
          </div>
          <button class="outline-button" data-kind="navigate" data-page="assistants">Open Assistants</button>
        </div>
        ${state.overview.detectedAssistants.length > 0
          ? `<div class="triple-grid">${state.overview.detectedAssistants.map(assistant => renderCompactAssistantCard(assistant)).join('')}</div>`
          : '<div class="empty-state">No supported assistants are detected yet. Install one of the supported assistants or CLIs, then reload the window.</div>'}
      </section>
    </section>
  `;
}

function renderProfilesPage(state: ControlCenterState): string {
  const selected = state.profiles.selected;
  return `
    <section class="split-grid">
      <section class="list-card">
        <div class="section-head">
          <div>
            <h3>Profiles</h3>
            <p>Endpoint profiles are the product anchors for all assistant routing. Click a profile to inspect it, then use Set Active in the detail panel.</p>
          </div>
          <button class="primary-button" data-kind="command" data-command="aidome-switchboard.manageProfiles">Manage Profiles</button>
        </div>
        ${state.profiles.items.length > 0
          ? `<div class="stack">${state.profiles.items.map(profile => renderProfileTile(profile, profile.id === state.selectedProfileId)).join('')}</div>`
          : '<div class="empty-state">No profiles exist yet. Run setup or Manage Profiles to create one.</div>'}
      </section>
      <section class="detail-card">
        ${selected ? renderProfileDetail(selected) : '<div class="empty-state">Select a profile to inspect its endpoint, dialect, and assistant assignments.</div>'}
      </section>
    </section>
  `;
}

function renderAssistantsPage(state: ControlCenterState): string {
  const selected = state.assistants.selected;
  return `
    <section class="split-grid">
      <section class="list-card">
        <div class="section-head">
          <div>
            <h3>Assistants</h3>
            <p>Every supported assistant, whether fully automated, guided, or informational.</p>
          </div>
          <button class="outline-button" data-kind="command" data-command="aidome-switchboard.setupSwitchboard">Run Setup</button>
        </div>
        <div class="stack">
          ${state.assistants.items.map(assistant => renderAssistantTile(assistant, 'assistants', assistant.key === state.selectedAssistantKey)).join('')}
        </div>
      </section>
      <section class="detail-card">
        ${selected ? renderAssistantDetail(selected) : '<div class="empty-state">Select an assistant to inspect its detection, configuration mode, and next actions.</div>'}
      </section>
    </section>
  `;
}

function renderGuidedSetupPage(state: ControlCenterState): string {
  const selected = state.guidedSetup.selected;
  const sections = selected
    ? (selected.guidedSections.length > 0 ? selected.guidedSections : selected.previewSections)
    : [];
  return `
    <section class="split-grid">
      <section class="list-card">
        <div class="section-head">
          <div>
            <h3>Guided Setup</h3>
            <p>${state.guidedSetup.isPreview
              ? 'No persisted manual tasks exist yet, so this page is showing preview assistants that demonstrate the guided workspace.'
              : 'Assistants still requiring manual follow-up after automation or partial automation.'}</p>
          </div>
          <button class="outline-button" data-kind="command" data-command="aidome-switchboard.setupSwitchboard">Run Setup Wizard</button>
        </div>
        <div class="stack">
          ${state.guidedSetup.items.map(assistant => renderAssistantTile(assistant, 'guided-setup', assistant.key === state.selectedAssistantKey)).join('')}
        </div>
      </section>
      <section class="detail-card">
        ${selected ? `
          <div class="section-head">
            <div>
              <h3>${escapeHtml(selected.displayName)}</h3>
              <p>${state.guidedSetup.isPreview
                ? 'Preview mode is active. Running setup later will replace this preview with persisted assistant guidance.'
                : 'Complete these steps, then run verification from the same workspace.'}</p>
            </div>
            <div class="chips">
              <span class="status-pill ${selected.status}">${escapeHtml(selected.statusLabel)}</span>
              <span class="chip">Tier ${escapeHtml(selected.tier)}</span>
            </div>
          </div>
          <div class="guidance-grid">
            ${sections.map(section => renderGuidedSection(section)).join('')}
          </div>
        ` : '<div class="empty-state">Select an assistant to view its guided setup steps.</div>'}
      </section>
    </section>
  `;
}

function renderVerificationPage(state: ControlCenterState): string {
  return `
    <section class="page-grid">
      <section class="content-card">
        <div class="section-head">
          <div>
            <h3>Verification</h3>
            <p>Verification is still command-driven, but this page centralizes profile health, last verification time, and the next action.</p>
          </div>
          <button class="primary-button" data-kind="command" data-command="aidome-switchboard.verifyRouting">Verify Routing</button>
        </div>
        ${state.verification.profiles.length > 0
          ? `<div class="triple-grid">${state.verification.profiles.map(profile => renderVerificationCard(profile)).join('')}</div>`
          : '<div class="empty-state">No profiles exist yet. Create a profile first, then run verification.</div>'}
      </section>
    </section>
  `;
}

function renderModelsPage(state: ControlCenterState): string {
  return `
    <section class="page-grid">
      <section class="content-card">
        <div class="section-head">
          <div>
            <h3>Models & Providers</h3>
            <p>This page is the inventory surface for model and provider visibility through the current endpoint profile.</p>
          </div>
          <div class="button-row">
            <button class="primary-button" data-kind="command" data-command="aidome-switchboard.showModelsProviders">Show Models & Providers</button>
            <button class="outline-button" data-kind="command" data-command="aidome-switchboard.verifyRouting">Verify Routing</button>
          </div>
        </div>
        <div class="key-value-grid">
          <div class="key-value">
            <strong>Active profile</strong>
            <span>${escapeHtml(state.models.activeProfile?.name || 'No active profile')}</span>
          </div>
          <div class="key-value">
            <strong>Profile type</strong>
            <span>${escapeHtml(state.models.activeProfile?.profileType || 'N/A')}</span>
          </div>
          <div class="key-value">
            <strong>Base URL</strong>
            <span>${state.models.activeProfile ? `<code>${escapeHtml(state.models.activeProfile.baseUrl)}</code>` : 'N/A'}</span>
          </div>
        </div>
        <p class="muted">${escapeHtml(state.models.note)}</p>
      </section>
    </section>
  `;
}

function renderDiagnosticsPage(state: ControlCenterState): string {
  return `
    <section class="page-grid">
      <div class="triple-grid">
        <section class="summary-card">
          <div class="summary-label">Buffered logs</div>
          <div class="summary-value">${state.diagnostics.logCount}</div>
          <div class="muted">Recent log entries retained in memory</div>
        </section>
        <section class="summary-card">
          <div class="summary-label">Change log entries</div>
          <div class="summary-value">${state.diagnostics.changeCount}</div>
          <div class="muted">Recorded apply and rollback history entries</div>
        </section>
        <section class="summary-card">
          <div class="summary-label">Next action</div>
          <div class="summary-value">Export</div>
          <div class="muted">Use diagnostics export when filing support or bug reports</div>
        </section>
      </div>
      <section class="log-card">
        <div class="section-head">
          <div>
            <h3>Recent logs</h3>
            <p>Recent extension activity, suitable for quick troubleshooting before exporting diagnostics.</p>
          </div>
          <div class="button-row">
            <button class="primary-button" data-kind="command" data-command="aidome-switchboard.exportDiagnostics">Export Diagnostics</button>
            <button class="outline-button" data-kind="show-output">Open Output</button>
          </div>
        </div>
        ${state.diagnostics.recentLogs.length > 0
          ? `<ul class="log-list">${state.diagnostics.recentLogs.map(log => `
            <li class="log-item">
              <div class="row"><strong>${escapeHtml(log.level)}</strong><span class="meta">${escapeHtml(formatDate(log.timestamp))}</span></div>
              <div>${escapeHtml(log.message)}</div>
            </li>
          `).join('')}</ul>`
          : '<div class="empty-state">No log entries are buffered yet.</div>'}
      </section>
    </section>
  `;
}

function renderHistoryResetPage(state: ControlCenterState): string {
  return `
    <section class="page-grid">
      <section class="change-card">
        <div class="section-head">
          <div>
            <h3>History & Reset</h3>
            <p>Recorded changes give the user trust in what the product changed and a place to start recovery.</p>
          </div>
          <div class="button-row">
            <button class="outline-button" data-kind="command" data-command="aidome-switchboard.manageProfiles">Manage Profiles</button>
            <button class="primary-button" data-kind="command" data-command="aidome-switchboard.resetSwitchboard">Reset Switchboard</button>
          </div>
        </div>
        ${state.historyReset.recentChanges.length > 0
          ? `<ul class="change-list">${state.historyReset.recentChanges.map(renderChangeEntry).join('')}</ul>`
          : '<div class="empty-state">No change log history exists yet. Once setup applies configuration steps, they will appear here.</div>'}
      </section>
    </section>
  `;
}

function renderAdvancedPage(state: ControlCenterState): string {
  return `
    <section class="page-grid">
      <section class="content-card">
        <div class="section-head">
          <div>
            <h3>Advanced Settings</h3>
            <p>These values mirror the product runtime settings that shape timeouts, TLS verification, and diagnostics behavior.</p>
          </div>
          <button class="primary-button" data-kind="command" data-command="workbench.action.openSettings" data-command-arg="aidome-switchboard">Open Settings</button>
        </div>
        <div class="settings-table">
          ${state.advanced.settings.map(setting => `
            <div class="setting-card">
              <div class="setting-name">${escapeHtml(setting.label)}</div>
              <div class="setting-value">${escapeHtml(setting.value)}</div>
              <div class="muted">${escapeHtml(setting.description)}</div>
            </div>
          `).join('')}
        </div>
      </section>
    </section>
  `;
}

function renderProfileTile(profile: ProfileSurfaceState, selected: boolean): string {
  return `
    <button class="profile-tile ${selected ? 'active' : ''}" data-kind="profile" data-profile="${escapeAttribute(profile.id)}">
      <div class="row">
        <span class="title-line">${escapeHtml(profile.name)}</span>
        ${profile.isActive ? '<span class="badge">Active</span>' : ''}
      </div>
      <div class="meta">${escapeHtml(profile.dialect)} · ${escapeHtml(profile.profileType)}</div>
      <div class="meta">${profile.assistantCount} mapped assistant${profile.assistantCount === 1 ? '' : 's'}</div>
    </button>
  `;
}

function renderProfileDetail(profile: ProfileSurfaceState): string {
  return `
    <div class="stack">
      <div class="section-head">
        <div>
          <h3>${escapeHtml(profile.name)}</h3>
          <p>Profile detail is the anchor for endpoint, dialect, and assignment state.</p>
        </div>
        <div class="chips">
          ${profile.isActive ? '<span class="badge">Active</span>' : ''}
          <span class="chip">${escapeHtml(profile.dialect)}</span>
          <span class="chip">${escapeHtml(profile.profileType)}</span>
        </div>
      </div>
      <div class="key-value-grid">
        <div class="key-value"><strong>Base URL</strong><span><code>${escapeHtml(profile.baseUrl)}</code></span></div>
        <div class="key-value"><strong>Last verified</strong><span>${escapeHtml(profile.lastVerified ? formatDate(profile.lastVerified) : 'Not yet verified')}</span></div>
        <div class="key-value"><strong>Assigned assistants</strong><span>${profile.assistantCount}</span></div>
      </div>
      <div>
        <strong class="setting-name">Assigned assistants</strong>
        ${profile.assistantNames.length > 0 ? `<div class="chips" style="margin-top:8px;">${profile.assistantNames.map(name => `<span class="chip">${escapeHtml(name)}</span>`).join('')}</div>` : '<div class="empty-state" style="margin-top:10px;">No assistant mappings point at this profile yet.</div>'}
      </div>
      <div class="button-row">
        ${profile.isActive
          ? '<span class="chip">Currently Active</span>'
          : `<button class="primary-button" data-kind="activate-profile" data-profile="${escapeAttribute(profile.id)}">Set Active</button>`}
        <button class="outline-button" data-kind="command" data-command="aidome-switchboard.manageProfiles" data-command-arg="${escapeAttribute(profile.id)}">Manage Profile</button>
        ${profile.profileType === 'aidome'
          ? `<button class="outline-button" data-kind="command" data-command="aidome-switchboard.showModelsProviders" data-command-arg="${escapeAttribute(profile.id)}">Show Models & Providers</button>
             <button class="outline-button" data-kind="command" data-command="aidome-switchboard.showModels" data-command-arg="${escapeAttribute(profile.id)}">Show Models</button>`
          : ''}
        <button class="outline-button" data-kind="command" data-command="aidome-switchboard.verifyRouting" data-command-arg="${escapeAttribute(profile.id)}">Verify Routing</button>
      </div>
    </div>
  `;
}

function renderAssistantTile(assistant: AssistantSurfaceState, page: ControlCenterPageId, selected: boolean): string {
  const sectionCount = assistant.guidedSections.length > 0 ? assistant.guidedSections.length : assistant.previewSections.length;
  return `
    <button class="assistant-tile ${selected ? 'active' : ''}" data-kind="assistant" data-assistant="${escapeAttribute(assistant.key)}">
      <div class="row">
        <span class="title-line">${escapeHtml(assistant.displayName)}</span>
        <span class="status-pill ${assistant.status}">${escapeHtml(assistant.statusLabel)}</span>
      </div>
      <div class="meta">Tier ${escapeHtml(assistant.tier)} · ${escapeHtml(assistant.kind)}</div>
      <div class="meta">${assistant.mappedProfileName ? `Mapped to ${escapeHtml(assistant.mappedProfileName)}` : assistant.detected ? 'Detected in current environment' : 'Not detected in current environment'}</div>
      ${page === 'guided-setup' ? `<div class="meta">${sectionCount} section${sectionCount === 1 ? '' : 's'}</div>` : ''}
    </button>
  `;
}

function renderCompactAssistantCard(assistant: AssistantSurfaceState): string {
  return `
    <div class="content-card">
      <div class="row">
        <strong>${escapeHtml(assistant.displayName)}</strong>
        <span class="status-pill ${assistant.status}">${escapeHtml(assistant.statusLabel)}</span>
      </div>
      <div class="meta">Tier ${escapeHtml(assistant.tier)} · ${escapeHtml(assistant.primaryDialect)}</div>
      <div class="button-row" style="margin-top: 12px;">
        <button class="outline-button" data-kind="navigate" data-page="assistants">Inspect</button>
      </div>
    </div>
  `;
}

function renderAssistantDetail(assistant: AssistantSurfaceState): string {
  return `
    <div class="stack">
      <div class="section-head">
        <div>
          <h3>${escapeHtml(assistant.displayName)}</h3>
          <p>Assistant detail combines detection, configuration hints, mapped profile state, and manual follow-up context.</p>
        </div>
        <div class="chips">
          <span class="status-pill ${assistant.status}">${escapeHtml(assistant.statusLabel)}</span>
          <span class="chip">Tier ${escapeHtml(assistant.tier)}</span>
          <span class="chip">${escapeHtml(assistant.primaryDialect)}</span>
        </div>
      </div>
      <div class="key-value-grid">
        <div class="key-value"><strong>Kind</strong><span>${escapeHtml(assistant.kind)}</span></div>
        <div class="key-value"><strong>Configuration modes</strong><span>${escapeHtml(assistant.configurationModes.join(', ') || 'N/A')}</span></div>
        <div class="key-value"><strong>Mapped profile</strong><span>${escapeHtml(assistant.mappedProfileName || 'None')}</span></div>
        <div class="key-value"><strong>Applied mode</strong><span>${escapeHtml(assistant.appliedMode || 'Not applied')}</span></div>
      </div>
      <section class="content-card">
        <div class="section-head"><div><h4>Detection</h4><p>What the extension can currently observe in this environment.</p></div></div>
        ${assistant.detectionDetails.length > 0
          ? `<ul class="status-list">${assistant.detectionDetails.map(detail => `<li class="status-item">${escapeHtml(detail)}</li>`).join('')}</ul>`
          : '<div class="empty-state">No installed extension or CLI was detected for this assistant in the current environment.</div>'}
      </section>
      <section class="content-card">
        <div class="section-head"><div><h4>Hints & notes</h4><p>Registry-provided hints for settings, environment variables, files, and constraints.</p></div></div>
        <div class="split-grid">
          <div class="stack">
            <strong class="setting-name">Setting hints</strong>
            ${assistant.settingHints.length > 0 ? `<ul class="hint-list">${assistant.settingHints.map(hint => `<li class="hint-item"><code>${escapeHtml(hint)}</code></li>`).join('')}</ul>` : '<div class="empty-state">No settings keys are published for this assistant.</div>'}
          </div>
          <div class="stack">
            <strong class="setting-name">Environment hints</strong>
            ${assistant.envHints.length > 0 ? `<ul class="hint-list">${assistant.envHints.map(hint => `<li class="hint-item"><code>${escapeHtml(hint)}</code></li>`).join('')}</ul>` : '<div class="empty-state">No environment variable hints are published for this assistant.</div>'}
          </div>
        </div>
        <div class="stack" style="margin-top: 16px;">
          <strong class="setting-name">Config file hints</strong>
          ${assistant.configFileHints.length > 0 ? `<ul class="hint-list">${assistant.configFileHints.map(hint => `<li class="hint-item">${escapeHtml(hint)}</li>`).join('')}</ul>` : '<div class="empty-state">No config file hints are published for this assistant.</div>'}
        </div>
        <div class="stack" style="margin-top: 16px;">
          <strong class="setting-name">Notes</strong>
          <ul class="note-list">${assistant.notes.map(note => `<li class="note-item">${escapeHtml(note)}</li>`).join('')}</ul>
        </div>
      </section>
      <div class="button-row">
        <button class="primary-button" data-kind="navigate" data-page="guided-setup">Open Guided Setup</button>
        <button class="outline-button" data-kind="command" data-command="aidome-switchboard.setupSwitchboard">Run Setup</button>
        <button class="outline-button" data-kind="command" data-command="aidome-switchboard.verifyRouting">Verify Routing</button>
      </div>
    </div>
  `;
}

function renderGuidedSection(section: GuidedSection): string {
  const steps = section.data.steps && section.data.steps.length > 0 ? section.data.steps : [section.data.message];
  return `
    <section class="guidance-card">
      <div class="section-head">
        <div>
          <h4>${escapeHtml(section.description)}</h4>
          <p>${escapeHtml(section.data.message)}</p>
        </div>
        <div class="chips">${renderGuidanceChips(section)}</div>
      </div>
      <ol class="guidance-list">
        ${steps.map((step, index) => `
          <li class="guidance-item">
            <span class="guidance-index">${index + 1}</span>
            <div>${escapeHtml(step)}</div>
          </li>
        `).join('')}
      </ol>
      <div class="section-actions">
        ${section.data.baseUrl ? `<button class="outline-button" data-kind="copy" data-label="Endpoint URL" data-value="${escapeAttribute(section.data.baseUrl)}">Copy Endpoint URL</button>` : ''}
        ${section.data.envVarName ? `<button class="outline-button" data-kind="copy" data-label="Environment variable name" data-value="${escapeAttribute(section.data.envVarName)}">Copy Env Var Name</button>` : ''}
        ${section.data.configPath ? `<button class="outline-button" data-kind="open-file" data-path="${escapeAttribute(section.data.configPath)}">Open Config File</button>` : ''}
        <button class="primary-button" data-kind="command" data-command="aidome-switchboard.verifyRouting">Verify Routing</button>
      </div>
    </section>
  `;
}

function renderVerificationCard(profile: ProfileSurfaceState): string {
  return `
    <div class="content-card">
      <div class="row">
        <strong>${escapeHtml(profile.name)}</strong>
        ${profile.isActive ? '<span class="badge">Active</span>' : ''}
      </div>
      <div class="meta">${escapeHtml(profile.dialect)} · ${escapeHtml(profile.profileType)}</div>
      <div class="meta">${profile.lastVerified ? `Last verified ${escapeHtml(formatDate(profile.lastVerified))}` : 'Not yet verified from the current profile history'}</div>
      <div class="button-row" style="margin-top: 12px;">
        <button class="primary-button" data-kind="command" data-command="aidome-switchboard.verifyRouting">Verify Routing</button>
        <button class="outline-button" data-kind="navigate" data-page="profiles">View Profile</button>
      </div>
    </div>
  `;
}

function renderChangeEntry(entry: ChangeEntrySurfaceState): string {
  return `
    <li class="change-item">
      <div class="row">
        <strong>${escapeHtml(entry.assistantKey)}</strong>
        <span class="meta">${escapeHtml(formatDate(entry.timestamp))}</span>
      </div>
      <div class="meta">Profile: ${escapeHtml(entry.profileName)}</div>
      <div>${escapeHtml(entry.summary)}</div>
    </li>
  `;
}

function renderGuidanceChips(section: GuidedSection): string {
  const chips: string[] = [];
  if (section.data.tier) {
    chips.push(`<span class="chip">Tier ${escapeHtml(section.data.tier)}</span>`);
  }
  if (section.data.configurationType) {
    chips.push(`<span class="chip">${escapeHtml(section.data.configurationType)}</span>`);
  }
  if (section.data.baseUrl) {
    chips.push(`<span class="chip"><code>${escapeHtml(section.data.baseUrl)}</code></span>`);
  }
  return chips.join('');
}

function pageTitleFor(page: ControlCenterPageId): { kicker: string; title: string; description: string } {
  switch (page) {
    case 'profiles':
      return {
        kicker: 'Profiles',
        title: 'Endpoint profiles as first-class objects',
        description: 'Profiles anchor the rest of the product. Each profile captures the base URL, dialect, active state, and assistant assignments.'
      };
    case 'assistants':
      return {
        kicker: 'Assistants',
        title: 'One place to inspect the assistant fleet',
        description: 'This page exposes every supported assistant, its automation tier, detection state, and the next product action.'
      };
    case 'guided-setup':
      return {
        kicker: 'Guided Setup',
        title: 'Manual follow-up as a real workspace',
        description: 'Guided setup is no longer just output text. It is a workspace for assistants that still need manual configuration steps.'
      };
    case 'verification':
      return {
        kicker: 'Verification',
        title: 'Routing health and next steps',
        description: 'Verification is still command-driven, but this page makes it part of the product shell rather than an isolated report.'
      };
    case 'models':
      return {
        kicker: 'Models & Providers',
        title: 'Inventory surface for the active endpoint',
        description: 'Use this area to inspect the provider inventory and model visibility for the active profile.'
      };
    case 'diagnostics':
      return {
        kicker: 'Diagnostics',
        title: 'Support-focused operational visibility',
        description: 'Recent logs, change counts, and diagnostics export are grouped here so troubleshooting does not start from raw output alone.'
      };
    case 'history-reset':
      return {
        kicker: 'History & Reset',
        title: 'Trust through visible change history',
        description: 'Users should be able to see what changed and where they can recover from a broken configuration.'
      };
    case 'advanced':
      return {
        kicker: 'Advanced',
        title: 'Runtime and verifier tuning',
        description: 'Expose the runtime settings that shape networking, TLS, retries, and diagnostic behavior.'
      };
    case 'overview':
    default:
      return {
        kicker: 'Overview',
        title: 'A product shell for the whole Switchboard',
        description: 'This is the landing surface for profiles, assistants, guided follow-up, verification, and product-level actions.'
      };
  }
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function escapeAttribute(text: string): string {
  return escapeHtml(text).replace(/`/g, '&#96;');
}

function createNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let i = 0; i < 32; i += 1) {
    value += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return value;
}