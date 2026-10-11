# CSKT DEWR first-party content migration preflight

**Non-bounty, independent source-based work for the public October 2026 CSKT DEWR website redesign RFP.** This is an initial **seven-resource observed slice**, not a full crawl, customer staging deployment, accepted content inventory, functional ArcGIS site, customer proposal or tribal certification assertion.

Official buyer procurement and controlling RFP:
- https://csktwatercompact.com/documents-and-links/
- https://csktwatercompact.com/wp-content/uploads/2026/10/DEWR_Website_RFP_Final.pdf

## What is in the tool

- `observed-public-content.json`: seven observed *real current buyer-published page/PDF URLs* and one resolved first-party StoryMap link, with dated evidence sections and **proposed, not applied** destination paths.
- `preflight.mjs`: pure Node.js 22, dependency-free, offline transformation of first-party source observations into a machine-readable inventory, requested redirect queue, GIS integration queue, source status discrepancies and approval gates.
- `preflight-report.json`: executed output with 7 inventoried URLs, 7 pending proposed redirects, one source-status conflict and one existing StoryMap integration item.

## Exact observed content inconsistency

The [current homepage](https://csktwatercompact.com/) lists Jocko Valley Canal Pipeline Phases 1–4 among **Completed** projects. The [project detail](https://csktwatercompact.com/jocko-pipelines/) currently still describes Phases 1–2 and 3–4 as under construction, with substantial completion due April 2026. The buyer's [July project PDF](https://csktwatercompact.com/wp-content/uploads/2026/07/Pipeline_poster_final_May12_JPEG.pdf) independently says Phases 1–4 completed in spring 2026. Thus migrating whichever text is most convenient will carry a real content-status inconsistency into the rebuild. **The official DEWR content owner must decide which text is current before migrating.** No automated overwrite/redirect is performed.

The [Jocko Pipeline story](https://csktwatercompact.com/jocko-pipelines/) already links to an existing [ArcGIS StoryMap](https://storymaps.arcgis.com/stories/2255c33442fd4f349aef25cba515ed78). The workshare is to integrate the **already published buyer-owned GIS content**, not build unrelated new mapping, and to confirm content rights, access and text equivalents. The [environmental documents hub](https://csktwatercompact.com/north-fork-jocko-tabor-diversion/) already has five named source attachments, requiring a lossless document migration/redirect plan.

## Run (one focused first-party observation pass)

```bash
node preflight.mjs observed-public-content.json preflight-report.json
```

This command ran on local Linux Node 22.16.0: `observedPages=7; proposedRedirects=7; inconsistencies=1; knownGISLinks=1`. **No hosted Actions or billable network services.** The script never issues an HTTP request, changes the original website or publishes a redirect. To consume a true full-site scrape later, replace the JSON observations from the customer-approved WordPress CMS export and rerun without changing the contract.

## Actual path to production

1. Get from the owner a complete original URL/PDF/GIS-public-item export with source timestamps and content approval rights, not a hypothetical item count.
2. Reconcile the one observed status conflict and all original URL disposition choices. Preserve procurement PDFs and historical links.
3. Qualified prime confirms staff roles, actual three recent customer references, scope, budget and any **CSKT IPO certification**, if asserting preference (self-described Native ownership is not equivalent).
4. In a permissioned CMS staging site, build importer, backups, accessible document remediation, approved redirects and StoryMap interactions with accessible fallback.
5. Return source/evidence and acceptance record to owner. Buyer retains domain, admin accounts, content, analytics and source, per RFP §5.13. Price/warranty via real prime agreement, not assumed RFP dollars.

This source is an engineering handoff to the qualified commercial owner. No contact has been made with the buyer, partners or Michael Clark.