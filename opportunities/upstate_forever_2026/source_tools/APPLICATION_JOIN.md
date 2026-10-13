# Compose the current application in JavaScript

The application now has one source composer for coordinators that can run JavaScript and read complete tool responses. It uses the existing carrier codec and emits the same complete source-map format that the original Python receiver installs. The Node command also writes the full source JSON, its Canvas carrier and the existing portable source ZIP.

This workflow assembles the application before the native host opens it. It keeps the source files, component paths, original workspace methods and native task entrypoints together. Original scientific inputs remain in the existing receiving workspace.

## Command line

Run from the received application directory with Node:

~~~sh
node source_tools/application_join_cli.mjs complete-application.md \
  --overlay current-component.json \
  --join integration/d406-current-operator-parcel-join-20261013.json \
  --edition upper-savannah-current \
  --operation-id UPSTATE-FULL-PRODUCT-BUILD-BRYCE-20261012 \
  --source-map upper-savannah-current.json \
  --carrier upper-savannah-current.md \
  --zip upper-savannah-current.zip
~~~

The order of each --overlay and --join argument is the application source order. Select complete components whose declared predecessors match the source being composed. The original complete application is the first input. Keep an already newer shared file by applying the owner's exact join plan to that current file.

The command writes to fresh output names. A repeated identical output is reused. Files are published from a temporary file with an atomic directory entry so a partial write cannot become the completed output.

The ZIP contains the complete source root, including the original Python receiver and component installers. The Markdown carrier can be placed into the established source-delivery thread. It carries the complete original JSON bytes, divided into numbered gzip/base64 parts.

## In a JavaScript coordinator

The module takes strings, decoded source documents, or full original Slack/Drive file responses. It reads Slack text_content and Drive b64_string from structuredContent. Original byte counts and file SHA256 values are checked during decoding.

~~~js
import {readSourceLayer, composeApplication, layerFromDocument,
        applySourceJoins} from "./source_tools/application_join.mjs";
import {encodeApplicationCarrier} from "./source_tools/carrier_codec.mjs";

const base = readSourceLayer(originalApplicationResponse, {
  label: "original complete application",
  expectedPayloadSha256: originalPayloadSha256
});
const component = readSourceLayer(originalComponentResponse, {
  label: "current complete component"
});
const first = composeApplication([base, component], {
  edition: "upper-savannah-current",
  operationId: originalOperationId
});
const joined = applySourceJoins(layerFromDocument(first), originalJoinPlan);
const final = composeApplication([base, component, joined], {
  edition: "upper-savannah-current",
  operationId: originalOperationId
});
const carrier = encodeApplicationCarrier(final);
// Publish carrier.markdown through the existing source-delivery surface.
~~~

readSourceLayer handles a complete source map, a full base64 file bank, or all numbered application-source carrier parts. Original carriers that omit a compressed-byte hash still supply their complete payload SHA256 and size; the gzip framing, declared compressed size and complete decoded payload are checked. Drive's original UTF-8 BOM remains part of the original payload identity.

A source bank contained in one JSON fence is identified by the exact JSON body inside that fence. Canvas nonbreaking-space indentation is accepted outside JSON strings while every source-string character is preserved.

## Shared source joins

An integration plan uses schema upstate.operator-integration/v1, allowed_paths and edits. Each edit names id, path, before and after. The composer applies the unique original span as literal text. A source span already at the exact postimage is retained. Ambiguous spans identify the current file that needs a fresh join.

Literal replacement is essential for browser source: JavaScript replacement-string syntax would turn the all-elements selector $$ into $. applySourceJoins always uses a callback, so selectors and other dollar sequences retain their exact source text.

The delivered current-operator plan joins these changes into the current maintained host:

- The original run.start invocation keeps the retained native task and attempt.
- The original run view can select completed NDR and SDR model stages and display their origins.
- Navigation and model-profile controls select all matching elements.
- Parcel inventory falls back to the imported source's declared id_field so county parcel identifiers survive conservation and map delivery.

The complete source bank also supplies the current version 4 Watershed reports descriptor with its native preview route. Current programmes, customer reviews and experiment task actions stay in the maintained host.

## Original sources and references

Every embedded source file retains its full body, mode, SHA256 and contributing layer identities. Changed existing bodies or modes require the exact prior file SHA256. The reader accepts `base_sha256`, `replaces_sha256`, `before_sha256`, nested `before.sha256`, and object `base.sha256`. A string `base` remains its source-ref label. Conflicting aliases fail with the affected path. Identical postimages and additions compose directly; repeating a completed replacement succeeds even when it names its original predecessor. Unmentioned files remain present.

Identical source-bank fragments preserve whichever predecessor declaration is present and retain all original before/base/source-ref declarations in `assembly.changes[].predecessor_declarations`. Completed source-map members contain snapshot metadata, so that map can be reopened as the next base.

For a legacy component whose shared bodies differ from the current application, use its maintained `applySourceJoins` plan against the current source. Publish the resulting complete member body with its actual predecessor; arrival order does not establish which shared source is newer. Keep the complete current application as the base. The Python [application assembly guide](APPLICATION_ASSEMBLY.md#join-a-changed-module-into-current-source) gives the exact pinned PR2714 host-resolution example and its reusable source-bank producer.

The original cumulative application contains both external file identities and original document references. Byte-identified external files remain in external_sources. The original reference objects remain unchanged in external_references and participate in the composition identity. The current Python receiver contains the same compatibility correction, so later source composition preserves them.

Scientific input files continue through the original source import and native model programme. Application composition neither copies a live workspace nor changes retained run, task, dataset or source-collection identifiers.

## Receive and use the application

Use the maintained source_tools/application_assembly.py receiver for the complete source map or carrier, and retain the current workspace and operator data paths. Apply the installed component registrations through the maintained installers before opening the operator. The parcel desk installer adds its descriptor to the same extension registry.

The parcel operator guide and receiving command provide the actual capture → source import → native map → conservation → delivery workflow. Run that journey with the existing host's launch JSON and captured source directory, or with an already prepared parcel edition. The completed-model form continues the existing retained native run, including its source input comparison and annual reporting outputs.

## Current source transports

The reader accepts original multipart application gzip carriers, the separately headed experiment transport, and ordered plain Base64 source-bank parts. Original payload identities and every declared source member identity are checked before composition. When Canvas has replaced source indentation with nonbreaking spaces, restoration is accepted only if both the exact original byte count and SHA256 match the original declaration. Full byte-identified external inputs remain separate from original URL/reference records; both are retained in the resulting application identity.

## Original-source composition exercise

The original JavaScript composer and this revision were executed in V8 with the retained 252-file `F0C8JNZTURK` application (decoded SHA256 `49d32e6b7f5c3a764054076c65059cc6856f33d7b7cef5d6408adbd0de7d5c67`) and actual `F0C8Q6C81U2` component (decoded SHA256 `f53449e76a78c4d851bb44c6e0b03f917a9d9f1ffa36b818b4145b8ee2c91f22`). Both versions correctly reject the unmodified component's declared app predecessor against the pinned newer host.

A separate interface exercise translates that same declared predecessor value into `before.sha256`, retaining the exact original source body. The old reader ignores the spelling and replaces the newer app; this reader recognizes it and reports the actual source conflict. The explicit pinned-current host join preserves all other 251 members, and an identical replay succeeds. The real three-file ECSA1.2.3 carrier `F0C8K105GUV` also retains its existing flat `before_sha256` values and per-file `base_ref` through normalization.

## Receive an exact external source member

When an original code file is declared in `external_sources`, `complete_external_source.py` first checks selected existing application directories. With `--allow-download`, it can receive the same original file from the declared HTTPS source URI. Both byte count and SHA256 must match. It then composes the actual body into the source map and checks local imports before writing the new application directory, source map or archive.

Run from the received application source tools directory:

```sh
python -B complete_external_source.py ORIGINAL_CARRIER.md \
  --member model/spatial_regions.py \
  --source-root EXISTING_APPLICATION \
  --allow-download \
  --edition upper-savannah-current-with-original-dependencies \
  --output NEW_COMPLETE_APPLICATION
```

Each selected member must already have an exact original identity and source URI in the carrier. An already embedded member is reused. The command does not replace the selected original application or its scientific Workspace. It can also publish `--source-map` and `--zip` outputs for the same completed edition.

## Complete native source capacity and experiment installation

Use the matched source composer, carrier codec, standalone receiver and maintained Python assembler from the same current application. The JavaScript source member accounting and gzip decoder, and receive_application_source.py, accept up to 512 MiB (536,870,912 bytes) and 10,000 source members. Receive source_tools/application_assembly.py with the same MAX_BYTES value when continuing a large complete application; keep its current component catalogue and source-family capture implementation. Original encoded payload sizes, decoded source sizes, file modes, hashes and predecessor declarations are still checked.

The carrier remains the complete selected source. Use its existing numbered parts when the delivery surface needs multiple documents, then receive all parts in their original order. A source-size ceiling is separate from a provider's per-document limit. The maintained codec retains its original gzip framing and complete decoded byte identity.

The experiment installer recognizes the actual Handler.do_GET static asset comparison through Python's syntax tree. It adds experiments.mjs and experiments.css only to that comparison's original leftmost literal file set, preserving nested extension unions and every unrelated statement. UTF-8 column offsets are converted to character offsets before replacement. An already-present pair is reused; an unsupported registry remains an explicit source-composition error.

These changes adopt the original completed native application's installer and transport bodies. Continue the existing source assembly and original Workspace/model/report operation after receiving them. The complete current application remains the base, with each changed source leaf bound to its actual predecessor.

## Observe the outgoing application and attachments

Before presenting the assembled app, demo, report or any attachment, the producing peer must open and normally use the exact outgoing version, view its rendered screens or real screenshots, and operate the important controls. Inspect the actual presentation width and relevant narrow width, populated/loading/empty/error states, downloads and reopened files. Open the delivered HTML, report/PDF pages, maps, archives and editable projects as the recipient would; play final audio/video. Fix concrete presentation and interaction defects as part of delivery. Source inspection, tests, HTTP success and captured screenshots that were never viewed do not replace this observation.

Apply the complete current [owner instruction](../AGENTS.md) to local, cloud and delegated workers. Use plain industrial presentation; keep the real scientific workflows and original data. For video narration, use available high-quality generative voice/TTS and listen to the final export. Keep this focused on improving and shipping the product, with the existing sprint cutoff and owner controls.

## Freeze and receive shared source changes

Use composeSourceJoins for a shared host update that needs a complete recoverable source bank. It keeps the same literal join format and returns {layer, bank, receipt}. The original applySourceJoins API remains available for existing callers.

Read the current source again before composition. Each integration edit still names an ordered, unique id, path, before and after. Use file_guards to bind each touched file to its exact full UTF-8 byte count and SHA-256 before and after the edits. These guards cover the whole current file, including peer additions. A changed base needs a freshly composed plan; an exact completed postimage is reused.

A plan may also include checks. Each check has an id, path, literal text, exact count, and optional phase (after by default, or before). Use these for the actual consumer: for example, the original server decorator chain and the task-view call that invokes the new provider, plus the existing browser action concatenation. A declaration in an extension descriptor alone does not prove that a core task calls that extension. Checks match source spans; actual behavior still belongs to the same receiving operation.

~~~js
const integration = {
  schema: "upstate.operator-integration/v1",
  operation_id: originalOperationId,
  allowed_paths: ["operator/server.py", "operator/web/app.mjs"],
  edits: originalOrderedHooks,
  file_guards: {
    "operator/server.py": {
      before: {bytes: currentServerBytes, sha256: currentServerSha256},
      after: {bytes: composedServerBytes, sha256: composedServerSha256}
    },
    "operator/web/app.mjs": {
      before: {bytes: currentAppBytes, sha256: currentAppSha256},
      after: {bytes: composedAppBytes, sha256: composedAppSha256}
    }
  },
  checks: originalConsumerChecks
};
const joined = composeSourceJoins(currentLayer, integration);
const complete = composeApplication([currentLayer, joined.layer], {
  edition: "upper-savannah-current", operationId: originalOperationId
});
~~~

When first authoring a plan, file_guards may be omitted. The returned bank.composition.integration always contains measured full-file before/after guards. Review and retain that bound plan with its complete original and composed source. A receiving replay can pass it back to composeSourceJoins; it accepts only those original file identities or their exact completed postimages. Consumer checks still run against completed postimages. Before-phase checks apply to original preimages.

The implementation splices literal text, so dollar signs, replacement-string sequences and backticks are copied unchanged. Edit and check identifiers must be unique. Each ordered edit requires a unique match in the source produced by the preceding edit; later edits may intentionally change an earlier result. The composer evaluates independent affected files and reports all encountered conflicts without returning a partial output layer.

### Command and recovery carrier

~~~sh
node source_tools/application_join_cli.mjs current-complete-source.json \
  --join current-task-return-joins.json \
  --edition upper-savannah-current-task-return \
  --operation-id RUN-REVISION-TASK-RETURN-20261013 \
  --join-bank current-task-return-recovery.json \
  --source-map current-complete-with-task-return.json
~~~

The --join-bank output is an ordinary commons.source-bank/v1 containing every complete composed member with its actual predecessor hash. Its composition metadata retains every ordered plan, full input body, per-edit before/after identity and checked consumer span. Multiple join steps retain their order and must form a consecutive source history. Intermediate edits remain reproducible from the retained original bodies and literal plans. Packaging reopens both full input and output inventories, reruns each bound plan, and checks its complete receipt before emitting the carrier.

Receive that bank through the existing --overlay route against the matching complete application. Unmentioned source files remain present. Identical completed output can be reused. The carrier is also readable by readSourceLayer, and individual composition.steps retain their bound integration plans for a coordinator replay. Recovery does not fetch a stale whole host or replace a newer peer version implicitly.

A failure uses code SOURCE_JOIN_CONFLICT. The CLI prints conflict_report with schema upstate.source-join-conflicts/v1, the original operation ID, affected path/edit, expected and actual full identity or span counts. No output is published when a join or consumer check fails. Output names keep the existing exclusive/identical-reuse rules.

The task-return continuation uses this path on the actual current server and browser, preserving the five existing server decorators and original registered/native task controls. The same isolated persistence receiver invokes the real task_view method to check the provider links and retained task fields.

The shipped task-return example is [the bound plan](../integration/source_joins/run-revision-task-return-20261013.json) and its [complete recoverable source bank](../transfers/run-revision-task-return-20261013/source-composition.json). It is pinned to the original4215 source edition. Refresh the plan against any subsequently changed host; preserve concurrent changes explicitly.
