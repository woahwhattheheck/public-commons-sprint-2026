# KZFR listener journey + Creek Studio handoff proof

**Work order:** KZFR-CREEK-INTEGRATION-ACCEPTANCE-20261010-GPT6CLOUD. **Status:** internal engineering proof, not a bid, customer deployment, radio service, booked revenue, or customer approval. Buyer relationship, proposal and references remain with their existing owners. No outreach to KZFR, Creek, or Michael Clark.

## Buyer specification and current first-party evidence

Original issuer: [KZFR Website Redesign RFP](https://kzfr.org/RFP) → original [KZFR 09.02.2026 RFP PDF](https://media.kzfr.org/file/KZFR_Website_Redesign_RFP_09.02.2026.pdf), pages 4–8 plus September 2 Addendum No. 01. The PDF was read in its entirety via networked document extraction on October 10. It specifies:

- New site **must use WordPress core**, security/update maintenance, mobile-first layouts, WCAG **2.1 AA**, archive search/filter by program/date/category, and **under 3 seconds page-load target**; original KZFR retains website/code/design ownership.
- **Creek Studio remains** the existing live stream, archive hosting, playlists, show schedules and radio-specific backend. The redesign should connect them. The addendum explicitly says not to build a replacement audio/archive platform.
- Original addendum says **$12,000** allocated for website development. A primary proposal should fit it; optionally price extra features separately. Only US-based vendors eligible, Northern California preferred.
- RFP deadline **October 16, 2026, 5 p.m. Pacific**. Five weighted scoring rows in the original are experience 15%, proposed approach 35%, cost 20%, understanding KZFR mission 10%, timeline 15% (sum 95% as published, not silently normalized). Project expected January 4, 2027. The original includes up to 7 days for KZFR staff responses during execution.

Current **published KZFR** [Saturday programs](https://kzfr.org/programs), [events](https://kzfr.org/events/categories/kzfr), [underwriting](https://kzfr.org/pages/underwrite), [Creek archive link](https://kzfr.studio.creek.org/) and [Creek donation link](https://kzfr-donate.creek.org/) were checked October 10. `programs.json` is a curated, source-backed schedule *snapshot*, not an archive dataset, live player status, or provider API fixture. The `World Music`, `Roots`, and `Blues` labels are UX navigation groupings rather than an official KZFR taxonomy; production would import approved program metadata.

## Deliverables

- `index.html`: fully local, no framework or external image/fonts; keyboard-first skip link, clear focus styling, mobile layout, reduced-motion support, semantic station/program navigation, actual source links to existing services, live results announcement and client-side genre/name filtering. The site's editorial style is a proposal concept, not authorized KZFR branding.
- `handoff.mjs`: pure JS validation of six service roles, exact allowed hostnames/protocol, refusal to invent provider-backed stream URLs or rehost existing archives, mandatory WordPress-core delivery, records requiring source provenance/unique schedule keys, and deterministic client-side search.
- `programs.json`: observable Saturday broadcast schedule source fixture.
- `handoff.test.mjs`: focused offline Node `node:test` regressions for normal buyer handoff, spoofed Creek origins, HTTP/credential/redirect URL abuse, WordPress/Creek boundaries, metadata filtering and duplicates.
- `preview.mjs`: optional 127.0.0.1-only static preview server serving only the four explicit website files; no outbound calls, data persistence, sign-in, stream playback or donation processing.

Run locally (Node 22+):

```sh
node --test handoff.test.mjs
node preview.mjs
# Open http://127.0.0.1:8787/ in your own browser.
```

## Proposed delivery acceptance, not implementation claims

| Gate | Buyer-approved acceptance needed |
| --- | --- |
| Content migration | Full page/program/event/underwriter inventory and permalink redirects, editorial approval and rollback; no content invented from our snapshot |
| Radio wiring | Actual Creek-supported embedding API/URLs, CSP/CORS/permissions, live playback, resume, archives by program/date/category tested on desktop/mobile; verify terms with buyer/provider |
| Accessibility | WCAG 2.1 AA axe/manual keyboard + screen-reader journeys, captions/transcripts where applicable; this proof is not a certified WCAG audit |
| Performance | production WP page load under three seconds on agreed mobile device/network and CDN/cache measurement; a static preview is not a WordPress benchmark |
| Security/ownership | patched supported PHP and WordPress, updates/backups, admin/staff roles, export access, 100% site/code/design custody to KZFR |
| Commercial | fixed-phase pricing within $12k primary budget with 7-day KZFR response slots; qualified US-based prime and 3 similar examples/references checked by owner before any proposal |

One repeatable revenue path: locate the buyer's *binding integration boundary*, build a source-exact demonstration plus executable technical acceptance contract, have a qualified prime incorporate it into an **explicitly approved** fixed-price deliverable, and count revenue only after signed purchase and payment. This proof alone is **not a $12k promise**, a submission, a provider integration, or an installed WordPress site.

## Provenance corrections

For `index.html`, the button labelled “Listen on KZFR” goes to the existing *KZFR homepage*, where the existing player is operated. It is intentionally **not** a direct audio stream button. The archive and donation CTAs go to the actual first-party linked Creek destinations and may require JavaScript or separate approval. No external audio, metadata API, donation, webhook, WordPress admin, or customer information is fetched or used by the proof.
