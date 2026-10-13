"""Connect retained scientific diagnostics to INTEL13's repository callbacks.

Authored by TokenJunkieLabs for the Ecosystem Sciences watershed application.

The original Operator resolves workspace keys.  Diagnostic inspect verifies the
committed report; INTEL13 verifies each requested export against its registered
SHA-256 before reading.  Original model and action services remain the authorities.
"""
from __future__ import annotations

import copy
import re
import threading
from pathlib import Path

from model import experiment_diagnostics as diagnostics
from model.common import read_json, verify_file

_ID = re.compile(r"^[0-9a-f]{64}$")
_READABLE = frozenset((
    ".json", ".csv", ".tsv", ".jsonl", ".ndjson", ".tif", ".tiff",
    ".geojson", ".gpkg", ".shp",
))
_NAMES = {
    "report_json": "Complete scientific interpretation",
    "manifest": "Original diagnostic selection and source manifest",
    "run_matrix_csv": "Declared native run matrix",
    "metric_values_csv": "Native and shared-footprint export totals",
    "scenario_summaries_csv": "Scenario effects and sampled parameter ranges",
    "parameter_effects_csv": "Parameter effects and interactions",
    "rank_stability_csv": "Scenario ranking across parameter profiles",
    "observation_rows_csv": "Original matched observation rows",
    "observation_scores_csv": "Fixed-cohort observation fit",
    "observation_cohorts_csv": "Expected and shared observation membership",
}


class DiagnosticsDatasets:
    """A source-preserving addition to the original INTEL13 record callbacks.

    operator.ws(workspace_key) must be the existing registered-workspace resolver.
    The HTTP host invokes this feature after its original Bearer authorization.
    native_records and native_artifacts are optional existing repository callbacks;
    their accepted schemas and identities pass through unchanged.
    """

    def __init__(self, operator, *, native_records=None, native_artifacts=None):
        self.operator = operator
        self.native_records = native_records
        self.native_artifacts = native_artifacts
        self._cache = {}
        self._lock = threading.RLock()

    @staticmethod
    def dataset_id(diagnostic_id, artifact_key="report_json"):
        if not _ID.fullmatch(diagnostic_id):
            raise ValueError("A retained diagnostic content ID is required")
        result = "es26:" + diagnostic_id + ":" + artifact_key
        if len(result) > 256:
            raise ValueError("Diagnostic export identifier exceeds the inspection limit")
        return result

    def tenant_root(self, workspace_key):
        return Path(self.operator.ws(workspace_key).root).resolve()

    @staticmethod
    def _file_signature(path):
        try:
            value = path.stat()
        except FileNotFoundError:
            return None
        return (value.st_size, value.st_mtime_ns, value.st_ctime_ns, value.st_ino)

    def _index(self, ws):
        root = Path(ws.root).resolve()
        collection = root / "experiment-diagnostics"
        if not collection.exists():
            return (), ()
        if not collection.resolve().is_relative_to(root):
            raise ValueError("Diagnostic collection leaves the registered workspace")
        rows = []
        for folder in sorted(collection.iterdir(), key=lambda item: item.name):
            if not folder.is_dir() or not _ID.fullmatch(folder.name):
                continue
            if not folder.resolve().is_relative_to(root):
                raise ValueError("Diagnostic directory leaves the registered workspace")
            rows.append((
                folder.name,
                self._file_signature(folder / "manifest.json"),
                self._file_signature(folder / "state.json"),
                self._file_signature(folder / "report.json"),
            ))
        return tuple(item[0] for item in rows), tuple(rows)

    @staticmethod
    def _export_path(root, descriptor):
        path = Path(descriptor["path"])
        if not path.is_absolute():
            path = root / path
        path = path.resolve()
        if not path.is_relative_to(root):
            raise ValueError("Diagnostic export leaves the registered workspace")
        return path

    def _revision_index(self, ws):
        root = Path(ws.root).resolve()
        base = root / "intelligence" / "diagnostic-revisions"
        if not base.exists():
            return (), ()
        if not base.resolve().is_relative_to(root):
            raise ValueError("Report revision collection leaves the registered workspace")
        revisions, signature = [], []
        for diagnostic in sorted(base.iterdir()):
            if not diagnostic.is_dir() or not _ID.fullmatch(diagnostic.name):
                continue
            for revision in sorted(diagnostic.iterdir()):
                if not revision.is_dir() or not _ID.fullmatch(revision.name):
                    continue
                if not revision.resolve().is_relative_to(root):
                    raise ValueError("Report revision leaves the registered workspace")
                manifest, report = revision / "manifest.json", revision / "report.json"
                revisions.append((diagnostic.name, revision.name, manifest, report))
                signature.append((diagnostic.name, revision.name,
                                  self._file_signature(manifest), self._file_signature(report)))
        return tuple(revisions), tuple(signature)

    def _revision_record(self, ws, diagnostic_id, sha, manifest_path, report_path, workspace_key):
        root = Path(ws.root).resolve()
        manifest = read_json(manifest_path)
        dataset_id = self.dataset_id(diagnostic_id, "report_revision_" + sha)
        source_id = self.dataset_id(diagnostic_id)
        descriptor = manifest.get("report") or {}
        if (
            manifest.get("schema") != "upstate.diagnostic-report-revision/v1"
            or manifest.get("project_id") != ws.project["id"]
            or manifest.get("diagnostic_id") != diagnostic_id
            or manifest.get("dataset_id") != dataset_id
            or manifest.get("source_dataset_id") != source_id
            or manifest.get("source_sha256") != sha or descriptor.get("sha256") != sha
            or self._export_path(root, descriptor) != report_path.resolve()
        ):
            raise ValueError("Report revision has a different original identity")
        path = verify_file(root, descriptor)
        metadata = {
            **manifest.get("metadata", {}),
            "record_type": "retained_scientific_report_revision",
            "diagnostic_id": diagnostic_id, "report_revision_sha256": sha,
            "artifact_key": "report_json", "artifact_sha256": sha,
            "report_ref": {"kind": "dataset", "id": dataset_id},
            "current_report_ref": {"kind": "dataset", "id": source_id},
            "original_project_id": ws.project["id"], "inspection": "profile",
        }
        title = metadata.get("diagnostic_title") or diagnostic_id[:12]
        return {
            "id": dataset_id, "tenant_id": workspace_key,
            "label": title + " / Report revision " + sha[:12],
            "path": str(path), "sha256": sha, "bytes": descriptor["bytes"],
            "metadata": metadata,
        }

    def _catalogue(self, workspace_key):
        ws = self.operator.ws(workspace_key)
        root = Path(ws.root).resolve()
        ids, signature = self._index(ws)
        revisions, revision_signature = self._revision_index(ws)
        signature = (signature, revision_signature)
        key = (workspace_key, str(root))
        with self._lock:
            cached = self._cache.get(key)
            if cached is not None and cached["signature"] == signature:
                return cached
            rows, issues = [], []
            for diagnostic_id in ids:
                try:
                    report = diagnostics.inspect(ws, diagnostic_id)
                    exports = report.get("artifacts", {})
                    if "report_json" not in exports:
                        continue
                    selection = report["selection"]
                    title = selection.get("title") or diagnostic_id[:12]
                    report_ref = {
                        "kind": "dataset",
                        "id": self.dataset_id(diagnostic_id),
                    }
                    shared = {
                        "record_type": "retained_scientific_diagnostic_export",
                        "diagnostic_id": diagnostic_id,
                        "diagnostic_title": title,
                        "report_ref": report_ref,
                        "source_stamp": report["source_stamp"],
                        "grid_id": selection.get("grid_id"),
                        "baseline_scenario_id": selection.get("baseline_scenario_id"),
                        "reference_profile_id": selection.get("reference_profile_id"),
                        "design": selection.get("design"),
                        "native_run_count": len(selection.get("run_ids", [])),
                        "result_state": report.get("results_state", report.get("state")),
                    }
                    for artifact_key, descriptor in sorted(exports.items()):
                        if artifact_key == "state" or not isinstance(descriptor, dict):
                            continue
                        if not descriptor.get("path") or not descriptor.get("sha256"):
                            continue
                        path = self._export_path(root, descriptor)
                        if path.suffix.lower() not in _READABLE:
                            continue
                        metadata = {
                            **shared,
                            "artifact_key": artifact_key,
                            "filename": descriptor.get("filename") or path.name,
                            "artifact_sha256": descriptor["sha256"],
                            "inspection": "profile",
                        }
                        for field in ("units", "sum_units", "role"):
                            if field in descriptor:
                                metadata[field] = descriptor[field]
                        if artifact_key == "report_json":
                            metadata["coverage"] = report.get("coverage", {})
                            metadata["interpretation"] = report.get("interpretation", {})
                        rows.append({
                            "id": self.dataset_id(diagnostic_id, artifact_key),
                            "tenant_id": workspace_key,
                            "label": title + " / " + _NAMES.get(
                                artifact_key, artifact_key.replace("_", " ")
                            ),
                            "path": str(path),
                            "sha256": descriptor["sha256"],
                            "metadata": metadata,
                        })
                except Exception as exc:
                    issues.append({
                        "diagnostic_id": diagnostic_id,
                        "error_type": type(exc).__name__,
                        "message": (
                            "Diagnostic export registration failed. "
                            "Open this diagnostic in Scientific interpretation."
                        ),
                    })
            for diagnostic_id, sha, manifest_path, report_path in revisions:
                try:
                    rows.append(self._revision_record(
                        ws, diagnostic_id, sha, manifest_path, report_path, workspace_key,
                    ))
                except Exception as exc:
                    issues.append({
                        "diagnostic_id": diagnostic_id, "report_revision_sha256": sha,
                        "error_type": type(exc).__name__,
                        "message": "The retained report revision could not be registered.",
                    })
            cached = {"signature": signature, "rows": rows, "issues": issues}
            self._cache[key] = cached
            return cached

    def records(self, workspace_key, kind):
        self.operator.ws(workspace_key)
        rows = list(self.native_records(workspace_key, kind)) if self.native_records else []
        if kind == "dataset":
            rows.extend(copy.deepcopy(self._catalogue(workspace_key)["rows"]))
        return rows

    def artifacts(self, workspace_key, job_id):
        self.operator.ws(workspace_key)
        if self.native_artifacts is None:
            return []
        return self.native_artifacts(workspace_key, job_id)

    def warnings(self, workspace_key):
        """Include these per-diagnostic outcomes in the host's status/catalog view."""
        return copy.deepcopy(self._catalogue(workspace_key)["issues"])

    def invalidate(self, workspace_key=None):
        """Optional host hook after analysis or restore; file changes also refresh."""
        with self._lock:
            if workspace_key is None:
                self._cache.clear()
            else:
                self._cache = {
                    key: value for key, value in self._cache.items()
                    if key[0] != workspace_key
                }

    def operator_report(self, workspace_key, diagnostic_id):
        """Return the original decorated report and authenticated download tickets."""
        self.operator.ws(workspace_key)
        return self.operator.extensions.read(
            "GET", "/api/diagnostics/item", workspace_key,
            {"diagnostic_id": diagnostic_id},
        )

    def report_revision(self, workspace_key, diagnostic_id, source_sha256):
        """Read the already captured report without consulting a newer live report."""
        from eco_intelligence.common import IntelligenceError
        from model.common import describe_file

        if (not isinstance(diagnostic_id, str) or not _ID.fullmatch(diagnostic_id)
                or not isinstance(source_sha256, str) or not _ID.fullmatch(source_sha256)):
            raise IntelligenceError("Choose an original saved report revision.", 422)
        ws = self.operator.ws(workspace_key)
        root = Path(ws.root).resolve()
        folder = root / "intelligence" / "diagnostic-revisions" / diagnostic_id / source_sha256
        if not folder.resolve().is_relative_to(root):
            raise IntelligenceError("The report revision leaves this workspace.", 409)
        manifest_path, report_path = folder / "manifest.json", folder / "report.json"
        if not manifest_path.is_file() or not report_path.is_file():
            raise IntelligenceError("The selected report revision is not retained in this workspace.", 404)
        row = self._revision_record(
            ws, diagnostic_id, source_sha256, manifest_path, report_path, workspace_key,
        )
        value = read_json(Path(row["path"]))
        if not isinstance(value, dict) or value.get("id") != diagnostic_id:
            raise IntelligenceError("The retained report contains another diagnostic.", 409)
        manifest = read_json(manifest_path)
        descriptor = manifest["report"]
        value = copy.deepcopy(value)
        value["artifacts"] = {**value.get("artifacts", {}), "report_json": descriptor}
        downloads = []
        for key, path, item, title in (
            ("report_json", report_path, descriptor, "Captured scientific report JSON"),
            ("revision_manifest", manifest_path, describe_file(root, manifest_path),
             "Captured report source manifest"),
        ):
            ticket = self.operator._ticket(
                workspace_key, path, {**item, "filename": path.name}, title,
            )
            downloads.append({**ticket, "artifact_key": key})
        value["_downloads"] = downloads
        value["_retained_revision"] = {
            "dataset_id": row["id"], "source_sha256": source_sha256,
            "project_id": ws.project["id"], "created_at": manifest.get("created_at"),
        }
        return value

    def repository(self):
        from eco_intelligence.adapters import StoreBackedRepository

        return StoreBackedRepository(self.records, self.artifacts, self.tenant_root)


class DiagnosticRepositoryJoin:
    """Add saved diagnostic datasets to one existing Engine repository.

    The caller supplies the namespace used by its public Engine calls. The
    original A66A/E258 host uses the current registered workspace key here;
    ProjectStore separately maps that key to its stable SQL namespace.  The existing native
    repository, Store, Assistant, provider, and action gateway remain in use.
    """

    def __init__(self, native, operator, workspace_key, namespace):
        from eco_intelligence.adapters import StoreBackedRepository
        from eco_intelligence.common import IntelligenceError

        if not isinstance(namespace, str) or not namespace:
            raise IntelligenceError("The existing intelligence namespace is required.")
        ws = operator.ws(workspace_key)
        self.native = native
        self.operator = operator
        self.workspace_key = workspace_key
        self.namespace = namespace
        self.project_id = ws.project["id"]
        self.root = Path(ws.root).resolve()
        self.bridge = DiagnosticsDatasets(operator)
        self._diagnostics = StoreBackedRepository(
            self._records, self._artifacts, self._tenant_root,
        )

    def _workspace(self, tenant):
        from eco_intelligence.common import IntelligenceError

        if tenant != self.namespace:
            raise IntelligenceError("Investigation namespace does not match this workspace.", 403)
        ws = self.operator.ws(self.workspace_key)
        if ws.project["id"] != self.project_id or Path(ws.root).resolve() != self.root:
            raise IntelligenceError("The registered investigation workspace changed.", 409)
        return ws

    @staticmethod
    def _is_diagnostic(kind, object_id):
        return (
            kind == "dataset" and isinstance(object_id, str)
            and object_id.startswith("es26:")
        )

    def _records(self, tenant, kind):
        self._workspace(tenant)
        if kind != "dataset":
            return []
        return [
            {
                **row,
                "tenant_id": self.namespace,
                "metadata": {
                    **row.get("metadata", {}),
                    "original_project_id": self.project_id,
                },
            }
            for row in self.bridge.records(self.workspace_key, "dataset")
        ]

    def _artifacts(self, tenant, job_id):
        self._workspace(tenant)
        return []

    def _tenant_root(self, tenant):
        return self._workspace(tenant).root

    def _native_inventory(self, tenant):
        from eco_intelligence.common import IntelligenceError

        result = self.native.inventory(tenant)
        if result.get("tenant_id") != tenant:
            raise IntelligenceError("Native inventory returned a different namespace.", 409)
        return result

    def _unambiguous(self, tenant, object_id):
        from eco_intelligence.common import IntelligenceError

        datasets = self._native_inventory(tenant).get("datasets", [])
        if any(row["id"] == object_id for row in datasets):
            raise IntelligenceError(
                "A diagnostic dataset ID is already registered by the native repository.", 409
            )

    def inventory(self, tenant):
        from eco_intelligence.common import IntelligenceError

        self._workspace(tenant)
        result = copy.deepcopy(self._native_inventory(tenant))
        datasets = list(result.get("datasets", []))
        incoming = self._diagnostics.inventory(tenant)["datasets"]
        occupied = {row["id"] for row in datasets}
        if occupied.intersection(row["id"] for row in incoming):
            raise IntelligenceError(
                "Diagnostic datasets were attached more than once or their IDs collide.", 409
            )
        datasets.extend(incoming)
        result["datasets"] = datasets
        result["counts"] = {**result.get("counts", {}), "datasets": len(datasets)}
        return result

    def row(self, tenant, kind, object_id):
        self._workspace(tenant)
        if self._is_diagnostic(kind, object_id):
            self._unambiguous(tenant, object_id)
            return self._diagnostics.row(tenant, kind, object_id)
        return self.native.row(tenant, kind, object_id)

    def path(self, tenant, ref):
        self._workspace(tenant)
        if self._is_diagnostic(ref.get("kind"), ref.get("id")):
            self._unambiguous(tenant, ref["id"])
            return self._diagnostics.path(tenant, ref)
        return self.native.path(tenant, ref)

    def source(self, tenant, ref):
        self._workspace(tenant)
        if self._is_diagnostic(ref.get("kind"), ref.get("id")):
            self._unambiguous(tenant, ref["id"])
            return self._diagnostics.source(tenant, ref)
        return self.native.source(tenant, ref)

    def assert_unchanged(self, tenant, source):
        self._workspace(tenant)
        ref = source.get("ref", {})
        if self._is_diagnostic(ref.get("kind"), ref.get("id")):
            self._unambiguous(tenant, ref["id"])
            return self._diagnostics.assert_unchanged(tenant, source)
        return self.native.assert_unchanged(tenant, source)

    def artifacts(self, tenant, job_id):
        self._workspace(tenant)
        return self.native.artifacts(tenant, job_id)

    def warnings(self, tenant):
        self._workspace(tenant)
        return self.bridge.warnings(self.workspace_key)

    def operator_report(self, tenant, diagnostic_id):
        self._workspace(tenant)
        return self.bridge.operator_report(self.workspace_key, diagnostic_id)


_BIND_LOCK = threading.RLock()


def bind_saved_diagnostics(engine, operator, workspace_key, namespace):
    """Bind an existing per-workspace Engine without replacing its other services.

    Call from the host's existing engine(workspace_key) factory, before returning
    the Engine.  Repeating the same binding is idempotent.  A restored workspace
    uses its factory's received Engine and original retained namespace.
    """
    from eco_intelligence.common import IntelligenceError

    with _BIND_LOCK:
        current = engine.repo
        if isinstance(current, DiagnosticRepositoryJoin):
            if (
                current.operator is not operator
                or current.workspace_key != workspace_key
                or current.namespace != namespace
            ):
                raise IntelligenceError(
                    "An Engine already belongs to another receiving workspace context.", 409
                )
            current._workspace(namespace)
            return current
        joined = DiagnosticRepositoryJoin(current, operator, workspace_key, namespace)
        engine.repo = joined
        return joined
