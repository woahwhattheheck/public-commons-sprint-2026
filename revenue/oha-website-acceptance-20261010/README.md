# OHA website cutover acceptance — runnable independent QA wedge

Non-bounty, public, dependency-free Node 22 utility. Original source-to-source website migration QA. One potential *prime workshare* for Orlando Housing Authority **RFP FYE27-4414**, not a claim that TJLabs is prime, that any partner has hired us, or that the site has been audited. `PARTNER_PACKET.md` pins buyer, partner, timing and proposed payable scope.

## The executable

```sh
node --test revenue/oha-website-acceptance-20261010/acceptance.test.mjs
node revenue/oha-website-acceptance-20261010/acceptance.mjs BEFORE.json AFTER.json > release-gate.json
```

Pass **two genuine documented snapshots** from the same scope: source live OHA public site versus a contractor's candidate/staging public or permitted site. The utility makes **no HTTP requests**, does **not** log in, capture resident data, send payments or require a GitHub Action. A snapshot has `origin` (the public HTTPS website root); `pages` rows with exact `path`, measured `status`, `h1Count`, `imagesWithoutAlt`; and `actions` rows `{id,href}` for *named critical business actions* (e.g., apply, existing pay-rent, landlord portal). If the candidate is a temporary HTTPS origin, its same-path internal action is normalized to the source path; third-party endpoints must remain unchanged unless separately authorized. Do not insert session tokens, private APIs, personal data, resident records, or authentication traces. Pages and actions **must be measured from each real environment** by their authorized operator; empty/fictional manifests are not acceptance results.

`BLOCKER` for dropped baseline pages, HTTP 200→4xx/5xx, missing critical portal actions, or changes in critical destinations. `REVIEW` for newly lost first-level headings or additional images missing alt text. Dated raw snapshot SHA-256 hashes in JSON output bind the exact inputs. CLI exit 0 means *preliminary PASS* or *review required with zero BLOCKERS*; exit 1 means HOLD due to blocker; exit 2 invalid input. Neither status means ADA/WCAG compliance, browser/render fidelity, form submission, payment correctness, hosting SLA, security certification, or bid acceptance. Those require separate actual qualified human/browser tests and written acceptance.

## Expected delivery gates

1. Prime supplies documented, permissioned, source+candidate snapshots with identical route/action ID scope; TJLabs baselines and SHA-256 binds both. Use actual redirect destinations, not guesses.
2. Run the original comparator, resolve all blockers or gain written prime/owner waiver to remove a deliberately retired URL from the required baseline.
3. Independently assess live cross-browser behavior (Chrome, Firefox, Edge), keyboard/screenreader form paths, documents, tenancy/landlord navigation, mobile use, and approved payment portal redirect without transmitting funds. These are **human acceptance checklists**, not covered by the offline comparator.
4. Produce source-linked defect matrix, before/after evidence, retest and signed handoff to prime. Buyer acceptance and payment require an actual executed subcontract/SOW, and original prime is responsible for the agency sealed bid and all issuer procurement compliance.

## Source and rights

Orlando Housing Authority posts the buyer's current RFP channel at https://www.orlandohousing.org/bids-rfps. Current first-party distribution: https://www.demandstar.com/app/limited/bids/551450/details (RFP-FYE27-4414, Addendum #1 dated Oct 1, 2026). The OHA itself published the 2020 Brooks Jeffrey original award at https://www.orlandohousing.org/news_event?id=17 and currently credits the firm at https://www.orlandohousing.org/copycred. Brooks Jeffrey's own https://www.bjmweb.com/portfolio.php?id=37 lists Orlando Housing Authority among its housing agency websites. This establishes *historical incumbent/client fit only*, **not** 2026 RFP incumbent award, interest, capacity, qualification, an authority to contact, or any money received. No OHA website copyrighted content is reproduced; only field-level QA structure.
