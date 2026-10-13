"""Source-water inventory and experiment desk on the original operator services."""
from __future__ import annotations

from copy import deepcopy
from functools import lru_cache
import hashlib
import importlib
from html import escape
from html.parser import HTMLParser
from pathlib import Path
import posixpath
from urllib.parse import urlsplit
import zipfile

from model.common import (atomic_bytes, atomic_json, canonical, describe_file,
                          digest, held, identifier, read_json,
                          relative_file, verify_file)

ACTIONS = {"receptor.network.build", "receptor.inventory.build", "receptor.experiment.build", "receptor.package.export", "receptor.source-areas.prepare", "receptor.scenario.save", "receptor.programme.create", "receptor.programme.compare", "receptor.report-source.build"}
APPLICATION = Path(__file__).resolve().parents[1]
POLLUTANTS = ("nitrogen_export", "phosphorus_export", "sediment_export")
FOLDERS = {"network": "receptor-networks", "inventory": "receptor-inventories",
           "comparison": "receptor-experiments", "source-areas": "receptor-scenario-areas",
           "programme": "receptor-programmes", "report-source": "receptor-report-sources"}


def _folder(kind):
    if kind not in FOLDERS:
        raise ValueError("Choose an original network, inventory or comparison")
    return FOLDERS[kind]


@lru_cache(maxsize=256)
def _saved_summary(path, signature):
    # The file identity changes on replacement; polling retains only summaries.
    path = Path(path)
    value = read_json(path)
    key = identifier(path.parent.name)
    if value.get("id") != key:
        raise ValueError("Saved source-water result identity differs from its directory")
    return {
        "id": key, "title": value.get("title", "Source-water contributing areas"),
        "workspace_id": value.get("workspace_id"),
        "state": value.get("state", "complete"),
        "created_at": value.get("created_at", ""),
        "experiment_id": value.get("experiment_id"),
        "programme_id": value.get("programme_id"),
        "preparation_id": value.get("preparation_id"),
        "baseline_run_id": value.get("baseline_run_id"),
        "grid_id": value.get("grid_id"),
        "areas": len(value.get("areas", [])),
        "scenario_rows": value.get("membership_rows", len(value.get("scenario_exports", value.get("rows", [])))),
        "network_huc12_count": value.get("network_huc12_count"),
        "selected_huc12_count": value.get("selected_huc12_count"),
        "source_body_filename": value.get("source_body_filename"),
        "source_body_bytes": value.get("source_binding", {}).get("body_bytes"),
        "source_body_sha256": value.get("source_binding", {}).get("body_sha256"),
        "decoded_source_sha256": value.get("source_binding", {}).get("decoded_sha256"),
        "source_reference": value.get("identity", {}).get("receptor_spec", {}).get("source_reference"),
        "counts": value.get("counts", {}),
        "pollutants": value.get("pollutants",
            sorted({row["pollutant"] for row in value.get("scenario_exports", value.get("rows", []))})),
    }


def _summaries(workspace, folder):
    rows = []
    for path in (workspace.root / folder).glob("*/result.json"):
        stat = path.stat()
        signature = (stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns)
        row = dict(_saved_summary(str(path), signature))
        if folder in ("receptor-experiments", "receptor-scenario-areas", "receptor-programmes", "receptor-report-sources") and row["workspace_id"] != workspace.project["id"]:
            raise ValueError("Saved comparison belongs to a different workspace")
        rows.append(row)
    return sorted(rows, key=lambda row: (row["created_at"], row["id"]), reverse=True)


def overview(operator, workspace_key):
    workspace = operator.ws(workspace_key)
    return {"comparisons": _summaries(workspace, "receptor-experiments"),
            "inventories": _summaries(workspace, "receptor-inventories"),
            "networks": _summaries(workspace, "receptor-networks"),
            "source_areas": _summaries(workspace, "receptor-scenario-areas"),
            "programmes": _summaries(workspace, "receptor-programmes"),
            "report_sources": _summaries(workspace, "receptor-report-sources")}


def _profiles():
    rows = []
    for path in sorted((APPLICATION / "source" / "receptor-profiles").glob("*.json")):
        spec = read_json(path)
        if not isinstance(spec, dict) or not isinstance(spec.get("receptors"), list):
            raise ValueError("Installed receptor profile is not a receptor specification")
        rows.append({"id": digest(spec), "title": spec.get("title", path.stem),
                     "spec": spec, "source": describe_file(APPLICATION, path)})
    return rows


def _catalog(operator, workspace_key):
    from model.model_selection import run_scope
    workspace = operator.ws(workspace_key)
    original = workspace.overview()
    scenarios = {row["id"]: row for row in original["scenarios"]}
    profiles = {row["id"]: row for row in original["profiles"]}
    source_lookup = {(collection["id"], entry["id"]): {
        "source_collection_id": collection["id"], "source_id": entry["id"],
        **{name: entry[name] for name in ("uri", "vintage", "title")},
        "sha256": entry["body"]["sha256"]}
        for collection in original["sources"] for entry in collection["entries"]}
    grids = {row["id"]: row for row in original["grids"]}
    runs = []
    for row in original["runs"]:
        if row["state"] != "complete":
            continue
        selected = row["selection"]
        grid_spec = grids.get(selected["grid_id"], {}).get("spec", {})
        network_reference = source_lookup.get((grid_spec.get("source_collection_id"),
                                               grid_spec.get("model_domain", {}).get("source_id")))
        runs.append({"id": row["id"], "state": row["state"],
            "grid_id": selected["grid_id"], "profile_id": selected["profile_id"],
            "network_source_reference": network_reference,
            "scenario_id": selected["scenario_id"],
            "scenario_title": scenarios.get(selected["scenario_id"], {}).get("title", selected["scenario_id"][:12]),
            "scenario_kind": scenarios.get(selected["scenario_id"], {}).get("kind"),
            "profile_title": profiles.get(selected["profile_id"], {}).get("title", selected["profile_id"][:12]),
            "pollutants": [key for key in POLLUTANTS if key in run_scope(row)["available_artifacts"]]})
    network_sources = []
    for collection in original["sources"]:
        for entry in collection["entries"]:
            filename = entry["body"]["filename"]
            if entry["kind"] != "vector" or not filename.lower().endswith((".json", ".gz", ".zip")):
                continue
            reference = {"source_collection_id": collection["id"], "source_id": entry["id"],
                         **{name: entry[name] for name in ("uri", "vintage", "title")},
                         "sha256": entry["body"]["sha256"]}
            network_sources.append({"id": digest(reference), **reference,
                                    "filename": filename, "bytes": entry["body"]["bytes"],
                                    "collection_title": collection["title"]})
    saved = overview(operator, workspace_key)
    for row in saved["networks"]:
        reference = row.get("source_reference") or {}
        network_sources.append({
            "id": "network:" + row["id"], "network_result_id": row["id"],
            "title": row["title"], "collection_title": "Retained source-water studies",
            "uri": reference.get("uri") or "urn:sha256:" + row["source_body_sha256"],
            "vintage": reference.get("vintage") or row["created_at"].split("T")[0],
            "filename": row["source_body_filename"], "bytes": row["source_body_bytes"],
            "sha256": row["source_body_sha256"],
            "decoded_sha256": row["decoded_source_sha256"],
            "source_reference": reference})
    try:
        engine = importlib.import_module('model.experiments')
        experiment_rows, experiment_available = engine.list_experiments(workspace), True
    except ModuleNotFoundError as error:
        if error.name != "model.experiments":
            raise
        experiment_rows, experiment_available = [], False
    all_runs = {row["id"]: row for row in original["runs"]}
    for experiment in experiment_rows:
        reference_run = all_runs.get(experiment["selection"]["baseline_run_id"], {})
        grid_id = reference_run.get("selection", {}).get("grid_id")
        spec = grids.get(grid_id, {}).get("spec", {})
        experiment["network_source_reference"] = source_lookup.get(
            (spec.get("source_collection_id"), spec.get("model_domain", {}).get("source_id")))
    return {"workspace_key": workspace_key, "workspace_id": workspace.project["id"],
            "title": workspace.project["title"], "experiments": experiment_rows,
            "experiment_available": experiment_available,
            "receptor_profiles": _profiles(), "runs": runs, "network_sources": network_sources,
            **saved}


def _inventory(workspace, key):
    directory = workspace.root / "receptor-inventories" / identifier(key)
    result = read_json(directory / "result.json")
    if result.get("id") != key or result.get("schema") != "upstate.receptor-inventory/v1":
        raise ValueError("Choose a retained source-water inventory")
    workspace.get_grid(result["grid_id"])
    workspace.inspect_run(result["baseline_run_id"])
    for item in result["files"].values():
        verify_file(directory, item)
    result["files"] = {**result["files"],
        "inventory": describe_file(directory, directory / "inventory.json"),
        "result": describe_file(directory, directory / "result.json")}
    result.setdefault("pollutants", sorted({row["pollutant"] for row in result["scenario_exports"]}))
    return result


def _network_selection(workspace, selection):
    if selection.get("network_result_id"):
        if selection.get("member"):
            raise ValueError("A retained network already contains its original selected source body")
        original = _network(workspace, identifier(selection["network_result_id"]))
        directory = workspace.root / "receptor-networks" / original["id"]
        path = verify_file(directory, original["files"]["source_body"])
        spec = deepcopy(selection["receptor_spec"])
        previous = original["identity"]["receptor_spec"]
        # Preserve the original source binding without appending a chain of
        # product IDs to the scientific selection on every repeated build.
        for name in ("source_collection_id", "network_source_id", "source_reference",
                     "source_network_reference"):
            if name in previous:
                spec[name] = deepcopy(previous[name])
            else:
                spec.pop(name, None)
        return path, spec
    collection_id = identifier(selection["source_collection_id"])
    source_id = selection["network_source_id"]
    path, entry = workspace.source_file(collection_id, source_id)
    spec = deepcopy(selection["receptor_spec"])
    spec["source_collection_id"] = collection_id
    spec["network_source_id"] = source_id
    spec["source_reference"] = {
        "source_collection_id": collection_id, "source_id": source_id,
        **{name: entry[name] for name in ("uri", "vintage", "title")},
        "sha256": entry["body"]["sha256"]}
    return path, spec


def _network_plan(workspace, selection):
    from model.receptor_network_cli import _read_source
    from model.receptor_network import upstream_memberships
    source, spec = _network_selection(workspace, selection)
    rows, binding, retained = _read_source(source, selection.get("member"))
    expected = selection.get("expected_decoded_sha256")
    if expected is not None and binding["decoded_sha256"] != identifier(expected):
        raise ValueError("Original domain decoded body differs from the selected source")
    network = upstream_memberships(rows, spec["receptors"],
        huc12_field=spec.get("huc12_field"), tohuc_field=spec.get("tohuc_field"),
        name_field=spec.get("name_field"), type_field=spec.get("type_field"))
    return {"title": spec.get("title", "Original watershed connections"),
            "source_reference": spec.get("source_reference") or {
                "uri": "urn:sha256:" + binding["body_sha256"],
                "sha256": binding["body_sha256"], "title": source.name},
            "source_binding": binding,
            "network_huc12_count": network["network_huc12_count"],
            "selected_huc12_count": network["selected_huc12_count"],
            "shared_huc12s": network["shared_huc12s"],
            "areas": [{name: value for name, value in area.items() if name != "memberships"}
                      for area in network["areas"]]}


def _network(workspace, key):
    directory = workspace.root / "receptor-networks" / identifier(key)
    result = read_json(directory / "result.json")
    if (result.get("id") != key or result.get("schema") != "upstate.receptor-network-product/v1"
            or digest(result["identity"]) != key):
        raise ValueError("Choose a retained original watershed network")
    for item in result["files"].values():
        verify_file(directory, item)
    network = read_json(directory / result["files"]["network"]["path"])
    original = {row["huc12"]: row for row in network["network"]}
    memberships = []
    for area in network["areas"]:
        for item in area["memberships"]:
            source = original[item["huc12"]]
            memberships.append({"receptor_id": area["id"], "receptor_title": area["title"], **item,
                **{name: source[name] for name in ("name", "tohuc_original", "hutype", "source_feature_id")}})
    result["memberships"] = memberships
    result["network"] = network
    if result["files"].get("geography"):
        import math
        from xml.etree import ElementTree
        item = result["files"]["geography"]
        svg = ElementTree.fromstring(relative_file(directory, item["path"]).read_bytes())
        namespace = "{http://www.w3.org/2000/svg}"
        if svg.tag != namespace + "svg":
            raise ValueError("The retained geography file is not an SVG watershed view")
        view_box = [float(part) for part in svg.attrib["viewBox"].split()]
        if (len(view_box) != 4 or not all(math.isfinite(value) for value in view_box)
                or view_box[2] <= 0 or view_box[3] <= 0):
            raise ValueError("The original watershed view has an invalid extent")
        shapes = []
        for path in svg.iter(namespace + "path"):
            huc = path.attrib.get("data-huc")
            if huc not in original:
                raise ValueError("The geographic view contains an unknown original HUC12")
            row = original[huc]
            shapes.append({"huc12": huc, "path": path.attrib["d"], "name": row["name"],
                "tohuc_original": row["tohuc_original"], "source_feature_id": row["source_feature_id"],
                "area_ids": [area["id"] for area in network["areas"] if huc in area["huc12s"]],
                "anchor_area_ids": [area["id"] for area in network["areas"] if huc in area["anchor_huc12s"]]})
        result["geography_view"] = {"view_box": view_box, "shapes": shapes}
    result["files"] = {**result["files"], "result": describe_file(directory, directory / "result.json")}
    return result


def _record(workspace, kind, key):
    if kind == "report-source":
        from model import receptor_report_source
        return receptor_report_source.inspect(workspace, key)
    if kind == "programme":
        from model import receptor_programmes
        return receptor_programmes.inspect(workspace, key)
    if kind == "source-areas":
        from model import receptor_scenarios
        return receptor_scenarios.inspect(workspace, key)
    if kind == "network":
        return _network(workspace, key)
    if kind == "comparison":
        from model import receptor_experiments
        return receptor_experiments.inspect(workspace, key)
    if kind == "inventory":
        return _inventory(workspace, key)
    raise ValueError("Choose a retained original network, inventory or comparison")


def _members(workspace, kind, result):
    folder = _folder(kind)
    prefix = Path(folder) / result["id"]
    members = {}
    for item in result["files"].values():
        record = {**item, "path": (prefix / item["path"]).as_posix()}
        members[record["path"]] = record
    if kind == "comparison":
        for group in result["groups"]:
            if group["state"] != "complete":
                continue
            for item in group["files"].values():
                previous = members.setdefault(item["path"], dict(item))
                if previous != item:
                    raise ValueError("Profile products contain conflicting file descriptors")
    return members


class _ReportLinks(HTMLParser):
    """Preserve static report content while resolving its original file links."""
    def __init__(self, relative, links):
        super().__init__(convert_charrefs=False)
        self.relative, self.links, self.parts = relative, links, []
        self.script_depth = 0
        self.filtered_depth = 0

    def handle_starttag(self, tag, attrs):
        if tag == "script":
            self.script_depth += 1
            return
        if self.script_depth:
            return
        values = dict(attrs)
        if self.filtered_depth:
            if tag == "div":
                self.filtered_depth += 1
            return
        if tag == "div" and "filters" in values.get("class", "").split():
            self.filtered_depth = 1
            return
        if tag == "a" and values.get("href"):
            target = urlsplit(values["href"])
            if not target.scheme and not target.netloc:
                path = posixpath.normpath(posixpath.join(posixpath.dirname(self.relative), target.path))
                ticket = self.links.get(path)
                if ticket:
                    values["href"] = ticket["url"]
                else:
                    values.pop("href", None)
        attributes = "".join(" " + key + ('="' + escape(value, quote=True) + '"' if value is not None else "")
                             for key, value in values.items())
        self.parts.append("<" + tag + attributes + ">")

    def handle_endtag(self, tag):
        if self.script_depth:
            if tag == "script":
                self.script_depth -= 1
            return
        if self.filtered_depth:
            if tag == "div":
                self.filtered_depth -= 1
            return
        self.parts.append("</" + tag + ">")

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)

    def handle_data(self, data):
        if not self.script_depth and not self.filtered_depth:
            self.parts.append(data)

    def handle_entityref(self, name):
        self.handle_data("&" + name + ";")

    def handle_charref(self, name):
        self.handle_data("&#" + name + ";")

    def handle_decl(self, decl):
        self.parts.append("<!" + decl + ">")


def _decorate(operator, workspace_key, kind, original):
    workspace = operator.ws(workspace_key)
    result = deepcopy(original)
    members = _members(workspace, kind, result)
    links = {}
    for path, item in members.items():
        links[path] = operator._ticket(workspace_key, workspace.root / path, item, path)
    previews, view_links = {}, dict(links)
    for path, item in sorted(members.items(), key=lambda pair: (pair[0].startswith("receptor-experiments/"), pair[0])):
        if not path.endswith("/index.html"):
            continue
        parser = _ReportLinks(path, view_links)
        parser.feed((workspace.root / path).read_text(encoding="utf-8"))
        parser.close()
        content = "".join(parser.parts).encode("utf-8")
        key = digest({"workspace_key": workspace_key, "path": path, "html_sha256": hashlib.sha256(content).hexdigest()})
        preview = operator.root / "previews" / "receptors" / (key + ".html")
        atomic_bytes(preview, content, immutable=True)
        ticket = operator._ticket(workspace_key, preview,
            describe_file(preview.parent, preview, filename="source-water-report.html"),
            "Printable source-water report")
        previews[path] = ticket
        view_links[path] = ticket
    folder = _folder(kind)
    report_path = folder + "/" + result["id"] + "/index.html"
    result["_native_executions"] = _native_execution_rows(result.get("native_execution"))
    result["_kind"] = kind
    result["workspace_key"] = workspace_key
    result["_downloads"] = list(links.values())
    result["_report"] = previews.get(report_path)
    result["_profile_reports"] = previews
    return result


def _native_plan_run(workspace, run_id, cache):
    """Read producing-stage labels once per preview without altering native runs."""
    if run_id not in cache:
        from model import native_versions
        from model.model_selection import run_scope
        try:
            run = workspace.inspect_run(run_id)
            pollutants = [key for key in POLLUTANTS if key in run_scope(run)["available_artifacts"]]
            versions = native_versions.model_versions(
                run, native_versions.models_for_outputs(pollutants))
            cache[run_id] = {
                "id": run_id, "state": run["state"], "pollutants": pollutants,
                "models": [{"model": model, **info, "label": native_versions.version_label(info)}
                           for model, info in versions.items()],
                "error": None,
            }
        except (ValueError, FileNotFoundError) as error:
            cache[run_id] = {"id": run_id, "state": "unavailable",
                            "pollutants": [], "models": [], "error": str(error)}
    return cache[run_id]


def _plan(workspace, payload):
    from model import receptor_experiments
    compatibility_error = None
    try:
        proposed = receptor_experiments.plan(workspace, payload["selection"])
    except ValueError as error:
        # Recover choices only after revalidating the original selection and
        # complete experiment snapshot. Malformed IDs/cases still raise here.
        selected = receptor_experiments._selection(payload["selection"])
        captured = receptor_experiments.snapshot(workspace, selected["experiment_id"])
        chosen, groups, grid_id = receptor_experiments._group_cases(captured, selected)
        compatibility_error = str(error)
        proposed = {"id": None, "selection": selected, "snapshot": captured,
                    "grid_id": grid_id, "chosen_cases": chosen, "groups": groups,
                    "pending_cases": [row for row in chosen if row["state"] != "complete"]}
    profiles, scenarios, run_cache = {}, {}, {}
    for row in proposed["snapshot"]["cases"]:
        if row["kind"] != "landcover":
            continue
        profile = profiles.setdefault(row["profile_id"], {
            "id": row["profile_id"], "title": row["profile_title"],
            "baseline_run_id": row["baseline_run_id"], "complete_cases": 0,
            "total_cases": 0, "completed_runs": {}})
        profile["total_cases"] += 1
        profile["complete_cases"] += row["state"] == "complete"
        profile["baseline"] = _native_plan_run(workspace, profile["baseline_run_id"], run_cache)
        if row["state"] == "complete":
            profile["completed_runs"][row["run_id"]] = {
                **_native_plan_run(workspace, row["run_id"], run_cache),
                "scenario_id": row["scenario_id"], "scenario_title": row["scenario_title"]}
        scenarios.setdefault(row["scenario_id"], {"id": row["scenario_id"], "title": row["scenario_title"]})
    choices = []
    for profile in profiles.values():
        choices.append({**profile, "completed_runs": list(profile["completed_runs"].values())})
    groups = []
    for group in proposed["groups"]:
        groups.append({
            **{key: group[key] for key in ("id", "profile_id", "profile_title", "baseline_run_id")},
            "baseline": _native_plan_run(workspace, group["baseline_run_id"], run_cache),
            "alternative_run_ids": [row["run_id"] for row in group["cases"]],
            "alternatives": [{**_native_plan_run(workspace, row["run_id"], run_cache),
                              "scenario_id": row["scenario_id"], "scenario_title": row["scenario_title"]}
                             for row in group["cases"]],
        })
    return {"id": proposed["id"], "grid_id": proposed["grid_id"],
            "compatible": compatibility_error is None, "compatibility_error": compatibility_error,
            "experiment_id": proposed["selection"]["experiment_id"],
            "selected_cases": len(proposed["chosen_cases"]), "pending_cases": len(proposed["pending_cases"]),
            "profiles": choices, "scenarios": list(scenarios.values()), "groups": groups}


def _native_execution_rows(binding):
    if not binding:
        return []
    from model import native_versions
    return [{"run_id": run_id, "model": model,
             "label": native_versions.version_label(info),
             "stage_completed_at": info.get("stage_completed_at"),
             "reused_from": deepcopy(info.get("reused_from"))}
            for run_id, models in binding.get("native_version_provenance", {}).get("runs", {}).items()
            for model, info in models.items()]

def read(operator, workspace_key, operation, payload):
    workspace = operator.ws(workspace_key)
    if operation == "catalog":
        return _catalog(operator, workspace_key)
    if operation == "plan":
        return _plan(workspace, payload)
    if operation == "programme-plan":
        from model import receptor_programmes
        return receptor_programmes.preview(workspace, payload["selection"])
    if operation == "network-plan":
        return _network_plan(workspace, payload["selection"])
    if operation in ("comparison", "inventory", "network", "source-areas", "programme", "report-source"):
        key = payload.get(operation + "_id") or payload.get("id")
        return _decorate(operator, workspace_key, operation, _record(workspace, operation, identifier(key)))
    raise ValueError("Choose a registered source-water read")


def _export(workspace, kind, key):
    result = _record(workspace, kind, identifier(key))
    members = _members(workspace, kind, result)
    identity = {"schema": "upstate.receptor-result-package/v1", "workspace_id": workspace.project["id"],
                "kind": kind, "result_id": key,
                "members": {path: {"bytes": value["bytes"], "sha256": value["sha256"]}
                            for path, value in sorted(members.items())}}
    package_id = digest(identity)
    directory = workspace.root / "receptor-packages" / package_id
    directory.mkdir(parents=True, exist_ok=True)
    with held(directory / ".package.lock", blocking=False):
        state_path = directory / "package.json"
        if state_path.exists():
            saved = read_json(state_path)
            if saved["id"] != package_id or saved["workspace_id"] != workspace.project["id"]:
                raise ValueError("Saved package belongs to another source-water result")
            verify_file(directory, saved["files"]["archive"])
            return saved
        destination = directory / "source-water-results.zip"
        pending = directory / ".source-water-results.zip.pending"
        report = _folder(kind) + "/" + key + "/index.html"
        package_description = ("Original source geometry, watershed links, editable memberships and saved source selections are included."
            if kind in ("network", "source-areas", "report-source") else "Editable GeoPackages, memberships, physical quantities and original result records are included.")
        cover = ('<!doctype html><html lang="en"><meta charset="utf-8"><title>Source-water results</title>'
                 '<style>body{font:16px system-ui;max-width:850px;margin:40px auto;padding:0 24px;color:#222}a{color:inherit}</style>'
                 "<h1>" + escape(result["title"]) + "</h1><p><a href=\"" + escape(report, quote=True)
                 + "\">Open the complete source-water report</a></p><p>All report links resolve within this extracted package. "
                 + escape(package_description) + "</p></html>\n").encode("utf-8")
        manifest = {**identity, "id": package_id, "entrypoint": "index.html"}
        try:
            with zipfile.ZipFile(pending, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=3, allowZip64=True) as archive:
                archive.writestr("index.html", cover)
                for path, item in sorted(members.items()):
                    original = relative_file(workspace.root, path)
                    h, count = hashlib.sha256(), 0
                    with original.open("rb") as source, archive.open(path, "w", force_zip64=True) as target:
                        for block in iter(lambda: source.read(1024 * 1024), b""):
                            target.write(block)
                            h.update(block)
                            count += len(block)
                    if count != item["bytes"] or h.hexdigest() != item["sha256"]:
                        raise ValueError("A source-water product changed during package capture: " + path)
                manifest["cover"] = {"bytes": len(cover), "sha256": hashlib.sha256(cover).hexdigest()}
                archive.writestr("PACKAGE.json", canonical(manifest) + b"\n")
            # Owned staging output; complete source files remain unmodified.
            pending.replace(destination)
            saved = {**manifest, "title": result["title"], "files": {
                "archive": describe_file(directory, destination)}}
            atomic_json(state_path, saved)
            return saved
        finally:
            pending.unlink(missing_ok=True)


def _task_result(kind, result):
    value = {key: result[key] for key in ("id", "title", "grid_id", "files", "source_collection_id", "programme_id", "experiment_id", "preparation_id") if key in result}
    value.update(_kind=kind, state=result.get("state", "complete"),
                 counts=result.get("counts", {"areas": len(result.get("areas", [])),
                    "scenario_rows": result.get("membership_rows", len(result.get("scenario_exports", [])))}))
    return value


def invoke(operator, workspace_key, action, payload):
    workspace = operator.ws(workspace_key)
    if action == "receptor.report-source.build":
        from model import receptor_report_source
        return _task_result("report-source", receptor_report_source.build(workspace, payload["selection"]))
    if action == "receptor.programme.create":
        from model import receptor_programmes
        return _task_result("programme", receptor_programmes.create(workspace, payload["selection"],
                            expected_preview_id=payload.get("expected_preview_id")))
    if action == "receptor.programme.compare":
        from model import receptor_programmes
        return _task_result("comparison", receptor_programmes.compare(workspace, payload["source_water_programme_id"]))
    if action == "receptor.source-areas.prepare":
        from model import receptor_scenarios
        return _task_result("source-areas", receptor_scenarios.build(workspace, payload["selection"]))
    if action == "receptor.scenario.save":
        from model import receptor_scenarios
        result = receptor_scenarios.save_scenario(workspace, payload["preparation_id"], payload["selection"])
        return {**result, "preparation_id": payload["preparation_id"]}
    if action == "receptor.network.build":
        from model.receptor_network_cli import build
        selected = payload["selection"]
        source, spec = _network_selection(workspace, selected)
        return _task_result("network", build(source, spec, workspace.root / "receptor-networks",
            member=selected.get("member"), expected_decoded_sha256=selected.get("expected_decoded_sha256")))
    if action == "receptor.inventory.build":
        from model.receptor_cli import build as build_inventory
        return _task_result("inventory", build_inventory(workspace, payload["selection"]))
    if action == "receptor.experiment.build":
        from model import receptor_experiments
        return _task_result("comparison", receptor_experiments.build(workspace, payload["selection"]))
    if action == "receptor.package.export":
        result = _export(workspace, payload["kind"], payload["id"])
        return {key: result[key] for key in ("id", "title", "workspace_id", "kind", "result_id", "files")}
    raise ValueError("Choose a registered source-water action")


def decorate_task(operator, task):
    if task.get("state") != "complete" or task.get("action") not in ACTIONS:
        return task
    workspace_key = task["workspace"]
    result = task["result"]
    if task["action"] == "receptor.scenario.save":
        task["_source_water_scenario"] = {"kind": "scenarios", "id": result["id"],
                                          "preparation_id": result["preparation_id"]}
        return task
    if task["action"] == "receptor.package.export":
        workspace = operator.ws(workspace_key)
        item = result["files"]["archive"]
        directory = workspace.root / "receptor-packages" / result["id"]
        task["_downloads"] = [operator._ticket(workspace_key, directory / item["path"], item,
                                               "Complete source-water results package")]
    else:
        kind = result["_kind"]
        workspace = operator.ws(workspace_key)
        folder = _folder(kind)
        scope = workspace.root / folder / identifier(result["id"])
        # State polling only creates existing tickets; full product inspection
        # occurs when the result is opened or exported.
        task["_downloads"] = [
            operator._ticket(workspace_key, relative_file(scope, item["path"]), item, label)
            for label, item in result["files"].items()
            if item["path"].endswith((".csv", ".json"))]
        task["_source_water"] = {"kind": kind, "id": result["id"]}
    return task


def verify_workspace(workspace):
    """Check extension identities/references after the original archive checks."""
    counts = {}
    for kind, folder in FOLDERS.items():
        rows = _summaries(workspace, folder)
        for row in rows:
            if kind == "report-source":
                _record(workspace, kind, row["id"])
            directory = workspace.root / folder / row["id"]
            record = read_json(directory / "result.json")
            records = [({**item, "path": (Path(folder) / row["id"] / item["path"]).as_posix()})
                       for item in record["files"].values()]
            if kind == "comparison":
                for group in record["groups"]:
                    if group["state"] == "complete":
                        records.extend(group["files"].values())
            for item in records:
                path = relative_file(workspace.root, item["path"])
                if path.stat().st_size != item["bytes"]:
                    raise ValueError("Received source-water product length differs: " + item["path"])
        counts[folder] = len(rows)
    return counts
