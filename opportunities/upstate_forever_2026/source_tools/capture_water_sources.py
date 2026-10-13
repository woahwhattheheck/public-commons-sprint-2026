"""Acquire original Upper Savannah network and freshwater source editions.

Retains count/ID/geometry responses for the existing water_context_intake
receiver. The original 217-HUC domain archive is required.
"""
from __future__ import annotations
import argparse, datetime, gzip, hashlib, json, os, time, urllib.error, urllib.parse, urllib.request, zipfile
from pathlib import Path

OPERATION = "ECO13-AE11-WATER-SOURCE-20261013"
LAYERS = {
    "stream_order": "https://hydro.nationalmap.gov/arcgis/rest/services/NHDPlus_HR/MapServer/3",
    "freshwater": "https://gis.des.sc.gov/gisserver/rest/services/water/SCHydroClass/MapServer/2",
}
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

    def read(self, label, url, parameters=None):
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

def capture_layer(source, kind, summary, hucs, chunk, counts_only=False):
    url = LAYERS[kind]
    metadata, metadata_path, metadata_receipt = source.read(kind + "-metadata", url, {"f": "pjson"})
    oid = [field["name"] for field in metadata["fields"] if field["type"] == "esriFieldTypeOID"]
    if len(oid) != 1:
        raise ValueError("Publisher must identify its native object ID field")
    oid = oid[0]
    if kind == "freshwater":
        scope = {"where": "H2OCLASS = 'FW' AND HUC_12 IN (" + ",".join("'" + huc + "'" for huc in hucs) + ")"}
        meaning = {"selection": "publisher HUC_12 membership and H2OCLASS='FW'", "huc_ids": "domain-huc12s.json"}
    else:
        xmin, ymin, xmax, ymax = summary["native_bounds"]
        envelope = {"xmin": xmin, "ymin": ymin, "xmax": xmax, "ymax": ymax, "spatialReference": {"wkid": 3857}}
        scope = {"where": "1=1", "geometry": encode(envelope).decode(), "geometryType": "esriGeometryEnvelope",
                 "inSR": "3857", "spatialRel": "esriSpatialRelIntersects"}
        meaning = {"selection": "native model-domain envelope candidates", "domain_bounds_3857": summary["native_bounds"],
                   "exact_domain_membership": "water_context_geometry.select_domain_objects"}
    count, count_path, count_receipt = source.read(kind + "-count", url + "/query", dict(scope, f="json", returnCountOnly="true"))
    ids, ids_path, ids_receipt = source.read(kind + "-ids", url + "/query", dict(scope, f="json", returnIdsOnly="true"))
    native_ids = ids.get("objectIds") or []
    if ids.get("exceededTransferLimit") or len(native_ids) != len(set(native_ids)) or len(native_ids) != count["count"]:
        raise ValueError("Original count and complete unique native IDs disagree")
    native_ids.sort()
    descriptor = {"kind": kind, "uri": url, "metadata": metadata_path,
                  "queries": [{"count": count_path, "ids": ids_path, "request": ids_receipt}],
                  "pages": [], "scope": meaning, "companions": [metadata_receipt, count_receipt, ids_receipt]}
    if kind == "freshwater":
        descriptor.update(huc_ids="domain-huc12s.json", expected_huc_count=217)
    print(json.dumps({"kind": kind, "original_count": len(native_ids)}), flush=True)
    checkpoint = source.root / (kind + "-capture.json")
    dump(checkpoint, descriptor)
    if counts_only:
        return descriptor
    size = min(chunk, int(metadata.get("maxRecordCount", 2000)))
    received = set()
    for start in range(0, len(native_ids), size):
        batch = native_ids[start:start + size]
        query = {"f": "json", "objectIds": ",".join(map(str, batch)), "outFields": "*",
                 "returnGeometry": "true", "returnTrueCurves": "false",
                 "returnZ": "true" if metadata.get("hasZ") else "false",
                 "returnM": "true" if metadata.get("hasM") else "false"}
        value, page, receipt = source.read(kind + "-geometry-" + str(start // size).zfill(4), url + "/query", query)
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
        print(json.dumps({"kind": kind, "page": start // size + 1, "received": len(received), "total": len(native_ids)}), flush=True)
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
    args = parser.parse_args(argv)
    if not 1 <= args.chunk <= 2000:
        parser.error("--chunk must be from 1 to 2000")
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    summary, hucs = load_domain(args.domain_archive, output)
    reader = OriginalSource(output, args.timeout)
    kinds = list(LAYERS) if args.layer == "all" else [args.layer]
    layers = [capture_layer(reader, kind, summary, hucs, args.chunk, args.counts_only) for kind in kinds]
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
