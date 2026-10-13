# JavaScript source collection and independent receiving

Use this package to carry a complete JavaScript application source selection to another existing runtime. It parses source, follows literal local dependencies and declared browser URL mappings, preserves complete file bytes, and reopens the same package into an ordinary private directory. Node's standard library and the included original Acorn parser are the only native requirements.

The portable core is also callable in a connected JavaScript runtime with explicit parser, source-reader and hash bindings. Both adapters use the same source-closure result. The application itself is never imported or executed during collection.

## Collect the selected application

Create a selection from the application's actual entrypoints, explicit resources and server mappings:

~~~json
{
  "schema": "commons.javascript-source-selection/v1",
  "label": "Original application source",
  "paths": ["app/server.mjs"],
  "resources": ["app/public/index.html", "app/public/styles.css"],
  "routes": [
    {"url": "/app/", "path": "app/public/index.html"},
    {"url": "/app/main.mjs", "path": "app/public/main.mjs"},
    {"url": "/app/client.mjs", "path": "app/client.mjs"}
  ]
}
~~~

Use the original application's mappings. The example illustrates a served browser module whose relative client import names a different repository directory.

~~~sh
node host/source_closure_cli.cjs collect \
  --root /absolute/original-source \
  --spec /absolute/selection.json \
  --output /absolute/output/complete-source.json.gz \
  --gzip
~~~

The output parent must already exist. The collector starts with every selected entry/resource, follows actual literal requests, and retains all received files. It re-reads those selected files before publication so an input that changes during collection is rejected. Source collection never edits its input tree or changes an original repository ref.

The output contains all complete files, bytes/SHA-256/Git blob identities, selected routes, resolved references, complete computed expressions, external requests, parse/mapping errors and missing local paths. A gzip package contains that exact complete UTF-8 JSON. Source labels describe the operator's selection; a filesystem capture does not claim a Git commit.

A collection with parse or route errors publishes its complete received source with status INCOMPLETE and exit2. A missing source read or file-change error returns exit1 and preserves existing outputs. Repair the original selection/source, choose a new output for a changed edition, and continue the original delivery.

## Inspect the complete packet

~~~sh
node host/source_closure_cli.cjs inspect \
  --input /absolute/output/complete-source.json.gz
~~~

Inspection parses the original packet, remeasures every full source member, runs the same source parser and prints a readable complete JSON inventory and reference report. It keeps the original packet unchanged. It does not trust a stored complete flag or an old edge list.

Exit0 means the literal source/route selection is complete; exit2 identifies incomplete source; exit1 is an operation error. Full computed expressions and external selections remain in the report. Installed packages, browser binaries, credentials and dynamically chosen customer runtimes must be carried through the application's original operating procedure.

## Receive and reopen

~~~sh
node host/source_closure_cli.cjs receive \
  --input /absolute/output/complete-source.json.gz \
  --directory /absolute/private/received-application
~~~

Receiving first verifies the whole packet and source closure. It creates:

- operation.json: the exact original packet and member identities;
- source-packet.json: the complete original uncompressed packet;
- source/: every complete selected source file;
- complete.json: the final received population;
- pending/: private staged writes for that original operation.

The directory must be new, or already belong to the same exact packet. An interrupted receive resumes that same operation. Different original source bytes, changed received files, unknown extra members and symlinks produce a specific error. A new source edition uses a new receiving directory.

Each member is written to a private staged file, synced, then linked exclusively to its final path. Existing identical bytes are reused; different bytes are preserved and rejected. Complete status is written only after all original members have been re-read and verified. An interrupted staged member cannot replace a good canonical source file. Staged receiving files stay outside the selected source tree. Ordinary source files use owner-only modes; retained executable sources remain executable.

The stored complete record uses a relative source directory, so moving the complete received directory preserves its identity. The command returns the actual current absolute source path to the caller. Open that original application using its own complete operating guide and original selected runtime inputs.

## Collect this whole public tool

The included selection is a real self-delivery of this public source package:

~~~sh
mkdir -p /absolute/owned/source-course
node host/source_closure_cli.cjs collect \
  --root /absolute/public-checkout \
  --spec /absolute/public-checkout/host/examples/source-closure-self.json \
  --output /absolute/owned/source-course/source.json.gz \
  --gzip
node host/source_closure_cli.cjs inspect \
  --input /absolute/owned/source-course/source.json.gz
node host/source_closure_cli.cjs receive \
  --input /absolute/owned/source-course/source.json.gz \
  --directory /absolute/owned/source-course/received
node /absolute/owned/source-course/received/source/host/source_closure_cli.cjs inspect \
  --input /absolute/owned/source-course/received/source-packet.json
~~~

Use the same original output/directory when continuing an interrupted course. This exercises actual collection, compressed transport, independent receive and the received executable against the complete retained original packet.

## Portable connected API

Load connected_javascript_source_closure.cjs and supply the original parser and exact source-byte identities:

~~~javascript
const result = closure.collectSourceClosureSync({
  files: completeRetainedRows,
  paths: originalSelectedPaths,
  routes: originalServerMappings,
  resources: originalSelectedAssets,
  parse: acorn.parse,
  identify({content, encoding}) {
    return originalIdentityBinding(content, encoding);
  },
  readSource(path) {
    return originalPinnedSourceReader(path);
  }
});
~~~

identify returns bytes, sha256 and git_blob_sha1 measured over full decoded bytes. Source rows use complete UTF-8 or canonical Base64. The asynchronous collectSourceClosure accepts the same arguments and an awaited reader; inspectSourceClosure operates retained bodies only. Reader failures propagate without account changes, retries or implicit source substitutions.

The collector follows static imports, re-exports, literal dynamic imports, literal require requests, new URL resources and external HTML script/style/preload references. It also understands the original stellar-forge.browser-assets.v1 manifest shape used by the public merchant application.

Declared served URLs take precedence over repository layout. Each distinct serving context is retained; browser parent traversal clamps at the URL root while repository fallback rejects root escape. The same source served at several URLs may therefore have several legitimate local targets.

Computed imports remain complete expressions with source ranges, not guessed dependency names. CSS-generated references, inline HTML scripts, runtime-generated names, package export conditions and non-JavaScript imports need explicit source resources or the application's existing selection procedure. Literal CommonJS requests use exact source paths; extension/directory inference is not applied.

## Exact source and limits

The unchanged original parser is Acorn8.19.0 from nodejs/node, deps/acorn/acorn/dist/acorn.js:

- Git blob f2e9c2288173973efc6d39a11b5f8cf0e25f8b22;
- 246643 UTF-8 bytes;
- SHA-256 b95392d79457d0357555c5ed3e56302d074b92dff119bcf3b44179500b10e9df.

Its original MIT license and source descriptor are included. The native adapter checks this full parser hash before loading it into a parser-only VM context. It never evaluates the source being collected.

Default source limits are8192files,64MiB total source,8MiB per member and100000references. The selection's limits may explicitly adjust the portable core limits. The native wrapper accepts at most256MiB of complete JSON and128MiB of compressed input. Native source paths must be portable relative names: no traversal, drive/stream aliases, Windows device names, trailing dots/spaces or symlinks.

Source materialization is intended for an owned private working directory. Keep arbitrary writers away from that receiving directory during its original operation. This tool supplies full source bytes and does not install packages, call providers, change workflows or launch an application.

## Operate the delivered application

After source receiving, continue the application's original native/customer operation with its actual saved inputs, case and runtime. Open the real desktop and relevant narrow views; operate important controls, downloads and reopened outputs; view the actual rendered screens and attachments. Repair concrete product defects in that same source edition. Complete source assembly supports the work and does not replace using the outgoing product.
