# Groundwater workspace for Tethys

This is the Tethys 4.6.1 adapter for the original `starforge-groundwater-workspace` 1.0.0 product. It uses the portal's active account, application permissions, CSRF and current private Paths. The original core retains the database, scientific editions, native worker, operation IDs, report delivery and backup/restore.

Read the complete [installation and receiving guide](../TETHYS.md) before installation.

## Install in the existing portal environment

```sh
cd /absolute/reviewed/groundwater
python -m pip install --no-deps .
cd tethys_app
tethys install --without-dependencies
tethys manage collectall
```

Use Python 3.11 or later in the existing Tethys 4.6.1 deployment. Preserve its original multi-app/standalone configuration and restart its actual service through that deployment. No native solver, extra queue, portal account or credential is installed by this adapter.

Set the app's `portal_configuration` JSON to select `user` or `app` private scope, a default named slot and bounded request size. Assign the original app permissions through Tethys. Shared scope also requires `use_shared_workspace`.

## Inspect and receive

```sh
python -m tethysapp.groundwater_workshare.manage \
  --user EXISTING_ACCOUNT --slot workspace check

python -m tethysapp.groundwater_workshare.manage \
  --user EXISTING_ACCOUNT --slot received-project prepare-slot
```

The second command returns an absent `restore_destination`. Restore the original complete backup there with `starforge-groundwater restore`, keep its exact result and open that slot from the portal launcher. Its working database is `destination/workspace/groundwater.sqlite`; incoming package bytes remain separately retained under `destination/received`.

For a genuinely new workspace, use the launcher's CSRF-protected **Create workspace** form. Interrupted creation retains one intent and fixed original identity; **Continue original creation** finishes that same work. Existing URLs use the strict existing-only core constructor, and never initialize a replacement for a missing or damaged database.

Bound routes include the current principal/private-path binding, slot and actual workspace UUID. The shared operator UI binds saved requests to that exact API address. Verified source/report/run/backup downloads retain the core's exact bytes and SHA-256.

The [pinned source contract](tethysapp/groundwater_workshare/resources/SOURCE_CONTRACT.json) identifies original Tethys APIs. Private workspace data is never placed in public media, and received archive code is never imported into the running portal. Native installation, source runs and customer acceptance must be established by their actual original results.

## Original portal receiving programme

Use `python -m tethysapp.groundwater_workshare.receiving --input ABSOLUTE_JSON` in the configured portal environment to receive the actual completed backup, verify its original source/run/report/operation identities, receive selected frozen report packages and emit the bound portal handoff. The [input schema](tethysapp/groundwater_workshare/resources/RECEIVING_INPUT.schema.json) requires actual retained identities; it supplies no fabricated result values. Repeat the exact request after interruption. No solver, account or portal session is created.
