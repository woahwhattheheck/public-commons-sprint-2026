"""Retain before/after comparisons of complete original Economic editions."""
from __future__ import annotations

from copy import deepcopy
import hashlib
import os
from pathlib import Path
import re
import stat
import tempfile
from urllib.parse import quote
import zipfile

import economic_workbench as economic
from model.common import atomic_bytes, atomic_json, canonical, digest, held, read_json
from model.economic_comparison import compare_editions, csv_text
from model.economic_comparison_render import render_comparison

ACTION = "economic.comparison.build"
SCHEMA = "upstate.economic-comparison-result/v1"
INTENT_SCHEMA = "upstate.economic-comparison-intent/v1"
MANIFEST_SCHEMA = "upstate.economic-comparison-package/v1"
ROOT = "economic-comparisons"
HEX = re.compile(r"^[0-9a-f]{64}$")
MEMBER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*$")
POLICY = ("default-src 'none'; style-src 'unsafe-inline'; img-src data:; "
          "connect-src 'none'; object-src 'none'; base-uri 'none'; "
          "form-action 'none'; frame-ancestors 'self'; sandbox allow-downloads")


def require(condition, message):
    if not condition:
        raise ValueError(message)


def _id(value):
    require(isinstance(value, str) and HEX.fullmatch(value), "Choose an original complete saved Economic identity.")
    return value


def _inside(root, *parts):
    root = Path(root).resolve()
    path = root.joinpath(*parts)
    require(path.resolve().is_relative_to(root), "Comparison files must stay in their original Workspace.")
    cursor = root
    for part in path.relative_to(root).parts:
        cursor /= part
        require(not cursor.is_symlink(), "Retained comparison files must use ordinary source paths.")
    return path


def _checked(root, item):
    name = item.get("path")
    require(isinstance(name, str) and "\\" not in name and "\0" not in name
            and all(part not in {"", ".", ".."} for part in name.split("/"))
            and not name.startswith("/"), "Retain a canonical comparison member path.")
    path = _inside(root, *name.split("/"))
    require(path.is_file() and path.stat().st_size == item["bytes"]
            and economic._sha(path) == _id(item["sha256"]),
            "A retained comparison member changed: " + name)
    return path


def _copy(source, target, descriptor):
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        require(target.is_file() and not target.is_symlink()
                and target.stat().st_size == descriptor["bytes"]
                and economic._sha(target) == descriptor["sha256"],
                "The retained original copy differs: " + target.name)
        return
    handle, name = tempfile.mkstemp(prefix="." + target.name + "-", dir=target.parent)
    checksum, size = hashlib.sha256(), 0
    try:
        with os.fdopen(handle, "wb") as outgoing:
            source_before = source.lstat()
            require(stat.S_ISREG(source_before.st_mode), "The original Economic source must be an ordinary file.")
            fd = os.open(source, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
            with os.fdopen(fd, "rb") as incoming:
                before = os.fstat(incoming.fileno())
                require(stat.S_ISREG(before.st_mode)
                        and (source_before.st_dev, source_before.st_ino, source_before.st_size, source_before.st_mtime_ns)
                        == (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns),
                        "The original Economic source changed before opening.")
                for body in iter(lambda: incoming.read(1024 * 1024), b""):
                    checksum.update(body)
                    size += len(body)
                    outgoing.write(body)
                after = os.fstat(incoming.fileno())
                require((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns)
                        == (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns),
                        "The original Economic file changed while copying.")
            outgoing.flush()
            os.fsync(outgoing.fileno())
        require(size == descriptor["bytes"] and checksum.hexdigest() == descriptor["sha256"],
                "The original Economic file differs from the frozen comparison descriptor.")
        os.replace(name, target)
    finally:
        if os.path.exists(name):
            os.unlink(name)


class EconomicComparison:
    def __init__(self, operator, fault):
        self.operator, self.fault = operator, fault
        self.economic = economic.EconomicWorkbench(operator, fault)

    def _input(self, payload):
        require(isinstance(payload, dict), "Choose two saved Economic editions.")
        first, second = _id(payload.get("first_edition_id")), _id(payload.get("second_edition_id"))
        require(first != second, "Choose two different saved Economic editions.")
        title = payload.get("title")
        require(title is None or isinstance(title, str) and bool(title.strip()) and len(title) <= 500,
                "Give the comparison a nonblank title within 500 characters.")
        return {"first_edition_id": first, "second_edition_id": second, "title": title.strip() if title else None}

    def _prepare(self, workspace_key, payload):
        selected = self._input(payload)
        ws = self.operator.ws(workspace_key)
        first_root, first_record, first_report = self.economic._edition(ws, selected["first_edition_id"])
        second_root, second_record, second_report = self.economic._edition(ws, selected["second_edition_id"])
        first, second = ({**deepcopy(record), "report": deepcopy(report)}
                         for record, report in ((first_record, first_report), (second_record, second_report)))
        comparison = compare_editions(first, second, title=selected["title"])
        selected["title"] = comparison["title"]
        model_path = Path(__file__).resolve().parent.parent / "model"
        authored = {name: (model_path / name).read_text(encoding="utf-8")
                    for name in ("economic_comparison.py", "economic_comparison_render.py")}
        identity = {
            "schema": "upstate.economic-comparison-identity/v1", "input": selected,
            "first_record_sha256": digest(first_record), "second_record_sha256": digest(second_record),
            "first_report_sha256": digest(first_report), "second_report_sha256": digest(second_report),
            "producer": {name: hashlib.sha256(body.encode("utf-8")).hexdigest()
                         for name, body in authored.items()},
        }
        sources = {}
        for side, root, record in (("first", first_root, first_record), ("second", second_root, second_record)):
            sources[side + "-edition.json"] = {"edition_id": record["id"],
                "descriptor": economic._descriptor(root / "edition.json", root)}
            sources[side + "-report.json"] = {"edition_id": record["id"],
                "descriptor": deepcopy(record["files"]["report"])}
            sources[side + "-economic-package.zip"] = {"edition_id": record["id"],
                "descriptor": deepcopy(record["files"]["complete_package"])}
        html, csv = render_comparison(comparison), csv_text(comparison)
        identity.update(comparison_sha256=digest(comparison), sources_sha256=digest(sources),
                        html_sha256=hashlib.sha256(html.encode("utf-8")).hexdigest(),
                        csv_sha256=hashlib.sha256(csv.encode("utf-8")).hexdigest())
        key = digest(identity)
        return {"schema": INTENT_SCHEMA, "id": key, "input": selected, "identity": identity,
                "comparison": comparison, "sources": sources, "authored_sources": authored,
                "html": html, "csv": csv,
                "created_at": economic._now()}

    def _root(self, workspace, key):
        return _inside(workspace.root, ROOT, _id(key))

    def _intent(self, root, key):
        value = read_json(_inside(root, "intent.json"))
        require(value.get("schema") == INTENT_SCHEMA and value.get("id") == key
                and digest(value["identity"]) == key and value["identity"]["input"] == value["input"],
                "The original comparison intent has another identity.")
        require(value["comparison"]["first"]["id"] == value["input"]["first_edition_id"]
                and value["comparison"]["second"]["id"] == value["input"]["second_edition_id"]
                and value["comparison"]["title"] == value["input"]["title"],
                "The retained comparison intent names another pair or title.")
        require(digest(value["comparison"]) == value["identity"]["comparison_sha256"]
                and digest(value["sources"]) == value["identity"]["sources_sha256"]
                and hashlib.sha256(value["html"].encode("utf-8")).hexdigest() == value["identity"]["html_sha256"]
                and hashlib.sha256(value["csv"].encode("utf-8")).hexdigest() == value["identity"]["csv_sha256"],
                "The frozen original comparison contents changed.")
        for name, body in value["authored_sources"].items():
            require(name in {"economic_comparison.py", "economic_comparison_render.py"}
                    and hashlib.sha256(body.encode("utf-8")).hexdigest() == value["identity"]["producer"].get(name),
                    "The original authored comparison source changed.")
        return value

    def _inspect(self, workspace, key, *, full=True):
        root = self._root(workspace, key)
        value = read_json(_inside(root, "comparison-record.json"))
        require(value.get("schema") == SCHEMA and value.get("id") == key
                and digest(value["identity"]) == key and value["input"] == value["identity"]["input"],
                "The saved comparison differs from its original identity.")
        files = value.get("files")
        require(isinstance(files, list) and files, "The comparison needs its original files.")
        by_path = {item["path"]: item for item in files}
        require(len(by_path) == len(files)
                and {"index.html", "comparison.json", "scenarios.csv", "manifest.json",
                     "comparison-package.zip", "first-economic-package.zip", "second-economic-package.zip"} <= set(by_path),
                "The original comparison delivery is incomplete.")
        manifest = read_json(_checked(root, by_path["manifest.json"]))
        require(manifest.get("schema") == MANIFEST_SCHEMA and manifest.get("id") == key
                and manifest.get("identity") == value["identity"],
                "The complete comparison manifest has another original identity.")
        members = manifest.get("members")
        require(isinstance(members, list) and len({item["path"] for item in members}) == len(members),
                "The comparison manifest repeats or omits its original members.")
        comparison = read_json(_checked(root, by_path["comparison.json"]))
        require(digest(comparison) == value["comparison_sha256"] == value["identity"]["comparison_sha256"]
                and comparison["first"]["id"] == value["input"]["first_edition_id"]
                and comparison["second"]["id"] == value["input"]["second_edition_id"]
                and comparison["title"] == value["title"],
                "The saved comparison differs from its retained source pair.")
        require(by_path["index.html"]["sha256"] == value["identity"]["html_sha256"]
                and by_path["scenarios.csv"]["sha256"] == value["identity"]["csv_sha256"],
                "The readable comparison or CSV differs from its original authored output.")
        if full:
            for descriptor in members + files:
                _checked(root, descriptor)
        return root, value, comparison

    def _with_files(self, workspace_key, record, root, comparison):
        result = deepcopy(record)
        result.update(workspace_key=workspace_key, comparison=deepcopy(comparison))
        result["open_url"] = ("/api/file/economic-comparison/" + quote(workspace_key, safe="")
                              + "/" + record["id"] + "/index.html")
        result["_downloads"] = [
            self.operator._ticket(workspace_key, _checked(root, descriptor), descriptor,
                                  descriptor.get("label") or descriptor["path"])
            for descriptor in record["files"]
        ]
        return result

    def _catalog(self, workspace_key):
        ws = self.operator.ws(workspace_key)
        editions, issues = self.economic._editions(ws)
        rows = []
        root = _inside(ws.root, ROOT)
        if root.is_dir():
            for path in root.iterdir():
                if not path.is_dir() or not HEX.fullmatch(path.name) or not (path / "comparison-record.json").is_file():
                    continue
                try:
                    _, record, _ = self._inspect(ws, path.name, full=False)
                    rows.append({"id": record["id"], "title": record["title"],
                                 "created_at": record["created_at"],
                                 "first_edition_id": record["input"]["first_edition_id"],
                                 "second_edition_id": record["input"]["second_edition_id"]})
                except (OSError, ValueError, TypeError, KeyError) as error:
                    issues.append({"id": path.name, "kind": ROOT, "message": str(error)})
        rows.sort(key=lambda row: (row["created_at"], row["id"]), reverse=True)
        return {"schema": "upstate.economic-comparison-catalog/v1", "workspace_key": workspace_key,
                "editions": editions, "comparisons": rows, "issues": issues}

    def read(self, workspace_key, operation, payload):
        ws = self.operator.ws(workspace_key)
        if operation == "catalog":
            return self._catalog(workspace_key)
        if operation == "preview":
            value = self._prepare(workspace_key, payload)
            return {"schema": "upstate.economic-comparison-preview/v1", "workspace_key": workspace_key,
                    "comparison_id": value["id"], "input": value["input"], "comparison": value["comparison"]}
        if operation == "detail":
            key = _id(payload.get("id") or payload.get("comparison_id"))
            root, record, comparison = self._inspect(ws, key)
            return self._with_files(workspace_key, record, root, comparison)
        raise ValueError("Choose a registered Economic comparison operation.")

    def invoke(self, task):
        require(task["action"] == ACTION, "Choose the original Economic comparison action.")
        workspace_key, payload = task["workspace"], task["payload"]
        selected = self._input(payload)
        key = _id(payload.get("expected_comparison_id"))
        ws = self.operator.ws(workspace_key)
        root = self._root(ws, key)
        with held(_inside(ws.root, ROOT, ".locks", key + ".lock")):
            if (root / "comparison-record.json").is_file():
                _, record, comparison = self._inspect(ws, key)
                require(record["input"] == selected, "The completed comparison belongs to another original request.")
                return self._with_files(workspace_key, record, root, comparison)
            if (root / "intent.json").is_file():
                intent = self._intent(root, key)
                require(intent["input"] == selected, "The retained comparison intent belongs to another original request.")
            else:
                intent = self._prepare(workspace_key, payload)
                require(intent["id"] == key and intent["input"] == selected,
                        "The original comparison changed after preview. Preview its original saved editions again.")
                root.mkdir(parents=True, exist_ok=True)
                atomic_json(_inside(root, "intent.json"), intent, immutable=True)
            # All following writes use the frozen original intent, including an interrupted earlier producer version.
            for name, source in intent["sources"].items():
                require(MEMBER.fullmatch(name), "Use an original comparison source member.")
                target = _inside(root, name)
                original_root = _inside(ws.root, economic.EDITION_KIND, _id(source["edition_id"]))
                original = _inside(original_root, *source["descriptor"]["path"].split("/"))
                _copy(original, target, source["descriptor"])
            atomic_json(_inside(root, "comparison.json"), intent["comparison"], immutable=True)
            atomic_json(_inside(root, "input.json"), intent["input"], immutable=True)
            atomic_bytes(_inside(root, "index.html"), intent["html"].encode("utf-8"), immutable=True)
            atomic_bytes(_inside(root, "scenarios.csv"), intent["csv"].encode("utf-8"), immutable=True)
            for name, body in intent["authored_sources"].items():
                atomic_bytes(_inside(root, "application", name), body.encode("utf-8"), immutable=True)
            member_names = (set(intent["sources"]) | {"comparison.json", "input.json", "index.html", "scenarios.csv"}
                            | {"application/" + name for name in intent["authored_sources"]})
            members = [economic._descriptor(_inside(root, *name.split("/")), root)
                       for name in sorted(member_names)]
            manifest = {"schema": MANIFEST_SCHEMA, "id": key, "identity": intent["identity"],
                        "comparison_sha256": digest(intent["comparison"]), "members": members,
                        "created_at": intent["created_at"]}
            atomic_json(_inside(root, "manifest.json"), manifest, immutable=True)
            package = _inside(root, "comparison-package.zip")
            if not package.exists():
                handle, temporary = tempfile.mkstemp(prefix=".comparison-package-", suffix=".zip", dir=root)
                os.close(handle)
                try:
                    with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
                        for descriptor in members:
                            archive.write(_checked(root, descriptor), descriptor["path"])
                        archive.write(root / "manifest.json", "manifest.json")
                    with open(temporary, "rb") as stream:
                        os.fsync(stream.fileno())
                    os.replace(temporary, package)
                finally:
                    if os.path.exists(temporary):
                        os.unlink(temporary)
            # Reopen every member after an interrupted ZIP publication before publishing its completion.
            with zipfile.ZipFile(package) as archive:
                expected = {item["path"]: item for item in members}
                expected["manifest.json"] = economic._descriptor(root / "manifest.json", root)
                infos = archive.infolist()
                require(len(infos) == len(expected) and {item.filename for item in infos} == set(expected),
                        "The retained comparison ZIP has different original members.")
                for item in infos:
                    checksum, size = hashlib.sha256(), 0
                    with archive.open(item) as stream:
                        for body in iter(lambda: stream.read(1024 * 1024), b""):
                            checksum.update(body)
                            size += len(body)
                    require(size == expected[item.filename]["bytes"]
                            and checksum.hexdigest() == expected[item.filename]["sha256"],
                            "The retained comparison ZIP differs from its original member: " + item.filename)
            labels = {"index.html": "Readable original comparison", "comparison.json": "Complete comparison JSON",
                      "scenarios.csv": "All original scenario changes", "manifest.json": "Original comparison manifest",
                      "comparison-package.zip": "Complete comparison and both original Economic packages",
                      "first-economic-package.zip": "First original complete Economic package",
                      "second-economic-package.zip": "Second original complete Economic package"}
            files = [{**economic._descriptor(root / name, root), "label": label} for name, label in labels.items()]
            record = {"schema": SCHEMA, "id": key, "title": intent["input"]["title"],
                      "input": intent["input"], "identity": intent["identity"], "files": files,
                      "comparison_sha256": digest(intent["comparison"]), "created_at": intent["created_at"]}
            atomic_json(_inside(root, "comparison-record.json"), record, immutable=True)
            _, record, comparison = self._inspect(ws, key)
            return self._with_files(workspace_key, record, root, comparison)

    def preview_file(self, workspace_key, comparison_id, member):
        require(isinstance(member, str) and MEMBER.fullmatch(member), "Choose a retained comparison member.")
        ws = self.operator.ws(workspace_key)
        root, record, _ = self._inspect(ws, _id(comparison_id), full=False)
        descriptor = next((item for item in record["files"] if item["path"] == member), None)
        require(descriptor is not None, "Choose a published original comparison file.")
        return (self.operator._ticket(workspace_key, _checked(root, descriptor), descriptor,
                                      descriptor.get("label") or member), POLICY)

    def decorate_task(self, task):
        if task.get("action") == ACTION and task.get("state") == "complete":
            value = self.read(task["workspace"], "detail", {"id": task["result"]["id"]})
            task["result"], task["_downloads"] = value, value["_downloads"]
        return task

    def verify_workspace(self, workspace):
        count, pending = 0, 0
        root = _inside(workspace.root, ROOT)
        if root.is_dir():
            for path in root.iterdir():
                if not path.is_dir() or not HEX.fullmatch(path.name):
                    continue
                if (path / "comparison-record.json").is_file():
                    self._inspect(workspace, path.name)
                    count += 1
                elif (path / "intent.json").is_file():
                    self._intent(path, path.name)
                    pending += 1
        return {"completed_comparisons": count, "retained_incomplete_comparisons": pending}
