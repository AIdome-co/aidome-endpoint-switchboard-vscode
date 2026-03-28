import fs from 'node:fs';

const [releaseTag, outputPath] = process.argv.slice(2);

if (!releaseTag || !outputPath) {
  console.error('Usage: node .github/scripts/build-release-body.mjs <tag> <output-path>');
  process.exit(1);
}

const version = releaseTag.startsWith('v') ? releaseTag.slice(1) : releaseTag;
const changelog = fs.readFileSync('CHANGELOG.md', 'utf8');
const lines = changelog.split(/\r?\n/);
const heading = `## [${version}]`;
const startIndex = lines.findIndex((line) => line.startsWith(heading));

if (startIndex === -1) {
  console.error(`Missing CHANGELOG entry for ${version}`);
  process.exit(1);
}

let endIndex = lines.length;
for (let index = startIndex + 1; index < lines.length; index += 1) {
  if (lines[index].startsWith('## [')) {
    endIndex = index;
    break;
  }
}

const section = lines.slice(startIndex, endIndex).join('\n').trim();
const body = [
  `## LLM Endpoint Switchboard ${releaseTag}`,
  '',
  '### Installation',
  '',
  '**VS Code Marketplace**: Search for "LLM Endpoint Switchboard" in VS Code Extensions',
  '',
  '**Manual Install (air-gapped)**:',
  '1. Download the `.vsix` file below',
  '2. Open the command palette and run `Extensions: Install from VSIX...`',
  '3. Select the downloaded VSIX file',
  '',
  '### Changelog',
  '',
  section,
  '',
  '### Full History',
  'See [CHANGELOG.md](https://github.com/AIdome-co/aidome-endpoint-switchboard-vscode/blob/main/CHANGELOG.md) for the complete release history.',
].join('\n');

fs.writeFileSync(outputPath, `${body}\n`);