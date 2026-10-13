"""Install the verified watershed HTML preview in the current extension-enabled operator."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from model.common import atomic_bytes, file_digest


def integrate(application):
    application = Path(application).resolve(strict=True)
    target = application / "operator" / "server.py"
    body = target.read_text(encoding="utf-8")
    original_sha256 = file_digest(target)
    changes = []
    dependencies = {}
    producer = application / "model/scenario_decisions.py"
    producer_source = producer.read_text(encoding="utf-8")
    if "from .native_versions import" in producer_source:
        for name in ("model/native_versions.py", "model/model_selection.py"):
            dependency = application / name
            if not dependency.is_file():
                raise ValueError("Receive the complete current watershed component; missing " + name)
            compile(dependency.read_bytes(), str(dependency), "exec")
            dependencies[name] = file_digest(dependency)

    if "from extension_registry import ExtensionRegistry" not in body:
        raise ValueError("Install the shared operator extensions first with project-root install_extensions.py")

    # Migrate only exact joins from the previous producer-specific composer.
    # Everything else in the current server is retained byte for byte.
    legacy = {
        "legacy import": "from scenario_decision_reports import ScenarioDecisionReports, ACTIONS as SCENARIO_REPORT_ACTIONS, READS as SCENARIO_REPORT_READS\n",
        "legacy action registry": "ACTIONS.update(SCENARIO_REPORT_ACTIONS)\n",
        "legacy adapter": "        self.scenario_decision_reports = ScenarioDecisionReports(self, Fault)\n",
        "legacy task dispatch": "        if action in SCENARIO_REPORT_ACTIONS:\n            return self.scenario_decision_reports.invoke(task)\n",
        "legacy task decoration": "        task = self.scenario_decision_reports.decorate_task(task)\n",
        "legacy JSON routes": (
            "                scenario_reads = {\"/api/scenario-reports/\" + name: name for name in SCENARIO_REPORT_READS}\n"
            "                if url.path in scenario_reads:\n"
            "                    return self.send_json(200, self.app.scenario_decision_reports.read(\n"
            "                        workspace, scenario_reads[url.path],\n"
            "                        {name: one(name) for name in (\"report_id\", \"baseline_run_id\", \"alternative_run_ids\", \"pollutants\", \"title\")}))\n"
        ),
    }
    for name, fragment in legacy.items():
        count = body.count(fragment)
        if count > 1:
            raise ValueError("Current operator repeats " + name + "; its source was preserved")
        if count:
            body = body.replace(fragment, "", 1)
            changes.append("migrate " + name)
    old_preview = "                ticket, policy = self.app.scenario_decision_reports.preview(selected[0], selected[1])"
    if old_preview in body:
        if body.count(old_preview) != 1:
            raise ValueError("Current operator repeats its watershed preview; source was preserved")
        body = body.replace(old_preview,
            "                ticket, policy = scenario_report_preview(self.app, selected[0], selected[1], Fault)", 1)
        changes.append("migrate legacy preview")
    if "SCENARIO_REPORT_ACTIONS" in body or "SCENARIO_REPORT_READS" in body or "self.scenario_decision_reports" in body:
        raise ValueError("A previously edited watershed join requires composition against its current source")

    import_line = "from scenario_decision_reports import preview as scenario_report_preview\n"
    marker = '            if url.path.startswith("/api/file/scenario-report/"):'
    route = (
        marker + "\n"
        "                self.authorized(file=True)\n"
        "                selected = url.path.removeprefix(\"/api/file/scenario-report/\").split(\"/\")\n"
        "                if len(selected) != 2:\n"
        "                    raise Fault(\"DECISION_PREVIEW\", \"Choose a saved watershed report.\", 404)\n"
        "                ticket, policy = scenario_report_preview(self.app, selected[0], selected[1], Fault)\n"
        "                return self.send_file(ticket[\"id\"], download=one(\"download\") == \"1\", content_security_policy=policy)\n"
    )
    registry_path = application / "operator" / "extension_registry.py"
    registry_source = registry_path.read_text(encoding="utf-8")
    shared_marker = "            if self.app.extensions.has_file_route(url.path):"
    modern = shared_marker in body and "    def file_reply(self, path):" in registry_source
    if modern:
        if body.count(shared_marker) != 1:
            raise ValueError("The current shared file transport repeats; source was preserved")
        descriptor = json.loads((application / "operator" / "extensions" / "scenario_reports.json").read_text(encoding="utf-8"))
        backend = descriptor.get("backend", {})
        expected = {
            "path": "/api/file/scenario-report/{workspace_key}/{report_id}",
            "handler": "preview",
            "args": ["operator", "route.workspace_key", "route.report_id", "fault"],
            "response": "ticket_policy_pair",
        }
        selected = [row for row in backend.get("file_routes", []) if row.get("path") == expected["path"]]
        if (backend.get("module") != "scenario_decision_reports" or len(selected) != 1
                or any(selected[0].get(name) != value for name, value in expected.items())):
            raise ValueError("Install the current scenario_reports.json with its four-argument module preview binding")
        if marker in body:
            if body.count(route) != 1 or body.count(marker) != 1:
                raise ValueError("The existing watershed preview differs; compose its current handler before writing")
            body = body.replace(route, "", 1)
            changes.append("shared registry replaces authored preview route")
        if import_line in body:
            if body.count(import_line) != 1:
                raise ValueError("The authored preview import repeats; source was preserved")
            body = body.replace(import_line, "", 1)
            changes.append("remove redundant authored preview import")
        if "scenario_report_preview" in body:
            raise ValueError("Another authored preview use needs composition against its current source")
        transport = "shared_extension_registry"
    else:
        if import_line not in body:
            anchor = "from extension_registry import ExtensionRegistry\n"
            if body.count(anchor) != 1:
                raise ValueError("Current operator requires its original extension import join; source was preserved")
            body = body.replace(anchor, anchor + import_line, 1)
            changes.append("preview import")
        if marker not in body:
            anchor = '            if url.path.startswith("/api/file/"):'
            if body.count(anchor) != 1:
                raise ValueError("Current operator requires the original verified file-route join; source was preserved")
            body = body.replace(anchor, route + anchor, 1)
            changes.append("authenticated report preview")
        elif route not in body:
            raise ValueError("The existing watershed preview differs; compose its current handler before writing")
        transport = "authored_compatible_preview"

    compile(body, str(target), "exec")
    if changes:
        if file_digest(target) != original_sha256:
            raise ValueError("Operator source changed during composition; reopen its current source")
        atomic_bytes(target, body.encode("utf-8"))
    return {"path": str(target), "changed": changes, "sha256": file_digest(target),
            "registration": "operator/extensions/scenario_reports.json", "transport": transport,
            "runtime_dependencies": dependencies}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", default=str(Path(__file__).resolve().parents[1]))
    args = parser.parse_args(argv)
    import json
    print(json.dumps(integrate(args.application), sort_keys=True))


if __name__ == "__main__":
    main()
