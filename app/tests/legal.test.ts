import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { build } from '../scripts/generate-legal-html';
import { LEGAL_DOCS } from '../src/content/legal';

const WEB = join(__dirname, '..', '..', 'web');

describe('legal documents', () => {
  it('the committed web pages match what the app renders', () => {
    // The whole point of generating them. If someone edits the HTML by hand to
    // fix a typo, the app keeps showing the old wording and nothing complains —
    // for a legal text that is a real problem, not a tidiness one.
    for (const [rel, html] of Object.entries(build())) {
      const committed = readFileSync(join(WEB, rel), 'utf8');
      expect(committed, `web/${rel} is stale — run \`npm run legal\``).toBe(html);
    }
  });

  it('does not claim to collect analytics or crash data', () => {
    // These were declared for a year while both SDKs sat un-initialised. The
    // policy must agree with the App Store privacy labels, and the labels
    // declare User ID and Purchases only.
    const privacy = JSON.stringify(LEGAL_DOCS.privacy).toLowerCase();
    for (const claim of ['posthog', 'sentry']) {
      expect(privacy, `privacy policy names ${claim} as a processor`).not.toContain(claim);
    }
    expect(privacy).toContain('no analytics');
    expect(privacy).toContain('no crash reports');
  });

  it('states the no-gambling position in both documents', () => {
    // §2 [HARD]. A reviewer following the URL is among the most likely readers.
    for (const doc of Object.values(LEGAL_DOCS)) {
      const text = JSON.stringify(doc).toLowerCase();
      expect(text, `${doc.slug} omits the gambling disclaimer`).toContain('gambling');
    }
  });

  it('carries the not-affiliated disclaimer in both documents', () => {
    for (const doc of Object.values(LEGAL_DOCS)) {
      expect(JSON.stringify(doc)).toContain('not affiliated with, endorsed by, or connected to');
    }
  });

  it('gives a contact address in both documents', () => {
    for (const doc of Object.values(LEGAL_DOCS)) {
      expect(JSON.stringify(doc)).toContain('reckon2026@outlook.com');
    }
  });

  it('escapes HTML rather than emitting raw text into the page', () => {
    const html = build()['privacy/index.html']!;
    // The generated pages quote a display name in double quotes; unescaped it
    // would still render, which is exactly why this is easy to get wrong.
    expect(html).toContain('&quot;Quiet Chevron 41&quot;');
    expect(html).not.toMatch(/<p>\s*[^<]*"Quiet Chevron/);
  });

  it('has no empty sections', () => {
    for (const doc of Object.values(LEGAL_DOCS)) {
      for (const section of doc.sections) {
        expect(section.blocks.length, `${doc.slug}: "${section.heading}" is empty`).toBeGreaterThan(0);
      }
    }
  });
});
