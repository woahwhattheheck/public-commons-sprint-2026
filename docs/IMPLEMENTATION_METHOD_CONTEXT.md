# Original method definitions in field observations

Saved field observation sources now expose the original analytical method
identifier, its declared naming context and full method name. Collection method,
equipment, container, preservation and transport fields remain connected to
their exact original activity or result row.

The existing quality report gains a method inventory. The existing Observed
dataset receives the same source-bound context fields, so a chart's declared
series dimensions distinguish methods whose identifiers belong to different
contexts. FIELD12 saved observation values and laboratory import revisions remain
unchanged.

## Exact original source semantics

The canonical observation method and activity method keep their recorded text.
The source helper reads an explicit native method_context/method_name when
present. It also reads the original WQP fields retained inside
observation.lab_source.original_row:

- ResultAnalyticalMethod/MethodIdentifier;
- ResultAnalyticalMethod/MethodIdentifierContext;
- ResultAnalyticalMethod/MethodName;
- MethodDescriptionText.

A source naming context or name attaches to the canonical method only when the
selected method matches the original identifier or full name. The comparison
trims surrounding whitespace in those identifier/name values, as the original
CSV mapping does. An explicit native context/name remains its own declared value. An explicitly
different naming context prevents borrowing the original definition's name.
An unrelated original definition is retained separately; its context is not
assigned to a different selected method.

The inventory retains the matching explanation, complete original definition,
source link IDs, original CSV record numbers through the derived row's
method_source_definition, and original observation pointers. It does not infer
equivalence from similar method names or replace a code with a guessed standard.

## Original collection and equipment metadata

The original collection identifier, context, name, qualifier and description
travel as one declaration. If the activity has any such field, that complete
declaration is retained; otherwise the original laboratory row supplies it.
Independent equipment, container, preservation and transport fields use the
activity value first and the original result row only when that value is blank.
Whitespace-only values count as unstated for fallback and explicit context/name
selection; a selected nonblank value keeps its exact original text. Each chosen
field retains its precise origin. If both original records state
different values, both declarations remain in original_collection_conflicts.
This avoids composing a method identifier from one source with another source's
unrelated naming context. Full original activity and result rows remain linked.

Fields retained include original collection identifier/context/name,
qualifier/description, equipment and its comment, container type/colour,
chemical and thermal preservation, and transport/storage text. The selected
canonical activity method is not filled from equipment. An original Water
Bottle entry therefore remains equipment even when collection method is blank.

## Existing reports and data

The source-quality report includes:

- exact definition strata that also retain declared method contexts and names;
- a complete method-inventory.csv with all original IDs and nested definitions;
- a readable six-column analytical/collection definition table;
- metadata availability counts for method context/name and equipment.

The original quality tables, campaign coverage, collection calendar, source
limits and source attachment inventory remain. Numeric ranges still use only
original numeric values inside an exact metadata stratum. Censored, text and
missing records retain their own counts.

The existing field-observations.csv adds method_context, method_name,
activity_method_context, activity_method_name, collection_equipment and
method_source_definition. Its declared series_dimensions includes analytical
and collection method contexts/names. Observation ingestion already retains
these arbitrary dimensions from the original CSV row. The canonical method,
result type, numeric value, original text, unit, basis, fraction, qualifier,
limits, QA and collection timestamp stay unchanged.

This is descriptive support for the saved source. Outcomes and quality-control
decision rules remain with their existing native components.

## Actual Eighteenmile original source case

The exact public 2023 WQP source has 88 results and 88 original sample activities
at three sites. Direct source aggregation of the original result CSV joined to
the prepared original activities gives:

| Parameter and original method | Context | Results | Numeric | Censored | Original container |
| --- | --- | ---: | ---: | ---: | --- |
| Microcystins/nodularin, 520019 | ABRAXIS LLC | 41 | 37 | 4 | PETG Bottle |
| Chlorophyll a, corrected for pheophytin, 445.0 | USEPA | 45 | 45 | 0 | HDPE Bottle |
| Microcystins/nodularin, 520011 | ABRAXIS LLC | 2 | 0 | 2 | PETG Bottle |

The 520019 source names the streptavidin-amplified ADDA immunoassay; 520011
names the separate microtiter immunoassay. The 445.0 source names fluorescence
for chlorophyll and pheophytin. All 88 source activities state Water Bottle
equipment. These original names are shown in full in the source inventory.

Original Lower Reporting Limit rows remain 41 at 0.016 ug/L, 45 at 0 ug/L and
two at 0.1 ug/L. Zero is retained as the publisher's reported value. These are
source-labelled reporting limits, not newly assigned detection or quantitation
limits. The six censored rows retain null numeric measurement values.

Source authority: public repository woahwhattheheck/public-commons-sprint-2026,
commit901998901297e02412f414dfbac9f0222f5f6f75,
observations/eighteenmile_2023/wqp_20261013/three-lake-results-2023-original.csv
under the Upstate application prefix. Original CSV SHA-256:
5b22e3de1a4311963b2ed616886273788bd485897f276663157a7137ce0aaa61.
The original prepared seed retains the complete station and activity rows.

## Edition and replay

Quality edition: field-measurement-support-20261013-v2-source-method-context.
Derived observation edition: field-observations-20261013-v4-source-method-context.

The edition change makes the existing importer retain a distinct derived source
and report. It reuses the exact saved plan revision and original laboratory
operation. The original WQP receiver already includes the runtime observation
edition in its identity, so the same applied revision2 is reused rather than
importing the original CSV again. Existing source and report editions remain
available.

Public APIs remain summarize_field_quality, write_quality_sources and
quality_sections, with additive method_context(observation, activity). The
existing observation preview/import APIs and guarded installer paths remain
unchanged. Both maintained source modules must travel together.
