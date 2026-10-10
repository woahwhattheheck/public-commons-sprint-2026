# KZFR 90.1 FM | independent website concept and integration acceptance kit

**Purpose:** an interactive, brand-inspired **UNOFFICIAL concept** for the station's 2026 public website redesign procurement. Not a buyer-approved design, WordPress implementation, Creek Studio integration, proposal, vendor qualification, or live audio service. No contact, payment, external submission, or hosted Actions performed.

**Open locally:** serve this directory through a basic static server (e.g. `python3 -m http.server 8000`, then open `http://127.0.0.1:8000/`). ES modules require an HTTP origin in many browsers. `index.html` contains accessible navigation, responsive sections, sample archive search by program/category/date, official archive/stream/donation handoffs, and a reduced-motion mode. Archive entries are explicitly synthetic demonstration fixtures, never station data. The UI does not fetch any provider data or handle payments.

## First-party requirements and trace

Original issuer source: [KZFR's RFP and September 2 Addendum](https://media.kzfr.org/file/KZFR_Website_Redesign_RFP_09.02.2026.pdf), accessible from [KZFR's official RFP page](https://kzfr.org/RFP), consulted October 10, 2026. Nine-page issuer PDF plus 2-page Addendum No. 01 in same supplied source. It says:

| Requirement / gate | What is here | Still necessary for a production implementation |
| --- | --- | --- |
| WordPress core is **required**; existing PHP/WordPress are outdated (RFP p4-6) | HTML/CSS/ES-module component concept; CMS-independent preview | Build approved WordPress theme/templates, maintained PHP and WordPress, secure auto-updates, backups, controlled plugin policy and admin roles |
| Live/archived programs and schedules use **existing Creek Studio** (Addendum §3) | Opens first-party station and existing Creek archive; example filter UX | Authorized Creek embed/API contract, exact endpoint/metadata schema, CSP frame/audio policy, episode deep-link mapping, auth/origin handling and public demo with actual data |
| Archive filter by **program, date, category**; mobile playback (RFP p6) | Source-local sample content search with category/date controls, keyboard accessible | Connect actual catalog response and replay-player controls; provenance, data ownership and caching to agree with KZFR and Creek |
| Accessibility **WCAG 2.1 AA** (RFP p5); response under **3 seconds** (p6) | Semantic headings, labels, skip link, focus styles, live region, reduced motion, responsive design | Formal keyboard/screen-reader/mobile audit, actual WordPress/Lighthouse performance on buyer-approved hosting, contrast audit across final KZFR brand palette |
| Community events, donations, underwriting, volunteer pathways (p4-6) | Top-level journeys and external official donation URL | Production event calendar, buyer-approved copy, configured official URLs and workflows, privacy/security review |
| Staff training, documentation, post-launch support (p6-7) | Handoff/acceptance matrix below | Training for roles, editable source/design files, runbooks, support SOW and agreed support period |
| Owner retains **website/code/design** (p4) | Source published for inspection under repository terms | Contractually transfer deliverables, credentials/hosting authority, licenses and IP as approved by buyer |
| $12,000 core development budget (Addendum §1) | Scope strategy avoids rewriting Creek backend | Qualified bidder must determine exact priced scope and submit phase-itemized quote that fits budget; extras separately listed |
| US-based qualified vendors only; Northern CA preference (Addendum §2) | No vendor representation | Verify actual bidder entity/location and qualified workshare partners before bid |
| Three similar projects and professional references (RFP p7) | No invented case studies or references | Named, verifiable references and evidence of deliverables with permission |
| Seven-day KZFR response time between reviews (RFP p7) | Proposed owner timeline treats reviews as gates | Staff-confirmed capacity/schedule, signoff ownership and change controls |

**Proposal deadline:** Friday, October 16, 2026, **5 p.m. Pacific**, submitted by vendor as a **PDF by email** to the official issuer address. Selection target December 1, start January 4, 2027. The question deadline September 18 has passed. This repo is **not a submission**.

## Demo workflow and acceptance checks

1. At desktop and mobile widths, primary routes reach Listen, Archives, Programs, Community, Support, with keyboard-accessible skip/menu.
2. Archive search for `Chico` shows a single example; category `music` shows two; date `past 7 days` limits to current demo-window examples. Clearing all filters returns all fixtures. On a later date, fixed fixtures naturally age out.
3. Every example card makes the distinction between illustrative content and real Creek archives explicit. There are no synthetic playback buttons claiming radio service.
4. All donation requests leave this site to the existing official KZFR Creek-donation provider. Nothing collects donor details.
5. Auditors should replace placeholders with approved real data only after API/security/content agreements, then measure actual WordPress load time/accessibility on supported devices.

Focused source check: `node --test test.mjs` tests archive filter semantics only. No broad suites or hosted CI. Static chromium screenshot is possible without hosted runners.

## Price and effort strategy, **not an offer**

Issuer allocation is **$12,000**. One internal *illustrative* phase allocation to test feasibility, **not a vendor quote**, is discovery & sitemap $1,400; UI design and two approval rounds $2,600; WordPress build, Creek presentation integration and tightly bounded content migration $5,200; browser, accessibility and performance acceptance $1,600; staff training, documentation and limited support handoff $1,200. **Total $12,000**, with additional features excluded or separately estimated. The third-party radio backend is **not** reimplemented.

Critical before any pricing commitment: audit actual WordPress page/template count, old PHP/plugin estate, migration/export size, media and archive integration restrictions, supplied design assets, Creek embedding method, dedicated donation processing boundaries, hosting and accessibility acceptance matrix. Fit and schedule can only be calculated from that inventory; do not assume this estimate is executable as-is.

## Buyer-agnostic owner handoff

Original procurement/relationship owner retains KZFR bidder eligibility, reference verification, approval and contact. Engineering owner may build source-exact WordPress adaptation only after the buyer/prime confirms rights, API documentation and scope. Nothing here should be sent to Michael Clark or used as an indirect contact relay without a new explicit owner authorization.