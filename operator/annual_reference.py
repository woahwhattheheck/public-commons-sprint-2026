"""Original annual-reference intake through the existing operator queue."""
from __future__ import annotations

from pathlib import Path
import re

from model.common import (atomic_bytes, atomic_json, describe_file, held,
                          identifier, now, read_json, relative_file, verify_file)
from source_tools import usgs_annual as annual
from source_preparation import SourcePreparation

ACTIONS = frozenset({"annual-reference.inventory", "annual-reference.import"})
APPLICATION = Path(__file__).resolve().parents[1]
DICTIONARY = APPLICATION / "source/usgs-annual2012-20261013/F7DN436B-original-metadata.xml"
BASINS = APPLICATION / "source/usgs-nldi-upper-savannah-20261013"
DEFAULT_HUCS = [f"030601{i:02d}" for i in range(1, 8)]
SOURCE_EDITIONS = {
    "f7dn436b": {"title": "USGS published annual estimates — F7DN436B",
                 "description": "Original paired stations, final estimators, source periods and published standard errors.",
                 "modes": ["registered", "uploads", "published"]},
    "southeast-sparrow-2012": {"title": "USGS Southeast SPARROW calibration targets — 2012 reference",
                 "description": "Original published nitrogen, phosphorus and sediment targets with their regional target horizon and source reach.",
                 "modes": ["published", "registered"]},
}


class AnnualReferences:
    def __init__(self, operator, fault, source_roots=()):
        self.operator, self.Fault = operator, fault
        self.sources = SourcePreparation(operator, fault, source_roots)

    def _team_administrator(self):
        team = getattr(self.operator, "team", None)
        context = team.current() if team else None
        return not context or context["principal"]["administrator"]

    def _fail(self, message, status=422):
        raise self.Fault("ANNUAL_REFERENCE", message, status)

    def _edition(self, payload):
        key = payload.get("source_edition") or "f7dn436b"
        if key not in SOURCE_EDITIONS:
            self._fail("Choose an available original annual-source edition.")
        if key == "southeast-sparrow-2012":
            from source_tools import sparrow_reference
            return key, sparrow_reference
        return key, annual

    @staticmethod
    def _directory(workspace, task_id):
        return workspace.root / "annual-references" / identifier(task_id)

    def _record(self, workspace, task_id):
        directory = self._directory(workspace, task_id)
        record = read_json(directory / "operation.json")
        if record["project_id"] != workspace.project["id"]:
            self._fail("Choose an annual-reference operation in this workspace.")
        return directory, record

    def _all(self, workspace):
        return [read_json(path) for path in
                sorted((workspace.root / "annual-references").glob("*/operation.json"))]

    @staticmethod
    def _summary(record):
        result = record.get("result") or {}
        return {key: record.get(key) for key in
                ("task_id", "title", "action", "state", "stage", "updated_at", "error")} | {
                    "record_counts": result.get("record_counts"),
                    "usable_counts": result.get("usable_counts"),
                    "station_count": result.get("station_count"),
                    "binding": result.get("binding"),
                    "inventory_task_id": result.get("inventory_task_id"),
                    "source_edition": record.get("source_edition", "f7dn436b"),
                }

    def _basin_sources(self):
        if not (BASINS / "source-manifest.json").is_file():
            return {}, {}
        manifest = read_json(BASINS / "source-manifest.json")
        review = read_json(BASINS / manifest["geometry_review"])
        sources = {}
        for item in manifest["original_sources"]:
            if item.get("comid"):
                sources[(item["comid"], item["kind"])] = item
        reviews = {row["current_nldi_comid"]: row for row in review["review"]}
        return sources, reviews

    def _choices(self, row, sources, reviews):
        choices = []
        comid = row.get("comid", "")
        if row.get("retained_catchment"):
            choices.append({
                "id": "retained-source-reach", "label": "Retained source reach " + comid,
                "description": "Original full-reach catchment retained with this published source edition.",
                "component_review": row.get("component_review"),
            })
        if ((comid, "reach_feature") in sources and (comid, "upstream_basin") in sources
                and comid in reviews):
            review = reviews[comid]
            choices.append({
                "id": "retained-reach", "label": "Retained published reach " + comid,
                "description": "Original full-reach NLDI catchment; reviewed original component "
                               + str(review["retained_component_index"]) + ".",
                "component_review": review,
            })
        if re.fullmatch(r"[0-9]+", comid):
            choices.append({"id": "published-reach", "label": "Receive published reach " + comid,
                            "description": "Receive the original full-reach NLDI basin."})
        if row.get("final_method") == "published_regional_target":
            return choices
        for key, choice, label in (
                ("station_id", "water-quality-station", "Water-quality station"),
                ("flow_station_id", "flow-station", "Published flow station")):
            station = row.get(key, "").removeprefix("USGS-")
            if re.fullmatch(r"[0-9]{8,15}", station):
                choices.append({"id": choice, "label": label + " " + station,
                                "description": "Receive the full original NLDI catchment for this source station."})
        return choices

    def _inventory(self, workspace, task_id):
        directory, record = self._record(workspace, task_id)
        if record["action"] != "annual-reference.inventory" or record["state"] != "complete":
            self._fail("Choose a completed original annual-source inventory.")
        path = directory / "inventory.json"
        verify_file(workspace.root, record["result"]["inventory"])
        value = read_json(path)
        # Reopen the exact selected edition before displaying/adopting its rows.
        edition, source = self._edition(record)
        if source._source(directory / "original")["id"] != value["source"]["id"]:
            self._fail("The retained original inventory source has changed.")
        return directory, {**value, "source_edition": edition}

    def read(self, workspace_key, operation, payload=None):
        workspace = self.operator.ws(workspace_key)
        payload = payload or {}
        if operation == "catalog":
            return {
                "workspace_key": workspace_key, "default_huc8": DEFAULT_HUCS,
                "source_editions": [{"id": key, **value,
                                    "available": key == "f7dn436b" or
                                        (APPLICATION / "source_tools/sparrow_reference.py").is_file()}
                                   for key, value in SOURCE_EDITIONS.items()],
                "source_roots": ([{"id": key, "label": str(path)}
                                  for key, path in self.sources.roots.items()]
                                 if self._team_administrator() else []),
                "uploads": [
                    {"id": row["id"], "filename": row["filename"], "bytes": row["bytes"]}
                    for path in sorted((self.operator.root / "uploads").glob("*.json"))
                    for row in [read_json(path)]
                    if row.get("bytes") in (781822, 519872)
                    and (getattr(self.operator, "team", None) is None
                         or self.operator.team.can_resource("upload", row["id"]))
                ],
                "operations": [self._summary(row) for row in self._all(workspace)],
                "dictionary_available": DICTIONARY.is_file(),
            }
        if operation == "files":
            return {"workspace_key": workspace_key, **self.sources._files(payload)}
        task_id = identifier(payload.get("task_id"))
        if operation == "inventory":
            _, value = self._inventory(workspace, task_id)
            sources, reviews = self._basin_sources()
            records = [{**row, "catchment_choices": self._choices(row, sources, reviews)}
                       for row in value["records"]]
            return {"workspace_key": workspace_key, "task_id": task_id, **value, "records": records}
        directory, record = self._record(workspace, task_id)
        if operation == "operation":
            return {"workspace_key": workspace_key, **record,
                    "_downloads": self._downloads(workspace_key, workspace, directory, record)}
        self._fail("Choose an annual-reference catalogue, inventory or operation.")

    def state(self, workspace_key):
        workspace = self.operator.ws(workspace_key)
        return {"operations": [self._summary(row) for row in self._all(workspace)]}

    def _downloads(self, workspace_key, workspace, directory, record):
        paths = [directory / "operation.json"]
        result = record.get("result") or {}
        for item in result.get("documents", []):
            verify_file(workspace.root, item)
            paths.append(relative_file(workspace.root, item["path"]))
        return [self.operator._ticket(workspace_key, path, describe_file(workspace.root, path),
                                      path.name) for path in paths if path.is_file()]

    def decorate_task(self, task):
        if task.get("action") not in ACTIONS:
            return task
        workspace = self.operator.ws(task["workspace"])
        directory = self._directory(workspace, task["id"])
        if not (directory / "operation.json").is_file():
            return task
        record = read_json(directory / "operation.json")
        task["_annual_reference"] = self._summary(record)
        task.setdefault("_downloads", []).extend(
            self._downloads(task["workspace"], workspace, directory, record))
        return task

    def _stage(self, directory, record, label):
        record.update(state="running", stage=label, updated_at=now())
        atomic_json(directory / "operation.json", record)

    def _original(self, workspace, directory, payload):
        edition, source_tool = self._edition(payload)
        original = directory / "original"
        original.mkdir(parents=True, exist_ok=True)
        mode = payload.get("mode", "published" if edition == "southeast-sparrow-2012" else "registered")
        if mode not in SOURCE_EDITIONS[edition]["modes"]:
            self._fail("Choose a supported intake for this original source edition.")
        if edition == "southeast-sparrow-2012":
            if mode == "registered":
                source = self.sources._root_path(payload.get("root_id"), payload.get("path", ""), directory=True)
                for name in source_tool.FILES:
                    path = relative_file(source, name)
                    atomic_bytes(original / name, path.read_bytes(), immutable=True)
                for name, expected in getattr(source_tool, "CATCHMENT_FILES", {}).items():
                    if (source / name).is_file():
                        path = relative_file(source, name)
                        verify_file(source, {"path": name, **expected})
                        atomic_bytes(original / name, path.read_bytes(), immutable=True)
            source_tool.receive(original)
            return original
        if mode == "published":
            annual.receive(original)
            return original
        if mode == "registered":
            source = self.sources._root_path(payload.get("root_id"), payload.get("path", ""), directory=True)
            supplied = {name: relative_file(source, name) for name in ("load_est.zip", "sitegage.zip")}
        elif mode == "uploads":
            supplied = {}
            for name, field in (("load_est.zip", "load_upload_id"), ("sitegage.zip", "site_upload_id")):
                upload = self.operator.upload(identifier(payload.get(field)))
                supplied[name] = Path(upload["path"])
        else:
            self._fail("Choose received originals, original uploads or the fixed published archive source.")
        for name, source in {**supplied, "F7DN436B-original-metadata.xml": DICTIONARY}.items():
            if source.stat().st_size != annual.FILES[name]["bytes"]:
                self._fail("The selected original has a different published length: " + name)
            atomic_bytes(original / name, source.read_bytes(), immutable=True)
        annual.receive(original)
        return original

    def _run_inventory(self, workspace, directory, record, payload):
        edition, source_tool = self._edition(payload)
        record["source_edition"] = edition
        self._stage(directory, record, "Receiving original annual tables")
        original = self._original(workspace, directory, payload)
        selected_hucs = payload.get("huc8", DEFAULT_HUCS)
        if (not isinstance(selected_hucs, list) or not selected_hucs
                or any(not isinstance(value, str) or not re.fullmatch(r"[0-9]{8}", value)
                       for value in selected_hucs)):
            self._fail("Choose at least one original eight-digit HUC.")
        self._stage(directory, record, "Reading original station, estimator and period records")
        value = source_tool.inventory(original, huc8=selected_hucs)
        atomic_json(directory / "inventory.json", value, immutable=True)
        document = describe_file(workspace.root, directory / "inventory.json")
        return {"inventory": document, "documents": [document],
                "source_id": value["source"]["id"], "source_edition": edition,
                "record_counts": value["record_counts"],
                "usable_counts": value["usable_counts"], "station_count": value["station_count"]}

    def _selection(self, original, inventory, payload):
        edition, source_tool = self._edition(inventory)
        submitted = payload.get("records")
        if not isinstance(submitted, list) or not submitted:
            self._fail("Choose actual annual-reference records from the inventory.")
        by_id = {row["record_id"]: row for row in inventory["records"]}
        sources, reviews = self._basin_sources()
        selected, seen = [], set()
        for item in submitted:
            record_id = item.get("record_id") if isinstance(item, dict) else None
            if record_id not in by_id or record_id in seen:
                self._fail("Choose each inventory record once.")
            seen.add(record_id)
            row = by_id[record_id]
            if row["issues"]:
                self._fail("The selected original record has unresolved source fields: " + row["station_id"])
            choice = item.get("catchment")
            available = {item["id"] for item in self._choices(row, sources, reviews)}
            if choice not in available:
                self._fail("Choose an available original station or published reach for " + row["station_id"])
            spec = {"record_id": record_id,
                    "comparability_note": str(payload.get("comparability_note", "")).strip()}
            if choice == "retained-source-reach":
                spec["retained_catchment"] = row["retained_catchment"]
            elif choice == "retained-reach":
                comid, review = row["comid"], reviews[row["comid"]]
                retained = {"source": "comid", "identifier": comid, "station_role": "published_reach",
                            "split_catchment": False, "component_indices": [review["retained_component_index"]],
                            "component_selection_reason":
                                "Retain the original component containing the actual station and main upstream "
                                "basin, as documented in the original geometry review; retain omitted "
                                "component geometry and ellipsoidal area with the annual reference."}
                for kind, source_kind in (("feature", "reach_feature"), ("basin", "upstream_basin")):
                    item = sources[(comid, source_kind)]
                    verify_file(BASINS, item)
                    target = original / "nldi" / item["path"]
                    atomic_bytes(target, relative_file(BASINS, item["path"]).read_bytes(), immutable=True)
                    retained[kind] = {**describe_file(original, target), "uri": item["url"]}
                spec["retained_catchment"] = retained
            else:
                source, key, role = {
                    "published-reach": ("comid", "comid", "published_reach"),
                    "water-quality-station": ("nwissite", "station_id", "water_quality_station"),
                    "flow-station": ("nwissite", "flow_station_id", "published_flow_station"),
                }[choice]
                target = row[key] if source == "comid" else "USGS-" + row[key].removeprefix("USGS-")
                spec["catchment"] = {"source": source, "identifier": target,
                                     "station_role": role, "split_catchment": False}
            selected.append(spec)
        title = str(payload.get("title", "")).strip()
        if not title:
            self._fail("Give this selected observation edition a title.")
        return {"schema": source_tool.SELECTION_SCHEMA, "title": title,
                "source_id": inventory["source"]["id"], "records": selected,
                "scope": {"huc8": inventory["selected_huc8"],
                          "selection": inventory.get("selection_basis") or
                              "Original paired station/flow-station HUC8 records",
                          "source_edition": edition}}

    def _run_import(self, workspace, directory, record, payload):
        inventory_task_id = identifier(payload.get("inventory_task_id"))
        previous, inventory = self._inventory(workspace, inventory_task_id)
        original = previous / "original"
        edition, source_tool = self._edition(inventory)
        record["source_edition"] = edition
        self._stage(directory, record, "Retaining the selected original catchment sources")
        selection = self._selection(original, inventory, payload)
        atomic_json(directory / "selection.json", selection, immutable=True)
        prepared = directory / "prepared"
        self._stage(directory, record, "Preparing selected annual loads and upstream catchments")
        result = source_tool.prepare(prepared, original_root=original,
                                selection_path=directory / "selection.json")
        self._stage(directory, record, "Importing the source edition and annual observations")
        binding = annual.bind(workspace.root, prepared)
        documents = [describe_file(workspace.root, directory / "selection.json")]
        documents.extend(describe_file(workspace.root, prepared / filename)
                         for filename in ("annual-loads.csv", "annual-records.json", "catchments.geojson",
                                          "catchment-sources.json", "observation-metadata.json",
                                          "source-manifest.json", "result.json",
                                          "binding-" + workspace.project["id"] + ".json"))
        return {"inventory_task_id": inventory_task_id, "source_edition": edition, "binding": binding,
                "preparation_id": result["id"], "documents": documents,
                "records": result["records"], "stations": result["stations"],
                "catchments": result["catchments"], "parameters": result["parameters"]}

    def invoke(self, task):
        if task["action"] not in ACTIONS:
            self._fail("Choose an annual-reference intake action.")
        workspace = self.operator.ws(task["workspace"])
        directory = self._directory(workspace, task["id"])
        directory.mkdir(parents=True, exist_ok=True)
        with held(directory / ".operation.lock", blocking=False):
            path = directory / "operation.json"
            record = read_json(path) if path.exists() else {
                "schema": "upstate.annual-reference-operation/v1", "task_id": task["id"],
                "project_id": workspace.project["id"], "action": task["action"],
                "request_sha256": task["request_sha256"], "created_at": now(),
                "source_edition": task["payload"].get("source_edition") or "f7dn436b",
                "title": task["payload"].get("title") or "Original annual-reference inventory",
                "state": "queued", "updated_at": now(),
            }
            if (record["project_id"] != workspace.project["id"]
                    or record["request_sha256"] != task["request_sha256"]):
                self._fail("This retained operation belongs to a different source selection.")
            if record["state"] == "complete":
                return record["result"]
            try:
                function = self._run_inventory if task["action"] == "annual-reference.inventory" else self._run_import
                result = function(workspace, directory, record, task["payload"])
            except BaseException as error:
                record.update(state="failed", updated_at=now(),
                              error={"code": type(error).__name__, "message": str(error)})
                atomic_json(path, record)
                raise
            record.update(state="complete", stage="complete", result=result, updated_at=now())
            record.pop("error", None)
            atomic_json(path, record)
            return result
