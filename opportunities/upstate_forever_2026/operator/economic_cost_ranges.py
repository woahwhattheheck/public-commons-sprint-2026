"""Sourced cost ranges over immutable existing Economic editions.

The existing Operator task queue owns requests; no native model is run here.
Copyright (c) 2026 TokenJunkie Labs. MIT License.
"""
from __future__ import annotations
from copy import deepcopy
import hashlib
import os
from pathlib import Path
import tempfile
from urllib.parse import quote
import zipfile
import economic_workbench as economic
from economic_comparison import _inside, _checked, _copy, _id, require, POLICY
from model.common import atomic_bytes, atomic_json, digest, held, read_json
from model import economic_cost_ranges as model

ACTION = "economic.cost-ranges.build"
ROOT = "economic-cost-ranges"
SCHEMA = "upstate.economic-cost-ranges-record/v1"
INTENT = "upstate.economic-cost-ranges-intent/v1"
PACKAGE = "upstate.economic-cost-ranges-package/v1"
SOURCE_FILES = (
    "model/economic_cost_ranges.py",
    "model/decision_analysis.py",
    "operator/web/economic_quantity_estimate.mjs",
    "operator/web/economic_request_store.mjs",
    "operator/economic_cost_ranges.py",
    "operator/economic_cost_ranges_cli.py",
    "operator/web/economic_cost_ranges.mjs",
    "operator/web/economic_cost_ranges.css",
    "operator/extensions/economic-cost-ranges.json",
    "operator/ECONOMIC_COST_RANGES.md",
    "source_tools/economic_cost_ranges_original_course.py",
    "source_tools/economic_cost_ranges_browser.mjs",
    "operator/ECONOMIC_COST_RANGES_RECEIVING.md",
    "integration/component_fragments/economic-cost-ranges.json",
    "install_economic_cost_ranges.py",
)
def sha(body):
    return hashlib.sha256(body).hexdigest()

class EconomicCostRanges:
    def __init__(self, operator, fault):
        self.operator, self.fault = operator, fault
        self.economic = economic.EconomicWorkbench(operator, fault)

    def source(self, workspace_key, ident):
        ws = self.operator.ws(workspace_key)
        root, edition, report = self.economic._edition(ws, _id(ident), full=True)
        packet = read_json(_inside(root, "physical-input.json"))
        require(packet.get("project") == report.get("project")
                and report.get("project", {}).get("id") == ws.project["id"],
                "Choose an Economic edition from the original project.")
        descriptor = economic._descriptor(root / "edition.json", root)
        value = {"edition": deepcopy(edition), "report": deepcopy(report),
                 "packet": packet, "edition_sha256": descriptor["sha256"]}
        return root, value

    def _prepare(self, workspace_key, definition):
        require(isinstance(definition, dict), "Enter a complete sourced cost-range definition.")
        source_root, source = self.source(workspace_key, definition.get("edition_id"))
        require(definition.get("edition_sha256") == source["edition_sha256"],
                "The original Economic edition differs from the selected source bytes.")
        result = model.analyze(source, definition)
        html, csv = model.render_html(result), model.csv_text(result)
        app = Path(__file__).resolve().parent.parent
        authored = {name: _inside(app, *name.split("/")).read_text(encoding="utf-8")
                    for name in SOURCE_FILES}
        names = {"original-edition.json": "edition.json",
                 "original-report.json": source["edition"]["files"]["report"]["path"],
                 "physical-input.json": "physical-input.json",
                 "original-economic-package.zip": source["edition"]["files"]["complete_package"]["path"]}
        sources = {name: {"edition_id": source["edition"]["id"],
                         "descriptor": economic._descriptor(_inside(source_root, *path.split("/")), source_root)}
                   for name, path in names.items()}
        identity = {"schema": "upstate.economic-cost-ranges-identity/v1",
                    "definition": deepcopy(definition), "source": sources,
                    "producer": {name: sha(body.encode("utf-8")) for name, body in authored.items()},
                    "result_sha256": digest(result), "html_sha256": sha(html.encode("utf-8")),
                    "csv_sha256": sha(csv.encode("utf-8"))}
        key = digest(identity)
        return {"schema": INTENT, "id": key, "identity": identity,
                "definition": deepcopy(definition), "result": result,
                "html": html, "csv": csv, "sources": sources, "authored": authored,
                "created_at": economic._now()}

    def _root(self, workspace, ident):
        return _inside(workspace.root, ROOT, _id(ident))

    def _intent(self, root, ident):
        value = read_json(_inside(root, "intent.json"))
        require(value.get("schema") == INTENT and value.get("id") == ident
                and digest(value["identity"]) == ident
                and value["definition"] == value["identity"]["definition"]
                and value["sources"] == value["identity"]["source"],
                "The retained cost-range request has another original identity.")
        require(digest(value["result"]) == value["identity"]["result_sha256"]
                and sha(value["html"].encode("utf-8")) == value["identity"]["html_sha256"]
                and sha(value["csv"].encode("utf-8")) == value["identity"]["csv_sha256"],
                "The retained cost-range result or report changed.")
        require(set(value["authored"]) == set(value["identity"]["producer"]),
                "Retain every original cost-range producer source.")
        for name, body in value["authored"].items():
            require(sha(body.encode("utf-8")) == value["identity"]["producer"][name],
                    "The retained cost-range producer changed.")
        return value

    def _inspect(self, workspace, ident, *, full=True):
        root = self._root(workspace, ident)
        record = read_json(_inside(root, "record.json"))
        require(record.get("schema") == SCHEMA and record.get("id") == ident
                and digest(record["identity"]) == ident
                and record["definition"] == record["identity"]["definition"],
                "The saved cost-range result differs from its original selection.")
        files = record.get("files")
        require(isinstance(files, list) and len({f["path"] for f in files}) == len(files),
                "The saved range result needs distinct original files.")
        by_path = {f["path"]: f for f in files}
        require({"index.html", "result.json", "definition.json", "scenarios.csv",
                 "manifest.json", "cost-ranges-package.zip",
                 "original-economic-package.zip"} <= set(by_path),
                "The saved cost-range package is incomplete.")
        manifest = read_json(_checked(root, by_path["manifest.json"]))
        require(manifest.get("schema") == PACKAGE and manifest.get("id") == ident
                and manifest.get("identity") == record["identity"],
                "The cost-range manifest belongs to another original result.")
        members = manifest.get("members")
        require(isinstance(members, list) and len({f["path"] for f in members}) == len(members),
                "The cost-range manifest needs all distinct original members.")
        result = read_json(_checked(root, by_path["result.json"]))
        require(digest(result) == record["identity"]["result_sha256"]
                and by_path["index.html"]["sha256"] == record["identity"]["html_sha256"]
                and by_path["scenarios.csv"]["sha256"] == record["identity"]["csv_sha256"],
                "The saved cost-range report differs from its retained result.")
        definition = read_json(_checked(root, by_path["definition.json"]))
        require(definition == record["definition"], "The saved authored ranges changed.")
        if full:
            for descriptor in members + files:
                _checked(root, descriptor)
        return root, record, result

    def _decorate(self, workspace_key, root, record, result):
        return {**deepcopy(record), "workspace_key": workspace_key, "result": deepcopy(result),
                "open_url": "/api/file/economic-cost-ranges/" + quote(workspace_key, safe="")
                            + "/" + record["id"] + "/index.html",
                "_downloads": [self.operator._ticket(workspace_key, _checked(root, item), item,
                                                      item.get("label") or item["path"])
                               for item in record["files"]]}

    def catalog(self, workspace_key):
        ws = self.operator.ws(workspace_key)
        editions, issues = self.economic._editions(ws)
        rows = []
        root = _inside(ws.root, ROOT)
        if root.is_dir():
            for path in root.iterdir():
                if not path.is_dir() or not (path / "record.json").is_file():
                    continue
                try:
                    _, record, _ = self._inspect(ws, _id(path.name), full=False)
                    rows.append({key: deepcopy(record[key]) for key in
                                 ("id", "title", "created_at", "edition_id")})
                except (OSError, ValueError, TypeError, KeyError) as error:
                    issues.append({"id": path.name, "kind": ROOT, "message": str(error)})
        rows.sort(key=lambda row: (row["created_at"], row["id"]), reverse=True)
        return {"schema": "upstate.economic-cost-ranges-catalog/v1",
                "workspace_key": workspace_key, "project": deepcopy(ws.project),
                "editions": editions, "ranges": rows, "issues": issues}

    def request(self, workspace_key, operation_id):
        import re
        self.operator.ws(workspace_key)
        require(isinstance(operation_id, str) and re.fullmatch(r"[A-Za-z0-9_-]{16,100}", operation_id),
                "Choose the original operation ID.")
        key = digest({"workspace": workspace_key, "operation_id": operation_id})
        original = _inside(self.operator.root, "tasks", key + ".json")
        alias_path = _inside(self.operator.root, "task-operation-aliases", key + ".json")
        alias = None
        if alias_path.exists():
            alias = read_json(alias_path)
            require(not original.exists() and alias.get("schema") == "upstate.operator-operation-alias/v1"
                    and alias.get("workspace") == workspace_key and alias.get("operation_id") == operation_id,
                    "The original task alias differs from its Workspace or operation.")
            key = _id(alias.get("task_id"))
        elif not original.exists():
            return {"workspace_key": workspace_key, "operation_id": operation_id, "found": False}
        task = self.operator.task_view(key)
        require(task.get("id") == key and task.get("workspace") == workspace_key
                and task.get("action") == ACTION
                and digest({"workspace": workspace_key, "action": ACTION, "payload": task["payload"]})
                    == task.get("request_sha256"),
                "The original task differs from its native request digest.")
        if alias is not None:
            require(alias.get("request_sha256") == task["request_sha256"],
                    "The original operation alias names another request.")
        else:
            require(task.get("operation_id") == operation_id, "The original task belongs to another operation.")
        return {"workspace_key": workspace_key, "operation_id": operation_id, "found": True,
                "native_request_sha256": task["request_sha256"], "task": task}

    def read(self, workspace_key, operation, payload):
        if operation == "request":
            return self.request(workspace_key, payload.get("operation_id"))
        if operation == "catalog":
            return self.catalog(workspace_key)
        if operation == "source":
            _, source = self.source(workspace_key, payload.get("id") or payload.get("edition_id"))
            return {"workspace_key": workspace_key, "source": source, "definition": model.template(source)}
        if operation == "preview":
            intent = self._prepare(workspace_key, payload.get("definition"))
            return {"workspace_key": workspace_key, "preview_sha256": intent["id"],
                    "definition": intent["definition"], "result": intent["result"], "report_html": intent["html"]}
        if operation == "detail":
            ws = self.operator.ws(workspace_key)
            root, record, result = self._inspect(ws, _id(payload.get("id")))
            return self._decorate(workspace_key, root, record, result)
        raise ValueError("Choose an original sourced cost-range operation.")

    def invoke(self, task):
        require(task["action"] == ACTION, "Use the original cost-range build action.")
        key = _id(task["payload"].get("expected_preview_sha256"))
        definition = task["payload"].get("definition")
        require(isinstance(definition, dict), "Retain the exact authored range definition.")
        ws = self.operator.ws(task["workspace"])
        root = self._root(ws, key)
        with held(_inside(ws.root, ROOT, ".locks", key + ".lock")):
            if (root / "record.json").is_file():
                _, record, result = self._inspect(ws, key)
                require(record["definition"] == definition,
                        "The original request belongs to another range definition.")
                return self._decorate(task["workspace"], root, record, result)
            if (root / "intent.json").is_file():
                intent = self._intent(root, key)
                require(intent["definition"] == definition,
                        "The retained original request has another range definition.")
            else:
                intent = self._prepare(task["workspace"], definition)
                require(intent["id"] == key, "Source or calculation changed after preview. Preview the retained original selection again.")
                root.mkdir(parents=True, exist_ok=True)
                atomic_json(_inside(root, "intent.json"), intent, immutable=True)
            for name, original in intent["sources"].items():
                source_root = _inside(ws.root, economic.EDITION_KIND, _id(original["edition_id"]))
                source = _checked(source_root, original["descriptor"])
                _copy(source, _inside(root, name), original["descriptor"])
            atomic_json(_inside(root, "result.json"), intent["result"], immutable=True)
            atomic_json(_inside(root, "definition.json"), intent["definition"], immutable=True)
            atomic_bytes(_inside(root, "index.html"), intent["html"].encode("utf-8"), immutable=True)
            atomic_bytes(_inside(root, "scenarios.csv"), intent["csv"].encode("utf-8"), immutable=True)
            for name, body in intent["authored"].items():
                atomic_bytes(_inside(root, "application", *name.split("/")), body.encode("utf-8"), immutable=True)
            names = set(intent["sources"]) | {"result.json", "definition.json", "index.html", "scenarios.csv"}
            names |= {"application/" + name for name in intent["authored"]}
            members = [economic._descriptor(_inside(root, *name.split("/")), root) for name in sorted(names)]
            manifest = {"schema": PACKAGE, "id": key, "identity": intent["identity"],
                        "members": members, "created_at": intent["created_at"]}
            atomic_json(_inside(root, "manifest.json"), manifest, immutable=True)
            package = _inside(root, "cost-ranges-package.zip")
            expected = {item["path"]: item for item in members}
            expected["manifest.json"] = economic._descriptor(root / "manifest.json", root)
            if not package.exists():
                fd, temporary = tempfile.mkstemp(prefix=".cost-ranges-", suffix=".zip", dir=root)
                os.close(fd)
                try:
                    with zipfile.ZipFile(temporary, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
                        for name in sorted(expected):
                            info = zipfile.ZipInfo(name, (2020, 1, 1, 0, 0, 0))
                            info.compress_type = zipfile.ZIP_DEFLATED
                            with archive.open(info, "w") as outgoing, _checked(root, expected[name]).open("rb") as incoming:
                                for block in iter(lambda: incoming.read(1024 * 1024), b""):
                                    outgoing.write(block)
                    with open(temporary, "rb") as stream:
                        os.fsync(stream.fileno())
                    os.replace(temporary, package)
                finally:
                    if os.path.exists(temporary):
                        os.unlink(temporary)
            with zipfile.ZipFile(package) as archive:
                infos = archive.infolist()
                require(len(infos) == len(expected) and {x.filename for x in infos} == set(expected),
                        "The retained package contains different original members.")
                for info in infos:
                    checksum, size = hashlib.sha256(), 0
                    with archive.open(info) as stream:
                        for block in iter(lambda: stream.read(1024 * 1024), b""):
                            checksum.update(block)
                            size += len(block)
                    require(size == expected[info.filename]["bytes"] and checksum.hexdigest() == expected[info.filename]["sha256"],
                            "The retained package member changed: " + info.filename)
            labels = {"index.html": "Readable sourced cost-range comparison",
                      "original-edition.json": "Exact original Economic edition",
                      "original-report.json": "Exact original Economic report",
                      "physical-input.json": "Original complete physical-results packet",
                      "result.json": "Complete calculation and physical source",
                      "definition.json": "Editable sourced range inputs",
                      "scenarios.csv": "Complete scenario range table",
                      "manifest.json": "Complete source manifest",
                      "original-economic-package.zip": "Original complete Economic edition",
                      "cost-ranges-package.zip": "Complete cost ranges, original edition and source"}
            record = {"schema": SCHEMA, "id": key, "title": definition["title"],
                      "edition_id": definition["edition_id"], "definition": deepcopy(definition),
                      "identity": intent["identity"], "created_at": intent["created_at"],
                      "files": [{**economic._descriptor(root / name, root), "label": label}
                                for name, label in labels.items()]}
            atomic_json(_inside(root, "record.json"), record, immutable=True)
            _, record, result = self._inspect(ws, key)
            return self._decorate(task["workspace"], root, record, result)

    def preview_file(self, workspace_key, range_id, member):
        require(isinstance(member, str) and "/" not in member and "\\" not in member,
                "Choose a retained published range file.")
        ws = self.operator.ws(workspace_key)
        root, record, _ = self._inspect(ws, _id(range_id), full=False)
        item = next((x for x in record["files"] if x["path"] == member), None)
        require(item is not None, "Choose a complete published original file.")
        return self.operator._ticket(workspace_key, _checked(root, item), item, item.get("label", member)), POLICY

    def decorate_task(self, task):
        if task.get("action") == ACTION and task.get("state") == "complete":
            result = self.read(task["workspace"], "detail", {"id": task["result"]["id"]})
            task["result"], task["_downloads"] = result, result["_downloads"]
        return task

    def verify_workspace(self, workspace):
        completed, pending = 0, 0
        root = _inside(workspace.root, ROOT)
        if root.is_dir():
            for path in root.iterdir():
                if not path.is_dir() or path.name.startswith("."):
                    continue
                if (path / "record.json").is_file():
                    self._inspect(workspace, _id(path.name))
                    completed += 1
                elif (path / "intent.json").is_file():
                    self._intent(path, _id(path.name))
                    pending += 1
        return {"completed_cost_ranges": completed, "retained_pending_cost_ranges": pending}
