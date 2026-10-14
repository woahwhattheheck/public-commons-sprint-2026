"""Retain original scenario footprints with the selected native Study.

TokenJunkieLabs. The complete existing record and native preview directory stay
inside the original Study archive and its unchanged portable receiving route.
"""
from __future__ import annotations

from .common import digest, read_json
from .scenario_footprint import RECORD_KIND, OUTPUT_ROOT, get_footprint


def include_run(closure, run_id, run):
    for path in sorted((closure.root / RECORD_KIND).glob("*.json")):
        value = read_json(path)
        if not isinstance(value, dict) or value.get("run_id") != run_id:
            continue
        relative = path.relative_to(closure.root).as_posix()
        value = closure.read(relative)
        original = get_footprint(closure.workspace, path.stem, verify=True)
        if {key: item for key, item in original.items() if key != "id"} != value:
            raise ValueError("The selected original footprint record changed")
        request = value.get("request", {})
        if (value.get("selection") != run["selection"]
                or request.get("selection") != run["selection"]
                or request.get("run_id") != run_id):
            raise ValueError("The retained footprint belongs to another native selection")
        prefix = OUTPUT_ROOT + "/" + digest(request)
        complete = closure.read(prefix + "/complete.json")
        if complete.get("request") != request:
            raise ValueError("The retained footprint output has a different original request")
        files = value.get("files")
        if not isinstance(files, dict) or set(files) != set(complete.get("files", {})):
            raise ValueError("Retain every original footprint output descriptor")
        for name, descriptor in files.items():
            native = complete["files"][name]
            if (not isinstance(native, dict) or native.get("path", "").startswith("/")
                    or descriptor != {**native, "path": prefix + "/" + native.get("path", "")}):
                raise ValueError("The footprint output descriptor changed: " + name)
        report = closure.read(prefix + "/footprint.json")
        if (report.get("request") != request or report.get("run_id") != run_id
                or report.get("selection") != run["selection"]):
            raise ValueError("The complete footprint report changed its original selection")
        for name, retained in value.items():
            if name not in {"schema", "files", "guides"} and report.get(name) != retained:
                raise ValueError("The complete footprint report differs from its saved " + name)
        closure.tree(prefix)
        closure._descriptors(files)
        closure._source_refs(value, "Original retained scenario footprint sources")
