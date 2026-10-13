# -*- coding: utf-8 -*-
"""Official HEC DSSVue/Jython bridge for whole watershed conversion. MIT.
Run through the compatible installed DSSVue/Jython launcher, not CPython.
"""
from hec.heclib.dss import HecDss, HecDssCatalog, HecDSSUtilities
from hec.heclib.util import Heclib
from java.lang import System, Double, Float, Number, Boolean, String, Long, Integer, Short, Byte
from java.nio.file import Files, Paths, StandardCopyOption
from java.lang.reflect import Modifier
import hashlib
import json
import math
import os
import re
import shutil
import sys
import tempfile
import traceback

def raw_json(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")

def sha(value):
    return hashlib.sha256(raw_json(value)).hexdigest()

def file_identity(path):
    h = hashlib.sha256()
    size = 0
    with open(path, "rb") as stream:
        while True:
            data = stream.read(1024 * 1024)
            if not data: break
            size += len(data)
            h.update(data)
    return {"bytes": size, "sha256": h.hexdigest()}

def write_json(path, value):
    temporary = path + ".saving"
    with open(temporary, "wb") as stream:
        stream.write(raw_json(value))
        stream.flush()
        os.fsync(stream.fileno())
    Files.move(Paths.get(temporary), Paths.get(path), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
    sync_parent(path)


def sync_parent(path):
    if os.name != "nt":
        fd = os.open(os.path.dirname(os.path.abspath(path)), os.O_RDONLY)
        try: os.fsync(fd)
        finally: os.close(fd)

def sync_file(path):
    with open(path, "rb") as stream: os.fsync(stream.fileno())
    sync_parent(path)

def normalized_path(path, time_series=False):
    parts = unicode(path).split("/")
    if time_series and len(parts) == 8:
        match = re.match(r"^(\d+)(min|mon)$", parts[5], re.I)
        if match: parts[5] = match.group(1) + ("Minute" if match.group(2).lower() == "min" else "Month")
    return "/".join(parts).upper()

def plain(value, trail=None):
    if value is None: return None
    if isinstance(value, bool): return value
    if isinstance(value, Boolean): return bool(value.booleanValue())
    if isinstance(value, (basestring, String)): return unicode(value)
    if isinstance(value, (int, long)): return long(value)
    if isinstance(value, (Long, Integer, Short, Byte)): return long(value.longValue())
    if isinstance(value, (float, Double, Float)):
        value = float(value)
        if math.isnan(value): return {"ieee": "NaN"}
        if math.isinf(value): return {"ieee": "+Infinity" if value > 0 else "-Infinity"}
        return value
    if isinstance(value, Number): return plain(value.doubleValue(), trail)
    if isinstance(value, dict): return dict((unicode(k), plain(v, trail)) for k, v in value.items())
    if isinstance(value, (list, tuple)): return [plain(v, trail) for v in value]
    cls = value.getClass()
    if str(cls.getName()) == "hec.heclib.util.HecTime":
        return {"class": str(cls.getName()), "defined": bool(value.isDefined()),
                "dateDefined": bool(value.isDateDefined()), "timeDefined": bool(value.isTimeDefined()),
                "granularity": int(value.getTimeGranularity()),
                "granularitySeconds": int(value.getTimeGranularityInSeconds()),
                "value": int(value.value()), "date": unicode(value.date(4)), "time": unicode(value.time())}
    if cls.isArray(): return [plain(v, trail) for v in value]
    if cls.getName().startswith("java.util.") and hasattr(value, "iterator"):
        return [plain(v, trail) for v in value]
    trail = set() if trail is None else set(trail)
    marker = System.identityHashCode(value)
    if marker in trail: raise ValueError("Cyclic native metadata: " + str(cls.getName()))
    trail.add(marker)
    result = {}
    for field in cls.getFields():
        if Modifier.isStatic(field.getModifiers()): continue
        result[str(field.getName())] = plain(field.get(value), trail)
    # HEC grid metadata is held in protected fields and exposed by getters.
    if str(cls.getName()).startswith("hec.heclib.grid."):
        for method in cls.getMethods():
            name = str(method.getName())
            if (name.startswith("get") or name.startswith("is")) and name != "getClass" and len(method.getParameterTypes()) == 0 and not Modifier.isStatic(method.getModifiers()):
                result[name] = plain(method.invoke(value, []), trail)
    if not result:
        raise ValueError("Native metadata needs an explicit reader: " + str(cls.getName()))
    return {"class": str(cls.getName()), "fields": result}

def container_payload(container):
    cls = str(container.getClass().getName())
    fields = {}
    for field in container.getClass().getFields():
        if not Modifier.isStatic(field.getModifiers()) and str(field.getName()) != "gridData":
            fields[str(field.getName())] = plain(field.get(container))
    if not fields and not hasattr(container, "getGridData"):
        raise ValueError("Native container needs an explicit complete reader: " + cls)
    value = {"class": cls, "fields": fields}
    # Compare DSS pathname through the exact typed catalogue correspondence.
    # File location is an operating attribute; all other exposed data remains.
    operating = {}
    for name in ("fileName", "fullName", "fileLastWriteTimeMillis", "lastWriteTimeMillis"):
        if name in fields: operating[name] = fields.pop(name)
    if hasattr(container, "getGridData"):
        grid = container.getGridData()
        fields["gridData"] = {"values": plain(grid.getData()), "info": plain(container.getGridInfo())}
    return cls, value, operating

def full_catalog(file):
    catalog = HecDssCatalog(file)
    try:
        values = [unicode(p) for p in catalog.getCatalog(True)]
        if len(values) != len(set(values)): raise ValueError("The original catalog contains duplicate paths.")
        return values
    finally:
        catalog.close()

def inventory_file(file, output_file):
    if not os.path.isfile(file): raise ValueError("The original DSS file is unavailable: " + file)
    db = HecDss.open(file, True)
    try:
        version = int(db.getDataManager().getDssFileVersion())
        catalog = full_catalog(file)
        records, datasets, seen = [], [], set()
        with open(output_file, "wb") as stream:
            for path in catalog:
                container = db.get(path)
                cls, value, operating = container_payload(container)
                is_ts = "TimeSeries" in cls
                record = {"path": path, "key": normalized_path(path, is_ts), "class": cls,
                          "isTimeSeries": is_ts, "payloadSha256": sha(value),
                          "recordType": int(db.getDataManager().recordType(path))}
                if hasattr(container, "numberValues"): record["numberValues"] = int(container.numberValues)
                records.append(record)
                dataset_key = record["key"]
                if is_ts:
                    parts = dataset_key.split("/")
                    parts[4] = ""
                    dataset_key = "/".join(parts)
                if dataset_key in seen: continue
                seen.add(dataset_key)
                if is_ts:
                    complete = db.get(path, True)
                    cls, value, operating = container_payload(complete)
                stream.write(raw_json({"path": path, "datasetKey": dataset_key, "container": value, "operating": operating}))
                datasets.append(dict(record, key=dataset_key, payloadSha256=sha(value)))
            stream.flush(); os.fsync(stream.fileno())
        sync_parent(output_file)
        return {"version": version, "records": records, "datasets": datasets, "catalogSha256": sha(catalog),
                "payload": dict(file_identity(output_file), file=os.path.basename(output_file))}
    finally:
        db.close()

def typed_match(original, converted):
    left, right = {}, {}
    for record in original["datasets"]:
        if record["key"] in left: raise ValueError("Two original paths map to the same DSS7 key: " + record["key"])
        left[record["key"]] = record
    for record in converted["datasets"]:
        if record["key"] in right: raise ValueError("Two converted paths map to the same DSS7 key: " + record["key"])
        right[record["key"]] = record
    missing, extra = sorted(set(left) - set(right)), sorted(set(right) - set(left))
    differences, matches = [], []
    for key in sorted(set(left) & set(right)):
        before, after = left[key], right[key]
        row = {"original": before["path"], "converted": after["path"], "class": before["class"],
               "originalType": before["recordType"], "convertedType": after["recordType"],
               "payloadSha256": before["payloadSha256"]}
        if before["class"] != after["class"] or before["payloadSha256"] != after["payloadSha256"]:
            differences.append(dict(row, convertedPayloadSha256=after["payloadSha256"]))
        else: matches.append(row)
    return {"equal": not missing and not extra and not differences, "missing": missing,
            "extra": extra, "differences": differences, "matches": matches,
            "originalRawRecords": len(original["records"]), "convertedRawRecords": len(converted["records"])}

def main(request_file, output_file, key):
    with open(request_file, "rb") as stream: binding = json.load(stream)
    action, request = binding["action"], binding["request"]
    version = int(Heclib.getLibraryVersion())
    if version > 70924:
        raise ValueError("Use HEC-DSSVue 3.4 or older / HEC-RTS 3.5 or older for DSS6 conversion; native library is " + str(version))
    work = os.path.dirname(output_file)
    base = {"status": "COMPLETE", "requestSha256": key, "libraryVersion": version,
            "javaVersion": str(System.getProperty("java.version")), "action": action}
    if action == "inventory":
        files = []
        for row in request["files"]:
            if file_identity(row["file"]) != {k: row[k] for k in ("bytes", "sha256")}:
                raise ValueError("The native input differs: " + row["path"])
            payload = os.path.join(work, hashlib.sha256(row["path"].encode("utf-8")).hexdigest() + "-records.ndjson")
            item = inventory_file(row["file"], payload)
            files.append(dict(item, path=row["path"], original={"bytes": row["bytes"], "sha256": row["sha256"]}))
        artifacts = [item["payload"] for item in files]
        return dict(base, files=files, artifacts=artifacts)
    if action != "convert-verify": raise ValueError("Unknown original native operation.")
    source, target = request["source"], request["target"]
    if file_identity(source) != request["original"]: raise ValueError("The original source file changed.")
    read_source = os.path.join(work, "source.dss")
    if not os.path.exists(read_source):
        pending_source = read_source + ".copying"
        shutil.copyfile(source, pending_source); sync_file(pending_source)
        Files.move(Paths.get(pending_source), Paths.get(read_source), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
        sync_file(read_source)
    if file_identity(read_source) != request["original"]: raise ValueError("The native source copy differs.")
    original = inventory_file(read_source, os.path.join(work, "original-records.ndjson"))
    if original["version"] not in (6, 7): raise ValueError("Unsupported or unreadable original DSS version.")
    if original["version"] == 6 and file_identity(target) == request["original"]:
        pending = os.path.join(work, "converted.dss")
        if os.path.exists(pending):
            os.rename(pending, pending + ".interrupted-" + str(System.currentTimeMillis()))
        util = HecDSSUtilities()
        try:
            util.setDSSFileName(read_source)
            status = int(util.convertVersion(pending))
        finally:
            util.close()
        if status != 0: raise ValueError("Official HEC conversion returned status " + str(status))
        # Validate before replacing the retained staging member.
        converted = inventory_file(pending, os.path.join(work, "converted-records.ndjson"))
        comparison = typed_match(original, converted)
        write_json(os.path.join(work, "comparison.json"), comparison)
        if converted["version"] != 7 or not comparison["equal"]:
            raise ValueError("The converted native records differ; inspect complete comparison.json and both full record files.")
        sync_file(pending)
        Files.move(Paths.get(pending), Paths.get(target), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
        sync_file(target)
    else:
        converted = inventory_file(target, os.path.join(work, "converted-records.ndjson"))
        comparison = typed_match(original, converted)
        write_json(os.path.join(work, "comparison.json"), comparison)
        if converted["version"] != 7 or not comparison["equal"]:
            raise ValueError("The retained target differs from the complete original records.")
    # Close/reopen comparison already occurred through inventory_file.
    if file_identity(source) != request["original"]: raise ValueError("The retained original changed.")
    artifacts = [original["payload"], converted["payload"], dict(file_identity(os.path.join(work, "comparison.json")), file="comparison.json")]
    return dict(base, artifacts=artifacts, path=request["path"], planSha256=request["planSha256"], original=original,
                converted=converted, comparison=comparison, output=file_identity(target))

if __name__ == "__main__":
    output_file = sys.argv[-2]
    key = sys.argv[-1]
    try:
        result = main(sys.argv[-3], output_file, key)
        write_json(output_file, result)
    except BaseException as error:
        traceback.print_exc()
        write_json(output_file, {"status": "FAILED", "requestSha256": key, "error": unicode(error)})
        raise
