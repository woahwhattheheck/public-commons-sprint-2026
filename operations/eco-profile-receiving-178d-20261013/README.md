# Ecosystem profile receiving on an existing Python worker

This operation carries the exact public application dependencies for the maintained five-profile materialization and source-report check. It removes the need to clone the whole repository or install GIS packages before this specific receiving operation can run.

## Run the existing operation

Save `receive_profiles.py` from this directory and use the worker's existing Python 3.10+ executable:

```sh
python -B receive_profiles.py --operation /owned/eco-profile-receiving
```

Replace `/owned/eco-profile-receiving` with an owned writable persistent path. Operation ID remains `ES-20261012-RECOVERY-SCIENCE-2329`. This foreground invocation is the source-only continuation sent to the existing WORK_SCANNER worker on host `609f373a480f`.

The receiver writes the exact application files, verifies their retained SHA-256 and Git blob identities, and executes the unchanged maintained check from its own application directory. The same Workspace is reopened on a repeated invocation, so the maintained model code determines the stable profile identities. Existing source files must match the retained edition.

The complete receiver is 196,354 UTF-8 bytes with SHA-256 `126f37b690b876673500f2504051b28bea76ae896893fcfa49cde94099302f8a`. Its embedded source bank contains 32 files, including the unchanged 9,943-byte check with SHA-256 `1641007b000b634044bfb5de1afe032cf06772b7bdb93c16168e35e03a1914b1`.

## Retained output

The operation directory contains:

- `source-receiving.json`: complete original source identities and application path.
- `operation.json`: actual host, Python executable, process ID, source pin, Workspace path, execution state, and result identity.
- `native.log`: foreground output from the maintained profile/report check.
- `study-profile-materialization-check.json`: actual profile IDs, all fifteen coefficient rows, source table identities, stable repeated materialization, coefficient changes, native settings, and report/source checks.
- `workspace/`: the ordinary retained model Workspace.

Send the actual result JSON and exit status back to the existing receiving thread. The generated JSON records profile materialization and report behavior; it does not contain native NDR/SDR case outputs. The original GIS receiving and regional programme remain separate maintained application operations.

An existing scientific Workspace can be used explicitly:

```sh
python -B receive_profiles.py --operation /owned/eco-profile-receiving \
  --workspace /existing/regional-workspace --profile-id ACTUAL_BASELINE_PROFILE_ID
```

`--receive-only` verifies and materializes the complete source without invoking the check.

## Exact public sources

The 31 original repository files come from application commit [aadd25656ff0328759bdfff6705bc397e32d0bc8](https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/aadd25656ff0328759bdfff6705bc397e32d0bc8/opportunities/upstate_forever_2026). They include complete unmodified Workspace/profile/report modules and original Georgia, Duke Forest, Albright/Vickery, and Upper Flint coefficient data. The additional receiving file is the exact maintained invocation already delivered to the existing worker.

The source closure was reconciled against the original public Git objects. All 31 original Git blob hashes, all 32 member SHA-256 values, original manifest references, and the compressed source-bank round trip were checked before publication. The 14 original Python module bodies remain unmodified; imports used by the profile-only path require the Python standard library. The receiver records the actual native outcome when the worker executes it.

The complete durable source and per-file inventory are also available in the [existing receiving source page](https://chatgpt.com/space/page_bfd6ca0b598c8191a7715fb7515e23a5).
