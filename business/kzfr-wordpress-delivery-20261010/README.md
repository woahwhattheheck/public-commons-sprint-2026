# KZFR community-radio WordPress delivery candidate

**Status: source-authored, PHP-linted, narrowly smoke-tested, not installed, not deployed or accepted by KZFR.** This is an independent buyer-specific engineering candidate for the still-active [KZFR website redesign RFP](https://kzfr.org/RFP). It is not an official KZFR product or agency bid.

**Primary source:** [original KZFR RFP plus September 2, 2026 Addendum 01](https://media.kzfr.org/file/KZFR_Website_Redesign_RFP_09.02.2026.pdf). The addendum clarifies a **$12,000 base budget**, US-based eligible bidders, Northern California preference, and the continuing use of **Creek Studio** for live audio, archives, schedules and radio-specific data. Official PDF proposals are due **Friday, October 16, 2026, 5:00 p.m. Pacific**. RFP calls for a WordPress-core build, WCAG 2.1 AA, mobile responsiveness, load time under three seconds, secure/updatable WordPress and PHP, SEO, content migration, staff training/documentation and post-launch support. The station retains code and design ownership. Any bid needs three comparable past projects, references, phased price, timeline and seven-day KZFR feedback windows; this source does not assert these business gates have been satisfied.

## Deliverable

- `theme/kzfr-community-radio/`: installable **Twenty Twenty-One classic WordPress core-theme child**. Includes required `style.css` header and `index.php`, specialized front page, program/genre/archive search, future event calendar, underwriter directory, WordPress pages/posts, accessible responsive nav, approved outgoing Creek provider links, existing KZFR donation provider handoff and program detail templates. Style is based on the independently authored browser concept merged in [public PR #595](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/595).
- `plugin/kzfr-editorial-bridge/`: independent **companion plugin** registers three WordPress-native, REST-discoverable post types (`kzfr_program`, `kzfr_event`, `kzfr_underwriter`), a hierarchical `kzfr_genre` taxonomy, and explicit sanitized post metadata. Using a plugin keeps the content model portable if the theme changes later. Program audio URLs are limited to HTTPS links on the *existing* `kzfr.studio.creek.org` host. This code never fetches or mirrors Creek audio.
- `tests/wp-bridge-smoke.php`: one focused runnable PHP harness that loads the **actual production plugin and theme functions** under minimal WordPress function stubs, and verifies content registration, REST readiness, metadata, trusted-provider outbound links, editor permissions and valid event dates. It does not pretend to replace a real WordPress runtime.

## Installation on an owner-controlled WordPress staging system

1. Back up an **authorized existing** installation and inventory the existing WordPress/PHP version, plugins, old URLs, user roles, uploads, SEO redirects, archives, accessibility and performance. Never install this directly on KZFR production without permission.
2. Install/confirm the official **Twenty Twenty-One** WordPress core parent theme (`twentytwentyone`) from trusted WordPress distribution. Keep it updated; the candidate is a child theme that needs this parent available. Then upload `kzfr-editorial-bridge.zip` under **Plugins → Add New → Upload Plugin**, activate, and confirm editor-visible *Programs*, *Community Events*, *Underwriters* and *Program Genres*. The plugin registers its own rewrite URLs and flushes on activation.
3. Upload `kzfr-community-radio.zip` under **Appearance → Themes → Add New → Upload Theme**, activate on staging, configure a primary menu, check permalink structure, and assign an approved front page. The theme does not create donor, streaming or user accounts.
4. Create sample *draft* program/event/underwriter records that accurately reflect owner-provided material. For programs, editor may set registered custom field `kzfr_creek_url` to an approved `https://kzfr.studio.creek.org/...` URL; for events use `kzfr_event_date` ISO `YYYY-MM-DD`; for underwriters use `kzfr_underwriter_site` as HTTPS. In Block Editor, enable Custom Fields if hidden or use the REST API with normal WordPress editorial authorization. Publish only verified source material and approval.
5. Confirm templates at `/programs/`, `/events/`, `/underwriters/`; test search/genre/date/pagination on real owner-authorized source entries. Check external links open with `noopener noreferrer`, navigation works with keyboard and narrow-screen menu, screen readers announce status/labels, and no payment/audio data is fetched locally.
6. Do not put this on live infrastructure until formal UAT, WAVE/axe/manual WCAG 2.1 AA inspection, cross-browser and real-device review, measured under-3-second pages, real backups/restore tests, WordPress/PHP security updates and authorized staff handover are complete. A successful theme install is not a full RFP acceptance.

## Source-exact acceptance map and remaining work

| Buyer requirement | Evidence delivered | Remaining authorization/acceptance |
|---|---|---|
| WordPress core | Native classic theme, WP_Query, plugin-registered CPTs/taxonomy/REST meta | Install against actual owner-authorized WordPress; migration, upgrades and backup jobs |
| Creek Studio streaming/archive/schedule retained | Existing approved Creek outbound link only, no custom radio backend | Obtain documented Creek API/embeds or approved data export; integrate and verify actual schedules, playlists, player, archive category/program/**broadcast date** filters. The current WP archive filters editorial **publication dates**, *not* Creek broadcast dates |
| Mobile responsive / WCAG 2.1 AA | Responsive source CSS, semantic forms, navigation status, skip link, visible focus and reduced motion | Real WCAG audit, 200% zoom, keyboard/screen-reader rounds and buyer sign-off |
| Community, events and underwriters | Editor-owned searchable programs, forthcoming event pages, underwriter posts | Approved data migration and content governance |
| Donations | External provider link, no sensitive form in theme | Owner-confirm URL and handoff analytics; no payment processor implementation |
| Performance <3s, cross-browser and SEO | No unnecessary CSS/JS dependencies; built-in WordPress title and semantic headings | Actual hosted measurements, SEO redirects, accessibility/browser regressions |
| Security, ownership and sustainability | WordPress APIs/sanitization, explicit metadata auth, license header, content model isolated from theme | Real operational patch plan, role audit, backups, code/design deliverable agreement and owner signoff |
| 6 RFP phases, $12k budget | Engineering templates source maps discovery/UX/build/QA/training plus separately optional post-launch enhancements | Vendor approval, references, phase-based priced schedule and KZFR review windows; no quote sent |

**Commercial caution:** no source code or static screen proves bidder geography, comparable references, contracted price, KZFR endorsement, WordPress production readiness, official Creek API compatibility, WCAG conformance or recipient consent. Do not call this a submitted or accepted proposal. The user has held external outreach and Michael contact to human-approved channels.

## Narrow reproducible validation

```bash
find . -type f -name '*.php' -exec php -l '{}' \;
php tests/wp-bridge-smoke.php
```

No hosted Actions, full repository test suites, real donations, authentication, website scraping of protected material or client submissions were executed. Target runtime is WordPress >=6.3, PHP >=8.0, and the official Twenty Twenty-One parent. Its actual parent-child stylesheet integration and staging rendering have not been exercised. WordPress core parent dependency satisfies the RFP’s request to utilize existing core/popular themes, subject to client approval. Site performance and rendered WCAG remain unmeasured. License headers are provided for source portability, not a claim of third-party approval.
