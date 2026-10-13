# Original workspace integration

## Mount without touching existing routes

`install_intelligence(app, repository=..., state_path=..., tenant_resolver=..., gateway=...)` adds `/intelligence`, `/intelligence-assets/*` and `/api/intelligence/*`. It leaves the original routes and static assets unchanged. Repeated mounting on the same application returns the existing engine.

Pass the original authenticated tenant resolver to `tenant_resolver(request)`. It may be synchronous or asynchronous. A tenant identifier by itself is not authentication. The fallback `tenant_id` query convention exists for the earlier local workbench and defaults to `demo`; it is not a substitute for the protected host's authorization rules. Use the same original user/tenant access controls for this route group as for native datasets and jobs.

## Store-backed adapter

Construct `StoreBackedRepository(records, artifacts, tenant_root)` with three existing-store read functions. No second job writer or data ingest pipeline is created.

`records(tenant, kind)` returns the current records of kind `dataset`, `job`, `ensemble`, or `aoi`. Every record must have an unambiguous string `id` and exact `tenant_id`. Dataset records also provide their registered `path`. Preserve original model family, status, source-input digests, parameters, temporal/spatial support, requirement states and evidence type in the `metadata` mapping. Keep the original manifest intact there when available. The adapter accepts other original fields without dropping them from retained records, except secret/path fields scrubbed from user-facing output.

`artifacts(tenant, job_id)` returns only the original job's registered artifacts, as `{member, path, metadata?, sha256?}`. Use the existing artifact slug as `member`, retaining its original association. `tenant_root(tenant)` supplies a server-owned filesystem root. Resolved paths and symlinks cannot escape it. If the original native registry carries a main-file SHA-256, supply `sha256`; it is checked before analysis. Analysis additionally pins main-file and relevant companion-file hashes.

```python
from eco_intelligence import install_intelligence
from eco_intelligence.adapters import StoreBackedRepository, CallbackGateway

# Each argument below is a function supplied by the original workspace module.
# No names or schemas of unexamined upstream Python internals are assumed.
def mount(app, *, records, artifacts, tenant_root, authenticated_tenant,
          native_submit, native_lookup, native_methods, investigation_db):
    return install_intelligence(
        app,
        repository=StoreBackedRepository(records, artifacts, tenant_root),
        state_path=investigation_db,
        tenant_resolver=authenticated_tenant,
        gateway=CallbackGateway(native_submit, native_lookup, native_methods),
    )
```

`native_methods` maps the connected action kinds (`run_job`, `ensemble`, `calibration`) to accurate descriptions of their original native methods. The browser advertises only those actions plus local collection analysis. Descriptions are part of the prepared context and must distinguish parameter fitting from output correction.

## Current HTTP job launcher

The supplied workspace contract uses `POST /api/workspaces/{tenant_id}/jobs/launch`, unlike the earlier `/api/jobs/{id}/run` shape. `WorkspaceGateway` supports that current route directly:

```python
from eco_intelligence.adapters import WorkspaceGateway

gateway = WorkspaceGateway(
    app=original_app,
    build_request=original_validated_job_request_builder,
    lookup=original_lookup_by_intelligence_plan_id,
    methods=native_method_descriptions,
    auth_headers=original_internal_auth_headers,  # optional host-controlled callback
)
```

These function names are illustrative variables passed from the original module, not claimed upstream imports. Their exact callable contract is below. Native request shapes differ across the concurrently delivered workspace editions; the gateway intentionally calls the original validated builder instead of guessing fields or copying an obsolete schema.

Both a native submit callback and an HTTP `build_request` receive:

```text
tenant, action: Action, plan_id: str, paired_payload_or_none: dict|None, context: dict
```

A submit callback returns the original structured receipt. An HTTP builder returns the original validated JSON request body. For calibration, `paired_payload` contains every paired observation/prediction, timestamp field, chronological holdout fraction and source-derived series keys. `context` contains complete pairing coverage or the selected original job and ensemble population.

Persist `plan_id` in the original store's supported correlation/idempotency field before launching work. The gateway also sends `X-Eco-Intelligence-Plan-ID` as a correlation header; that header alone does **not** make an original endpoint idempotent. The lookup callable receives `(tenant, plan_id, action, stored_plan)` and returns the matching original receipt or `None`. It must match the persisted plan identity rather than guessing from similar parameters. If a response is lost, `/reconcile` reads this original receipt; it never retries an uncertain model launch.

The adapter retains a `native_job_submission` receipt on successful admission. That is not the model's terminal result. The original workspace's job status and artifact surfaces remain authoritative for completion and diagnostics.

## Host-produced catalog projection

For a portable read-through integration or offline analysis of retained original outputs, `CatalogRepository(catalog_path, allowed_root)` reads this exact new interchange format:

```json
{
  "format": "eco-intelligence-catalog-v1",
  "tenants": {
    "demo": {
      "root": "demo",
      "datasets": [
        {
          "id": "original-dataset-id",
          "tenant_id": "demo",
          "label": "Registered observations",
          "path": "inputs/observations.csv",
          "metadata": {"unit": "original declared unit", "evidence_type": "original source classification"}
        }
      ],
      "jobs": [
        {
          "id": "original-run-id",
          "tenant_id": "demo",
          "model": "sdr",
          "status": "complete",
          "metadata": {"native_manifest": {}},
          "artifacts": [{"member": "sed-export", "path": "runs/original-run-id/sed_export.tif"}]
        }
      ],
      "aois": [],
      "ensembles": []
    }
  }
}
```

This is a schema example, not real registered project data. Relative tenant roots resolve below `allowed_root`; file paths resolve below their tenant root. The browser cannot change catalog paths. The host may atomically replace this projection as its original state changes. It remains a read-only view, not an alternative job authority. The original `/state` and `/runs/{run_id}/artifacts` read surfaces can supply these records using their own actual response schema.

Catalog launcher mode installs an additive `intelligence_app.py` that reads `ECO_INTELLIGENCE_CATALOG`, `ECO_DATA_ROOT` and `ECO_INTELLIGENCE_STATE`. It does not require the older `settings.py`. For a protected or native-executing deployment, mount with the original resolver and gateway rather than relying on that local catalog convenience launcher.

## Recovery and operation semantics

Each source-bound action has one retained plan ID. SQLite atomically changes a ready plan to executing. Completed plans reopen their retained result. A native call with an uncertain outcome remains available for original-store reconciliation instead of resubmitting. Main-file hashes, companion masks/metadata and native-record hashes are rechecked before execution; changed inputs require a freshly prepared action.

Collection profiling records per-file outcomes, including unsupported-format errors, without discarding successful analyses. Questions retain tool outcomes and source IDs even when a provider times out. Reusing a completed request ID returns its retained answer; a previously interrupted request is visible in its events and a deliberate new attempt uses a new ID. These controls prevent duplicate execution, not additional approval gates.

For long-running deployments, use the original app's process supervisor and filesystem persistence. The extension does not provision compute, alter model queues, or create scheduled jobs.
