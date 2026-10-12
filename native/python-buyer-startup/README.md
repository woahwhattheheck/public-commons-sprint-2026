# Original Python buyer startup operation

Operation: `SF88-PYTHON-STARTUP-4BF5-20261012`.

This is the portable runtime companion to [PR2075](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/2075). Its source manifest fixes the complete original 66-file Python SDK at `728b14bd0bfbacee5578ad91ed02dfca2f2411c5` and its unchanged predecessor entry module at `01c0c20c9861c4eb41867214935c4e9f1e9493ba`. The Study product build remains pinned to `1ac741d4cf884457d2bf4889c719964dc023c3f0`; this companion is a separate successor check.

## Run on the already selected host

Use Python 3.10 or newer and the existing complete original source checkout. No package installation is required for the original public facade.

```sh
python3 ORIGINAL_HANDOFF/native/python-buyer-startup/verify.py \
  --source ORIGINAL_SOURCE_CHECKOUT \
  --out OWNED_PERSISTENT_PARENT/python-buyer-startup
```

The source checkout must contain the exact members from adjacent `source.json`. A donor with other versions is rejected before imports. The command copies these small source files into its own operation directory, constructs the predecessor using its exact original entry-module bytes, and executes each variant in a fresh Python process. It preserves the original module implementations and performs no payment, merchant, database-server or model operation.

The connected runtime check imports the original storage module, captures actual startup wall time, CPU time, peak resident memory and loaded SDK module names, then resolves all 52 public objects. It checks their direct-module and pickle identities, export order, `dir()`, explicit star imports and facade reload. Each variant saves and reopens a record through the original SDK storage API. The fixed read call supplies the actual API's required byte limit.

Each reported startup measurement is one observed run on the receiving host. Keep its runtime and module inventory with the values when comparing them.

## Return the complete result

Retain the entire operation directory until receiving is complete. Return `native-result.json`, both original stdout/stderr files, and the retained source manifest through the same selected worker's durable artifact route. The result must have `state: COMPLETE`, the exact operation and source commit, 66 verified source members, and 52 original public objects in each phase.

A completed same-source result is read back without rerunning imports. A failed result remains available with its exact error and original output for a source-owner correction. Keep the product PR at its current state until this original runtime result is returned.

The execution companion and its complete source manifest travel together on this source branch.
