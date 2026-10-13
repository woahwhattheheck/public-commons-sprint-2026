# Freshwater monitoring interpretation profiles

**Edition:** 13 October 2026  
**Operation:** ECO-WO30-MONITORING-INTERPRETATION-3FC8-20261013  
**Owner integration:** the existing Published studies application in this project.

This source product supplies 40 explicitly selectable comparison profiles: eight E. coli profiles, six measured-cyanotoxin profiles, three South Carolina lake chlorophyll magnitude profiles and 23 Georgia lake-location chlorophyll profiles. It retains the authority, edition, location, designated use, season, duration and frequency separately from the numeric magnitude.

The profiles support scientific interpretation. A numeric comparison does not decide regulatory compliance, a waterbody's assessment status, safe swimming, an advisory, a closure, drinking-water safety, pathogen identity or the cause of an observed condition. Those decisions require the applicable agency program, data quality review, actual designated uses and other evidence.

## Files and integration

- `profiles.json` is the complete self-contained catalog. Its `policy` contains the application's conservative handling rules; each profile carries its own source references and metric support requirements.
- `source-index.json` identifies each original primary source, selected edition, locators, retrieval date and the limits of the capture.
- `parameter-contract.json` preserves the exact characteristics already observed in the original 730-result source and defines matching, censoring and method-review requirements.
- `jurisdiction-reaches.json` supplies a few relevant Georgia Savannah-basin reach descriptions for analyst confirmation. It is not a station-to-jurisdiction map.
- `profile-index.csv` is a readable inventory of all profile magnitudes and aggregation types.
- This guide explains how the original application should present the selected scientific comparison.

No new measured observations, monitoring results, model-derived bacteria or model-derived cyanotoxins are introduced. No separate database, scheduler or native receiver is required.

## Principal bacterial profiles

| Selected basis | Geometric mean | Excursion magnitude | Period and support |
|---|---:|---:|---|
| South Carolina ambient FW/TN/TPGT/TPT |126 per100mL|349 per100mL|30days; GM requires at least4 samples at one site; no explicit24-hour spacing in these clauses |
| Georgia freshwater Recreation |126 counts/100mL|410 counts/100mL|Year-round;30days, GM at least4 samples separated by at least24hours |
| Georgia Fishing/Drinking Water Supplies, May–October |126 counts/100mL|410 counts/100mL|Same30-day and sampling provisions |
| Georgia Fishing/Drinking Water Supplies, November–April |265 counts/100mL|861 counts/100mL|Same30-day and sampling provisions |
| EPA2012,36NGI/1000 alternative |126 CFU/100mL|410 CFU/100mL|30days; EPA does not prescribe a minimum count as a criterion element |
| EPA2012,32NGI/1000 alternative |100 CFU/100mL|320 CFU/100mL|30days; same distinction about monitoring support |

For all six pairs, the excursion frequency is no more than10% of samples above the selected excursion magnitude in the relevant30-day period. An individual sample above an STV is an observation above that magnitude; it is not independently the entire frequency criterion.

The state four-sample language explicitly qualifies the geometric mean. The catalog uses a four-sample paired-support gate for the associated state excursion metric, and identifies that gate as an application choice rather than a separately stated STV minimum. An actual sparse observed fraction can remain visible descriptively. The federal computational floor of one sample is not an EPA endorsement of one-sample representativeness. EPA recommends weekly monitoring and discusses more frequent sampling for heavily used beaches.

The federal alternatives are complete pairs. Do not mix the126 geometric mean with the320 STV, or the100 mean with410. EPA's separate beach action values are235 and190 CFU/100mL for the36 and32NGI alternatives respectively. They are advisory-management reference magnitudes, not replacements for either member of the GM/STV pair. [EPA2012, sections3.6.5,4 and5.1](https://www.epa.gov/sites/default/files/2015-10/documents/rwqc2012.pdf).

### State identity, use and date

South Carolina's selected ambient clauses are R.61-68 G.9(f) and G.10(f). TPT uses the freshwater standards through G.8(c). ORW and other classifications must be reviewed against the actual applicable prior/site-specific classification; the software must not assign them to FW automatically. The regulation's separate NPDES monthly geometric mean/daily maximum is not an ambient rolling-window rule. The selected agency PDF is a convenience copy whose revision history ends23May2025; this capture does not independently establish EPA approval of every provision. [SC R.61-68](https://des.sc.gov/sites/des/files/Library/Regulations/R.61-68.pdf).

Georgia's selected rule is the28January2022 state-adopted,31August2022 EPA-approved edition linked by EPD's current index. A waterbody with applicable Recreation use keeps the year-round Recreation criterion; winter Fishing values do not replace a more protective applicable use. The approved winter STV is **861**. The actual bacteria headings are (6)(a)(i), (6)(b)(i)2 and (6)(c)(i)2. Some lake cross-references still print (6)(c)(iii); use the actual heading and numeric text, not that stale internal reference. [Georgia approved rule](https://epd.georgia.gov/document/document/georgia-water-quality-standardsaug-2022pdf/download).

Profile edition and collection date remain visible. Applying today's selected edition to historical observations produces a reference comparison unless the operator separately establishes the edition applicable on the observation date. Unknown jurisdiction, designated use, season, exception or site-specific criterion produces an applicability gap rather than an automatic selection.

## Original730 source: units and laboratory methods

The retained source parser found the exact characteristic `Escherichia coli`. Its original units include blank, `MPN/100 ml` and `MPN/100mL`; methods include9221-F,9223-B andBAC94, with APHA and USGS method authorities. These are observed source identifiers, not catalog declarations that every method is approved or equivalent under each profile.

The permitted unit entries have factor1 only for spelling normalization and explicitly require method review. **MPN and CFU remain distinct measurements and distinct cohorts.** A reviewed comparison to a CFU-based reference must preserve the fact that the observation is MPN; the software must not relabel it or perform an invented conversion. A blank unit is ineligible for quantitative comparison until a reviewed correction supported by original source evidence is retained.

Group by station, exact parameter, original unit, method and authority, fraction, depth and activity. Preserve all original rows. The single Field Replicate row is quality-control evidence, not an extra independent routine sample. A blank fraction or method component is a visible information gap rather than proof of a known fraction.

The source includes EDT and EST clock labels. They can establish their stated UTC offsets when paired with actual source dates/times. A date alone cannot establish24-hour spacing; two sample dates one day apart can be less than24hours apart. Missing or conflicting times must not be silently filled.

## Censoring and aggregation

These are **application interpretation rules**, not newly attributed agency rules.

Preserve the source numeric token, qualifier, detection condition and original bounds. `NotDetected` without an actual limit is not a numeric zero. `NotReported` is missing. `Present Below Quantification Limit` or `Present Above Quantification Limit` can qualify a numeric cell; that cell is not automatically an exact concentration.

For a strict magnitude comparison x>T, an interval is certainly above only when every value allowed by its original bounds is aboveT. It is certainly not above only when every allowed value is at mostT. Otherwise it is indeterminate. Preserve open versus closed endpoints. Do not replace censored results with zero, half the detection limit, the detection limit or an arbitrary small positive value.

Calculate an exact geometric mean only from a fully supported set of strictly positive exact values. A selected censored/nonpositive/missing result makes the exact whole-cohort GM unsupported; an eligible-subset descriptive calculation, if shown, must identify exclusions and cannot stand for the full window. The2014 EPA erratum defines GM as ten raised to the mean of the base-ten sample logs. [EPA errata](https://www.epa.gov/sites/default/files/2015-11/documents/erratasheet-rwqc.pdf).

For an excursion fraction, retain otherwise eligible censored results in the denominator and show lower/upper possible fractions. Do not drop an uncertain row merely to make a fraction fall below10%. Compare using unrounded values; equality with the magnitude is not an exceedance.

A rolling30-day display includes the sampled endpoint local date and the preceding29 local dates. Display the exact bounds and source row IDs. Do not silently apply a seasonal threshold to rows from the other season. A boundary-crossing window has incomplete homogeneous seasonal support and needs explicit assessment review.

## Measured cyanotoxins

South Carolina G.9(j)-(k) and G.10(j)-(k) give total microcystins8µg/L and cylindrospermopsin15µg/L for freshwater primary-contact notification/advisory samples. The SC total-microcystins continuation provision requires resampling **below8** before removing an issued advisory; equality at8 is not below8. Its separate303(d) provision counts advisory events over a three-year period, not arbitrary individual samples. These contextual rules do not trigger software advisories.

EPA's2019 recommendations use the same8/15 magnitudes in two different ways:

1. The advisory recommendation is not to exceed the magnitude on any single day.
2. The water-quality criterion counts a10-day assessment period containing **any** concentration above the magnitude as an excursion. More than three excursions in a recreation season recurring in more than one year is the stated pattern; the adopting authority chooses its upper-bound assessment years.

The latter is **not a10-day mean**. EPA permits different authority-selected assessment-period implementations. The catalog requires the actual confirmed season, assessment-period bounds and upper-bound year rule. An engine without these capabilities must return contextual rule not assessed. A fixed-period implementation must not count overlapping rolling windows as independent excursions or treat an unobserved period as zero excursions. The two toxin recommendations can be applied independently. [EPA2019, sections6.3-6.5](https://www.epa.gov/sites/default/files/2019-05/documents/hh-rec-criteria-habs-document-2019.pdf); [current EPA summary](https://www.epa.gov/habs/protecting-human-health-cyanotoxin-exposure-during-recreation).

Total microcystins are not interchangeable with one microcystin congener. Sample preparation, intracellular/extracellular recovery and assay coverage matter. ADDA ELISA Method546 measures microcystins/nodularins; LC/MS may measure a selected congener set. Preserve the actual analyte and method and require a reviewed comparison; do not silently relabel either. A method's detection limit must support the intended discrimination. EPA's guidance does not mandate a single cyanotoxin method. [EPA final2021 implementation guidance, questions9-10](https://www.epa.gov/system/files/documents/2021-08/final-tsd-implement-2019-rwqc.pdf.pdf); [HAB methods](https://www.epa.gov/habs/hab-methods).

## Chlorophyll a

South Carolina E.11 supplies lake magnitudes of10µg/L in the Blue Ridge Mountains and40µg/L in the other two listed ecoregion groups. They apply to lakes at least40acres and all portions at full-pool elevation. That clause does not supply an averaging period or sampling minimum. Its catalog profiles therefore expose a **magnitude screen only**, not a completed assessment. Smaller lakes remain under narrative provisions.

Georgia's section17 gives23 named sampling locations across eight lakes. The criterion is the April–October average of monthly photic-zone composites at the specified site, with no more than one seasonal exceedance in five years. The catalog requires one explicitly reviewed monthly representative composite in each of the seven months. Seven is derived support for the stated monthly schedule, not a separate numeric minimum quoted from the rule. Missing months or unreviewed monthly replicates prevent a complete season comparison. The five-year frequency remains separate and contextual unless implemented with adequate coverage.

A stream grab sample cannot stand for a lake photic-zone composite. RFU, phycocyanin, cyanobacterial cell count and modeled pigment estimates cannot be silently converted to measured chlorophyll-a mass concentration. This selected Georgia section supplies no chlorophyll magnitude for Hartwell, Russell or Clarks Hill; do not copy another lake's criterion.

## Original application and delivery

Show the selected profile, authority class, edition, exact source links, expected method/unit, numeric result, sample support and unresolved applicability together. Unsupported frequency/season rules remain plainly not assessed. Keep the original sources, selection and analysis settings in the existing Published studies journal/export. Reopening an export must retain its selected catalog edition rather than silently substituting a later catalog.

The application owner must operate the actual interpretation controls against the retained original source, view the real desktop and narrow output, inspect exported attachments, and reopen the actual handover in its existing receiving workflow. This source catalog does not assert that those native/UI steps have run. No extra verification application or detached native campaign is introduced.
