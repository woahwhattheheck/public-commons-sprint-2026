# Upper Savannah RFP: scope, implementation and delivery

The issuer's [18-page RFP and appendix](https://www.upstateforever.org/files/files/20261002_FINAL_EC-SDC%20Mapping%20RFP%20APPENDIX%20COMBINED.pdf) and [SCBO notice 69283](https://scbo.sc.gov/printad?a=69283) define the project. The retained issuer PDF has SHA-256 `04313cdda0b19f98b4081ef1eeec2f52707437759f9058f8d0e5abc8d83d6dbf`. The proposal deadline is November 6, 2026, at 5 p.m. Eastern.

This matrix connects the scope to the maintained application, original source selections and production deliverables. Source capabilities, completed regional calculations and native model outputs have separate records so a receiving operator can inspect the material used in each result.

## Scope and application

| Issuer requirement | Application and production deliverable | Source or study choice |
| --- | --- | --- |
| Identify lands whose development could disproportionately affect water resources and drinking-water supplies | Saved baseline, explicit polygon/class alternatives, original NDR/SDR runs and quantitative changes on common spatial support | Actual changed land-cover cells, reviewed replacement classes and selected development assumptions |
| Assess current nitrogen, phosphorus and sediment exports | Original pollutant rasters, declared units, pixel mass and annual watershed totals | Native DEM, land cover, rainfall erosivity, soil erodibility, runoff proxy and referenced biophysical profile |
| Cover South Carolina's Upper Savannah basin with contributing upstream context | Separate reporting mask, source domain and original directed watershed network; retained cross-state contributions | Original reporting boundary and WBD HUC12/ToHUC attributes |
| Support drinking-water protection | Utility-focus geography, source-water overlays, upstream context and scenario comparison | Actual utility watershed, intake or protection-area source; explicit geographic basis |
| Address designated high-quality waters | Source classifications, their actual geography and reviewed spatial relationships; published contextual map | Original effective designation records, identifiers and any explicitly selected buffers |
| Supply seven useful map families | Seven release roles, legends, scale, north arrow, shared comparison ranges, PDF/GIS exports and operator downloads | Saved map settings, title, audience and consolidated cartographic comments |
| Provide combined prioritization | Saved nonnegative pollutant weights and normalization caps; separate physical pollutant layers | An explicit planning-weight decision, with source ranges and units retained |
| Include conservation, parcel and other geographic context | Protected-land, parcel, hydrography and wetland overlays; quantitative GIS/CSV inventory with measured coverage | Original data terms, county/source footprint and basin or utility selection |
| Explain the scientific method and observations | Pinned runtime, actual model arguments and stage logs, source coefficients, original observations and comparison metrics | Appropriate regional profile, calibration evidence and uncertainty interpretation |
| Support emerging-contaminant work | Retained field and laboratory context with original quantity, catchment and time-period semantics | Actual E. coli/cyanotoxin observations and nutrient/sediment measurements |
| Deliver understandable reports and editable working material | Quantitative report, metadata/lineage, source inventory, full application, original inputs and a complete working archive | Final scientific interpretation and the receiving operator's normal environment |

## Issuer production specification

RFP page 2 requires all seven map datasets on a **30 m by 30 m production
grid**, with a modeled buffer outside the Upper Savannah basin. The final maps
may mask the external area. The regional project therefore retains its 30 m
grid, the actual contributing terrain and an explicit buffer rationale. The
original Gura workflow is a separate commissioning study on its selected
original source grid. The pinned official InVEST 3.20.0 release archives use
15 m land-cover cells. Any separately retained resampled case keeps its own
recorded grid and provenance; it is not the original archive resolution.

The production release includes print- and web-quality maps with legends,
scale and north arrow, their GIS data and metadata, and the final and working
project files. Created geospatial data use FGDC-endorsed standards, with the
selected standard and source lineage recorded for each dataset. The final
report explains methods and findings for a lay reader. The consultant
presents the completed products to UF and its partners and meets UF's Clean
Water Team at agreed intervals to review progress and drafts. Final maps, GIS
data and associated metadata are due **November 1, 2027** (RFP pages 2-3).

## Spatial scope and quantities

The South Carolina reporting mask answers the issuer's geographic question.
The original regional watershed context contains 217 HUC12s across seven HUC8s;
its full watershed areas total 4,659,072.10 acres. Those full HUC areas include
cross-state context. Distinct NRCS state portions total 4,659,074.06895431 acres;
the source's 1.96895431-acre difference is retained.

The original WBD source contains 303 Savannah HUC12 records with their ToHUC
links. Every one of the selected 217 has an original outgoing record. The
retained publisher count is 303, and the separate national query for external
incoming HUCs returns zero. Three selected-domain links leave the 217-HUC
selection. The preserved source is in
`source/receptor-topology/20261013/`.

The regional desk combines this source with original NRCS and SCDES context.
A selected watershed can therefore show its own attributes and its distinct
known upstream watersheds. Upstream summaries exclude the selected watershed.
The Lower Tugaloo selection, `030601020507`, has 31 upstream domain HUC12s,
573,633.44 upstream acres, one upstream NRCS priority HUC and 1,002 upstream
selected-classification records. Including Lower Tugaloo gives 32 HUC12s and
633,323.13 acres, matching the retained utility-focus topology calculation.

These regional, utility-focus and protection-area selections remain separately
named. A whole-HUC upstream area is used for geographic context; raster load
totals use the actual selected raster support and reporting mask.

The original [NDR guide](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest-userguide/latest/en/ndr.html) and [SDR guide](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest-userguide/latest/en/sdr.html) define the native output quantities. Physical conversions use each native raster's actual affine pixel area. NDR
nitrogen/phosphorus export is kg/ha/year; SDR sediment export is metric
tonnes/ha/year. Annual pixel mass multiplies the export rate by pixel area
in hectares once. A 30 m square pixel covers 0.09 ha. The pinned official
3.20.0 Gura source uses 15 m square pixels covering 0.0225 ha. A separately
recorded 300 m square grid would cover 9 ha per cell. Grid edits and continued
intake preserve each retained source selection and its actual affine-derived
pixel area. The upstream context buffer is an independent distance: a saved
zero-metre Gura context retains the original watershed geometry directly,
while the regional production project uses its documented external buffer.

## Seven release roles

The identifiers below remain the application's release contract.

| Role | Quantitative content and review question |
| --- | --- |
| `future_sediment_loss` | Land priorities for preventing future sediment loss, supported by explicit land-cover alternatives, change from the saved baseline and a stated ranking method. Sediment export and any separate erosion/loss quantity retain their actual native names and units. |
| `future_nutrient_runoff` | Land priorities for reducing nutrient runoff, supported by nitrogen and phosphorus export changes on declared common support and a stated separate or combined ranking. |
| `critical_drinking_water` | Priority lands for drinking-water protection, relating sediment/nutrient pathways and selected alternatives to original intake or source-water geography and upstream context. |
| `high_quality_waters` | Priority lands for protecting outstanding-resource, trout and other high-quality waters, using authoritative designations and an explicit hydrologic or other stated spatial relationship. |
| `current_nutrient_export` | Current absolute nitrogen/phosphorus export rates and highest-export areas on the retained regional production grid. |
| `current_sediment_export` | Current absolute sediment export rates and highest-export areas on the retained regional production grid. |
| `combined_pollutant_export` | Combined presentation of nitrogen, phosphorus and sediment, retaining component values. The application's dimensionless priority view declares the saved pollutant weights and normalization choices. |

Comparisons retain the actual overlapping valid support. Percentage change is
available when the compared quantities share the required support and the
baseline denominator is positive. The combined index requires a positive
normalization cap for a positively weighted pollutant that has positive
export. Absolute pollutant outputs remain available beside the index.

Land-cover maps and point inspection use the original source class codes and
biophysical-table descriptions. Categorical print legends carry those same
classes. Original Gura class values retain their source meaning throughout
intake, scenario editing, native calculation and display.

## Source and method selections

The retained source inventory preserves original raster, vector, table and
document bytes, sidecars, source URLs, vintages and analysis selections.
The Georgia 2019 N/P and Duke 2022 C/P rows are a declared regional reference
profile. Its coefficient sources, model interpretation and parameters remain
inspectable as the study adopts justified local revisions.

NRCS priority status, SCDES classifications, protected-land categories and
utility operating/protection areas retain their distinct source fields.
Original SCDES selected-classification counts use the publisher's HUC12
attribute. Geometric intersections and routed model loads are separate
calculations available through their respective modules.

Annual-load comparisons bind station, catchment, complete period, measured
quantity and source method. Concentrations and microbial observations retain
their original units and periods. This provides the relevant field context for
the issuer's E. coli and cyanotoxin objectives alongside nutrient/sediment
modeling.

The appendix's utility-focus context identifies Upper Six and Twenty Creek
(`030601010703`), Lower Six and Twenty Creek (`030601010704`), Choestoea Creek
(`030601020502`) and Lower Tugaloo River (`030601020507`). These four source
selections accompany the basin-wide scope. Appendix Table 1 contains 17
whole-block-group records totaling 27,448 residents; their population,
household, median-income and household-poverty measures retain their original
definitions. Utility service populations of approximately 210,000 for ARJWS
and 7,000 for PRWD are separate geographic quantities (PDF pages 6, 12-16).

The wider EC-SDC project includes three additional in-stream sampling sites
for each utility, with laboratory and microbial-source investigations
described in the appendix (PDF page 9). The mapping work uses the resulting
qualified observations and explains the sediment/nutrient pathways relevant
to bacterial pollution and harmful algal blooms. The engineering workshare
allocates that source interpretation with the prime and the utility programme.

## Current regional evidence and geographic review

The retained 2023–2025 Annual NLCD comparison covers all 217 original HUC12 watersheds in the retained
hydrologic domain on the source raster grid. Original cell-centre inclusion assigns
20,949,527 cells to one watershed each, totaling 1,885,457.43 hectares of
land-cover support. Of these, 1,089,063 cells changed annual class:
98,015.67 hectares, or 5.19851%. The complete per-watershed class-pair matrix
retains the original 16 classes. Eight group summaries preserve gross gain,
gross loss and net change, including changes that cancel in a net total.
The area basis is the retained raster support; the NRCS full-watershed and
state-portion records above keep their separate original quantities.

The joined profile retains 87 draft-2026 assessment station identities in
49 watersheds and 22 observed-flow gauge identities located in 21 watersheds.
Five watersheds have both kinds of local source point. Point membership,
assessment cause, measurement period and original coordinate variants remain
inspectable. Those location counts describe the retained inventory. Flow
catchments and the existing annual-load comparison provide the appropriate
upstream support for model-to-observation interpretation.

The appendix's four focal HUC12s can be reviewed at two useful scales:

| Original selection | HUC12s | Raster support, ha | Changed annual class, % | Developed net change, ha | Forest net change, ha | Assessment / flow identities |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| ARJWS: Upper and Lower Six and Twenty anchors | 2 | 18,911.97 | 3.18037 | +170.37 | −172.53 | 2 / 0 |
| ARJWS: distinct contributing union | 4 | 42,799.77 | 2.97443 | +288.54 | −335.34 | 5 / 0 |
| PRWD: Choestoea and Lower Tugaloo anchors | 2 | 34,096.23 | 2.87240 | +80.91 | −61.20 | 2 / 0 |
| PRWD: distinct contributing union | 32 | 256,297.14 | 1.78380 | +322.20 | −313.20 | 16 / 6 |

Developed covers NLCD classes 21–24, including vegetated developed open
space; forest covers classes 41–43. The developed-class change is interpreted
with those original class definitions.

These are whole-HUC planning selections derived from the original ToHUC
network. Each union counts a HUC12 once. Summing the two anchors’ individual upstream
catchments would repeat 7,740.90 hectares for ARJWS and 9,940.68 hectares for
PRWD. The selected and contributing tables retain their exact membership,
all eight land-cover groups and the original local observation identities.

The comparison helps the prime frame source review and scenario choices.
For example, the two PRWD anchor watersheds contain 277.47 hectares of gross
forest loss and 216.27 hectares of gross forest gain, producing a much smaller
net loss of 61.20 hectares. The complete transition matrix identifies the
source and destination classes behind those quantities. The future-impact
map families then use explicitly selected alternatives and original native
NDR/SDR outputs to evaluate pollutant consequences on common support.

The Regional Watersheds desk connects those tables to all 217 original
polygons, preserving 273,049 vertices and the source EPSG:3857 coordinates.
It offers 29 numerical attributes, full-domain grayscale legends, native
attribute inspection, selected and upstream outlines, geographic selection
and saved export reopening. A geographic export includes the complete
selected and contributing GeoJSON, the full original map, source geometry,
profile table, field meanings and maintained rebuild source. Its observed
evidence export retains the selected profile/group/location tables and all
original inputs.

The report source combines the regional comparison, local observation
inventory and both utility scales in the maintained Scientific Report
workflow. The original-source report has been generated and independently reopened;
its producer is repairing the actual narrow-screen and PDF presentation.
The geographic receiving course is preparing the complete original source,
then operating the populated map at normal and narrow widths, inspecting
downloads and reopening its working project. Their completed products join
the same regional delivery and scientific review.

Original source and operating references:

- [217-watershed profiles and complete class/group methods](observations/landcover_observation_profiles_20261013/README.md).
- [Original polygon overlay and exact rebuild](observations/watershed_profile_overlay_20261013/README.md).
- [Regional geographic and observed-evidence workflow](operator/WATERSHED_CONTEXT.md).
- [Original utility focus profile](source/receptor-topology/20261013/utility-focus-profile.json).
- [Original utility contributing-membership calculations](outputs/watershed-connectivity-20261013/watershed-connectivity-217.csv).
- [Complete scientific report source manifest](landcover_observation_profiles.report.sources.json).

## Operating and transferring the project

The original Gura workflow is maintained in
`source_tools/gura_workflow.py`, with usage in
`GURA_NATIVE_WORKFLOW.md`. It composes original source intake, the existing
native programme, broad source-class comparisons, watershed/economic reports,
a complete Workspace archive and the real operator. It uses the selected
InVEST 3.20.0 runtime and records actual process, source and output identities.

The operator provides source/profile inspection, model and scenario selection,
native progress, report comparison, GIS downloads, saved views and notes,
and Workspace backup. The regional watershed desk receives the original
ToHUC source in the same source edition as its NRCS/SCDES context.

A complete transferred archive carries the matching application, original
source collection, scientific selections, native outputs and saved operator
session. The Gura workflow also retains its original receiving/programme
selection and can bind those selections to the restored local paths. The
receiving result records the actual reopened Workspace and output files.

## Prime proposal assembly

The issuer's proposal requirements are on PDF page 3. The maintained
`source/acceptance/20261012/review-requirements.json` retains all 33 page-linked
requirements and distinguishes issuer requirements, procurement information
and engineering acceptance details.

| Proposal component | Issuer format |
| --- | --- |
| Comparable experience | Three to five project descriptions from the preceding five years; at most two pages per project |
| Named team | Organizational chart and biographies or resumes; one page per person |
| References | Two organizations, within one page; the stated exception applies after two completed UF projects in the preceding two years |
| Project schedule | At most two pages, demonstrating completion by November 1, 2027 |
| Fee and expenses | At most ten pages; inclusive project total no greater than $50,000, covering data preparation, model scenarios, meetings, travel, maps and report |
| Contacts | At least two proposal contacts with name, email, mailing address and telephone, plus firm name, physical address and website; one page |
| Submission | One complete PDF, labeled `Response to EC-SDC Mapping RFP`, emailed to Josie Newton at `jnewton@upstateforever.org` by November 6, 2026, 5 p.m. Eastern |

UF anticipates selection in December 2026 and confirmation by the end of
January 2027. Its page 4 terms place the contracted programme after the
negotiated agreement and leave proposal-preparation costs with the proposing
firm. These procurement dates are separate from the current product-building
sprint and demonstration.

## Commercial workshare and release

`WORKSHARE.md` contains the proposed USD18,600 engineering subcontract,
milestones and 30 active business days. It supplies engineering scope for
Ecosystem Sciences' complete proposal, alongside the prime's qualifications,
references, named team and issuer submission.

Production delivery includes one baseline and two agreed land-cover
alternatives, seven map families, quantitative GIS/report material, one
consolidated correction and a reopened full working project. Exploratory
comparison cohorts support method and scenario review; the workshare states
the production deliverables and fee.

Each production release links its actual native runs, selected sources,
report, map files and project archive to the source revision used. The
scientific and cartographic review applies to that complete release.
