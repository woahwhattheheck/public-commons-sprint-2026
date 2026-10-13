# Receive the original source-water study

The application includes the complete original 217-HUC receiving command. It
creates or reuses the saved receptor network, prepares the four ARJWS and 32 PRWD
upstream polygon subsets, imports those original vectors into the scientific
Workspace, and retains both the graph product and a complete Workspace backup.
It also registers the unchanged full 217-HUC domain as its own native vector source,
with the complete original graph/profile/report files as companions.

Use the existing operation and the first equipped receiver that records an
admission in the project thread. Other sessions can receive its complete product
and Workspace. The source preparation uses the Python standard library on Linux;
the original regional native-model execution continues through its existing owner.

## Run on the existing equipped application

Use the actual interpreter, complete current application and owned operation
directory. The receiver checks the original ZIP and decoded source identity before
creating source-derived products.

```sh
"$PYTHON" -B "$APPLICATION/source_tools/receive_original_source_water.py" \
  --application "$APPLICATION" \
  --domain "$ORIGINAL_DOMAIN" \
  --operation-root "$EXISTING_OWNED_ROOT"
```

The default Workspace is
`$EXISTING_OWNED_ROOT/source-water-workspace`.
To receive into an existing scientific Workspace, also pass
`--workspace "$ACTUAL_WORKSPACE"`.
That Workspace is opened as an existing project; the argument does not silently
create a new project. Keep the receiving output directory outside that Workspace
so its complete backup does not collect earlier receipt archives.

The original source may be the complete retained ZIP, its
`model-domain.esri.json.gz` member, or its decoded JSON.
The actual original ZIP is 8,800,689 bytes, SHA256
`1fc35e5d0986e42d93922527d46e38bc5132653db75863934349dbbfaa352c04`.
Every accepted input must decode to SHA256
`2300d9b32a513d70503222a5d2e782e032107297214036a58e8b444a312169af`.
The application retains the exact original focus profile at
`source/receptor-topology/20261013/utility-focus-profile.json`
(SHA256 `93abaaf736c66a7ca971ca931da2a3d81d939ecdeb830c7892267153c4413da7`).

## Retained result and continuation

The receiver immediately writes and prints its actual host, interpreter,
application and source admission. Its outputs are under
`$EXISTING_OWNED_ROOT/source-water-receiving/`:

- `admission.json`: actual admitted runtime and original input.
- `network-result.json`: complete original graph result, including source binding.
- `original-domain-source.json`: the selectable original217 vector collection/source,
  original body and decoded hashes, and native HUC12 identifier field.
- `prepared-areas-result.json`: complete prepared areas and source collection.
- `receiving.json`: actual Workspace UUID, network and preparation IDs,
  product directory, original source binding, area counts and product ZIP identity.
- `workspace-backup.json`: exact backup path, byte length, SHA256 and native backup result.
- `completed-<attempt>.json`: the complete successful admission/result/archive record.
- `exception.json`: the first actual failure for repair, with full traceback.
  A successful full operation clears a stale exception.

Both complete ZIP filenames contain an immutable attempt suffix. A resumed
operation reuses the original retained graph and prepared area identities, and
creates a fresh complete backup without colliding with the native create-only
backup destination. The receiver's process lock prevents concurrent mutation of
its own admission and result files. Return the original output directory's JSON
records and both actual archives to the same project operation.

The graph stays under `Workspace/receptor-networks/<network-id>`.
The independent domain source is `original-model-domain`, titled
“Original model domain — complete 217 HUC12 watersheds”. Existing Station geography,
microbial studies and other native vector selectors can choose this collection.
The original body, source CRS, full profile, links, memberships and report companions
remain unchanged. Repeated receiving reuses the same retained source edition.

Prepared original areas stay under
`Workspace/receptor-scenario-areas/<prepared-id>` and their imported
source collection. Open the receiving Workspace's Source water desk to select
those saved areas, define explicit ordered land-cover alternatives, select retained
profiles and continue the existing native programme. Each profile retains its own
baseline and the original selected model scope.

The 217-HUC regional geometry is its own source edition. Preserve its identity
when receiving the separate county training input or the published Gura reference
study alongside it.
