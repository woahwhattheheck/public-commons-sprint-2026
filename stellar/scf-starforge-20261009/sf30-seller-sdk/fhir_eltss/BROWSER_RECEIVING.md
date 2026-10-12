# Original browser receiving

This command opens the complete native eLTSS result through the actual industrial
operator. It selects the original sources and saved editions, opens every one of
the 56 field rows, reads all assessment pages, queries the native dataset and
receives complete source, comparison, dataset, customer, handoff and workspace
files through the browser.

First finish the whole operation in [NATIVE_RECEIVING.md](NATIVE_RECEIVING.md).
Use its same original workspace, `OPERATED_ELTSS.json` and runtime source.

## Start and select the same operator

Start the original operator with the maintained job/process owner:

```sh
node /ABS/SF30/fhir_eltss/cli.mjs serve \
  --workspace /ABS/eltss-operated/workspace \
  --expected-workspace-id ORIGINAL_WORKSPACE_UUID \
  --port 0
```

Retain the first complete startup JSON line in a private `ELTSS_STARTUP.json`.
It contains the actual private address, original UUID, listener identity and
connection-file path. Keep that server under its original process owner while
the browser receives the selected work.

Run the complete browser command with the installed Playwright/Chromium:

```sh
node /ABS/SF30/fhir_eltss/operate_browser.mjs \
  --receiving /ABS/eltss-operated/receiving/OPERATED_ELTSS.json \
  --startup /ABS/eltss-operated/ELTSS_STARTUP.json \
  --out /ABS/eltss-operated/browser \
  --playwright /ABS/EXISTING/playwright/index.mjs \
  --chromium /ABS/EXISTING/chromium
```

The final two arguments are optional when the existing runtime already resolves
Playwright and its browser. The command also uses the configured primary-runtime
Node module directory when needed.

## Complete original journey

The browser opens all nine work areas. It receives both complete original source
editions, opens the saved CarePlan graphs, selects the complete review and its
first/final published fields, follows every assessment page to the actual end,
opens the authored correction comparison, queries the native dataset and its
returned next page, and receives all full delivery files.

It retains twelve actual desktop/compact/reopened views and the complete field
pages and query responses. Its downloads include the full field cells and
edition changes, native dataset, original customer packet, CarePlan handoff and
editable workspace. File identities are streamed from the complete bytes.
Reopening the browser confirms the original saved collections and UUID.

`OPERATED_ELTSS_BROWSER.json` contains the actual selected IDs, completed time,
all screenshot/file identities, field-cell count, query and original-state
observations. The full files named by that result form the usable delivery.
`BROWSER_JOURNEY.json` retains the original binding and received files for
continuation with the same command. Already completed downloads are reopened
against their retained complete hashes.

The reusable `operateEltssBrowser({page,url,native,output})` export accepts an
already opened page from the maintained Applications lifecycle. The caller
keeps ownership of its page and server; the browser operation owns only its
selected output lease and complete files.
