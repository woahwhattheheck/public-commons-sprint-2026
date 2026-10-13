# UID370 — original-source intake and join specification

Checked 13 October 2026. This specification supplies the research and data contract for the existing heritage-training workbench. Source identifiers resolve to full official URLs in SOURCE_REGISTER.json. It keeps the national baseline reproducible while allowing a specialist to document where local knowledge or provider confirmation changes an interpretation.

## 1. Define the baseline before counting

Record an analysis date, England coverage, qualification/content inclusion rules, funding routes, publication editions and the actual periods represented by every measure. Keep the published commissioning dates and unresolved currency fields in NOTICE.json. The official notice describes a repeatable baseline of provision, funding, participation and outcomes, followed by coverage and trend analysis [S01]. Its full ITT remains a separate procurement source.

Use three research sets. The candidate set contains items discovered through official lists, register searches, prior research and specialist knowledge. The reviewed set records explicit heritage-content decisions against each exact source version. The confirmed-offering set contains dated evidence that a specified provider delivers a specified qualification, route or component at a specified site or remotely. Their counts answer different questions. A qualification's regulatory availability does not establish an available course place.

Every inclusion or exclusion carries its rationale and source locator. Record unsuccessful searches as dated searches, with their query and coverage, rather than as evidence that provision does not exist. Retain superseded rows so that a following baseline can explain additions, withdrawals, changed content and changed evidence separately.

## 2. Preserve original records and the interpretation beside them

Receive each complete original file or API page into a source edition. Record its original filename, URL, media type, byte count, SHA256, publisher, publication date, capture time, declared coverage and licence. API requests also retain the query and actual pagination metadata. Capture time is when this team received bytes; it does not replace a publisher's effective date.

An interpretation row points to that immutable edition and a native locator: CSV row key plus header, JSON pointer, PDF page/table, or HTML section. Keep the original literal, including blank, null, case, leading zero, date text and disclosure tokens. Parsed values live in separate fields. A following source edition never overwrites the earlier original.

The attached source register documents what was actually read. Its metadata/document observations are useful receiving inputs, but a null original-byte hash is not a dataset download. The equipped receiver should use ACQUISITION_ROUTES.json to acquire the complete selected datasets once, then attach its actual byte identities to the existing source-table project.

## 3. Maintain distinct identities

Use explicit namespaces for Ofqual qualification number, awarding-organisation recognition number, LARS learning aim, LARS apprenticeship standard code, Skills England standard reference/version, occupational-map option, UKPRN, locally evidenced site, and offering.

Identifiers remain strings. An actual qualification number is 610/1607/X [S31]. Removing the two obliques may create a separate comparison key, 6101607X; retain the original and terminal X. Learning aims also include classes and units, so an eight-character aim is not automatically an Ofqual qualification. Join LARS using the source-system authority, genre and SourceSystemRef, with a dated source relationship [S07].

Titles support discovery and display. They cannot establish identity by themselves. Awarding-body recognition and legal changes are recorded as dated relationships; a renamed title or an organisation merger does not justify erasing earlier observations. A provider organisation and each physical teaching or assessment site likewise have separate keys.

## 4. Receive the complete LARS selection

Select the appropriate current and historical release. The download index currently lists v12 and v11 files uploaded 12 October 2026 [S08]. The v12 field definition applies from August 2026, while its introduction retains draft wording [S07]. Preserve these statements and the actual downloaded version fields, rather than choosing a release only from the capture date.

Receive the original table collection and reference tables together. LearningDelivery establishes the aim, its source reference and operational dates. Validity and Funding provide separate category and effective intervals. DevolvedFunding additionally identifies source-of-funding authority. Standard, StandardAims and StandardValidity describe a different programme identity. ApprenticeshipFunding retains standard/framework type and programme/pathway fields; its unused zero-valued CoreGovContributionCap must not be mistaken for an unfunded standard. Version and DataGeneration identify the selected dataset.

The implementation contract in ENTITY_FIELDS.json enumerates the native field names used by this arm. Reference-code labels must come from the matching edition. A financial value receives its own currency, unit and route meaning. A published rate or maximum funding band is not a paid amount, course fee, grant commitment or eligible learner.

## 5. Bind occupation, route and heritage content

Skills England publishes separate standard versions and occupation options. The observed Stonemason record binds ST0442 to LARS637; version1.1's start window ended9 August2023 and version1.2 begins10 August2023. Heritage Stonemason is one of six options [S27,S28]. The occupational-map option is OCC0442C [S29]. Preserve this mapping as source evidence; do not turn all ST0442 activity into heritage-option activity.

The initial qualification examples come directly from NOCN's awarding-body pages, with their published unit or qualification identifiers [S30,S31]. They are candidate content records. The actual public regulator records S35/S36 now establish their published status, RN5194 awarding-organisation identity and exact operational dates. The qualification specification version, funding state, provider delivery and measures are received independently.

A specialist review records whether heritage content is mandatory, optional, contextual or absent; which option/unit/KSB is involved; whether it is taught, assessed, or both; and the exact evidence. Where coverage is partial, store its stated denominator. Do not infer an assessed proportion from a title, nominal duration or a broad construction SSA category. A changed unit, option or specification makes the prior decision historical until its new material is reviewed.

The occupational API exposes keyed occupation/product/hierarchy data, including an X-API-KEY requirement [S25]. Use an existing authorized configuration if that API is selected. Public official pages already support the supplied seeds. Preserve current attribution terms [S26], and keep a software API version separate from data and standard versions.

## 6. Establish who delivers what, where and when

Use UKPRN for the registered provider and preserve its verified legal/trading names. Registration is identity evidence rather than a quality rating [S21,S22]. A college group, subcontractor, awarding-body-approved centre, employer workplace and delivery campus can each play different roles. Store their relationships explicitly.

An offering requires the delivered qualification or standard/version/option, provider, delivery arrangement, evidenced site or remote mode, start/end or availability period, source date and verification state. An awarding-body centre approval is not sufficient evidence of a scheduled intake. An advertised course is not a learner enrolment. A ceased or paused offering stays in history with its source.

Where authorized ILR aggregates are provided, DelLocPostCode describes location at the start of an aim, may use a majority location or provider fallback, and uses ZZ99 9ZZ for remote provision [S23]. Preserve this provenance. Never geocode that sentinel, assign remote learners to the provider's office, or equate a provider postal address with every delivered course.

An ONSPD/NSPL crosswalk adds geography only for actual postcodes, with its own edition and match result [S24]. A postcode can represent more than one site, and a site may move. Preserve the original postcode and whether a geographic boundary is current, historical, approximated or unmatched.

## 7. Treat outcomes as source-specific measures

The four practical populations are regulated certificates, FE learning aims, apprenticeship programmes and provider-confirmed cohorts. Each has its own measures and denominators.

Ofqual's quarterly file counts certificates by qualification and awarding organisation. It does not identify unique learners or provider sites. Preserve the published rounding and exclusions, including apprenticeship EPA/AAQ and T Levels [S09]. The metadata defines wide quarter columns and declares qualification number plus recognition number as the record identity [S10].

The current FE aim-level QAR dataset exposes a national title-plus-reference field with leavers, completers, achievers and three rates. It covers2022/23–2024/25 inside a2025/26 release [S13]. The final reference can be parsed only as a validated suffix; a combined title remains retained. Use the exact national measure. A provider-level subject total cannot allocate that rate to a particular provider, course or site.

For apprenticeships, the separate provider QAR table actually includes UKPRN and standard/framework name, so a provider-by-standard result can be used at that supported grain [S17]. It still does not identify the Heritage Stonemason option or physical delivery site. The national standard series has starts, achievements and enrolments [S18]; the provider activity table is broader, by level/SSA [S19]. Keep those distinctions in exported tables and maps.

QAR rates belong to their published hybrid-end-year cohorts. The apprenticeship definition includes achievement year as well as expected, actual and reporting year [S17]; the FE aim contract is separately recorded [S13]. Calendar-year achievements divided by that year's starts are not a completion rate. A person can contribute multiple programme or qualification events.

## 8. Keep disclosure and uncertainty visible

Use MEASURE_CONTRACTS.json before parsing any number. Keep the literal token and a status alongside its numeric representation. Ofqual's true zero differs from its Fewer than5 token. Its CSVW metadata also lists0 as null, conflicting with its description; the explicit interpretation record preserves zero and retains that source conflict [S10].

DfE's low has different meanings for volumes and percentages. x, z and c are not zeros [S13,S17]. A rounded published value is not an exact count. Keep published rates rather than reconstructing them from rounded volumes. Do not reverse-engineer suppressed cells using totals, adjacent releases or overlapping partitions.

The numerical examples supplied here are exact public preview cells selected to demonstrate representations. They are deliberately outside the heritage population and must not enter the baseline. Actual heritage counts await their selected full dataset rows.

## 9. Compare comparable editions and report coverage

An analysis run pins source editions, a material-bound heritage review, date filters, selected dimensions and aggregation declarations. Counts may be added only where the operator states a nonoverlapping partition at the same measure/population/cohort/unit/period/geography basis. Do not combine a Total row with its children or two overlapping age bands.

Compare full years with full years, or matched in-year windows. The current apprenticeship activity release uses provisional August–April2025/26 against final previous August–July years [S15,S18]. A trend chart needs explicit matching-period selection. DfE also restated earlier SSA series after classification changes; use one coherent release edition or label the break [S11].

Report a coverage matrix alongside the results: candidate records found, content reviewed, source-version matched, current offerings confirmed, geolocatable delivery, funding conditions observed, quantitative observations available and disclosure-limited cells. State denominators. A missing local observation is a research gap, not proof of no training.

Qualification-risk indicators should distinguish regulatory withdrawal, last-new-start date, funding change, declining comparable certificate/activity series, and an unconfirmed provider offering. Each is evidence for a specialist interpretation rather than an automatic closure prediction.

## 10. Receive and update the original workbench

Append these source and reference tables through the existing application's original source intake. Preserve its project identity, source history, reviews, analysis runs and returned working copy. OWNER_INTEGRATION.md defines the file-to-table mapping and the exact seed exclusions.

Complete acceptance is a reproducible baseline package: original selected bytes, explicit joins, unresolved records, source-bound research decisions, comparable measures, complete methods and a cold-reopen working copy. The research lead owns population/content interpretation and provider engagement; engineering owns faithful intake, joins, history, computation and portable receiving.

When a following publication arrives, attach it as a new edition, compare by the same native keys, and show additions, changes, retirements and unresolved mappings. Earlier decisions and analysis remain inspectable. Repeating the method should require selecting new sources and reviewing material changes, rather than rebuilding a hidden spreadsheet workflow.
