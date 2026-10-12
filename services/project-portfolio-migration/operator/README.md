# Portfolio target scheduling and acceptance

This operator completes the receiving side of the original portfolio migration workspace: retain a project, review source corrections, prepare a receiving plan, execute the selected native target, compare the actual received project, and save acceptance with a complete portable handover.

It uses the sibling `portfolio` package for every MPXJ read, typed source edition, correction, comparison, Microsoft Project XML export and workspace archive. Source files, native JSON and their original identity remain available throughout the operation.

The receiving comparison retains both entity changes and the original `definition_changes` from the field catalogue and native JSON collections. The browser pages through every definition change and shows both source identities; the HTML and JSON handover include the full original values, paths and hashes. Building or reopening that handover preserves the accepted comparison and acceptance SHA-256.

## Open the complete product

Run these commands from `services/project-portfolio-migration` after installing the original MPXJ runtime described in the product README:

```sh
python operator/serve.py \
  --workspace /absolute/customer/portfolio-workspace \
  --entry-file /absolute/private/portfolio-entry.json \
  --port 8857
```

Open the private URL in the entry file. The browser provides:

1. **Source:** original file and companion intake, saved editions, complete paginated native row families, typed field inspection, reviewed source corrections and native Project XML export.
2. **Target & mappings:** locally selected receiving profile, actual user/environment and native capability read, editable task field conversions, dependency choices, resource-to-team selections and a complete saved target plan.
3. **Review & execution:** actual transaction boundaries, retained-source decisions, named review, native operation continuation, pause before the next call, exact original reply recovery and abandonment of one unexecuted native set.
4. **Receiving & handover:** actual native target capture or returned project-file intake, original source/target comparison including native field and collection definitions, named acceptance, complete HTML/JSON handover and portable workspace.
5. **Activity:** every saved local action and its original input, result and same-request resume.

The default receiving profile is **Microsoft Project XML**. Cloud scheduling is available when an operator supplies a current private Project Operations profile. A file handover and a native cloud migration remain distinct saved operations.

## Source and file handover

Select the original project file and all companion files required by its native reader. The browser stores the complete uploaded bytes before asking the original source engine to read them. A selected source edition is immutable.

The field inspector shows each row's exact source key, native UID/GUID, typed getter fields and cached fields. A correction stores `family`, `key`, `field`, the exact typed `before` value and the proposed typed `after` value. The original source review decides whether that native field and change are supported. Applying the saved review creates a following source edition.

For the file target:

1. Select the source edition and **Microsoft Project XML**.
2. Prepare the complete file plan with explicit export options.
3. Review the original source findings and save the receiving operator's decision.
4. Continue the saved plan. This applies the original source review and invokes the original MPXJ `MSPDIWriter`.
5. Download `project-<edition>.xml` from the retained native export.
6. Import it into the receiving application that accepts Microsoft Project XML.
7. Upload the actual project file returned by that application. The same native source reader creates the received edition.
8. Review the source/target comparison, record accepted differences, and generate the handover.

The default export profile is:

```json
{
  "write_timephased": true,
  "microsoft_compatible": true,
  "save_version": "Project2016"
}
```

The selected options and the writer's native readback are part of the original source export. The original full source also carries calendars, custom fields, currency/rate data and other native collections that a receiving format may represent differently. Those differences are evaluated against the actual returned project.

MPXJ reads native MPP and writes MSPDI XML. This workflow does not rename XML bytes to an MPP filename. Microsoft documents its own Planner MPP import separately; the cloud path below uses the native scheduling API.

## Configure the native Project Operations target

Keep the target configuration and delegated access-token file **outside** the portable workspace. Copy `examples/target-profiles.json`, replace its example selections with the actual environment/user/organization, and restrict the token file to its owner.

```sh
chmod 600 /absolute/private/project-user-token.json
python operator/serve.py \
  --workspace /absolute/customer/portfolio-workspace \
  --profiles /absolute/private/target-profiles.json \
  --entry-file /absolute/private/portfolio-entry.json \
  --port 8857
```

The selected environment must expose the documented Project scheduling actions. Microsoft requires a licensed Project user for these APIs; the native probe verifies the actual delegated user and organization, active non-application user record, complete native CSDL and actual OperationSet and dependency choices. The private profile identifies the intended user. The native service retains its own licensing and authorization checks.

A token file may contain the exact access token alone or a JSON object with `access_token`. It is read immediately before a native request so the operator can refresh the same user's credentials. Token content is excluded from source editions, request records, browser storage and archives.

The profile's native API origin is exact. Pagination stays inside the same selected HTTPS API root. Native user, organization or CSDL changes require a new reviewed target plan; a resumed operation cannot silently switch environments.

The selected IANA source time zone converts native local dates to UTC. A local time in a daylight-saving gap is rejected. An ambiguous repeated local time requires an explicit fold selection. Date choices are recorded in the prepared mapping.

### Map the actual source

The browser initially maps:

| Original source field | Native task field | Conversion |
| --- | --- | --- |
| `NAME` | `msdyn_subject` | Text |
| `START` | `msdyn_scheduledstart` | Local date/time to UTC |
| `FINISH` | `msdyn_scheduledend` | Local date/time to UTC |

Additional task fields must name an actual scalar field in the retained native CSDL. The migration manages identity, project/bucket/parent links and calculated work fields separately. Each selected conversion is explicit: text, UTC date/time, integer, finite exact JSON number, percentage-to-fraction, boolean or native choice.

For a UTC mapping, enter an IANA zone such as `America/Chicago` in its option field, or a JSON object with `timezone` and an explicit `fold`. For a native choice mapping, enter an object mapping each exact source value to the selected native integer option.

Dependency mappings use the original source relation value as the key and an option from the **actual native dependency choices** as the value. Read both the original dependency family and the probe before selecting it. Resource mappings are keyed by the exact original source row key and name an existing native project-team GUID. Unmapped resources receive explicitly prepared generic project-team records; rates, work calendars and historical costs remain in the original source and receiving comparison.

The additional mapping JSON can provide `resource_names`, `assignment_names`, `date_decisions` and the other named planner options. The compiler rejects unknown mapping options and collisions instead of silently interpreting them.

## Review and native execution

A prepared native plan retains:

- The exact original edition and source hashes.
- Selected user, organization, native CSDL and target profile.
- Every deterministic prepared native record GUID.
- Source-to-target field conversions and parent, assignment and dependency links.
- Immediate project/team actions.
- The full ordered native OperationSets and their individual transaction boundaries.
- Original source values retained outside this target write.
- A content hash for the complete plan.

The browser requires the named reviewer to acknowledge each listed source-retention and transaction decision. The saved review is bound to that exact plan.

Project/team creation is immediate in the documented native API. Each subsequent OperationSet is a separate transaction, with at most 200 selected operations. An earlier completed set remains completed if a later set fails. The browser shows those actual states separately.

The operator invokes the documented actions through their actual CSDL parameter names:

| Purpose | Native action |
| --- | --- |
| Create the selected project | `msdyn_CreateProjectV1` |
| Create a project-team member | `msdyn_CreateTeamMemberV1` |
| Open the original native transaction | `msdyn_CreateOperationSetV1` |
| Queue original created rows | `msdyn_PssCreateV1` |
| Queue reviewed task corrections | `msdyn_PssUpdateV1` |
| Execute the original transaction | `msdyn_ExecuteOperationSetV1` |
| Abandon an unexecuted native set | `msdyn_AbandonOperationSetV1` |

The low-level transport also validates the documented delete and assignment-contour action contracts for composition by an explicitly reviewed plan. This operator's creation and following task-correction plans emit only their declared actions.

### Interrupted responses

Before each native write, the original request is stored and its invocation is durably recorded. Every complete returned native body, status, relevant headers and SHA is retained before interpretation.

A lost native reply leaves that exact call uncertain. Reopening does the following:

- Project or team creation: read the exact prepared native GUID and compare the submitted fields and project links.
- OperationSet creation: read the complete native collection for the original project, exact saved description and user, requiring one matching set.
- Queued row: retain the complete original OperationSet details. The operator can inspect the actual request and selected native detail together, then retain a named review of their exact match.
- Execution: read the **same** native OperationSet until its actual status resolves.
- Abandonment: read that original set's actual abandoned state.

An uncertain native POST is never automatically repeated. The actual serialized `OperationSetResponse` must name the original set and row. One native detail cannot acknowledge two different local row calls.

A known rejected call retains its exact response. Explicit retry stays on the original input and obeys any retained native `Retry-After` floor. The **Pause** control saves a local intent; an active native response is retained before the next write is considered. Closing the desk also stops later native dispatch after the current response is retained.

An unexecuted set can be abandoned with an explicit operator/reason. The original execution cannot be abandoned through this control after its submission has become accepted or uncertain; its native state is reconciled first.

### Following task corrections

After the original migration completes, select its saved deployment and a corrected source edition. **Prepare following native task correction** creates another reviewed operation on the same project and native task GUIDs.

This mode preserves the original task, resource, assignment and dependency row identities, hierarchy and relationship selections. It groups changed mapped fields into one native update for each original task. Actual current native values, record identity and observed ETag are captured before review. Values already equal to the intended correction are retained as such and produce no write.

Before queuing a changed row and again before executing its set, the operator reads the original native values and checks them against the reviewed before values. The documented scheduling action has no conditional ETag parameter. Coordinate concurrent edits to the selected target fields during this operation; the saved review states this exact API boundary.

If a field changes after review, the original set remains unexecuted. Review that current native value, abandon the original unexecuted set when appropriate, and prepare a new correction. The previous source edition, target state, queued calls and receiving comparison remain available.

## Actual receiving, comparison and acceptance

Cloud receiving uses the original pinned `org.mpxj.msplanner.MsPlannerReader` against the selected environment and project. Its private local read transport supplies the original reader requests from complete actual Dataverse responses. The source parser, calendars, assignment logic and native project writer remain the original MPXJ implementation.

The transport retains each provider page with its original URL, response bytes and retrieval time. It follows top-level page cursors and expanded collections. Dataverse single-level expansion links identify the complete relationship collection, so that collection replaces the inline view before its pages are followed. A link carrying a real paging cursor continues the original array. The original inline view and complete collection are both retained. Paging is a sequence of actual reads; its recorded interval remains visible.

The completed JSON delivered to MPXJ, the first accepted target probe and the read manifest are pinned to the original capture request. An interrupted capture reuses retained pages. Closing the reader or host stops further page assembly while preserving the original complete pages already received. After the reader completes, its local continuation can reopen from those saved pages without another provider read. The original `PortfolioWorkspace.capture_native` retains the actual native project and reopens its completed edition under the same request. This source closure is included in the portable workspace.

Task and assignment GUIDs map directly to exact captured rows. Project-team resources join through the actual assignment's bookable-resource lookup, which is the GUID used by this reader. A dependency joins its actual native record to captured task GUIDs, native relation type and exact reader lag. A resource omitted by the original reader, an unsupported native field, or competing identities produces a visible finding.

Cloud comparison calls the source engine with `strict_identity=True`: explicit original-key maps and unique GUID matches pair rows. Captured task UIDs resolve relationships only within that captured model. The comparison preserves unresolved identities and all original differences for acceptance.

The local reader uses its pinned v9.2 path convention; the transport retains and uses the exact API version selected in the private target profile. Response and collection limits fail visibly when a complete result exceeds the selected capacity. They do not publish a truncated capture.

File receiving uses the actual uploaded project and the source engine's ordinary same-format identity rules, with an optional exact per-family identity map.

Acceptance binds the original intended source edition, current captured target, exact comparison and target review. It records the accepting operator, decision note and each retained difference. A later target capture produces a new comparison and clears that current acceptance.

The handover provides:

- A readable HTML record of the selected target, original sources, native transaction results and the current acceptance.
- The complete JSON handover with original record identities and comparison.
- A portable workspace containing source bytes, editions, requests and replies, review, correction history, target capture and acceptance.

## Same-request browser and CLI recovery

The browser saves the exact request ID and arguments **before** POST. If the reply is interrupted or local sign-in expires, it keeps that original request. **Resume saved request** reads or resumes the same server-side action. A completed or failed saved action stays in Activity. An explicit retry of a failed local action retains its original input and prior failure record; the native journal still reconciles the original provider calls. A request can be discarded as unsent only after an authenticated read confirms that its original local record is absent.

A server restart does not silently launch old native work. Open Activity or use the CLI to resume a selected retained local request. The native journal still reconciles every prior provider invocation before a further write.

```sh
python operator/cli.py --workspace /absolute/customer/portfolio-workspace state
python operator/cli.py --workspace /absolute/customer/portfolio-workspace upload /absolute/source/project.mpp
python operator/cli.py --workspace /absolute/customer/portfolio-workspace \
  action intake --arguments-file /absolute/private/intake.json
python operator/cli.py --workspace /absolute/customer/portfolio-workspace \
  request ORIGINAL_64_HEX_REQUEST_ID --resume
python operator/cli.py --workspace /absolute/customer/portfolio-workspace \
  deployment ORIGINAL_64_HEX_DEPLOYMENT_ID
```

The `upload` result is the exact `source` object for `intake`:

```json
{
  "source": {
    "sha256": "REPLACE_WITH_ORIGINAL_UPLOAD_SHA256",
    "filename": "project.mpp"
  },
  "label": "Customer project",
  "profile": {},
  "companions": []
}
```

All browser actions use the same CLI `action KIND --arguments-file FILE` interface. Supply `--request-id` to preserve a previously prepared ID, or retain the generated ID returned by the first command. `--queue-only` saves an action for an explicit later run.

A local action may finish while its native OperationSet is still running. Its result states `AWAITING_NATIVE_RESULT`. A subsequent **Continue original migration** action reads the existing native set; it does not create another migration or resubmit an uncertain execute.

Exact SHA objects can be copied without replacing a different existing file:

```sh
python operator/cli.py --workspace /absolute/customer/portfolio-workspace \
  artifact ORIGINAL_OBJECT_SHA256 --output /absolute/delivery/project.xml
```

## Portable receiving

Export the complete workspace from the browser, then receive that exact archive into a new destination:

```sh
python operator/cli.py receive /absolute/delivery/customer.portfolio.zip \
  --destination /absolute/receiving/customer-portfolio

python operator/serve.py \
  --workspace /absolute/receiving/customer-portfolio \
  --profiles /absolute/private/receiving-target-profiles.json \
  --entry-file /absolute/private/receiving-entry.json
```

The receiver uses the original source engine's archive validation and current-workspace object paths. B mutations drain under the original operator lock while a portable export snapshots the source workspace. Upload publication uses that same lock.

The archive preserves saved JSON pause intents. It excludes the OS lock files and private credentials. Select the same intended native user/environment through a receiving-host profile before any future cloud continuation. Historical source and completed native receipts can be read without reopening the provider.

The original archive download itself is written to a sibling `<workspace>-operator-deliveries` directory, so a workspace does not recursively archive its previous complete ZIPs. A receiving host can create its own complete following archive from the restored original records.

## Source contract and official references

The product pins MPXJ **16.10.0**, source commit `7ef9e72813d33378c55ec6ceb148cc831ed22033`. Original upstream notices and the source bundle remain with the complete product.

- [Dataverse paging](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/query/page-results)
- [Dataverse expanded relationship collections](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/query/join-tables)
- [MPXJ Microsoft Planner reader](https://www.mpxj.org/howto-read-msplanner/)
- [MPXJ MPP reader](https://www.mpxj.org/howto-read-mpp/)
- [MPXJ MSPDI reader](https://www.mpxj.org/howto-read-mspdi/)
- [MPXJ MSPDI writer](https://www.mpxj.org/howto-write-mspdi/)
- [Microsoft Project scheduling APIs](https://learn.microsoft.com/en-us/dynamics365/project-operations/project-management/schedule-api-preview)
- [Native scheduling action examples](https://learn.microsoft.com/en-us/dynamics365/project-operations/project-management/scheduling-apis-powerautomate)
- [Native OperationSet and PSS logs](https://learn.microsoft.com/en-us/dynamics365/project-operations/project-management/schedule-api-logs)
- [Dataverse WhoAmI](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/reference/whoami)
- [Dataverse metadata queries](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/query-metadata-web-api)

`SOURCE_REFERENCES.json` retains the exact source pins used for the native contract. The actual connected CSDL, status choices and provider responses remain part of each selected target operation.

## Portfolio archive and reporting

The same desk's Portfolio archive tab selects saved native editions, reviews native fields and exact-grain measures, publishes complete relational CSV/SQLite and source archives, runs read-only reporting SQL and receives the original project sources in a fresh workspace. Companion profiles and mappings retain their actual capture selectors. See ../archive/README.md for the complete operator workflow and ../archive/native/README.md for its continuation of the original native receiving operation.
