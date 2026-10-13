"""Acquire original Upper Savannah network and freshwater source editions.

Retains count/ID/geometry responses for the existing water_context_intake
receiver. The original 217-HUC domain archive is required.
"""
from __future__ import annotations
import argparse, datetime, gzip, hashlib, json, os, re, time, urllib.error, urllib.parse, urllib.request, zipfile
from decimal import Decimal, localcontext
from pathlib import Path

OPERATION = "ECO13-AE11-WATER-SOURCE-20261013"
LAYERS = {
    "stream_order": "https://hydro.nationalmap.gov/arcgis/rest/services/NHDPlus_HR/MapServer/3",
    "freshwater": "https://gis.des.sc.gov/gisserver/rest/services/water/SCHydroClass/MapServer/2",
}
SPATIAL_RELATIONS = {"intersects": "esriSpatialRelIntersects",
                     "envelope": "esriSpatialRelEnvelopeIntersects",
                     "index": "esriSpatialRelIndexIntersects"}
DOMAIN_HASH = "ec0cb3d05a0ede9da1b9238b7c7bff2fa495d94e5a6a0451890b54233edfbd52"

def encode(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
def sha(raw):
    return hashlib.sha256(raw).hexdigest()
def json_file(path):
    raw = Path(path).read_bytes()
    return json.loads(gzip.decompress(raw) if raw.startswith(b"\x1f\x8b") else raw)
def write(path, body):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".part")
    with tmp.open("wb") as target:
        target.write(body)
        target.flush()
        os.fsync(target.fileno())
    tmp.replace(path)
def dump(path, value):
    write(path, encode(value) + b"\n")

class OriginalSource:
    def __init__(self, root, timeout=60):
        self.root, self.timeout = Path(root), timeout
        self.root.mkdir(parents=True, exist_ok=True)

    def read(self, label, url, parameters=None, split_timeouts=False):
        parameters = parameters or {}
        query = urllib.parse.urlencode(parameters)
        # Long native-ID selections use the publisher's equivalent POST query.
        use_post = len(url) + len(query) > 7000
        request = {"url": url, "parameters": parameters, "method": "POST" if use_post else "GET"}
        folder = self.root / "original" / (label + "-" + sha(encode(request))[:20])
        body_path, record_path = folder / "body.json.gz", folder / "request.json"
        if body_path.exists() and record_path.exists():
            record = json_file(record_path)
            raw = gzip.decompress(body_path.read_bytes())
            if record["request"] != request or sha(raw) != record["response_sha256"]:
                raise ValueError("Saved original response differs from its recorded request")
            return json.loads(raw), str(body_path.relative_to(self.root)), str(record_path.relative_to(self.root))
        target = url if use_post or not query else url + "?" + query
        payload = query.encode() if use_post else None
        headers = {"User-Agent": "TokenJunkieLabs-UpperSavannah/1.0", "Accept": "application/json"}
        if use_post:
            headers["Content-Type"] = "application/x-www-form-urlencoded"
        for attempt in range(3):
            try:
                started = datetime.datetime.now(datetime.timezone.utc).isoformat()
                with urllib.request.urlopen(urllib.request.Request(target, data=payload, headers=headers), timeout=self.timeout) as response:
                    raw = response.read()
                    response_headers = {key.lower(): value for key, value in response.headers.items()
                                        if key.lower() in ("content-type", "etag", "last-modified", "date")}
                value = json.loads(raw)
                if isinstance(value, dict) and value.get("error"):
                    raise ValueError("Publisher returned " + json.dumps(value["error"]))
                body = gzip.compress(raw, compresslevel=6, mtime=0)
                write(body_path, body)
                dump(record_path, {"schema": "upstate.original-http-response/v1",
                    "operation_id": OPERATION, "request": request, "captured_at": started,
                    "response_sha256": sha(raw), "response_bytes": len(raw),
                    "stored_sha256": sha(body), "stored_bytes": len(body),
                    "response_headers": response_headers})
                return value, str(body_path.relative_to(self.root)), str(record_path.relative_to(self.root))
            except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
                if split_timeouts and subdivision_candidate(error):
                    raise
                if attempt == 2:
                    raise
                wait = 2 ** (attempt + 1)
                if isinstance(error, urllib.error.HTTPError):
                    if error.code not in (408, 429, 500, 502, 503, 504):
                        raise
                    retry = error.headers.get("Retry-After", "")
                    if retry.isdigit():
                        wait = max(wait, int(retry))
                print(json.dumps({"request": label, "retry": attempt + 1, "wait_seconds": wait, "error": str(error)}), flush=True)
                time.sleep(wait)

def load_domain(path, output):
    with zipfile.ZipFile(path) as archive:
        summary = json.loads(archive.read("domain-summary.json"))
        bindings = json.loads(archive.read("feature-bindings.json"))
        hucs = bindings["selected_huc12"]
        original = json.dumps(hucs, separators=(",", ":")).encode()
        if len(hucs) != 217 or len(set(hucs)) != 217 or sha(original) != DOMAIN_HASH:
            raise ValueError("Select the original retained 217-HUC domain")
        write(output / "domain-huc12s.json", original)
        write(output / "domain-summary.json", archive.read("domain-summary.json"))
        write(output / "feature-bindings.json", archive.read("feature-bindings.json"))
    return summary, hucs


def subdivision_candidate(error):
    """Split only transient envelope failures; quota errors retain normal backoff."""
    if isinstance(error, urllib.error.HTTPError):
        return error.code in (408, 502, 503, 504)
    if isinstance(error, TimeoutError):
        return True
    reason = getattr(error, "reason", None)
    return isinstance(reason, TimeoutError) or "timed out" in str(reason).lower()

def subdivide_scope(scope, exact=False):
    """Four adjoining envelopes cover the parent; explicit HUC scopes retain decimals."""
    if exact:
        from source_tools.original_huc12_bounds import parsed, exact_json
        envelope = parsed(scope["geometry"])
    else:
        envelope = json.loads(scope["geometry"])
    xmin, ymin, xmax, ymax = (envelope[key] for key in ("xmin", "ymin", "xmax", "ymax"))
    if exact:
        values = [Decimal(value) for value in (xmin, ymin, xmax, ymax)]
        with localcontext() as context:
            context.prec = max(50, max(len(value.as_tuple().digits) +
                                       abs(value.as_tuple().exponent) for value in values) * 2 + 10)
            xmid, ymid = (values[0] + values[2]) / 2, (values[1] + values[3]) / 2
    else:
        xmid, ymid = (xmin + xmax) / 2, (ymin + ymax) / 2
    if not xmin < xmid < xmax or not ymin < ymid < ymax:
        raise ValueError("Envelope cannot be subdivided without losing coordinate precision")
    children = []
    for row in range(2):
        for column in range(2):
            bounds = {
                "xmin": xmin if column == 0 else xmid,
                "ymin": ymin if row == 0 else ymid,
                "xmax": xmid if column == 0 else xmax,
                "ymax": ymid if row == 0 else ymax,
                "spatialReference": envelope.get("spatialReference", {"wkid": 3857})}
            child = dict(scope, geometry=exact_json(bounds) if exact else encode(bounds).decode())
            children.append(child)
    return children

def capture_layer(source, kind, summary, hucs, chunk, counts_only=False, stream_grid=1, stream_max_depth=4, stream_spatial_relation="intersects", native_scopes=None):
    if native_scopes is not None and kind != "stream_order":
        raise ValueError("Explicit native envelopes belong to the stream-order capture")
    url = LAYERS[kind]
    metadata, metadata_path, metadata_receipt = source.read(kind + "-metadata", url, {"f": "pjson"})
    oid = [field["name"] for field in metadata["fields"] if field["type"] == "esriFieldTypeOID"]
    if len(oid) != 1:
        raise ValueError("Publisher must identify its native object ID field")
    oid = oid[0]
    if kind == "freshwater":
        scopes = [{"where": "H2OCLASS = 'FW' AND HUC_12 IN (" + ",".join("'" + huc + "'" for huc in hucs) + ")"}]
        meaning = {"selection": "publisher HUC_12 membership and H2OCLASS='FW'", "huc_ids": "domain-huc12s.json"}
    else:
        relation = SPATIAL_RELATIONS[stream_spatial_relation]
        supported = metadata.get("supportedSpatialRelationships", [])
        if supported and relation not in supported:
            raise ValueError("Original publisher metadata does not support " + relation)
        if native_scopes is not None:
            from source_tools.original_huc12_bounds import parsed, exact_json
            if not isinstance(native_scopes, list) or not native_scopes:
                raise ValueError("Explicit native scopes must contain retained envelopes")
            scopes, scope_ids, seen_scopes = [], [], set()
            for item in native_scopes:
                label = item.get("id")
                if (not isinstance(label, str)
                        or re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}", label) is None
                        or label in seen_scopes):
                    raise ValueError("Explicit native scopes need unique stable identifiers")
                geometry = item.get("geometry")
                if not isinstance(geometry, str):
                    raise ValueError("Explicit envelope geometry must retain its numeric JSON")
                envelope = parsed(geometry)
                reference = envelope.get("spatialReference", {})
                if reference.get("latestWkid", reference.get("wkid")) not in (3857, 102100, 102113):
                    raise ValueError("Explicit envelopes must use the original native EPSG:3857")
                coordinates = [envelope.get(key) for key in ("xmin", "ymin", "xmax", "ymax")]
                if (any(isinstance(value, bool) or not isinstance(value, (int, Decimal))
                        or isinstance(value, Decimal) and not value.is_finite()
                        for value in coordinates)
                        or not coordinates[0] < coordinates[2]
                        or not coordinates[1] < coordinates[3]):
                    raise ValueError("Explicit native envelope has invalid original bounds")
                seen_scopes.add(label)
                scope_ids.append(label)
                scopes.append({"where": "1=1", "geometry": exact_json(envelope),
                               "geometryType": "esriGeometryEnvelope", "inSR": "3857",
                               "spatialRel": relation})
            meaning = {
                "selection": "union of explicitly retained native HUC12 envelope candidates",
                "native_scopes": [{"id": label, "geometry": scope["geometry"]}
                                  for label, scope in zip(scope_ids, scopes)],
                "candidate_spatial_relationship": relation,
                "exact_domain_membership": "water_context_geometry.select_domain_objects",
            }
        else:
            xmin, ymin, xmax, ymax = summary["native_bounds"]
            if not xmin < xmax or not ymin < ymax:
                raise ValueError("Original model-domain bounds must have positive extent")
            scopes = []
            for row in range(stream_grid):
                for column in range(stream_grid):
                    envelope = {
                        "xmin": xmin + (xmax - xmin) * column / stream_grid,
                        "ymin": ymin + (ymax - ymin) * row / stream_grid,
                        "xmax": xmax if column + 1 == stream_grid else xmin + (xmax - xmin) * (column + 1) / stream_grid,
                        "ymax": ymax if row + 1 == stream_grid else ymin + (ymax - ymin) * (row + 1) / stream_grid,
                        "spatialReference": {"wkid": 3857}}
                    scopes.append({"where": "1=1", "geometry": encode(envelope).decode(),
                                   "geometryType": "esriGeometryEnvelope", "inSR": "3857",
                                   "spatialRel": relation})
            meaning = {"selection": "union of native model-domain envelope tile candidates",
                       "domain_bounds_3857": summary["native_bounds"], "tile_rows": stream_grid,
                       "candidate_spatial_relationship": relation,
                       "tile_columns": stream_grid,
                       "exact_domain_membership": "water_context_geometry.select_domain_objects"}
    native_id_set, queries, companions = set(), [], [metadata_receipt]
    inventory_progress = {"schema": "upstate.native-query-progress/v1",
                          "kind": kind, "scope": meaning, "completed": [], "subdivisions": []}
    progress_path = source.root / (kind + "-inventory-progress.json")
    previous_subdivisions = {}
    if progress_path.exists():
        previous = json_file(progress_path)
        if previous.get("schema") != inventory_progress["schema"]:
            raise ValueError("Existing inventory progress uses a different schema")
        if previous.get("kind") == kind and (previous.get("scope") == meaning or native_scopes is not None):
            # Stable HUC suffixes plus inventory()\'s exact scope/depth check keep
            # original split decisions reusable when other HUCs are now covered.
            inventory_progress["subdivisions"] = list(previous.get("subdivisions", []))
            previous_subdivisions = {item["suffix"]: item for item in inventory_progress["subdivisions"]}

    def inventory(scope, suffix, depth):
        previous = previous_subdivisions.get(suffix)
        if previous and previous.get("scope") == scope and previous.get("depth") == depth:
            companions.extend(previous.get("retained_count_sources", []))
            for index, child in enumerate(subdivide_scope(scope, exact=native_scopes is not None)):
                inventory(child, suffix + "-q" + str(index), depth + 1)
            return
        adaptive = kind == "stream_order" and depth < stream_max_depth
        retained_count_sources = []
        try:
            count, count_path, count_receipt = source.read(kind + "-count" + suffix, url + "/query",
                                                          dict(scope, f="json", returnCountOnly="true"), split_timeouts=adaptive)
            retained_count_sources = [count_path, count_receipt]
            ids, ids_path, ids_receipt = source.read(kind + "-ids" + suffix, url + "/query",
                                                    dict(scope, f="json", returnIdsOnly="true"), split_timeouts=adaptive)
        except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
            if kind != "stream_order" or depth >= stream_max_depth or not subdivision_candidate(error):
                raise
            children = subdivide_scope(scope, exact=native_scopes is not None)
            inventory_progress["subdivisions"].append({
                "suffix": suffix, "depth": depth, "scope": scope,
                "error_type": type(error).__name__, "error": str(error),
                "retained_count_sources": retained_count_sources,
                "children": [suffix + "-q" + str(index) for index in range(4)]})
            companions.extend(retained_count_sources)
            dump(progress_path, inventory_progress)
            print(json.dumps({"kind": kind, "scope": suffix, "subdivide": True,
                              "depth": depth, "reason": str(error)}), flush=True)
            for index, child in enumerate(children):
                inventory(child, suffix + "-q" + str(index), depth + 1)
            return
        selected = ids.get("objectIds") or []
        if ids.get("exceededTransferLimit") or len(selected) != len(set(selected)) or len(selected) != count["count"]:
            raise ValueError("Original count and complete unique native IDs disagree for " + kind + suffix)
        if ids.get("objectIdFieldName", oid) != oid:
            raise ValueError("Native inventory object ID field differs from the original metadata")
        native_id_set.update(selected)
        query = {"count": count_path, "ids": ids_path, "request": ids_receipt}
        queries.append(query)
        companions.extend([count_receipt, ids_receipt])
        inventory_progress["completed"].append({
            "suffix": suffix, "depth": depth, "scope": scope,
            "count": len(selected), "sources": query})
        inventory_progress["unique_native_ids"] = len(native_id_set)
        dump(progress_path, inventory_progress)
        print(json.dumps({"kind": kind, "scope": suffix or "whole",
                          "scope_count": len(selected), "unique_native_ids": len(native_id_set)}), flush=True)

    for scope_index, scope in enumerate(scopes):
        suffix = ("-scope-" + scope_ids[scope_index] if native_scopes is not None
                  else "" if len(scopes) == 1 else "-tile-" + str(scope_index).zfill(4))
        inventory(scope, suffix, 0)
    native_ids = sorted(native_id_set)
    descriptor = {"kind": kind, "uri": url, "metadata": metadata_path,
                  "queries": queries, "pages": [], "scope": meaning,
                  "companions": companions + [str(progress_path.relative_to(source.root))]}
    if kind == "freshwater":
        descriptor.update(huc_ids="domain-huc12s.json", expected_huc_count=217)
    print(json.dumps({"kind": kind, "original_count": len(native_ids)}), flush=True)
    checkpoint = source.root / (kind + "-capture.json")
    dump(checkpoint, descriptor)
    if counts_only:
        return descriptor
    size = min(chunk, int(metadata.get("maxRecordCount", 2000)))
    received = set()
    geometry_progress_path = source.root / (kind + "-geometry-progress.json")
    geometry_progress = {"schema": "upstate.native-geometry-progress/v1",
                         "kind": kind, "native_ids_sha256": sha(encode(native_ids)),
                         "subdivisions": []}
    if geometry_progress_path.exists():
        previous = json_file(geometry_progress_path)
        if previous.get("schema") != geometry_progress["schema"]:
            raise ValueError("Existing geometry progress uses a different schema")
        if previous.get("kind") == kind and previous.get("native_ids_sha256") == geometry_progress["native_ids_sha256"]:
            geometry_progress["subdivisions"] = list(previous.get("subdivisions", []))
    split_batches = {item["label"]: item for item in geometry_progress["subdivisions"]}
    descriptor["companions"].append(str(geometry_progress_path.relative_to(source.root)))
    dump(geometry_progress_path, geometry_progress)

    def capture_geometry(batch, label):
        batch_hash = sha(encode(batch))
        previous = split_batches.get(label)
        if previous and previous.get("native_ids_sha256") == batch_hash:
            middle = len(batch) // 2
            if middle < 1:
                raise ValueError("Saved geometry subdivision cannot split a singleton")
            capture_geometry(batch[:middle], label + "-a")
            capture_geometry(batch[middle:], label + "-b")
            return
        query = {"f": "json", "objectIds": ",".join(map(str, batch)), "outFields": "*",
                 "returnGeometry": "true", "returnTrueCurves": "false",
                 "returnZ": "true" if metadata.get("hasZ") else "false",
                 "returnM": "true" if metadata.get("hasM") else "false"}
        try:
            value, page, receipt = source.read(label, url + "/query", query,
                                               split_timeouts=len(batch) > 1)
        except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
            if len(batch) <= 1 or not subdivision_candidate(error):
                raise
            decision = {"label": label, "native_ids_sha256": batch_hash,
                        "count": len(batch), "error_type": type(error).__name__, "error": str(error)}
            geometry_progress["subdivisions"].append(decision)
            split_batches[label] = decision
            dump(geometry_progress_path, geometry_progress)
            print(json.dumps({"kind": kind, "geometry_batch": label,
                              "subdivide": True, "count": len(batch), "reason": str(error)}), flush=True)
            middle = len(batch) // 2
            capture_geometry(batch[:middle], label + "-a")
            capture_geometry(batch[middle:], label + "-b")
            return
        rows = value.get("features")
        if not isinstance(rows, list) or value.get("exceededTransferLimit"):
            raise ValueError("Publisher geometry page is absent or truncated")
        observed = [row["attributes"][oid] for row in rows]
        if set(observed) != set(batch) or len(observed) != len(batch) or set(observed) & received:
            raise ValueError("Original page does not match its requested native IDs")
        if any(not row.get("geometry") for row in rows):
            raise ValueError("Original feature has no geometry")
        received.update(observed)
        descriptor["pages"].append(page)
        descriptor["companions"].append(receipt)
        dump(checkpoint, descriptor)
        print(json.dumps({"kind": kind, "geometry_batch": label,
                          "received": len(received), "total": len(native_ids)}), flush=True)

    for start in range(0, len(native_ids), size):
        batch = native_ids[start:start + size]
        capture_geometry(batch, kind + "-geometry-" + str(start // size).zfill(4))
    if received != set(native_ids):
        raise ValueError("Original geometry capture is incomplete")
    return descriptor

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--domain-archive", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--layer", choices=["all", "stream_order", "freshwater"], default="all")
    parser.add_argument("--chunk", type=int, default=500)
    parser.add_argument("--timeout", type=int, default=60)
    parser.add_argument("--counts-only", action="store_true")
    parser.add_argument("--stream-grid", type=int, default=1,
                        help="Split the entire NHD envelope into NxN native count/ID queries; union IDs before geometry download")
    parser.add_argument("--stream-max-depth", type=int, default=4,
                        help="Recursively split timed-out NHD tiles up to this depth; 0 disables adaptive splitting")
    parser.add_argument("--stream-spatial-relation", choices=list(SPATIAL_RELATIONS), default="intersects",
                        help="Native candidate query: intersects, feature envelope, or primary spatial index; exact domain selection follows")
    args = parser.parse_args(argv)
    if not 1 <= args.chunk <= 2000:
        parser.error("--chunk must be from 1 to 2000")
    if not 1 <= args.stream_grid <= 16:
        parser.error("--stream-grid must be from 1 to 16")
    if not 0 <= args.stream_max_depth <= 8:
        parser.error("--stream-max-depth must be from 0 to 8")
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    summary, hucs = load_domain(args.domain_archive, output)
    reader = OriginalSource(output, args.timeout)
    kinds = list(LAYERS) if args.layer == "all" else [args.layer]
    layers = [capture_layer(reader, kind, summary, hucs, args.chunk, args.counts_only, args.stream_grid, args.stream_max_depth, args.stream_spatial_relation) for kind in kinds]
    packet = {"schema": "upstate.water-context-capture/v1", "operation_id": OPERATION,
              "captured_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
              "scope": {"domain_source_id": summary["source_id"], "huc_ids": "domain-huc12s.json",
                        "domain_summary": "domain-summary.json"}, "layers": layers,
              "complete_geometry": not args.counts_only}
    dump(output / "capture.json", packet)
    print(json.dumps({"capture": str(output / "capture.json"), "complete_geometry": not args.counts_only}), flush=True)
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
