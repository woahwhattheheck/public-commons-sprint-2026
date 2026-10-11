#!/usr/bin/env python3
"""Capture public CSKT source into a new, resumable, hash-indexed directory.

Python 3.10+, standard library only. No destination writes or credential inputs.
Raw provider bodies are retained beside corpus.json; use a new --output for a
new source revision. --resume continues the same capture after interruption.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import html
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

SITE = "https://csktwatercompact.com/"
RFP = SITE + "wp-content/uploads/2026/10/DEWR_Website_RFP_Final.pdf"
STORIES = {
    "2255c33442fd4f349aef25cba515ed78": [46],
    "d8850066568c4e75a655b6a2381184a1": [1995],
    "b26fd439e9354905af0704cc95caf484": [729],
}
ITEM_ID = re.compile(r"^[0-9a-f]{32}$")


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".part")
    with temporary.open("wb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


def write_json(path, value):
    write(path, (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode())


class LinkReader(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.links = []
        self.words = []
        self.hidden = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self.hidden += 1
        for attribute, value in attrs:
            if value and attribute in ("href", "src", "data-src", "data-opt-src"):
                self.links.append({"tag": tag, "attribute": attribute, "value": value})

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self.hidden = max(0, self.hidden - 1)

    def handle_data(self, value):
        if not self.hidden:
            self.words.append(value)


class Capture:
    def __init__(self, output, site, resume, max_bytes):
        self.output = Path(output).resolve()
        self.site = site.rstrip("/") + "/"
        self.hostname = urllib.parse.urlsplit(self.site).hostname
        self.max_bytes = max_bytes
        self.output.mkdir(parents=True, exist_ok=True)
        index = self.output / "source-index.json"
        if index.exists() and not resume:
            raise ValueError("Use a new output directory for a new source revision, or --resume for this capture")
        self.index = json.loads(index.read_text()) if index.exists() else {
            "schema": "cskt.source-capture.v1", "startedAt": now(), "sources": []
        }

    def allowed(self, url):
        parsed = urllib.parse.urlsplit(url)
        hostname = (parsed.hostname or "").lower()
        if parsed.scheme != "https" or parsed.username or parsed.password or parsed.port not in (None, 443):
            raise ValueError("Only public HTTPS source URLs are accepted")
        if not (hostname == self.hostname or hostname == "arcgis.com" or hostname.endswith(".arcgis.com")):
            raise ValueError("Source URL is outside the selected WordPress site and ArcGIS")
        if any(key.lower() in ("token", "access_token", "api_key", "key")
               for key, _ in urllib.parse.parse_qsl(parsed.query)):
            raise ValueError("Credential-bearing source URLs are not accepted")

    def fetch(self, name, url, **context):
        self.allowed(url)
        path = self.output / name
        if path.resolve().parent != self.output and self.output not in path.resolve().parents:
            raise ValueError("Capture file escapes output directory")
        prior = next((row for row in self.index["sources"] if row["file"] == name), None)
        if prior and prior.get("url") == url and path.is_file():
            if digest(path.read_bytes()) == prior.get("sha256"):
                return prior
            raise ValueError("Retained source bytes changed: " + name)
        row = {"url": url, "file": name, "capturedAt": now(), **context}
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "Commons-CSKT-source-capture/1.0"})
            try:
                response = urllib.request.urlopen(request, timeout=25)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                self.allowed(response.url)
                data = response.read(self.max_bytes + 1)
                if len(data) > self.max_bytes:
                    raise ValueError("Source exceeds configured per-file capture ceiling")
                write(path, data)
                row.update(status=response.status, finalUrl=response.url,
                           contentType=response.headers.get("Content-Type"), bytes=len(data), sha256=digest(data),
                           total=response.headers.get("X-WP-Total"), pages=response.headers.get("X-WP-TotalPages"))
                try:
                    value = json.loads(data)
                    if isinstance(value, dict) and "error" in value:
                        row["providerError"] = value["error"]
                    if isinstance(value, list):
                        row["records"] = len(value)
                except (ValueError, UnicodeError):
                    pass
        except Exception as error:
            row["error"] = type(error).__name__ + ": " + str(error)
        self.index["sources"] = [old for old in self.index["sources"] if old["file"] != name] + [row]
        write_json(self.output / "source-index.json", self.index)
        print(json.dumps({key: row[key] for key in ("file", "status", "bytes", "records", "error", "providerError") if key in row}), flush=True)
        return row

    def json(self, record):
        if record.get("status") != 200 or record.get("error"):
            raise ValueError("Source capture failed: " + record["file"])
        return json.loads((self.output / record["file"]).read_bytes())

    def collection(self, kind):
        endpoint = self.site + "wp-json/wp/v2/" + kind
        first = self.fetch("wp-" + kind + "-1.json", endpoint + "?per_page=100", collection=kind, page=1)
        first_value = self.json(first)
        if not isinstance(first_value, list):
            raise ValueError("WordPress collection did not return an array: " + kind)
        declared_pages = int(first.get("pages") or 1)
        records = list(first_value)
        for page in range(2, declared_pages + 1):
            result = self.json(self.fetch(f"wp-{kind}-{page}.json", endpoint + f"?per_page=100&page={page}", collection=kind, page=page))
            if not isinstance(result, list):
                raise ValueError("WordPress collection did not return an array")
            records.extend(result)
        identities = [row["id"] for row in records]
        if len(set(identities)) != len(identities):
            raise ValueError("Duplicate source IDs across collection pages; capture a fresh source revision")
        reported = int(first.get("total") or len(records))
        status = {"observed": len(records), "reported": reported, "pagesCaptured": max(1, declared_pages), "uniqueIds": len(identities)}
        if reported != len(records):
            alternate_ids = set()
            for page in range(1, max(1, declared_pages) + 1):
                query = urllib.parse.urlencode({"per_page": 100, "page": page, "orderby": "id", "order": "asc", "_fields": "id"})
                values = self.json(self.fetch(f"wp-{kind}-ids-{page}.json", endpoint + "?" + query, collection=kind, reconciliation=True))
                if not isinstance(values, list):
                    raise ValueError("ID reconciliation did not return an array")
                alternate_ids.update(row["id"] for row in values)
            additional = sorted(alternate_ids - set(identities))
            if additional:
                for identity in additional:
                    value = self.json(self.fetch(f"wp-{kind}-recovered-{identity}.json", endpoint + f"/{identity}", collection=kind, recovery=True))
                    if value.get("id") != identity:
                        raise ValueError("Recovered source identity differs")
                    records.append(value)
            status.update(observed=len(records), uniqueIds=len({row["id"] for row in records}),
                          alternateObserved=len(alternate_ids), alternateIdMatch=alternate_ids == {row["id"] for row in records},
                          reportedDifference=reported - len(records))
        return records, status

    def gis(self, seeds):
        queue = list(seeds)
        finished = {}
        while queue:
            identity = queue.pop(0)
            if identity in finished or not ITEM_ID.fullmatch(identity):
                continue
            base = "https://www.arcgis.com/sharing/rest/content/items/" + identity
            item_record = self.fetch(f"gis/{identity}-item.json", base + "?f=json", itemId=identity, part="item")
            data_record = self.fetch(f"gis/{identity}-data.json", base + "/data?f=json", itemId=identity, part="data")
            item, data = self.json(item_record), self.json(data_record)
            record = {"id": identity, "itemFile": item_record["file"], "dataFile": data_record["file"],
                      "sourcePageIds": seeds.get(identity, []), "dependencies": [], "layers": []}
            finished[identity] = record
            if not isinstance(item, dict) or "error" in item:
                record["status"] = "PROVIDER_ERROR"
                record["providerError"] = item.get("error") if isinstance(item, dict) else {"message": "Non-object item"}
                continue
            record.update(status="CAPTURED", title=item.get("title"), type=item.get("type"), access=item.get("access"),
                          modified=item.get("modified"), url=item.get("url"))
            if not isinstance(data, dict) or "error" in data:
                record["dataStatus"] = "PROVIDER_ERROR"
                continue
            for resource in data.get("resources", {}).values():
                dependency = resource.get("data", {}).get("itemId")
                if resource.get("type") in ("webmap", "webscene") and dependency and ITEM_ID.fullmatch(dependency):
                    record["dependencies"].append(dependency)
                    queue.append(dependency)
            for layer in data.get("operationalLayers", []):
                record["layers"].append({key: layer.get(key) for key in ("id", "title", "itemId", "url", "layerType")})
                url = layer.get("url", "")
                if re.search(r"/FeatureServer/\d+$", url):
                    name = f"gis/{identity}-layer-{len(record['layers'])}.json"
                    observed = self.fetch(name, url + "?f=json", itemId=identity, layerId=layer["id"], part="layer")
                    record["layers"][-1]["metadataFile"] = observed["file"]
            if item.get("type") == "StoryMap":
                start, seen, resource_files = 1, set(), []
                while start != -1:
                    if start in seen:
                        raise ValueError("ArcGIS resource cursor repeated")
                    seen.add(start)
                    result = self.fetch(f"gis/{identity}-resources-{start}.json", base + f"/resources?f=json&num=100&start={start}", itemId=identity, part="resources")
                    resource_files.append(result["file"])
                    value = self.json(result)
                    if value.get("error"):
                        break
                    start = int(value.get("nextStart", -1))
                record["resourceFiles"] = resource_files
        return list(finished.values())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True)
    parser.add_argument("--site", default=SITE)
    parser.add_argument("--rfp-url", default=RFP)
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--skip-html", action="store_true", help="Keep only native WordPress page bodies")
    parser.add_argument("--skip-gis", action="store_true")
    parser.add_argument("--media-file-id", action="append", type=int, default=[], help="Retain a selected original asset; repeat for additional IDs")
    parser.add_argument("--max-file-mib", type=int, default=32)
    args = parser.parse_args()
    capture = Capture(args.output, args.site, args.resume, args.max_file_mib * 1024 * 1024)
    capture.fetch("DEWR_Website_RFP_Final.pdf", args.rfp_url, role="procurement")
    corpus = {"schema": "cskt.public-corpus.v1", "capturedAt": now(),
              "site": {"url": capture.site, "restUrl": capture.site + "wp-json/wp/v2/"}, "capture": {}}
    for kind in ("pages", "posts", "media"):
        corpus[kind], corpus["capture"][kind] = capture.collection(kind)
    seeds = dict(STORIES) if capture.site == SITE else {}
    public_html, links = [], []
    for page in corpus["pages"]:
        bodies = [("wordpress-rendered", page.get("content", {}).get("rendered", ""))]
        if not args.skip_html:
            result = capture.fetch(f"pages/{page['id']}.html", page["link"], pageId=page["id"], role="published-page")
            public_html.append(result)
            if result.get("status") == 200:
                bodies.append((result["file"], (capture.output / result["file"]).read_text(errors="replace")))
        for source, body in bodies:
            parsed = LinkReader()
            parsed.feed(body)
            for value in parsed.links:
                url = urllib.parse.urljoin(page["link"], value.pop("value"))
                links.append({"pageId": page["id"], "source": source, **value, "url": url})
                parsed_url = urllib.parse.urlsplit(url)
                host = parsed_url.hostname or ""
                if host == "arcgis.com" or host.endswith(".arcgis.com"):
                    match = re.search(r"/stories/([0-9a-f]{32})(?:/|$)", parsed_url.path)
                    identity = match.group(1) if match else dict(urllib.parse.parse_qsl(parsed_url.query)).get("appid")
                    if identity and ITEM_ID.fullmatch(identity):
                        seeds.setdefault(identity, [])
                        if page["id"] not in seeds[identity]:
                            seeds[identity].append(page["id"])
    corpus["publicHtml"] = public_html
    corpus["gis"] = {"items": [] if args.skip_gis else capture.gis(seeds)}
    assets = []
    for identity in args.media_file_id:
        media = next((row for row in corpus["media"] if row["id"] == identity), None)
        if media is None:
            raise ValueError("Selected media ID is absent from this original corpus")
        source_url = media["source_url"]
        relative = media.get("media_details", {}).get("file")
        selection = "source_url"
        if relative and not relative.startswith("/") and ".." not in Path(relative).parts:
            source_url = capture.site + "wp-content/uploads/" + urllib.parse.quote(relative, safe="/")
            selection = "media_details.file"
        suffix = Path(urllib.parse.urlsplit(source_url).path).suffix or ".bin"
        result = capture.fetch(f"assets/{identity}{suffix}", source_url, mediaId=identity,
                               selectedFrom=selection, originalSourceUrl=media["source_url"], declaredMimeType=media.get("mime_type"))
        assets.append(result)
    corpus["assets"] = assets
    corpus["sources"] = capture.index["sources"]
    corpus["completedAt"] = now()
    write_json(capture.output / "source-links.json", links)
    write_json(capture.output / "corpus.json", corpus)
    print(json.dumps({"corpus": str(capture.output / "corpus.json"), "capture": corpus["capture"],
                      "gisItems": len(corpus["gis"]["items"]), "sources": len(corpus["sources"])}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(type(error).__name__ + ": " + str(error), file=sys.stderr)
        raise SystemExit(1)
