# Oregon DEQ built-material tracing: conditional independent source-evidence QA

**Opportunity:** Oregon Department of Environmental Quality / OregonBuys `S-34000-00018168`, posted October 8, 2026; clarification questions October 14 at **4 PM Pacific**; responses October 21 at **4 PM Pacific**. Official notice: https://oregonbuys.gov/bso/external/bidDetail.sda?docId=S-34000-00018168&external=true&parentUrl=close . Public listing with linked issuer PDF: https://www.lightrfp.com/marketplace/bid/OREGON_BUYS-S-34000-00018168/built-environment-material-supply-chain-and-life-cycle-tracing . The $250,000 single-award amount and one-year renewable term come from the latter secondary transcription, **not** independently verified against the original attached PDF. Neither TJLabs nor this code is an eligible standalone SaaS prime.

## Actual buyer-to-capable-prime routing

DEQ wants **existing secure commercial SaaS** that maps raw resources through suppliers, manufacturing and distribution into Oregon for up to ~100 building-material products, plus social/environmental risk intelligence, exports/APIs, onboarding and support. We sell only a **separate independent, scoped mapping-data QA workshare** to an eligible platform operator, if the operator actually wants/approves it. No finished platform, official proposal, contract, confirmed interested vendor, real material map, grant application, or supplier certification is represented here.

| Candidate qualified for conversation, not procurement-approved | First-party capability seen | Questions before routing |
|---|---|---|
| **Sourcemap**, primary technical fit to evaluate | Company describes BOM/part-level tier-N mapping from extraction through processing, material-specific steel/aluminum/copper lineage and evidence-backed transaction traceability. https://www.sourcemap.com/ and https://www.sourcemap.com/technology/transaction-traceability | Does the current offered SKU cover Oregon-specific built materials and up to ~100 products, weekday 24h response, required data exports, insurance, security and a feasible prime/subcontract? |
| **Prewave**, alternative for broad risk intelligence | Public Tier-N supplier mapping through raw-material origins, ESG/regulatory signals and supplier-network graph. https://wp.prewave.com/platform/risk-intelligence/multi-tier-visibility | Can it map **product-specific physical material paths**, not merely inferred company links, and produce provenance-bearing per-product exports to DEQ? |
| **Resilinc**, alternative supply graph | Company multi-tier solution reports raw-material/commodity drilldown, supplier/site/part visibility and API/ETL distribution. https://resource.resilinc.com/rs/863-OTG-034/images/Multi%20Tier%20Mapping.pdf | Does present SaaS specifically map Oregon inputs and satisfy social-risk, support, implementation and prime qualifications? |

**Complement, not prime substitute:** Building Transparency's EC3 provides environmental product declarations and material carbon comparisons, not automatically full multi-tier supply chain/facility/risk mapping; https://www.buildingtransparency.org/tools/ec3/ . The above are **candidate** companies, not consenting partners. Original buyer discovery/custody lives in private https://github.com/woahwhattheheck/commons/issues/33089; contact decisions stay with that owner. The procurement's single-point-of-contact rule applies to DEQ solicitation questions. No other team member should independently contact the agency.

## Shipped executable acceptance aid

`audit.mjs` is dependency-free Node.js 22+ and accepts an authorized platform operator's **offline export**, transformed by that operator into `oregon-deq.trace-evidence.v1`. It audits graph connectivity from an Oregon-market destination backward to raw-material extraction, requiring source-record provenance on each link; it then checks whether *five* environmental/social risk categories each have a recent, non-unknown assessment on every node of the selected path. It does not infer 'no risk' from absence, misstate undocumented upstream chains as verified, perform DNS or network access, or receive private supplier data on our public repository.

```
node audit.mjs /path/to/operator-export.json --max-age-days=180
node --test test/audit.test.mjs
```

`audit.mjs` writes JSON, with `inputSha256` binding to the original input bytes, and exits `0` only for `PASS_EVIDENCE_SHAPE`, `1` for legitimate `REVIEW_REQUIRED`, `2` for invalid input. The default **180 days is a proposed QA freshness policy, not a contractual Oregon DEQ mandate.** Actual vendor diligence, license permissions, source authenticity, data rights, confidence, full RFP eligibility and support remain separate owner/prime approvals.

Example adapter contract (not claims about actual product flows):

```json
{
  "schema": "oregon-deq.trace-evidence.v1",
  "asOf": "2026-10-10T12:00:00Z",
  "products": [{"id":"sample-steel","name":"DEMO ONLY: steel","destinationNode":"oregon-market-1"}],
  "nodes": [{"id":"extraction-1","stage":"extraction"},{"id":"oregon-market-1","stage":"oregon-market"}],
  "links": [{"id":"link-1","productId":"sample-steel","from":"extraction-1","to":"oregon-market-1","evidence":[{"source":"example-document-id","observedAt":"2026-10-09T12:00:00Z"}]}],
  "risks": []
}
```

That illustrative example *intentionally yields REVIEW_REQUIRED* because it omits the five risk assessment categories for both nodes. Test code separately builds a complete, wholly DEMO-only shape. Source record strings are pointers and do **not** authenticate the alleged documents. It is a triage aid for an eligible prime's real export, not a certification or 1:1 simulation of Oregon's entire eventual contract.

## Commercial conversion

See `CONDITIONAL_PAID_WORKSHARE.md` for an approval-ready and time-gated **five-product** paid pilot, vendor qualification gates, acceptance artifacts and clear founder/relationship ownership. All financial figures are our proposal hypotheses, never buyer allocations, quoted/accepted offers, invoices or cash.

Work claim/route: https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791625034018919 . This adds an executable workshare capability to existing lead #33089 without replacing its owner, bidding, contacting anyone, or scheduling CI.
