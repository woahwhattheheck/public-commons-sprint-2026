# Structured field capture and handover

The implementation workbench captures the eight installed field forms from the complete `upstate.implementation-methods/v1` catalog. The current catalog contains 65 fields.

## Canonical activity extension

Each submitted form creates one activity linked to an existing visit and its site. The activity retains `implementation_task_id` when a task is selected. The native fields remain `id`, `visit_id`, `site_id`, `kind`, `sample_id`, `collected_at`, `method` and `notes`.

The additive `form_response` object contains:

| Field | Content |
| --- | --- |
| `catalog_id`, `catalog_version` | Exact installed catalog identity |
| `template` | Complete original form definition, including its ID, version, label, field keys, types and constraints |
| `answers` | Structured values for nonblank entered fields |
| `raw_answers` | Original submitted text for every template field; quantity units use the additional key `<field_key>__unit` |
| `recorded_at` | UTC timestamp when this record was created; actual field time stays in activity `collected_at` |

## Value handling

| Catalog type | Retained answer | Canonical result |
| --- | --- | --- |
| `quantity` | `{value, unit, original_text}`; unit comes from the entered unit field | Numeric, original text and entered unit |
| `integer` | `{value, unit, original_text}`; value must be a safe whole number | Numeric; declared catalog unit or `1` for dimensionless count |
| `number` | `{value, unit, original_text}` | Numeric; declared catalog unit or `1` |
| `attachment_refs`, `activity_refs` | `{references: [original reference strings], original_text}` | Text, `value:null`, original entered reference text |
| Other types | Original entered string | Text, `value:null`, original text |

Numeric constraints apply exactly as declared in the template, including minimum, maximum and exclusive bounds. The photo-point bearing is at least 0 and less than 360 degrees. Optional blank fields create no measured result; an entered zero remains zero. The original raw text remains available independently of parsed values.

Activity reference fields resolve to existing activities at the selected visit and site. Monitoring-plan reference fields resolve to a plan containing that visit site. File references use one reference per line, preserving embedded commas. Choice values must be declared in the catalog. Sample activities require their original sample ID.

## Editing and delivery

Editing an existing activity or observation starts from the complete existing row, preserving additive metadata. Activity sites follow their selected visit. Site source references select retained `source_links` IDs. Existing candidate and source-reference dialogs edit labels while retaining original source bindings and snapshots.

The human HTML handover includes visible field-label/answer tables, original numeric text and units, activity notes, result notes, detection limits and quantitation limits. The full stored form template and response also remain inside a readable details section. The complete plan JSON and existing CSV paths retain the underlying operational records.

Source-native modeled quantities remain with their original imported candidate and source snapshots. Capturing implementation work or monitoring results does not recompute those quantities.

## Applying the report patch

Replace only `export function reportHtml(...)` in `operator/web/implementation_core.mjs` with the supplied `reportHtml.replacement.mjs`. Keep the validator, scheduler, other exports and any later source-preservation changes. Root may place report functions in a separate module while preserving the existing public exports.
