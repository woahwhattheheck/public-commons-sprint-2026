# Continue a saved carbon receiving operation through the connected native host

This programme connects the existing authenticated HostedAppsClient, the complete
published native source, and the maintained carbon receiving command. It continues
the original operated output in a new private directory and saves the completed
application archive through the host's existing Library upload helpers.

The original receiving owner runs the programme in the same accepted operation.
The source and installed command remain explicit selections. The function does not
create a second execution queue or acquire credentials.

## Select the actual saved case

Use the restored original directory containing receiving.json and the complete
operated files. Select its actual retained source directory separately; a restored
archive may have different absolute paths from those recorded in the original
receipt. The native recovery controller verifies the original receipt and recorded
artifact identities, copies the whole output, and reopens its original stores.

The source manifest must declare:

~~~json
{"capabilities":{"resumeFrom":"preserved-output-v1"}}
~~~

Both the complete source manifest and complete installed-launcher carrier must be
provided with their published attachment IDs, original byte counts, and SHA256 or
Git blob digests. The programme reads all source parts from that manifest, including
the complete editable customer handover and source bootstrap. It uses the original
per-member identities and the installed source inspector to check the whole closure.

The original 151-file and 158-file source editions precede saved-output recovery.
Use the current capable edition for the continuation.

## Call the complete programme

Import continue-hosted.py from its actual saved path using Python's importlib. The
receiving session supplies its existing HostedAppsClient instance and the current
Notion connector ID. The existing owner also supplies the observed Node, Chromium,
Library helper directory, restored output, and restored source paths.

~~~python
import importlib.util

spec = importlib.util.spec_from_file_location("carbon_saved", PROGRAMME_PATH)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

result = module.continue_carbon_saved(
    client=existing_hosted_apps_client,
    notion_connector_id=existing_notion_connector_id,
    node=existing_node_executable,
    chromium=existing_chromium_executable,
    library_helpers=existing_library_helper_directory,
    preserved_output=actual_restored_operated_directory,
    preserved_source_root=actual_restored_original_source,
    manifest_attachment=published_native_manifest_identity,
    launcher_attachment=published_installed_launcher_identity,
    work_parent=actual_private_work_parent,
    programme_path=PROGRAMME_PATH,
    accounting_directory=actual_original_accounting_directory,
    original_recovery=original_saved_archive_identity,
)
~~~

Each published attachment identity has this shape:

~~~json
{
  "file_upload_id": "the actual published upload ID",
  "name": "the original complete attachment filename",
  "bytes": 12345,
  "sha256": "the exact published SHA256"
}
~~~

A gitBlobSha1 field can supply the original Git blob identity instead of, or in
addition to, sha256. The example byte count is a shape example; use the actual
published count. The final source and carrier identities travel in the original
private receiving handoff. The reusable repository source contains no private
Library file IDs or account credentials.

The function uses HostedAppsClient action names notion-download-attachment and
notion-get-file-download-urls where applicable to source receiving. The saved-case
programme only needs the former: it reuses the original SDK bundle already retained
in the prior source root.

## Original source and accounting selection

The default capture-options selection is the saved output's
givecredit-capture-options.json when present, otherwise the original source's
receiving/public-ledger-inputs/capture-options.json. Older native runs kept their
complete historical selection in the latter path. The programme copies the entire
selected file into the new source root, retaining its original byte count and
SHA256. It also retains the original receipt, old source manifest and available
historical selection reports.

Use capture_options for an explicit existing complete selection. A saved checkpoint
must belong to that same query. The native collector owns the query comparison and
retains original raw responses, network, accounts, contract and date bounds.

By default the native caller reuses the checkpoint copied with the original output.
The programme records its actual size and streamed SHA256 without parsing the full
checkpoint in Python. capture_checkpoint selects an explicit matching checkpoint;
an explicit parse failure is returned with its exact source file preserved. The
current native recovery controller retains an unreadable automatically selected
checkpoint before reacquiring from the original whole sources.

The default SDK bundle is the original source's
receiving/stellar-sdk-16.3.1/stellar-sdk-16.3.1.cjs. Use bundle_path for a relocated
copy of those same published bytes. The programme verifies the original 487,628-byte
SDK16.3.1 bundle and its published integrity, then uses the maintained preparer to
create a new donor with original metadata, distribution metadata and license in
the new source root. The complete donor joins the final archive.

The completed accounting stage is reused. If accounting_directory is omitted, the
programme reads that stage's original directory. Supply the actual restored or
maintained directory when its path has changed. The original workspace and source
binding are passed to the native caller. A completed accounting draft receives no
new accounting-config and is reopened through its original native controller.

## Native lifecycle and retained results

The programme creates one new private parent outside the preserved source/output.
It receives the current source and the complete installed launcher, copies its own
whole source beneath receiving/, prepares the retained SDK, and invokes:

~~~text
node INSTALLED_LAUNCHER_CLI run
  --source-root CURRENT_COMPLETE_SOURCE
  --resume-from ORIGINAL_SAVED_OUTPUT
  --output NEW_OPERATED_OUTPUT
  --capture-options RETAINED_ORIGINAL_CAPTURE_OPTIONS
  --sdk-module CURRENT_RETAINED_SDK
  --chromium EXISTING_CHROMIUM
  --archive-path NEW_SIBLING_ARCHIVE
~~~

The installed launcher checks the source capability and observed original process
identity before starting. The native caller reuses completed original stages and
continues GiveCredit capture, customer/source/statement work, browser forms and
downloads, independent receiving, and cold reopening. It closes the native stores
and browser before streaming the whole application source and operated output into
the complete archive.

The host's existing NODE_OPTIONS are inherited. node_options can explicitly select
the host's intended runtime options. No replacement heap size is imposed. The
transport and native caller retain observed memory counters and process identities.
The full native stage logs remain in the private parent and the saved transport
archive. The optional timeout_seconds sends SIGTERM to the installed CLI, which
forwards it to the owned native process group; the transport waits for actual exit
and retains the resulting state.

After the run, the installed verify command streams the whole archive SHA256 and
joins it to its descriptor and immutable receiving snapshot. The existing Library
helpers save the complete native archive, its descriptor, and the small transport
archive containing full logs and the original invocation. An interrupted native
run instead saves the complete new source, operated state, source downloads, logs,
invocation and any already-created native archive in a recovery capsule. Earlier
saved output remains intact.

The returned result includes actual saved file identities, archive byte counts,
streamed digests, stage exits and the operated/source paths. Return those actual
results into the original receiving thread so the same source owners can finish any
concrete runtime repair and deliver the completed customer work.
