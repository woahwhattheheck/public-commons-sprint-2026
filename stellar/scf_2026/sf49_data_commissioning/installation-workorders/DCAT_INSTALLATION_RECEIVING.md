# Receive a complete catalogue Installation

This course continues an actual saved Workshare Installation prepared with the catalogue desk. It receives the same complete Operations archive and the same complete catalogue archive into independent local directories, verifies the selected Installation and all its source attachments, reopens both original applications, and optionally uses the actual preparation desk through the existing Playwright installation.

The course consumes the actual prepared request and saved Installation IDs. It does not choose commercial terms, save an Installation on the customer's behalf, rerun a catalogue migration or semantic engine, or substitute an example case for the selected case. The source is executable engineering delivery. Execution, browser observations and image review are separate evidence; no native or rendered completion is asserted merely because these files are installed.

## Start from the actual prepared and saved work

Follow [DCAT_INSTALLATION.md](DCAT_INSTALLATION.md) through complete archive import, source inspection, explicit included and excluded scope, original source attachment, fresh case and Workshare seed, preparation, and the original Installation Preview and Save.

Keep the complete preparation request UUID from the desk and the actual saved Installation ID and revision returned by the original Operations writer. The prepared document must match that saved revision exactly. The source archive and selected-scope file must be complete actual attachments in the case, with the exact IDs, sizes and SHA-256 values recorded in the prepared scope.

A preparation directory can have a running browser or managed Applications owner. Completed immutable requests and files can be read concurrently. Mutations use the service's original per-operation lock; retry a busy request using its same UUID and exact inputs. This course retains its own output lock and closes only the service/model/server instances it creates.

Use private, independent absolute directories for the sender Operations workspace, preparation root, receiving Operations workspace, receiving catalogue workspace and course output. Neither receiving directory nor course output belongs inside installed source. The catalogue receiver is the maintained original `.ckanw` receiver, and the Operations receiver is the maintained original `operations import` command.

## Private input

Create an owner-only JSON file outside the installed source. Replace every illustrative path and ID with the values from the actual selected host and saved case.

```json
{
  "preparationDirectory": "/private/catalogue-installation",
  "preparationRequestId": "11111111-1111-4111-8111-111111111111",
  "operationsWorkspace": "/private/original-operations",
  "caseId": "actual-original-case-id",
  "installationId": "actual-saved-installation-id",
  "installationRevision": 1,
  "receivingOperationsDirectory": "/private/received-operations",
  "receivingCatalogDirectory": "/private/received-catalogue",
  "outputDirectory": "/private/catalogue-installation-receiving",
  "actor": "Actual receiving operator",
  "python": "/absolute/original/python"
}
```

The Python executable must support the original SF47 Operations application included in the installed distribution. The course launches that application's actual `workspace/cli.py`, alongside a small read-only helper that delegates whole ZIP and Installation selection validation to `Operations._unpack` and `operations_installations.selection_from_files`. The helper does not implement a second case importer.

For the actual browser course, also select the host's existing complete Playwright module and browser executable:

```json
{
  "playwrightModule": "/absolute/existing/playwright/index.mjs",
  "chromiumPath": "/absolute/existing/chrome-headless-shell"
}
```

Add those two properties to the same complete input object. They are not installed or downloaded by this programme. Choose browser participation before the first call: the retained arguments bind whether the browser is selected, its actual executable identity and, when supplied through the CLI, its module identity. Continuing with different inputs requires a new explicitly selected output directory.

Run the installed original command:

```sh
starforge dcat-installation-receive --input /private/receiving.json
```

From an unchanged source checkout, the equivalent entrypoint is:

```sh
node stellar/scf_2026/sf49_data_commissioning/installation-workorders/dcat-installation-receiving.mjs --input /private/receiving.json
```

The programme prints its complete result as JSON. Its retained phase files and native stdout/stderr remain in the selected output directory. Private input paths are operational data; the live browser bearer URL stays in process and is not a public artifact.

## What the programme actually does

1. It reads the canonical completed preparation through the same `createDcatInstallationService` used by the desk, CLI and MCP. It retains the full request/result envelope and every attached input and prepared output, including the original profile, source report, bindings, selected scope, Installation document, preview input and workorder.
2. It reads and exports every member of the selected original catalogue archive using the original verified member reader. Relocated workbench metadata uses the receiver's saved original bytes. Exact member paths, byte counts and SHA-256 values remain available.
3. It asks the original Operations CLI for the selected historical saved Installation and case. It requires exact document equality with the preparation and verifies the complete archive and scope attachments against the original case source IDs.
4. It receives the complete catalogue through the original `.ckanw` receiver into the independent catalogue directory, revalidates the original source inventory, opens the original workbench and closes/reopens it. The current recipient's catalogue identity and saved DCAT state must remain unchanged during this cold reopen.
5. It exports the selected saved Installation using the original `installation-export`. Before importing, the helper invokes the original full archive validator, verifies its case/Installation selection, exact document, and complete bytes of every selected source attachment.
6. It imports that complete Operations archive into the independent Operations workspace using one retained, deterministic request ID. It reads the selected historical Installation and all bound sources twice through separate original CLI processes, confirming the independent cold reopen.
7. If an actual browser runtime was selected, it starts the existing preparation server on an actual private loopback listener and invokes the companion against the same completed preparation. It checks the returned request identity, verifies every saved browser download and screenshot, and validates any second browser-produced preparation against the exact original Installation, source and scope. This does not create another Operations Installation.
8. It closes the instances it owns and retains the complete result. Native command cancellation uses TERM followed by bounded KILL and waits for the owned process to end before recording its terminal result and logs.

The browser companion uses the actual desk history, scope pages, filters, source rows, working drafts, bindings and downloads at desktop and narrow widths. A second Prepare is valid only if the exact selected-scope bytes still match the actual case attachment. A serialization mismatch is evidence to fix in the product or actual source selection, not permission to alter the case or silently attach different bytes.

## Continuation and interrupted responses

Keep the same complete input and output directory when resuming. The programme retains its original arguments and source identities before continuing. A differing pre-existing phase file or output file is preserved and rejected; it is not overwritten.

The catalogue receive reuses the original receiver's retained identity. The Operations import uses the same deterministic original request and must return the same local case. A previously produced ZIP whose response was lost is checked with the original whole archive reader before it can be imported. The actual selected Installation revision is inspected as a fixed historical edition even if the received case later accumulates further work.

Completed browser phases are reused only after the complete saved file identities have been verified again. Incomplete browser attempts remain named output files and can continue through the companion's original durable progress. A completed native receive with an incomplete browser course reports `BROWSER_INCOMPLETE`, retaining `sourceReceivingComplete: true`; it is not labelled complete rendered use.

The private output contains:

| File or directory | Meaning |
| --- | --- |
| `Original_Receiving_Arguments.json` | Exact selected paths, saved IDs, actor and browser participation |
| `Original_Receiving_Source.json` | Actual original CLI, archive helper and Python identities |
| `Original_Preparation.json` | Canonical whole preparation request/result |
| `prepared/` | Every original input and prepared attachment, keyed by complete file ID |
| `catalogue-members/` | Every exact original catalogue archive member |
| `Complete_Original_Installation.zip` | Full original selected Installation/case export |
| `Original_Import_Intent.json` | Same-request independent Operations receive identity |
| `native/` | Actual original subprocess arguments, terminal outcomes and full log identities |
| `browser/` | Actual browser progress, downloads, desktop/narrow images and observations |
| `Dcat_Installation_Complete_Receiving.json` | Completed selected programme and explicit rendered-use qualification |

Errors and cleanup failures remain separate named JSON files. Keep the same request and retained evidence when resolving an interruption. A directory containing a different source or case is not an empty receiving target.

## Use and look at the actual delivery

Before presenting the work as client or prospect ready, the producing seat must open/run/render this exact installed edition, personally use the important controls, inspect relevant desktop and narrow states, download and reopen the attachments, and open all outgoing files as the recipient. Look at the actual screenshots and fix visible defects in the product. The programme marks saved screenshots and the final visual-review field `viewedByOperator: false` until that inspection occurs; taking an image is not evidence that anyone examined it.

Whole source checks, native commands, HTTP results, schema validation and a peer's source review support the delivery but do not replace that actual use. Keep observed results with the selected original request; do not infer a successful browser or customer operation from source publication.

## Module callers

The native export is:

```js
runDcatInstallationReceiving(input, {
  signal,
  playwright,
  chromiumPath,
  browserContext
})
```

The optional existing Playwright object is passed in process. A borrowed context remains owned by its caller; the browser companion closes only the pages it creates. Without a borrowed context it launches and drains its own selected browser. The native entrypoint owns the actual private server it starts and does not adopt or stop an unrelated Applications process.

The complementary browser export is:

```js
runDcatInstallationBrowser({
  playwright,
  chromiumPath,
  listener: { url, origin },
  outputDirectory,
  preparationRequestId,
  expectedPreparation,
  signal,
  browserContext
})
```

`expectedPreparation` is the full canonical `service.get(preparationRequestId)` envelope, including `request`, `status` and complete file descriptors. Its downloads and screenshots carry actual absolute output paths, byte counts and SHA-256 values. If it prepares again through the actual UI, `browserPreparation` is the complete canonical receipt for that new preparation; the native programme validates equality of source, scope and original Installation before accepting it.

The installed `dcat-installation` contribution and complete distribution manifest select the programme, original helper, browser companion and this guide alongside the source inspector, original service and UI. Managed Applications startup verifies the complete installed source manifest and its selected executable. Historical catalogue receiving remains usable without selecting the semantic Python runtime, because this course does not dispatch the semantic engine.
