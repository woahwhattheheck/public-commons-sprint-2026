"""Saved Installation phases inside the original SF47 delivery portfolio.

The original Workshare reader owns phase scope, quoted effort and commercial
terms. This module joins a selected immutable Installation to an existing
commercial forecast task, then expands entered remaining work for the existing
daily allocator. It never infers remaining effort from acceptance observations.
"""
from __future__ import annotations

from copy import deepcopy
from decimal import Decimal
from html import escape
import hashlib

from model import Problem, canonical, digest, csv_bytes, text
import operations_domain as domain
import operations_installations as installations
import operations_workshare_installations as workshares
import operations_installation_effort as installation_effort
import portfolio_schedule as allocation
from workshare_intake import load_workshares

SCHEMA = "stellar-forge.sf47-portfolio-installations.v1"
FIELD = "installationPlans"
CONTEXT = "portfolioInstallations"
MAX_PLANS = 100
MAX_PHASES = 500
ZERO = Decimal(0)
REF_FIELDS = ("installationId", "installationRevision", "installationSha256")


def fail(message, code="INVALID_PORTFOLIO_INSTALLATION", status=422):
    raise Problem(message, status, code)


def ref(raw):
    if not isinstance(raw, dict):
        fail("Select an immutable Installation edition.")
    return {"installationId": installations.identity(raw.get("installationId")),
            "installationRevision": installations.revision(raw.get("installationRevision")),
            "installationSha256": domain.sha(raw.get("installationSha256"), "Installation content", False)}


def key(value):
    return tuple(value[name] for name in REF_FIELDS)


def row_ref(row):
    return {"installationId": row["id"], "installationRevision": row["revision"],
            "installationSha256": row["sha256"]}


def raw_references(raw):
    """Include explicit alternative overrides, without changing inheritance."""
    if not isinstance(raw, dict):
        return []
    result = {}
    for fields in [raw] + [item for item in raw.get("alternatives", []) if isinstance(item, dict)]:
        values = fields.get(FIELD, [])
        if not isinstance(values, list):
            fail("Installation phase plans must be an array.")
        if len(values) > MAX_PLANS:
            fail("This portfolio exceeds its Installation plan capacity.")
        for value in values:
            selected = ref(value)
            result[key(selected)] = selected
    return [result[ident] for ident in sorted(result)]


def has_plans_field(raw):
    return isinstance(raw, dict) and (FIELD in raw or any(
        isinstance(row, dict) and FIELD in row for row in raw.get("alternatives", [])))


def frozen_entry(context, selected):
    entries = context.get(CONTEXT, {}).get("entries", [])
    found = next((item for item in entries if key(row_ref(item["installation"])) == key(selected)), None)
    if found is None:
        fail("Retain the selected Installation edition and its complete original Workshare source.",
             "PORTFOLIO_INSTALLATION_SOURCE_MISSING", 409)
    return found


def _validate_entry(context, entry):
    row = entry["installation"]
    selected = row_ref(row)
    ref(selected)
    if digest({name: value for name, value in row.items() if name != "sha256"}) != row["sha256"]:
        fail("The retained Installation differs from its saved edition.", "PORTFOLIO_INSTALLATION_CHANGED", 409)
    preview = row["preview"]
    if digest({name: value for name, value in preview.items() if name != "previewSha256"}) != preview["previewSha256"]:
        fail("The retained Installation preview differs from its source.", "PORTFOLIO_INSTALLATION_CHANGED", 409)
    document = preview["document"]
    binding = workshares.normalize_binding(context, document.get("workshare"))
    packet = entry.get("receivingPacket")
    original = load_workshares(
        {"version": "dealscout.workshare-commissioning-inputs.v1", "cases": [entry["commissioningCase"]]},
        None if packet is None else {"packets": [packet]}, require_proposed_usd=False)[0]
    if (original != entry["workshare"] or original["caseId"] != binding["caseId"]
            or original["planSha256"] != binding["planSha256"]):
        fail("The selected Installation and original phase source differ.", "PORTFOLIO_INSTALLATION_SOURCE_CHANGED", 409)
    phases = {phase["id"]: phase for phase in original["plan"]["phases"]}
    selected_checks = {item["phaseId"]: item["checkId"] for item in binding["phaseChecks"]}
    checks = {check["id"]: check for check in document["checks"]}
    if set(selected_checks) != set(phases):
        fail("Retain every original Workshare phase in this Installation.")
    for ident, phase in phases.items():
        check = checks.get(selected_checks[ident])
        if (check is None or check["title"] != phase["title"] or check["criterion"] != phase["acceptance"]
                or not check["required"] or binding["sourceId"] not in check["sourceIds"]):
            fail("Retain each original phase's acceptance criterion and source.")
    if document["workorder"] != workshares.workorder_document(original["plan"], binding):
        fail("The original workorder differs from its selected Workshare.")
    return entry


def validate_entry(context, entry):
    try:
        return _validate_entry(context, entry)
    except Problem:
        raise
    except (KeyError, TypeError, ValueError, AttributeError, ArithmeticError) as exc:
        raise Problem("The complete retained Installation phase source is invalid: " + str(exc),
                      422, "INVALID_PORTFOLIO_INSTALLATION_SOURCE") from exc


def capture(operations, context, raw=None, selections=None, *, inventory=False, allow_old=False):
    """Capture once inside the caller's native read view or save transaction."""
    wanted = {key(item): item for item in raw_references(raw)}
    explicit = []
    if selections is not None:
        if not isinstance(selections, list) or len(selections) > MAX_PLANS:
            fail("Use an array of selected Installation editions.")
        for item in selections:
            if not isinstance(item, dict) or set(item) - {"taskId", *REF_FIELDS}:
                fail("Use the declared Installation selection fields.")
            selected = ref(item)
            wanted[key(selected)] = selected
            explicit.append(key(selected))
    if not wanted and not inventory:
        return context
    heads = {row["id"]: row for row in installations.load_heads(operations, context["program"]["id"])}
    for selected in wanted.values():
        head = heads.get(selected["installationId"])
        if head is None:
            fail("The selected Installation is unavailable in this original case.", "INSTALLATION_NOT_FOUND", 404)
        if (not allow_old or key(selected) in explicit) and row_ref(head) != selected:
            fail("A newer Installation edition is saved. Reselect its current edition before planning this work.",
                 "PORTFOLIO_INSTALLATION_CHANGED", 409)
    requested = dict(wanted)
    if inventory:
        for row in heads.values():
            if "workshare" in row["preview"]["document"]:
                selected = row_ref(row)
                requested[key(selected)] = selected
    entries, issues = [], []
    for selected_key, selected in sorted(requested.items()):
        row = installations.get(operations, context["program"]["id"], selected["installationId"],
                                selected["installationRevision"])
        if row["sha256"] != selected["installationSha256"]:
            fail("The selected Installation content identity changed.", "PORTFOLIO_INSTALLATION_CHANGED", 409)
        try:
            original = workshares.verify_document(operations, context, row["preview"]["document"])
            if original is None:
                fail("Select an Installation prepared from an original Workshare.")
            entry = {"installation": row, **{name: deepcopy(original[name]) for name in
                     ("workshare", "commissioningCase", "receivingPacket")}}
            entries.append(validate_entry(context, entry))
        except Problem as exc:
            if selected_key in wanted:
                raise
            issues.append({**row_ref(row), "name": row["preview"]["document"]["name"],
                           "stage": row["preview"]["document"]["stage"], "matchingTaskIds": [], "phases": [],
                           "unavailable": {"code": getattr(exc, "code", "INSTALLATION_SOURCE"), "message": str(exc)}})
    result = {**context, CONTEXT: {"schema": SCHEMA, "entries": entries}}
    if inventory:
        effort_seeds = {}
        for entry in entries:
            row = entry["installation"]
            document = row["preview"]["document"]
            if "effort" not in document or row_ref(heads[row["id"]]) != row_ref(row):
                continue
            try:
                original = {"workshare": entry["workshare"]}
                frozen = installation_effort.capture_context(operations, context, document, row["id"], original,
                    heads=list(heads.values()), previous=row)
                snapshot = installations.capture(context, document, frozen)
                current_effort = installation_effort.report(snapshot, document)
                if current_effort["readyForPlanning"] and current_effort == row["preview"]["report"].get("effort"):
                    effort_seeds[canonical(row_ref(row))] = {"asOfDate": current_effort["asOfDate"],
                        "reportSha256": current_effort["reportSha256"],
                        "phases": {phase["phaseId"]: deepcopy(phase) for phase in current_effort["phases"] if not phase.get("retired")}}
            except Problem:
                # An explicit planning draft remains available while its original
                # Work or support source is being reviewed. No estimate is inferred.
                pass
        result["portfolioEffortSeeds"] = effort_seeds
        result["portfolioInstallationInventory"] = {
            "heads": [row_ref(row) for row in heads.values()], "unavailable": issues}
    return result


def matches(context, source, entry):
    binding = entry["installation"]["preview"]["document"]["workshare"]
    if source["sourceKind"] != "commercial" or source.get("caseRef") != binding["caseId"]:
        return False
    source_ids = source.get("sourceIds", [])
    source_hashes = {context["sources"][ident]["sha256"] for ident in source_ids if ident in context["sources"]}
    return binding["sourceId"] in source_ids or binding["sourceSha256"] in source_hashes


def candidate(context, entry, sources):
    row, original = entry["installation"], entry["workshare"]
    document, plan = row["preview"]["document"], original["plan"]
    binding = document["workshare"]
    checks = {check["id"]: check for check in document["checks"]}
    phase_checks = {item["phaseId"]: item["checkId"] for item in binding["phaseChecks"]}
    coordination = document.get("coordination", {})
    steps = {step["checkId"]: step for step in coordination.get("steps", [])}
    phases = []
    for phase in plan["phases"]:
        check_id = phase_checks[phase["id"]]
        check, step = checks[check_id], steps.get(check_id, {})
        priority = step.get("priority", "INHERIT")
        phases.append({"phaseId": phase["id"], "title": phase["title"], "quotedHours": original["effort"][phase["id"]],
            "owner": deepcopy(phase.get("owner", "")), "dependsOn": list(phase["depends_on"]),
            "businessDays": phase.get("business_days"), "terms": deepcopy(phase), "checkId": check_id,
            "checkState": check["state"], "checkOperator": check["operator"], "checkObservedAt": check["observedAt"],
            "coordinationOwner": step.get("owner") or coordination.get("owner", ""),
            "coordinationDueDate": step.get("dueDate") or coordination.get("dueDate"),
            "coordinationPriority": coordination.get("priority", "NORMAL") if priority == "INHERIT" else priority})
    return {**row_ref(row), "name": document["name"], "stage": document["stage"],
        "caseId": original["caseId"], "planSha256": original["planSha256"],
        "title": plan["title"], "customer": plan["customer"], "quotedHours": original["hours"],
        "commercial": deepcopy(plan["commercial"]), "schedule": deepcopy(plan["schedule"]),
        "workorder": deepcopy(document["workorder"]),
        **{name: binding.get(name) for name in ("sourceId", "sourceSha256", "packetSourceId", "packetSha256")},
        "matchingTaskIds": [source["id"] for source in sources if matches(context, source, entry)],
        "phases": phases}


def candidates(context, sources, raw=None, *, current=False):
    entries = context.get(CONTEXT, {}).get("entries", [])
    wanted = ({key(row) for row in context.get("portfolioInstallationInventory", {}).get("heads", [])}
              if current else {key(row) for row in raw_references(raw)})
    values = [candidate(context, entry, sources) for entry in entries if key(row_ref(entry["installation"])) in wanted]
    if current:
        values += deepcopy(context.get("portfolioInstallationInventory", {}).get("unavailable", []))
    return sorted(values, key=lambda row: (row["name"], row["installationId"], row["installationRevision"]))


def source_identity(context, raw):
    rows = []
    for selected in raw_references(raw):
        entry = frozen_entry(context, selected)
        binding = entry["installation"]["preview"]["document"]["workshare"]
        rows.append({**selected, **{name: binding.get(name) for name in
                    ("caseId", "planSha256", "sourceId", "sourceSha256", "packetSourceId", "packetSha256")}})
    value = {"schema": SCHEMA, "selections": rows}
    return {**value, "sha256": digest(value)}


def phase_key(task_id, installation_id, phase_id):
    identity = "\0".join((task_id, installation_id, phase_id)).encode("utf-8")
    return "installation-phase/" + hashlib.sha256(identity).hexdigest()


def normalize(context, sources, resources, raw):
    # Imported lazily so the original Portfolio can use these helpers.
    from portfolio import obj, array, number, integer, iso, unique
    resource_ids = {row["id"] for row in resources}
    source_index = {row["id"]: row for row in sources}
    result, used_installations, all_phase_ids = [], set(), set(source_index)
    for item in array(raw, "Installation phase plans", MAX_PLANS):
        item = obj(item, {"taskId", *REF_FIELDS, "deliveryPhaseIds", "deliveryBoundaryNote", "phases", "note"},
                   "Installation phase plan")
        task_id = text(item.get("taskId"), "Original commercial task", 150, True)
        selected = ref(item)
        entry = validate_entry(context, frozen_entry(context, selected))
        source = source_index.get(task_id)
        if source is None or not matches(context, source, entry):
            fail("Match the original commercial case reference and retained commissioning source before selecting its Installation.")
        if selected["installationId"] in used_installations:
            fail("An Installation may replace only one commercial task in an alternative.")
        used_installations.add(selected["installationId"])
        originals = {row["id"]: row for row in entry["workshare"]["plan"]["phases"]}
        phases = []
        for phase in array(item.get("phases"), "Original Installation phases", MAX_PHASES):
            phase = obj(phase, {"phaseId", "remainingHours", "effortHours", "dependsOn", "releaseDate",
                        "dueDate", "minBusinessDays", "priority", "note"}, "Phase allocation")
            ident = text(phase.get("phaseId"), "Original phase ID", 1000, True)
            if ident not in originals:
                fail("Retain every phase from the selected original Workshare.")
            parents = array(phase.get("dependsOn", []), "Phase dependencies", len(originals))
            if (any(not isinstance(value, str) or value not in originals or value == ident for value in parents)
                    or len(set(parents)) != len(parents) or not set(originals[ident]["depends_on"]).issubset(parents)):
                fail("Retain original phase predecessors and select distinct other original phases for added dependencies.")
            effort = phase.get("effortHours", {})
            if not isinstance(effort, dict) or set(effort) - resource_ids:
                fail("Assign phase effort to the entered resource roster.")
            phases.append({"phaseId": ident, "remainingHours": number(phase.get("remainingHours"), "Remaining phase hours", nullable=True),
                "effortHours": {name: number(value, "Assigned phase effort", nullable=True) for name, value in sorted(effort.items())},
                "dependsOn": list(parents), "releaseDate": iso(phase.get("releaseDate"), "Phase release", nullable=True),
                "dueDate": iso(phase.get("dueDate"), "Phase due date", nullable=True),
                "minBusinessDays": integer(phase.get("minBusinessDays", 0), "Remaining phase working duration"),
                "priority": None if phase.get("priority") is None else integer(phase["priority"], "Phase priority", 1000000),
                "note": text(phase.get("note", ""), "Phase allocation basis", 12000)})
            generated = phase_key(task_id, selected["installationId"], ident)
            if generated in all_phase_ids:
                fail("The complete allocation repeats a native task identity.")
            all_phase_ids.add(generated)
        phase_index = unique(phases, "phaseId", "Original phase allocations")
        if phase_index.keys() != originals.keys():
            fail("Retain every original phase exactly once, including later support work.")
        try:
            allocation._topology([{"id": row["phaseId"], "depends_on": row["dependsOn"]} for row in phases])
        except allocation.PlanningError as exc:
            fail(str(exc))
        delivery = array(item.get("deliveryPhaseIds", []), "Delivery boundary", len(phases))
        if any(not isinstance(ident, str) or ident not in originals for ident in delivery) or len(set(delivery)) != len(delivery):
            fail("Choose distinct original phases for the commercial delivery boundary.")
        result.append({"taskId": task_id, **selected, "deliveryPhaseIds": list(delivery),
            "deliveryBoundaryNote": text(item.get("deliveryBoundaryNote", ""), "Delivery boundary basis", 12000),
            "phases": [phase_index[ident] for ident in originals],
            "note": text(item.get("note", ""), "Installation allocation basis", 12000)})
    unique(result, "taskId", "Commercial Installation plans")
    if sum(len(row["phases"]) for row in result) > MAX_PHASES:
        fail("The complete alternative exceeds 500 original phase allocations.")
    return result


def seed_group(context, source, selected, as_of=None):
    entry = frozen_entry(context, selected)
    original = entry["workshare"]
    reviewed = context.get("portfolioEffortSeeds", {}).get(canonical(ref(selected)))
    if (reviewed is not None and (reviewed["asOfDate"] != as_of
            or sum((Decimal(row["remainingHours"]) for row in reviewed["phases"].values()), ZERO) != Decimal(source["remainingHours"]))):
        reviewed = None
    exact = "effort" not in entry["installation"]["preview"]["document"] and Decimal(source["remainingHours"]) == Decimal(original["hours"])
    phases = []
    for phase in original["plan"]["phases"]:
        duration = phase.get("business_days")
        duration = duration if exact and isinstance(duration, int) and not isinstance(duration, bool) and duration >= 0 else 0
        remaining = reviewed["phases"][phase["id"]]["remainingHours"] if reviewed else original["effort"][phase["id"]] if exact else None
        note = ("Reviewed remaining effort from saved Installation edition " + str(selected["installationRevision"]) + ". "
                + reviewed["phases"][phase["id"]]["review"]["note"]) if reviewed else ""
        phases.append({"phaseId": phase["id"], "remainingHours": remaining,
            "effortHours": {}, "dependsOn": list(phase["depends_on"]), "releaseDate": None, "dueDate": None,
            "minBusinessDays": duration, "priority": None, "note": note})
    return {"taskId": source["id"], **ref(selected), "deliveryPhaseIds": [], "deliveryBoundaryNote": "",
            "phases": phases, "note": ""}


def seed(context, saved, source_rows, inputs, selections):
    """Attach or explicitly replace selected sources while retaining the draft."""
    from portfolio import normalize as normalize_portfolio
    result = deepcopy(inputs)
    if selections is not None:
        index = {row["id"]: row for row in source_rows}
        chosen = {}
        for item in selections:
            task_id = text(item.get("taskId"), "Selected commercial task", 150, True)
            if task_id in chosen:
                fail("Select one Installation edition for each commercial task.")
            selected = ref(item)
            entry = frozen_entry(context, selected)
            if task_id not in index or not matches(context, index[task_id], entry):
                fail("Select an Installation matching the commercial task's original case and source.")
            chosen[task_id] = seed_group(context, index[task_id], selected, saved["inputs"]["asOfDate"])
        def update(fields, inherited=False):
            if inherited and FIELD not in fields:
                return
            prior = {row["taskId"]: row for row in fields.get(FIELD, [])}
            for task_id, prepared in chosen.items():
                previous = prior.get(task_id)
                replacement = deepcopy(prepared)
                if previous:
                    before = frozen_entry(context, ref(previous))
                    after = frozen_entry(context, ref(prepared))
                    # A new observation/coordination edition keeps the same phase draft.
                    # A changed original plan/effort requires its new complete preparation.
                    if (before["workshare"]["planSha256"] == after["workshare"]["planSha256"]
                            and before["workshare"]["effort"] == after["workshare"]["effort"]):
                        replacement = {**deepcopy(previous), **ref(prepared)}
                prior[task_id] = replacement
            fields[FIELD] = list(prior.values())
        update(result)
        # Explicit alternative overrides, including [], belong to that alternative.
    return normalize_portfolio(context, saved, result)


def closure(group):
    index = {phase["phaseId"]: phase for phase in group["phases"]}
    found, pending = set(), list(group["deliveryPhaseIds"])
    while pending:
        ident = pending.pop()
        if ident not in found:
            found.add(ident)
            pending.extend(index[ident]["dependsOn"])
    return found


def allocation_findings(context, sources, fields):
    from portfolio import finding
    index = {row["id"]: row for row in sources}
    tasks = {row["id"]: row for row in fields["tasks"]}
    result = []
    for group in fields.get(FIELD, []):
        path = FIELD + "." + group["taskId"]
        if not group["deliveryPhaseIds"] or not group["deliveryBoundaryNote"]:
            result.append(finding("DELIVERY_BOUNDARY_REQUIRED", path + ".deliveryPhaseIds",
                "Select the original phase or phases completing commercial delivery and retain the basis in the original terms. Later support remains scheduled."))
        if tasks[group["taskId"]]["minBusinessDays"]:
            result.append(finding("PHASE_DURATION_REQUIRED", "tasks." + group["taskId"] + ".minBusinessDays",
                "Set the aggregate minimum duration to zero and enter remaining durations on its original phases."))
        remaining = [phase["remainingHours"] for phase in group["phases"]]
        if any(value is None for value in remaining):
            result.append(finding("PHASE_REMAINING_HOURS_REQUIRED", path,
                "Enter each phase's remaining effort separately from its original quoted hours and acceptance observation."))
        elif sum((Decimal(value) for value in remaining), ZERO) != Decimal(index[group["taskId"]]["remainingHours"]):
            result.append(finding("PHASE_REMAINING_TOTAL_REQUIRED", path,
                "Phase remaining hours must sum to the original commercial task's " + index[group["taskId"]]["remainingHours"] + " remaining hours."))
        for phase in group["phases"]:
            values = phase["effortHours"]
            if any(value is None for value in values.values()):
                result.append(finding("PHASE_EFFORT_REQUIRED", path + "." + phase["phaseId"],
                    "Enter every selected resource's phase effort."))
            elif phase["remainingHours"] is not None and sum((Decimal(value) for value in values.values()), ZERO) != Decimal(phase["remainingHours"]):
                result.append(finding("PHASE_EFFORT_TOTAL_REQUIRED", path + "." + phase["phaseId"],
                    "Assign exactly " + phase["remainingHours"] + " remaining phase hours to the entered resources."))
            parent_release = tasks[group["taskId"]]["releaseDate"]
            timing = index[group["taskId"]].get("timing")
            retained_release = timing.get("reviewedReleaseDate") if timing else None
            lower = max((value for value in (parent_release, retained_release) if value), default=None)
            if lower and phase["releaseDate"] and phase["releaseDate"] < lower:
                result.append(finding("PHASE_RELEASE_BEFORE_PARENT", path + "." + phase["phaseId"] + ".releaseDate",
                    "Release this phase on or after the original commercial release " + lower + "."))
    return result


def expand(context, sources, fields, pure):
    """Replace aggregates once; keep the original allocator and finish semantics."""
    groups = {row["taskId"]: row for row in fields.get(FIELD, [])}
    if not groups:
        return pure
    result = deepcopy(pure)
    original = {row["id"]: row for row in pure["tasks"]}
    source_index = {row["id"]: row for row in sources}
    end_ids = {ident: [phase_key(ident, group["installationId"], phase_id) for phase_id in group["deliveryPhaseIds"]]
               for ident, group in groups.items()}
    def external(parents):
        return list(dict.fromkeys(child for parent in parents for child in end_ids.get(parent, [parent])))
    tasks = []
    for parent in pure["tasks"]:
        group = groups.get(parent["id"])
        if group is None:
            tasks.append({**parent, "depends_on": external(parent["depends_on"])})
            continue
        entry = frozen_entry(context, ref(group))
        original_phases = {row["id"]: row for row in entry["workshare"]["plan"]["phases"]}
        delivery = closure(group)
        for phase in group["phases"]:
            ident = phase["phaseId"]
            phase_id = phase_key(parent["id"], group["installationId"], ident)
            parents = [phase_key(parent["id"], group["installationId"], value) for value in phase["dependsOn"]]
            parents += external(parent["depends_on"])
            due = phase["dueDate"]
            if ident in delivery and parent["due_date"]:
                if due and due > parent["due_date"]:
                    raise allocation.PlanningError("A delivery phase deadline cannot extend the original commercial delivery deadline.",
                        code="PORTFOLIO_PHASE_DEADLINE", field=FIELD + "." + group["taskId"] + "." + ident + ".dueDate")
                # A parent's deadline constrains the selected boundary and its prerequisites,
                # while later support keeps only its explicitly entered deadline.
                due = due or parent["due_date"]
            tasks.append({"id": phase_id, "title": source_index[parent["id"]]["title"] + " · " + original_phases[ident]["title"],
                "depends_on": list(dict.fromkeys(parents)), "effort_hours": phase["effortHours"],
                "release_date": phase["releaseDate"] or parent["release_date"],
                "due_date": due, "minimum_business_days": phase["minBusinessDays"],
                "priority": parent["priority"] if phase["priority"] is None else phase["priority"],
                "source_dates": {**parent["source_dates"], "parentTaskId": parent["id"],
                    **ref(group), "caseId": entry["workshare"]["caseId"], "planSha256": entry["workshare"]["planSha256"],
                    "phaseId": ident, "quotedHours": entry["workshare"]["effort"][ident],
                    "deliveryScope": ident in delivery}})
    if len({row["id"] for row in tasks}) != len(tasks):
        fail("The expanded native allocation repeats a task identity.")
    allocation._topology(tasks)
    result["tasks"] = tasks
    result["programme_ref"]["installationSource"] = source_identity(context, {FIELD: list(groups.values())})
    return result


def report_groups(context, sources, fields, schedule=None):
    rows = {row["id"]: row for row in (schedule or {}).get("tasks", [])}
    source_index = {row["id"]: row for row in sources}
    result = []
    for group in fields.get(FIELD, []):
        entry = frozen_entry(context, ref(group))
        metadata = candidate(context, entry, sources)
        originals = {row["phaseId"]: row for row in metadata["phases"]}
        delivery = closure(group)
        phases = []
        for phase in group["phases"]:
            original = originals[phase["phaseId"]]
            ident = phase_key(group["taskId"], group["installationId"], phase["phaseId"])
            row = rows.get(ident, {})
            phases.append({"phaseId": phase["phaseId"], "scheduleTaskId": ident, "title": original["title"],
                "quotedHours": original["quotedHours"], "remainingHours": phase["remainingHours"],
                "owner": deepcopy(original["owner"]), "checkState": original["checkState"],
                "checkOperator": original["checkOperator"], "checkObservedAt": original["checkObservedAt"],
                "coordinationOwner": original["coordinationOwner"], "dependsOn": list(phase["dependsOn"]),
                "deliveryScope": phase["phaseId"] in delivery,
                "startDate": row.get("first_work_date") or row.get("ready_date"), "finishDate": row.get("finish_date"),
                "dueDate": row.get("due_date", phase["dueDate"]), "effortHours": deepcopy(phase["effortHours"]),
                "minimumBusinessDays": phase["minBusinessDays"]})
        delivery_rows = [row for row in phases if row["deliveryScope"]]
        boundary_rows = [row for row in phases if row["phaseId"] in group["deliveryPhaseIds"]]
        start = min((row["startDate"] for row in delivery_rows if row["startDate"]), default=None)
        end = (max((row["finishDate"] for row in boundary_rows), default=None)
               if boundary_rows and all(row["finishDate"] for row in boundary_rows) else None)
        all_end = max((row["finishDate"] for row in phases), default=None) if phases and all(row["finishDate"] for row in phases) else None
        result.append({"taskId": group["taskId"], **ref(group), "caseId": metadata["caseId"],
            "planSha256": metadata["planSha256"], "quotedHours": metadata["quotedHours"],
            "remainingHours": source_index[group["taskId"]]["remainingHours"],
            "deliveryPhaseIds": list(group["deliveryPhaseIds"]), "deliveryBoundaryNote": group["deliveryBoundaryNote"],
            "deliveryPhaseClosure": [phase["phaseId"] for phase in group["phases"] if phase["phaseId"] in delivery],
            "deliveryStartDate": start, "deliveryFinishDate": end, "allWorkFinishDate": all_end, "phases": phases})
    return result


def chosen_dates(context, sources, fields, schedule):
    from portfolio import date_delta
    groups = {row["taskId"]: row for row in report_groups(context, sources, fields, schedule)}
    rows = {row["id"]: row for row in schedule["tasks"]}
    result = []
    for source in sources:
        if source["id"] in groups:
            group = groups[source["id"]]
            start, end = group["deliveryStartDate"], group["deliveryFinishDate"]
        else:
            row = rows[source["id"]]
            start, end = row["first_work_date"] or row["ready_date"], row["finish_date"]
        result.append({"taskId": source["id"], "sourceKind": source["sourceKind"], "sourceId": source["sourceId"],
            "oldStartDate": source["startDate"], "oldEndDate": source["endDate"], "startDate": start, "endDate": end,
            "startShiftDays": date_delta(start, source["startDate"]), "endShiftDays": date_delta(end, source["endDate"])})
    return result


def validate_import(value, context, saved_installations, files):
    """Join historical calculation snapshots to the complete native received case."""
    if not has_plans_field(value["inputs"]):
        return
    all_rows = {(row["id"], row["revision"], row["sha256"]): row for row in saved_installations}
    save_source_version = value["source"]["version"]
    historical = installations.latest_refs([row for row in saved_installations if row["version"] <= save_source_version])
    historical_refs = {(row["id"], row["revision"], row["sha256"]) for row in historical}
    for selected in raw_references(value["inputs"]):
        entry = frozen_entry(value["snapshot"], selected)
        retained = all_rows.get(key(selected))
        if retained != entry["installation"] or key(selected) not in historical_refs:
            fail("The phase portfolio does not join its original saved Installation head.",
                 "PORTFOLIO_INSTALLATION_SOURCE_CONFLICT", 409)
        original = workshares.verify_document(None, context, retained["preview"]["document"],
                                              reader=lambda ident: files["sources/" + ident])
        if original is None or any(original[name] != entry[name] for name in
                                  ("workshare", "commissioningCase", "receivingPacket")):
            fail("The phase portfolio differs from the complete original received Workshare.",
                 "PORTFOLIO_INSTALLATION_SOURCE_CONFLICT", 409)


def export_files(value):
    if not has_plans_field(value["inputs"]):
        return {}
    result = {"installations/source.json": (canonical({
        "installationSource": value["installationSource"],
        "snapshot": value["snapshot"].get(CONTEXT), "candidates": value["report"]["installationCandidates"]}) + "\n").encode()}
    for alternative in value["report"]["alternatives"]:
        groups = alternative.get(FIELD, [])
        prefix = "alternatives/" + alternative["id"] + "/"
        result[prefix + "installation-plans.json"] = (canonical(groups) + "\n").encode()
        result[prefix + "installation-phases.csv"] = csv_bytes([
            "taskId", *REF_FIELDS, "caseId", "planSha256", "phaseId", "scheduleTaskId", "title",
            "quotedHours", "remainingHours", "owner", "checkState", "checkOperator", "checkObservedAt",
            "coordinationOwner", "dependsOn", "deliveryScope", "startDate", "finishDate", "dueDate",
            "effortHours", "minimumBusinessDays"],
            [{**{name: group[name] for name in ("taskId", *REF_FIELDS, "caseId", "planSha256")}, **phase}
             for group in groups for phase in group["phases"]])
    return result


def report_html(value):
    if not has_plans_field(value["inputs"]):
        return ""
    esc = lambda value: escape("" if value is None else str(value))
    sections = []
    for alternative in value["report"]["alternatives"]:
        for group in alternative.get(FIELD, []):
            rows = "".join("<tr>" + "".join("<td>" + esc(cell) + "</td>" for cell in (
                phase["title"], phase["quotedHours"], phase["remainingHours"], phase["owner"],
                phase["coordinationOwner"], phase["checkState"],
                phase["startDate"], phase["finishDate"], "Delivery" if phase["deliveryScope"] else "Other scheduled work")) + "</tr>"
                for phase in group["phases"])
            sections.append("<h3>" + esc(alternative["name"] + " — " + group["caseId"]) + "</h3>"
                "<p>Installation " + esc(group["installationId"]) + ", edition " + esc(group["installationRevision"]) +
                ". Delivery: " + esc(group["deliveryStartDate"]) + " to " + esc(group["deliveryFinishDate"]) +
                ". All scheduled work finishes: " + esc(group["allWorkFinishDate"]) + ".</p><p>" +
                esc(group["deliveryBoundaryNote"]) + "</p><table><thead><tr>" +
                "".join("<th>" + label + "</th>" for label in ("Phase", "Quoted hours", "Remaining hours", "Original owner",
                    "Delivery assignee", "Acceptance observation", "Start", "Finish", "Scope")) +
                "</tr></thead><tbody>" + rows + "</tbody></table>")
    return "<section><h2>Saved Installation phase allocation</h2><p>Quoted effort, entered remaining work and acceptance observations retain their separate meanings. The selected delivery boundary drives the original commercial forecast. Later support still uses the same resource capacity.</p>" + "".join(sections) + "</section>"
