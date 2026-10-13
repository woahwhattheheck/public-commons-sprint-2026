"""Original delivery files and relative HTML companions through verified tickets.

This is an operator read adapter. Native delivery, report rendering, packaging,
and source inspection continue in their original maintained modules.
"""
from __future__ import annotations

from collections import OrderedDict
import base64
from html import escape as html_escape
from html.parser import HTMLParser
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import stat
from urllib.parse import quote

from model.common import atomic_bytes, identifier
from model.delivery_catalogue import delivery_view
from model.delivery_review_version import REPORT_EDITION
from delivery_preview import HTML_LIMIT, embed_images, image_policy

SCHEMA = "upstate.delivery-inspection/v1"
PREVIEW_POLICY = (
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; "
    "img-src 'self' data: blob:; frame-src 'self' blob:; connect-src 'none'; "
    "object-src 'none'; base-uri 'none'; form-action 'none'; "
    "sandbox allow-scripts allow-downloads allow-modals allow-popups"
)


LINK_BRIDGE = r"""
<script>
(function () {
  document.addEventListener("click", function (event) {
    const anchor = event.target.closest && event.target.closest("a[href]");
    if (!anchor) return;
    let url;
    try { url = new URL(anchor.getAttribute("href"), location.href); } catch (_) { return; }
    if (url.protocol === "blob:" || url.protocol === "data:") return;
    if (url.origin !== location.origin) {
      if (url.protocol === "https:" || url.protocol === "http:") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (parent !== window) parent.postMessage({
          type: "upstate.delivery-external/v1", url: url.href,
          label: anchor.textContent || url.hostname
        }, "*");
      }
      return;
    }
    if (url.pathname === location.pathname && url.search === location.search && url.hash) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (parent === window) return;
    parent.postMessage({
      type: "upstate.delivery-member/v1", url: url.href,
      download: anchor.hasAttribute("download") || url.searchParams.get("download") === "1"
    }, "*");
  }, true);
})();
</script>
"""

LINK_BRIDGE_SCRIPT = LINK_BRIDGE.split("<script>", 1)[1].rsplit("</script>", 1)[0]


def _bridge_policy(policy):
    """Admit only this preview bridge under an existing document policy."""
    parts = [part.strip().split() for part in policy.split(";") if part.strip()]
    effective = None
    for name in ("script-src-elem", "script-src", "default-src"):
        effective = next((part for part in parts if part[0].lower() == name), None)
        if effective is not None:
            break
    if effective is None:
        return policy
    sources = effective[1:]
    # Adding a hash to an otherwise unrestricted inline policy would disable
    # its existing inline scripts. Such a policy already admits this bridge.
    has_signature = any(value.startswith(("'nonce-", "'sha256-", "'sha384-", "'sha512-"))
                        for value in sources)
    if "'unsafe-inline'" in sources and not has_signature:
        return policy
    digest = base64.b64encode(hashlib.sha256(LINK_BRIDGE_SCRIPT.encode("utf-8")).digest()).decode("ascii")
    bridge = "'sha256-" + digest + "'"
    if bridge in sources:
        return policy
    amended = [value for value in sources if value != "'none'"] + [bridge]
    if effective[0].lower() == "default-src":
        # Leave the original fallback for every non-script resource intact.
        parts.append(["script-src", *amended])
    else:
        effective[:] = [effective[0], *amended]
    return "; ".join(" ".join(part) for part in parts)


class _PreviewPolicies(HTMLParser):
    """Locate actual policy elements, without rewriting report/script bodies."""

    def __init__(self, source, *, images=False):
        super().__init__(convert_charrefs=False)
        self.images = images
        self.edits = []
        self.offsets = [0]
        for line in source.split("\n"):
            self.offsets.append(self.offsets[-1] + len(line) + 1)

    def handle_starttag(self, tag, attrs):
        if tag.lower() != "meta":
            return
        first = {}
        for key, value in attrs:
            first.setdefault(key.lower(), value)
        if str(first.get("http-equiv") or "").lower() != "content-security-policy":
            return
        policy = first.get("content")
        if policy is None:
            return
        replacement = _bridge_policy(image_policy(policy) if self.images else policy)
        if replacement == policy:
            return
        amended = []
        replaced = False
        for key, value in attrs:
            if key.lower() == "content" and not replaced:
                value = replacement
                replaced = True
            amended.append(" " + key if value is None else
                           " " + key + '="' + html_escape(value, quote=True) + '"')
        raw = self.get_starttag_text()
        line, column = self.getpos()
        start = self.offsets[line - 1] + column
        self.edits.append((start, start + len(raw), "<meta" + "".join(amended) + ">"))

    handle_startendtag = handle_starttag


def _preview_html(source, *, images=False):
    parser = _PreviewPolicies(source, images=images)
    parser.feed(source)
    parser.close()
    for start, end, replacement in reversed(parser.edits):
        source = source[:start] + replacement + source[end:]
    marker = source.lower().rfind("</body>")
    return source[:marker] + LINK_BRIDGE + source[marker:] if marker >= 0 else source + LINK_BRIDGE

def _member(value):
    if (not isinstance(value, str) or not value or value.startswith("/")
            or "\\" in value or re.search(r"[\x00-\x1f\x7f]", value)
            or any(part in {"", ".", ".."} or ":" in part for part in value.split("/"))):
        raise ValueError("Choose a canonical relative path from this delivery's retained files.")
    return PurePosixPath(value)


def _signature(value):
    return (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns)


def _snapshot(operator, workspace_key, delivery_id):
    ws = operator.ws(workspace_key)
    key = identifier(delivery_id)
    workspace_root = Path(ws.root).resolve(strict=True)
    root = (workspace_root / "deliveries" / key).resolve(strict=True)
    if not root.is_relative_to(workspace_root):
        raise ValueError("The retained delivery leaves its original workspace.")
    path = (root / "delivery-state.json").resolve(strict=True)
    if not path.is_relative_to(root):
        raise ValueError("The retained delivery record leaves its original directory.")
    signature = _signature(path.stat())
    cache_key = (workspace_key, key, str(root))
    with operator.lock:
        cache = getattr(operator, "_delivery_inspection_cache", None)
        if cache is None:
            cache = OrderedDict()
            operator._delivery_inspection_cache = cache
        cached = cache.get(cache_key)
        if cached is not None and cached["signature"] == signature:
            cache.move_to_end(cache_key)
            return root, cached
    with path.open("rb") as stream:
        before = stream.fileno()
        import os
        first = os.fstat(before)
        if not stat.S_ISREG(first.st_mode):
            raise ValueError("The original delivery record must be a regular file.")
        body = stream.read()
        after = os.fstat(before)
    if _signature(first) != _signature(after) or len(body) != first.st_size:
        raise ValueError("The delivery record changed during inspection; reopen its current state.")
    record = json.loads(body)
    if record.get("schema") != "upstate.delivery/v1" or record.get("id") != key:
        raise ValueError("The retained delivery record has another original identity.")
    inventory = {}
    for section in ("files", "maps"):
        for name, item in (record.get(section) or {}).items():
            if not isinstance(item, dict) or not {"path", "bytes", "sha256"} <= item.keys():
                raise ValueError("A retained delivery file has no complete original descriptor.")
            member = str(_member(item["path"]))
            if (not isinstance(item["bytes"], int) or isinstance(item["bytes"], bool)
                    or item["bytes"] < 0 or not re.fullmatch(r"[0-9a-f]{64}", str(item["sha256"]))):
                raise ValueError("A retained delivery file has an invalid size or SHA-256.")
            previous = inventory.get(member)
            if previous is not None:
                if any(previous[field] != item[field] for field in ("bytes", "sha256")):
                    raise ValueError("The original delivery repeats a file with conflicting descriptors.")
                previous["keys"].append(section + "." + name)
            else:
                inventory[member] = {
                    "path": member, "bytes": item["bytes"], "sha256": item["sha256"],
                    "keys": [section + "." + name],
                    "title": item.get("title") or item.get("label") or name.replace("_", " "),
                }
    original = {"path": "delivery-state.json", "bytes": len(body),
                "sha256": hashlib.sha256(body).hexdigest(),
                "keys": ["original_record"], "title": "Complete original delivery record"}
    if original["path"] in inventory:
        raise ValueError("A delivery output collides with its original retained record.")
    inventory[original["path"]] = original
    saved = {"signature": _signature(first), "record": record, "inventory": inventory,
             "view": delivery_view(record)}
    with operator.lock:
        cache[cache_key] = saved
        cache.move_to_end(cache_key)
        while len(cache) > 4:
            cache.popitem(last=False)
    return root, saved


def _url(workspace_key, delivery_id, member):
    return "/api/file/delivery-view/" + quote(workspace_key, safe="") + "/" + delivery_id + "/" + quote(member, safe="/")


def _links(record):
    selection = record.get("selection") or {}
    attached = record.get("source_scenario_analysis") or {}
    water = (record.get("receiving_waters") or {}).get("identity") or {}
    plans = set(attached.get("source_plan_ids") or [])
    for value in (water.get("plan_id"), (selection.get("receiving_waters") or {}).get("plan_id")):
        if value:
            plans.add(value)
    collections = set()
    for area in attached.get("areas") or []:
        choice = area.get("selection") or {}
        if choice.get("source_collection_id"):
            collections.add(choice["source_collection_id"])
    for section in ("source_roles", "overlays"):
        for choice in (selection.get(section) or {}).values():
            if isinstance(choice, dict) and choice.get("source_collection_id"):
                collections.add(choice["source_collection_id"])
    native = [selection.get("baseline_run_id")] + list(selection.get("scenario_run_ids") or [])
    return {
        "analysis_id": attached.get("analysis_id") or selection.get("source_scenario_analysis_id"),
        "analysis_sha256": attached.get("analysis_sha256") or selection.get("source_scenario_analysis_sha256"),
        "analysis_title": attached.get("analysis_title"),
        "watershed_report_id": selection.get("source_report_id"),
        "economic_edition_id": selection.get("economic_edition_id"),
        "receiving_water_analysis_id": water.get("analysis_id") or (selection.get("receiving_waters") or {}).get("analysis_id"),
        "source_plan_ids": sorted(plans),
        "source_collection_ids": sorted(collections),
        "native_run_ids": list(dict.fromkeys(value for value in native if value)),
        "grid_id": attached.get("grid_id"),
        "profile_id": attached.get("profile_id"),
        "source_area_count": len(attached.get("areas") or []),
        "quantity_scope": (record.get("receiving_waters") or {}).get("quantity_scope"),
    }


def _detail(record, view):
    """Small original fields needed by the existing delivery detail."""
    return {
        "schema": record["schema"], "id": record["id"], "state": record.get("state"),
        "selection": {"title": (record.get("selection") or {}).get("title")},
        "map_count": len(record.get("maps") or {}),
        "package": {"auditStatus": (record.get("package") or {}).get("auditStatus")},
        "error": record.get("error"), "priority": record.get("priority"),
        "_downloads": [], "_delivery_view": view, "_current_report_edition": REPORT_EDITION,
    }


def read(operator, workspace_key, operation, payload):
    if operation != "inspect":
        raise ValueError("Choose the original delivery inspection.")
    key = identifier(payload.get("delivery_id") or payload.get("id"))
    root, saved = _snapshot(operator, workspace_key, key)
    record, inventory = saved["record"], saved["inventory"]
    files = [{**item, "url": _url(workspace_key, key, item["path"]),
              "preview_url": _url(workspace_key, key, item["path"]).replace("/delivery-view/", "/delivery-preview/", 1)}
             for item in inventory.values()]
    return {
        "schema": SCHEMA, "workspace_key": workspace_key, "delivery_id": key,
        "state": record.get("state"), "title": record.get("selection", {}).get("title"),
        "detail": _detail(record, saved["view"]),
        "files": files, "file_count": len(files), "total_bytes": sum(row["bytes"] for row in files),
        "links": _links(record), "preview_policy": "opaque_sandbox_with_declared_member_links",
        "support": "Each file is an original declared delivery member. Source areas remain independent; native receiving-water family totals use their retained union.",
    }


def preview(operator, workspace_key, delivery_id, member_path):
    root, saved = _snapshot(operator, workspace_key, delivery_id)
    member = str(_member(member_path))
    descriptor = saved["inventory"].get(member)
    if descriptor is None:
        raise ValueError("This path is not a declared file in the original delivery.")
    path = (root / member).resolve(strict=True)
    if not path.is_relative_to(root) or not path.is_file():
        raise ValueError("The selected original file leaves its retained delivery.")
    ticket = operator._ticket(workspace_key, path, descriptor, descriptor["title"])
    policy = PREVIEW_POLICY if path.suffix.lower() in {".html", ".htm"} else None
    return ticket, policy


def linked_preview(operator, workspace_key, delivery_id, member_path):
    """Derive an isolated preview; byte-exact originals keep their own file route."""
    ticket, policy = preview(operator, workspace_key, delivery_id, member_path)
    if policy is None:
        return ticket, policy
    def read_original(selected, limit):
        if selected["bytes"] > limit:
            raise ValueError("This original file exceeds inline preview capacity. Download the complete delivery.")
        stream, metadata = operator.open_download(selected["id"])
        try:
            body = stream.read(limit + 1)
        finally:
            stream.close()
        if len(body) != metadata["bytes"] or len(body) > limit:
            raise ValueError("The original delivery file changed during preview")
        return body

    source = read_original(ticket, HTML_LIMIT).decode("utf-8-sig")
    _, saved = _snapshot(operator, workspace_key, delivery_id)

    def image_bytes(member, limit):
        image_ticket, _ = preview(operator, workspace_key, delivery_id, member)
        return read_original(image_ticket, limit)

    source, images = embed_images(source, member_path, saved["inventory"], image_bytes)
    rendered = _preview_html(source, images=images)
    body = rendered.encode("utf-8")
    sha = hashlib.sha256(body).hexdigest()
    directory = Path(operator.root) / "previews" / "delivery-html"
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / (sha + ".html")
    if not target.exists():
        atomic_bytes(target, body, immutable=True)
    descriptor = {"bytes": len(body), "sha256": sha, "filename": PurePosixPath(member_path).name}
    return operator._ticket(workspace_key, target, descriptor,
                            "Linked preview of " + ticket.get("label", member_path)), policy
