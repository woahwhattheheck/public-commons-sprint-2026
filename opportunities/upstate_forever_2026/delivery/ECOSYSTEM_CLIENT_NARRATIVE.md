# Upper Savannah source-water mapping: delivery approach

Prepared for Ecosystem Sciences' internal proposal and client-report work, October 12-13, 2026.

## Purpose

Upstate Forever seeks a practical way to identify land that is important to drinking-water protection and land with high current nutrient and sediment exports in the South Carolina Upper Savannah River Basin. The work replaces part of its earlier Critical Lands Mapping and supports the broader Emerging Contaminants in Small or Disadvantaged Communities program. The RFP calls for seven map families, the associated GIS data and metadata, a clear final report, and the final and working files. [1, PDF pp. 1-3]

The proposed engineering workshare gives Ecosystem Sciences one repeatable source-to-delivery workflow. It retains original data, prepares the selected model grid and parameters, runs the original scientific models, compares explicit alternatives, prepares the maps and quantitative review material, and hands over the complete project that the receiving operator can reopen. Ecosystem Sciences contributes its scientific interpretation, project-specific choices, client context and prime-contractor delivery.

## Proposal narrative: technical approach

We will organize the study around two decisions. The first is where land protection can avoid a disproportionately large increase in pollutant delivery under a defined development or disturbance scenario. The second is where restoration or land-management work can address current nitrogen, phosphorus and sediment exports. These questions share a source inventory and modeling workflow while retaining their distinct baseline, scenario and interpretation.

The study will retain the South Carolina Upper Savannah reporting boundary separately from the hydrologic modeling domain. Upstream contributing land and the required context outside the reporting basin will be included in model preparation. Final maps may display the reporting area, while the working files preserve the larger model domain and the source of each geographic selection. The RFP specifies 30 m by 30 m raster data and allows the model buffer to be masked from the publication maps. [1, PDF p. 2]

The source inventory will record the selected editions of land cover, protected lands, parcel data, hydrography, precipitation, rainfall erosivity, soil erodibility, terrain and wetlands. Each preparation step will preserve the original source and an explicit analysis derivative. The selected projected land-cover grid will govern alignment so that current and alternative outputs can be compared on the same geographic framework.

The original InVEST Nutrient Delivery Ratio and Sediment Delivery Ratio engines provide the maintained modeling route in the current application. The final scientific profile will retain its parameter values and literature or project-specific lineage. Explicit land-cover alternatives will preserve the affected source polygons, original and replacement classes, selected profile, model arguments and run identity. The product can retain and compare the full selected alternative set in subsequent editions.

Current exports will be delivered as physical annual-mass rasters: kilograms per pixel per year for nitrogen and phosphorus and metric tonnes per pixel per year for sediment. Current totals in the report will reuse the recorded reporting-mask quantities. Scenario change will be alternative minus baseline over the shared valid cells, with the support count and interpretation carried into the report. This gives the prime an exact connection between the map, the physical quantity and the scenario that produced it.

The combined pollutant map will expose its normalization and decision weights. The accompanying individual pollutant layers and quantitative tables preserve the physical quantities needed to explain the combined priority. Source-water overlays, high-quality-water designations and protected-land records will retain their original identifiers and meanings.

The final publication set will contain the seven map families, high-resolution PDFs with the required map furniture, physical GIS layers, source and method metadata consistent with the RFP's FGDC-endorsed standards requirement, a thorough report written for a general reader, and the complete final and working files. The same project will support the final presentation and the receiving operator's handover. [1, PDF pp. 2-3]

## The seven-map decision guide

| Map family | Decision supported | Explanation carried into the report |
| --- | --- | --- |
| Future sediment loss | Where a defined disturbance would increase sediment delivery | Name the alternative, display signed change from the saved baseline and preserve the common comparison support. |
| Future nutrient runoff | Where a defined land-cover change would increase nutrient delivery | Explain nitrogen and phosphorus separately with their physical units and the actual change polygons. |
| Critical drinking-water protection | Which protection and restoration opportunities relate to the selected source-water areas | Connect physical exports and scenario response to the retained utility/source-water geography. |
| High-quality water resources | Which lands relate to the selected high-quality-water features | Preserve the designation source, feature identity and spatial relationship or analysis buffer. |
| Current nutrient exports | Where current nitrogen and phosphorus delivery is greatest | Show annual physical export per valid 30 m cell and the current reporting totals. |
| Current sediment export | Where current sediment delivery is greatest | Show annual metric tonnes per valid 30 m cell and the selected terrain, rainfall, soil and land-cover context. |
| Combined pollutant priority | How areas compare under the selected planning weights | Explain the dimensionless index, normalization and weights alongside the three physical pollutant layers. |

These map families follow the minimum list in the RFP. The future scenario views and associated map files can contain every alternative selected for that delivery edition. [1, PDF p. 2; 2]

## From modeled outputs to conservation work

The operator starts by selecting a current-export map and identifying the management question. It then compares a defined alternative against the retained baseline, reads the signed physical change and shared support, and checks the relevant source-water or high-quality-water context. The same identifiers remain visible in the report and the working project.

A parcel review converts that landscape-scale question into a specific source record. The complete inventory carries original parcel identifiers, modeled quantities, protected-area overlap, source-water context and coverage. The report's shortlist exposes the compact priority fields and points to the complete CSV and GeoPackage for the physical results. Where a parcel source covers only part of the reporting basin, the report states the actual footprint and represented fraction.

Current annual totals and scenario changes answer different questions. Each current or alternative total represents that run's valid reporting cells. The paired change represents cells that are valid in both compared outputs. A percentage reduction is used when the paired support equals both complete supports and the saved baseline is positive. Reading quantity and support together makes the comparison useful for scientific interpretation and practical site review.

The resulting parcel decision can therefore be expressed in a complete sentence: identify the original parcel, describe the source-water or designated-water relationship, state the current export context, explain the actual alternative and its modeled change, and record the land-protection or restoration action being considered. The source files, scenario selections and quantitative tables support that explanation.

## How the final report explains the science

The current reporting module replaces long inline JSON paragraphs with a clear reading sequence: purpose, study selections, current annual quantities, alternatives, the seven-map guide, planning priorities, parcel coverage, methods, observations, source lineage and receiving. It produces the publication PDF and editable HTML, Markdown and structured report model from the same retained objects.

The report describes the modeled processes in ordinary language. Nutrient modeling represents annual loading, retention and delivery under the selected land-cover and runoff assumptions. Sediment modeling represents overland erosion and sediment delivery under the selected terrain, rainfall erosivity, soil erodibility and land-management factors. Channel-bank erosion, mass wasting, in-stream and reservoir processes, point sources and impoundment effects receive their own scientific interpretation alongside those represented processes.

Original monitoring results keep their measurement meaning. E. coli, cyanotoxin, concentration and other field or laboratory results retain their source, station, unit, catchment and period. Qualified annual nutrient or sediment loads can be compared with the corresponding modeled annual quantities. The report carries that relationship in its observation-comparison table.

The RFP appendix describes the broader utility partnership and investigative sampling program. Its additional in-stream sampling sites provide project context and potential observation inputs; the mapping contract's stated minimum outputs remain the seven maps, GIS and metadata, report and working-file delivery. [1, PDF pp. 2-3, 6-9]

## Utility and community context

The appendix describes work with Anderson Regional Joint Water System and Pioneer Rural Water District around source waters that flow into Lake Hartwell. It identifies approximately 210,000 residents served by ARJWS and 7,000 by PRWD. These utility-service populations describe the systems' reach. [1, PDF p. 6]

Appendix Table 1 separately reports 27,448 residents across the listed source-watershed census block groups. Those whole-block-group counts, household figures and income comparisons provide geographic and socioeconomic context for the source-water work. They should retain their block-group, watershed and utility labels when used in an analysis or report. The utility service totals and the listed block-group total describe different populations. [1, PDF p. 16]

The maps connect upstream land-management questions to these source-water concerns. A later quantified economic or beneficiary analysis can use the actual utility, community, treatment-cost and geographic evidence appropriate to that analysis, preserving its own measurement and geographic basis.

## Delivery sequence within the prime's project

The existing proposed workshare provides 30 business days of active engineering arranged around the prime's review and project-specific input schedule. It includes source/method setup, the modeled review release, consolidated correction and the independent receiving handover. The complete final RFP deliverables are due November 1, 2027. [1, PDF pp. 2-3; 3]

| Engineering period | Delivered result | Prime's contribution at that point |
| --- | --- | --- |
| Active days 1-10 | Retained source inventory, geographic selections, aligned inputs, selected parameter profile and an openable initial study | Scientific study extent, decision questions, source/profile/scenario choices and project-specific input context |
| Active days 11-25 | Original baseline and the commercially selected alternatives; physical outputs, comparisons, parcel/context review and complete draft maps/report | Consolidated scientific, cartographic and client interpretation |
| Active days 26-30 | Agreed correction, final editable report and GIS material, complete working archive and receiving copy | Receiving operator, consolidated final comments and prime delivery/presentation preparation |

The timeline above is the retained engineering workshare basis. The prime's proposal should place these periods inside the complete 2027 client schedule, including the agreed review intervals and final presentation.

## Existing commercial basis

WORKSHARE.md records the proposed USD 18,600 fixed engineering fee and its milestones. It allocates USD 4,650 to source and method setup, USD 9,300 to the modeled review release, and USD 4,650 to final receiving and handover. The existing scope includes one baseline, two reviewed alternatives, one consolidated correction cycle and one source/profile revision followed by the same production cycle. [3]

The reusable product supports additional retained alternatives and later delivery editions. That product capability and the specific proposed fee allowance have separate roles. The prime can use the existing workshare to cost the required engagement and identify any changed commercial allowance explicitly.

The RFP's total project ceiling is USD 50,000 including data compilation and preparation, model scenarios, meetings, travel, map generation and final report compilation. At that ceiling, the proposed engineering fee represents 37.2% and leaves USD 31,400 for the prime's remaining project cost categories. [1, PDF p. 3; 3]

## Complete proposal assembly

The issuer's proposal is one PDF due November 6, 2026, at 5 p.m. Eastern Time. Its named recipient is Josie Newton, Clean Water Manager, at jnewton@upstateforever.org, and its requested label is "Response to EC-SDC Mapping RFP." [1, PDF p. 3]

| Proposal component | RFP limit or requirement | Material to assemble |
| --- | --- | --- |
| Relevant experience | Three to five similar projects from the last five years; up to two pages per project | Actual prime/team projects and the work performed |
| Team | Organizational chart and brief biographies or resumes; one page per person | Named delivery roles and the people assigned |
| References | Two comparable organizations; maximum one page; stated prior-UF-work exception | Actual comparable references and the applicable history |
| Schedule | Maximum two pages; demonstrate the November 1, 2027 deadline | Complete client schedule with engineering, review and final presentation |
| Fee and anticipated expenses | Maximum ten pages; total project cost at or below USD 50,000 | Prime's full cost categories and the retained engineering workshare |
| Contacts and firm information | One page; at least two proposal contacts | Names, emails, mailing addresses and telephone numbers, plus firm name, physical address and website |
| Submission | One complete PDF | The complete assembled proposal in the requested format |

The technical approach and workshare provide source material for that proposal. Actual qualifications, references, team assignments and prime pricing supply the firm-specific portions. [1, PDF p. 3]

## Source references

[1] Upstate Forever, Emerging Contaminants in Small or Disadvantaged Communities Grant Program - GIS Mapping & Modeling Services, official combined RFP and appendix. Original URL: https://www.upstateforever.org/files/files/20261002_FINAL_EC-SDC%20Mapping%20RFP%20APPENDIX%20COMBINED.pdf . Fully read retained edition: 18 pages, 7,504,118 bytes, SHA-256 a519d33190eefaef7ec082c19642fc6b8ef89329ad3c648a561699c7dd277e74. Complete retained page text: Slack Canvas F0C8R8BCGJ0.

[2] Original RFP_RESPONSE_MAP.md, SHA-256 d3f084f9e215242cb6c91116cd79c4ab0d8fee8f076c2ae4d0e3d067b47a0b72, from the 72-file original application at private Commons commit 7c4223a111581935b494d5ac4b9357ef86992d67. Its older retained issuer PDF hash 04313cdda0b19f98b4081ef1eeec2f52707437759f9058f8d0e5abc8d83d6dbf remains a separate source edition.

[3] Original WORKSHARE.md, SHA-256 9fed9b28b744b3b5cd5fc896d70ff2efd29c800b75bed45dbb05f3224a4d9b85, in the same original application. Prepared October 12, 2026, for internal commercial use.

[4] Original native reporting-mask conversion and current scenario-summary source, inspected through the existing source owners: model/native.py rate_to_mass call with reporting_mask, original model/delivery.py, and the maintained upstate.scenario-summary/v1 source in Canvas F0C8HGL5YRZ. Current additive parcel source: Canvas F0C8PL36CMQ.
