import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
const tag = process.argv[2];
assert.equal(tag, `v${manifest.version}`, 'Release tag must match package.json');
const changelog = readFileSync('CHANGELOG.md', 'utf8');
const sections = changelog.split(/^## /m).slice(1);
const index = sections.findIndex((section) => section.startsWith(`${manifest.version} — `));
assert.ok(index >= 0, 'A dated changelog entry is required');
const body = sections[index].slice(sections[index].indexOf('\n') + 1).trim();
const previous = sections[index + 1]?.match(/^(\d+\.\d+\.\d+)/)?.[1];
const repository = manifest.repository.url.replace(/^git\+/, '').replace(/\.git$/, '');

process.stdout.write(`# Kimi Code for bb ${tag}\n\n${body}\n
## Update

For an existing Git installation:

\`\`\`sh
bb plugin update kimicode
\`\`\`

For a new installation, paste the repository URL into bb's plugin installer or run:

\`\`\`sh
bb plugin install ${repository}
\`\`\`

To install this exact release:

\`\`\`sh
bb plugin install git:${repository}.git@${tag}
\`\`\`

Create a **new thread** for K3.1 Pro or K3.1 Pro Highspeed. Both models require thinking enabled and offer Low / High / Max (default High). Access and context limits depend on your Kimi subscription.

## Validation

- TypeScript checks, offline regression tests, and published SDK bridge conformance.
- Clean Git-install build without development dependencies, plus package content checks.
- Real model replies verified locally with Kimi Code CLI 2.3.1 for both new K3.1 Pro variants.
- Manual check in bb confirmed by the maintainer before release.

[Setup and configuration](${repository}#connect-your-account) · [Kimi model documentation](https://www.kimi.com/code/docs/en/kimi-code/models.html)${previous ? ` · [Full changelog](${repository}/compare/v${previous}...${tag})` : ''}
`);
