# Implementation workbench data contract

Canonical plan: `upstate.implementation-plan/v1`  
Companion catalog: `upstate.implementation-methods/v1`  
All canonical field names use snake_case. UTF-8 JSON is the interchange format.

## Core plan document

| Field | Shape and meaning |
|---|---|
| `schema` | Exactly `upstate.implementation-plan/v1`. |
| `id` | Stable plan identifier; preserved across offline round trips. |
| `revision` | Integer document revision managed by the implementation engine. Retain the exported source revision while editing offline. |
| `title`, `description` | Plan name and scope. |
| `start_date`, `target_date` | Calendar dates as YYYY-MM-DD; target_date is optional. |
| `currency` | Currency for every budget entry, normally USD. |
| `working_days` | ISO weekdays 1–7; default [1,2,3,4,5]. |
| `holidays` | Calendar dates unavailable for scheduling. |
| `created_at`, `updated_at` | ISO timestamps with explicit time-zone offset or Z. |
| `source_links` | Referenced procurement, model, guidance, attachment and other source records. |
| `candidates` | Frozen source candidate records and any attached model outputs. |
| `tasks` | Assigned implementation work and dependencies. |
| `budget_lines` | Typed budget, commitment and actual-cost entries. |
| `sites` | Stable monitoring or implementation locations. |
| `monitoring_plans` | Scientific questions, sites, parameters and collection design. |
| `visits` | Planned or completed site visits. |
| `activities` | Separately identified sample, measurement, inspection or photo activity. |
| `observations` | Numeric, censored, text or missing results linked to activities. |

The engine retains unknown extra JSON fields verbatim. Use that facility for method/form metadata and source provenance while preserving the canonical fields. An additive field cannot replace a required core field.

## Source link and candidate

`source_links[]` has `id`, `kind`, `label` and optional `reference`. A typical record is:

```json
{
  "id": "epa-wqx-concepts",
  "kind": "guidance",
  "label": "EPA WQX concepts and definitions",
  "reference": "https://www.epa.gov/waterdata/concepts-and-definitions-storage-and-retrieval-and-water-quality-exchange"
}
```

`accessed_at`, `source_date`, `sha256` and a source-location note can be retained as additive metadata. A source reference may identify a file, source record or URL; use the project's actual reference.

A candidate has `id`, `label`, `source`, `modeled_benefits` and optional `area_ha`. The source is a nonempty original-reference string or a frozen source snapshot object. An empty `modeled_benefits` array means no modeled benefits were supplied. Store a supplied projection with its original metric, unit, spatial scope, time basis, model/run identity and assumptions. Implementation progress never updates this array automatically.

## Task

```json
{
  "id": "plan-001-buffer-design",
  "title": "Save site design and planting specification",
  "candidate_id": "candidate-001",
  "phase": "design",
  "assignee": "Design lead",
  "status": "planned",
  "duration_days": null,
  "depends_on": ["plan-001-buffer-recon"],
  "progress_pct": 0,
  "notes": "",
  "evidence_refs": []
}
```

This is a format illustration; referenced IDs must exist in a complete imported plan. `candidate_id` and `start_not_before` are optional. Status is `planned`, `in_progress`, `complete` or `cancelled`. Duration is a nonnegative integer or null. Dependencies address task IDs in the same plan, cannot refer to the task itself and must form an acyclic graph. Progress is a task percentage.

Every catalog duration is null. An estimated duration must be explicitly entered in the saved plan. For a zero-duration milestone, enter 0. Named assignee roles from the catalog can be replaced by actual people without altering task IDs.

For tasks instantiated from a catalog method, preserve additive `method_id`, `method_version`, `task_template_id`, `deliverables` and `form_ids`. Configuration fields such as planting width or the applicable design reference can be stored under additive `method_configuration`.

## Budget line

```json
{
  "id": "cost-line-001",
  "task_id": "plan-001-buffer-design",
  "kind": "budget",
  "label": "Site design allowance",
  "amount_minor": 12500,
  "date": "2026-10-12",
  "reference": "project-estimate-reference"
}
```

The amount illustrates integer currency storage, not a project estimate. `task_id`, `date` and `reference` are optional. `kind` is exactly `budget`, `commitment` or `actual`; `amount_minor` is a nonnegative safe integer. Keep totals separate by kind. Unknown cost is represented by no amount-bearing entry until an estimate or transaction is entered. Do not create a zero-cost line as a placeholder for unknown cost.

The core ledger has no negative adjustment type. Revise the effective entry with revision history when reducing a commitment or correcting a cost. A payment must not duplicate an already recognized invoice as a second actual expense.

## Site and monitoring plan

A site has `id`, `label` and optional `latitude`, `longitude`, `candidate_id`, `source_ref`. Site `source_ref` resolves to a `source_links.id`. If coordinates are recorded, retain their real spatial reference and acquisition method in additive `coordinate_reference_system`, `coordinate_method`, `horizontal_accuracy_m` and `location_description`. `alternate_ids` can preserve WQP, utility or agency station IDs. Coordinates are never inferred from the candidate label.

A monitoring plan has:

```json
{
  "id": "campaign-001",
  "title": "Targeted source-water investigation",
  "objective": "The explicit question this campaign will answer.",
  "site_ids": ["site-001"],
  "parameters": ["Exact characteristic as reported by the chosen method"],
  "method_ref": "collection-and-analysis-procedure-reference",
  "frequency": "Project-specific timing or event trigger",
  "notes": ""
}
```

The site IDs must resolve. Each parameter is a nonempty string. `method_ref` and `frequency` are optional core fields but should be supplied when preparing collection. Additive design metadata may include `design_type`, `site_roles`, `sample_types`, `quality_plan_ref`, `laboratory_id` and `interpretation_assignee`.

## Visit and activity

A visit has `id`, `site_id`, optional `monitoring_plan_id`, optional `planned_date`, optional `visited_at`, `observer`, `status`, `notes` and `evidence_refs`. Status is `planned`, `complete` or `cancelled`. A completed visit requires `visited_at` with a time zone. `planned_date` is a date.

An activity has `id`, `visit_id`, `site_id`, `kind`, optional `sample_id`, `collected_at`, `method`, `custody_ref` and `notes`. Activity kind is `sample`, `measurement`, `inspection` or `photo`. A sample activity requires the original `sample_id`. The activity site must match the referenced visit's site. Any `collected_at` timestamp includes a time zone.

A field visit can have several activities. Create separate sample activities for routine samples and relevant quality-control samples; retain the actual sample type in additive `sample_type`. A laboratory blank may use the campaign's designated laboratory/QC location convention where supported by the adapter. Avoid inventing a river location for an unlocated QC procedure.

Recommended additive capture fields include `medium`, `collection_method_ref`, `handling_method_ref`, `depth_value`, `depth_unit`, `instrument_ref`, `weather`, `hydrologic_context`, `deviations` and `form_responses`. The latter can retain a catalog form ID, version and keyed answers.

## Observation

Core fields:

| Field | Meaning |
|---|---|
| `id` | Stable observation ID. |
| `activity_id` | Existing parent activity. |
| `parameter` | Exact characteristic or observation label. |
| `result_type` | numeric, censored, text or missing. |
| `value` | Finite numeric result for numeric; null for the other kinds. |
| `original_text` | Value exactly as reported or entered. |
| `unit` | Unit as reported; required for numeric and censored results. |
| `basis` | Optional method speciation/chemical basis, such as as N. |
| `fraction` | Optional sample fraction or filtration description. |
| `qualifier` | Optional result qualifier; required for censored results. |
| `detection_limit`, `quantitation_limit` | Optional reported limits. |
| `method` | Optional analytical or observational method. |
| `qa_status` | Optional review state. |
| `notes` | Context, reason for missing result or review details. |

Numeric records require a finite `value`, `original_text` and `unit`. Censored records require `value:null`, `original_text`, `qualifier` and `unit`. Text and missing records also use `value:null`.

An illustrative censored result, independent of any real field campaign:

```json
{
  "id": "illustration-observation-001",
  "activity_id": "illustration-activity-001",
  "parameter": "Example analyte",
  "result_type": "censored",
  "value": null,
  "original_text": "<0.01",
  "unit": "mg/L",
  "qualifier": "less_than_reporting_limit",
  "quantitation_limit": 0.01,
  "method": "Actual report method goes here",
  "qa_status": "unreviewed",
  "notes": "Format illustration."
}
```

A censored bound is not the measured concentration. Where several limits are reported, additive `limits` can retain objects with `type`, `value`, `unit` and `source_ref`. Preserve the core limit field where it is unambiguous and keep exact original limit labels in the additional objects. Additive `analytical_method`, `laboratory`, `source_ref`, `analyzed_at` and `quality_review` can carry fuller metadata without replacing `method` or `qa_status`.

The recommended review vocabulary is unreviewed, accepted, qualified and rejected. Maintain the report's own qualifiers separately from the local review status. Keep nutrient speciation and fraction explicit. Retain the laboratory's units and exact analyte naming for bacteria and cyanotoxins. Later unit conversion or statistical substitution is an analytical transformation with its own provenance.

## Import and offline concurrency

The engine validates IDs and relationships, date/timestamp forms, task dependencies, finite values and typed budget amounts. Unknown additive metadata is retained. The import operation compares the source snapshot digest and revision with the current document.

| Incoming snapshot | Behavior |
|---|---|
| Identical source digest and revision | Deduplicates; retains IDs and current state. |
| Edited snapshot with source revision equal to current stored revision | Imports as the next local revision. |
| Different stale or future snapshot | Preserves the input as a conflict JSON file and reports its actual path through RevisionConflict; the existing document remains available. |

For conflict reconciliation, open the retained snapshot and current plan, combine intended changes into a copy based on the current revision, and import that copy. Field observations retain their original activity/sample IDs through the process. Keep the original export until the returning snapshot has been reconciled.

## Catalog contract

`upstate.implementation-methods/v1` contains:

- `id`, `version`, `plan_schema` and `created_at`.
- `planning_defaults` with null durations, costs, benefit coefficients and monitoring frequency.
- `role_types` defining named responsibilities.
- `method_templates`, each with purpose, source IDs, configuration fields, task templates, milestones and monitoring/form references.
- `field_forms`, each with stable ID, version and keyed typed fields.
- `monitoring_profiles` and characteristic metadata prompts.
- `source_links` suitable for copying into the plan's source register.
- `instantiation` instructions for ID translation and metadata preservation.

Catalog field types describe a capture UI; form answers are recorded as typed JSON values under `form_responses`, and scientific results also become canonical observations. Form responses do not substitute for the observation fields required by the implementation engine.

Each method's task IDs are template-local. At instantiation, prefix or otherwise namespace them with the plan/method instance and translate dependencies. Each method can be instantiated multiple times for different candidates. A single source candidate can also support multiple methods when their tasks, installed quantities and costs remain distinct.

## Scientific and mapping basis

This internal contract takes its location/activity/result structure from EPA WQX concepts and preserves nutrient and detection metadata described by EPA guidance:

- https://www.epa.gov/waterdata/concepts-and-definitions-storage-and-retrieval-and-water-quality-exchange
- https://www.epa.gov/waterdata/water-quality-data-upload-wqx
- https://www.epa.gov/sites/default/files/2017-06/documents/wqx_nutrient_best_practices_guide.pdf
- https://www.epa.gov/system/files/documents/2025-09/wqxdetectionlimitsbestpracticesguide_final.pdf

WQX export maps this contract into current destination templates, validation rules and domain values while retaining local IDs and destination IDs. The source-link register and operating guide contain the full project and method bibliography.
