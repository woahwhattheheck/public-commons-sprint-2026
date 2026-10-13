# Monitoring interpretation in Published studies

The existing Published studies workspace now preserves a complete monitoring interpretation: original observations, a selected criteria edition, analyst applicability, every sampling window, an immutable saved version, and a portable source package. It consumes the retained measured observations already imported by this application. Native NDR/SDR loads remain separate scientific products.

## Original observations and source profiles

The initial complete utility study contains 730 original E. coli rows from 36 stations. The retained methods are APHA 9223-B (492), APHA 9221-F (222) and USGS BAC94 (16); there are nine literal project identifiers and 19 reported 0.3 m depths. Original source columns remain in every record and export. The one field replicate remains visible outside the independent routine-sample calculation.

Four USGS-02177000 observations retain the laboratory comment “holding time exceeded”: 7 June, 19 July, 7 November and 29 March 2022. They are excluded from supported calculation by default. The existing qualified-record choice requires an explicit rationale before including them. These selected records still prevent an unsupported complete-window conclusion when excluded.

The complete profile catalog is in source/monitoring_interpretation_20261013/profiles.json. Its 40 entries distinguish:

- South Carolina ambient E. coli 126/349; Georgia Recreation 126/410, and season-specific Fishing/Drinking Water 126/410 or 265/861.
- The complete paired EPA bacterial alternatives and their separate beach action values.
- Measured microcystin and cylindrospermopsin reference magnitudes, with single-day advisories and the EPA ten-day/season criterion represented separately.
- South Carolina lake chlorophyll magnitude screens and Georgia's 23 specified lake-location seasonal profiles.

The source guide contains the exact authority, publication edition, rule locator, designated-use and method distinctions. A profile is selected explicitly; the application does not infer a classification from a state, utility or nearby station.

## Working with an interpretation

Open the existing workspace and the exact retained study version in Published studies. The Monitoring interpretation controls select a profile, original station/parameter/calendar filters and a date interval. Enter the actual analyst and site/use/method rationale and review the profile's confirmations.

Preview displays the original row decisions and every analytical window. Review the actual measured unit alongside the criterion unit. An MPN observation remains MPN under a CFU-based reference; it is never relabeled or converted. Missing method, fraction, depth or time support remains visible. Original fields omitted by a normalization step are recovered from their unchanged raw source cells, with the recovered field and original column recorded. Conflicting source and normalized support prevents a supported result.

Save binds the exact preview, original study inventory and complete criteria source edition. The same request reuses the same immutable interpretation. Editing the selection or reasoning creates another content identity; a parent identity retains the interpretation's history. A parent revision must keep the same original study edition.

Open a saved interpretation to inspect its retained result. Export produces report.html, observations.csv, windows.csv, interpretation.json and monitoring-interpretation.zip. The ZIP also includes the entire original study, every selected catalog source, this native calculation module and a readable opening guide. Import that ZIP through the same application to reopen the original interpretation and study. It preserves an existing workspace's current study selection.

## Calculation and support

The application keeps stations, parameters, original units, laboratory methods, sample fractions, depth, projects and original series dimensions separate. A source-declared agreeing activity is weighted once, retaining all original ResultIdentifiers. Source-declared statistical exclusions remain excluded.

Original decimal tokens are preserved. Multiplication by a unit factor of one leaves the exact token value unchanged. Threshold decisions for means and fractions use exact rational comparisons; displayed geometric means use an explicit high-precision logarithmic calculation. Equality is not an exceedance of a strict greater-than criterion.

Below-limit and above-limit observations retain their actual bound and open/closed endpoint. Comparator tokens must agree with the retained explicit bound. A source >=410 is not certainly above a strict >410 threshold. No half-limit, zero or detection-limit substitution is introduced. Missing or unsupported bounds remain unresolved.

Excursion fractions retain every selected canonical routine result in the denominator, with unknown results widening the possible fraction. Quantified-only descriptive results cannot stand for a complete window. The original n, supported_n, numeric basis and reason codes travel with each outcome. Ambiguous missing cohort support is shown separately and prevents a supported assessment in a compatible window.

Geometric-mean support requires positive exact measured values, the profile's minimum sample count and any required sample spacing. Bounds can still show a descriptive range, but a censored/missing/nonpositive result prevents an exact supported GM. Date-only samples do not establish 24-hour spacing: the recorded time and time-zone label are required.

A rolling 30-day window includes its sampled endpoint date and the preceding 29 calendar dates. Windows truncated by the selected period, year, months or applicable season are marked explicitly. Unsampled dates never become zero measurements.

A Georgia seasonal chlorophyll comparison requires one explicitly reviewed monthly photic-zone composite in each April–October month at the named lake location. Missing months, unresolved representatives or an unconfirmed sample type prevent complete seasonal support. The five-year recurrence remains a separate contextual rule. SC lake values remain magnitude screens because their selected clause supplies no duration.

The EPA cyanotoxin ten-day/season frequency is displayed as NOT_ASSESSED in this edition. Its assessment periods, recreation season and authority-selected upper-bound years remain required contextual inputs. The engine does not substitute a ten-day mean or count overlapping rolling windows as excursions.

These are sampled-observation comparisons. They do not issue an advisory, closure, safe-swimming statement, regulatory compliance decision, drinking-water conclusion or modeled toxin result.

## Native commands

Run commands with the maintained complete application's Python and source directory:

    python -m measurement_workspace.monitoring_interpretation --workspace /original/workspace catalog
    python -m measurement_workspace.monitoring_interpretation --workspace /original/workspace --result /receiving/preview.json preview --request /receiving/request.json
    python -m measurement_workspace.monitoring_interpretation --workspace /original/workspace --result /receiving/saved.json save --request /receiving/reviewed-request.json
    python -m measurement_workspace.monitoring_interpretation --workspace /original/workspace open --interpretation-id interpretation-HASH
    python -m measurement_workspace.monitoring_interpretation --workspace /original/workspace export --interpretation-id interpretation-HASH --out /receiving/export
    python -m measurement_workspace.monitoring_interpretation --workspace /receiving/reopened-workspace receive --source /receiving/export/monitoring-interpretation.zip --operation-id ORIGINAL-OPERATION

The request retains study_id, version_id, profile_id, selection, period, applicability and options. Saving additionally requires title and the exact returned preview_id; parent_id is optional. The original operator queue uses published-study.interpretation.save, .export and .import. Its source selector and normal immutable file tickets remain unchanged.

The original full-course receiver is:

    python source_tools/receive_monitoring_interpretation.py \
      --application /original/application \
      --workspace /original/workspace \
      --out /original/receiving/wo30-monitoring \
      --operation-id ECO-WO30-MONITORING-INTERPRETATION-3FC8-20261013

It imports the installed complete utility cohort only if not already present, previews and saves the descriptive source comparison, reopens the identical save, exports all originals, and cold-imports the actual package into an independent native Workspace. It records real identities and file hashes in receiving.json. The default descriptive request does not fabricate an analyst's site/use confirmation.

## Existing receiving and delivery

This feature joins the existing Eco native application and its original receiving operation. Keep the current workspace, original 15227 installer, source editions and completed science outputs. The current native receiver may compose these new files into its retained application after preserving the current shared application files; the full application installer carries the complete profile and browser dependencies.

Carry CURRENT_OWNER_DIRECTION.md version 2026-10-13.4 and AGENTS.md version 2026-10-13.1. The earlier time cutoff is historical. Operate the exact browser controls, view desktop and narrow screens, open every downloaded attachment and use the cold-reopened workspace before presenting the outgoing edition. The meaningful result is the working interpretation and complete received science package; source compilation alone does not replace its actual use.


## Readable scientific report

The complete HTML download opens with the selected evidence, date support, separate station/method/unit series, comparison profile and actual applicability state. Station tables retain every metric window, original denominator, numerical-support count, result or censor bounds, measured unit, reference unit and source-support explanation. Excursion fractions distinguish the measurement threshold from the permitted fraction. Overlapping window counts are analytical windows, not independent regulatory events.

Analyst choices, method rationale and every required site/source confirmation are readable fields. Profile rules, minimum-sample basis, minimum spacing, season, contextual frequency and limitations use readable tables and expandable method descriptions. Primary publication links come from the exact saved source index; the report retains its original catalogue when an installed source changes. Reading the result requires no JSON editing.

The full original-row table remains in the report, including laboratory comments and exact CSV locators. CSV, JSON, original-study ZIP and every retained reference file remain ordinary downloads. The complete source ZIP includes the generated report and exact rendering module. This presentation preserves the saved calculation identity, observations, thresholds, numerical comparisons, request and original source bindings.
