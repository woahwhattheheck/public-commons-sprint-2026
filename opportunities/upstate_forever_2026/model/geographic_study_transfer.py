"""Retain editable Geographic cases behind selected scientific report sources.

This resolver reads the original records and CAS objects without preparing a
case, creating source views, running a model, or consulting donor executables.
Completed reference reports may retain unfinished sensitivity designs.
"""
from __future__ import annotations

from pathlib import PurePosixPath

from .common import digest, identifier

ALLOCATION = "urn:upstate:geographic-scenario-allocation:"
INTERPRETATION = "urn:upstate:geographic-scenario-interpretation:"
CONTEXT_KIND = "geographic_editable_case"


def _member(value):
    if not isinstance(value, str) or "\\" in value or "\0" in value:
        raise ValueError("Geographic source requires an original relative member")
    path = PurePosixPath(value)
    if not path.parts or path.is_absolute() or ".." in path.parts or path.as_posix() != value:
        raise ValueError("Geographic member leaves its original Workspace")
    return value


def _same(left, right):
    return all(left.get(key) == right.get(key) for key in ("bytes", "sha256"))


def _read_body(closure, descriptor):
    closure.add_file(descriptor["object"], descriptor)
    return closure.read(descriptor["object"])


def _members(closure, entry, recipe):
    members = {}
    for item in entry.get("companions", []):
        name = _member(item.get("view_path", item["filename"]))
        if name in members:
            raise ValueError("Geographic source repeats an original companion")
        members[name] = item
        closure.add_file(item["object"], item)
    requested = recipe.get("inputs")
    if not isinstance(requested, list):
        raise ValueError("Geographic source lacks its complete original input inventory")
    seen = set()
    for item in requested:
        name = _member(item["path"])
        if name in seen or name not in members or not _same(item, members[name]):
            raise ValueError("Geographic report lost its original companion: " + name)
        seen.add(name)
    if seen != set(members):
        raise ValueError("Geographic report and source inventories differ")
    return members


def _body(closure, members, name):
    if name not in members:
        raise ValueError("Geographic report lacks original " + name)
    return _read_body(closure, members[name])


def _collection(closure, choice):
    key = identifier(choice["source_collection_id"])
    record = closure.read("sources/" + key + ".json")
    if record.get("schema") != "upstate.sources/v1" or digest(record) != key:
        raise ValueError("Geographic original source collection changed")
    entries = [item for item in record.get("entries", []) if item.get("id") == choice["source_id"]]
    if len(entries) != 1:
        raise ValueError("Geographic source selection lost its exact original entry")
    closure.need("sources", key, "Original Geographic source edition")
    return record, entries[0]


def _entry_identity(entry):
    members = {}
    for item in [entry["body"], *entry.get("companions", [])]:
        name = _member(item.get("view_path", item["filename"]))
        if name in members:
            raise ValueError("Geographic source repeats an original member")
        members[name] = {key: item[key] for key in ("bytes", "sha256")}
    return {"id": entry["id"], "kind": entry.get("kind"), "role": entry.get("role"),
            "uri": entry.get("uri"), "metadata": entry.get("metadata", {}),
            "members": members}


def _node(closure, kind, key, title, reason):
    token = (kind, key)
    previous = closure.nodes.get(token)
    if previous:
        if reason not in previous["reasons"]:
            previous["reasons"].append(reason)
    else:
        closure.nodes[token] = {"kind": kind, "id": key, "title": title,
                                "reasons": [reason]}


def _immutable(closure, kind, key):
    key = identifier(key)
    raw = closure.read(kind + "/" + key + ".json")
    if raw.get("schema") != "upstate." + kind + "/v1" or digest(raw) != key:
        raise ValueError("Geographic original " + kind + " identity changed")
    return {**raw, "id": key}


def _footprint(closure, key, run_id):
    value = _immutable(closure, "scenario-footprints", key)
    request = value["request"]
    if value.get("run_id") != run_id or request.get("run_id") != run_id:
        raise ValueError("Geographic footprint belongs to another original run")
    run = closure.read("runs/" + identifier(run_id) + "/run.json")
    if value.get("selection") != run.get("selection") or request.get("selection") != run.get("selection"):
        raise ValueError("Geographic footprint and retained run selections differ")
    prefix = "scenario-footprint-output/" + digest(request) + "/"
    manifest = closure.read(prefix + "complete.json")
    if (manifest.get("schema") != "upstate.scenario-footprint-files/v1"
            or manifest.get("request") != request):
        raise ValueError("Geographic footprint lost its native completion manifest")
    if set(manifest.get("files", {})) != set(value.get("files", {})):
        raise ValueError("Geographic footprint changed its original output roster")
    for name, item in manifest["files"].items():
        relative = _member(item["path"])
        original = value["files"][name]
        if original.get("path") != prefix + relative or not _same(original, item):
            raise ValueError("Geographic footprint output changed")
        closure.add_file(prefix + relative, item)
    report = closure.read(prefix + "footprint.json")
    if (report.get("request") != request or report.get("run_id") != run_id
            or report.get("summary") != value.get("summary")):
        raise ValueError("Geographic footprint summary differs from the compiled original")
    closure.tree(prefix.rstrip("/"))
    closure._source_refs(request, "Original compiled Geographic footprint inputs")
    if value.get("coefficient_source_collection_id"):
        closure.need("sources", value["coefficient_source_collection_id"],
                     "Original Geographic footprint coefficients")
    _node(closure, "scenario-footprints", key, value.get("title", key),
          "Compiled Geographic land-cover scenario")
    return value


def _ensemble(closure, prepared):
    """Retain the original native programme, including unfinished members.

    This reads raw retained records only. It never invokes Ensembles.inspect,
    report_data, a source view, a model, or the parameter-course receiver.
    Historic result editions bind their original archives; current editable
    analysis/report progress is allowed to have advanced since those editions.
    """
    from . import ensemble_study_transfer as original
    from .common import digest, identifier

    key = identifier(prepared["ensemble_id"])
    prefix = "ensemble_results/" + key
    raw = closure.read("ensembles/" + key + ".json")
    if raw.get("schema") != "upstate.ensembles/v1" or digest(raw) != key:
        raise ValueError("Geographic programme lost its original immutable design")
    plan = dict(raw, id=key)
    scenarios = [prepared["baseline_scenario_id"], *prepared["alternative_scenario_ids"]]
    selected = [prepared["baseline_run_id"], *prepared["alternative_run_ids"]]
    if (plan.get("grid_id") != prepared["grid_id"]
            or plan.get("baseline_scenario_id") != scenarios[0]
            or plan.get("alternative_scenario_ids") != scenarios[1:]
            or plan.get("scenario_ids") != scenarios
            or plan.get("base_profile_ids") != [prepared["profile_id"]]
            or not isinstance(plan.get("members"), list) or not plan["members"]):
        raise ValueError("Geographic programme changed its prepared native selection")
    closure.need("grids", prepared["grid_id"], "Original geographic programme grid")
    runs, members = {}, {}
    for member in plan["members"]:
        member_id = identifier(member["id"])
        profile_id = identifier(member["profile_id"])
        if member_id in members:
            raise ValueError("Geographic programme repeats a native member")
        members[member_id] = member
        choices = member.get("runs")
        if (not isinstance(choices, list)
                or [row.get("scenario_id") for row in choices] != scenarios):
            raise ValueError("Geographic programme changed its original scenario order")
        for profile in {profile_id, member.get("parent_profile_id")} - {None}:
            closure.need("profiles", identifier(profile), "Original geographic parameter profile")
        for choice in choices:
            run_id = identifier(choice["run_id"])
            if run_id in runs:
                raise ValueError("Geographic programme repeats a native selection")
            run = closure.read("runs/" + run_id + "/run.json")
            expected = {"grid_id": prepared["grid_id"], "profile_id": profile_id,
                        "scenario_id": choice["scenario_id"]}
            if (run.get("id") != run_id or not isinstance(run.get("selection"), dict)
                    or any(run["selection"].get(name) != value for name, value in expected.items())):
                raise ValueError("Geographic programme member changed its actual native binding")
            runs[run_id] = run
            closure.need("runs", run_id, "Original geographic programme member and progress")
            closure.need("scenarios", choice["scenario_id"], "Original geographic scenario")
    first = plan["members"][0]
    if (first["profile_id"] != prepared["profile_id"]
            or [row["run_id"] for row in first["runs"]] != selected):
        raise ValueError("Geographic reference trio differs from its first native member")

    # Capture the whole owned result tree, including pair summaries, exports,
    # immutable result editions and any interrupted current progress.
    closure.tree(prefix)
    state = closure.read(prefix + "/state.json")
    if state.get("schema") != "upstate.ensemble-state/v1" or state.get("ensemble_id") != key:
        raise ValueError("Geographic programme progress belongs to another design")
    reason = "Original editable geographic parameter programme"
    node = closure.nodes.setdefault(("ensembles", key), {
        "kind": "ensembles", "id": key, "title": plan["title"],
        "state": state.get("state"), "reasons": []})
    if reason not in node["reasons"]:
        node["reasons"].append(reason)

    def optional(relative):
        path = closure.root / relative
        return closure.read(relative) if path.exists() or path.is_symlink() else None

    comparisons = set()
    def comparison(comparison_id, expected_runs):
        comparison_id = identifier(comparison_id)
        value = closure.read("comparisons/" + comparison_id + "/comparison.json")
        actual = [value.get("baseline_run_id"),
                  *[row.get("run_id") for row in value.get("alternatives", [])]]
        if actual != expected_runs or any(run_id not in runs for run_id in actual):
            raise ValueError("Geographic comparison changed its original ordered native cohort")
        if comparison_id not in comparisons:
            original._captured_comparisons({comparison_id: value}, runs)
            original._local_comparison(closure, comparison_id, value, runs)
            comparisons.add(comparison_id)
        return value

    # Every retained original pair summary names the comparison it computed.
    # This includes parameter-baseline contrasts absent from state.comparisons.
    pair_prefix = prefix + "/pairs/"
    for relative in tuple(closure.trees[prefix]):
        if not relative.startswith(pair_prefix) or not relative.endswith(".json"):
            continue
        pair = closure.read(relative)
        identity = pair.get("identity")
        if (pair.get("schema") != "upstate.ensemble-pair/v1" or not isinstance(identity, dict)
                or relative != pair_prefix + digest(identity) + ".json"
                or identity.get("grid_id") != prepared["grid_id"]):
            raise ValueError("Geographic pair summary lost its original identity")
        ids = []
        for role in ("baseline", "alternative"):
            bound = identity[role]
            run_id = identifier(bound["id"])
            if run_id not in runs:
                raise ValueError("Geographic pair refers to an unselected native member")
            for name, descriptor in bound["artifacts"].items():
                if runs[run_id].get("artifacts", {}).get(name) != descriptor:
                    raise ValueError("Geographic paired native output changed")
                closure._descriptors(descriptor, "runs/" + run_id + "/")
            ids.append(run_id)
        comparison(pair["comparison_id"], ids)

    for member_id, rows in state.get("comparisons", {}).items():
        member = members.get(member_id)
        if member is None or not isinstance(rows, list):
            raise ValueError("Geographic progress names another original member")
        by_scenario = {row["scenario_id"]: row["run_id"] for row in member["runs"]}
        for row in rows:
            scenario = row["scenario_id"]
            if scenario not in scenarios[1:]:
                raise ValueError("Geographic progress comparison changed its scenario")
            comparison(row["comparison_id"], [by_scenario[scenarios[0]], by_scenario[scenario]])

    course = closure.read(prefix + "/headwaters-course.json")
    bound = {"grid_id": prepared["grid_id"], "base_profile_id": prepared["profile_id"],
             "baseline_scenario_id": scenarios[0], "alternative_scenario_ids": scenarios[1:]}
    collection_id = identifier(prepared["source_collection_id"])
    collection = closure.read("sources/" + collection_id + ".json")
    if (course.get("schema") != "upstate.headwaters-parameter-course/v1"
            or course.get("study_id") != "routing-lmax-v1"
            or course.get("project_id") != closure.workspace.project["id"]
            or course.get("ensemble_id") != key or course.get("selection") != bound
            or course.get("selection_sha256") != digest(bound)
            or course.get("input_source_collection_id") != collection_id
            or course.get("input_manifest_sha256") != collection["original_manifest"]["sha256"]):
        raise ValueError("Geographic parameter course changed its original inputs")
    closure.need("sources", collection_id, "Original geographic parameter-course input edition")

    def operation(value):
        if not isinstance(value, dict) or value.get("ensemble_id") != key:
            raise ValueError("Geographic operation belongs to another native programme")
        # The original validator follows reports, paired selections, current
        # editable trees and archive descriptors. An old report signature may
        # no longer describe the live reports.json; its immutable archive binds
        # that edition while the live analysis retains its current progress.
        original._local_paired_products(closure, plan, operation=value)

    def historical_operation(value):
        if not isinstance(value, dict) or value.get("ensemble_id") != key:
            raise ValueError("Historic geographic operation belongs to another programme")
        scalar = value.get("report")
        if scalar is not None:
            original._local_release(closure, identifier(scalar["id"]), key)
            closure._descriptors(scalar.get("files", {}),
                                 "ensemble_reports/" + scalar["id"] + "/")
        for archived in value.get("archives", []):
            if archived.get("archive") is not None:
                closure._descriptors(archived["archive"])
        for product in value.get("raster_products", []):
            paired_product(product, require_archive=value.get("state") == "complete")

    def paired_product(product, *, require_archive=False):
        if not product.get("analysis_id"):
            return
        analysis_id = identifier(product["analysis_id"])
        paired_prefix = "ensemble-products/" + analysis_id
        analysis = closure.read(paired_prefix + "/analysis.json")
        choice = analysis.get("selection", {})
        refs = choice.get("source_references", {})
        scenario = product.get("scenario_id")
        if (analysis.get("schema") != "upstate.paired-raster-ensemble/v1"
                or analysis.get("id") != analysis_id or digest(choice) != analysis_id
                or choice.get("input_kind") != "original Workspace native run artifacts"
                or refs.get("project_id") != closure.workspace.project["id"]
                or refs.get("grid_id") != prepared["grid_id"]
                or (refs.get("baseline_scenario") or {}).get("id") != scenarios[0]
                or (refs.get("alternative_scenario") or {}).get("id") != scenario
                or scenario not in scenarios[1:]):
            raise ValueError("Historic paired product changed its original native selection")
        expected = {}
        for member in plan["members"]:
            by_scenario = {row["scenario_id"]: row["run_id"] for row in member["runs"]}
            expected[member["profile_id"]] = (by_scenario[scenarios[0]], by_scenario[scenario], scenario)
        actual = {}
        selected_members = choice.get("members")
        if not isinstance(selected_members, list) or not selected_members:
            raise ValueError("Historic paired product lost its selected native members")
        for member in selected_members:
            profile = identifier(member["profile_id"])
            if profile in actual:
                raise ValueError("Historic paired product repeats a selected profile")
            actual[profile] = (member["baseline_run_id"], member["alternative_run_id"], member["scenario_id"])
        if (any(expected.get(profile) != selected for profile, selected in actual.items())
                or choice.get("planned_member_count") != len(plan["members"])
                or choice.get("selected_member_count") != len(selected_members)):
            raise ValueError("Historic paired product changed its planned or selected roster")
        closure.tree(paired_prefix)
        closure._descriptors(analysis.get("artifacts", {}), paired_prefix + "/")
        if product.get("archive") is not None:
            closure._descriptors(product["archive"])
        elif require_archive and product.get("state") == "complete":
            raise ValueError("Completed historic paired product lost its original archive")
        live_report = optional(paired_prefix + "/reports.json")
        if live_report is not None:
            if live_report.get("ensemble_id") != analysis_id:
                raise ValueError("Current paired report belongs to another analysis")
            closure._descriptors(live_report.get("files", []), paired_prefix + "/")

    current_operation = optional(prefix + "/operation.json")
    if current_operation is not None:
        operation(current_operation)


    # A process can stop after the original tile-control checkpoint but before
    # operation.json receives its analysis_id. Preserve that same continuation.
    from .paired_ensemble.ensemble_store import digest as paired_digest
    selection_prefix = prefix + "/paired-selections/"
    for relative in tuple(closure.trees[prefix]):
        if not relative.startswith(selection_prefix) or not relative.endswith(".json"):
            continue
        scenario = relative[len(selection_prefix):-5]
        if scenario not in scenarios[1:]:
            raise ValueError("Geographic paired selection changed its original alternative")
        choice = closure.read(relative)
        pairs = choice.get("pairs")
        if not isinstance(pairs, list) or not pairs:
            raise ValueError("Geographic paired continuation lost its original selected pairs")
        expected_pairs = {}
        for member in plan["members"]:
            by_scenario = {row["scenario_id"]: row["run_id"] for row in member["runs"]}
            expected_pairs[member["profile_id"]] = (by_scenario[scenarios[0]], by_scenario[scenario])
        used = set()
        for pair in pairs:
            before = identifier(pair["baseline_run_id"])
            after = identifier(pair["alternative_run_id"])
            if before not in runs or after not in runs:
                raise ValueError("Geographic paired continuation names an unselected original run")
            profile = runs[before]["selection"]["profile_id"]
            if (profile in used or expected_pairs.get(profile) != (before, after)
                    or pair.get("profile_id", profile) != profile
                    or pair.get("scenario_id", scenario) != scenario):
                raise ValueError("Geographic paired continuation changed its original matched profile")
            used.add(profile)
        if choice.get("planned_member_count", len(pairs)) != len(plan["members"]):
            raise ValueError("Geographic paired continuation lost its complete planned count")
        control_prefix = "ensemble-products/controls/" + paired_digest(choice)
        control = optional(control_prefix + ".json")
        cancellation = closure.root / (control_prefix + ".cancel.json")
        if cancellation.exists() or cancellation.is_symlink():
            closure.add_file(control_prefix + ".cancel.json")
        if control is not None and control.get("id"):
            paired_product({"analysis_id": identifier(control["id"]), "scenario_id": scenario,
                            "state": control.get("state")})

    def course_result(value, *, historic=False):
        if (not isinstance(value, dict) or value.get("schema") != course["schema"]
                or value.get("project_id") != course["project_id"]
                or value.get("ensemble_id") != key or value.get("selection") != bound
                or value.get("input_classification") != course.get("input_classification")):
            raise ValueError("Geographic course result changed its original native binding")
        saved_operation = value.get("operation")
        if saved_operation is not None:
            if historic or saved_operation != current_operation:
                historical_operation(saved_operation)
            else:
                operation(saved_operation)
        joint = value.get("joint_decisions") or {}
        seen = set()
        for row in joint.get("comparisons", []):
            member = members.get(row.get("member_id"))
            if (member is None or member["id"] in seen or row.get("profile_id") != member["profile_id"]
                    or [row.get("baseline_run_id"), *row.get("alternative_run_ids", [])]
                    != [item["run_id"] for item in member["runs"]]):
                raise ValueError("Geographic joint result changed its original member cohort")
            seen.add(member["id"])
            comparison(row["comparison_id"], [item["run_id"] for item in member["runs"]])
        products = joint.get("support_group_reports") or ([joint["report"]] if joint.get("report") else [])
        for product in products:
            report_id = identifier(product["report_id"])
            report_prefix = prefix + "/joint-decisions/" + report_id
            manifest = closure.read(report_prefix + "/manifest.json")
            report = closure.read(report_prefix + "/report.json")
            if manifest.get("report_id") != report_id or report.get("id") != report_id:
                raise ValueError("Geographic joint export belongs to another report")
            closure._descriptors(manifest["members"], report_prefix + "/")
            archive = product["archive_identity"]
            if archive.get("path") != report_prefix + "/decision-package.zip":
                raise ValueError("Geographic joint archive changed its original owned path")
            closure._descriptors(archive)
            selection = closure.read(prefix + "/joint-decisions/" + report_id + "-selection.json")
            selected_comparisons = [selection["comparison_id"], *selection.get("sensitivity_comparison_ids", [])]
            if set(selected_comparisons) != {row["comparison_id"] for row in joint.get("comparisons", [])}:
                raise ValueError("Geographic joint export changed its complete comparison set")

    current_result = optional(prefix + "/headwaters-results.json")
    if current_result is not None:
        course_result(current_result)
    history_prefix = prefix + "/headwaters-result-editions/"
    for relative in tuple(closure.trees[prefix]):
        if relative.startswith(history_prefix) and relative.endswith(".json"):
            value = closure.read(relative)
            if relative != history_prefix + digest(value) + ".json":
                raise ValueError("Geographic course history changed its immutable edition")
            course_result(value, historic=True)
    for name, field in (("latest-report.json", "report_id"),
                        ("latest-scientific-study.json", "source_operation_id")):
        pointer = optional(prefix + "/" + name)
        if pointer is None:
            continue
        if pointer.get("ensemble_id") != key:
            raise ValueError("Geographic report pointer changed its original native design")
        if field == "report_id":
            original._local_release(closure, identifier(pointer[field]), key)
        else:
            source, unused = original._local_operation(
                closure, identifier(pointer[field]), key, closure.workspace.project["id"])
            original._local_release(closure, identifier(source["selection"]["report_id"]), key)
    return {"ensemble_id": key, "plan_sha256": closure.files["ensembles/" + key + ".json"]["sha256"],
            "selection_sha256": course["selection_sha256"], "run_ids": sorted(runs)}


def _prepared(closure, expected):
    key = identifier(expected.get("id"))
    prefix = "geographic-headwaters/" + key + "/"
    value = closure.read(prefix + "prepared.json")
    if (value != expected or value.get("schema") != "upstate.geographic-headwaters-prepared/v1"
            or value.get("project_id") != closure.workspace.project["id"]
            or value.get("state") != "prepared" or value.get("directory") != prefix.rstrip("/")):
        raise ValueError("Geographic report lost its exact original editable preparation")
    receipt = closure.read(prefix + "inputs/input-receipt.json")
    identity = receipt.get("identity")
    if (not isinstance(identity, dict) or identity.get("id") != key
            or digest({name: item for name, item in identity.items() if name != "id"}) != key
            or identity.get("schema") != "upstate.geographic-headwaters/v1"
            or identity.get("project_id") != value["project_id"]
            or identity.get("selection") != value.get("selection")
            or receipt.get("geography") != value.get("geography")
            or receipt.get("input_summary") != value.get("input_summary")):
        raise ValueError("Geographic preparation lost its immutable input identity")
    seen = set()
    for item in receipt.get("files", []):
        name = _member(item["path"])
        if name in seen:
            raise ValueError("Geographic input receipt repeats an original member")
        seen.add(name)
        # Original portable intentionally excludes synchronization files.
        if PurePosixPath(name).name.endswith(".lock"):
            continue
        closure.add_file(prefix + "inputs/" + name, item)
    if not seen:
        raise ValueError("Geographic preparation has no committed original inputs")
    closure.tree(prefix + "inputs")
    # Only committed input/output members are followed. Donor paths and the
    # original Node executable remain provenance, never receiving paths.
    closure.need("sources", value["source_collection_id"], "Original Geographic physical inputs")
    closure._source_refs(value["selection"], "Original Geographic source selectors")
    closure.need("grids", value["grid_id"], "Original Geographic prepared grid")
    closure.need("profiles", value["profile_id"], "Original Geographic reference parameters")
    run_ids = [value["baseline_run_id"], *value["alternative_run_ids"]]
    scenario_ids = [value["baseline_scenario_id"], *value["alternative_scenario_ids"]]
    footprints = value.get("scenario_footprint_ids")
    if len(run_ids) != 3 or len(scenario_ids) != 3 or not isinstance(footprints, list) or len(footprints) != 3:
        raise ValueError("Geographic case must retain its original baseline and two alternatives")
    for run_id, scenario_id, footprint_id in zip(run_ids, scenario_ids, footprints):
        closure.need("runs", run_id, "Original Geographic reference cohort")
        closure.need("scenarios", scenario_id, "Original editable Geographic scenario")
        run = closure.read("runs/" + identifier(run_id) + "/run.json")
        selection = run.get("selection", {})
        if (selection.get("grid_id") != value["grid_id"] or selection.get("profile_id") != value["profile_id"]
                or selection.get("scenario_id") != scenario_id or digest(selection) != run_id):
            raise ValueError("Geographic prepared run differs from its original selection")
        _footprint(closure, footprint_id, run_id)
    _ensemble(closure, value)
    _node(closure, "geographic-headwaters", key, value["selection"]["title"],
          "Editable Geographic case and complete original input receipt")
    return value


def _receiving_context(closure, key, prepared, allocation_id):
    key = identifier(key)
    prefix = "geographic-receiving-contexts/" + key + "/"
    record = closure.read(prefix + "context.json")
    identity = closure.read(prefix + "selection.json")
    prepared_file = closure.files["geographic-headwaters/" + prepared["id"] + "/prepared.json"]
    receipt_file = closure.files["geographic-headwaters/" + prepared["id"] + "/inputs/input-receipt.json"]
    if (record.get("schema") != "upstate.geographic-receiving-context/v1"
            or record.get("id") != key or record.get("state") != "complete"
            or record.get("identity") != identity or digest(identity) != key
            or record.get("project_id") != prepared["project_id"]
            or record.get("prepared_id") != prepared["id"]
            or identity.get("prepared_sha256") != prepared_file["sha256"]
            or identity.get("original_input_receipt", {}).get("sha256") != receipt_file["sha256"]
            or record.get("baseline_run_id") != prepared["baseline_run_id"]
            or record.get("alternative_run_ids") != prepared["alternative_run_ids"]
            or record.get("allocation", {}).get("id") != allocation_id):
        raise ValueError("Geographic allocation lost its original Receiving context")
    from . import receiving_water_report_transfer
    for plan_id in record["plan_ids"].values():
        closure.need("receiving-water-plans", plan_id, "Original Geographic Receiving plan")
    for item in record["analyses"]:
        analysis_id = identifier(item["analysis_id"])
        closure.need("receiving-water-analyses", analysis_id, "Original Geographic Receiving quantity cohort")
        analysis = closure.read("receiving-water-analyses/" + analysis_id + "/analysis.json")
        if (analysis.get("plan_id") != record["plan_ids"][item["relationship"]]
                or analysis.get("state") != "complete"
                or analysis.get("quantity_scope") != item["quantity_scope"]
                or analysis.get("baseline_run_id") != record["baseline_run_id"]
                or analysis.get("alternative_run_ids") != record["alternative_run_ids"]):
            raise ValueError("Geographic context identifies another native quantity analysis")
        capture = closure.read("receiving-water-report-sources/" + identifier(item["report_source_id"]) + "/report.json")
        if capture.get("source") != item["source"] or capture.get("selection", {}).get("analysis_id") != analysis_id:
            raise ValueError("Geographic context changed its original report source")
        _, entry = _collection(closure, item["source"])
        if not receiving_water_report_transfer.include_source(closure, item["source"]["source_collection_id"], entry):
            raise ValueError("Geographic context source is not the original Receiving producer")
    closure.tree(prefix.rstrip("/"))
    _node(closure, "geographic-receiving-contexts", key, prepared["selection"]["title"],
          "Original Geographic Receiving analyses and source progress")
    return record


def _allocation(closure, entry, recipe, members, key):
    report = _body(closure, members, "allocation.json")
    identity = report.get("identity")
    prepared = _body(closure, members, "original-prepared.json")
    context_identity = _body(closure, members, "original-context-selection.json")
    metadata = entry["metadata"]
    if (report.get("schema") != "upstate.geographic-scenario-allocation/v1"
            or report.get("id") != key or not isinstance(identity, dict) or digest(identity) != key
            or report.get("project_id") != metadata.get("project_id")
            or recipe.get("project_id") != report["project_id"]
            or report.get("prepared_id") != prepared.get("id")
            or metadata.get("geographic_preparation_id") != prepared.get("id")
            or report.get("context_id") != metadata.get("context_id")
            or digest(context_identity) != report.get("context_id")
            or identity.get("prepared_sha256") != members["original-prepared.json"]["sha256"]):
        raise ValueError("Allocation source lost its exact original case identity")
    identifier(prepared["id"])
    identifier(prepared["ensemble_id"])
    if not isinstance(report.get("project_id"), str) or not report["project_id"]:
        raise ValueError("Geographic allocation lost its original project")
    local = report["project_id"] == closure.workspace.project["id"]
    if local:
        _prepared(closure, prepared)
        prefix = "geographic-scenario-allocations/" + key + "/"
        record = closure.read(prefix + "result.json")
        if (record.get("schema") != report["schema"] or record.get("id") != key
                or record.get("state") != "complete" or record.get("identity") != identity
                or record.get("project_id") != report["project_id"]
                or record.get("prepared_id") != prepared["id"]
                or record.get("context_id") != report["context_id"]
                or record.get("directory") != prefix.rstrip("/")):
            raise ValueError("Allocation report lost its completed native record")
        for item in record.get("files", []):
            closure.add_file(prefix + _member(item["path"]), item)
        if closure.read(prefix + "allocation.json") != report:
            raise ValueError("Native allocation and imported report differ")
        captured = closure.read(prefix + "prepared-source.json")
        if captured.get("identity") != identity:
            raise ValueError("Allocation source intent differs from its original record")
        for item in captured.get("files", []):
            closure.add_file(prefix + _member(item["path"]), item)
        _, original_entry = _collection(closure, record["source"])
        if _entry_identity(original_entry) != _entry_identity(entry):
            raise ValueError("Selected allocation differs from its original imported source")
        native_manifest = closure.read(prefix + "sources.json")
        authored = native_manifest.get("entries", [])
        if (native_manifest.get("schema") != "upstate.sources/v1" or len(authored) != 1
                or authored[0].get("id") != entry["id"]
                or authored[0].get("metadata") != metadata
                or authored[0].get("uri") != entry["uri"]
                or authored[0].get("sha256") != entry["body"]["sha256"]
                or authored[0].get("companions") != recipe["inputs"]):
            raise ValueError("Allocation source import differs from its native manifest")
        for name, descriptor in {"report-source.json": entry["body"], **members}.items():
            closure.add_file(prefix + name, descriptor)
        context = _receiving_context(closure, report["context_id"], prepared, key)
        if context["identity"] != context_identity or context["allocation"]["source"] != record["source"]:
            raise ValueError("Allocation report and original context source differ")
        closure.tree(prefix.rstrip("/"))
        _node(closure, "geographic-scenario-allocations", key, report["title"],
              "Original local allocation and same-cell native contrast source")
    return {"project_id": report["project_id"], "prepared_id": prepared["id"],
            "allocation_id": key, "context_id": report["context_id"],
            "ensemble_id": prepared["ensemble_id"], "local": local}


def _interpretation_contexts(closure, entry, members, prepared):
    """Retain original in-Workspace source wrappers without following external jobs."""
    root = closure.root / "geographic-scenario-contexts"
    if not root.exists():
        return
    for path in sorted(root.glob("*/context.json")):
        # A matching original source may have been equivalently reimported;
        # body identity, not the receiving collection ID, determines membership.
        from .common import read_json
        candidate = read_json(path)
        if candidate.get("prepared_id") != prepared["id"]:
            continue
        choice = candidate.get("source")
        if not isinstance(choice, dict):
            raise ValueError("Original Geographic interpretation context lost its source")
        collection_id = identifier(choice["source_collection_id"])
        raw_collection = read_json(closure.root / "sources" / (collection_id + ".json"))
        candidates = [item for item in raw_collection.get("entries", []) if item.get("id") == choice["source_id"]]
        if len(candidates) != 1 or _entry_identity(candidates[0]) != _entry_identity(entry):
            continue
        _, original = _collection(closure, choice)
        relative = path.relative_to(closure.root).as_posix()
        record = closure.read(relative)
        request = record.get("request")
        key = identifier(path.parent.name)
        if (record.get("schema") != "upstate.geographic-scenario-context/v1"
                or record.get("state") != "complete" or record.get("id") != key
                or not isinstance(request, dict) or digest(request) != key
                or record.get("project_id") != prepared["project_id"]
                or request.get("project_id") != prepared["project_id"]
                or request.get("prepared_id") != prepared["id"]
                or request.get("ensemble_id") != prepared["ensemble_id"]
                or record.get("ensemble_id") != prepared["ensemble_id"]
                or not _same(record.get("recipe", {}), entry["body"])):
            raise ValueError("Original Geographic interpretation request changed")
        collection, _ = _collection(closure, choice)
        if not _same(record["source_manifest"], collection["original_manifest"]):
            raise ValueError("Original Geographic interpretation manifest changed")
        available = {"observed-report.json": entry["body"], **members,
                     "sources.json": collection["original_manifest"]}
        for item in record.get("files", []):
            name = _member(item["path"])
            if name not in available or not _same(item, available[name]):
                raise ValueError("Original Geographic interpretation lost a produced member")
        prefix = "geographic-headwaters/" + prepared["id"] + "/"
        for name, descriptor in request.get("inputs", {}).items():
            closure.add_file(prefix + _member(descriptor["path"]), descriptor)
            if "originals/" + name not in members or not _same(descriptor, members["originals/" + name]):
                raise ValueError("Original interpretation input differs from its retained case")
        closure.tree(path.parent.relative_to(closure.root).as_posix())


def _interpretation(closure, entry, recipe, members, key):
    report = _body(closure, members, "interpretation.json")
    prepared = _body(closure, members, "originals/geographic-prepared.json")
    if (report.get("schema") != "upstate.geographic-scenario-interpretation/v1"
            or recipe.get("interpretation_kind") != "modeled_scenario_source_context"
            or recipe.get("edition") != prepared.get("id")
            or report.get("project_id") != prepared.get("project_id")
            or report.get("geographic_preparation_id") != prepared.get("id")
            or report.get("ensemble_id") != prepared.get("ensemble_id")
            or report.get("grid_id") != prepared.get("grid_id")
            or report.get("input_source_collection_id") != prepared.get("source_collection_id")
            or report.get("original_run_selection") != {"baseline": prepared.get("baseline_run_id"),
                                                       "alternatives": prepared.get("alternative_run_ids")}
            or entry.get("metadata", {}).get("quantity_basis") != "modeled_source_loading"
            or entry.get("id") != "geographic-scenario-source-report-" + key):
        raise ValueError("Geographic interpretation lost its original input binding")
    identifier(prepared["id"])
    identifier(prepared["ensemble_id"])
    if not isinstance(prepared.get("project_id"), str) or not prepared["project_id"]:
        raise ValueError("Geographic source lost its original project")
    local = prepared["project_id"] == closure.workspace.project["id"]
    if local:
        _prepared(closure, prepared)
        prefix = "geographic-headwaters/" + prepared["id"] + "/"
        for name, relative in (("matching-summary.json", "inputs/matched-control/matching-summary.json"),
                               ("biophysical.csv", "inputs/biophysical.csv"),
                               ("input-receipt.json", "inputs/input-receipt.json")):
            descriptor = members.get("originals/" + name)
            if descriptor is None:
                raise ValueError("Geographic interpretation omitted original " + name)
            closure.add_file(prefix + relative, descriptor)
        _interpretation_contexts(closure, entry, members, prepared)
    return {"project_id": prepared["project_id"], "prepared_id": prepared["id"],
            "interpretation_id": key, "ensemble_id": prepared["ensemble_id"], "local": local}


def include_source(closure, collection_id, entry):
    uri = entry.get("uri", "")
    if not isinstance(uri, str) or not uri.startswith((ALLOCATION, INTERPRETATION)):
        return False
    if entry.get("kind") != "document" or entry.get("role") != "OBSERVED_CONTEXT":
        raise ValueError("Geographic report changed its original source type")
    recipe = _read_body(closure, entry["body"])
    if recipe.get("schema") != "upstate.observed-report/v1":
        raise ValueError("Geographic report recipe has another schema")
    members = _members(closure, entry, recipe)
    if uri.startswith(ALLOCATION):
        key = identifier(uri[len(ALLOCATION):])
        if entry.get("id") != "geographic-scenario-allocation-" + key or entry.get("metadata", {}).get("allocation_id") != key:
            raise ValueError("Geographic allocation URI and source metadata differ")
        native = _allocation(closure, entry, recipe, members, key)
    else:
        key = identifier(uri[len(INTERPRETATION):])
        native = _interpretation(closure, entry, recipe, members, key)
    binding = {"schema": "upstate.study-report-lineage/v1",
               "source_collection_id": collection_id, "source_id": entry["id"],
               "source_body_sha256": entry["body"]["sha256"],
               "source_project_id": native["project_id"], "report_context_kind": CONTEXT_KIND,
               "relationship": "same_project" if native.pop("local") else "external_project",
               **native}
    token = (collection_id, entry["id"])
    previous = closure.report_source_records.get(token)
    if previous is not None and previous != binding:
        raise ValueError("Geographic source changed during selected-study capture")
    closure.report_source_records[token] = binding
    return True


def lock_paths(closure):
    paths = set()
    for relative in closure.files:
        parts = PurePosixPath(relative).parts
        if len(parts) < 3:
            continue
        kind, key = parts[:2]
        if kind == "geographic-headwaters":
            paths.add(kind + "/" + key + "/.prepare.lock")
        elif kind == "geographic-receiving-contexts":
            paths.add(kind + "/" + key + "/.context.lock")
        elif kind == "geographic-scenario-allocations":
            paths.add(kind + "/" + key + ".lock")
        elif kind == "scenario-footprint-output":
            paths.add(kind + "/" + key + ".lock")
        elif kind == "ensemble_results":
            for name in (".operation.lock", ".execute.lock", ".report.lock", ".state.lock", ".headwaters-course.lock"):
                paths.add(kind + "/" + key + "/" + name)
        elif kind == "ensemble-products" and len(key) == 64:
            paths.update((kind + "/" + key + "/.analysis.lock", kind + "/" + key + "/.report.lock"))
    return sorted(paths)
