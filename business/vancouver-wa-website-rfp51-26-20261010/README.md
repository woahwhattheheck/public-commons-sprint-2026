# Vancouver, Washington · RFP 51-26 · buyer-to-paid-workshare kit

**Original government buyer opportunity, not an existing contract or agency endorsement.** Discovery on 2026-10-10: City of Vancouver, **Washington**, not Oregon. City's [Procurement Services](https://www.cityofvancouver.us/business/procurement-services/) switched to SOVRA/BidNet effective October 1, 2026 and links to the [city's procurement buyer page](https://www.bidnetdirect.com/washington/cityofvancouver). Its actual live [RFP 51-26 listing, platform record 0000439564](https://www.bidnetdirect.com/washington/solicitations/open-bids/Website-Redesign-Content-Migration-Build-Out-and-Support/0000439564) gives the title **Website Redesign, Content Migration, Build Out and Support**, published **2026-10-09** and closing **2026-11-04 at 4:00 p.m. PST**. Original specifications, detailed buyer contact, amendable terms and documents are behind vendor sign-in. This packet does not assume protected details or register/bid. The third-party RFPPlanet WDDS-0661 wrongly labels the same `cityofvancouver.us` buyer as Oregon; the City is Washington.

## Buyer-specific original technical baseline (real observed public pages)

The five original URLs in [`baseline.json`](baseline.json) were fetched on October 10 via the first-party city domain. The sampled pages are resident homepage, procurement, calendar, financial reports and ADA transition plan. They exposed 367 **distinct links across those five pages**, including 60 distinct linked PDFs and 37 distinct off-city hrefs. These are *sample statistics*, **not** a census of the entire website, pages or forms, or requirements from the inaccessible bid PDF.

The original site has live links to **SelectPay utility payment, T2 parking, RelayView permits, CivilSpace engagement, ArcGIS maps, CivicClerk agendas, Municode and current BidNet procurement**. These are actual cross-service boundaries that a migration can strand, and cannot be replaced with local fake payment screens. The procurement page still has old Bonfire links in global navigation while its body points vendors to SOVRA/BidNet as of October 1; the project should define authoritative redirects and help copy, not assume this was intentionally deprecated. Financial archives include multilingual vendor handbook PDFs and years of quarterly fiscal reports. Each route and critical original outbound URL has a direct source link in the JSON manifest.

## Run the actual preflight locally (Node 22+, zero packages)

Offline source/acceptance plan: `node business/vancouver-wa-website-rfp51-26-20261010/acceptance.mjs --plan`

Against an authorized, owner-controlled staging or public site (exactly five GETs; no follow redirects or external services):

```sh
node business/vancouver-wa-website-rfp51-26-20261010/acceptance.mjs \
  --target-base https://owner-approved-migration-staging.example/ \
  --out /tmp/vancouver-wa-qa-result.json
```

The tool checks actual HTML status, language/main/H1 presence, form/PDF link counts and **original external href preservation** on five known source paths. Missing or intentionally relocated links become an explicit owner-review result, not a fabricated defect. An owner must separately conduct screenreader/keyboard/WCAG review, actual PDF remediation, sitemap/redirect diff, form/SSO/records retention testing, GIS/meeting interface browser testing, real third-party handoffs and acceptance. Every production action is read-only HTTP GET. It does not certify WCAG, RFP compliance or formal agency acceptance. Do not call it with a private authenticated URL or secrets.

## Actual paid workshare concept for a qualified prime (not a submitted price)

**Product:** independently deliverable public-sector *migration + cross-service + accessibility acceptance* evidence. A real qualified bidder/prime contracts with the City and supplies needed reference projects, coverage, insurance, deployment and project delivery. Commons' proposed separable subcontract would:

1. **Baseline and risk register:** primary-routes and PDF sample, existing canonical URLs, external dependencies, critical resident paths, source archived with date and SHA-256. Deliver a prioritized risk/redirect matrix. Example internal planning amount: **$900** for nine scoped hours at $100/hour.
2. **Migration parity and integration:** run these original GET probes on owner-authorized staging, expand to a **jointly agreed** sample of 25 high-value routes, 20 documents, eight external services, and validate 404s, redirects, internal discovery, anchor text and preservation of external handoffs. Deliver machine JSON and corrective issue ledger. Internal assumption **$1,200** for twelve hours at $100/hour.
3. **Accessibility and acceptance assistance:** focused keyboard/zoom and screenreader-informed review of ten agreed templates/flows, manual contrast/labels audit, issue-severity log and retest of remediated critical flows with owner. Internal assumption **$900** for nine hours at $100/hour.

**Internal hypothetical total: $3,000 / 30 hours**; NOT the City budget, bid, contract or an offer to anyone. It explicitly excludes actual third-party processor/API integration, full 700-page inventory, formal accessibility certification, hosting, security warranty, insurance, content replacement, direct agency submission, and continued support. If the official RFP mandates incompatible requirements, change or abandon this workshare. Payment should be tied to prime-approved milestone acceptance, ownership, invoice and signature, never submission alone.

## Partner fit and next actual commercial decisions

[**CivicPlus**](https://www.civicplus.com/case-studies/cxp/civicplus-partnership-steilacoom-wa-innovation/) publicly shows a Steilacoom, Washington municipal websites/accessibility redesign and [Stevenson, Washington civic systems](https://www.civicplus.com/case-studies/am/stevenson-wa/) experience. It is an **evidence-supported prospective prime**, not a known Vancouver bidder, consenting partner or willing buyer. Existing #sales owners also hold a separate Lake Oswego CivicPlus introduction, so check those send/draft rights and avoid duplicating. Another prime may be better based on the official specifications.

The commercial owner should get the genuine RFP 51-26 amendments and minimum qualifications from a legitimately registered prime; confirm if subcontracting is allowed and identify a suitable existing bidder; verify three relevant references, partner fees/margins, region/team capacity and accepted QA SOW; then make *one* owner-authorized non-Michael business introduction. No contact, registration, quote, application, portal submission or payment was made as part of this kit. Original #sales claim and source link posted October 10, 2026.
