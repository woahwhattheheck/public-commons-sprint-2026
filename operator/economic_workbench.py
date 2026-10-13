"""Economic desk extension for completed native scenario reports.

Uses the original Operator queue, workspace, item and verified download
transport. Native model execution stays in the existing model desks.
"""
from __future__ import annotations

import base64
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
from html.parser import HTMLParser
import json
import os
from pathlib import Path, PurePosixPath
import re
import tempfile
from urllib.parse import quote

from model import decision_analysis as decision

EDITION_KIND = "economic-editions"
DRAFT_KIND = "economic-drafts"
EDITION_SCHEMA = "upstate.economic-edition/v1"
DRAFT_SCHEMA = "upstate.economic-draft/v1"
SOURCE_KIND = "scenario-decisions"
ACTIONS = {"economic.edition.build", "economic.draft.save"}
_ID = re.compile(r"^[0-9a-f]{64}$")


def _id(value):
    if not isinstance(value, str) or not _ID.fullmatch(value):
        raise ValueError("Choose an existing native report, saved draft or economic edition.")
    return value


def _canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), allow_nan=False).encode("utf-8")


def _sha(path):
    result = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


def _within(root, *parts):
    root = Path(root).resolve()
    value = root.joinpath(*parts).resolve()
    if not value.is_relative_to(root):
        raise ValueError("The retained economic item leaves its original workspace.")
    return value


def _member(root, name):
    if (not isinstance(name, str) or "\\" in name or "\0" in name
            or not name or any(part in {"", ".", ".."} for part in name.split("/"))
            or PurePosixPath(name).is_absolute()):
        raise ValueError("A retained edition needs a canonical relative member path.")
    return _within(root, *PurePosixPath(name).parts)


def _descriptor(path, root):
    return {"path": path.relative_to(root).as_posix(),
            "bytes": path.stat().st_size, "sha256": _sha(path)}


def _checked(root, descriptor):
    if not isinstance(descriptor, dict):
        raise ValueError("A retained output needs its original file descriptor.")
    path = _member(root, descriptor["path"])
    if (path.stat().st_size != descriptor["bytes"]
            or _sha(path) != _id(descriptor["sha256"])):
        raise ValueError("A retained economic output changed: " + descriptor["path"])
    return path


def _save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    body = _canonical(value) + b"\n"
    handle, temporary = tempfile.mkstemp(prefix="." + path.name + "-", dir=path.parent)
    try:
        with os.fdopen(handle, "wb") as stream:
            stream.write(body)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def _now():
    return datetime.now(timezone.utc).isoformat()


class _Scripts(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.executables = []
        self.active = None

    def handle_starttag(self, tag, attrs):
        if tag.lower() != "script":
            return
        attributes = dict(attrs)
        if "src" in attributes:
            raise ValueError("The retained decision desk must contain its authored offline script.")
        kind = (attributes.get("type") or "").lower()
        self.active = [] if kind in {"", "text/javascript", "application/javascript", "module"} else None

    def handle_data(self, data):
        if self.active is not None:
            self.active.append(data)

    def handle_endtag(self, tag):
        if tag.lower() == "script" and self.active is not None:
            self.executables.append("".join(self.active))
            self.active = None


def _scripts(text):
    parser = _Scripts()
    parser.feed(text)
    parser.close()
    return parser.executables


def _desk_policy(path):
    authored = Path(decision.__file__).with_name("decision_desk.html").read_text(encoding="utf-8")
    expected = _scripts(authored)
    actual = _scripts(path.read_text(encoding="utf-8"))
    if not expected or actual != expected:
        raise ValueError("This retained desk uses a different authored viewer. Download its complete edition or install its companion source.")
    hashes = ["'sha256-" + base64.b64encode(hashlib.sha256(script.encode("utf-8")).digest()).decode("ascii") + "'"
              for script in expected]
    return ("default-src 'none'; script-src " + " ".join(hashes)
            + "; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none';"
              " object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self';"
              " sandbox allow-scripts allow-downloads allow-modals")


class EconomicWorkbench:
    """Explicit registry provider; all paths derive from registered workspaces."""

    def __init__(self, operator, fault):
        self.operator = operator
        self.fault = fault

    def _source(self, workspace, report_id):
        report_id = _id(report_id)
        root = _within(workspace.root, SOURCE_KIND, report_id)
        path = root / "decision.json"
        if not path.is_file():
            path = root / "report.json"
        inspected = decision.inspect_scenario_report(path)
        if inspected["producer_report_id"] != report_id:
            raise ValueError("The selected native report directory has another source identity.")
        # The adapter resolves and verifies the original full report descriptor.
        actual = _within(root, Path(inspected["source"]["path"]).relative_to(root))
        if not actual.is_file():
            raise ValueError("The original full native report is unavailable.")
        return path, inspected

    def _input(self, workspace, payload):
        if not isinstance(payload, dict):
            raise ValueError("Submit the original native report, zone and decision selection.")
        path, inspected = self._source(workspace, payload.get("report_id"))
        expected = _id(payload.get("report_sha256"))
        if inspected["source"]["sha256"] != expected:
            raise ValueError("The native report changed after this selection. Refresh its zones and costs.")
        zone_id = payload.get("zone_id")
        zone = next((item for item in inspected["zones"] if item["zone_id"] == zone_id), None)
        if zone is None:
            raise ValueError("Choose one of this native report's retained reporting zones.")
        selection = deepcopy(payload.get("selection"))
        if not isinstance(selection, dict):
            raise ValueError("Enter the decision title and selection for this zone.")
        if selection.get("comparison_id") != zone["comparison_id"]:
            raise ValueError("The decision selection belongs to another native report or zone.")
        if selection.get("sensitivity_comparison_ids"):
            raise ValueError("This selected-zone desk uses this report's actual cohort. Use the completed profile-paired workflow for a sensitivity ensemble.")
        for cost in selection.get("costs", []):
            scope = cost.get("scope")
            if scope is None:
                continue
            if not isinstance(scope, dict) or scope.get("kind") not in {"whole_scenario", "reporting_zone", "retained"}:
                raise ValueError("A supplied cost footprint needs its original scope kind.")
            if scope["kind"] in {"reporting_zone", "retained"}:
                if (scope.get("zone_id") != zone_id
                        or scope.get("producer_report_id") != inspected["producer_report_id"]):
                    raise ValueError("A zone-specific or unspecified retained cost belongs to another source zone. Review that implementation estimate before including it here.")
        packet = decision.scenario_report_packet(path, zone_id)
        report = decision.analyze_packet(packet, selection)
        retained = {
            "report_id": inspected["producer_report_id"],
            "report_sha256": inspected["source"]["sha256"],
            "zone_id": zone_id, "selection": selection,
        }
        return retained, inspected, packet, report

    def _editions(self, workspace):
        rows, issues = [], []
        root = _within(workspace.root, EDITION_KIND)
        if root.is_dir():
            for path in root.glob("*/edition.json"):
                try:
                    record = decision.read_json(_member(root, path.relative_to(root).as_posix()))
                    if record.get("schema") != EDITION_SCHEMA or _id(record["id"]) != path.parent.name:
                        raise ValueError("The retained economic edition identity is invalid.")
                    rows.append({key: record.get(key) for key in (
                        "id", "title", "created_at", "producer_report_id", "zone_id",
                        "zone_title", "report_id", "modeled_metrics", "candidate_count",
                        "eligible_count", "costed_count")})
                except (OSError, ValueError, KeyError, TypeError) as error:
                    issues.append({"id": path.parent.name, "kind": EDITION_KIND, "message": str(error)})
        rows.sort(key=lambda row: (row.get("created_at") or "", row["id"]), reverse=True)
        return rows, issues

    def _drafts(self, workspace):
        rows, issues = [], []
        root = _within(workspace.root, DRAFT_KIND)
        if root.is_dir():
            for path in root.glob("*.json"):
                try:
                    record = decision.read_json(_member(root, path.relative_to(root).as_posix()))
                    if record.get("schema") != DRAFT_SCHEMA or _id(record["id"]) != path.stem:
                        raise ValueError("The saved economic draft identity is invalid.")
                    rows.append({key: record.get(key) for key in (
                        "id", "title", "created_at", "producer_report_id", "zone_id",
                        "zone_title", "costed_count")})
                except (OSError, ValueError, KeyError, TypeError) as error:
                    issues.append({"id": path.stem, "kind": DRAFT_KIND, "message": str(error)})
        rows.sort(key=lambda row: (row.get("created_at") or "", row["id"]), reverse=True)
        return rows, issues

    def overview(self, workspace_key):
        workspace = self.operator.ws(workspace_key)
        editions, edition_issues = self._editions(workspace)
        drafts, draft_issues = self._drafts(workspace)
        return {"editions": editions, "drafts": drafts, "issues": edition_issues + draft_issues}

    def _catalog(self, workspace_key):
        workspace = self.operator.ws(workspace_key)
        reports, issues = [], []
        root = _within(workspace.root, SOURCE_KIND)
        if root.is_dir():
            for directory in root.iterdir():
                if not directory.is_dir() or not _ID.fullmatch(directory.name):
                    continue
                try:
                    _, value = self._source(workspace, directory.name)
                    reports.append({
                        "id": value["producer_report_id"], "title": value["title"],
                        "report_sha256": value["source"]["sha256"],
                        "baseline_run_id": value["baseline_run_id"],
                        "pollutants": value["pollutants"],
                        "alternative_count": len(value["alternatives"]),
                        "zone_count": len(value["zones"]),
                        "ready_zones": sum(bool(zone["common_support_available"]) for zone in value["zones"]),
                    })
                except (OSError, ValueError, KeyError, TypeError) as error:
                    issues.append({"id": directory.name, "kind": SOURCE_KIND, "message": str(error)})
        reports.sort(key=lambda row: (row["title"].casefold(), row["id"]))
        return {"schema": "upstate.economic-catalog/v1", "workspace_key": workspace_key,
                "reports": reports, "source_issues": issues, **self.overview(workspace_key)}

    def _edition(self, workspace, key, *, full=False):
        key = _id(key)
        root = _within(workspace.root, EDITION_KIND, key)
        record = decision.read_json(root / "edition.json")
        if record.get("schema") != EDITION_SCHEMA or record.get("id") != key:
            raise ValueError("The saved economic edition does not match its retained identity.")
        identity = {"input": record["input"], "implementation": record["implementation"]}
        if hashlib.sha256(_canonical(identity)).hexdigest() != key:
            raise ValueError("The saved economic edition differs from its input and implementation identity.")
        manifest_path = _checked(root, record["files"]["manifest"])
        manifest = decision.read_json(manifest_path)
        if manifest.get("schema") != "upstate.decision-delivery/v1" or manifest.get("report_id") != record["report_id"]:
            raise ValueError("The economic edition manifest belongs to another report.")
        members = manifest.get("members")
        if not isinstance(members, list):
            raise ValueError("The economic edition needs its original member manifest.")
        by_path = {item["path"]: item for item in members}
        if len(by_path) != len(members):
            raise ValueError("The edition repeats a retained member path.")
        required = {"index.html", "report.json", "selection.json", "physical-input.json",
                    "source-inputs/scenario-report.json", "application/decision_desk.html"}
        if not required <= set(by_path):
            raise ValueError("The economic edition is missing its original report or source companions.")
        chosen = members if full else [by_path[name] for name in required]
        for descriptor in chosen:
            _checked(root, descriptor)
        report = decision.read_json(root / "report.json")
        if (report.get("schema") != decision.REPORT_SCHEMA or report.get("id") != record["report_id"]
                or report.get("selection") != record["input"]["selection"]):
            raise ValueError("The saved report differs from its original economic selection.")
        if record["input"]["report_sha256"] != report["physical_source"]["source"]["sha256"]:
            raise ValueError("The saved decision names another native source report.")
        if full:
            for descriptor in record["files"].values():
                _checked(root, descriptor)
        return root, record, report

    def _with_files(self, workspace_key, record, root):
        result = deepcopy(record)
        result["_downloads"] = [
            self.operator._ticket(workspace_key, _checked(root, body), body, label.replace("_", " ").title())
            for label, body in record["files"].items()
        ]
        result["open_url"] = "/api/file/economic-desk/" + quote(workspace_key, safe="") + "/" + record["id"]
        return result

    def preview(self, workspace_key, edition_id):
        """Typed ECSA file binding: return the original ticket and authored policy."""
        workspace = self.operator.ws(workspace_key)
        root, record, _ = self._edition(workspace, edition_id)
        path = _checked(root, record["files"]["desk"])
        return (self.operator._ticket(workspace_key, path, record["files"]["desk"], record["title"]),
                _desk_policy(path))

    def read(self, workspace_key, operation, payload):
        workspace = self.operator.ws(workspace_key)
        if operation == "catalog":
            return self._catalog(workspace_key)
        if operation == "source":
            _, result = self._source(workspace, payload.get("report_id"))
            return {"workspace_key": workspace_key, **result}
        if operation == "preview":
            _, _, _, report = self._input(workspace, payload)
            return {"workspace_key": workspace_key, "report": report}
        if operation == "draft":
            key = _id(payload.get("draft_id") or payload.get("id"))
            result = decision.read_json(_within(workspace.root, DRAFT_KIND, key + ".json"))
            if result.get("schema") != DRAFT_SCHEMA or result.get("id") != key:
                raise ValueError("The saved economic draft has another identity.")
            return {"workspace_key": workspace_key, **result}
        if operation in {"edition", "open"}:
            root, record, report = self._edition(workspace, payload.get("edition_id") or payload.get("id"))
            if operation == "open":
                path = _checked(root, record["files"]["desk"])
                return {"ticket": self.operator._ticket(workspace_key, path, record["files"]["desk"], record["title"]),
                        "content_security_policy": _desk_policy(path)}
            return {"workspace_key": workspace_key, **self._with_files(workspace_key, record, root),
                    "report": report}
        raise ValueError("Choose a registered economic desk operation.")

    def invoke(self, task):
        if task["action"] not in ACTIONS:
            raise ValueError("Choose a supported economic desk action.")
        workspace_key = task["workspace"]
        workspace = self.operator.ws(workspace_key)
        retained, inspected, packet, report = self._input(workspace, task["payload"])
        zone = next(item for item in inspected["zones"] if item["zone_id"] == retained["zone_id"])
        if task["action"] == "economic.draft.save":
            key = hashlib.sha256(_canonical(retained)).hexdigest()
            path = _within(workspace.root, DRAFT_KIND, key + ".json")
            if path.is_file():
                return decision.read_json(path)
            value = {"schema": DRAFT_SCHEMA, "id": key, "created_at": _now(),
                     "title": report["title"], "producer_report_id": retained["report_id"],
                     "zone_id": zone["zone_id"], "zone_title": zone["title"],
                     "costed_count": len(retained["selection"].get("costs", [])),
                     "input": retained}
            _save(path, value)
            return value
        implementation = {
            "decision_analysis_sha256": _sha(Path(decision.__file__)),
            "decision_desk_sha256": _sha(Path(decision.__file__).with_name("decision_desk.html")),
            "economic_workbench_sha256": _sha(Path(__file__)),
        }
        key = hashlib.sha256(_canonical({"input": retained, "implementation": implementation})).hexdigest()
        destination = _within(workspace.root, EDITION_KIND, key)
        record_path = destination / "edition.json"
        if record_path.is_file():
            root, record, _ = self._edition(workspace, key, full=True)
            return self._with_files(workspace_key, record, root)
        if not destination.exists():
            decision.export_report(report, destination, input_packet=packet)
        else:
            # Complete export can survive an interruption before edition.json.
            # Recover only this exact selected input and authored implementation.
            previous = decision.read_json(destination / "report.json")
            if (previous.get("id") != report["id"] or previous.get("selection") != retained["selection"]
                    or _sha(destination / "application" / "decision_analysis.py") != implementation["decision_analysis_sha256"]
                    or _sha(destination / "application" / "decision_desk.html") != implementation["decision_desk_sha256"]):
                raise ValueError("This retained output differs from the original queued edition.")
            report = previous
        names = {
            "desk": "index.html", "complete_package": "decision-package.zip",
            "report": "report.json", "selection": "selection.json", "manifest": "manifest.json",
            "alternatives": "alternatives.csv", "costs": "costs.csv",
            "sensitivity": "sensitivity.csv", "original_native_report": "source-inputs/scenario-report.json",
        }
        record = {
            "schema": EDITION_SCHEMA, "id": key, "created_at": report["created_at"],
            "title": report["title"], "producer_report_id": retained["report_id"],
            "zone_id": zone["zone_id"], "zone_title": zone["title"], "report_id": report["id"],
            "modeled_metrics": list(report["baseline"]["outputs"]),
            "candidate_count": len(report["alternatives"]),
            "eligible_count": len(report["frontier"]["eligible_ids"]),
            "costed_count": sum(item.get("cost") is not None for item in report["alternatives"]),
            "input": retained, "implementation": implementation,
            "files": {name: _descriptor(destination / filename, destination) for name, filename in names.items()},
        }
        _save(record_path, record)
        self._edition(workspace, key, full=True)
        return self._with_files(workspace_key, record, destination)

    def decorate_task(self, task):
        if task.get("state") != "complete":
            return task
        workspace_key = task["workspace"]
        workspace = self.operator.ws(workspace_key)
        if task.get("action") == "economic.edition.build":
            root, record, _ = self._edition(workspace, task["result"]["id"])
            value = self._with_files(workspace_key, record, root)
            task["_downloads"] = value["_downloads"]
            task["result"]["open_url"] = value["open_url"]
        elif task.get("action") == "economic.draft.save":
            path = _within(workspace.root, DRAFT_KIND, _id(task["result"]["id"]) + ".json")
            task["_downloads"] = [self.operator._ticket(
                workspace_key, path, _descriptor(path, path.parent), "Saved economic input and cost sources")]
        return task

    def verify_workspace(self, workspace):
        editions, issues = self._editions(workspace)
        drafts, draft_issues = self._drafts(workspace)
        if issues or draft_issues:
            raise ValueError((issues + draft_issues)[0]["message"])
        for row in editions:
            self._edition(workspace, row["id"], full=True)
        for row in drafts:
            value = decision.read_json(_within(workspace.root, DRAFT_KIND, row["id"] + ".json"))
            if hashlib.sha256(_canonical(value["input"])).hexdigest() != row["id"]:
                raise ValueError("A saved economic input differs from its retained identity.")
        return {"editions": len(editions), "drafts": len(drafts)}
