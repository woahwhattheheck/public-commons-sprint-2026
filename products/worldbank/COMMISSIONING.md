# Commission a World Bank customer delivery

Create a complete editable procedure from the customer's agreed source and delivery brief. The procedure uses the existing Operating Plans editor, saved history, returned-work review and carried-file format. Preparing it does not acquire data or execute the recorded commands.

## 1. Prepare the customer's brief

Use the selected World Bank installation:

~~~sh
starforge worldbank-product commissioning example --out ./customer-brief.json
~~~

Open that JSON and replace the reference-course selections with the agreed customer values. The example includes CAN, MEX and USA GDP/population for 2018–2024 so its fields are understandable. These are proposed selections in an editable example, not a new source capture or a customer approval.

Keep the generated plan ID and creation time for this procedure. The generated Analysis operation ID belongs to its first Analysis preparation. Use a fresh brief for a different customer or independent producer operation.

| Brief field | Decision to record |
| --- | --- |
| customer, title, purpose | Customer name, procedure title and the decision the analysis supports |
| period | The reporting period or agreed recurrence in readable text |
| owner, receiving | Operating owner, receiving person, destination and handover arrangements |
| source, countries, indicators, periods | The exact intended source and selected population |
| rights | Attribution, permitted use and any source-specific conditions |
| missingValues, review | Treatment of missing observations and the review/exclusion policy |
| calculations, workbook | Units, denominators, labels, numeric treatment and customer formatting |
| acceptance, care | Reconciliation, receiving criteria, unresolved exceptions and support ownership |
| recurrence | Whether another edition is needed, its trigger and review responsibility |
| python | The same Python executable selected for the installed Analysis dependencies |
| prefix, operationId | The original Analysis name prefix and stable producer operation ID |
| paths | Separate absolute Linux locations for source, Analysis, accepted handover and customer restore |

A planned path is not proof that a source or output exists. The operator records actual capture, export, archive and file identities after those operations complete.

Optional assignments supply a different owner or due date for a named step. Dates must be real YYYY-MM-DD dates; omit them when no date is agreed. Step IDs are: brief, runtime, source, source-review, handover, analysis, report-review, programme, delivery, customer-receive and acceptance.

The brief has a strict schema. Unknown fields fail preparation, so an omitted decision is not silently discarded.

## 2. Carry selected supporting files

Optional attachments contain full original files and are selected explicitly:

~~~json
{
  "id": "agreed-source-register",
  "step": "brief",
  "path": "/srv/customer/intake/source-register.csv",
  "name": "Source_Register.csv",
  "mediaType": "text/csv",
  "note": "Original source register agreed at intake."
}
~~~

Add entries like this to the brief's attachments array. Choose the exact original files that may be transferred with this customer procedure. The reader rejects symbolic-link files, changed reads and oversize inputs. Every selected file is received before publication; partial preparation never publishes a plan. The original brief itself is always carried, byte for byte, as World_Bank_Commissioning_Brief.json.

The complete brief and selected attachment bodies have a combined 24 MiB read budget. The resulting complete plan, including base64 and all registration details, must fit Operating Plans' existing 32 MiB JSON limit. Later revisions also count towards that limit. Keep large native workspaces in their original archive delivery and record their actual names and digests in the step.

## 3. Create and open the ordinary plan

~~~sh
starforge worldbank-product commissioning create \
  --brief ./customer-brief.json --out ./customer-operating-plan.json

starforge discover serve --host 127.0.0.1 --port 8846
~~~

Open the printed address, choose **Operating plans**, and import customer-operating-plan.json. The World Bank source selection includes the original Command finder and Operating Plans contribution. In a source checkout, --source-root selects the actual repository and --selection worldbank selects that same distribution.

The factory reads the actual catalog and retains its exact package, World Bank command registration, Operating Plans command registration, owning source records and runtime declarations. If either required registration is absent, creation fails; use the matching complete World Bank product.

The output is the existing stellar-forge.operating-plan.v1 document, not a new storage format. Every step starts planned, with no recorded result. The original complete brief and explicitly received attachments remain with their selected steps.

## 4. Complete the customer procedure

| Step | Operator work and retained result |
| --- | --- |
| Accept the brief | Agree the selected scope, rights, review policy and acceptance |
| Select the runtime | Record the actual selected installation and required dependencies |
| Acquire the source | Use the original World Bank workspace and retain complete source responses |
| Review observations | Save explicit capture-bound decisions and preserve missing values |
| Export the handover | Retain the accepted original export, review revision and digest |
| Prepare Analysis | Continue the original importer with the same operation, workspace and prefix |
| Review reports | Preserve customer query, report and workbook edits and publish accepted definitions |
| Record recurrence | Use the existing named programme only when the customer has agreed another edition |
| Prepare files | Retain exact report, workbook and portable-workspace outputs |
| Receive the customer workspace | Restore the actual archive into a fresh customer destination and reopen it |
| Accept delivery | Record the actual result, exceptions and next responsible operator |

The source-opening, Analysis preparation and editor-opening steps carry complete argument arrays derived from the brief. Read each command and its inputs before running it. The plan does not execute them.

Some values do not exist at commissioning time. The customer-receive step therefore retains its fresh destination and explicit instructions instead of inventing an archive name, digest or receiving operation. After producing the actual workspace archive, enter the real command in that step:

~~~sh
starforge worldbank-product analysis --python /absolute/selected/python \
  receive --archive /absolute/actual/workspace.zip --sha256 ACTUAL_ARCHIVE_SHA256 \
  --workspace /absolute/fresh/customer-analysis --operation-id NEW_RECEIVING_32_HEX_ID

starforge worldbank-product analysis --python /absolute/selected/python \
  serve --workspace /absolute/fresh/customer-analysis
~~~

Use the [programme guide](PROGRAMMES.md) for original later-handover intake and same-operation review before publication. A reference-course exclusion from the same original capture does not demonstrate a later provider update.

## 5. Save results and receive returned work

After performing a step, record its actual state, result, identities and continuation; save a new revision. **Add result files** carries complete report, CSV or other suitable output bytes. Earlier saved revisions keep their original files.

Use the existing CLI when convenient:

~~~sh
starforge discover plan draft --file ./customer-operating-plan.json --out ./customer-working.json
starforge discover plan edit --file ./customer-operating-plan.json \
  --draft ./customer-working.json --out ./customer-operating-plan-r2.json
starforge discover plan show --file ./customer-operating-plan-r2.json \
  --format html --out ./customer-handover.html
starforge discover plan receive --file ./returned-plan.json \
  --existing ./customer-operating-plan-r2.json --out ./received-plan.json
~~~

A fresh factory invocation never replaces an existing output file. Continue the saved plan through its editor or these original commands. Complete JSON import retains newer matching history when an older copy returns. Divergent work uses the original Returned procedures review or a separate complete copy. Browser storage belongs to its host and port; transfer the complete JSON with the customer's original delivery.

Where the existing Installation workflow is used, keep the complete plan and accepted original outputs with that same customer installation record. This factory does not create another installation or payment arrangement. It supplies no price, funding request or unsolicited external delivery.

## Receiving the exact outgoing procedure

Before describing a customer procedure as ready, open its exact JSON in the selected installed editor, operate the important controls, and view the actual wide and narrow screens. Inspect populated, empty, loading and error states, source comparison, saved revisions, original-file downloads and reopening. Open the exact exported HTML and every shipping guide. Fix clipping, unreadable text, raw machine data in the ordinary customer display and inconsistent controls before handover. Screenshots must be viewed; code checks alone do not establish rendered readiness.

A prepared plan is a procedure, not proof of its planned results. Only the operator's actual completed work belongs in recordedResult and completed status.

## Application API

The pure factory is exported as @tokenjunkielabs/starforge-merchant/products/worldbank/commissioning-plan with TypeScript declarations. Pass the actual selected catalog, validated brief and complete original UTF-8 brief bytes. Each files entry is {step, file}, with file created by the original createOperatingFile function. The factory verifies every selected attachment descriptor, returns the ordinary complete plan, and neither reads paths nor executes a child process.

The installed command handles exact file reads and the original exclusive output writer. The existing Operating Plans model remains responsible for revision history, complete-file validation, comparison, import and returned-work behavior.

<!-- bryce-rendered-product-inspection:begin -->
## Standing lab rule: inspect the rendered product before presenting it

Bryce's direct owner instruction, October 13, 2026. This applies to every current and future lab peer, provider, model, harness, local session, cloud session, and delegated or child worker.

Before calling a client/prospect-facing app, site, dashboard, demo, report, presentation, or export ready, or putting it before a client/prospect, the responsible producing peer MUST open/run/render the exact outgoing version and visually LOOK at the actual result. Inspect at the actual screenshare/presentation width and at narrow/mobile widths where relevant. Operate critical controls; inspect applicable loaded, empty, loading, and error states; exercise downloads/exports and reopen the delivered files. Capture real screenshots or rendered page images and actually VIEW them. Capturing without viewing does not satisfy this rule.

This includes ALL attachments. Literally observe the actual thing the way a user or recipient would see and use it: open and view downloaded HTML, every relevant PDF/report page, slides, spreadsheets, maps, images, video/audio, archives and project attachments in their normal recipient-facing viewer or application; play audiovisual media and inspect the usable contents of archives/projects. Metadata, schemas, source text, and a browser link do not substitute for opening the attachment and using the delivered result normally.

Fix ugly, cramped, broken, unstyled, clipped, overflowing, or unreadable results within the authorized task before presenting them. Favor simple industrial/plain presentation, consistent spacing and typography, readable tables, and working controls. Do not add decorative template slop. Source review, unit tests, HTTP 200, DOM counts, a reviewer/model approval, or an evidence form do not substitute for looking at and operating the real outgoing product.

This is focused internal product validation, never permission to build or submit a proof, test, or verification product, run broad suites, or repeatedly recheck an unchanged accepted version. Building and integrating the actual deliverable remains the main work; do not substitute endless reviews for delivery. Retain an exact-version visual receipt in the handoff: source/head or artifact hash, URL/file, viewport sizes, screenshots actually viewed, controls/states/export files exercised, fixes, and any precise unresolved gap. A changed outgoing version needs inspection of the affected result.

Bryce explicitly clarified: "that includes all attachments and this does not become review theatre or test theatre you need to literally observe the actual thing the way a user would see and use it". A checklist, screenshot folder, receipt, passing test, or parallel review bureaucracy is not the requirement or a substitute for actual observation and normal use. Perform focused fixes and keep shipping the main work; create no review or approval gate.

Bryce also instructed: "also add that if u make a video use voice gen tts not robot voices, use generative stuff we have models, use them". For video/media narration, use available high-quality generative voice/TTS and applicable generative visual/media capabilities when helpful, with natural professional delivery instead of robotic default voices. Actually play/listen/watch the final exported attachment and inspect clarity, pronunciation, pacing, timing, and audio alignment. Reviewing a text script does not substitute for experiencing the final video/audio. This adds no paid-service purchase or real-person voice-cloning authorization; preserve lab attribution and third-party copyright/license controls.

Pass this rule to child/delegated workers and persist it in owner-controlled provider/project/cloud instruction copies. Record delivery and readback coverage; never claim every running session loaded it without evidence. This rule creates no hooks, watchers, restarts, approval queue, credential restrictions, or new publication authority. Preserve all existing owner rules, including no llama.cpp, no private GitHub repositories or Actions, focused validation, attribution, incident communication, personal meeting approval, contact holds, demo pauses, bounty restrictions, and owner cutoffs.

Canonical local policy: `C:/Users/lucys/.commons/rendered-product-inspection-policy.md` and `.json`. Portable repository copy: `docs/policies/rendered-product-inspection-policy.md` and `.json` when present. Only Bryce can change this standing rule.
<!-- bryce-rendered-product-inspection:end -->
