"""Verified opaque previews for retained Published studies reports.

The application parent opens/downloads only the exact inventoried link targets.
Original scripts never receive the operator origin or its authenticated cookie.
"""
from __future__ import annotations

import hashlib
from html import escape
from html.parser import HTMLParser
import json
from pathlib import Path, PurePosixPath
import posixpath
import re
from urllib.parse import quote, unquote, urlsplit

from delivery_preview import HTML_LIMIT, embed_images
from model.common import describe_file, identifier

VERSION = 1
FOLDER = "published-study-reports"
POLICY = ("sandbox allow-scripts allow-downloads allow-modals allow-popups "
          "allow-popups-to-escape-sandbox; default-src 'none'; "
          "script-src 'unsafe-inline'; style-src 'unsafe-inline'; "
          "img-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; "
          "form-action 'none'; frame-ancestors 'self'")


def _local(value, member):
    parsed = urlsplit(value)
    if parsed.scheme or parsed.netloc or not parsed.path:
        return None
    path = unquote(parsed.path)
    if (path.startswith("/") or "\\" in path or ":" in path or
            any(ord(c) < 32 or ord(c) == 127 for c in path)):
        raise ValueError("Original report companions must use contained relative paths")
    path = posixpath.normpath(posixpath.join(posixpath.dirname(member), path))
    if path in {".", ".."} or path.startswith("../"):
        raise ValueError("An original report link leaves its retained study")
    return path


class _Companions(HTMLParser):
    def __init__(self, source, member, inventory, read_member):
        super().__init__(convert_charrefs=False)
        self.member, self.inventory, self.read_member = member, inventory, read_member
        self.edits, self.links = [], []
        self.offsets = [0]
        for line in source.split("\n"):
            self.offsets.append(self.offsets[-1] + len(line) + 1)

    def _edit(self, replacement):
        line, column = self.getpos()
        start = self.offsets[line - 1] + column
        self.edits.append((start, start + len(self.get_starttag_text()), replacement))

    def _tag(self, tag, attrs):
        return "<" + tag + "".join(" " + k if v is None else
                                   " " + k + '="' + escape(v, quote=True) + '"'
                                   for k, v in attrs) + ">"

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        first = {}
        for key, value in attrs:
            first.setdefault(key.lower(), value)
        if tag == "base":
            self._edit("")
            return
        if tag == "a" and first.get("href"):
            member = _local(first["href"], self.member)
            if member is None:
                return
            if member not in self.inventory:
                raise ValueError("Original report companion is not retained: " + member)
            parsed = urlsplit(first["href"])
            link_id = str(len(self.links))
            self.links.append({
                "id": link_id, "path": member, "fragment": parsed.fragment,
                "query": parsed.query, "download": "download" in first,
                "html": PurePosixPath(member).suffix.lower() in {".html", ".htm"},
            })
            amended = [(k, v) for k, v in attrs
                       if k.lower() not in {"href", "target", "data-published-member"}]
            amended.extend([("href", "#"), ("data-published-member", link_id)])
            self._edit(self._tag(tag, amended))
        elif tag == "link" and "stylesheet" in (first.get("rel") or "").lower().split():
            if _local(first.get("href") or "", self.member) is not None:
                raise ValueError("This original report needs its separate stylesheet; open the complete study export")
        elif tag == "script" and first.get("src"):
            if _local(first["src"], self.member) is not None:
                raise ValueError("This original report needs separate script files; open the complete study export")

    handle_startendtag = handle_starttag


def _bridge(token):
    # Parent validates the frame Window, this immutable token, and the exact
    # per-preview link inventory. Messages cannot request arbitrary URLs.
    return """<script>
(function(){
  'use strict';
  const token=TOKEN;
  function ready(){parent.postMessage({type:'upstate.published-report.ready/v1',token:token},'*');}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready,{once:true});
  else ready();
  document.addEventListener('click',function(event){
    const a=event.target.closest&&event.target.closest('a[data-published-member]');
    if(!a)return;
    event.preventDefault();event.stopImmediatePropagation();
    parent.postMessage({type:'upstate.published-report.member/v1',token:token,id:a.dataset.publishedMember},'*');
  },true);
  window.addEventListener('message',function(event){
    if(event.source!==parent||!event.data||event.data.token!==token)return;
    if(event.data.type==='upstate.published-report.print/v1')window.print();
  });
})();
</script>""".replace("TOKEN", json.dumps(token))


def prepare(operator, workspace_key, workspace, store, study_id, version_id, member):
    if not isinstance(version_id, str) or not version_id:
        raise ValueError("Choose the exact retained study edition")
    record = store._record(study_id, version_id)
    if record["study_id"] != study_id or record["version_id"] != version_id:
        raise ValueError("The selected retained study edition changed")
    if not isinstance(member, str) or member not in record["source_entries"]:
        raise ValueError("Choose a registered original report member")
    if PurePosixPath(member).suffix.lower() not in {".html", ".htm"}:
        raise ValueError("Choose an original HTML report")
    inventory = {entry["path"]: entry for entry in record["source_files"]}
    if len(inventory) != len(record["source_files"]):
        raise ValueError("The retained source inventory contains duplicate paths")
    paths = {}

    def original(name, limit):
        descriptor = inventory.get(name)
        if descriptor is None or name not in record["source_entries"]:
            raise ValueError("Original report member is not registered: " + name)
        if type(descriptor.get("bytes")) is not int or not 0 <= descriptor["bytes"] <= limit:
            raise ValueError("Original report member exceeds preview capacity: " + name)
        path, _ = store.source_file(study_id, name, version_id)
        with path.open("rb") as stream:
            raw = stream.read(limit + 1)
        if len(raw) != descriptor["bytes"] or hashlib.sha256(raw).hexdigest() != descriptor["sha256"]:
            raise ValueError("Original report member changed: " + name)
        paths[name] = path
        return raw

    raw = original(member, HTML_LIMIT)
    source, images = embed_images(raw.decode("utf-8-sig"), member, inventory, original)
    parser = _Companions(source, member, inventory, original)
    parser.feed(source)
    parser.close()
    for start, end, replacement in reversed(parser.edits):
        source = source[:start] + replacement + source[end:]
    identity = {
        "schema": "upstate.published-report-preview/v1", "version": VERSION,
        "project_id": workspace.project["id"], "workspace": workspace_key,
        "study_id": study_id, "version_id": version_id,
        "source_collection_id": record["source_collection_id"], "member": member,
        "source": inventory[member], "links": [
            {**row, "source": inventory[row["path"]]} for row in parser.links],
        "assets": {name: inventory[name] for name in sorted(set(paths) - {member})},
        "implementation_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    }
    token = hashlib.sha256(json.dumps(identity, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    bridge = _bridge(token)
    match = re.search(r"<head\b[^>]*>", source, flags=re.I)
    if match:
        source = source[:match.end()] + bridge + source[match.end():]
    else:
        match = re.match(r"\s*<!doctype[^>]*>", source, flags=re.I)
        position = match.end() if match else 0
        source = source[:position] + bridge + source[position:]
    body = source.encode("utf-8")
    digest = hashlib.sha256(body).hexdigest()
    directory = operator.root / "previews" / FOLDER
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / (digest + ".html")
    if target.exists():
        if target.read_bytes() != body:
            raise ValueError("Retained original-report preview differs")
    else:
        import os
        import tempfile
        with tempfile.NamedTemporaryFile(dir=directory, delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(body)
        try:
            os.replace(temporary, target)
        finally:
            temporary.unlink(missing_ok=True)
    description = {"path": target.relative_to(operator.root).as_posix(),
                   "bytes": len(body), "sha256": digest,
                   "filename": "original-study-report-preview.html"}
    ticket = operator._ticket(workspace_key, target, description, "original-study-report-preview.html")

    def download(name):
        # source_file verifies the unchanged source body's CAS before the ticket.
        path = paths.get(name)
        if path is None:
            path, _ = store.source_file(study_id, name, version_id)
        description = describe_file(workspace.root, path)
        if any(description[key] != inventory[name][key] for key in ("bytes", "sha256")):
            raise ValueError("Original report download differs from its retained inventory: " + name)
        description["filename"] = PurePosixPath(name).name
        return operator._ticket(workspace_key, path, description, PurePosixPath(name).name)

    links = [{**row, "source": inventory[row["path"]], "download_ticket": download(row["path"])}
             for row in parser.links]
    return {
        "schema": "upstate.published-report-preview/v1", "id": token,
        "workspace": workspace_key, "study_id": study_id, "version_id": version_id,
        "source_collection_id": record["source_collection_id"], "member": member,
        "source": inventory[member], "title": PurePosixPath(member).name,
        "preview": {**ticket, "url": "/api/file/published-study-preview/" + quote(workspace_key, safe="") + "/" + ticket["id"]},
        "download": download(member), "links": links, "embedded_images": images,
    }


def file_reply(operator, workspace_key, ticket_id):
    operator.ws(workspace_key)
    ticket_id = identifier(ticket_id)
    with operator.lock:
        original = operator.downloads.get(ticket_id)
        ticket = dict(original) if original else None
    if ticket is None or ticket.get("workspace") != workspace_key:
        raise ValueError("Choose the original report preview in its Workspace")
    path = Path(ticket["path"]).resolve(strict=True)
    parent = (operator.root / "previews" / FOLDER).resolve(strict=True)
    if (path.parent != parent or path.suffix != ".html" or
            ticket.get("filename") != "original-study-report-preview.html"):
        raise ValueError("This ticket is not an original-report preview")
    identifier(path.stem)
    return {key: value for key, value in ticket.items() if key != "path"}, POLICY
