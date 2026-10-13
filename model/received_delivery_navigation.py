"""Navigation for the verified original delivery received from a working archive."""
from __future__ import annotations

from pathlib import Path
import re

from . import atlas_browser
from .common import atomic_bytes, atomic_json, describe_file

EDITION = "upstate.received-delivery-navigation/v1"


def _retain_role(files, role):
    """Keep a previously captured derivative under its own immutable identity."""
    item = files.pop(role, None)
    if item is not None:
        key = "captured_" + role + "_" + item["sha256"]
        previous = files.get(key)
        if previous is not None and previous != item:
            raise ValueError("Received navigation has conflicting captured descriptors")
        files[key] = item


def build(directory, record, working_archive):
    """Add a navigator after extraction has verified the captured member bytes.

    This runs in the receiving directory before final publication. The archive
    remains the original opened edition; no captured HTML, report or descriptor
    is overwritten. A new navigator lists the actual received files and links
    the retained enclosing archive without introducing recursive archive content.
    """
    if not isinstance(record.get("atlas"), dict) or "report" not in record.get("files", {}):
        return record
    sha = working_archive.get("sha256")
    if not isinstance(sha, str) or not re.fullmatch(r"[0-9a-f]{64}", sha):
        raise ValueError("Received navigation requires the original archive SHA256")
    directory = Path(directory).resolve(strict=True)
    files = {name: dict(item) for name, item in record["files"].items()}
    _retain_role(files, "map_atlas_received_browser")
    _retain_role(files, "received_delivery_inventory")
    source_files = {name: dict(item) for name, item in files.items()}
    root = "received-navigation-" + sha
    inventory_path = root + "/inventory.json"
    browser_path = root + "/atlas-browser.html"
    claimed_paths = {item["path"] for item in files.values()}
    if inventory_path in claimed_paths or browser_path in claimed_paths:
        raise ValueError("Received navigation path collides with an original captured member")
    maps = {name: item["path"] for name, item in record.get("maps", {}).items()}
    map_paths = set(maps.values())
    report_path = files["report"]["path"]
    navigation = {
        "schema": EDITION, "delivery_id": record["id"],
        "source_archive": dict(working_archive),
        "selection": record["selection"],
        "source_snapshot": record.get("received_snapshot", {}),
        "files": source_files,
        "maps": maps, "rasters": {}, "report_pdf": report_path,
        "project_assets": sorted({
            item["path"] for item in files.values()
            if item["path"] != report_path and item["path"] not in map_paths
        }),
        "scope": (
            "Verified files restored from the original scientific workspace archive "
            "and that same enclosing archive. This navigation is composed after receiving."
        ),
    }
    # The inventory describes its original inputs. Its own descriptor is added
    # only after its complete bytes exist; the HTML then includes that real file.
    target = directory / inventory_path
    atomic_json(target, navigation, immutable=True)
    files["received_delivery_inventory"] = describe_file(
        directory, target, title="Received original delivery inventory")
    view_manifest = {**navigation,
                     "project_assets": [*navigation["project_assets"], inventory_path]}
    received = {**record, "files": files}
    body = atlas_browser.render(received, view_manifest,
                                browser_path=browser_path,
                                manifest_path=inventory_path)
    target = directory / browser_path
    atomic_bytes(target, body.encode("utf-8"), immutable=True)
    files["map_atlas_received_browser"] = describe_file(
        directory, target, title="Received scientific map atlas")
    received["received_navigation"] = {
        "schema": EDITION, "source_archive_sha256": sha,
        "inventory_role": "received_delivery_inventory",
        "browser_role": "map_atlas_received_browser",
    }
    return received
