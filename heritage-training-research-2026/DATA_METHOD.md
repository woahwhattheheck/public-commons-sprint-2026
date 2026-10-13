# Data and research method

## Purpose and source authority

Historic England's UID370 notice calls for a repeatable baseline of heritage construction training and qualifications, including provision, funding, participation, completion and geographic/occupational coverage. The original Cabinet Office notice is retained in sources/originals/UID370_095824-2026_original_ocds.json and at https://www.find-tender.service.gov.uk/Notice/095824-2026 . It was published on 9 October 2026 at 16:42:28 +01:00; the government notice copy at https://www.sell2wales.gov.wales/search/show/search_view.aspx?ID=OCT666699&catID= was reposted on 10 October. It identifies the original submission portal at https://supplier.in-tend.co.uk/historicengland/home . The full issued invitation and amendments determine final contractual scope.

The source catalogue and sources/DATA_INTAKE_SPECIFICATION.md preserve the actual first-party definitions. The workbench applies the following research structure; it does not replace the lead's subject-matter judgment.

## Identities and valid joins

Authority plus qualification identifier identifies a qualification; title similarity is a candidate for review. Keep identifiers as strings, including a terminal X. An LARS learning aim is its original LearnAimRef; LearningDelivery.SourceSystemRef and the source-system genre/authority establish any actual qualification linkage. Apprenticeship standard, version and occupational option are separate concepts. Do not assign a standard-wide learner count to one heritage option without actual evidence.

A UKPRN identifies the registered provider. A course offering and physical delivery location require separate records and sources. Administrative location and learner delivery-at-start location have different meanings. A remote-delivery marker is not a geographic site. A provider-standard outcome is not an option-level or site-level outcome.

Effective dates describe the source's actual validity or applicability. An ended version remains useful for the learners and periods to which it applied. A current standard page does not rewrite older source versions.

## Observation contract

Every original observation keeps its published token and source status. Exact, rounded, true-zero, suppressed, unavailable, inapplicable and uncollected values remain distinct. Retain the source's rounding basis and any documented conflict between machine-readable metadata and published prose. An unknown small count never becomes zero or a guessed midpoint.

The analyst declares metric, population, cohort, time period, geography, unit and denominator basis. Ofqual certificate-quarter counts and DfE qualification achievement measures are different observations. Published completion or achievement rates use their own actual cohort method. A period labelled provisional must not silently become a full academic year.

Several rows may sum only when all declared measure bases agree, every selected observation has an actual numeric published value, the unit is additive and the analyst has supplied one actual nonoverlapping partition declaration. The workbench uses exact decimal strings and BigInt arithmetic. Summed rounded values retain that qualification; the programme does not infer an underlying exact total. Rates and percentages remain separate.

## Coverage, heritage relevance and gaps

Record the population the source actually covers, its grain, inclusions, exclusions and missingness. A partial source with no record of an offering does not establish no provision. A geographic gap conclusion requires a defined target population, explicit evidence coverage and a reasoned research judgment. The lead retains decisions about occupational taxonomy, heritage relevance, risk and extrapolation.

Research reviews record the actual reviewer, target, decision and reason. The application captures the target and its linked source/provider/site/qualification closure. A later material change keeps the original review but marks it for review. Metadata that changes the evidence interpretation is part of that closure.

## Repeating the study

Register the next original release as a new source edition; retain its publication, coverage and applicable period. Receive the source table through the original mapping engine, resolve actual new identifiers, and compare definitions before comparing values. Retain previous valid source editions and reviews. Save a new analysis with the complete source selection and review roster. The previous analysis remains reproducible from its own inputs.

The complete receiver validates current and historical mapped rows under the same domain rules. It checks every historical reference, full immutable review/run record, selected table schema and research-review roster before rederiving saved results. A following data correction therefore cannot make an invalid historical analysis appear accepted.
