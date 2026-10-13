#!/usr/bin/env python3
"""Install Scientific interpretation into the original Upper Savannah operator.

TokenJunkieLabs. This installer retains the current shared application source,
applies only additive registration edits, and copies this component's owned
files. Existing native runs and scientific workspace data are not touched.
"""
from __future__ import annotations
import argparse
import ast
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

LEAVES = (
    "model/experiment_diagnostics.py",
    "model/diagnostics_cli.py",
    "operator/experiment_diagnostics.py",
    "operator/web/experiment_diagnostics.mjs",
    "operator/web/experiment_diagnostics.css",
    "operator/DIAGNOSTICS.md",
    "operator/install_diagnostics.py",
)
PATCHES = json.loads(r"""[
  {
    "path": "operator/server.py",
    "key": "server-import",
    "anchor": "from customer_reviews import CustomerReviews, ACTIONS as CUSTOMER_REVIEW_ACTIONS, READS as CUSTOMER_REVIEW_READS",
    "replacement": "from customer_reviews import CustomerReviews, ACTIONS as CUSTOMER_REVIEW_ACTIONS, READS as CUSTOMER_REVIEW_READS\nfrom experiment_diagnostics import ExperimentDiagnostics, ACTIONS as DIAGNOSTIC_ACTIONS, READS as DIAGNOSTIC_READS"
  },
  {
    "path": "operator/server.py",
    "key": "server-actions",
    "anchor": "ACTIONS.update(CUSTOMER_REVIEW_ACTIONS)",
    "replacement": "ACTIONS.update(CUSTOMER_REVIEW_ACTIONS)\nACTIONS.update(DIAGNOSTIC_ACTIONS)"
  },
  {
    "path": "operator/server.py",
    "key": "server-init",
    "anchor": "        self.customer_reviews = CustomerReviews(self, Fault)",
    "replacement": "        self.customer_reviews = CustomerReviews(self, Fault)\n        self.experiment_diagnostics = ExperimentDiagnostics(self, Fault)"
  },
  {
    "path": "operator/server.py",
    "key": "server-invoke",
    "anchor": "        if action in CUSTOMER_REVIEW_ACTIONS:",
    "replacement": "        if action in DIAGNOSTIC_ACTIONS:\n            return self.experiment_diagnostics.invoke(task)\n        if action in CUSTOMER_REVIEW_ACTIONS:"
  },
  {
    "path": "operator/server.py",
    "key": "server-state",
    "anchor": "        state = ws.overview()\n",
    "replacement": "        state = ws.overview()\n        state[\"experiment_diagnostics\"] = self.experiment_diagnostics.summaries(workspace)\n"
  },
  {
    "path": "operator/server.py",
    "key": "server-task",
    "anchor": "self.customer_reviews.decorate_task(task)",
    "replacement": "self.experiment_diagnostics.decorate_task(self.customer_reviews.decorate_task(task))"
  },
  {
    "path": "operator/server.py",
    "key": "server-read",
    "anchor": "                review_reads = {\"/api/reviews/\" + name: name for name in CUSTOMER_REVIEW_READS}",
    "replacement": "                diagnostic_reads = {\"/api/diagnostics/\" + name: name for name in DIAGNOSTIC_READS}\n                if url.path in diagnostic_reads:\n                    return self.send_json(200, self.app.experiment_diagnostics.read(\n                        workspace, diagnostic_reads[url.path],\n                        {name: one(name) for name in (\"diagnostic_id\", \"experiment_id\")}))\n                review_reads = {\"/api/reviews/\" + name: name for name in CUSTOMER_REVIEW_READS}"
  },
  {
    "path": "operator/server.py",
    "key": "server-static",
    "anchor": "\"reviews.mjs\", \"reviews.css\"",
    "replacement": "\"reviews.mjs\", \"reviews.css\", \"experiment_diagnostics.mjs\", \"experiment_diagnostics.css\""
  },
  {
    "path": "operator/web/app.mjs",
    "key": "app-import",
    "anchor": "import {attachCustomerReviews} from './reviews.mjs';",
    "replacement": "import {attachCustomerReviews} from './reviews.mjs';\nimport {attachExperimentDiagnostics} from './experiment_diagnostics.mjs';"
  },
  {
    "path": "operator/web/app.mjs",
    "key": "app-views",
    "anchor": "const viewLabels={",
    "replacement": "const viewLabels={'experiment-diagnostics':'Scientific interpretation',"
  },
  {
    "path": "operator/web/app.mjs",
    "key": "app-actions",
    "anchor": "const actionLabels={",
    "replacement": "const actionLabels={'diagnostics.analyze':'Analyze scientific cohort',"
  },
  {
    "path": "operator/web/app.mjs",
    "key": "app-adapter",
    "anchor": "function toast(message){",
    "replacement": "const experimentDiagnostics=attachExperimentDiagnostics({getState:()=>state,api,endpoint,openForm,submitAction,detail,fileList,showTask,openItem,toast,refreshState:refresh,navigate,closeDetail:()=>{detailDialog.close();detailContext=null;}});\nfunction toast(message){"
  },
  {
    "path": "operator/web/app.mjs",
    "key": "app-spatial-detach",
    "anchor": "if(view==='spatial'){community.detach();customerReviews.detach();",
    "replacement": "if(view==='spatial'){community.detach();customerReviews.detach();experimentDiagnostics.detach();"
  },
  {
    "path": "operator/web/app.mjs",
    "key": "app-render",
    "anchor": "  $('#content').innerHTML=html;\n",
    "replacement": "  if(view==='experiment-diagnostics')html=experimentDiagnostics.render();\n  $('#content').innerHTML=html;\n"
  },
  {
    "path": "operator/web/app.mjs",
    "key": "app-mount",
    "anchor": "  if(view==='customer-reviews')customerReviews.mount($('#content'));else customerReviews.detach();",
    "replacement": "  if(view==='customer-reviews')customerReviews.mount($('#content'));else customerReviews.detach();\n  if(view==='experiment-diagnostics')experimentDiagnostics.mount($('#content'));else experimentDiagnostics.detach();"
  },
  {
    "path": "operator/web/app.mjs",
    "key": "app-task",
    "anchor": "customerReviews.taskActions(row)+",
    "replacement": "experimentDiagnostics.taskActions(row)+customerReviews.taskActions(row)+"
  },
  {
    "path": "operator/web/app.mjs",
    "key": "app-workspace-detach",
    "anchor": "workspace=id;state=null;",
    "replacement": "experimentDiagnostics.detach();workspace=id;state=null;"
  },
  {
    "path": "operator/web/app.mjs",
    "key": "app-dispatch",
    "anchor": " if(action?.startsWith('review-'))return customerReviews.dispatch(button);",
    "replacement": " if(action?.startsWith('review-'))return customerReviews.dispatch(button);\n if(action?.startsWith('diagnostic-'))return experimentDiagnostics.dispatch(button);"
  },
  {
    "path": "operator/web/index.html",
    "key": "index-style",
    "anchor": "</head>",
    "replacement": "<link rel=\"stylesheet\" href=\"/web/experiment_diagnostics.css\">\n</head>"
  },
  {
    "path": "operator/web/index.html",
    "key": "index-nav",
    "anchor": "    <button data-view=\"observations\">",
    "replacement": "    <button data-view=\"experiment-diagnostics\">Scientific interpretation</button>\n    <button data-view=\"observations\">"
  }
]""")


def sha(body):
    return hashlib.sha256(body).hexdigest()


def current_bytes(path):
    return path.read_bytes() if path.is_file() else None


def compute_edits(application, source):
    before, after, changes = {}, {}, []
    for item in PATCHES:
        relative = item["path"]
        path = application / relative
        if relative not in before:
            before[relative] = path.read_bytes()
            after[relative] = before[relative].decode("utf-8")
        text = after[relative]
        if item["replacement"] in text:
            continue
        count = text.count(item["anchor"])
        if count != 1:
            raise ValueError(
                relative + ": integration anchor " + item["key"] + " occurs "
                + str(count) + " times. Reconcile that named registration with "
                "the current shared file before applying this source edition."
            )
        after[relative] = text.replace(item["anchor"], item["replacement"], 1)
        changes.append(item["key"])
    after = {relative: text.encode("utf-8") for relative, text in after.items()}
    for relative in LEAVES:
        path = source / relative
        body = path.read_bytes()
        before.setdefault(relative, current_bytes(application / relative))
        after[relative] = body
    for relative, body in after.items():
        if relative.endswith(".py"):
            ast.parse(body.decode("utf-8"), filename=relative)
    return before, after, changes


def validate_modules(after):
    node = shutil.which("node")
    if node is None:
        return {"python": "parsed", "javascript": "Node unavailable"}
    checked = []
    with tempfile.TemporaryDirectory(prefix="upstate-diagnostics-syntax-") as temporary:
        for relative, body in after.items():
            if not relative.endswith(".mjs"):
                continue
            path = Path(temporary) / Path(relative).name
            path.write_bytes(body)
            result = subprocess.run(
                [node, "--check", str(path)], capture_output=True, text=True,
                timeout=45, check=False,
            )
            if result.returncode:
                raise ValueError(relative + ": " + result.stderr.strip())
            checked.append(relative)
    return {"python": "parsed", "javascript": checked}


def install(application, source):
    application = application.resolve(strict=True)
    source = source.resolve(strict=True)
    if not (application / "model" / "workspace.py").is_file():
        raise ValueError("Select the original Python scientific application root")
    with (application / ".diagnostics-source-install.lock").open("a+b") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        before, after, changes = compute_edits(application, source)
        validation = validate_modules(after)
        changed = [relative for relative, body in after.items()
                   if before[relative] != body]
        if not changed:
            return {"state": "current", "application": str(application),
                    "changed_files": [], "validation": validation}
        for relative in changed:
            if current_bytes(application / relative) != before[relative]:
                raise RuntimeError(relative + " changed during source integration; retry from current source")
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
        history = application.parent / (application.name + "-source-history") / ("ES26-" + stamp)
        history.mkdir(parents=True, exist_ok=False)
        manifest = {"component": "ES26 scientific interpretation", "created_at": stamp,
                    "application": str(application), "files": {},
                    "registration_edits": changes, "validation": validation}
        for relative in changed:
            body = before[relative]
            if body is not None:
                copy = history / relative
                copy.parent.mkdir(parents=True, exist_ok=True)
                copy.write_bytes(body)
            manifest["files"][relative] = {
                "previous_sha256": sha(body) if body is not None else None,
                "source_sha256": sha(after[relative]), "bytes": len(after[relative]),
            }
        (history / "integration.json").write_text(
            json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        # Shared browser registration is replaced last, after its owned modules.
        ordered = [relative for relative in changed if relative not in
                   ("operator/server.py", "operator/web/app.mjs", "operator/web/index.html")]
        ordered += [relative for relative in
                    ("operator/server.py", "operator/web/app.mjs", "operator/web/index.html")
                    if relative in changed]
        for relative in ordered:
            target = application / relative
            if current_bytes(target) != before[relative]:
                raise RuntimeError(relative + " changed during installation; retained earlier edition at " + str(history))
            target.parent.mkdir(parents=True, exist_ok=True)
            handle, temporary_name = tempfile.mkstemp(prefix="." + target.name + ".", dir=target.parent)
            temporary = Path(temporary_name)
            try:
                with os.fdopen(handle, "wb") as stream:
                    stream.write(after[relative])
                    stream.flush()
                    os.fsync(stream.fileno())
                if target.exists():
                    os.chmod(temporary, target.stat().st_mode & 0o777)
                else:
                    os.chmod(temporary, 0o644)
                os.replace(temporary, target)
            finally:
                temporary.unlink(missing_ok=True)
        return {"state": "installed", "application": str(application),
                "changed_files": changed, "registration_edits": changes,
                "previous_source": str(history), "validation": validation,
                "operator": "Reopen the original operator with its existing workspace and state directory."}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", required=True, type=Path,
                        help="Current cumulative application containing model/workspace.py and operator/server.py")
    parser.add_argument("--source", type=Path, default=Path(__file__).resolve().parents[1],
                        help="Decoded complete diagnostics source directory")
    args = parser.parse_args(argv)
    try:
        result = install(args.application, args.source)
    except Exception as error:
        print(json.dumps({"state": "failed", "error": type(error).__name__,
                          "message": str(error)}, ensure_ascii=False, allow_nan=False),
              file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2, ensure_ascii=False, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
