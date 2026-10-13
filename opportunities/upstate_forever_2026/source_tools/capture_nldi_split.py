"""Capture the original seven gauge-split requests in source operation 1791864959.

The source operation owns its retained requests and publisher jobs. This command
has no operator queue; it continues the same output directory and never repeats
an uncertain POST automatically. HTTP responses, including errors, stay original.
"""
from __future__ import annotations

import argparse
import copy
import datetime as dt
import fcntl
import gzip
import hashlib
import json
import math
import os
from pathlib import Path
import socket
import sys
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlsplit
from urllib.request import Request, urlopen

VERSION = "1.0.0"
OPERATION = "UPSTATE-NLDI-GAUGE-SPLIT-1791864959"
SCHEMA = "upstate.nldi-split-capture/v1"
SOURCE_ROOT = Path(__file__).resolve().parents[1] / "source/hydrology-huc05-07-20261013"
DEFAULT_CONTRACT = SOURCE_ROOT / "nldi-split"
MAX_RESPONSE = 64 * 1024 * 1024
TERMINAL = {"failed", "dismissed", "successful", "succeeded", "complete", "completed"}


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def canonical(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2,
                       allow_nan=False) + "\n").encode("utf-8")


def sha(body):
    return hashlib.sha256(body).hexdigest()


def inside(root, member):
    relative = Path(member)
    if relative.is_absolute() or not relative.parts or ".." in relative.parts:
        raise ValueError("Choose an original relative source member")
    target = (root / relative).resolve()
    if not target.is_relative_to(root.resolve()):
        raise ValueError("Source member leaves its original directory")
    return target


def write(path, body, *, immutable=False):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if immutable and path.exists():
        if path.read_bytes() != body:
            raise ValueError("Original bytes differ at " + str(path))
        return
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as stream:
        pending = Path(stream.name)
        stream.write(body)
        stream.flush()
        os.fsync(stream.fileno())
    try:
        if immutable:
            try:
                os.link(pending, path)
            except FileExistsError:
                if path.read_bytes() != body:
                    raise
        else:
            os.replace(pending, path)
    finally:
        pending.unlink(missing_ok=True)
    descriptor = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def dump(path, value, *, immutable=False):
    write(path, canonical(value), immutable=immutable)


def read_json(path):
    return json.loads(Path(path).read_bytes())


def event(value):
    print(json.dumps(value, sort_keys=True, ensure_ascii=False), flush=True)


def publisher_url(value, base=None):
    resolved = urljoin(base or "https://api.water.usgs.gov/nldi/pygeoapi/", value)
    parts = urlsplit(resolved)
    if (parts.scheme != "https" or parts.hostname != "api.water.usgs.gov"
            or parts.port not in (None, 443) or parts.username or parts.password
            or not parts.path.startswith("/nldi/")):
        raise ValueError("Retain the original USGS NLDI response URL")
    return resolved


def json_response(root, response):
    if response.get("transport_error"):
        raise ValueError("Original request ended before a complete HTTP response")
    body = inside(root, response["body_path"]).read_bytes()
    if sha(body) != response["body_sha256"]:
        raise ValueError("The retained original HTTP body changed")
    return json.loads(body)


def acquire(root, station, sequence, method, url, body, timeout, stage):
    """One original HTTP attempt, including publisher failure bodies/status."""
    folder = root / "responses" / station / ("%05d-%s" % (sequence, stage))
    if folder.exists():
        raise ValueError("A retained HTTP attempt already occupies this sequence")
    folder.mkdir(parents=True)
    request_body = None if body is None else canonical(body)
    headers = {"Accept": "application/json, application/geo+json",
               "Accept-Encoding": "identity",
               "User-Agent": "TokenJunkieLabs-UpperSavannah/1.0"}
    if method == "POST":
        headers.update({"Content-Type": "application/json", "Prefer": "respond-sync"})
    request = {"method": method, "url": publisher_url(url), "headers": headers,
               "body": body, "body_sha256": None if request_body is None else sha(request_body),
               "operation_id": OPERATION, "station_id": station, "stage": stage,
               "started_at": now(), "timeout_seconds": timeout}
    dump(folder / "request.json", request, immutable=True)
    record = {"schema": "upstate.original-http-response/v1", "request": request,
              "request_path": (folder / "request.json").relative_to(root).as_posix()}
    try:
        try:
            response = urlopen(Request(url, data=request_body, headers=headers, method=method),
                               timeout=timeout)
        except HTTPError as error:
            response = error
        with response:
            wire = response.read(MAX_RESPONSE + 1)
            if len(wire) > MAX_RESPONSE:
                raise ValueError("Publisher response exceeds the 64 MiB original-source allowance")
            response_headers = dict(response.headers.items())
            content_encoding = response.headers.get("Content-Encoding", "identity").lower()
            if content_encoding not in ("identity", "gzip"):
                raise ValueError("Retain and resolve this publisher content encoding: " + content_encoding)
            raw = gzip.decompress(wire) if content_encoding == "gzip" else wire
            if len(raw) > MAX_RESPONSE:
                raise ValueError("Decoded original publisher response exceeds 64 MiB")
            write(folder / "body.json", raw, immutable=True)
            if wire != raw:
                write(folder / "wire.bin", wire, immutable=True)
            record.update(status=response.status, response_url=response.geturl(),
                          headers=response_headers, content_encoding=content_encoding,
                          wire_bytes=len(wire), wire_sha256=sha(wire),
                          body_path=(folder / "body.json").relative_to(root).as_posix(),
                          body_bytes=len(raw), body_sha256=sha(raw))
    except (URLError, TimeoutError, ConnectionError, OSError, ValueError) as error:
        record["transport_error"] = {"type": type(error).__name__, "message": str(error)}
    record["completed_at"] = now()
    dump(folder / "response.json", record, immutable=True)
    record["record_path"] = (folder / "response.json").relative_to(root).as_posix()
    event({"station_id": station, "stage": stage, "status": record.get("status"),
           "bytes": record.get("body_bytes"), "response": record["record_path"],
           "transport_error": record.get("transport_error")})
    return record


def contracts(contract_root, source_root):
    plan_body = (contract_root / "request-plan.json").read_bytes()
    plan = json.loads(plan_body)
    if plan.get("schema") != "upstate.nldi-split-source-plan/v1" or plan.get("operation_id") != OPERATION:
        raise ValueError("Select the original seven-gauge source operation")
    description = (contract_root / "original/process.json").read_bytes()
    api = (contract_root / "original/openapi.json").read_bytes()
    if sha(description) != plan["process_description_sha256"] or sha(api) != plan["openapi_sha256"]:
        raise ValueError("The original captured USGS process contract changed")
    process = json.loads(description)
    if process.get("id") != "nldi-splitcatchment":
        raise ValueError("The selected original process is not NLDI Split Catchment")
    example = json.loads(api)["paths"]["/processes/nldi-splitcatchment/execution"]["post"]["requestBody"]["content"]["application/json"]["example"]
    if {row["id"] for row in example["inputs"]} != {"lat", "lon", "upstream", "simplified"}:
        raise ValueError("Review the publisher's changed original input contract")
    manifest_body = (source_root / "model-sources.json").read_bytes()
    binding_body = (source_root / "derived/station-basin-bindings.json").read_bytes()
    if (sha(manifest_body) != plan["original_source_manifest_sha256"]
            or sha(binding_body) != plan["source_bindings_sha256"]):
        raise ValueError("Select the original merged thirteen-gauge source family")
    bindings = {row["station_id"]: row for row in json.loads(binding_body)["stations"]}
    seen = set()
    for row in plan["stations"]:
        if row["station_id"] in seen:
            raise ValueError("The original request plan contains duplicate gauges")
        seen.add(row["station_id"])
        original = bindings[row["station_id"]]
        for field in ("site_no", "ts_id", "comid", "reachcode", "measure",
                      "feature_original_sha256", "feature_original_path"):
            if row[field] != original[field]:
                raise ValueError("Original gauge source binding differs: " + field)
        feature_body = inside(source_root, row["feature_original_path"]).read_bytes()
        if sha(feature_body) != row["feature_original_sha256"]:
            raise ValueError("Original NLDI gauge feature bytes changed")
        feature = json.loads(feature_body)
        if feature.get("type") == "FeatureCollection":
            features = feature.get("features") or []
            if len(features) != 1:
                raise ValueError("Original gauge response must retain one feature")
            feature = features[0]
        geometry = feature.get("geometry") or {}
        if geometry.get("type") != "Point" or geometry.get("coordinates", [])[:2] != [row["longitude"], row["latitude"]]:
            raise ValueError("Requested coordinates differ from the original NLDI gauge point")
        expected = {"inputs": [
            {"id": "lat", "value": str(row["latitude"]), "type": "text/plain"},
            {"id": "lon", "value": str(row["longitude"]), "type": "text/plain"},
            {"id": "upstream", "value": "True", "type": "text/plain"},
            {"id": "simplified", "value": "False", "type": "text/plain"}]}
        # Numeric JSON formatting may differ between JS and Python; compare values.
        got = {item["id"]: item for item in row["process_request"]["inputs"]}
        want = {item["id"]: item for item in expected["inputs"]}
        if set(got) != set(want):
            raise ValueError("The original request input names differ")
        for key in got:
            if got[key].get("type") != "text/plain":
                raise ValueError("Use the captured publisher input representation")
            if key in ("lat", "lon"):
                if float(got[key]["value"]) != float(want[key]["value"]):
                    raise ValueError("Process coordinates differ from their original source")
            elif got[key]["value"] != want[key]["value"]:
                raise ValueError("Request must retain full upstream and unsimplified geometry")
        publisher_url(row["basin_url"])
    if len(seen) != 7:
        raise ValueError("Preserve the original seven complete-flow gauges")
    return plan, plan_body, json.loads(manifest_body)


def retain_sources(root, source_root, contract_root, manifest):
    members = {"model-sources.json": sha((source_root / "model-sources.json").read_bytes())}
    for entry in manifest["entries"]:
        for item in [entry, *entry.get("companions", [])]:
            path, expected = item["path"], item["sha256"]
            if path in members and members[path] != expected:
                raise ValueError("The original source manifest has conflicting member hashes")
            members[path] = expected
    for member, expected in sorted(members.items()):
        body = inside(source_root, member).read_bytes()
        if sha(body) != expected:
            raise ValueError("Original source member changed: " + member)
        write(root / "retained-whole-source" / member, body, immutable=True)
    for member in ("request-plan.json", "original/process.json", "original/openapi.json",
                   "original/capture.json"):
        body = inside(contract_root, member).read_bytes()
        write(root / "contract" / member, body, immutable=True)


def _geometry(value):
    if isinstance(value, dict) and value.get("type") == "Feature":
        return _geometry(value.get("geometry"))
    if isinstance(value, dict) and value.get("type") == "FeatureCollection":
        features = value.get("features") or []
        if len(features) != 1:
            raise ValueError("Inspect this original multi-feature basin before materializing it")
        return _geometry(features[0])
    if not isinstance(value, dict) or value.get("type") not in ("Polygon", "MultiPolygon"):
        raise ValueError("The original result does not identify a polygon basin")
    coordinates = value.get("coordinates")
    polygons = [coordinates] if value["type"] == "Polygon" else coordinates
    if not isinstance(polygons, list) or not polygons:
        raise ValueError("The publisher returned an empty basin geometry")
    for polygon in polygons:
        if not polygon:
            raise ValueError("The publisher returned an empty polygon")
        for ring in polygon:
            if len(ring) < 4 or ring[0] != ring[-1]:
                raise ValueError("Original polygon ring is incomplete")
            for point in ring:
                if (not isinstance(point, list) or len(point) < 2
                        or any(isinstance(x, bool) or not isinstance(x, (int, float))
                               or not math.isfinite(x) for x in point)
                        or not -180 <= point[0] <= 180 or not -90 <= point[1] <= 90):
                    raise ValueError("Original geometry is not a finite geographic polygon")
    return copy.deepcopy(value)


def basin_geometry(value, route):
    if route == "basin":
        return _geometry(value)
    # The live process declares named outputs. Preserve the returned basin only;
    # never replace it with the local catchment or an inferred geometric union.
    if isinstance(value, dict):
        containers = [value]
        if isinstance(value.get("outputs"), dict):
            containers.insert(0, value["outputs"])
        for container in containers:
            if "drainageBasin" in container:
                item = container["drainageBasin"]
                if isinstance(item, dict) and "value" in item:
                    item = item["value"]
                return _geometry(item)
        if isinstance(value.get("outputs"), list):
            named = [item for item in value["outputs"] if item.get("id") == "drainageBasin"]
            if len(named) == 1 and "value" in named[0]:
                return _geometry(named[0]["value"])
        if value.get("type") == "FeatureCollection":
            matches = [item for item in value.get("features", [])
                       if any(str((item.get("properties") or {}).get(key, "")).casefold() == "drainagebasin"
                              for key in ("type", "name", "id", "output"))
                       or str(item.get("id", "")).casefold() == "drainagebasin"]
            if len(matches) == 1:
                return _geometry(matches[0])
    raise ValueError("Original process result needs its explicit drainageBasin output binding")


def job_link(response, value):
    headers = {key.lower(): value for key, value in response.get("headers", {}).items()}
    candidate = headers.get("location")
    if not candidate and isinstance(value, dict):
        for link in value.get("links") or []:
            if link.get("rel") in ("status", "monitor", "self") and "/jobs/" in link.get("href", ""):
                candidate = link["href"]
                break
        if not candidate:
            identity = value.get("jobID") or value.get("jobId")
            if identity:
                candidate = "/nldi/pygeoapi/jobs/" + str(identity)
    if not candidate:
        return None
    link = publisher_url(candidate, response.get("response_url"))
    if "/pygeoapi/jobs/" not in urlsplit(link).path:
        raise ValueError("The original process returned an unexpected job location")
    return link


def result_link(value, job_url):
    for link in value.get("links") or []:
        if link.get("rel") in ("results", "http://www.opengis.net/def/rel/ogc/1.0/results"):
            return publisher_url(link["href"], job_url)
    return publisher_url(urlsplit(job_url)._replace(
        path=urlsplit(job_url).path.rstrip("/") + "/results", query="f=json").geturl())


def save_state(root, state):
    state["updated_at"] = now()
    dump(root / "capture.json", state)


def request_once(root, state, station, method, url, body, timeout, stage):
    item = state["stations"][station["station_id"]]
    sequence = item.get("next_sequence", 1)
    item["next_sequence"] = sequence + 1
    item["active_request"] = {"sequence": sequence, "method": method, "url": url,
                              "stage": stage, "started_at": now()}
    if method == "POST":
        item["state"] = "submission_in_progress"
    save_state(root, state)
    response = acquire(root, station["station_id"], sequence, method, url, body, timeout, stage)
    item.setdefault("responses", []).append(response)
    item.pop("active_request", None)
    save_state(root, state)
    return response


def retain_result(root, state, station, response):
    item = state["stations"][station["station_id"]]
    value = json_response(root, response)
    geometry = basin_geometry(value, state["route"])
    path = "results/" + station["site_no"] + ".geometry.json"
    write(root / path, canonical(geometry), immutable=True)
    item.update(state="complete", result_response=response, geometry_path=path,
                geometry_sha256=sha(canonical(geometry)), completed_at=now())
    item.pop("error", None)
    save_state(root, state)


def response_state(root, state, station, response):
    item = state["stations"][station["station_id"]]
    if response.get("transport_error"):
        item.update(state="submission_uncertain" if response["request"]["method"] == "POST" else "request_failed",
                    error=response["transport_error"])
        save_state(root, state)
        return
    if response["status"] not in (200, 201, 202):
        item.update(state="publisher_error", error={"status": response["status"],
                    "original_response": response["record_path"]})
        save_state(root, state)
        return
    try:
        # A documented 201/202 may identify its retained job only in Location.
        # Preserve that continuation even when the original body is empty or non-JSON.
        job = job_link(response, {})
        if not job:
            value = json_response(root, response)
            job = job_link(response, value)
        if job:
            item.update(state="job_pending", job_url=job)
            save_state(root, state)
        else:
            retain_result(root, state, station, response)
    except (ValueError, KeyError, TypeError) as error:
        item.update(state="result_review", error={"type": type(error).__name__, "message": str(error),
                    "original_response": response["record_path"]})
        save_state(root, state)


def poll_job(root, state, station, timeout):
    item = state["stations"][station["station_id"]]
    response = request_once(root, state, station, "GET", item["job_url"], None, timeout, "job-status")
    if response.get("transport_error") or response.get("status") != 200:
        item["last_poll_error"] = response.get("transport_error") or {"status": response.get("status")}
        save_state(root, state)
        return
    try:
        value = json_response(root, response)
        status = str(value.get("status") or "").casefold()
        item["publisher_job_status"] = status
        if status in {"failed", "dismissed"}:
            item.update(state="job_failed", error=value)
        elif status in TERMINAL:
            result = request_once(root, state, station, "GET", result_link(value, item["job_url"]),
                                  None, timeout, "job-results")
            if result.get("status") == 200 and not result.get("transport_error"):
                retain_result(root, state, station, result)
            else:
                item["last_poll_error"] = result.get("transport_error") or {"status": result.get("status")}
        elif value.get("type") in ("Feature", "FeatureCollection") or "drainageBasin" in value:
            retain_result(root, state, station, response)
    except (ValueError, KeyError, TypeError) as error:
        item["last_poll_error"] = {"type": type(error).__name__, "message": str(error)}
    save_state(root, state)


def materialize(root, state, plan):
    features, bindings = [], []
    route = state["route"]
    support = ("nhdplusv2_upstream_gauge_split" if route == "basin"
               else "nhdplusv2_coordinate_delineated_upstream")
    for station in plan["stations"]:
        item = state["stations"][station["station_id"]]
        if item["state"] != "complete":
            continue
        raw = inside(root, item["geometry_path"]).read_bytes()
        if sha(raw) != item["geometry_sha256"]:
            raise ValueError("Original-derived geometry changed after capture")
        response = item["result_response"]
        properties = {"station_id": station["station_id"], "site_no": station["site_no"],
                      "ts_id": station["ts_id"], "comid": station["comid"], "reachcode": station["reachcode"],
                      "measure": station["measure"], "basin_id": "nldi-" + route + "-" + station["station_id"],
                      "support_kind": support, "query_simplified": False,
                      "query_split_catchment": True, "source_method": route,
                      "requested_longitude": station["longitude"], "requested_latitude": station["latitude"],
                      "original_feature_sha256": station["feature_original_sha256"],
                      "original_response_path": response["body_path"],
                      "original_response_sha256": response["body_sha256"],
                      "original_request_path": response["request_path"],
                      "job_url": item.get("job_url")}
        features.append({"type": "Feature", "id": properties["basin_id"],
                         "properties": properties, "geometry": json.loads(raw)})
        bindings.append(properties)
    dump(root / "derived/split-basins.geojson", {"type": "FeatureCollection", "features": features})
    dump(root / "derived/station-basin-bindings.json", bindings)
    summary = {"schema": "upstate.nldi-split-source-summary/v1", "operation_id": OPERATION,
               "version": VERSION, "route": route, "support_kind": support,
               "selected": len(plan["stations"]), "completed": len(features),
               "complete": len(features) == len(plan["stations"]),
               "stations": [{"station_id": row["station_id"],
                             "state": state["stations"][row["station_id"]]["state"]}
                            for row in plan["stations"]],
               "geometry_basis": "Original named publisher basin geometry; coordinate arrays retained without repair or simplification.",
               "source_relation": ("Original indexed-gauge split request." if route == "basin" else
                    "Coordinate-delineated at the original NLDI gauge point. Retain this method separately from indexed-feature basin retrieval."),
               "source_operation": plan["source_operation"]}
    dump(root / "source-summary.json", summary)
    if not features:
        return summary
    # Freeze a source snapshot for this actual completed-set identity. A later
    # resume publishes a new immutable edition, leaving previous imports usable.
    all_paths = sorted(p for p in root.rglob("*") if p.is_file()
                       and not p.is_relative_to(root / "editions")
                       and p.name not in (".capture.lock", "receiving-result.json"))
    content = {p.relative_to(root).as_posix(): p.read_bytes() for p in all_paths}
    edition_identity = sha(canonical({"selection": state["selection_sha256"],
                                     "results": [(x["station_id"], x["original_response_sha256"]) for x in bindings]}))
    edition = root / "editions" / edition_identity
    published_manifest = edition / "model-sources.json"
    if published_manifest.exists():
        existing = read_json(published_manifest)
        entry = existing["entries"][0]
        for descriptor in [entry, *entry.get("companions", [])]:
            body = inside(edition, descriptor["path"]).read_bytes()
            if sha(body) != descriptor["sha256"]:
                raise ValueError("An existing immutable source edition changed")
        return {**summary, "source_manifest": str(published_manifest)}
    if edition.exists():
        raise ValueError("An incomplete source-edition directory requires recovery before publication")
    primary = "derived/split-basins.geojson"
    companions = [{"path": member, "sha256": sha(body)}
                  for member, body in sorted(content.items()) if member != primary]
    manifest = {"schema": "upstate.sources/v1",
                "title": "Original NLDI gauge split support — " + route,
                "entries": [{"id": "nldi-seven-gauge-split-" + route + "-20261013",
                             "title": "Original returned upstream basin support",
                             "kind": "vector", "role": "gauge-upstream-split-catchment-support",
                             "path": primary, "sha256": sha(content[primary]), "crs": "OGC:CRS84",
                             "id_field": "basin_id", "vintage": "USGS-NLDI-2026-10-13-" + route,
                             "uri": plan["source_operation"], "support_kind": support,
                             "source_method": route, "companions": companions}]}
    edition.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".source-edition-", dir=edition.parent) as temporary:
        staged = Path(temporary) / "source"
        staged.mkdir()
        for member, body in content.items():
            write(staged / member, body, immutable=True)
        dump(staged / "model-sources.json", manifest, immutable=True)
        os.rename(staged, edition)
        descriptor = os.open(edition.parent, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    return {**summary, "source_manifest": str(edition / "model-sources.json")}


def capture(args):
    root = Path(args.output).expanduser().absolute()
    source_root = Path(args.source_root).expanduser().resolve(strict=True)
    contract_root = Path(args.contract_root).expanduser().resolve(strict=True)
    if root.resolve().is_relative_to(source_root) or root.resolve().is_relative_to(contract_root):
        raise ValueError("Keep native capture output outside its original source directories")
    plan, plan_body, manifest = contracts(contract_root, source_root)
    root.mkdir(parents=True, exist_ok=True)
    with (root / ".capture.lock").open("a+b") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        retain_sources(root, source_root, contract_root, manifest)
        selection = {"plan_sha256": sha(plan_body), "route": args.route, "operation_id": OPERATION}
        identity = sha(canonical(selection))
        state_path = root / "capture.json"
        if state_path.exists():
            state = read_json(state_path)
            if state.get("schema") != SCHEMA or state.get("selection_sha256") != identity:
                raise ValueError("Resume the original route and gauge selection in this directory")
        else:
            state = {"schema": SCHEMA, "operation_id": OPERATION, "version": VERSION,
                     "selection": selection, "selection_sha256": identity,
                     "route": args.route, "created_at": now(),
                     "stations": {row["station_id"]: {"state": "pending", "responses": []}
                                  for row in plan["stations"]}}
        state["runtime"] = {"hostname": socket.gethostname(), "pid": os.getpid(),
                            "interpreter": sys.executable, "python": sys.version, "started_at": now()}
        chosen = set(args.station or [row["station_id"] for row in plan["stations"]])
        if not chosen <= state["stations"].keys():
            raise ValueError("Choose an original plan station_id, including its USGS- prefix")
        retry = set(args.retry_station or [])
        if not retry <= chosen:
            raise ValueError("Retry only an explicitly selected original station")
        originals = {row["station_id"]: row for row in plan["stations"]}
        for identity_key, item in state["stations"].items():
            if item.get("active_request"):
                active = item.pop("active_request")
                item["interrupted_request"] = active
                relative = ("responses/" + identity_key + "/%05d-%s/response.json"
                            % (active["sequence"], active["stage"]))
                retained = inside(root, relative)
                if retained.exists():
                    response = read_json(retained)
                    request = response.get("request") or {}
                    if (request.get("method") != active["method"]
                            or request.get("url") != active["url"]):
                        raise ValueError("Interrupted request journal differs from its saved selection")
                    response["record_path"] = relative
                    item.setdefault("responses", []).append(response)
                    if active["stage"] == "submit":
                        response_state(root, state, originals[identity_key], response)
                    elif item.get("job_url"):
                        item["state"] = "job_pending"
                else:
                    item["state"] = ("job_pending" if item.get("job_url") else
                                     "submission_uncertain" if active["method"] == "POST" else
                                     "request_failed")
            if item["state"] == "submission_in_progress" and item.get("responses"):
                response_state(root, state, originals[identity_key], item["responses"][-1])
            if identity_key in retry and item["state"] not in ("complete", "job_pending"):
                item["state"] = "pending"
                item.pop("error", None)
        for text in args.job or []:
            site, sep, link = text.partition("=")
            if not sep or site not in chosen:
                raise ValueError("Use --job USGS-SITE=original-publisher-job-URL")
            link = publisher_url(link)
            if "/pygeoapi/jobs/" not in urlsplit(link).path:
                raise ValueError("Use the actual original USGS job URL")
            item = state["stations"][site]
            if item["state"] == "complete":
                raise ValueError("The original station result is already complete")
            item.update(state="job_pending", job_url=link, job_adopted_at=now())
        save_state(root, state)
        for station in plan["stations"]:
            if station["station_id"] not in chosen:
                continue
            item = state["stations"][station["station_id"]]
            if item["state"] == "pending":
                method = "GET" if args.route == "basin" else "POST"
                url = station["basin_url"] if method == "GET" else plan["process_uri"]
                body = None if method == "GET" else station["process_request"]
                response = request_once(root, state, station, method, url, body, args.timeout, "submit")
                response_state(root, state, station, response)
            if item["state"] == "job_pending":
                poll_job(root, state, station, args.timeout)
        deadline = time.monotonic() + args.wait_seconds
        while time.monotonic() < deadline:
            pending = [row for row in plan["stations"] if row["station_id"] in chosen
                       and state["stations"][row["station_id"]]["state"] == "job_pending"]
            if not pending:
                break
            time.sleep(min(args.poll_seconds, max(0., deadline - time.monotonic())))
            for station in pending:
                poll_job(root, state, station, args.timeout)
        result = materialize(root, state, plan)
        dump(root / "receiving-result.json", {**result, "runtime": state["runtime"],
                                             "capture": str(state_path), "completed_at": now()})
        event(result)
        return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True)
    parser.add_argument("--source-root", default=str(SOURCE_ROOT / "nldi"))
    parser.add_argument("--contract-root", default=str(DEFAULT_CONTRACT))
    parser.add_argument("--route", choices=("basin", "process"), default="process")
    parser.add_argument("--station", action="append", help="Optional original USGS-SITE; default all seven")
    parser.add_argument("--retry-station", action="append",
                        help="Explicit retry after reviewing the retained failed/uncertain original request")
    parser.add_argument("--job", action="append", help="Adopt the original returned USGS-SITE=job URL")
    parser.add_argument("--timeout", type=float, default=600.)
    parser.add_argument("--wait-seconds", type=float, default=600.)
    parser.add_argument("--poll-seconds", type=float, default=15.)
    args = parser.parse_args(argv)
    if (not all(math.isfinite(x) for x in (args.timeout, args.wait_seconds, args.poll_seconds))
            or args.timeout <= 0 or args.wait_seconds < 0 or args.poll_seconds < 1):
        parser.error("Choose positive timeout/poll values and non-negative wait seconds")
    result = capture(args)
    return 0 if result["complete"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
