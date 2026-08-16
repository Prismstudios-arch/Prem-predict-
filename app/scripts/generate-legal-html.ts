/**
 * Generate web/terms and web/privacy from src/content/legal.ts.
 *
 *   npm run legal
 *
 * The documents have to exist in the app and at a public URL (§9.3 [HARD],
 * because App Store Connect fetches the privacy one during review). Keeping two
 * hand-written copies is how a legal text ends up saying two different things:
 * somebody corrects the web page, nobody touches the app, and nothing complains
 * for a year.
 *
 * So the app renders the data and this writes the HTML from the same data.
 * tests/legal.test.ts regenerates and compares against what is committed, so
 * editing the HTML by hand fails CI rather than silently winning.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LEGAL_DOCS, type Block, type LegalDoc } from '../src/content/legal';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, '..', '..', 'web');

/** HTML-escape. These strings are ours, but a stray & would still break validation. */
function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderBlock(block: Block): string {
  switch (block.kind) {
    case 'p':
      return `<p>\n  ${esc(block.text)}\n</p>`;
    case 'list':
      return (
        '<ul>\n' + block.items.map((i) => `  <li>${esc(i)}</li>`).join('\n') + '\n</ul>'
      );
    case 'note':
      return `<div class="note">\n  <p>${esc(block.text)}</p>\n</div>`;
    case 'rows':
      return (
        '<table>\n  <thead><tr><th>Data</th><th>Why</th></tr></thead>\n  <tbody>\n' +
        block.rows
          .map((r) => `    <tr><td>${esc(r.label)}</td><td>${esc(r.value)}</td></tr>`)
          .join('\n') +
        `\n  </tbody>\n</table>\n<p class="caption">${esc(block.caption)}</p>`
      );
  }
}

function renderDoc(doc: LegalDoc): string {
  const body = [
    `<h1>${esc(doc.title)}</h1>`,
    `<p class="meta">Reckon · Last updated ${esc(doc.updated)}</p>`,
    ...doc.intro.map(renderBlock),
    ...doc.sections.flatMap((s) => [`<h2>${esc(s.heading)}</h2>`, ...s.blocks.map(renderBlock)]),
    '<footer>',
    '  <p>',
    '    <a href="/">Home</a> ·',
    '    <a href="/support">Support</a> ·',
    doc.slug === 'terms'
      ? '    <a href="/privacy">Privacy Policy</a>'
      : '    <a href="/terms">Terms of Use</a>',
    '  </p>',
    '</footer>',
  ].join('\n\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(doc.title)} — Reckon</title>
<!--
  GENERATED FILE - do not edit.
  Source: app/src/content/legal.ts   Regenerate: cd app && npm run legal
  Edits here are overwritten and will fail tests/legal.test.ts.
-->
<style>
  :root { color-scheme: dark light; }
  body {
    margin: 0 auto; padding: 3rem 1.25rem 6rem; max-width: 44rem;
    font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #0A0B0D; color: #F2F4F7;
  }
  h1 { font-size: 2rem; letter-spacing: -0.02em; margin: 0 0 .25rem; }
  h2 { font-size: 1.15rem; margin: 2.5rem 0 .75rem; letter-spacing: -0.01em; }
  .meta { color: #767F8B; font-size: .875rem; margin-bottom: 2.5rem; }
  p, li, td { color: #C7CDD5; }
  a { color: #C4F000; }
  .note { border-left: 2px solid #C4F000; padding-left: 1rem; margin: 2rem 0; }
  .caption { color: #767F8B; font-size: .875rem; }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
  th, td { text-align: left; padding: .6rem .75rem; border-bottom: 1px solid #252930; }
  th { color: #767F8B; font-size: .8rem; text-transform: uppercase; letter-spacing: .04em; }
  ul { padding-left: 1.1rem; }
  li { margin: .4rem 0; }
  footer { margin-top: 4rem; color: #767F8B; font-size: .875rem; }
  @media (prefers-color-scheme: light) {
    body { background: #FBFBFC; color: #101215; }
    p, li, td { color: #3A424C; }
    a { color: #5B7000; }
    .meta, .caption, footer, th { color: #6E7681; }
    th, td { border-bottom-color: #E3E6EA; }
  }
</style>
</head>
<body>

${body}

</body>
</html>
`;
}

export function build(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const doc of Object.values(LEGAL_DOCS)) {
    out[`${doc.slug}/index.html`] = renderDoc(doc);
  }
  return out;
}

// Only write when run directly, so the test can import build() without side effects.
if (process.argv[1] && process.argv[1].endsWith('generate-legal-html.ts')) {
  for (const [rel, html] of Object.entries(build())) {
    const path = join(WEB, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, html, 'utf8');
    console.log(`  wrote web/${rel}`);
  }
  console.log('\nCommit and push - Cloudflare deploys web/ from GitHub.');
}
