# Highway field operations in SCF

The Highway application joins actual captured GIS assets, field inspection, supervisor decisions, crew dispatch and source-native reconciliation in one complete customer workflow. This installed product makes that maintained application available through SCF Applications, the authenticated client, merchant-agent methods and Customer installations.

The original implementation is retained under `products/highway-field-operations/app/`. It includes the staff application, read-only ArcGIS capture, original field and dispatch domains, SQLite command history, complete archive receiving, and the unchanged paired reconciliation engine and local dataset producer. The original vendor modules and licenses travel with the selected source. The installed successor explicitly records its physical-branch and selected-Node integration changes. The original completed operating course keeps its original source selection and execution history; it is reused as that recorded result.

## Customer scope and responsibility

Continue the original company case, Workshare and Installation. The proposed Geocove implementation remains USD 16,800 for 120 hours over 20 active days, with an allowance of four layers, two related tables and three forms. Keep the original phase division, payment schedule, acceptance conditions and continuing support terms. A proposed dataset allowance is filled from the selected service's actual advertised inventory.

The useful outcome is a working staff process: a field worker opens the correct asset, records typed observations and photos, a supervisor reviews the saved submission, crews follow through on assignments, and an implementation reviewer can explain the resulting candidate changes against the original source. The receiver gets the complete editable case and the same analysis engines used to produce its reports.

Choose the operating people and source owners in the original customer record. The field operator records observations; the supervisor decides a saved submission; the crew lead controls staffing and follow-through; the reconciliation reviewer records the meaning of dataset differences; and the customer-selected production writer owns an actual target-service integration. An approved local proposal is the input to that implementation decision.

Keep these original terms separate from the native merchant's actual service price and from grant funding. If a service uses a Stellar atomic price, network, asset or customer payment authorization, use the saved native selection. The implementation proposal's dollar amount is not a token quantity.

## Install the complete release

The selected source contains every application member and all original vendor members. Read the installed source selection before launching. The staff and capture application uses Python 3.11 or later. Native paired reconciliation additionally uses the original DuckDB 1.5.6 dependency. The direct CSV/SF100 producer uses the actual Node 22+ executable selected for this installation.

Use the original included Python package when installing the paired engine:

```sh
cd /absolute/selected/products/highway-field-operations/app
python -m pip install './vendor/original-paired/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python[duckdb]'
```

Use the selected Python environment consistently for installation and managed execution. The complete local-dataset producer has its original Node built-in dependency closure. Its direct intake does not need a seller listener, package service or payment session.

For an existing customer, select the original saved staff workspace. Create a new workspace only when the case genuinely needs one, retaining its original UUID and creation time:

```sh
starforge highway-field-operations create \
  --workspace /absolute/private/highway \
  --id ORIGINAL_WORKSPACE_UUID \
  --title 'Highway field operations' \
  --at ORIGINAL_CREATION_ISO_TIMESTAMP \
  --python /absolute/python3
```

The exact original create identity is retained with the physical directory. Repeating the same initialization is recoverable; a different identity belongs in a deliberate different workspace.

## Adopt the existing workspace in Applications

Add **Highway field operations** in the existing SCF Applications screen. Review the actual settings before saving:

| Setting | Selection |
| --- | --- |
| workspaceDirectory | Canonical existing original Highway SQLite workspace |
| pythonExecutable | Actual executable in the selected Python 3.11+ environment |
| nodeExecutable | Actual Node executable; Node 22+ for the original CSV/SF100 producer |
| pairedWorkspaceDirectory | Optional existing original native paired warehouse |
| pairedWorkspaceId | Exact original identity of that paired warehouse; selected together with its directory |
| connectionFile | Private local connection descriptor for this managed entry |
| receivingDirectory | Private parent for explicitly separate received workspaces |
| port | Selected loopback port, or 0 for an assigned port |

Use the application's ordinary review, save, start and open actions. Review the actual binding: workspace creation identity, canonical staff directory, selected source, executables and the paired warehouse identity when selected. Startup checks the original warehouse's own identity. The managed service owns that selected warehouse for its lifetime.

The client never switches the native warehouse underneath a running staff application. After independent receiving, add the received staff branch as its own Applications entry with its own connection file and independently restored paired directory/ID. This makes the relationship between field work and native reconciliation visible and repeatable.

A portable workspace UUID travels with the case, while browser drafts, request recovery and managed ownership also bind to the physical branch. Original and received branches can therefore remain open independently without sharing drafts or confusing pending requests.

Use the same managed Applications operation for start, stop and recovery. After a genuine transport interruption, inspect the existing process/request result before another launch. Stop finishes the owned HTTP activity and releases the selected native owner before completing closure.

## Source acquisition and complete intake

The original programme observed the public Livingston County Highways service:

https://gis.livingstoncountyny.gov/arcgis/rest/services/Highways/FeatureServer

Read the selected current service metadata before choosing layers or related tables. It determines field names, ObjectID/GlobalID, subtype definitions, domains, geometry/CRS, editability, attachment support, relationships and advertised service capabilities. The original observed edition advertised no related tables or sync and no service-wide GlobalID applyEdits support; the Bridges layer did not advertise attachments. Treat those as observations of that retained edition. Current customer configuration comes from its own saved metadata.

Capture retains the original service/dataset metadata, ObjectID enumeration and count responses, complete feature query pages, each attachment listing and available original attachment bytes. The final metadata, counts and identities remain separately visible. Multiple successful reads are not an atomic server snapshot; attribute changes can occur even when the final identity set is unchanged.

Choose one operation UUID, one capture UUID and one private output directory for each original acquisition:

```sh
cd /absolute/selected/products/highway-field-operations/app
/absolute/python3 -m highway.capture \
  --service https://gis.livingstoncountyny.gov/arcgis/rest/services/Highways/FeatureServer \
  --layers SELECTED_ADVERTISED_LAYER_IDS \
  --tables SELECTED_ADVERTISED_TABLE_IDS \
  --directory /absolute/private/captures/ORIGINAL_CAPTURE \
  --operation-id ORIGINAL_CAPTURE_OPERATION_UUID \
  --capture-id ORIGINAL_CAPTURE_UUID
```

An empty table selection is appropriate when the selected source has no relevant advertised tables. An authenticated source takes its token from a named environment variable with the existing **--token-env** option. Keep the source token out of saved URLs and shared command text.

Use the saved successful response bodies on continuation. The original capture lock, attempts and request/result records stay together. A returned failed read uses the source tool's explicit **--retry-failed** continuation and retains any provider retry time. A later fresh source observation gets a new capture identity.

In **Source editions**, choose the complete capture folder. Intake verifies every manifest-declared file before the atomic import. Review missing, unexpected and duplicate ObjectIDs, unavailable attachments, initial/final counts, and source-change observations. An incomplete edition remains usable as an explicitly incomplete local observation; complete native dataset preparation requires the selected complete feature population.

| Source capacity | Actual selected implementation |
| --- | --- |
| Advertised datasets | Up to four layers and two tables |
| Default feature/attachment counts | 100,000 features; 10,000 attachments |
| Retained source bytes | 256 MiB |
| Individual JSON response | 32 MiB |
| Individual attachment or staff source blob | 64 MiB |
| Complete staff logical history | 72 MiB |
| Complete staff archive | 384 MiB |

Plan a complete coherent cohort before an acquisition exceeds its selected limits. Preserve full related identities and all required rows; splitting a cohort is an explicit source selection.

## Form design and field work

A form is bound to a real captured layer and source edition. Choose original source fields by their exact names; readable labels do not rename the source. Identity/editor tracking fields and fields whose original metadata disallows editing remain read-only. Select local observations separately for field notes, measurements, dates, choices or added photos.

The actual type and domain contract matters to the operator:

- Empty text and null are distinct. Use the explicit Null control.
- Coded values and ranges follow the selected original subtype after the whole proposed attribute set is known.
- Unchanged legacy values remain visible even when a new edit would fail the current domain.
- Original BigInteger/ObjectID values outside the browser's safe integer range remain retained in raw source and need an explicit representable workflow for editing.
- Dates retain their actual time-zone meaning; unknown-zone source values keep their epoch representation.
- Geometry retains its original type, dimensions and spatial reference. A local coordinate edit does not imply reprojection.
- Added attachments retain exact bytes, original local names, media type and the form's complete count/size policy.

Save the complete form edition under its stable key. A successor names the prior current form; an older form editor cannot replace a newer edition. Existing inspections keep their original form.

In **Field inspections**, select the actual asset and form. Save the full answers, geometry, attachments and note together. Submission uses the saved edition. In **Supervisor review**, inspect original and proposed values and the full attachment set before recording approve, return or reject. Correction requires the actual reason and produces a new draft, retaining the former version, submission and decision.

## Crew dispatch and daily follow-through

The dispatch board connects the same actual source/form/asset to the field work. Create the actual crew and members, then a work package with scope, planned whole-minute effort and an optional due time. Create assignments against the selected real captured ObjectID and form. The saved assignment retains the original service/item/dataset, source edition, form key/revision/hash and GlobalID when one exists.

Move an assignment deliberately through PLANNED, READY and IN_FIELD. Open its inspection using the assignment action; the original inspection and assignment-link requests remain separate retained operations. Recover the saved link request if the first step completed before the second response arrived.

An assignment becomes SUBMITTED only when its linked inspection has an actual current submission. CLOSED requires the current approved inspection and resolved supervisor follow-through. The closure retains the exact inspection version/hash and approval. A subsequent correction can make that old closure no longer current without erasing it.

Record actual effort in whole minutes with the work's actual time and note. Planned effort stays separate. A mistaken entry is voided with a reason; its replacement is another record. The original assignment retains its package after effort exists. Follow-ups name a responsible person, due time, status and outcome.

BLOCKED and CANCELLED retain the actual reason and all prior work. Resume cancelled work through PLANNED, or reopen a closed assignment through IN_FIELD. The current record version guards each deliberate change.

Freeze an operating report when the intended work edition is ready. Its complete output carries crews, members, packages, assignments, planned/recorded effort, voids, overdue and unresolved follow-through, source/form bindings, linked approvals and retained histories. The readable HTML includes the full escaped JSON alongside its tables. Download the complete frozen files with the editable workspace.

## Later source editions and supervisor continuity

A new capture becomes another immutable source edition. An existing inspection stays bound to its old edition until its explicit rebase. Review every changed mapped attribute, geometry, attachment and schema observation.

When only the source changes, rebasing adopts the new value. When only the local inspection changes, it retains that answer. When both change differently, choose the inspected value or current source for that field. Geometry uses its explicit conflict choice. A removed or renamed field requires an appropriate form successor so pending answers remain visible.

Rebase creates a new draft. Save, submit and review it again. Then choose **Refresh from linked inspection** on the original dispatch assignment, using the exact current inspection and assignment versions. Refresh checks service/item, dataset, ObjectID, original non-null GlobalID and the same form lineage. It adopts that current source/form, retains prior links, clears the former closure and returns work to IN_FIELD.

A changed GlobalID under a reused ObjectID is a different asset selection. Preserve the old work and create deliberate separate work against the new identity.

## Approved proposals and target integration

Combine the intended current approved inspections into a local candidate proposal. It retains original record identities, source hashes, full original attributes/geometry, changed fields, added attachment references and the exact supervisor decisions. Equal or disjoint changes for one asset can combine; conflicting values, geometry, original identity or attachment bytes require a reviewed correction.

This proposal is a precise input for a customer-controlled production integration. Record that integration's actual destination, capabilities, supported identity strategy, account authority, outbound edit body and every individual result in its original operating system. Retain a later independent source observation to inspect the resulting target. The Highway capture and staff workflow remain useful before that separate integration is selected.

## Original dataset producer and native reconciliation

Open **Dataset reconciliation** in the same staff application. It uses the included original SF30 dataset handler, SF100 delivery producer and DuckDB paired engine. The Highway adapter contributes exact source binding and complete retained files; the original engine owns comparison, review decisions, reports and warehouse receiving.

### 1. Materialize complete selected rows

Select the saved capture, layer and form. Choose either captured values or an actual approved proposal with its original ID and digest. Declare every exposed column in **fieldMap**:

| Mapping choice | Use |
| --- | --- |
| native ObjectID | Exact supported integer identity |
| native scalar | Value the original declared CSV type can represent exactly |
| json-text | Complete feature, geometry, array, mixed type, large integer or precision-sensitive decimal |

An ObjectID plus **@feature** encoded as JSON text can retain all original attributes and geometry in a compact explicit map. Additional columns support direct field comparisons. Save the original selected JSONL, CSV and projection definition.

The source producer's **unquoted-empty** null encoding preserves null as an unquoted empty field and an empty string as quoted empty text. Ordinary text is CSV quoted, including line breaks and doubled quotes.

### 2. Produce a real original delivery

Load the immutable projection through the original **loadCsvDataset**. Follow the returned **page.nextCursor** through every complete selected page. Preserve the original query parameters, source snapshot and actual body.

Use original **init**, **appendMany**, **finalize** and **scan**. Each retained page has its stable original intent and evidence; omit the first cursor rather than passing null. On continuation inspect the accepted prefix and continue after it. Finalize after the actual final cursor is null and the count equals total. Save the complete unchanged final scan for native intake.

The original producer permits up to 64 declared columns and explicitly configured row/byte/page limits. A normal CLI summary is distinct from its full scan. The original pages, projection and source capture make the delivery reproducible.

### 3. Import, compare and review

The adapter's **review-import** checks the actual finalized delivery against the complete selected captured or approved-proposal rows. Import using the returned original binding and retain its edition ID.

Review a pair that explicitly names source/target editions and canonical columns, with each column's source/target name and key/value role. Save the reviewed definition at the original pair's current revision and digest. Run that saved definition.

Follow every **next_offset** through **total** when inspecting comparison groups and rows. Retain duplicate multiplicities and the actual canonical value semantics. Record review decisions against the original run revision and group or row identity. The original outcomes are OPEN, ACCEPTED_DIFFERENCE, REQUIRES_CORRECTION and DEFERRED.

Freeze the report at the intended review revision. For an outcome comparison with an earlier run, retain both runs' source editions and the actual comparable scope. A smaller later population does not by itself establish that a finding was corrected.

### 4. Associate and receive original native results

Before a native mutation, persist the exact adapter input and request UUID. The adapter binds it to the original engine request. Save the first full result and all returned retained files.

The native effect can finish while another staff operator advances the SQLite revision. In that case, keep the successful native result and explicitly associate it with the reviewed current staff revision. The retry changes only the association; the original native request body remains fixed.

Export through the original engine. The retained package contains the full report, source editions, query products, original warehouse, operating guide and manifest. Every complete member joins the staff handover.

For cold receiving, select that retained reconciliation record, original package directory, distinct destination warehouse and one receiving request UUID. The helper reconstructs the exact package and invokes the maintained **receive_package**. A repeated completed receive preserves later valid warehouse edits. Configure that received warehouse's actual identity when opening its separate managed Applications entry.

## Browser, client and merchant-agent access

The browser, **HighwayFieldClient** and **merchant_highway_** tools operate the same selected staff service. Retain exact original command inputs at each boundary.

A staff mutation uses the original envelope:

```json
{
  "expectedRevision": 12,
  "command": {
    "requestId": "ORIGINAL_REQUEST_UUID",
    "kind": "inspection.submit",
    "actor": {"id": "ACTUAL_OPERATOR_ID", "name": "Actual operator"},
    "at": "ACTUAL_ISO_TIMESTAMP_WITH_OFFSET",
    "body": {
      "id": "EXISTING_INSPECTION_ID",
      "expectedVersion": 3,
      "submissionId": "ORIGINAL_SUBMISSION_ID"
    }
  }
}
```

Select real saved values; the example shows structure. The store returns an already committed original request before rejecting the stale workspace revision that necessarily accompanies a retry. A different body under the same UUID is a conflict.

Complete staff commands include capture.import; form.save; inspection.open/save/correct/submit/decide/rebase; proposal.create; and the dispatch crew/package/assignment/link/status/refresh/effort/void/follow-up/report actions. Use the original domain guide for every full body. Both browser and client preserve unsent drafts when a genuine record-version conflict needs review.

Native requests have their own retained input, original first result and recovery methods. Do not turn a result association, paged read or archive download into another native mutation. Follow full page and file transfers to their declared completion.

## Complete export and independent receiving

Choose **Handover & receiving → Prepare complete handover** at the intended saved revision. Its publication ID is retained before the operation. Download the full **Highway_Field_Workspace.zip** and retain its complete byte count and SHA-256.

The original pass-through CLI remains available with its selected complete source:

```sh
cd /absolute/selected/products/highway-field-operations/app
/absolute/python3 -m highway.cli --source-root "$PWD" inspect \
  --archive /absolute/private/Highway_Field_Workspace.zip \
  --sha256 ORIGINAL_ARCHIVE_SHA256 --bytes ORIGINAL_ARCHIVE_BYTES

/absolute/python3 -m highway.cli --source-root "$PWD" receive \
  --archive /absolute/private/Highway_Field_Workspace.zip \
  --directory /absolute/private/received-highway \
  --operation-id ORIGINAL_RECEIVING_UUID \
  --sha256 ORIGINAL_ARCHIVE_SHA256 --bytes ORIGINAL_ARCHIVE_BYTES
```

Receiving validates the complete state/command/first-result history, original source blobs and publication inventory before publishing the distinct working directory. Pure business replay produces no new external capture or native operation. Keep the original immutable ZIP alongside the independently editable branch.

Open the received branch in its own Applications entry. Inspect the full history and reports, perform an actual permitted later edit, save, close and reopen it, then repeat the original receive to check that its later edit survives. Export the continuation as another complete archive.

Restore the paired package separately through the original native receiver when that workflow is selected. Staff SQLite and paired DuckDB remain different stores with a retained association, each using its own original complete receive path.

## Customer Installation and funding record

The installed profile is **highway-field-operations**. The shared Installation profile loader discovers its complete JSON and uses it for the original Workshare/Installation preparation.

The current public selection includes the complete profile, the maintained `profiles.mjs` loader and `prepare-core.mjs` preparation API under `stellar/scf_2026/sf49_data_commissioning/installation-workorders/`. Its original `grant-workspace` contribution registers the complete workorder preparation command. Start from the actual retained `installation-workshare-seed` result; review the generated bindings with the existing customer and native operator before preparing the same Installation input:

```sh
npx --no-install starforge grant-installation-workorder template \
  --profile highway-field-operations \
  --seed /absolute/private/original-seed.json \
  --out /absolute/private/highway-bindings

npx --no-install starforge grant-installation-workorder prepare \
  --profile highway-field-operations \
  --seed /absolute/private/original-seed.json \
  --bindings /absolute/private/highway-bindings/bindings.json \
  --out /absolute/private/highway-installation
```

These commands prepare complete local files. Preview and save the returned input in the existing Installation desk and actual retained case; they do not themselves issue an agreement, purchase, funding assignment or customer acceptance. Continue an existing operated Installation through its current native edition. Preserve the original canonical plan, phase/effort sources, customer choice and funded assignments. See `PACKAGE_README.md` for the complete selected build and opening route and the [workorder guide](../../stellar/scf_2026/sf49_data_commissioning/installation-workorders/README.md) for original request recovery.

The same selected source includes customer adoption planning, issuer source/award terms, saved operating procedures and original period-report capture. Open the [complete Grant Operations guide](../grant-operations/OPERATING.md) using the same existing case and source history. Full case/Application handoff retains original requests and returned files; a report does not replace the complete case. `GRANT_CLOSURE.json` pins the adopted public closure, while `PUBLIC_ADOPTION.json` preserves the earlier adoption decision.

The complete course covers source selection, deployment, capture, forms, inspection and supervisor work, dispatch, later source/rebase, approved proposal, original paired comparison, independent staff/native receiving and ongoing support. Populate the actual customer fields from its original records and attach complete observations and outputs.

Grant reporting references the same original maintained source and observed work. Preserve the existing application narrative, funded activity, staffing and actual receipt/payment records. Preparation, execution, customer acceptance and funding decisions each retain the original native record that owns them.

## Operating handover

Deliver the full selected source and licenses; the original and received working directories or their complete validated archives; source/capture and native package inventories; full reports; actual browser/agent observations; and the named support owners. Keep private connection files and tokens in the appropriate operating configuration.

The next operator should be able to identify an original asset, follow its inspection and assignment decisions, inspect the proposed edit and paired comparison, reopen the complete case and continue a legitimate later change. Record the customer's actual acceptance in the existing Installation and retain the agreed maintenance and correction procedure with that same case.

## Complete named field work and return review

The maintained application now includes **Field copies & returns**. Its named issue contains complete actual source, forms, inspections, crew/assignment context and attachments. The colleague receives one self-contained editable HTML; complete named editions and unfinished draft are carried back as original JSON or HTML. Supervisor comparison explicitly separates issued/current/returned values before the original workspace command adopts changes. No ArcGIS write or replica is implied.

Use the full staff instructions and CLI examples in [app/OPERATING.md](app/OPERATING.md#named-field-copies-and-returned-observations), and the exact business/file contract in [app/FIELD_EXCHANGE.md](app/FIELD_EXCHANGE.md). The source reference is part of this following installed edition; the original captured workspace and its 352d operation retain their actual prior source and results.

The existing complete workspace export and receiver retain both issued formats, every exact returned file, added bytes, first requests/results and original inspection history. Original and received copies share a logical ID and keep separate physical directories. Select the intended Application/connection before any command or download. Field-specific requests and drafts retain that physical branch.

The SDK provides fieldIssue, fieldComparison and fieldDocument, plus complete field-file uploads and exact streamed issue/return downloads. Agent tools borrow the same authenticated owner. Complete command inputs and file identities must be retained before dispatch; an uncertain call is reconciled by its original UUID. See [SDK.md](SDK.md#named-field-exchange-api).

After decisions are saved, **Open original receiving comparison** reopens the exact original issued/current/returned review with its saved choices, reasons and original workspace revision. It is read-only; later inspection changes remain separate. The CLI equivalent is `compare-field --return-id ORIGINAL_RETURN_ID --adoption-id ORIGINAL_ADOPTION_ID`. This works after independent whole-workspace receiving because the full original states and files travel with the archive.


## Following field-exchange receiving on the retained case

The complete executable course is in [tools/FIELD_RECEIVING.md](app/tools/FIELD_RECEIVING.md). It operates the actual retained County inspection through issued HTML, unfinished drafts, named editions, attachment reopening, concurrent-copy recovery, explicit supervisor comparison/adoption and complete independent receiving. It uses the original programme lock and creates `field-exchange-following/staff-workspace` through the maintained full archive receiver. New business commands occur on that named physical branch; the original capture programme, input, journal and business revision remain available for their original continuation. Run the four selected course files together with this complete source selection and the actual original input and installed executables. The guide records the exact command, recovery procedure, output archive and rendered review instructions.
