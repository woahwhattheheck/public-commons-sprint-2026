# Budibase commissioning

An offline workspace for receiving an existing Budibase application, planning its implementation, recording actual operating outcomes, and handing the complete project to another operator.

The browser and Node command line share one core. The workspace retains original exports and document revisions, immutable plans, case observations, accepted editions, and byte-for-byte source downloads. It distinguishes current workspace archives, project packages and legacy catalogue templates.

## Start

Open [index.html](index.html) in a current browser. No account, server or dependency installation is required for the offline application.

For the command line, use Node.js 22 or newer on a POSIX filesystem:

```sh
node cli.mjs help
mkdir -m 700 ./customer-work
node cli.mjs create --project ./customer-work/project.json --id customer-workflow --name "Customer workflow" --request ./customer-work/create.request.json
node cli.mjs capture --project ./customer-work/project.json --source /absolute/original-export.tar.gz --request ./customer-work/capture.request.json
node cli.mjs plan-template --project ./customer-work/project.json --out ./customer-work/plan.json
```

Edit the plan for the actual target, implementation scope, service and role owners, independent reviewer and operating cases. Perform the native import and application work in the selected Budibase installation, then record the actual results. The programme retains the commissioning record; the installation performs native execution and publication.

- [Operating guide](OPERATING_GUIDE.md): complete source-to-acceptance and independent receiving workflow.
- [CLI guide](CLI_GUIDE.md): all commands, original requests, atomic project publication, and interrupted-operation recovery.
- [Commercial programme](commercial/BUDIBASE_COMMERCIAL_WORKSHARE.md): editable scope, staffing, invoice, cash, capacity and adoption model.
- [Source provenance](SOURCE_PROVENANCE.json): exact upstream commit and original fixture identities.

## Build and complete handover

```sh
node build.mjs
```

The builder reads the actual complete source files named by source-packet.json and rebuilds index.html with their compressed contents. The app's Download programme action exports that full editable source and the standalone app. Complete customer handovers retain every original capture, saved plan, observation and edition; the CLI includes its complete receiving programme.

The two compressed official examples are retained as exact base64 files under fixtures/. The browser decodes them directly. Their original compressed byte counts and SHA-256 values are in SOURCE_PROVENANCE.json.

## Review and limitations

The shared engine and original official examples were exercised in V8, and the browser, commercial model and CLI received independent source review. Native deployment outcomes and customer case results are entered by the commissioned operators.

Needs expert review: confirm the chosen Budibase version and import effects, actual role and connector configuration, customer acceptance, and commercial assumptions for the selected engagement. The default fees, costs and role capacities are editable planning examples.

## Licence

The commissioning implementation uses the repository's MIT licence, copied into [LICENSE](LICENSE). Original Budibase examples retain their upstream licence and provenance. See [THIRD_PARTY.md](THIRD_PARTY.md) and [UPSTREAM_LICENSE.txt](UPSTREAM_LICENSE.txt).

## Complete receiving

The operating guide includes the actual desktop, phone, all-attachment and cold-reopen receiving course. Open and inspect the exact outgoing programme, operate its controls, view its real screenshots and open every emitted attachment before presenting that edition as ready. Preserve the original source/project identities and integrate concrete repairs in the same product.
