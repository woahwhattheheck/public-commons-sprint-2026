"""Offline atlas navigation generated from the actual captured delivery members."""
from __future__ import annotations

import base64
import hashlib
from html import escape
import json
from pathlib import Path, PurePosixPath
from urllib.parse import quote

from .common import MAP_IDS, atomic_bytes, describe_file
from .cartography import TITLES

BROWSER_PATH = "maps/atlas-browser.html"
BROWSER_KEY = "map_atlas_browser"

SCRIPT = r"""
(function () {
  'use strict';
  const form = document.querySelector('[data-atlas-filters]');
  const cards = Array.from(document.querySelectorAll('[data-map-sheet]'));
  const count = document.querySelector('[data-visible-count]');
  const empty = document.querySelector('[data-empty]');
  if (!form || !count || !empty) return;
  function update() {
    const family = form.elements.namedItem('family').value;
    const scenario = form.elements.namedItem('scenario').value;
    const query = form.elements.namedItem('search').value.trim().toLocaleLowerCase();
    let visible = 0;
    for (const card of cards) {
      const match = (!family || card.dataset.family === family) &&
        (!scenario || card.dataset.scenario === scenario) &&
        (!query || card.dataset.search.includes(query));
      card.hidden = !match;
      if (match) visible += 1;
    }
    count.textContent = visible + ' of ' + cards.length + ' map sheets';
    empty.hidden = visible !== 0;
  }
  form.addEventListener('input', update);
  form.addEventListener('change', update);
  form.addEventListener('submit', function (event) { event.preventDefault(); });
  document.querySelector('[data-reset]').addEventListener('click', function () {
    form.reset();
    update();
    form.elements.namedItem('search').focus();
  });
  document.querySelector('[data-print]').addEventListener('click', function () { window.print(); });
  form.hidden = false;
  document.querySelector('[data-filter-help]').hidden = false;
  update();
})();
"""

STYLE = """
:root{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#202020;background:#f4f4f4;line-height:1.5}
*{box-sizing:border-box}body{margin:0}header{background:#262626;color:#fff;padding:28px max(20px,calc((100vw - 1160px)/2))}
header p{max-width:85ch;color:#e4e4e4}h1{font-size:clamp(24px,4vw,34px);line-height:1.2;margin:8px 0 16px}h2{font-size:21px;margin:0 0 12px}h3{font-size:17px;margin:4px 0 12px}
main{max-width:1200px;margin:auto;padding:24px 20px}section,.sheet{background:#fff;border:1px solid #c8c8c8;padding:20px;margin:0 0 18px}
.eyebrow{font-size:12px;letter-spacing:.08em;text-transform:uppercase}a{color:#202020;text-underline-offset:3px}header a{color:#fff}a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible{outline:3px solid #555;outline-offset:3px}
.actions{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0}.actions a,button{display:inline-block;border:1px solid #777;background:#fff;color:#222;padding:8px 12px;font:inherit;font-size:13px;text-decoration:none;cursor:pointer}
header .actions a{border-color:#bdbdbd;background:#fff;color:#222}.muted{color:#606060;font-size:13px}.tag{display:inline-block;border:1px solid #b8b8b8;background:#f4f4f4;padding:2px 7px;font-size:12px}.sheet-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.field{margin:0}.field dt{font-size:12px;color:#626262}.field dd{margin:3px 0 10px;overflow-wrap:anywhere}
code,pre{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;overflow-wrap:anywhere}pre{white-space:pre-wrap;background:#f3f3f3;padding:12px;border:1px solid #ddd;max-height:34rem;overflow:auto}details{margin:14px 0}summary{cursor:pointer;font-weight:600}table{border-collapse:collapse;width:100%;font-size:13px}th,td{padding:10px 9px;border-bottom:1px solid #d6d6d6;text-align:left;vertical-align:top}th{background:#eee;font-weight:600}.table-wrap{overflow:auto}.hash{max-width:44rem;word-break:break-all}.nowrap{white-space:nowrap}form{display:grid;grid-template-columns:1fr 1fr 1.3fr;gap:12px}label{display:grid;gap:4px;font-size:12px;font-weight:600}input,select{width:100%;min-width:0;border:1px solid #999;border-radius:0;padding:9px;background:#fff;color:#222;font:inherit;font-size:14px}footer{max-width:1200px;margin:auto;padding:0 20px 25px;color:#606060;font-size:12px}.empty{border:1px solid #aaa;padding:15px;background:#f1f1f1}[hidden]{display:none!important}.sheet{scroll-margin:16px}
@media(max-width:720px){main{padding:14px 10px}section,.sheet{padding:14px}form,.grid{grid-template-columns:1fr}.sheet-head{display:block}.actions a{flex:1 1 auto}th,td{padding:8px 6px}}
@media print{body{background:#fff;color:#000}header{background:#fff;color:#000;padding:0 0 14px}header p{color:#333}header .actions,form,[data-filter-help],.sheet .actions,.no-print{display:none!important}main{max-width:none;padding:0}.sheet{break-inside:avoid}section,.sheet{border-color:#aaa}pre{max-height:none}a{color:#000}footer{padding:10px 0}}
"""


def _text(value):
    return escape("" if value is None else str(value), quote=True)


def _path(value):
    if (not isinstance(value, str) or not value or "\\" in value
            or any(ord(char) < 32 or ord(char) == 127 for char in value)):
        raise ValueError("Atlas browser requires a retained relative delivery path")
    parts = value.split("/")
    if PurePosixPath(value).is_absolute() or any(part in ("", ".", "..") for part in parts):
        raise ValueError("Atlas browser path leaves the delivery directory")
    return value


def _href(value):
    # This HTML is in maps/, while every record is relative to the delivery root.
    return "../" + quote(_path(value), safe="/")


def _link(path, label, *, download=False, page=None):
    href = _href(path)
    if page is not None:
        if type(page) is not int or page < 1:
            raise ValueError("Atlas page must be a positive integer")
        href += "#page=" + str(page)
    attributes = " download" if download else ' target="_blank" rel="noopener noreferrer"'
    return '<a href="' + _text(href) + '"' + attributes + ">" + _text(label) + "</a>"


def _json(value):
    return "<pre>" + _text(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True,
                                    allow_nan=False)) + "</pre>"


def _details(title, value):
    if value is None or value == {} or value == []:
        return ""
    return "<details><summary>" + _text(title) + "</summary>" + _json(value) + "</details>"


def _field(title, value):
    return '<dl class="field"><dt>' + _text(title) + "</dt><dd><code>" + _text(value) + "</code></dd></dl>"


def _scale(panel):
    scale = panel.get("display_scale")
    if not isinstance(scale, dict):
        return "Display range is recorded on the original PDF."
    if scale.get("minimum") is None or scale.get("maximum") is None:
        return _text(scale.get("label") or "Original map legend")
    return (_text(scale["minimum"]) + " to " + _text(scale["maximum"]) +
            ("<br><span class=\"muted\">" + _text(scale["label"]) + "</span>" if scale.get("label") else ""))


def _sheet(row, atlas, included):
    path = _path(row["file"]["path"])
    if path not in included:
        raise ValueError("Atlas map is absent from the captured member selection: " + path)
    family = row["family"]
    if family not in MAP_IDS:
        raise ValueError("Unknown atlas map family")
    scenario = row.get("scenario_run_id")
    searchable = json.dumps({"title": row["title"], "subtitle": row.get("subtitle"),
                              "family": TITLES[family], "scenario": scenario,
                              "panels": row["panels"]}, ensure_ascii=False).lower()
    rows = []
    for panel in row["panels"]:
        rows.append("<tr><td>" + _text(panel["title"]) + "</td><td>" + _text(panel["units"]) +
                    "</td><td>" + ("Alternative minus baseline" if panel.get("signed") else "Original value") +
                    "</td><td>" + _scale(panel) + "</td></tr>")
    native_sources = [{"panel": panel["title"], "units": panel["units"],
                       "workspace_raster": panel["source_raster"],
                       "display_scale": panel.get("display_scale")} for panel in row["panels"]]
    return ('<article class="sheet" data-map-sheet data-family="' + _text(family) +
            '" data-scenario="' + _text(scenario or "reference-context") +
            '" data-search="' + _text(searchable) + '" id="sheet-' + str(row["page"]) +
            '"><div class="sheet-head"><div><div class="eyebrow">' +
            _text(TITLES[family]) + "</div><h3>" + _text(row["title"]) +
            '</h3></div><span class="tag">Atlas page ' + str(row["page"]) + "</span></div>" +
            ("<p>" + _text(row["subtitle"]) + "</p>" if row.get("subtitle") else "") +
            '<p class="muted">' + ("Alternative run <code>" + _text(scenario) + "</code>" if scenario else
             "Baseline and retained source context") + '</p><div class="actions">' +
            _link(path, "Open map PDF") + _link(path, "Download map", download=True) +
            _link(atlas["file"]["path"], "Open atlas at this page", page=row["page"]) +
            '</div><div class="table-wrap"><table><thead><tr><th>Panel</th><th>Physical units / index</th>'
            '<th>Quantity</th><th>Retained display range</th></tr></thead><tbody>' +
            "".join(rows) + "</tbody></table></div>" +
            _details("Original native raster and scale", native_sources) +
            _details("Rendered source overlays", row.get("overlays")) +
            _details("Original PDF file", row["file"]) + "</article>")


def _members(manifest, browser_path=BROWSER_PATH):
    members = {}
    def add(path, role):
        path = _path(path)
        members.setdefault(path, []).append(role)
    for family, path in manifest["maps"].items():
        add(path, "Map / " + TITLES.get(family, family))
    for name, item in manifest["rasters"].items():
        add(item["path"], "Raster / " + name)
        add(item["fgdc_xml"], "Metadata / " + name)
    add(manifest["report_pdf"], "Scientific report")
    for path in manifest.get("project_assets", []):
        add(path, "Project asset")
    members.pop(browser_path, None)
    return members


def render(state, manifest, *, browser_path=BROWSER_PATH, manifest_path="delivery.json"):
    """Render only paths selected for the original packager, without network IO."""
    atlas = state.get("atlas")
    if not isinstance(atlas, dict) or atlas.get("schema") != "upstate.map-atlas/v1":
        raise ValueError("Open a complete native map atlas before its offline browser")
    pages = atlas["pages"]
    if not pages or len(pages) != atlas["map_count"]:
        raise ValueError("Atlas browser needs the complete ordered sheet index")
    browser_path, manifest_path = _path(browser_path), _path(manifest_path)
    if len(PurePosixPath(browser_path).parts) != 2:
        raise ValueError("Atlas browser must remain one directory below its delivery root")
    members = _members(manifest, browser_path)
    for path in (atlas["file"]["path"], "maps/atlas-index.json", "maps/atlas-index.csv",
                 "maps/source-context.json"):
        if path not in members:
            raise ValueError("Atlas browser dependency is absent: " + path)
    descriptors = {item["path"]: item for item in
                   list(state.get("files", {}).values()) + list(state.get("maps", {}).values())
                   if isinstance(item, dict) and "path" in item}
    families = [family for family in MAP_IDS if any(row["family"] == family for row in pages)]
    cards = "".join(_sheet(row, atlas, members) for row in pages)
    options = "".join('<option value="' + _text(family) + '">' + _text(TITLES[family]) +
                      "</option>" for family in families)
    scenarios = "".join('<option value="' + _text(run_id) + '">Alternative ' +
                        str(index) + " / " + _text(run_id[:16]) + "</option>"
                        for index, run_id in enumerate(atlas["scenario_run_ids"], 1))
    file_rows = []
    for path, roles in sorted(members.items()):
        item = descriptors.get(path, {})
        links = _link(path, "Download", download=True)
        if PurePosixPath(path).suffix.lower() == ".pdf":
            links = _link(path, "Open PDF") + " · " + links
        size = item.get("bytes")
        size_text = format(size, ",") + " B" if type(size) is int else ""
        file_rows.append("<tr><td><code>" + _text(path) + "</code><br><span class=\"muted\">" +
                         _text(" · ".join(dict.fromkeys(roles))) + "</span>" +
                         ('<details><summary>SHA-256</summary><code class="hash">' +
                          _text(item["sha256"]) + "</code></details>" if item.get("sha256") else "") +
                         '</td><td class="nowrap">' + size_text + '</td><td class="nowrap">' + links + "</td></tr>")
    source = atlas.get("source_context") or {}
    report_files = "".join(_link(item["path"], item.get("title") or name.replace("source_report_", "").replace("_", " "),
                                download=PurePosixPath(item["path"]).suffix.lower() not in (".pdf", ".html"))
                           for name, item in state.get("files", {}).items()
                           if name.startswith("source_report_") and item["path"] in members)
    briefing = state.get("files", {}).get("client_report_briefing") or {}
    briefing_link = (_link(briefing["path"], "Open customer briefing")
                     if briefing.get("path") in members else "")
    script_hash = base64.b64encode(hashlib.sha256(SCRIPT.encode("utf-8")).digest()).decode("ascii")
    policy = ("default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-" + script_hash +
              "'; img-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'")
    return ('<!doctype html><html lang="en"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1">'
            '<meta http-equiv="Content-Security-Policy" content="' + _text(policy) + '">'
            "<title>" + _text(atlas["title"]) + " — Map atlas</title><style>" + STYLE +
            '</style></head><body><header><div class="eyebrow">Scientific Workbench / Map atlas</div>'
            "<h1>" + _text(atlas["title"]) + "</h1><p>" +
            _text(atlas.get("settings", {}).get("subtitle") or
                  "Explore the " + str(len(families)) + " map families, selected alternatives and original source context.") +
            '</p><div class="actions">' + _link(atlas["file"]["path"], "Open complete atlas") +
            _link(atlas["file"]["path"], "Download atlas PDF", download=True) +
            _link(manifest["report_pdf"], "Open scientific report") + briefing_link +
            _link(manifest_path, "Download delivery inventory" if manifest_path != "delivery.json"
                  else "Download delivery manifest", download=True) +
            '</div></header><main><section aria-labelledby="edition"><h2 id="edition">This atlas edition</h2>'
            '<div class="grid">' + _field("Delivery ID", state["id"]) +
            _field("Baseline run", atlas["baseline_run_id"]) + _field("Original grid", atlas["grid_id"]) +
            _field("Atlas", str(atlas["map_count"]) + " map sheets / " + str(atlas["page_count"]) + " pages") +
            '</div><p class="muted">Keep the extracted delivery folder together. Open this page locally; its maps and downloads use the retained relative paths.</p>'
            '<div class="actions">' + _link("maps/atlas-index.json", "Map index JSON", download=True) +
            _link("maps/atlas-index.csv", "Map index CSV", download=True) +
            _link("maps/source-context.json", "Original source choices", download=True) +
            '</div></section><section aria-labelledby="browse"><h2 id="browse">Browse map sheets</h2>'
            '<form data-atlas-filters hidden><label>Map family<select name="family"><option value="">All retained families</option>' +
            options + '</select></label><label>Scenario<select name="scenario"><option value="">All maps</option>'
            '<option value="reference-context">Baseline / source context</option>' + scenarios +
            '</select></label><label>Find a map or source<input name="search" type="search" autocomplete="off" placeholder="Title, pollutant or raster path"></label></form>'
            '<div class="actions" data-filter-help hidden><button type="button" data-reset>Show all maps</button>'
            '<button type="button" data-print>Print visible map index</button></div><p role="status" aria-live="polite" data-visible-count>' +
            str(len(pages)) + ' map sheets</p><p class="empty" data-empty hidden>No map sheets match these filters. Choose Show all maps to reset.</p>'
            '</section><div aria-label="Map sheets">' + cards +
            '</div><section aria-labelledby="context"><h2 id="context">Original source context</h2>' +
            ('<div class="actions">' + report_files + "</div>" if report_files else "") +
            _details("Source watershed report", source.get("source_report")) +
            _details("Saved water designations", source.get("water_designations")) +
            _details("Receptor profile and source", {"specification": source.get("receptor_spec"),
                    "profile_source": source.get("receptor_profile_source"),
                    "resolved_network": source.get("resolved_receptor_network")}) +
            _details("Original source roles and map overlays", {"source_roles": source.get("source_roles"),
                                                               "overlays": source.get("overlays")}) +
            _details("Complete retained source context", source) +
            '</section><section aria-labelledby="files"><h2 id="files">Delivered files</h2>'
            '<p class="muted">These paths are selected by this delivery manifest. Native workspace raster paths in each sheet identify the retained calculation inside the working archive.</p>'
            '<div class="table-wrap"><table><thead><tr><th>Original package member</th><th>Size</th><th>Open / download</th></tr></thead>'
            '<tbody>' + "".join(file_rows) + "</tbody></table></div></section></main>"
            '<footer>Atlas renderer ' + _text(atlas["version"]) +
            ' · The original PDF legends and recorded units accompany each map. Filtering changes the visible index only.</footer>'
            "<script>" + SCRIPT + "</script></body></html>")


def write(directory, state, manifest):
    """Add a stable offline browser to the captured artifact list and file state."""
    directory = Path(directory)
    target = directory / BROWSER_PATH
    assets = manifest.setdefault("project_assets", [])
    if BROWSER_PATH not in assets:
        assets.append(BROWSER_PATH)
    # Include this page in the index on the first render, but never its own
    # previous checksum: self-reference would alter every resumed capture.
    rendered_state = {**state, "files": {
        name: item for name, item in state.get("files", {}).items()
        if name != BROWSER_KEY and item.get("path") != BROWSER_PATH}}
    atomic_bytes(target, render(rendered_state, manifest).encode("utf-8"))
    state["files"][BROWSER_KEY] = describe_file(directory, target, title="Offline map atlas browser")
    return state["files"][BROWSER_KEY]
