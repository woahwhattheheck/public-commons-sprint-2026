# Municipal service configuration

Service Configuration is a complete operating workbench for the agency settings behind a municipal request service. It saves departments, staff, role and group declarations, service categories, submission fields, routing, resident and staff messages, and an implementation plan. Each saved routing preview applies one exact configuration version to a complete original request register.

The browser, CLI and typed merchant provider open the same private SQLite workspace. Complete editable handovers preserve original source bytes, configuration history, row-level routing choices, rendered messages, declared deployed baselines, implementation releases and original action recovery.

## Operating workflow

1. Retain the original JSON file and select its exact array of requests. Inspect the original fields and map their meanings explicitly.
2. Define the agency, local time zone and due-date calendar. Add departments, named staff, role/group declarations and category responsibility.
3. Configure category selectors, custom submission/location fields, routing conditions, stage-specific message templates and the rollout plan.
4. Save a complete configuration version. Preview the whole selected source using that exact version, with explicit record overrides and any declared deployed baseline.
5. Inspect every unmatched, conflicting or invalid routing result, the original values used in decisions, local due dates, public-map choices and exact message text.
6. Save a named implementation handover from the matching current profile and preview. Export its JSON, printable operating report, full routing CSV and editable workspace.
7. Receive the full workspace into an empty directory and continue the same source and configuration history.

The six-application source selection also includes Open311 collection, reporting, GIS, request/work-order Follow-through and Field Desk. Complete original exports connect these workspaces. [INSTALL.md](INSTALL.md) describes the maintained installed package; [WORKSPACE.md](WORKSPACE.md) describes the full operator interface.

## Configuration model

| Area | Saved configuration |
| --- | --- |
| Agency | Name, identifier, time zone, calendar/business days, eligible weekdays and holidays |
| Departments and staff | Active departments, named staff, department membership, contact, selected role and groups |
| Permissions | Explicit CRM enablement, administrator and access declarations on named roles/groups |
| Categories | Exact original source selectors, responsibility, keywords, display order, location policy and public-map default |
| Custom fields | Text, number, Boolean, date, single-select and multi-select submission/location fields |
| Routing | Exact typed source/custom-field conditions, eligible categories/sources, responsible staff and collaborators |
| Communication | Staff/resident audience, mapped stage, locale, subject/body and explicit resident-facing wording |
| Source profiles | Original row-array pointer, 23 semantic mappings, native status meanings and public-map mapping |
| Rollout | Named phases, audience, owners, training, entry/exit criteria and notes |

A saved profile is immutable. Editing creates a new version retaining its predecessor. The optional deployed baseline identifies a saved original profile/version and the operator who declared it; migration implications refer to that explicit baseline.

Role and group records preserve declared permissions and the application sequence. The workbench retains those declarations alongside staff assignment and review; the original vendor settings and selected baseline explain the implementation steps.

## Original source and routing semantics

Source inspection lists every original array with its row count and field names. An empty row pointer selects a root array. Mappings use RFC 6901 pointers relative to each original row, or explicit literal JSON values. The source file, original whitespace and UTF-8 byte identity remain available for download.

The mapping vocabulary covers request and issue/case identifiers, service/category/title/description, dates, native status and notes, address/coordinates, resident contact and links, work-order IDs, completion/progress wording and map visibility. It supports Open311 records, Follow-through dispatch rows, Field Desk destination rows and an explicitly mapped register.

Route selectors combine with AND; each declared eligibility list combines its values with OR. Exact JSON scalar types matter. Multiple matching routes remain a visible conflict. A category's valid default responsibility can handle a request with no matching route. Record overrides preserve their original source key and a reason.

Native status values remain part of the original source. Their saved mappings select received, assigned, in-progress, resolved or closed-other stages and an explicit completion meaning. Source dates retain their original values. Due dates use an offset-bearing creation instant, the agency time zone and the selected local calendar; business-day addition uses eligible dates after the local creation date, and zero days retains that date.

Public-map decisions preserve the category default, an explicit typed source-value mapping and any row override. Missing/unrecognized source values produce visible findings according to the saved mapping.

## Messages and implementation releases

Every rendered message retains its original template, audience, stage, recipient, bound values and unresolved tokens. The source issue number is an explicit mapping. Resident-facing assignee, completion and progress wording can be declared separately from internal operating records. Preview messages retain their `deliveryState: 'PREVIEW'` field.

A release binds the exact saved configuration, preview, original source and deployed-baseline declaration. Its complete application stages, remaining requests, migration implications and reviewer notes travel together. Later profile changes require a new matching preview before creating another release.

The format and primary-source rationale are documented in [SOURCE_CONTRACT.md](SOURCE_CONTRACT.md); [SOURCE_REGISTER.json](SOURCE_REGISTER.json) retains source references, and [MODEL_CONTRACT.json](MODEL_CONTRACT.json) names the implemented vocabulary.

## Direct CLI

From the repository root, initialize and open a private directory:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/open311/service-configuration/cli.mjs init \
  --workspace /absolute/private/service-configuration

node stellar/scf-starforge-20261009/sf30-seller-sdk/open311/service-configuration/cli.mjs serve \
  --workspace /absolute/private/service-configuration --port 8771
~~~

Run `help` for every command. Mutable commands use the original `--request-id` and observed `--revision`. A repeated exact intent returns its saved result.

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/open311/service-configuration/cli.mjs source-inspect \
  --input /absolute/original/requests.json

node stellar/scf-starforge-20261009/sf30-seller-sdk/open311/service-configuration/cli.mjs source-import \
  --workspace /absolute/private/service-configuration \
  --input /absolute/original/requests.json --rows-pointer "" \
  --name "Original service requests" --request-id source-001 --revision 0

node stellar/scf-starforge-20261009/sf30-seller-sdk/open311/service-configuration/cli.mjs profile-save \
  --workspace /absolute/private/service-configuration \
  --input /absolute/original/service-definition.json --request-id profile-001 --revision 1
~~~

Use the returned profile ID, profile version and source ID when creating the preview:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/open311/service-configuration/cli.mjs preview-create \
  --workspace /absolute/private/service-configuration \
  --profile-id PROFILE_ID --profile-version PROFILE_VERSION_ID \
  --source-id SOURCE_ID --source-profile SOURCE_MAPPING_ID \
  --name "Complete request routing" --request-id preview-001 --revision 2

node stellar/scf-starforge-20261009/sf30-seller-sdk/open311/service-configuration/cli.mjs release-create \
  --workspace /absolute/private/service-configuration \
  --profile-id PROFILE_ID --profile-version PROFILE_VERSION_ID --preview-id PREVIEW_ID \
  --name "Reviewed service implementation" --reviewer "Implementation owner" \
  --request-id release-001 --revision 3
~~~

The revision values above follow a newly initialized sequence. Read `state` for the actual revision when continuing another workspace.

## Exports and receiving

| Kind | Complete saved content |
| --- | --- |
| workspace | Original files, all configuration versions, previews, releases and operation history |
| profile | Selected saved configuration version |
| source | Exact retained original JSON bytes |
| preview-json | Full routing preview with its selected profile, source and baseline |
| preview-csv | Every routing row and its recorded decision fields |
| release-json | Complete reviewed implementation package |
| release-report | Printable operating handover with original choices and rollout |

Exports use create-only output paths. A chosen `--revision` binds an export to the observed workspace edition. Receive the complete workspace into a new empty directory:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/open311/service-configuration/cli.mjs export \
  --workspace /absolute/private/service-configuration --kind workspace \
  --output /absolute/handover/service-workspace.json --revision 4

node stellar/scf-starforge-20261009/sf30-seller-sdk/open311/service-configuration/cli.mjs receive \
  --workspace /absolute/private/received-service-configuration \
  --input /absolute/handover/service-workspace.json \
  --request-id receive-service-001 --revision 0
~~~

The received workspace preserves its source UUID and original history, adds the receiving receipt, and remains editable. Unchanged export bytes are stable across process reopen. [MCP.md](MCP.md) provides named host inputs, the 19-tool operating catalog and the typed full-file receiving interface.
