# Laboratory method definitions from request to report

The existing **Laboratory requests and returns** and **Laboratory CSV results**
controls now carry an explicitly declared analytical method naming context and
full method name through the original request, returned file, saved observation,
reconciliation and scientific report.

A context identifies the naming authority supplied by the source. A full name
retains its declared text. Neither field implies that two protocols are
scientifically equivalent.

## Prepare the actual requested definition

Select original saved sample activities and enter the requested parameter.
The existing unit, basis, fraction and method controls remain. Two optional
fields are available beside Method:

- **Method naming context (optional)**;
- **Full method name (optional)**.

Enter a context/name only when the request specifies that definition. Each
nonblank field restricts the return comparison by exact declared text. Blank or
whitespace-only optional values are omitted from the normalized request.

Orders can distinguish identical method codes belonging to different naming
contexts. They can also explicitly distinguish different full names. The
original sample, collection time, site, visit and custody references continue
to come from the selected saved revision.

The complete request retains the actual context/name in selection.json,
dispatch.json and lab-submission.csv. When any order supplies either new field,
the return template includes requested_method_context and requested_method_name
beside separate blank method_context and method_name result fields. The
generated return-mapping.json maps the actual result fields.

The template leaves actual context/name cells blank. The laboratory's returned
definition supplies those values; the requested columns remain original request
metadata.

## Import the original laboratory results

Open the existing Laboratory CSV results intake. Map **Method naming context**
and **Full method name** to the actual source columns, or enter an explicit
source-supported constant. Ordered original-column fallbacks use the existing
mapping controls.

The native importer stores these declared strings on the observation as
method_context and method_name. The review displays the chosen method
definition, including blank mapped values. Original raw CSV bytes, full parsed
rows, original headers, selected columns, constants, row decisions and source
links remain in the existing source/audit attachments. The whole accepted
import still commits one original FIELD12 revision.

These fields are optional. Existing CSV mappings and laboratory operation
identities remain unchanged when the new fields are absent. An explicit result
replacement replaces its canonical method definition along with the other
selected measurement fields, preventing an old context from silently surviving
a newly supplied method. Unrelated original metadata remains retained by the
original replacement path.

## Compare the saved request with actual returned records

The original reconciler continues to compare exact activity and parameter,
plus any requested unit, basis, fraction and method. An explicitly requested
context or full name additionally compares the actual declared definition.

The shared method_context source helper supplies the original definition:

- Explicit native context/name retain their declared values.
- Original WQP analytical context/name can bind through the retained original
  result row when the saved method matches that row's identifier or full name.
- An unrelated original definition stays separately retained.
- No naming authority, alias equivalence or replacement method is guessed.

A directly order-linked record with a different or unstated requested
definition stays linked and receives an explicit definition issue; its status
is ambiguous. Without an explicit order link, a record matching the original
sample and base analysis but lacking the requested context/name is retained
as a competing result, with the requested and original returned definitions
shown. It does not count as a matched return.

The original behaviors remain for multiple matching records, overlapping
requests, sample-context changes, explicit missing results and unchanged
pre-existing observations. A returned count describes new or changed saved
records; actual transfers and custody events remain their original records.

The existing reconciliation view displays requested context/name, matched and
competing IDs, original returned definitions and their binding/source details.
The full exported reconciliation retains each source link and original CSV
record number used by the method definition.

## Prepare the existing scientific report

The maintained laboratory report source includes:

- requested context/name and returned definition records in requests.csv;
- actual canonical and source-derived method definitions in results.csv;
- complete original method dictionaries in result-records.json;
- the full original request package, saved plan and available source files;
- readable requested/returned method definitions in the existing six-column
  report sections.

The report uses the same registered source collector and original SourceReports
publisher. Its edition is laboratory-dispatch-report-20261013-v2-method-definition,
so a newly prepared derived report retains its own identity. Existing source
and report editions remain available. The original WQP cycle already binds the
runtime report edition and report operation; it can retain this new report
against the same original seed/applied laboratory revisions.

## Historical request and source continuity

Context-free requests keep the original normalized selection, order IDs,
dispatch identity, submission columns, return columns, return mapping and
package README. Adding blank new controls does not create a new package.
Original completed packages reconnect through their retained originals.

When a new nonblank context/name is explicitly requested, the changed selection
creates a distinct original request identity. Its extra columns and explanatory
README belong to that new package. No existing package member is overwritten.

The native dispatch and lab CSV operation edition constants stay unchanged
because these are optional input extensions; old inputs still produce their
original prepared source. The derived scientific report advances its edition
because its displayed method context and source tables expand.

## Original public source example

The actual Eighteenmile 2023 WQP source includes:

| Method | Declared context | Full original definition | Result rows |
| --- | --- | --- | ---: |
| 520019 | ABRAXIS LLC | Microcystins and Nodularins by Streptavidin-amplified ADDA Immunoassay, Microtiter Plate | 41 |
| 520011 | ABRAXIS LLC | Microcystins and Nodularins by Immunoassay, Microtiter Plate | 2 |
| 445.0 | USEPA | 445.0 ~ EPA; Chlorophyll and Pheophytin in Algae by Fluorescence | 45 |

The existing original 88-order receiving request already distinguishes these
method codes and remains unchanged. This extension permits an operator to
explicitly request the source-declared context or full name in a new request.
It does not relabel that authored receiving demonstration as a historical
laboratory shipment.

Source: observations/eighteenmile_2023/wqp_20261013/three-lake-results-2023-original.csv
in the published Upstate application, original SHA-256
5b22e3de1a4311963b2ed616886273788bd485897f276663157a7137ce0aaa61.

## Maintained native APIs and installation

Public preview/prepare/reconcile and laboratory inspect/preview/import
signatures remain unchanged. The original provider forwards the explicit
selection/mapping objects. The maintained queue, upload ticket, exact saved
revision checks and expected operation ID continue to govern both operations.

This source family updates the existing dispatch, laboratory CSV importer,
dispatch-report producer and their two native browser helpers. It requires the
maintained implementation_observation_quality.method_context helper from the
v4 source-method-context release. Existing installer entries already include
all five source paths; the new guide resides under the retained docs directory.
The native-only lab helpers require no separate standalone HTML rebuild.
