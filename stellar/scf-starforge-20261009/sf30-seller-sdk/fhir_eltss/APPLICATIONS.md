# eLTSS care plans in Applications

The eLTSS care-plan workbench opens the same saved native workspace from the
installed Runtime workspace's **Applications** catalog. Its source, graph,
complete field review, original acquisition, authored corrections, datasets and
receiving history stay together under the original workspace UUID.

The application launches the original `eltss-careplans serve` command. The
maintained Applications lifecycle owns its process, source selection, managed
runtime connection and Start/Stop history. The source contribution adds this
provider without changing the shared lifecycle.

## Receive and select the complete runtime

Receive a cumulative source release containing the complete
`stellar/scf-starforge-20261009/sf30-seller-sdk/fhir_eltss/` source and its
`distribution/contributions/eltss-careplans.json` contribution. Use the existing
distribution builder, installer and dependency profile. Reopen the Runtime
workspace after receiving that release so its source-owned provider catalog
contains **eLTSS Care Plans**.

The original native receiving result, `OPERATED_ELTSS.json`, identifies the
completed workspace through `workspace` and `workspaceId`. Select that directory
when continuing the received work. A new operator can initialize a new private
workspace with the same native CLI:

```sh
node /absolute/source/stellar/scf-starforge-20261009/sf30-seller-sdk/fhir_eltss/cli.mjs \
  init --workspace /absolute/private/eltss-workspace
```

The private directory contains its original `workspace.json` marker and
`eltss/identity.json` UUID. Original source files, native datasets, graph indexes,
saved field selections, downstream attachments and acquisition records are
editable work within that directory.

## Open through the installed operator

1. Open **Applications** in the Runtime workspace and choose **New application**.
2. Enter a display name and select the received READY runtime.
3. Select **eLTSS Care Plans**.
4. Enter the **Initialized eLTSS workspace** directory.
5. Select an existing private **Authentication profiles** file when the original
   source uses a configured FHIR bearer or SMART profile.
6. Select the ordinary private environment file if the chosen process needs
   configured environment variables. Keep **Local port** at 0 for an available
   loopback port, or use the intended fixed port.
7. Choose **Review application**, inspect the exact workspace and runtime, and
   choose **Save application**.
8. Continue the existing managed runtime connection when the Applications
   screen offers that saved operation.
9. Choose **Review start**, then **Start reviewed application**.
10. Use **Open application** to enter the same private eLTSS workspace.

The startup provider checks the original workspace marker and UUID, the selected
directory, the emitted loopback URL and the authenticated native state. Ordinary
source edits and new dataset editions stay within this same saved application.
An imported archive with a different workspace identity is reviewed as that
selected workspace before its next launch.

## Complete operator workflow

| Section | Saved work and resulting behavior |
| --- | --- |
| Sources | Receive a complete FHIR resource, Bundle or source ZIP; inspect every original member and exact resource entry. |
| Acquisition | Select an original source and authentication profile; retain actual metadata; save and continue the same Bundle, CarePlan operation or reviewed REST graph request. |
| Care plans | Build the reference graph, inspect original resources and edges, and save explicit CarePlan editions. |
| Field review | Adopt all 56 published fields; retain their original definitions and mapping guidance; review exact source selectors, applicability and conversions. |
| Assessment | Run all selected CarePlan field cells, inspect exact source values and unresolved references, and retain explicit decisions. |
| Corrections | Preview exact authored changes to original resource records; apply the saved request hash to produce a complete successor source and edition. |
| Datasets | Review the original SF30 mapping, build a complete native dataset, query declared fields and compare native editions. |
| Delivery | Prepare a full selected handoff, receive original packets, retain actual downstream results and restore complete editable workspaces. |

Source uploads support 256 MiB, up to 5,000 resources and 100 CarePlans. The original
Bundle parser works incrementally and the reference graph is disk indexed.
Interactive resource and assessment pages expose the native actual next offsets.
The complete editable transfer supports 512 MiB. The live catalogue exposes the
selected limits and published source version.

The field editor keeps one row for every published eLTSS field, including drafts
and rows marked not applicable. It stores exact ordered graph selectors and
original source locations. A saved review can create a successor review while
retaining the original. An assessment distinguishes actual present, absent,
unresolved, not-applicable and pending-review cells.

A correction selects the original resource record and exact JSON path tokens.
The preview freezes the complete original request; applying it uses that saved
preview ID and request hash. Its resulting source remains linked to the original
source and edition. The full original files remain available for receiving.

## Continue original acquisition and receiving

A saved request and native operation retain their original IDs, exact response
URLs, provider retry times and received members. **Run complete acquisition**
continues that same operation until complete, paused or a provider result needs
attention. **Pause after current response** pauses its local continuation.
**Resume original operation** continues its saved request. Reopening the browser
lets the operator select that saved operation and continue from its retained
native state.

Receive a full care-plan handoff to reopen its selected source, graph, full field
review and edition. Receive a native customer packet to reconstruct its source,
mapping and dataset through the original SF30 engine. Whole editable restoration
uses a fresh native workspace and retains the archive's original identity and
operation history.

Attach the actual downstream result before recording its receiving state,
destination object ID, original operation ID, time, actor and any correction
predecessor. The complete handoff carries original members, selected collection
Bundle, graph, all field rows and assessment cells, decisions and a human-readable
entry point.

## Stop and reopen

Use the installed Applications **Stop** action to end the owned process. Reopen
the Runtime workspace, select the same application, review the start and open
it again. Its source, UUID, original acquisitions, all field selections and
complete receiving records remain in the original private workspace.

The live connection descriptor is `eltss/operator-connection.json` with schema
`stellar-forge.eltss-operator-connection.v1`. Its original server startup uses
`stellar-forge.eltss-startup.v1`. The descriptor contains the private loopback
connection needed by an explicitly selected local client. Whole-workspace
transfers enumerate retained work and omit that live connection.

## Operate the installed Applications workflow

`operate_installed_applications.mjs` uses the existing Runtime workspace host to
attach a complete READY distribution, review and save this application, and open
the same native workspace through **Open application**. Its first start runs the
complete care-plan browser journey and receives every original file. It then
stops the application, reopens the Runtime host, starts the same saved application
again, and reads all original source, review, correction and receiving identities.
The second start retains the first complete editable download.

Run it after `operate_receiving.py` has produced the original
`OPERATED_ELTSS.json`, using the cumulative distribution containing this provider:

```sh
node SOURCE/stellar/scf-starforge-20261009/sf30-seller-sdk/fhir_eltss/operate_installed_applications.mjs \\
  --runtime-directory /absolute/ready-runtime \\
  --runtime-workspace /absolute/private-runtime-workspace \\
  --receiving /absolute/native-receiving/OPERATED_ELTSS.json \\
  --out /absolute/installed-applications-receiving
```

Use `--playwright /absolute/playwright/index.mjs` and
`--chromium /absolute/chromium` when selecting installed browser binaries. Retain
the same output directory when continuing. The complete result is
`OPERATED_ELTSS_APPLICATIONS.json`; the original Applications history and complete
browser downloads remain alongside it. Runtime source, source manifest,
application ID, workspace UUID and original native receiving are fixed in its
saved selection.
