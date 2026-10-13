"""Explicit original Measurements-to-Chemistry bindings in the existing Workspace.

The Measurements engine owns normalization, review, source revisions and portable
receiving. This adapter consumes its full original records and preserves every
population decision. The existing Chemistry engine owns all numerical inference.
"""
from __future__ import annotations
from collections import Counter, defaultdict
from copy import deepcopy
from datetime import datetime, timezone, date
import json
import math
from pathlib import Path
from urllib.parse import urlencode

from model.common import atomic_bytes, atomic_json, canonical, digest, file_digest, held, identifier, read_json
from model.chemistry import Chemistry
from model.reach_chemistry.model import Project, ModelError
from model.reach_chemistry.inference import observation_components, observation_rows

FAMILY = "measurement-chemistry-bindings"
FORMAT = "upstate.measurement-chemistry-binding/v1"
MEASUREMENT_CHOICES = [
    {"id": "ammonia_n", "title": "Ammonia nitrogen", "basis": "N",
     "scope": "The explicitly declared ammonia pool; source method and basis remain attached."},
    {"id": "nitrate_nitrite_n", "title": "Nitrate plus nitrite nitrogen", "basis": "N",
     "scope": "All modeled nitrate and nitrite pools represented by the source method."},
    {"id": "kjeldahl_n", "title": "Total Kjeldahl nitrogen", "basis": "N",
     "scope": "Ammonia plus organic nitrogen represented by the source method."},
    {"id": "total_nitrogen", "title": "Total nitrogen", "basis": "N",
     "scope": "Complete declared nitrogen pools, with original TKN plus NOx derivation when selected."},
    {"id": "total_phosphorus", "title": "Total phosphorus", "basis": "P",
     "scope": "Complete declared dissolved and particulate phosphorus pools."},
    {"id": "nitrate", "title": "Nitrate", "basis": None},
    {"id": "orthophosphate", "title": "Orthophosphate", "basis": None},
    {"id": "dissolved_oxygen", "title": "Dissolved oxygen", "basis": "O2"},
]
FILTERS = {"stationId", "parameter", "fraction", "unit", "censor", "from", "to", "q"}


def _text(value, name):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(name + " must be a nonempty string")
    return value.strip()


def _number(value, name, *, positive=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(name + " must be a finite number")
    if value < 0 or positive and value <= 0:
        raise ValueError(name + " is outside its permitted range")
    return value


def _iso(value, name):
    text = _text(value, name)
    parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError(name + " requires the explicit original time zone")
    return parsed.astimezone(timezone.utc)


def _query(filters, **extra):
    if not isinstance(filters, dict) or set(filters) - FILTERS:
        raise ValueError("Select documented original measurement filters")
    return urlencode({**filters, **extra})


def _snapshot(service, filters, expected_revision=None):
    """Use the original engine's one-transaction full-record/source snapshot."""
    extra = {} if expected_revision is None else {"expected_revision": expected_revision}
    result = service.json("GET", "snapshot?" + _query(filters, **extra))
    revision = result["revision"]
    if expected_revision is not None and expected_revision != revision:
        raise ValueError("Measurements changed after inspection; review the current source revision")
    if result["portable"]["revision"] != revision or result["summary"]["revision"] != revision:
        raise ValueError("The original source snapshot has inconsistent revision identities")
    rows = result["records"]
    if result["total"] != len(rows) or len({r["id"] for r in rows}) != len(rows):
        raise ValueError("The original source snapshot does not cover its complete unique population")
    return result


def catalog(workspace, service):
    bindings = workspace._list(FAMILY)
    return {"cases": Chemistry(workspace).catalog()["cases"],
            "bindings": [{k: b[k] for k in ("id", "title", "case_id", "original_case_id", "counts", "source_revision")}
                         for b in bindings],
            "measurement_choices": MEASUREMENT_CHOICES,
            "measurement_revision": service.json("GET")["revision"]}


def inspect(workspace, service, payload):
    case = Chemistry(workspace).get_case(payload["case_id"])
    snap = _snapshot(service, payload.get("filters", {}), payload.get("expected_revision"))
    groups = {}
    for row in snap["records"]:
        key = (row["characteristic"], row["method"], row["fraction"], row["basis"], row["unit"])
        if key not in groups:
            groups[key] = {"characteristic": key[0], "method": key[1], "fraction": key[2],
                           "basis": key[3], "unit": key[4], "count": 0, "record_ids": [],
                           "stations": set(), "dates": set(), "censors": Counter(), "exclusions": Counter()}
        group = groups[key]
        group["count"] += 1
        group["record_ids"].append(row["id"])
        group["stations"].add(row["stationId"])
        group["dates"].add(row["sampledDate"])
        group["censors"][row["censor"]] += 1
        group["exclusions"].update(row["eligible"]["reasons"])
    values = []
    for key in sorted(groups):
        group = groups[key]
        values.append({**group, "stations": sorted(group["stations"]), "dates": sorted(group["dates"]),
                       "censors": dict(group["censors"]), "exclusions": dict(group["exclusions"])})
    return {"case": case, "revision": snap["revision"], "filters": payload.get("filters", {}),
            "records": snap["records"], "groups": values, "measurement_choices": MEASUREMENT_CHOICES}


def _mapping(project, value):
    if not isinstance(value, dict):
        raise ValueError("Each measurement mapping must be an object")
    for key in ("characteristic", "measurement", "basis",
                "basis_reference", "basis_reason", "uncertainty_reason"):
        _text(value.get(key), "measurement mapping " + key)
    for key in ("method", "fraction"):
        if not isinstance(value.get(key), str):
            raise ValueError("Select the exact source " + key + ", including an explicit blank when original")
    _number(value.get("sigma_mg_l"), "mapping sigma_mg_l", positive=True)
    observation_components(project, {"id": "mapping-review", "reach": project.rids[0],
        "measurement": value["measurement"], "basis": value["basis"], "components": value.get("components")})
    expected = next((r["basis"] for r in MEASUREMENT_CHOICES if r["id"] == value["measurement"]), None)
    if expected and value["basis"] != expected:
        raise ValueError("The selected measured identity uses conserved basis " + expected)
    return value


def _source_interval(row):
    """Use the original Eighteenmile exact-decimal source reader when applicable."""
    raw = row.get("raw", {})
    try:
        if raw.get("CharacteristicName") not in {"Kjeldahl nitrogen", "Nitrate + Nitrite", "Phosphorus", "Ammonia", "Nitrogen"}:
            raise KeyError("Not an original Eighteenmile constituent")
        try:
            from observations.eighteenmile_stoichiometry_20261013.stoichiometry import concentration, METHODS, CHARACTERS
        except ImportError as error:
            raise RuntimeError("Retain the original STOICH source reader with this component") from error
        component = CHARACTERS.get(raw.get("CharacteristicName"))
        if component and raw.get("ResultAnalyticalMethod/MethodIdentifier") == METHODS[component]:
            value = concentration(raw)
            return value.as_dict(), "original-eighteenmile-stoichiometry"
    except (KeyError, ValueError):
        pass
    if row["censor"] == "none":
        value = _number(row.get("value"), "original concentration")
        return {"lower": value, "upper": value, "lower_open": False, "upper_open": False}, "original-normalized-point"
    lower, upper = row.get("lower"), row.get("upper")
    if lower is None or upper is None:
        raise ValueError("finite-source-interval-required")
    _number(lower, "source lower bound")
    _number(upper, "source upper bound")
    if upper <= lower:
        raise ValueError("finite-source-interval-required")
    # Normalized left/right censoring does not itself declare endpoint closure.
    raise ValueError("original-interval-endpoint-review-required")


def _bounds(row, selection):
    override = selection.get("interval_overrides", {}).get(row["id"])
    if override is None:
        return _source_interval(row)
    if row["censor"] == "none":
        raise ValueError("A point result cannot be replaced with censoring bounds")
    _text(override.get("reason"), "source interval review reason")
    try:
        known_interval, known_origin = _source_interval(row)
    except ValueError:
        known_interval, known_origin = None, None
    lower = _number(override.get("lower_mg_l"), "reviewed source lower bound")
    upper = _number(override.get("upper_mg_l"), "reviewed source upper bound")
    if upper <= lower or type(override.get("lower_closed")) is not bool or type(override.get("upper_closed")) is not bool:
        raise ValueError("A reviewed finite source interval needs ordered bounds and explicit endpoint closure")
    if known_interval is not None:
        original = (known_interval["lower"], known_interval["upper"], not known_interval["lower_open"], not known_interval["upper_open"])
        if (lower, upper, override["lower_closed"], override["upper_closed"]) != original:
            raise ValueError("Reviewed interval bounds or endpoint closure differ from the original source")
        return {**known_interval, "review": deepcopy(override)}, known_origin
    if row.get("lower") is not None and lower != row["lower"]:
        raise ValueError("Reviewed lower bound differs from the original normalized source")
    if row.get("upper") is not None and upper != row["upper"]:
        raise ValueError("Reviewed upper bound differs from the original normalized source")
    if row["censor"] == "left" and lower != 0:
        raise ValueError("A left-censored mass concentration review may declare only the physical zero lower bound")
    if row["censor"] == "right" and row.get("upper") is None:
        raise ValueError("An unbounded source cannot acquire an invented finite upper bound")
    return {"lower": lower, "upper": upper, "lower_open": not override["lower_closed"],
            "upper_open": not override["upper_closed"], "review": deepcopy(override)}, "explicit-original-bound-review"


def _day(row, selection, project):
    explicit = selection.get("day_overrides", {}).get(row["id"])
    if explicit is not None:
        _text(explicit.get("reason"), "sampling time review reason")
        day = _number(explicit.get("day"), "explicit model day")
    else:
        if row.get("timePrecision") != "instant" or not row.get("sampledAt"):
            raise ValueError("explicit-time-binding-required")
        day = (_iso(row["sampledAt"], "original sample timestamp") -
               _iso(selection.get("time_origin"), "selected original model time origin")).total_seconds() / 86400
    if day < 0 or day > project.end_day:
        raise ValueError("sample-outside-selected-case-duration")
    return day


def _role(row, selection):
    roles = selection.get("roles", {})
    result = roles.get("by_record", {}).get(row["id"], roles.get("default"))
    cutoff = roles.get("holdout_from")
    if cutoff:
        date.fromisoformat(cutoff)
        if row["sampledDate"] >= cutoff and row["id"] not in roles.get("by_record", {}):
            result = "holdout"
    if result not in ("fit", "holdout"):
        raise ValueError("Choose an explicit fit/holdout role for every original record")
    return result


def _observation(project, row, mapping, station, selection):
    reasons = list(row["eligible"]["reasons"])
    resolution_notes = []
    resolved = {"reach-unassigned", "unmapped-constituent"}
    # The separate Chemistry assignment does not change the original HUC/source assignment.
    if row["unit"] != "mg/L":
        raise ValueError("measured-mass-concentration-unit-required")
    if row.get("basis") not in ("", "unspecified", mapping["basis"]):
        raise ValueError("declared-basis-conflicts-with-original-source")
    interval, interval_source = _bounds(row, selection)
    if row["censor"] != "none":
        if selection.get("allow_censored") is not True:
            raise ValueError("censored-source-not-selected")
        resolved.update({"censored-result", "missing-numeric-result"})
        if interval_source == "original-eighteenmile-stoichiometry":
            # The original reader recognizes this exact published condition/method.
            resolved.add("review-detection-condition")
            review_causes = set(row.get("issues", [])) & {"qualified-result", "review-source-status", "unit-from-single-detection-limit"}
            if review_causes and review_causes <= {"unit-from-single-detection-limit"}:
                resolved.add("review-required")
                resolution_notes.append("original-limit-unit-resolved")
    remaining = [r for r in reasons if r not in resolved]
    if remaining:
        raise ValueError(";".join(remaining))
    day = _day(row, selection, project)
    value = {"id": row["id"], "reach": station["reach_id"], "day": day,
             "measurement": mapping["measurement"], "basis": mapping["basis"],
             "components": deepcopy(mapping["components"]), "sigma_mg_l": mapping["sigma_mg_l"],
             "role": _role(row, selection),
             "provenance": {"reference": "original-measurement:" + row["id"],
                "record_id": row["id"], "source_references": deepcopy(row["sources"]),
                "station_binding": deepcopy(station), "measurement_mapping": deepcopy(mapping),
                "sampled_date": row["sampledDate"], "sampled_at": row.get("sampledAt"),
                "time_precision": row["timePrecision"], "method": row["method"],
                "fraction": row["fraction"], "reported_unit": row.get("reportedUnit"),
                "original_exclusions": reasons, "resolved_exclusions": [r for r in reasons if r in resolved],
                "interval_source": interval_source, "source_interval": interval,
                "resolution_notes": resolution_notes}}
    if interval["lower"] == interval["upper"]:
        value.update(qualifier="equal", mg_l=interval["lower"])
    else:
        value.update(qualifier="interval", lower_mg_l=interval["lower"], upper_mg_l=interval["upper"],
                     lower_closed=not interval["lower_open"], upper_closed=not interval["upper_open"])
    observation_rows(project, [value], fitting=True)
    return value


def _derived_nitrogen(project, records, accepted, selection):
    """Reuse STOICH's original exact source intervals and activity match, not a new model."""
    mapping = selection.get("derived_total_nitrogen")
    if not mapping:
        return [], []
    _mapping(project, {**mapping, "characteristic": "TKN + NOx", "method": "original same-activity sum",
                       "fraction": "Unfiltered"})
    if mapping["measurement"] != "total_nitrogen" or mapping["basis"] != "N":
        raise ValueError("The original TKN plus NOx source derivation represents total nitrogen as N")
    from observations.eighteenmile_stoichiometry_20261013.stoichiometry import (
        concentration, plus, ACTIVITY_FIELDS, METHODS)
    by_id = {r["id"]: r for r in records}
    candidates = defaultdict(lambda: defaultdict(list))
    for value in accepted:
        row = by_id[value["id"]]
        raw = row.get("raw", {})
        char = raw.get("CharacteristicName")
        if char in ("Kjeldahl nitrogen", "Nitrate + Nitrite"):
            candidates[(row["stationId"], row.get("activityId", ""))][char].append(value)
    values, excluded = [], []
    for (station, activity), groups in sorted(candidates.items()):
        identity = "tkn-nox-" + digest({"station": station, "activity": activity})[:40]
        try:
            if not activity or any(len(groups.get(c, [])) != 1 for c in ("Kjeldahl nitrogen", "Nitrate + Nitrite")):
                raise ValueError("ambiguous-or-incomplete-original-sampling-activity")
            a, b = groups["Kjeldahl nitrogen"][0], groups["Nitrate + Nitrite"][0]
            ra, rb = by_id[a["id"]], by_id[b["id"]]
            if (ra["raw"]["ResultAnalyticalMethod/MethodIdentifier"] != METHODS["tkn"]
                    or rb["raw"]["ResultAnalyticalMethod/MethodIdentifier"] != METHODS["nox"]):
                raise ValueError("original-component-method-differs")
            if any(ra["raw"].get(k) != rb["raw"].get(k) for k in ACTIVITY_FIELDS):
                raise ValueError("component-sampling-context-differs")
            if any(a[k] != b[k] for k in ("reach", "day", "role", "basis")):
                raise ValueError("component-case-time-role-or-basis-differs")
            operators = [{c["species"]: c["weight"] for c in row["components"]} for row in (a, b)]
            if set(operators[0]) & set(operators[1]):
                raise ValueError("TKN-and-NOx-modeled-pools-overlap")
            declared = {c["species"]: c["weight"] for c in mapping["components"]}
            if declared != {**operators[0], **operators[1]}:
                raise ValueError("total-N-operator-must-equal-original-TKN-plus-NOx-pools-and-weights")
            interval = plus(concentration(ra["raw"]), concentration(rb["raw"])).as_dict()
            value = {"id": identity, "reach": a["reach"], "day": a["day"], "role": a["role"],
                     "measurement": mapping["measurement"], "basis": "N",
                     "components": deepcopy(mapping["components"]), "sigma_mg_l": mapping["sigma_mg_l"],
                     "provenance": {"reference": "original-TKN-plus-NOx:" + activity,
                         "original_record_ids": [a["id"], b["id"]], "measurement_mapping": deepcopy(mapping),
                         "source_interval": interval, "method": "original STOICH concentration + plus",
                         "activity_id": activity, "station_id": station}}
            if interval["lower"] == interval["upper"]:
                value.update(qualifier="equal", mg_l=interval["lower"])
            else:
                value.update(qualifier="interval", lower_mg_l=interval["lower"], upper_mg_l=interval["upper"],
                             lower_closed=not interval["lower_open"], upper_closed=not interval["upper_open"])
            observation_rows(project, [value], fitting=True)
            values.append(value)
        except (ValueError, KeyError) as error:
            excluded.append({"id": identity, "activity_id": activity, "station_id": station,
                             "reasons": [str(error)], "original_record_ids": sorted(v["id"] for g in groups.values() for v in g)})
    return values, excluded


def _review(case, snap, selection):
    project = Project(case["project"])
    for key in ("title", "reviewer", "reason"):
        _text(selection.get(key), key)
    if not isinstance(selection.get("station_bindings"), list) or not isinstance(selection.get("measurement_mappings"), list):
        raise ValueError("Declare original station and measurement mappings")
    stations = {}
    for station in selection["station_bindings"]:
        for key in ("station_id", "reach_id", "reason", "reference"):
            _text(station.get(key), "station binding " + key)
        project.reach(station["reach_id"])
        if station["station_id"] in stations:
            raise ValueError("Select each original station once")
        stations[station["station_id"]] = station
    mappings = {}
    for mapping in selection["measurement_mappings"]:
        _mapping(project, mapping)
        key = tuple(mapping[k] for k in ("characteristic", "method", "fraction"))
        if key in mappings:
            raise ValueError("Each exact source characteristic/method/fraction needs one interpretation")
        mappings[key] = mapping
    accepted, excluded = [], []
    for row in snap["records"]:
        try:
            station = stations.get(row["stationId"])
            if station is None:
                raise ValueError("explicit-case-station-binding-required")
            mapping = mappings.get(tuple(row[k] for k in ("characteristic", "method", "fraction")))
            if mapping is None:
                raise ValueError("explicit-measurement-mapping-required")
            accepted.append(_observation(project, row, mapping, station, selection))
        except (ValueError, KeyError) as error:
            excluded.append({"id": row["id"], "station_id": row["stationId"],
                             "sampled_date": row["sampledDate"], "source_references": deepcopy(row["sources"]),
                             "original_exclusions": list(row["eligible"]["reasons"]),
                             "reasons": str(error).split(";")})
    derived, derived_excluded = _derived_nitrogen(project, snap["records"], accepted, selection)
    component_ids = {rid for row in derived for rid in row["provenance"]["original_record_ids"]}
    observations = [row for row in accepted if row["id"] not in component_ids] + derived
    if not observations:
        raise ValueError("No original measurements match the declared native case, source review and time selection")
    request = deepcopy(selection.get("request", {}))
    if request.get("mode") not in ("calibrate", "sensitivity", "uncertainty", "monitoring"):
        raise ValueError("Select an original Chemistry inference mode")
    if "observations" in request:
        raise ValueError("The binding supplies observations from the reviewed original population")
    request["observations"] = observations
    return {"accepted": accepted, "excluded": excluded, "derived": derived,
            "derived_excluded": derived_excluded, "request": request,
            "counts": {"source_records": len(snap["records"]), "accepted": len(accepted),
                "excluded": len(excluded), "derived": len(derived), "derived_excluded": len(derived_excluded),
                "fit": sum(r["role"] == "fit" for r in observations),
                "holdout": sum(r["role"] == "holdout" for r in observations),
                "interval": sum(r["qualifier"] == "interval" for r in observations),
                "observations": len(observations), "derived_component_records": len(component_ids)}}



def _referenced_collections(service, snap):
    """Resolve selected original import IDs to their existing complete source sets."""
    imports = {source["id"] for record in snap["records"] for source in record.get("sources", [])}
    root = (Path(service.directory).resolve() / "collections").resolve()
    chosen = []
    for item in service.json("GET", "collections")["collections"]:
        collection_id = identifier(item["id"])
        directory = (root / collection_id).resolve(strict=True)
        manifest_path = (directory / "collection.json").resolve(strict=True)
        if not directory.is_relative_to(root) or not manifest_path.is_relative_to(directory) or not manifest_path.is_file():
            raise ValueError("Original measurement collection is outside its retained source directory")
        document = read_json(manifest_path)
        if document.get("format") != "upper-savannah-measurement-collection/v1":
            raise ValueError("Original measurement collection format differs")
        if not any(file.get("importId") in imports for file in document["files"]):
            continue
        if not item["complete"]:
            raise ValueError("Complete the referenced original measurement collection before binding its records")
        chosen.append({"id": collection_id, "document": document})
    return sorted(chosen, key=lambda value: value["id"])


def _same_portable(left, right):
    # The original engine's creation clock describes serialization, not source identity.
    stable = lambda document: {key: value for key, value in document.items() if key != "createdAt"}
    return stable(left) == stable(right)


def _retain_collection_editions(service, snap, collections, directory):
    """Use original immutable collection editions, including every binary companion."""
    from base64 import b64decode
    from hashlib import sha256
    from io import BytesIO
    from zipfile import ZipFile
    result = []
    for selected in collections:
        collection_id = selected["id"]
        edition = service.json("POST", "collections/" + collection_id + "/publish")
        edition_id = identifier(edition["id"])
        if edition["collectionId"] != collection_id or edition["workspaceRevision"] != snap["revision"]:
            raise ValueError("Measurements changed while publishing the original source collection; inspect again")
        prefix = "collections/" + collection_id + "/editions/" + edition_id
        portable = service.json("GET", prefix + "/project.json")
        original = service.json("GET", prefix + "/collection.json")
        if not _same_portable(portable, snap["portable"]):
            raise ValueError("The original collection edition differs from the reviewed atomic source snapshot")
        if original != selected["document"]:
            raise ValueError("The selected original collection manifest changed while its edition was published")
        bundle = service.json("GET", prefix + "/bundle")
        body = b64decode(bundle["base64"], validate=True)
        checksum = sha256(body).hexdigest()
        if checksum != bundle["sha256"] or len(body) != bundle["bytes"]:
            raise ValueError("The original collection ZIP differs from its native byte identity")
        # Read the exported source objects as their receiver will; retain the ZIP unchanged.
        with ZipFile(BytesIO(body)) as archive:
            names = archive.namelist()
            declared = [file["path"] for file in edition["files"]] + ["edition.json"]
            if len(names) != len(set(names)) or set(names) != set(declared):
                raise ValueError("The original collection ZIP differs from its complete edition inventory")
            if json.loads(archive.read("edition.json")) != edition:
                raise ValueError("The original collection ZIP edition identity differs")
            if json.loads(archive.read("collection.json")) != original:
                raise ValueError("The original collection ZIP source manifest differs")
            if json.loads(archive.read("native-reaches.json")) != snap["summary"]["reaches"]:
                raise ValueError("The original collection ZIP carries a different measured native source domain")
            if not _same_portable(json.loads(archive.read("project.json")), snap["portable"]):
                raise ValueError("The original collection ZIP carries a different measured source revision")
            for member in edition["files"]:
                if archive.getinfo(member["path"]).file_size != member["bytes"]:
                    raise ValueError("The original collection ZIP member length differs")
                member_hash = sha256()
                with archive.open(member["path"]) as stream:
                    for block in iter(lambda: stream.read(1024 * 1024), b""):
                        member_hash.update(block)
                if member_hash.hexdigest() != member["sha256"]:
                    raise ValueError("The original collection ZIP member hash differs: " + member["path"])
        relative = "collections/" + collection_id + "/" + edition_id + ".zip"
        atomic_bytes(directory / relative, body, immutable=True)
        result.append({"collection_id": collection_id, "edition_id": edition_id,
                       "workspace_revision": edition["workspaceRevision"],
                       "path": relative, "sha256": checksum, "bytes": len(body),
                       "title": original["title"], "original_files": original["files"]})
    return result


def prepare(workspace, service, selection):
    """Retain one reviewed source edition and a child of the actual native case."""
    if not isinstance(selection, dict):
        raise ValueError("A complete measurement binding selection is required")
    selection = deepcopy(selection)
    chemistry = Chemistry(workspace)
    original = chemistry.get_case(selection["case_id"])
    snap = _snapshot(service, selection.get("filters", {}), selection.get("expected_revision"))
    review = _review(original, snap, selection)
    collections = _referenced_collections(service, snap)
    from model.reach_chemistry import inference as native_inference
    original_reader = Path(__file__).resolve().parents[1] / "observations/eighteenmile_stoichiometry_20261013/stoichiometry.py"
    producer = {"format": "measured-chemistry-producer/v1", "adapter_sha256": file_digest(Path(__file__)),
                "native_inference_sha256": file_digest(Path(native_inference.__file__)),
                "original_interval_reader_sha256": file_digest(original_reader) if original_reader.is_file() else None}
    identity = digest({"selection": selection, "case_sha256": original["project_sha256"],
                       "revision": snap["revision"], "records": snap["records"], "producer": producer,
                       "collections": [item["id"] for item in collections],
                       "native_measurement_domain": snap["summary"]["reaches"]})
    directory = workspace.root / "measurement-chemistry" / identity
    directory.mkdir(parents=True, exist_ok=True)
    with held(directory / ".prepare.lock"):
        receipt = directory / "binding.json"
        if receipt.exists():
            return get(workspace, read_json(receipt)["binding_id"])
        portable = deepcopy(snap["portable"])
        # Preserve the first complete source snapshot; its creation clock is descriptive.
        portable_path = directory / "measurements.json"
        if portable_path.exists():
            retained = read_json(portable_path)
            stable = lambda value: {k: v for k, v in value.items() if k != "createdAt"}
            if stable(retained) != stable(portable):
                raise ValueError("Interrupted binding source snapshot differs from the original measured revision")
        else:
            atomic_json(portable_path, portable, immutable=True)
        source_collections = _retain_collection_editions(service, snap, collections, directory)
        document = {"format": FORMAT, "title": selection["title"], "selection": selection,
                    "original_case_id": original["id"], "project_sha256": original["project_sha256"],
                    "source_revision": snap["revision"], "original_records": snap["records"], "producer": producer,
                    "source_collections": source_collections,
                    "native_measurement_domain": snap["summary"]["reaches"], **review}
        atomic_json(directory / "binding-source.json", document, immutable=True)
        source_id = "measured-chemistry-" + identity
        manifest = {"schema": "upstate.sources/v1", "title": selection["title"],
                    "entries": [{"id": source_id, "kind": "document", "title": selection["title"],
                        "uri": "urn:original-measurements:" + identity,
                        "vintage": "Measurements source revision " + str(snap["revision"]),
                        "path": "binding-source.json", "sha256": file_digest(directory / "binding-source.json"),
                        "companions": [{"path": "measurements.json", "sha256": file_digest(directory / "measurements.json")},
                                       *[{k: value[k] for k in ("path", "sha256", "bytes")} for value in source_collections]]}]}
        atomic_json(directory / "sources.json", manifest, immutable=True)
        collection = workspace.import_sources(directory / "sources.json")
        source = {"source_collection_id": collection["id"], "source_id": source_id}
        case = chemistry.save_case({"project": original["project"], "parent_id": original["id"],
            "source_refs": [*original["source_refs"], source],
            "reason": selection["reason"] + " — reviewed original measurement binding " + identity})
        binding = workspace._save(FAMILY, {"format": FORMAT, "title": selection["title"],
            "case_id": case["id"], "original_case_id": original["id"],
            "project_sha256": original["project_sha256"], "source_revision": snap["revision"],
            "selection": selection, "source": source, "source_sha256": manifest["entries"][0]["sha256"],
            "producer": producer, "source_collections": source_collections,
            "native_measurement_domain": snap["summary"]["reaches"],
            "directory": str(directory.relative_to(workspace.root)), **review})
        atomic_json(receipt, {"binding_id": binding["id"]}, immutable=True)
        return get(workspace, binding["id"])


def native_payload(binding, chemistry, case_id=None):
    """Original adapter-compatible call; preserve the exact reviewed native request."""
    if binding.get("format") != FORMAT:
        raise ValueError("Choose a retained measured Chemistry binding")
    case = chemistry.get_case(binding["case_id"])
    if case_id is not None and case_id not in (binding["case_id"], binding["original_case_id"]):
        raise ValueError("The binding belongs to a different selected native case")
    if case["project_sha256"] != binding["project_sha256"]:
        raise ValueError("The bound original Chemistry project changed")
    request = deepcopy(binding["request"])
    metadata = request.get("metadata", {})
    if not isinstance(metadata, dict):
        raise ValueError("Native request metadata must be an object")
    if "measurement_binding" in metadata:
        raise ValueError("The native request already has a competing measurement binding")
    request["metadata"] = {**metadata, "measurement_binding": {
        "binding_id": binding["id"], "source": binding["source"], "source_sha256": binding["source_sha256"],
        "source_revision": binding["source_revision"], "original_case_id": binding["original_case_id"],
        "producer": binding["producer"],
        "selection": binding["selection"], "counts": binding["counts"],
        "accepted": binding["accepted"], "excluded": binding["excluded"],
        "derived": binding["derived"], "derived_excluded": binding["derived_excluded"]}}
    return {"case_id": case["id"], "request": request}


def get(workspace, binding_id):
    binding = workspace._get(FAMILY, identifier(binding_id))
    source_path, entry = workspace.source_file(binding["source"]["source_collection_id"], binding["source"]["source_id"])
    if file_digest(source_path) != binding["source_sha256"]:
        raise ValueError("The original binding source edition changed")
    result = {**binding, "binding_id": binding["id"]}
    result["native_payload"] = native_payload(binding, Chemistry(workspace))
    return result


def export(workspace, binding_id):
    binding = get(workspace, binding_id)
    return {"filename": "measured-chemistry-" + binding["id"][:16] + ".json",
            "content_type": "application/json", "document": binding,
            "sha256": digest(binding),
            "native_payload": binding["native_payload"],
            "source": binding["source"],
            "editable_export": {"action": "chemistry.export", "payload": {"case_id": binding["case_id"], "run_ids": []}}}



def adopt_source(workspace, payload):
    """Reopen the complete binding carried by an independently received native case."""
    chemistry = Chemistry(workspace)
    case = chemistry.get_case(payload["case_id"])
    choice = {k: payload[k] for k in ("source_collection_id", "source_id")}
    if not any(all(ref[k] == choice[k] for k in choice) for ref in case["source_refs"]):
        raise ValueError("Choose an original source retained by the selected received Chemistry case")
    source_path, entry = workspace.source_file(choice["source_collection_id"], choice["source_id"])
    document = read_json(source_path)
    if document.get("format") != FORMAT or document.get("project_sha256") != case["project_sha256"]:
        raise ValueError("The original binding does not belong to this received native project")
    request = document["request"]
    observation_rows(Project(case["project"]), request["observations"], fitting=True)
    selection = {**document["selection"], "case_id": case["id"]}
    binding = workspace._save(FAMILY, {"format": FORMAT, "title": document["title"],
        "case_id": case["id"], "original_case_id": case["id"], "project_sha256": case["project_sha256"],
        "source_revision": document["source_revision"], "selection": selection,
        "producer": document["producer"], "source_collections": document.get("source_collections", []),
        "native_measurement_domain": document.get("native_measurement_domain", []),
        "source": choice, "source_sha256": file_digest(source_path),
        "received_from": {"case_id": document["original_case_id"], "selection": document["selection"]},
        **{key: document[key] for key in ("accepted", "excluded", "derived", "derived_excluded", "counts", "request")}})
    return get(workspace, binding["id"])

def handle(workspace, service, payload):
    action = payload.get("action", "catalog")
    if action == "catalog":
        return catalog(workspace, service)
    if action == "inspect":
        return inspect(workspace, service, payload)
    if action == "prepare":
        return prepare(workspace, service, payload["selection"])
    if action == "get":
        return get(workspace, payload["binding_id"])
    if action == "export":
        return export(workspace, payload["binding_id"])
    if action == "adopt-source":
        return adopt_source(workspace, payload)
    raise ValueError("Choose catalog, inspect, prepare, get, export or adopt-source for measured Chemistry")


def main(argv=None):
    import argparse
    from model.workspace import Workspace
    from .extension import MeasuredObservationExtension
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--output", required=True, help="Complete JSON output outside the native Workspace")
    sub = parser.add_subparsers(dest="action", required=True)
    sub.add_parser("catalog")
    inspection = sub.add_parser("inspect")
    inspection.add_argument("--case-id", required=True)
    inspection.add_argument("--filters", help="JSON file with original measurement filters")
    preparation = sub.add_parser("prepare")
    preparation.add_argument("--selection", required=True)
    for action in ("get", "export"):
        entry = sub.add_parser(action)
        entry.add_argument("--binding-id", required=True)
    adoption = sub.add_parser("adopt-source")
    adoption.add_argument("--case-id", required=True)
    adoption.add_argument("--source-collection-id", required=True)
    adoption.add_argument("--source-id", required=True)
    args = parser.parse_args(argv)
    workspace = Workspace(Path(args.workspace))
    output = Path(args.output).resolve()
    if output.is_relative_to(workspace.root.resolve()):
        raise ValueError("Choose an output file outside the original Workspace")
    extension = MeasuredObservationExtension(None, lambda *a: ValueError(str(a)))
    try:
        payload = {"action": args.action}
        if args.action == "inspect":
            payload.update(case_id=args.case_id, filters=read_json(args.filters) if args.filters else {})
        if args.action == "prepare":
            payload["selection"] = read_json(args.selection)
        if args.action in ("get", "export"):
            payload["binding_id"] = args.binding_id
        if args.action == "adopt-source":
            payload.update(case_id=args.case_id, source_collection_id=args.source_collection_id, source_id=args.source_id)
        result = handle(workspace, extension._service(workspace), payload)
        atomic_json(output, result)
        print(json.dumps({"output": str(output), "binding_id": result.get("binding_id"),
                          "case_id": result.get("case_id"), "counts": result.get("counts")}))
    finally:
        extension.close()


if __name__ == "__main__":
    main()
