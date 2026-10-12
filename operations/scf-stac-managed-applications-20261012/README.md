# STAC managed Applications: complete retained-data receiving

This operation builds the selected original Starforge distribution, creates a genuine READY installation through the maintained installer, and completes the existing STAC managed Applications receiving journey. The input is a closed imagery workspace and, optionally, its closed processing workspace.

The source edition is fixed at **7169c10e37a1800d22133efaf37cfaac5d96e343**, tree **eda6ec9050eeedb4bd401c66b7bfba0b604a8fca**. The source selection includes the merged managed STAC provider, its original CLI/server, the saved-connection client, and the complete imagery/processing receiver.

## Contents

| File | Purpose |
| --- | --- |
| continue-stac-applications.mjs | One continuation using the maintained distribution builder, runtime installer, Applications manager, and original receiver. |
| input.local.example.json | Existing shared-host input, including the retained original READY predecessor and its exact recorded files. |
| input.remote.example.json | Explicit new lightweight installation for a responding existing worker that has no local predecessor. |
| source-selection.json | Exact repository, commit/tree, builder/receiver blobs, installer pins, and original source archive donor identity. |
| source-7169.json | Complete signed commit/tree receiving input for the maintained Git object receiver, with 3,964 initial source paths. |

The source metadata is the exact 1,656,014-byte Git blob **56da861934c0a161c8ab76b64a17c2a9b421d557**. It retains the complete 8,039-entry tree and the original signed commit text. The maintained builder selects the final distribution from the original declarations and resolves its static module closure.

## The actual operation

The continuation calls these original APIs in order:

1. **buildDistribution** reads the fixed Git snapshot, composes its source-owned contributions, materializes the complete source package, and packs the original distribution archive.
2. **prepareRuntimeInstall/installRuntime** create an explicitly selected new installation, or **upgradeRuntime/installRuntime/recoverRuntime** preserve the selected predecessor profile and continue an interrupted original preparation.
3. **inspectRuntimeInstall** requires actual READY state, matching installed source, original profile, dependency inspection, and the original operator host requirements.
4. The installed **runManagedStacReceiving** creates a private receiving copy of the original closed data, reviews/saves/connects the application, starts its original host, authenticates its original session, reads scenes/assets/processing, and exports complete native handovers.
5. The same receiver drains Stop, reopens the same saved application, checks its changed connection against the same workspace identity, uses the original client across restart, receives imagery and processing independently, checks retained outputs, and performs final Stop.

The runtime profile field **native** selects optional SDK dependencies. The retained imagery/processing browser host and original client use the explicitly selected Node/operator profile. The remote example therefore selects:

~~~json
{
  "native": false,
  "features": [],
  "operator": true,
  "pins": {}
}
~~~

The installed profile and original readiness APIs determine whether the selected host can operate that installation. The source requires Node >=22.16, Python >=3.11 for operator work, Linux, and the original flock-based leases. Use the existing equipped runtime that satisfies these requirements.

## Select the existing execution owner

Use the existing accepted native/equipment operation and its artifact collector. The operation identity is:

**SCF-STAC-MANAGED-APPLICATION-RECEIVING-B710-20261012**

The source build and receiving application must share a responding process lifetime. On an existing worker, use its maintained foreground/retention route and keep the selected project, runtime, Git cache, private data, and receiving directory attached to that same operation. The existing native launcher owns admission and process lifetime.

The local example names the observed shared-host paths. Read its retained predecessor plan/profile/state before using it: the three example hashes belong to that exact original eea35 installation. Set different local paths only after selecting that actual installation and measuring its original files.

The remote example deliberately sets previousRuntime to null and supplies the explicit profile above. Set its absolute paths to the selected existing worker. A missing local predecessor is handled by this original new-installation mode.

## Obtain the original source

There are two ordinary source routes. Both finish with the same fixed Git snapshot in the selected owned source cache.

### Existing complete Git cache

Use a new operation-owned cache or an already selected complete cache containing the fixed commit. The original Git source reader supports a configured promisor remote and fetches exact missing objects from the immutable tree when sourceOffline is false.

For a new owned cache on a responding worker:

~~~sh
umask 077
STAC_OPERATION_ROOT=/root/stac-managed-applications-7169
mkdir -p "$STAC_OPERATION_ROOT/source"

git init --bare "$STAC_OPERATION_ROOT/source/repository.git"
git -C "$STAC_OPERATION_ROOT/source/repository.git" remote add origin \
  https://github.com/woahwhattheheck/public-commons-sprint-2026.git
git -C "$STAC_OPERATION_ROOT/source/repository.git" config remote.origin.promisor true
git -C "$STAC_OPERATION_ROOT/source/repository.git" config remote.origin.partialclonefilter blob:none
git -C "$STAC_OPERATION_ROOT/source/repository.git" fetch \
  --no-tags --depth=1 --filter=blob:none origin \
  7169c10e37a1800d22133efaf37cfaac5d96e343
~~~

Run the initialization commands once for that owned cache. Continue an existing cache with its same original source and remote. The maintained builder uses Git with support for the global --no-lazy-fetch option; select the existing equipped Git binary accordingly.

Materialize the eight exact builder/receiver source files from that commit. This short preparation reads the public selector and Git objects; it verifies each original blob and preserves an already materialized identical file.

~~~sh
python3 - /absolute/operation-code/source-selection.json \
  "$STAC_OPERATION_ROOT/source/repository.git" \
  "$STAC_OPERATION_ROOT/builder" <<'PY'
from pathlib import Path
import hashlib, json, os, subprocess, sys

selection = json.loads(Path(sys.argv[1]).read_text())
repository = Path(sys.argv[2]).resolve()
target = Path(sys.argv[3]).resolve()
target.mkdir(mode=0o700, parents=True, exist_ok=True)
items = selection["builderFiles"]
oids = "\n".join(dict.fromkeys(item["blob"] for item in items)) + "\n"
subprocess.run(
    ["git", "-C", str(repository), "fetch", "--no-tags", "--no-write-fetch-head",
     "--no-auto-maintenance", "--filter=blob:none", "--stdin", "--", "origin"],
    input=oids.encode(), check=True
)
for item in items:
    data = subprocess.check_output(
        ["git", "--no-lazy-fetch", "-C", str(repository), "cat-file", "blob", item["blob"]]
    )
    actual = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
    if actual != item["blob"] or len(data) != item["bytes"]:
        raise ValueError("Original builder source changed: " + item["name"])
    destination = target / item["name"]
    if destination.exists():
        if destination.read_bytes() != data:
            raise ValueError("Preserve the different existing file: " + str(destination))
    else:
        with destination.open("xb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        destination.chmod(0o755 if item["mode"] == "100755" else 0o644)
print(json.dumps({"sourceCommit": selection["sourceCommit"], "builderFiles": len(items)}))
PY
~~~

A cache with every needed source object can materialize the same listed blobs with its existing offline receiver. Set sourceOffline to true after original source receiving is complete. The new remote example uses sourceOffline:false so the maintained reader can fill its exact missing Git objects through the configured original remote.

### Retained source archive / partial cache

The original **git-object-receiving.py** at blob **9b94c60e2996dce7e8ec6c9db99983dd08a908aa** accepts this committed source-7169.json metadata, existing Git/source donors, exact original archive donors, and received original blob files. It reconstructs and verifies the selected original Git objects.

For an existing shared-host donor:

~~~sh
python3 /absolute/builder/git-object-receiving.py \
  --metadata /absolute/operation-code/source-7169.json \
  --commit 7169c10e37a1800d22133efaf37cfaac5d96e343 \
  --directory /absolute/new-source-cache \
  --donor-repository /absolute/existing-source-cache/repository.git \
  --donor-archive \
  d953328850112533ada23b7a9b4b92a22178c902d635c3c999894ae9d4dc1edb \
  /absolute/source-db3d9cb3d64f.tgz
~~~

The declared original archive is **13,032,106 bytes**, source **db3d9cb3d64f2aee6c1e968606bf21eb0e6ef00e**. Its exact SHA256 is in source-selection.json. The maintained receiver reads donors, verifies every adopted Git object, and preserves its operation-owned receiving cache.

SOURCE_NEEDED retains the actual missing-object list. Receive those original objects in the same cache, then continue. A builder failure also retains its original missingObjects in continuation-error.json. The exact current Git tree and full source metadata make this continuation recoverable independently of the originating chat.

## Select the private receiving data

Set sourceWorkspace to the original **closed STAC workspace**, and sourceProcessingWorkspace to its associated **closed processing workspace**, or null for imagery-only receiving. A completed customer delivery manifest and a native source workspace are different original inputs; this receiver opens the native workspaces through their existing APIs.

Use the original owner's retained directories on the same host. On another approved receiving host, receive the original complete handovers through the existing imagery/processing importers and supply the resulting closed native directories. Preserve their source identities and original decisions. The receiver derives and records its baseline from the actual selected data.

The input examples contain paths and runtime/source configuration. Provider bodies, acquired images, staff decisions, notes, credentials, and full receiving journals remain in their original private input/output custody.

For the retained original case, the available complete receiving sources contain 15 scenes, one 29,731-byte JPEG, three imagery decisions, four Cirrus run records, and 12 native workflows. These are the earlier operated inputs; the new managed-application run records its own actual lifecycle outcome.

## Prepare the operation input and run

Copy the appropriate example to an operation-owned private JSON file. Set its absolute paths once before starting. Keep the source commit/tree and expected installed source blobs as selected. The original predecessor files remain the inputs only in local upgrade mode.

~~~sh
umask 077
cp /absolute/operation-code/input.remote.example.json /absolute/private-input.json
chmod 600 /absolute/private-input.json
~~~

The source-selection builder entries are already embedded in both examples. The installer loads directly from the **original build's release/package/source tree**. The runtime profile is resolved and installed through that source's maintained installer.

Run this complete command through the selected existing native foreground/equipment operation:

~~~sh
node /absolute/operation-code/continue-stac-applications.mjs \
  /absolute/private-input.json
~~~

The operation writes stage records for INPUTS, SOURCE, RUNTIME, and APPLICATIONS. Actual READY output contains runtimeDirectory and directory, sourceCommit, sourceManifestSha256, installationId, profileId, sourceRoot, sourceRepository, and the operation ID. The receiver writes its own saved request/run identities before application mutations.

The original receiver lives in the packaged source at:

**stellar/scf-starforge-20261009/sf30-seller-sdk/stac/examples/managed-applications-receiving.mjs**

Its fixed source blob is **47a11b1970e2d80ce75524f89c0f821dfe177d6e**. The continuation also reads/imports the final original STAC provider **b1c18f04257e36745a56c9c55c68dab9a1d90460** and common provider source **ead95675dcedd110588c707f76286ab4f5a7a4c7** from the installed runtime.

## Continue the same operation

Run the same input with the same project, runtime, Git cache, and receiving directories. The immutable input/selection files reject a changed intent.

The original builder resumes its retained output and reuses a completed distribution archive. The original installer resumes an existing installation, or uses its retained preparation to recover into the named sibling directory ending in -recovered. The existing receiver resumes recorded Applications requests; an interrupted accepted run uses the original Applications recovery, and a finished run uses an intentional new Start.

Read continuation-error.json for the actual failed stage and original error code. Its source missing-object list, runtime preparation, native job record, application operation IDs, and original receiver journal are the continuation inputs. Preserve them with the same owner and foreground operation.

If the runtime is located in an executor-private namespace, retain the original source archive, plans, source receipt, and complete receiving output through that executor's original artifact collector before releasing it. A subsequent host prepares or recovers a genuine runtime through the original installer and the retained archive; the source/profile identities identify that actual installation.

## Complete outputs

| Output under projectDirectory | Meaning |
| --- | --- |
| source-release.json | Original distribution receipt and archive/source identity. |
| runtime-ready.json | Actual original READY inspection plus source manifest hash and operation identity. |
| apps-input.json | Exact private original receiver input. |
| apps-receiving/receiving-journal.json | Saved review/request/run identities and completed receiving steps. |
| apps-receiving/exports/ | Complete native imagery handover and original processing gzip export. |
| apps-receiving/receiving/ | Independent reopened native imagery and processing receiving directories. |
| apps-receiving/managed-applications-result.json | The actual complete managed receiving result. |
| continuation.json | Joined complete original distribution, READY runtime, and receiving outcome. |
| continuation-error.json | Original failed stage/code and exact missing source objects when provided. |
| delivery/ | Source archive, distribution, runtime records, operation records, and full receiver output retained on either outcome. |

The application and its stable connection are private. The receiver checks the original connection file after each accepted startup, keeps the same workspace identity through restart, and uses the same installed client object across the change of session. Final completion includes drained Stop and the actual independent receiving results.

The source package is fully committed here. The current equipped execution owner publishes the resulting complete native record and reusable READY tuple into the existing STAC/cumulative receiving thread, then preserves the full private outputs through their original artifact destination.

## Original implementation references

- [Fixed source edition](https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/7169c10e37a1800d22133efaf37cfaac5d96e343)
- [Distribution builder](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/7169c10e37a1800d22133efaf37cfaac5d96e343/stellar/scf-starforge-20261009/distribution/build.mjs)
- [Runtime installer](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/7169c10e37a1800d22133efaf37cfaac5d96e343/stellar/scf-starforge-20261009/distribution/runtime-install.mjs)
- [Original managed receiving](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/7169c10e37a1800d22133efaf37cfaac5d96e343/stellar/scf-starforge-20261009/sf30-seller-sdk/stac/examples/managed-applications-receiving.mjs)
- [Original receiving/data ownership thread](https://tokenjunkielabs.slack.com/archives/C0BTB4SUCP9/p1791761556094779)

## Original shared-host foreground continuation

The `native/` directory carries the complete original shared-host invocation used for this operation. It composes the maintained **9b94c60e** Git object receiver, the direct continuation above, and the existing complete **903bec05** native foreground runtime.

The selected native runtime is:

`/workspace/scratch/dbc61db6310c/native-runtime-maintained-903bec05/host`

Its published complete native identity is **dbf3605fdd032a53d3b96c411e9ad72fac0df9136bafa61080b4f112f16061ff**. The launcher verifies the original COMPLETE_RUNTIME.json and every declared native member before importing ForegroundLaunch. Its source is the existing original host; the operation uses that host's capacity admission, runtime declarations, liveness, foreground handoff, and artifact collector.

### Materialize the fixed source inputs

Use the already selected original operation base:

`/workspace/scratch/b71092915960/stac-managed-applications-native`

Place the six operation files from this directory under its `operation-code/` child. Place native/launch-native.py and native/receive-and-continue.py directly under the operation base. Receive the unchanged eight builder files into the builderDirectory selected by the input, using the original source-selection.json entries.

Copy native/input.shared.example.json to the base as **native-input.json**, with mode 0600 and a private owned parent. Its source, predecessor, profile receipts, and retained imagery/processing inputs are the same original case. Its build, Git cache, npm cache, and new runtime are under **/dev/b710-stac-applications-7169** for the lifetime of this one native invocation.

The native/pinned-inputs.json file lists the exact 16 original source blobs already selected for this continuation. Receive available original bodies as **BASE/incoming/GIT_BLOB.blob**. The original receiver verifies each body as its original Git object. These input bodies can come from the retained source Git cache or the existing GitHub source connector. The 16-file list includes the final eight managed STAC source files and the unchanged eight builder/receiver files. The complete fixed source-7169.json remains the tree and commit authority.

The source caller also reuses these original read-only donors when present:

- 99D0's scf-applications/source.git and scf-applications/source.
- 7108's original source-10f5/cache/repository.git.
- The original runtime-c287/source directory retained by 84EB.

It receives them into this operation's own cache through git-object-receiving.py. It first receives the metadata's original required paths. If the maintained builder subsequently reports additional missing Git object IDs, the caller maps only those IDs to their original paths in the retained complete tree and asks the same receiver for that additional closure. A missing body remains in the original receiver's **missing-objects.json**.

### Run in the original foreground

For the first accepted dispatch:

~~~sh
python3 -B /workspace/scratch/b71092915960/stac-managed-applications-native/launch-native.py
~~~

The launcher selects this same stable operation:

**SCF-STAC-MANAGED-APPLICATION-RECEIVING-B710-20261012**

It declares 512 MiB for process memory, 128 MiB memory reserve, 512 MiB growth in the private project, and 48 MiB growth for the shared retained records, with the original 8 MiB disk reserve. These are the selected resource declarations, not a measured native peak. The original native admission includes memory-backed placement and peer reservations. It retains delivery on both successful and failed outcomes.

The canonical record directory is **BASE/native-records/**. If that same original record is awaiting capacity or requires its ordinary foreground capacity continuation, use:

~~~sh
python3 -B /workspace/scratch/b71092915960/stac-managed-applications-native/launch-native.py --resume
~~~

This calls the existing resume_foreground(..., action='resume-capacity') operation. Preserve the original record and use its maintained recovery contract for a completed failed child. The source caller's original source-cache state, metadata identity, missing objects, and retained output identify what to receive before that recovery.

The full command runs original source receiving, the direct build/install continuation, and the unchanged managed Applications receiving driver in one foreground. A successful result is the same **continuation.json** described above. Native queue/admission output alone does not supply that completion result.

### Retained source and receiving output

On a source intake failure, delivery includes the original **source-receiving.json**, **missing-objects.json**, and the partially received original **source-cache/**. It also includes the exact native input, both callers, and native-continuation-exit.json. The existing native collector preserves that selected directory.

After packaging, the direct continuation retains the original source archive and distribution receipt, actual runtime records, and complete original Applications receiving output. The original closed input workspaces and predecessor runtime remain the read-only sources for this operation. Source/profile identity and the complete private receiving data travel through their existing retained destinations.

The operation's public source and these complete native callers are delivered independently of the execution carrier. The fixed 7169 native receiving result is supplied by the accepted original foreground when its complete source, runtime, and Applications steps finish.
