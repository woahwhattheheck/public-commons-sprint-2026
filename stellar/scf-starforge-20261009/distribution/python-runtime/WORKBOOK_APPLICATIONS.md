# Workbook Applications

The Applications workspace now provides five named Workbook actions:

| Action | Original command | Required selections | Saved result |
| --- | --- | --- | --- |
| Build and receive workbook | Installed WorkbookClient with --recipe | Running Analysis database, recipe file, delivery operation directory | The original saved definition and build, complete received workbook and handoff.zip |
| Review and refresh workbook | Installed WorkbookClient with --refresh-recipe | Running Analysis database, reviewed refresh recipe, separate edition operation directory | The next original definition revision, refresh review, complete received workbook and its prior definitions |
| Receive workbook handover | Installed WorkbookDelivery receive | Complete workbook ZIP, new private receiving directory | The verified workbook, definitions, source files and history |
| Inspect saved workbook | Installed WorkbookDelivery inspect | Complete workbook directory | Verification of all original members and the definition history |
| Copy complete workbook | Installed WorkbookDelivery copy | Complete workbook directory, new private destination | A complete copy with the exact original manifest and member bytes |

These are Applications configurations over the existing Python commands. They use the original runtime connection, application revision, reviewed start, managed worker, cancellation, output history and installed Python binding. The earlier JSON-argument Workbook configurations remain available.

## Open the operator workspace

Start the original runtime workspace with its existing private directory:

~~~sh
node stellar/scf-starforge-20261009/distribution/runtime-workspace/cli.mjs \
  serve --workspace /private/operator-workspace --port 8465
~~~

Use the actual private URL returned by the maintained command. If your existing receiving programme already has an open operator workspace, use that same workspace and its Applications view. The current installation remains selected through the original Python workspace.

In **Applications**, choose **New application**, the ready runtime and one of the five Workbook actions. Select the installed Python environment. Build and refresh require its declared workbooks extra; receive, inspect and copy use the original WorkbookDelivery module.

The installed runtime must contain the original WorkbookClient or WorkbookDelivery source. An earlier runtime without those modules must be upgraded through the existing installer/Python workflow before selecting these actions.

## Build one workbook

1. Keep the original Analysis application running on the selected database.
2. Choose the workbook recipe produced for that workspace. It is the complete JSON definition, including the original expected_revision and sheet/source selections.
3. Select a private **Delivery operation directory** for this edition. The original client creates or reuses its request there.
4. Review the application. The review shows the complete selected recipe, its source path, exact retained copy and SHA-256.
5. Save, connect the original ready runtime if necessary, then **Review start** and start the application.

The source recipe is retained byte for byte in the operator workspace's workbook-inputs directory. The original CLI receives that selected copy. Editing the external recipe after review does not silently change a queued build. A later start review reads the current source again and shows the newly selected content before dispatch.

The original client retains its save request and build ID in the delivery operation. Repeating a start with that same operation and recipe continues those original IDs; it does not create another workbook edition.

**Wait for this delivery** defaults to 300 seconds. A zero value starts the original job and returns promptly. An ended command can therefore have a workbook delivery still pending in Analysis. The result view names that original job and explains how to start the same saved configuration again to finish its receiving. The worker's exit and the workbook's delivery state are shown separately.

## Refresh an existing workbook

Choose **Review and refresh workbook** with the original refresh recipe. It carries the selected base definition revision and digest, successor source selections, column projection choices and edition note. Select a new delivery operation directory for that edition.

The existing WorkbookClient calls the original Analysis refresh-review endpoint before saving. If its projection is not ready, Applications displays that retained review and no complete workbook is claimed. A retained review without a saved client intent is labelled as earlier operation context; it is not presented as approval of an edited recipe. Resolve the actual choices in the original Analysis workbook workflow, update the selected recipe, and review the current application/start.

A completed refresh retains its previous definition files and the exact original source material. The result view checks that history through WorkbookDelivery and makes those files available with the current workbook.

## Receive, inspect and copy

**Receive workbook handover** accepts a complete original workbook ZIP. Review reads its original manifest and pins the full archive SHA-256. The original receiver performs the full member verification during execution. Its default expanded-byte ceiling is 1 GiB; the named maximum field maps directly to the maintained --max-bytes option.

Receiving requires a new destination under a private real parent. An existing destination is preserved. Use **Inspect saved workbook** to reopen an existing received directory.

**Inspect saved workbook** verifies every retained member and the complete definition history. Review pins the manifest checksum even when the optional expected checksum field is empty.

**Copy complete workbook** uses the same original verification and pins the selected manifest. It creates a new private destination using WorkbookDelivery.copy_to. All copied members retain their original bytes and source identity.

## Open the saved files

After an operation ends, open its output in the Applications history. **Workbook result** reads that exact original run and its selected Python installation. It verifies:

- The application run and its retained start review.
- The command and source selection used by that run.
- The original delivery operation, recipe identity, saved definition and build ID for build/refresh.
- The manifest, all original member bytes and the full definition history.
- The exact complete handover ZIP when that operation retained one.

The result lists workbook name, revision, original workspace/build, row and sheet counts, actual directory, definition, history and each file's bytes/SHA-256. Download buttons use the existing workspace capability and a short-lived, single-use route. Every download rechecks the selected manifest and file bytes.

Copy/inspect results can be complete directories without an adjacent ZIP. They still expose every original workbook member. A retained build or receive archive is offered only after it matches the complete original delivery.

If an older JSON-argument configuration did not pin its input manifest, the view labels its output as verified current files. It does not turn that current inspection into an invented historical input checksum.

The browser's current selection is kept across slow responses: switching application or operation cannot display a returned file list under a different run. Reopening the operator workspace uses the original application/run records and requests a new download link.

## Original CLI equivalents

Use the Python executable from the selected retained installation, including its lexical virtual-environment path.

~~~sh
VENV_PYTHON -m stellar_forge_buyer.workbook_client \
  --database /private/analysis \
  --recipe /private/workbook-recipe.json \
  --operation /private/workbook-edition \
  --wait-seconds 300

VENV_PYTHON -m stellar_forge_buyer.workbook_client \
  --database /private/analysis \
  --refresh-recipe /private/workbook-refresh.json \
  --operation /private/workbook-following-edition

VENV_PYTHON -m stellar_forge_buyer.analysis_workbooks receive \
  --archive /private/handoff.zip \
  --destination /private/received-workbook \
  --sha256 ORIGINAL_ARCHIVE_SHA256

VENV_PYTHON -m stellar_forge_buyer.analysis_workbooks inspect \
  --delivery /private/received-workbook \
  --manifest-sha256 ORIGINAL_MANIFEST_SHA256

VENV_PYTHON -m stellar_forge_buyer.analysis_workbooks copy \
  --delivery /private/received-workbook \
  --destination /private/workbook-copy \
  --manifest-sha256 ORIGINAL_MANIFEST_SHA256
~~~

## Source integration

Named selections and immutable recipe copies are implemented in python-runtime/workbook-application.mjs. The existing application-lifecycle.mjs catalog and command preparation compose them into the original Python provider.

python-runtime/workbook-results.mjs binds each file view to the original Applications run/review and Python descriptor. workbook_result.py uses the installed original WorkbookDelivery implementation for full inspection and archive verification. It performs no acquisition, SQL execution, workbook build, refresh save or receiving mutation.

The Applications model/server add the result and download routes under their existing capability/origin checks. The public workbook-results.mjs module supplies the source review and file view through a small hook in the existing Applications UI.

The review endpoint also accepts its already-supported providerId field, matching the current Applications form and original provider-aware review method.
