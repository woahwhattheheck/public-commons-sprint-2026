# Odoo target baseline, staging reconciliation and receiving

This component reads the selected Odoo target into a complete retained capture, supplies the existing contact preparation with that baseline, and compares a later target capture with the actual staging-import result. It preserves original External IDs, physical partner IDs, company context, archived records, parent relationships and every acquired alias. The existing Odoo worker performs the commissioned import. The existing Analysis workflow supplies saved queries, published reports, request history and the complete editable project archive.

The protocol is Odoo's JSON-2 API, introduced in Odoo 19. The source contracts below were reviewed against the official Odoo 19 documentation and implementation on **13 October 2026**. Each capture binds its actual server version and the actual returned field metadata.

## 1. Install the complete source and select the existing target

Use Node 20 or later and run from the installed `datasette-analysis/partner-workflows` directory. Keep these eight files together:

| File | Responsibility |
| --- | --- |
| `odoo_target.mjs` | Selected scope, read requests, complete passes, target projection and original preparation composition |
| `odoo_target_cli.mjs` | Authenticated capture, retained responses, recovery, preparation, reconciliation and receiving |
| `ODOO_TARGET.md` | This operating guide |
| `preparation.mjs` | Existing contact mapping, field ownership, exceptions and staging comparison |
| `profiles.mjs` | Complete native Analysis table configuration |
| `prepare_cli.mjs` | Existing preparation publisher and receiver |
| `README.md` | Original Analysis workflow and native project receiving |
| `SOURCE_CONTRACTS.md` | Original source fields and commissioning contract |

The full product supplies the maintained CSV parser, `workflow_cli.py`, Python Analysis runtime and original installation source archive. The capture retains the eight files above as its exact editable source edition.

Select the actual HTTPS origin, database, authenticated user, company context, migration namespace and External ID scope from the existing installation. Its API key stays in the existing environment variable selected by `--token-env`. The CLI sends a bearer API key and the selected `X-Odoo-Database` header; its retained requests omit the token value.

Odoo's JSON-2 reference documents the `/json/2/<model>/<method>` route, a direct JSON return value on success, and structured HTTP errors. The target's dynamic `/doc` page describes installed models and methods. The documentation identifies external API access for Custom Odoo plans. Use the commissioned target's actual API entitlement and grants. [Official JSON-2 reference](https://www.odoo.com/documentation/19.0/developer/reference/external_api.html).

This acquisition needs ordinary read access to `res.users`, `res.company`, `res.partner` and the selected `ir.model.data` alias rows and fields. The standard Odoo 19 access file gives regular internal users no direct `ir.model.data` model access, while its administration group has access. Bind the existing integration's actual authorized alias-reading permission. Odoo applies its normal record and field rules to the calls. [Official access definitions](https://github.com/odoo/odoo/blob/19.0/odoo/addons/base/security/ir.model.access.csv).

## 2. Configure the exact target scope

This example shows the configuration shape. Replace every example host, database, numeric identity, namespace, module and explicit alias with values from the actual target and original contact operation.

```json
{
  "origin": "https://odoo.example.com",
  "database": "YOUR_ACTUAL_DATABASE",
  "expectedVersion": "19.0",
  "expectedUserId": 42,
  "allowedCompanyIds": [3, 7],
  "namespace": "customer_migration",
  "externalIdModules": ["customer_migration"],
  "explicitExternalIds": [],
  "parentAliasPolicy": "lexical-existing",
  "parentAliases": {},
  "pageSize": 200,
  "operationId": "YOUR-ORIGINAL-TARGET-CAPTURE-ID",
  "title": "Selected Odoo contact baseline",
  "publisher": "Actual target database operator"
}
```

The numeric examples identify no real customer. Use the installed user and companies. `expectedVersion` is the exact actual `version` string returned by `GET /web/version`; the adapter requires a JSON-2-capable version with major version at least 19.

| Field | Contract |
| --- | --- |
| `origin` | HTTPS origin with no credentials, query, fragment or application subpath |
| `database` | Exact selected database name |
| `expectedVersion` | Exact original server-version string |
| `expectedUserId` | Positive integer identifying the API key's actual user |
| `allowedCompanyIds` | Nonempty ordered unique positive IDs for this operation |
| `namespace` | Original contact migration namespace: lowercase letter followed by up to 39 lowercase letters, digits or underscores |
| `externalIdModules` | Complete selected module names; must include the migration namespace |
| `explicitExternalIds` | Optional additional exact `module.name` IDs outside those modules |
| `parentAliasPolicy` | Required explicit `lexical-existing` policy |
| `parentAliases` | Optional original parent numeric ID to a reviewed existing External ID |
| `pageSize` | 1–1000, default 200 |
| `operationId` | Original capture identity, 1–128 letters, digits or permitted `._:-` characters |
| `title` | Actual capture purpose, up to 300 characters |
| `publisher` | Optional actual source attribution |

The configuration has no `schema` property and rejects unknown top-level fields. The module selection includes every generated ID in the original migration namespace. An existing mapped `targetExternalId` must fall within a selected module or be explicitly named.

Company ordering is material: Odoo takes the first `allowed_company_ids` value as the current company, and validates the selected set against the user's allowed companies. Retain that order across baseline and staging capture. The adapter also reads the actual user and company records. [Official company-context implementation](https://github.com/odoo/odoo/blob/19.0/odoo/orm/environments.py).

The stable `targetScope` binds origin, database, exact version, expected user, ordered company IDs, namespace, selected modules, explicit IDs and parent-alias policy/overrides. The later staging capture must produce the same scope. A changed company set, namespace, identity or alias policy establishes a new baseline.

## 3. Capture the original baseline

Create the selected parent directory, then run:

```sh
node odoo_target_cli.mjs capture \
  --config /private/customer/odoo-target-selection.json \
  --out /private/customer/odoo-target-before \
  --token-env EXISTING_ODOO_API_KEY_ENV \
  --max-attempts 8 \
  --timeout-seconds 60
```

The CLI retains the complete selection and source edition before reading the target. Every complete pass performs these operations:

| Phase | Original read |
| --- | --- |
| Server version | `GET /web/version` |
| Authenticated identity | `res.users/context_get` with no record IDs |
| User binding | `res.users/search_read` for the selected user, including login, active state and company membership |
| Company binding | `res.company/search_read` for the exact selected company IDs |
| Field schema | `res.partner/fields_get` and `ir.model.data/fields_get` |
| Selected aliases | `ir.model.data/search_read` where model is `res.partner` and the module or exact External ID is selected |
| Selected partners and ancestors | `res.partner/search_read` for those physical IDs and the complete observed parent chain |
| All existing aliases | `ir.model.data/search_read` for every acquired partner and ancestor |

The authenticated identity comes from the API key through `context_get`, whose actual implementation returns the environment's user ID. The supplied expected user is then compared with that result. [Official user implementation](https://github.com/odoo/odoo/blob/19.0/odoo/addons/base/models/res_users.py).

The read context includes `active_test:false`, so archived contacts remain part of the selected source. Records shared across companies retain their actual empty `company_id`; company-bound records retain the original company ID. An observed record outside the explicit company selection becomes a retained issue.

Selected aliases use ascending ID pages bounded by the highest alias ID observed for that pass. A page shorter than the requested limit continues until the retained high ID or an actual empty result is observed. Partner records are fetched in explicit ID batches. Parent IDs enter the same queue until the complete observed ancestor closure has been visited. The alias read for those partners retains all returned aliases, including aliases in other modules that identify the same physical record.

The adapter repeats the full version, identity, schema, alias and partner pass. It completes when two consecutive full observations agree. The fingerprint includes actual partner fields, aliases, schemas, user/company records and identified issues. Odoo runs each JSON-2 request in its own SQL transaction; the retained pass history records this observed consistency across the original calls.

## 4. Read the source accurately

### Field and identity mapping

| Odoo source | Original target representation |
| --- | --- |
| `ir.model.data.module` + `name` | Complete original External ID |
| `ir.model.data.res_id` | Physical partner ID |
| `res.partner.is_company` | `kind: company` or `kind: person` |
| `res.partner.parent_id` | Original physical parent ID plus selected existing parent External ID |
| `res.partner.name/email/phone` | Original owned-field baseline |
| `res.partner.company_id` | Actual selected company or shared-record state |
| `res.partner.active` | Active or archived source state |
| `res.partner.write_date` | Original write timestamp |
| All alias rows | Full module, name, model, physical ID and `noupdate` descriptors |

The schema check distinguishes a field's type from its serialized value. Odoo 19 declares `ir.model.data.res_id` as `many2one_reference`, which returns an integer record value. The regular `parent_id` and `company_id` fields are many-to-one relationships and return the ordinary ID/display-name pair or an empty value. The source retains those original raw representations. [External ID model](https://github.com/odoo/odoo/blob/19.0/odoo/addons/base/models/ir_model.py) · [Reference-field implementation](https://github.com/odoo/odoo/blob/19.0/odoo/orm/fields_reference.py) · [Partner fields](https://github.com/odoo/odoo/blob/19.0/odoo/addons/base/models/res_partner.py).

The original preparation receives `targetExisting` rows with `externalId`, `kind`, `parentExternalId`, `name`, `email` and `phone`. The acquired physical IDs, active state, timestamp and complete alias list travel alongside those fields. Empty original text values become the preparation's empty strings, with the complete original response retained.

### Parent aliases

One partner can have several original External IDs. The adapter retains every acquired alias and projects the ones supported by the original preparation. Its explicit `lexical-existing` policy chooses the lexicographically first existing alias supported by the original preparation for a parent's relationship. For a reviewed alternative, specify the actual parent's numeric ID and existing alias in `parentAliases`:

```json
{
  "parentAliasPolicy": "lexical-existing",
  "parentAliases": {
    "1234": "existing_module.actual_parent_alias"
  }
}
```

Use the same reviewed override in the baseline and later staging selection. An override must resolve to that exact observed parent. A missing parent, invisible target, missing expected alias, unsupported identity or parent without an existing usable alias remains an explicit review issue.

The acquisition retains every original alias row, including names containing Unicode or a slash. `observed.unrepresentableAliases` identifies aliases outside the existing preparer's supported External ID format. An additional incompatible alias remains in the raw source while compatible aliases identify the same partner. A selected incompatible alias becomes `SELECTED_ALIAS_REQUIRES_MAPPING_REVIEW`; an incompatible parent override becomes `PARENT_ALIAS_REQUIRES_MAPPING_REVIEW`. Those selections keep the baseline review-only. The module list and explicit-ID configuration preserve exact original names.

The acquisition reads existing `ir.model.data` rows. Odoo's `get_external_id` selects only one alias from a record's existing aliases, so it would discard information this workflow needs. Full alias acquisition preserves the relationship and collision review. [Official ORM implementation](https://github.com/odoo/odoo/blob/19.0/odoo/orm/models.py).

### Multiple source rows addressing the same physical partner

Different External IDs can point to one physical Odoo record. The preparation compares every mapped or deterministically generated source External ID with the captured physical partner ID. If multiple source rows would address the same physical record, it retains `MULTIPLE_SOURCE_RECORDS_TARGET_SAME_PARTNER` with the original source records and aliases. This sets the prepared baseline to review-only through the existing engine. Resolve that mapping in the source operation before the staging import.

## 5. Inspect, recover and preserve complete observations

```sh
node odoo_target_cli.mjs inspect --input /private/customer/odoo-target-before
```

Inspection verifies retained source identities and accepted request/response pairs. A completed capture also verifies its full inventory, target projection and selected-scope fingerprint.

The CLI emits structured records:

| Record | Meaning |
| --- | --- |
| `ODOO_TARGET_RESPONSE` | Original request, phase, pass, HTTP status, attempt and retained body |
| `ODOO_SOURCE_WAIT` | Actual retry deadline for the pending request |
| `ODOO_TARGET_SOURCE_PASS` | Complete observed alias/partner counts, source fingerprint and issue count |
| `ODOO_TARGET_CAPTURE_COMPLETE` | Immutable capture manifest and target result |
| `ODOO_CONTACT_PREPARED` | Original preparation output tied to the capture |

Resume an interrupted capture with the same command, directory, selection and source edition. The timeout is per request, between 5 and 300 seconds. The maximum attempts, from 1 to 100, apply to a pending transient request. HTTP 429, server errors and transport failures retain their original responses, honor `Retry-After` where supplied, and retry the same request. Failed access, changed identity, unsupported schema or malformed source return the exact retained failure for source resolution.

The capture lock prevents concurrent writers. When its original host/process cannot be reconciled automatically, the CLI returns the owner ID. After reconciling that original execution, use `--recover-lock ACTUAL_OWNER_ID` with the same command. Use a received capture's retained `source/odoo_target_cli.mjs` when continuing its exact source edition.

A completed capture can have retained issues. Its `status:complete` means the selected acquisition reached matching observed passes. `targetBaselineComplete` separately identifies whether its projection is eligible for the original preparation. Review the concrete issues in `target-source.json` and the command output.

| Retained condition | Consequence |
| --- | --- |
| Selected alias refers to an invisible partner | Baseline remains incomplete |
| Parent is invisible or has no usable existing alias | Relationship remains review-only |
| Explicit requested External ID is absent | Original scope is incomplete |
| Alias changes during a pass | Issue retained and next complete pass acquired |
| Parent override resolves elsewhere or is absent | Original alias policy needs correction |
| Partner belongs to an unselected company | Scope issue retained |
| Two source rows map to the same physical partner | Existing preparation marks the baseline incomplete |
| Stable empty selected namespace with no missing explicit IDs | Complete zero-row baseline remains representable |

A completed source is immutable. Later target changes, policy changes and different installed source editions use a fresh capture directory. Retain the original baseline for comparison.

## 6. Prepare the original contact input

Supply the complete original contact-input JSON from the existing source preparation, such as the maintained Xero acquisition or another commissioned source. It keeps its original `kind`, `source`, `complete`, `namespace`, `companies`, `people` and owned `fields`.

```sh
node odoo_target_cli.mjs prepare \
  --input /private/customer/odoo-target-before \
  --contacts /private/customer/original-contact-input.json \
  --out /private/customer/contacts-prepared-before \
  --installation /private/customer/installation.json
```

The adapter retains the complete original contact JSON bytes, its hash and parsed content. It adds the captured target rows, baseline completeness, stable target scope, all acquisition issues and any physical-partner collision issues. It then invokes the original `prepare_cli.mjs`.

The optional installation JSON uses the existing Analysis format:

```json
{
  "analysisWorkspace": "/private/customer/analysis",
  "operationId": "REPLACE_WITH_EXISTING_32_LOWERCASE_HEXADECIMAL_ANALYSIS_ID",
  "parser": "/opt/merchant/products/conapi/supplier-report/supplier-report.mjs",
  "sourceArchive": "/private/customer/Complete_Datasette_Product.zip"
}
```

Replace that Analysis-ID placeholder and paths with the actual installation values. Its native ID is separate from the capture operation ID. The full installation supplies the selected parser and complete original source archive.

The original preparation keeps stable generated IDs in the migration namespace and preserves explicitly mapped target IDs. Review `Review.html`, `mapping.csv`, `exceptions.csv`, `companies.csv` and `people.csv`. Its original `reconciliation.csv` is present with zero rows before a returned staging result.

The selected fields define the data this import owns. An omitted owned source value preserves the exported target value. An explicit blank that would clear a nonempty value requires the original `clearFields` declaration. The same rule applies to an explicitly cleared parent relation. Archived status, unowned fields and original aliases remain available in the captured source; the generated contact import uses its declared original columns.

The actual existing Odoo worker imports companies before people, using the original External ID and related-company columns. Keep its actual import report and returned result. [Official import behavior](https://www.odoo.com/documentation/19.0/applications/essentials/export_import_data.html).

## 7. Acquire the staging result and reconcile it

After the existing staging import completes, capture the same selected Odoo scope into a fresh directory. Retain the same origin, database, version, user, ordered companies, namespace, module/explicit-ID selection and parent policy. The capture's operation ID and title can identify the existing follow-up step; those labels do not change `targetScope`.

```sh
node odoo_target_cli.mjs capture \
  --config /private/customer/odoo-target-after-selection.json \
  --out /private/customer/odoo-target-after \
  --token-env EXISTING_ODOO_API_KEY_ENV
```

Then join the original prepared baseline, actual import-result JSON and returned target capture:

```sh
node odoo_target_cli.mjs reconcile \
  --input /private/customer/odoo-target-after \
  --baseline /private/customer/contacts-prepared-before \
  --native-result /private/customer/original-odoo-import-result.json \
  --out /private/customer/contacts-prepared-after \
  --installation /private/customer/installation.json
```

This verifies the original prepared bundle through its own receiver. It requires the returned target to have the same scope and a complete eligible projection. The full native-result bytes, SHA-256 and parsed result become part of the original prepared input.

The existing engine compares each planned External ID, owned value and parent relationship with the returned target. It retains unexpected or missing records and differences against the original baseline. Inspect the actual `reconciliation.csv`, exceptions and original import result together. Correct a real source/mapping discrepancy through the existing worker with the same stable External IDs, then acquire its later result into the next retained capture.

## 8. Run and receive the native Analysis project

The prepared installation template selects all five original contact tables and the selected-source query:

```sh
python3 -I ../workflow_cli.py configure \
  --template /private/customer/contacts-prepared-after/profile-template.json \
  --output /private/customer/workflow-profile.json
```

Use the customer's original business-request contract:

```json
{
  "schema": "stellar-forge.source-workflow-request.v1",
  "requestId": "ORIGINAL_BUSINESS_REQUEST_ID",
  "correlationId": "ORIGINAL_BUSINESS_REQUEST_ID",
  "profile": "odoo-contact-import-preparation",
  "parameters": {
    "sourceId": "ORIGINAL_SELECTED_SOURCE_RECORD_ID"
  }
}
```

```sh
python3 -I ../workflow_cli.py accept \
  --workspace /private/customer/workflow \
  --request /private/customer/business-request.json \
  --execution-id ORIGINAL_ORCHESTRATOR_EXECUTION_ID

python3 -I ../workflow_cli.py run \
  --workspace /private/customer/workflow \
  --request-id ORIGINAL_BUSINESS_REQUEST_ID \
  --configuration /private/customer/workflow-profile.json

python3 -I ../workflow_cli.py status \
  --workspace /private/customer/workflow \
  --request-id ORIGINAL_BUSINESS_REQUEST_ID \
  --history

python3 -I ../workflow_cli.py export \
  --workspace /private/customer/workflow \
  --request-id ORIGINAL_BUSINESS_REQUEST_ID \
  --destination /private/customer/Contact_Workflow_Project.zip
```

The original runtime retains all source versions, five prepared tables, saved queries, report, complete outputs and request history. Empty exception or pre-import reconciliation tables retain their columns, header-only CSV, empty JSONL and zero-row SQLite schema. Read actual full export row counts alongside the original query-preview limits.

An interrupted run continues its original request and execution IDs. A changed source or policy uses a successor request with its existing `parentRequestId`. Preserve the earlier native workspace and the complete baseline/staging source.

## 9. Deliver baseline, staging result and original project together

For a baseline-only preparation, hand over its capture and prepared output:

```sh
node odoo_target_cli.mjs handover \
  --input /private/customer/odoo-target-before \
  --prepared /private/customer/contacts-prepared-before \
  --out /private/customer/odoo-baseline-handover
```

For the reconciled result, include its original baseline capture and optional complete native project:

```sh
node odoo_target_cli.mjs handover \
  --input /private/customer/odoo-target-after \
  --baseline-capture /private/customer/odoo-target-before \
  --prepared /private/customer/contacts-prepared-after \
  --native-delivery /private/customer/Contact_Workflow_Project.zip \
  --out /private/customer/odoo-reconciled-handover
```

The output's parent exists and the destination lies outside every source input. The full handover contains:

| Member | Complete retained content |
| --- | --- |
| `capture/` | Current target acquisition, every raw response and all eight editable source files |
| `baseline-capture/` | Original baseline when the current preparation includes a returned target |
| `prepared/` | Original validated preparation, complete original input, original contact bytes and returned native-result bytes |
| `native/delivery.zip` | Optional original Analysis working-project archive |
| `handover.json` | Every member's identity and the exact current/baseline/preparation/native relationships |

The handover recomputes the source-contact-to-physical-partner collision relation and validates it against the prepared input. It checks both captured scopes and fingerprints. The optional native ZIP is retained exactly; its original receiver owns restoring the native project.

A completed handover destination can be reused only when the current capture, baseline capture, every prepared file and optional native ZIP all match its prior content. The original manifest and result are then returned with `replayed:true`. Changed inputs select a new destination.

Receive the complete handover:

```sh
node odoo_target_cli.mjs receive \
  --input /transfer/odoo-reconciled-handover \
  --out /private/receiver/odoo-reconciled-handover
```

The receiver verifies exact inventory, member hashes, both target scopes, original contact bytes, original native-result bytes and the preparation relationships. Preparation is received through its maintained original receiver.

Inspect using the captured source:

```sh
node /private/receiver/odoo-reconciled-handover/capture/source/odoo_target_cli.mjs inspect \
  --input /private/receiver/odoo-reconciled-handover/capture
```

Receive the included native project with its recorded actual SHA-256:

```sh
python3 -I /opt/merchant/stellar/scf-starforge-20261009/sf30-seller-sdk/datasette-analysis/workflow_cli.py receive \
  --workspace /private/receiver/workflow \
  --archive /private/receiver/odoo-reconciled-handover/native/delivery.zip \
  --sha256 ACTUAL_NATIVE_DELIVERY_SHA256 \
  --analysis-workspace /private/receiver/analysis
```

Open the received Analysis project through the maintained operator. Reopen the same mapping, source-record query, report and staging comparison. For a new installation, prepare into a fresh output with its actual installation JSON and bind that template through the original workflow. Keep the original baseline, imported IDs and receiving history with any later correction.

## 10. Capture inventory

| Path | Purpose |
| --- | --- |
| `selection.json` | Canonical target selection |
| `state.json` | Original operation state and its hash |
| `source-edition.json` | All eight editable source identities |
| `source/` | Complete original acquisition and preparation code |
| `requests/` | Actual version/JSON-2 requests, domains, fields and context |
| `raw/` | Exact original response bodies, including errors |
| `responses/` | Request/body relationships, HTTP metadata and timestamps |
| `passes/` | Full observed-pass summaries and target-source documents |
| `wait.json` | Retained retry deadline when present |
| `target-source.json` | Accepted target rows, physical identities, complete observations and issues |
| `capture-manifest.json` | Immutable complete file inventory and source fingerprint |

Inspect and replay the retained capture through its own source edition. Use fresh named captures for later observations and preserve their original baseline relation. This gives the next operator the full target selection, actual source records, editable preparation and complete received project.

## Primary references

- [Odoo 19 JSON-2 API, authentication, version, identity and transaction behavior](https://www.odoo.com/documentation/19.0/developer/reference/external_api.html)
- [Official JSON-2 documentation source](https://github.com/odoo/documentation/blob/19.0/content/developer/reference/external_api.rst)
- [ORM reference](https://www.odoo.com/documentation/19.0/developer/reference/backend/orm.html)
- [Original search_read, fields_get and External ID methods](https://github.com/odoo/odoo/blob/19.0/odoo/orm/models.py)
- [Authenticated user/context implementation](https://github.com/odoo/odoo/blob/19.0/odoo/addons/base/models/res_users.py)
- [Company context and selected-company validation](https://github.com/odoo/odoo/blob/19.0/odoo/orm/environments.py)
- [Partner fields and original relations](https://github.com/odoo/odoo/blob/19.0/odoo/addons/base/models/res_partner.py)
- [External ID records and uniqueness](https://github.com/odoo/odoo/blob/19.0/odoo/addons/base/models/ir_model.py)
- [Many2oneReference field type](https://github.com/odoo/odoo/blob/19.0/odoo/orm/fields_reference.py)
- [Standard model access definitions](https://github.com/odoo/odoo/blob/19.0/odoo/addons/base/security/ir.model.access.csv)
- [Original import and export behavior](https://www.odoo.com/documentation/19.0/applications/essentials/export_import_data.html)
