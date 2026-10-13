"""Immutable named review selections over original PublishedStudyStore editions."""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import html
import json
from pathlib import Path
import re
import tempfile
import zipfile

from model.common import held
from .published_studies import _atomic, _json_bytes

SCHEMA = "upstate.published-study-review/v1"
BUNDLE_SCHEMA = "upstate.published-study-review-export/v1"
TABS = frozenset(("seasonal", "continuous", "observed", "wqp", "flow", "figures", "ranges", "stations", "sources"))
FILTERS = frozenset(("site_ids", "parameters", "strata", "year", "months"))


def _hash(raw):
    return hashlib.sha256(raw).hexdigest()


def _id(value):
    if not isinstance(value, str) or not re.fullmatch(r"review-[0-9a-f]{64}", value):
        raise ValueError("Choose an original saved review identifier.")
    return value


def _text(value, name, limit, *, required=False):
    if not isinstance(value, str) or len(value) > limit or any(ord(c) < 32 and c not in "\n\t" for c in value):
        raise ValueError(name + " must be text of at most " + str(limit) + " characters.")
    value = value.strip()
    if required and not value:
        raise ValueError("Enter a review title.")
    return value


def _binding(record):
    return {
        "study_id": record["study_id"], "version_id": record["version_id"],
        "source_collection_id": record["source_collection_id"],
        "source_manifest_sha256": record["source_manifest"]["sha256"],
        "source_files_sha256": _hash(_json_bytes(sorted(record["source_files"], key=lambda row: row["path"]))),
    }



REVIEW_PRESENTATION = "published-study-review/2"

_TABLE_TITLES = {
    "seasonal": "Seasonal observations", "continuous": "Continuous observations",
    "observed": "Original observations", "wqp": "Original water-quality records",
    "flow": "Flow context", "figures": "Scientific figures", "ranges": "Observed ranges",
    "stations": "Original stations", "sources": "Original sources",
}
_MONTH_NAMES = ("January", "February", "March", "April", "May", "June",
                "July", "August", "September", "October", "November", "December")


def _review_document(value, interpretation_matches_snapshot):
    """Readable portable opening page; original source/science stays in its report."""
    body = value["content"]
    binding, filters = body["binding"], body["selection"]
    esc = html.escape

    def selected(values, empty):
        if not values:
            return "<p>" + esc(empty) + "</p>"
        return '<ul class="values">' + "".join("<li>" + esc(str(item)) + "</li>" for item in values) + "</ul>"

    rows = (
        ("Stations", selected(filters["site_ids"], "All retained stations")),
        ("Parameters", selected(filters["parameters"], "All retained parameters")),
        ("Strata", selected(filters["strata"], "All retained strata")),
        ("Year", "<p>" + esc(str(filters["year"]) if filters["year"] is not None else "All retained years") + "</p>"),
        ("Months", selected([_MONTH_NAMES[month - 1] for month in filters["months"]], "All retained months")),
        ("Saved table", "<p>" + esc(_TABLE_TITLES.get(body["table"], body["table"])) + "</p>"),
    )
    details = "".join("<dt>" + esc(label) + "</dt><dd>" + content + "</dd>" for label, content in rows)
    style = """
:root{color-scheme:light;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#222;background:#fff}
*{box-sizing:border-box}body{margin:0;font-size:16px;line-height:1.55}main{max-width:72rem;margin:0 auto;padding:2rem clamp(1rem,4vw,3rem) 3rem}
a{color:inherit;text-underline-offset:.18em;overflow-wrap:anywhere}a:focus-visible,summary:focus-visible{outline:3px solid #111;outline-offset:4px}
h1{font-size:clamp(1.6rem,4vw,2.35rem);line-height:1.18;margin:.4rem 0 1rem;overflow-wrap:anywhere}h2{font-size:1.25rem;margin:2rem 0 .7rem}p{margin:.6rem 0}
.kicker{font-size:.82rem;letter-spacing:.04em;text-transform:uppercase}.study{font-size:1.1rem}.intro{max-width:66ch}
nav{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,18rem),1fr));gap:.75rem;margin:1.4rem 0}nav a{border:1px solid #888;padding:.9rem 1rem;text-decoration:none;min-height:3rem}nav a:hover{background:#f3f3f3}nav strong,nav span{display:block}nav span{font-size:.9rem;margin-top:.25rem}
dl{margin:0}.selection,.identities{display:grid;grid-template-columns:minmax(7rem,10rem) minmax(0,1fr);column-gap:1.2rem}.selection dt,.selection dd,.identities dt,.identities dd{padding:.6rem 0;border-bottom:1px solid #ddd;margin:0;overflow-wrap:anywhere}.selection dt,.identities dt{font-weight:600}.selection p{margin:0}
.values{margin:0;padding:0;list-style:none;display:flex;flex-wrap:wrap;gap:.2rem 1.2rem}.values li{max-width:100%;overflow-wrap:anywhere}
.notice{border-left:3px solid #555;padding:.25rem 1rem;margin:1rem 0}.notes,.source-details{border:1px solid #bbb;padding:.8rem 1rem;margin:1rem 0}summary{cursor:pointer;font-weight:600;overflow-wrap:anywhere}.notes pre{font:inherit;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere;margin:1rem 0 0}
code{font-size:.9em;overflow-wrap:anywhere;white-space:normal}.source-details dl{margin-top:.8rem}footer{border-top:1px solid #999;margin-top:2rem;padding-top:1rem;font-size:.9rem}.muted{color:#555}
@media(max-width:480px){main{padding:1.25rem 1rem 2rem}.selection,.identities{grid-template-columns:1fr}.selection dt,.identities dt{border-bottom:0;padding:.7rem 0 0}.selection dd,.identities dd{padding:.15rem 0 .7rem}.notes,.source-details{padding:.75rem}nav{grid-template-columns:1fr}}
@media print{@page{margin:16mm}body{font-size:10pt}main{max-width:none;padding:0}nav{display:block}nav a{display:block;margin:.4rem 0;padding:.5rem}h1{font-size:20pt}h2,summary{break-after:avoid}dt,dd,li{break-inside:avoid}.selection,.identities{grid-template-columns:9rem minmax(0,1fr)}a{color:#000}.notes:not([open])>pre,.source-details:not([open])>dl{display:none}.notes[open] pre{white-space:pre-wrap}footer{font-size:9pt}}
"""
    document = '<!doctype html><html lang="en"><head><meta charset="utf-8">'
    document += '<meta name="viewport" content="width=device-width, initial-scale=1">'
    document += "<title>" + esc(body["title"]) + "</title><style>" + style + "</style></head><body><main>"
    document += '<header><p class="kicker">Saved observation review</p><h1>' + esc(body["title"]) + "</h1>"
    document += '<p class="study">' + esc(body["study_title"]) + "</p>"
    document += '<p class="intro">Open the selected original study report to explore its observations, scientific context and sources. This review retains the exact study edition and filters shown below.</p></header>'
    document += '<nav aria-label="Review reports and original files">'
    document += '<a href="selected/study-report.html"><strong>Open selected study report</strong><span>Original observations, scientific figures and source links</span></a>'
    document += '<a href="original-study.zip"><strong>Complete original study</strong><span>Original source files and editable study edition</span></a>'
    document += '<a href="review.json"><strong>Saved review record</strong><span>Exact filters, full notes and retained scientific snapshot</span></a></nav>'
    if not interpretation_matches_snapshot:
        document += '<aside class="notice"><strong>Interpretation update</strong><p>The selected report uses the current maintained interpretation. The saved review record retains its original coverage and temporal-support snapshot. Its source edition and exact filters are unchanged.</p></aside>'
    document += '<section aria-labelledby="cohort"><h2 id="cohort">Selected observations</h2><dl class="selection">' + details + "</dl>"
    document += '<p class="muted">Calendar applicability, original units, censor treatment and sampling support are explained in the selected study report. A filter does not turn sampled records into a continuous or annual estimate.</p></section>'
    if body["notes"]:
        document += '<details class="notes"><summary>Saved review notes</summary><pre>' + esc(body["notes"]) + "</pre></details>"
    else:
        document += '<p class="muted">No review notes were saved.</p>'
    identities = (
        ("Review", value["id"]), ("Study", binding["study_id"]), ("Study edition", binding["version_id"]),
        ("Saved", value["saved_at"]), ("Source collection", binding["source_collection_id"]),
        ("Source manifest SHA256", binding["source_manifest_sha256"]),
        ("Original source inventory SHA256", binding["source_files_sha256"]),
    )
    document += '<details class="source-details"><summary>Original review and source identities</summary><dl class="identities">'
    document += "".join("<dt>" + esc(label) + "</dt><dd><code>" + esc(str(text)) + "</code></dd>" for label, text in identities)
    document += "</dl></details>"
    document += '<footer><p>To edit or revise this selection, import the complete <strong>saved-review.zip</strong> in the maintained Published studies desk. Its original study and immutable review are retained together; receiving preserves an existing current study edition.</p>'
    document += '<p>The authored notes remain available above and in the original review record. The selected report and complete source study carry their own original scientific interpretation.</p>'
    document += '<p><a href="selected/study-report.html">Open selected study report</a> · <a href="review.json">Original review JSON</a></p>'
    document += "</footer></main></body></html>"
    return document


class PublishedStudyReviews:
    def __init__(self, store):
        self.store = store
        self.root = store.root / "reviews"

    def _path(self, review_id):
        return self.root / (_id(review_id) + ".json")

    @classmethod
    def _validate(cls, value, review_id=None):
        if not isinstance(value, dict) or value.get("schema") != SCHEMA:
            raise ValueError("Choose an original saved study review.")
        identity = _id(value.get("id"))
        if review_id is not None and identity != review_id:
            raise ValueError("The retained review identity changed.")
        body = value.get("content")
        if not isinstance(body, dict) or "review-" + _hash(_json_bytes(body)) != identity:
            raise ValueError("The retained review content changed.")
        required = {"title", "notes", "table", "binding", "selection", "parent_review_id",
                    "coverage", "temporal_support", "study_title"}
        if set(body) != required:
            raise ValueError("The saved review content fields are incompatible.")
        _text(body["title"], "Title", 200, required=True)
        _text(body["notes"], "Review notes", 12000)
        _text(body["study_title"], "Study title", 10000, required=True)
        if body["table"] not in TABS:
            raise ValueError("The retained review table is unavailable.")
        if body["parent_review_id"] is not None:
            _id(body["parent_review_id"])
        filters = cls._filters(body["selection"])
        if filters != body["selection"]:
            raise ValueError("The retained cohort selection is not canonical.")
        binding = body["binding"]
        if not isinstance(binding, dict) or set(binding) != {
            "study_id", "version_id", "source_collection_id", "source_manifest_sha256", "source_files_sha256"
        }:
            raise ValueError("The review must retain its complete original source binding.")
        if not isinstance(binding["study_id"], str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,119}", binding["study_id"]):
            raise ValueError("The saved study identifier is invalid.")
        if not isinstance(binding["version_id"], str) or not re.fullmatch(r"study-[0-9a-f]{24}", binding["version_id"]):
            raise ValueError("The saved study version is invalid.")
        for key in ("source_collection_id", "source_manifest_sha256", "source_files_sha256"):
            if not isinstance(binding[key], str) or not re.fullmatch(r"[0-9a-f]{64}", binding[key]):
                raise ValueError("The saved source binding is invalid: " + key)
        if not isinstance(body["coverage"], dict) or not isinstance(body["temporal_support"], dict):
            raise ValueError("The saved review must preserve its original coverage and sampling support.")
        if not isinstance(value.get("saved_at"), str):
            raise ValueError("The saved review timestamp is missing.")
        try:
            timestamp = datetime.fromisoformat(value["saved_at"])
        except ValueError as error:
            raise ValueError("The saved review timestamp is invalid.") from error
        if timestamp.tzinfo is None:
            raise ValueError("The saved review timestamp must include its timezone.")
        return value

    def _read(self, review_id):
        return self._validate(json.loads(self._path(review_id).read_text(encoding="utf-8")), review_id)

    def catalog(self):
        if not self.root.exists():
            return []
        result = []
        for path in self.root.glob("review-*.json"):
            value = self._read(path.stem)
            body = value["content"]
            result.append({
                "id": value["id"], "saved_at": value["saved_at"], "title": body["title"],
                "study_id": body["binding"]["study_id"], "version_id": body["binding"]["version_id"],
                "parent_review_id": body.get("parent_review_id"),
                "selection": body["selection"], "table": body["table"],
            })
        return sorted(result, key=lambda row: (row["saved_at"], row["id"]), reverse=True)

    @staticmethod
    def _filters(value):
        if not isinstance(value, dict) or set(value) - FILTERS:
            raise ValueError("Use the original station, parameter, stratum, year and month filters.")
        result = {}
        for key in ("site_ids", "parameters", "strata"):
            values = value.get(key, [])
            if not isinstance(values, list) or len(values) > 10000 or any(not isinstance(v, str) or not v or len(v) > 500 for v in values):
                raise ValueError(key + " must be a list of original text values.")
            result[key] = sorted(set(values))
        year = value.get("year")
        if year is not None and (isinstance(year, bool) or not isinstance(year, int) or not 1900 <= year <= 2200):
            raise ValueError("Choose a valid sampling year.")
        result["year"] = year
        months = value.get("months", [])
        if not isinstance(months, list) or any(isinstance(v, bool) or not isinstance(v, int) or not 1 <= v <= 12 for v in months):
            raise ValueError("Months must be whole numbers from 1 through 12.")
        result["months"] = sorted(set(months))
        return result

    def save(self, payload):
        if not isinstance(payload, dict):
            raise ValueError("The saved review must be an object.")
        study_id, version_id = payload.get("study_id"), payload.get("version_id")
        if not isinstance(study_id, str) or not isinstance(version_id, str) or not version_id:
            raise ValueError("A review requires the exact retained study and version.")
        title = _text(payload.get("title"), "Title", 200, required=True)
        notes = _text(payload.get("notes", ""), "Review notes", 12000)
        table = payload.get("table", "observed")
        if table not in TABS:
            raise ValueError("Choose an original study table.")
        filters = self._filters(payload.get("selection", {}))
        context = self.store.context(study_id, version_id, **filters)
        parent = payload.get("parent_review_id")
        if parent is not None:
            previous = self._read(_id(parent))
            if previous["content"]["binding"] != _binding(context["record"]):
                raise ValueError("A review revision must keep its original study edition; save a new review for another edition.")
        body = {
            "title": title, "notes": notes, "table": table,
            "binding": _binding(context["record"]), "selection": context["selection"],
            "parent_review_id": parent,
            "coverage": context["coverage"], "temporal_support": context["temporal_support"],
            "study_title": context["study"]["title"],
        }
        review_id = "review-" + _hash(_json_bytes(body))
        value = {"schema": SCHEMA, "id": review_id, "content": body,
                 "saved_at": datetime.now(timezone.utc).isoformat()}
        with held(self.root / ".lock"):
            path = self._path(review_id)
            if path.exists():
                return {"review": self._read(review_id), "reused": True}
            _atomic(path, _json_bytes(value))
        return {"review": value, "reused": False}

    def get(self, review_id):
        value = self._read(review_id)
        body = value["content"]
        binding = body["binding"]
        context = self.store.context(binding["study_id"], binding["version_id"], **body["selection"])
        if _binding(context["record"]) != binding:
            raise ValueError("The saved review's original source edition differs from its retained binding.")
        if context["selection"] != body["selection"]:
            raise ValueError("The saved cohort no longer resolves to its original selection.")
        return {"review": value, "context": context,
                "interpretation_matches_snapshot": _json_bytes(context["coverage"]) == _json_bytes(body["coverage"]) and
                _json_bytes(context["temporal_support"]) == _json_bytes(body["temporal_support"])}

    def export(self, review_id, destination):
        result = self.get(review_id)
        value, context = result["review"], result["context"]
        body = value["content"]
        destination = Path(destination)
        destination.mkdir(parents=True, exist_ok=True)
        # Existing producers retain all original CSV columns, authored report links,
        # source companions and scientifically distinct sampling calendars.
        selected = self.store.export_context(
            body["binding"]["study_id"], destination / "selected",
            body["binding"]["version_id"], **body["selection"])
        original = self.store.export_study(
            body["binding"]["study_id"], destination / "original-study.zip",
            body["binding"]["version_id"])
        _atomic(destination / "review.json", _json_bytes(value))
        document = _review_document(value, result["interpretation_matches_snapshot"])
        _atomic(destination / "review.html", document.encode("utf-8"))
        names = ["review.json", "review.html", "original-study.zip"]
        names.extend("selected/" + row["relative_path"] for row in selected["files"])
        entries = [{"path": name, "bytes": (destination / name).stat().st_size,
                    "sha256": _hash((destination / name).read_bytes())} for name in sorted(set(names))]
        index = {"schema": BUNDLE_SCHEMA, "review_id": value["id"], "files": entries,
                 "presentation_edition": REVIEW_PRESENTATION,
                 "interpretation_matches_snapshot": result["interpretation_matches_snapshot"],
                 "reopen": "Import this review ZIP through Published studies; its original study and exact selection are retained."}
        _atomic(destination / "review-export.json", _json_bytes(index))
        archive_path = destination / "saved-review.zip"
        with tempfile.NamedTemporaryFile(dir=destination, suffix=".zip", delete=False) as temp:
            temporary = Path(temp.name)
        try:
            with zipfile.ZipFile(temporary, "w", zipfile.ZIP_DEFLATED) as archive:
                for name in [*sorted(set(names)), "review-export.json"]:
                    archive.write(destination / name, name)
            temporary.replace(archive_path)
        finally:
            temporary.unlink(missing_ok=True)
        return {"review": value, "files": [destination / "review.json", archive_path]}

    def receive(self, source, *, operation_id):
        raw = source if isinstance(source, bytes) else Path(source).read_bytes()
        import io
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            names = archive.namelist()
            if len(names) != len(set(names)) or "review-export.json" not in names:
                raise ValueError("Choose a complete original saved-review ZIP.")
            if archive.getinfo("review-export.json").file_size > 4 * 1024 * 1024:
                raise ValueError("The review export index exceeds its supported size.")
            index = json.loads(archive.read("review-export.json"))
            if index.get("schema") != BUNDLE_SCHEMA:
                raise ValueError("The review export schema is incompatible.")
            files = index.get("files")
            if not isinstance(files, list) or len(files) > 2000:
                raise ValueError("The review export must retain its complete source inventory.")
            inventory = {row["path"]: row for row in files}
            if len(inventory) != len(files) or set(names) != set(inventory) | {"review-export.json"}:
                raise ValueError("The review archive member inventory differs.")
            if not {"review.json", "review.html", "original-study.zip"} <= set(inventory):
                raise ValueError("The review export is missing its original study.")
            total = sum(archive.getinfo(name).file_size for name in inventory)
            if total > 1024 * 1024 * 1024:
                raise ValueError("The complete review export exceeds 1 GiB.")
            retained = {}
            for name, item in inventory.items():
                if name.startswith("/") or "\\" in name or any(part in ("", ".", "..") for part in name.split("/")):
                    raise ValueError("An archive member has an invalid relative path.")
                digest = hashlib.sha256()
                count = 0
                with archive.open(name) as stream:
                    while True:
                        block = stream.read(1024 * 1024)
                        if not block:
                            break
                        count += len(block); digest.update(block)
                if count != item["bytes"] or digest.hexdigest() != item["sha256"]:
                    raise ValueError("Original review export member changed: " + name)
                if name in ("review.json", "original-study.zip"):
                    retained[name] = archive.read(name)
        value = self._validate(json.loads(retained["review.json"]), index.get("review_id"))
        body = value["content"]
        imported = self.store.import_source(retained["original-study.zip"], operation_id=operation_id, make_current=False)
        if _binding(imported["record"]) != body["binding"]:
            raise ValueError("The imported original study differs from the review's bound source edition.")
        resolved = self.store.context(body["binding"]["study_id"], body["binding"]["version_id"], **body["selection"])
        if _binding(resolved["record"]) != body["binding"] or resolved["selection"] != body["selection"]:
            raise ValueError("The imported review does not resolve to its exact original source selection.")
        # Export is a complete standalone review. Its parent identity remains
        # provenance; an earlier review need not be imported to reopen this one.
        with held(self.root / ".lock"):
            path = self._path(value["id"])
            reused = path.exists()
            if reused:
                existing = self._read(value["id"])
                if existing["content"] != body:
                    raise ValueError("An existing review with this identity has different content.")
                value = existing
            else:
                _atomic(path, _json_bytes(value))
        return {"review": self.get(value["id"])["review"], "reused": reused,
                "study_reused": imported.get("reused", False)}


def main(argv=None):
    import argparse
    from model.workspace import Workspace
    from .published_studies import PublishedStudyStore
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--result", help="Write the complete returned JSON to this file.")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("list")
    save = commands.add_parser("save")
    save.add_argument("--selection", required=True, help="JSON request with exact study/version, title, filters and optional parent.")
    for command in ("open", "export"):
        item = commands.add_parser(command)
        item.add_argument("--review-id", required=True)
        if command == "export":
            item.add_argument("--out", required=True)
    receive = commands.add_parser("receive")
    receive.add_argument("--source", required=True)
    receive.add_argument("--operation-id", required=True)
    args = parser.parse_args(argv)
    workspace = Workspace(args.workspace)
    reviews = PublishedStudyReviews(PublishedStudyStore(workspace, workspace.root / "published_studies"))
    if args.command == "list":
        result = {"reviews": reviews.catalog()}
    elif args.command == "save":
        result = reviews.save(json.loads(Path(args.selection).read_text(encoding="utf-8-sig")))
    elif args.command == "open":
        result = reviews.get(args.review_id)
    elif args.command == "export":
        result = reviews.export(args.review_id, args.out)
        result["files"] = [str(path.resolve()) for path in result["files"]]
    else:
        result = reviews.receive(Path(args.source), operation_id=args.operation_id)
    raw = _json_bytes(result)
    if args.result:
        _atomic(Path(args.result), raw)
        print(json.dumps({"result": str(Path(args.result).resolve()), "bytes": len(raw), "sha256": _hash(raw)}))
    else:
        print(raw.decode("utf-8"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
