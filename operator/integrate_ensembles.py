"""Register scenario ensembles through the installed shared operator host.

Receive the complete source addition, then run with --apply. The current shared
extension installer owns the common server and browser joins. Any exact joins
from this package's earlier direct installer are migrated to that host.
"""
from __future__ import annotations
import argparse
import ast
import importlib.util
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import fcntl

JOINS = json.loads(r'''{
  "operator/server.py": [
    [
      "from model.spatial_exports import SpatialExports",
      "from model.spatial_exports import SpatialExports\nfrom ensemble_service import EnsembleService, ACTIONS as ENSEMBLE_ACTIONS, READS as ENSEMBLE_READS"
    ],
    [
      "ACTIONS.update(CUSTOMER_REVIEW_ACTIONS)",
      "ACTIONS.update(CUSTOMER_REVIEW_ACTIONS)\nACTIONS.update(ENSEMBLE_ACTIONS)"
    ],
    [
      "        self.customer_reviews = CustomerReviews(self, Fault)",
      "        self.customer_reviews = CustomerReviews(self, Fault)\n        self.ensembles = EnsembleService(self, Fault)"
    ],
    [
      "        if action in CUSTOMER_REVIEW_ACTIONS:\n            return self.customer_reviews.invoke(task)",
      "        if action in ENSEMBLE_ACTIONS:\n            return self.ensembles.invoke(task)\n        if action in CUSTOMER_REVIEW_ACTIONS:\n            return self.customer_reviews.invoke(task)"
    ],
    [
      "        return {\"workspace_key\": workspace, \"workspaces\": self.public_workspaces(), \"data\": state,",
      "        state[\"ensembles\"] = self.ensembles.overview(workspace)\n        return {\"workspace_key\": workspace, \"workspaces\": self.public_workspaces(), \"data\": state,"
    ],
    [
      "                review_reads = {\"/api/reviews/\" + name: name for name in CUSTOMER_REVIEW_READS}",
      "                ensemble_reads = {\"/api/ensembles/\" + name: name for name in ENSEMBLE_READS}\n                if url.path in ensemble_reads:\n                    return self.send_json(200, self.app.ensembles.read(workspace, ensemble_reads[url.path],\n                        {\"ensemble_id\": one(\"ensemble_id\")}))\n                review_reads = {\"/api/reviews/\" + name: name for name in CUSTOMER_REVIEW_READS}"
    ],
    [
      "            spatial_reads = {\"/api/spatial/\" + name: name for name in (\"describe\", \"frame\", \"overlay\", \"point\")}",
      "            if url.path == \"/api/ensembles/preview\":\n                return self.send_json(200, self.app.ensembles.read(\n                    value.get(\"workspace\", self.app.primary), \"preview\", value))\n            spatial_reads = {\"/api/spatial/\" + name: name for name in (\"describe\", \"frame\", \"overlay\", \"point\")}"
    ],
    [
      "\"reviews.mjs\", \"reviews.css\"",
      "\"reviews.mjs\", \"reviews.css\", \"ensembles.mjs\""
    ]
  ],
  "operator/web/app.mjs": [
    [
      "import {attachCustomerReviews} from './reviews.mjs';",
      "import {attachCustomerReviews} from './reviews.mjs';\nimport {attachEnsembles} from './ensembles.mjs';"
    ],
    [
      "const viewLabels={",
      "const viewLabels={ensembles:'Scenario sensitivity',"
    ],
    [
      "const actionLabels={",
      "const actionLabels={'ensemble.create':'Save scenario design','ensemble.run':'Run paired scenarios','ensemble.report':'Generate physical comparison report',"
    ],
    [
      "function toast(message){",
      "const ensembles=attachEnsembles({getState:()=>state,api,endpoint,openForm,submitAction,detail,toast,openItem});\nfunction toast(message){"
    ],
    [
      "  if(view==='spatial'){",
      "  if(view==='ensembles'){spatialWorkspace.suspend();community.detach();customerReviews.detach();ensembles.mount($('#content'));return;}\n  ensembles.detach();\n  if(view==='spatial'){"
    ],
    [
      "spatialWorkspace.suspend();community.detach();customerReviews.detach();workspace=id;",
      "spatialWorkspace.suspend();community.detach();customerReviews.detach();ensembles.detach();workspace=id;"
    ],
    [
      " if(action?.startsWith('review-'))return customerReviews.dispatch(button);",
      " if(action?.startsWith('review-'))return customerReviews.dispatch(button);\n if(action?.startsWith('ensemble-'))return ensembles.dispatch(button);"
    ]
  ]
}''')
# The source bank composes these complete owned files with the existing native
# model/report components. Check their Python grammar before touching shared joins.
REQUIRED = (
    "model/model_selection.py",
    "model/ensembles.py",
    "model/ensemble_cli.py",
    "model/ensemble_operations.py",
    "model/ensemble_report.py",
    "model/ensemble_consumers.py",
    "model/ensemble_consumers_cli.py",
    "model/ensemble_references.py",
    "model/ensemble_flow_support.py",
    "model/ensemble_scientific_source.py",
    "model/ensemble_scientific_figures.py",
    "model/ensemble_study_source.py",
    "model/ensemble_study_transfer.py",
    "model/decision_analysis.py",
    "model/observed_context.py",
    "model/scientific_report.py",
    "model/scientific_figures.py",
    "model/scientific_report_study_transfer.py",
    "model/study_transfer.py",
    "model/ENSEMBLE_CONSUMERS.md",
    "model/NATIVE_STUDY_SCIENTIFIC_REPORT.md",
    "model/ENSEMBLE_STUDY_TRANSFER.md",
    "operator/ensemble_service.py",
    "operator/web/ensembles.mjs",
    "operator/extensions/ensembles.json",
    "operator/extension_registry.py",
    "operator/web/extension_host.mjs",
    "integration/component_fragments/ensemble-scientific-report-composer.json",
    "install_extensions.py",
)

def sha(data):
    return hashlib.sha256(data).hexdigest()

def atomic(path, data):
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".ensemble-join-", delete=False) as out:
            temporary = Path(out.name)
            out.write(data)
            out.flush()
            os.fsync(out.fileno())
        if path.exists():
            os.chmod(temporary, path.stat().st_mode & 0o777)
        os.replace(temporary, path)
        temporary = None
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)

def remove_legacy(path, text):
    """Remove only this package's exact additive joins, preserving other desks."""
    removed = 0
    for original, joined in reversed(JOINS[path]):
        if joined in text:
            count = text.count(joined)
            text = text.replace(joined, original)
            removed += count
            continue
        # Other desks may have inserted text beside the original anchor.
        # Each prior transformation was a pure insertion; remove that exact
        # owned insertion without reverting any neighboring source.
        prefix = 0
        while prefix < len(original) and original[prefix] == joined[prefix]:
            prefix += 1
        suffix = 0
        while (suffix < len(original) - prefix
               and original[len(original) - suffix - 1] == joined[len(joined) - suffix - 1]):
            suffix += 1
        previous = original[prefix:len(original) - suffix if suffix else len(original)]
        addition = joined[prefix:len(joined) - suffix if suffix else len(joined)]
        if previous or not addition:
            raise ValueError("The retained legacy join is not additive: " + path)
        count = text.count(addition)
        if count:
            text = text.replace(addition, "")
            removed += count
    return text, removed

def extension_installer(root):
    path = root / "install_extensions.py"
    specification = importlib.util.spec_from_file_location("upstate_current_extension_installer", path)
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    for name in ("patch_server", "patch_app"):
        if not callable(getattr(module, name, None)):
            raise ValueError("The current shared extension installer is missing " + name)
    return module

def compose(path, before, shared):
    text, removed = remove_legacy(path, before.decode("utf-8"))
    patch = shared.patch_server if path == "operator/server.py" else shared.patch_app
    text = patch(text)
    if path.endswith(".py"):
        ast.parse(text, filename=path)
    return text.encode("utf-8"), removed

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args(argv)
    root = args.application.resolve(strict=True)
    for relative in REQUIRED:
        file = root / relative
        if not file.is_file() or file.is_symlink():
            raise ValueError("Receive the complete source addition first: " + relative)
    manifest = json.loads((root / "operator/extensions/ensembles.json").read_text(encoding="utf-8"))
    if manifest.get("schema") != "upstate.operator-extension/v1" or manifest.get("id") != "ensembles":
        raise ValueError("Receive the complete scenario-sensitivity extension registration.")
    for relative in REQUIRED:
        if relative.endswith(".py"):
            ast.parse((root / relative).read_text(encoding="utf-8"), filename=relative)
    shared = extension_installer(root)
    lock_directory = root / ".locks"
    lock_directory.mkdir(exist_ok=True)
    lock = lock_directory / "extension-install.lock"
    fd = os.open(lock, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        prepared = {}
        records = {}
        for relative in JOINS:
            path = root / relative
            if path.is_symlink():
                raise ValueError("Select the original regular application source: " + relative)
            before = path.read_bytes()
            after, count = compose(relative, before, shared)
            prepared[relative] = (before, after)
            records[relative] = {"before_sha256": sha(before), "after_sha256": sha(after),
                                 "legacy_joins_migrated": count, "bytes": len(after)}
        if args.apply:
            # Recheck both fresh inputs before writing either postimage.
            for relative, (before, _) in prepared.items():
                if (root / relative).read_bytes() != before:
                    raise ValueError("Concurrent application source changed: " + relative)
            for relative, (before, after) in prepared.items():
                if before == after:
                    continue
                path = root / relative
                if path.read_bytes() != before:
                    raise ValueError("Concurrent application source changed: " + relative)
                backup = root / ".ensemble-source-join" / sha(before) / relative
                backup.parent.mkdir(parents=True, exist_ok=True)
                if not backup.exists():
                    atomic(backup, before)
                elif backup.read_bytes() != before:
                    raise ValueError("Retained integration preimage differs: " + relative)
                atomic(path, after)
            atomic(root / ".ensemble-source-join.json",
                   (json.dumps({"schema": "upstate.ensemble-source-join/v2",
                                "extension_id": "ensembles", "catalogue": "/api/extensions",
                                "files": records}, sort_keys=True, indent=2) + "\n").encode())
        print(json.dumps({"state": "applied" if args.apply else "prepared", "extension_id": "ensembles",
                          "catalogue": "/api/extensions", "files": records},
                         sort_keys=True))
    finally:
        os.close(fd)
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
