"""MIT. Explicit GLEIF research handover through the original Monitoring portfolio."""
from __future__ import annotations
import base64
import io
import json
import re
import time
from model import InputError, MAX_SOURCE, MONITORING_DEFAULT, exact_id, ftm_entity, json_bytes, sha, text

SCHEMA = "stellar-forge.gleif-monitoring-portfolio.v1"
MAPPING = "gleif-legalentity-20261013-v1"
PROJECT = "stellar-forge.gleif-research.v1"
FIELDS = ("aliases", "registrationNumber", "entityStatus", "addresses")
FILES = ("portfolio.ftm.json", "mapping.json", "gleif-project.json", "research-report.json",
         "research-report.html", "entities.csv", "entities.spreadsheet.csv", "original-records.jsonl")

def _json(raw):
    def pairs(rows):
        result = {}
        for key, value in rows:
            if key in result:
                raise InputError("The handover has repeated JSON keys")
            result[key] = value
        return result
    try:
        return json.loads(raw, object_pairs_hook=pairs,
                          parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))
    except (ValueError, UnicodeError, TypeError) as error:
        raise InputError("The retained handover JSON is invalid") from error

def _require(condition, message):
    if not condition:
        raise InputError(message)

def _same_resource(left, right):
    # Original GLEIF reader uses JSON.parse; compare number values under its IEEE-754 semantics.
    # The complete original response bytes remain separate, unchanged and hash verified.
    if type(left) is bool or type(right) is bool:
        return type(left) is type(right) and left == right
    if isinstance(left, (int, float)) and isinstance(right, (int, float)):
        return float(left) == float(right)
    if isinstance(left, dict) and isinstance(right, dict):
        return left.keys() == right.keys() and all(_same_resource(left[key], right[key]) for key in left)
    if isinstance(left, list) and isinstance(right, list):
        return len(left) == len(right) and all(_same_resource(a, b) for a, b in zip(left, right))
    return type(left) is type(right) and left == right

def _unique(values):
    return list(dict.fromkeys(value for value in values if isinstance(value, str) and value.strip()))

def _address(value):
    value = value if isinstance(value, dict) else {}
    lines = value.get("addressLines", [])
    return ", ".join(_unique([value.get("mailRouting"), *(lines if isinstance(lines, list) else []),
        value.get("city"), value.get("region"), value.get("postalCode"), value.get("country")]))

def _entity(resource, fields):
    entity = resource.get("attributes", {}).get("entity", {})
    lei, name = resource.get("id"), entity.get("legalName", {}).get("name")
    _require(resource.get("type") == "lei-records" and isinstance(lei, str) and
             re.fullmatch(r"[A-Z0-9]{20}", lei) and isinstance(name, str) and name.strip(),
             "A selected original legal-entity record is missing")
    properties = {"name": [name], "leiCode": [lei]}
    if "aliases" in fields:
        names = [row for field in ("otherNames", "transliteratedOtherNames")
                 for row in (entity.get(field) if isinstance(entity.get(field), list) else [])
                 if isinstance(row, dict)]
        aliases = [name_ for name_ in _unique(row.get("name") for row in names
                   if row.get("type") != "PREVIOUS_LEGAL_NAME") if name_ != name]
        previous = [name_ for name_ in _unique(row.get("name") for row in names
                    if row.get("type") == "PREVIOUS_LEGAL_NAME") if name_ != name]
        if aliases:
            properties["alias"] = aliases
        if previous:
            properties["previousName"] = previous
    if "registrationNumber" in fields and isinstance(entity.get("registeredAs"), str) and entity["registeredAs"].strip():
        properties["registrationNumber"] = [entity["registeredAs"]]
    if "entityStatus" in fields and entity.get("status") in ("ACTIVE", "INACTIVE"):
        properties["status"] = [entity["status"]]
    if "addresses" in fields:
        addresses = _unique([_address(entity.get("legalAddress")), _address(entity.get("headquartersAddress"))])
        if addresses:
            properties["address"] = addresses
    return ftm_entity({"id": "gleif:" + lei, "schema": "LegalEntity", "caption": name, "properties": properties})

def inspect_bytes(raw):
    """Verify exact source, project, selected review and projected portfolio before intake."""
    _require(len(raw) <= MAX_SOURCE, "The complete handover exceeds the original 256 MiB object limit")
    packet = _json(raw)
    _require(isinstance(packet, dict) and packet.get("schema") == SCHEMA and
             isinstance(packet.get("manifestText"), str), "Select the complete GLEIF Monitoring handover")
    manifest_raw = packet["manifestText"].encode("utf-8")
    _require(sha(manifest_raw) == packet.get("id"), "The original handover manifest changed")
    manifest = _json(manifest_raw)
    _require(manifest.get("schema") == SCHEMA and manifest.get("mappingVersion") == MAPPING and
             isinstance(packet.get("files"), list), "The source mapping edition is unsupported")
    files, descriptors = {}, {}
    for item in packet["files"]:
        name = item.get("name")
        _require(name in FILES and name not in files and type(item.get("bytes")) is int and
                 0 <= item["bytes"] <= MAX_SOURCE and isinstance(item.get("base64"), str),
                 "The handover file inventory is invalid")
        try:
            content = base64.b64decode(item["base64"], validate=True)
        except ValueError as error:
            raise InputError("A handover file is not complete base64") from error
        _require(base64.b64encode(content).decode() == item["base64"] and len(content) == item["bytes"] and
                 sha(content) == item.get("sha256"), "A handover file differs from its original bytes")
        files[name] = content
        descriptors[name] = {key: item[key] for key in ("name", "bytes", "sha256")}
    _require(set(files) == set(FILES) and manifest.get("files") == [descriptors[name] for name in FILES],
             "The complete ordered handover inventory differs")
    mapping = _json(files["mapping.json"])
    _require(mapping.get("schema") == SCHEMA and mapping.get("mappingVersion") == MAPPING and
             mapping.get("workspaceId") == manifest.get("workspaceId") and
             mapping.get("operationId") == manifest.get("operationId") and
             mapping.get("createdAt") == manifest.get("createdAt") and
             mapping.get("previewSha256") == manifest.get("previewSha256"),
             "The mapping is not bound to this original research operation")
    options = mapping.get("options", {})
    fields = options.get("fields")
    _require(isinstance(fields, list) and fields == [field for field in FIELDS if field in fields] and
             options.get("portfolioKey") == manifest.get("portfolioKey") and
             options.get("title") == manifest.get("title"), "The explicit field or portfolio choices changed")
    text(options.get("portfolioKey"), "Portfolio key", 128)
    _require(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}", options["portfolioKey"]), "The stable portfolio key is invalid")
    text(options.get("title"), "Portfolio title", 160)
    # This is the original native package format, with one deterministic wire layout.
    project_raw = files["gleif-project.json"]
    project = _json(project_raw)
    project_sha = exact_id(project.get("sha256"))
    suffix = (',"sha256":"' + project_sha + '"}\n').encode()
    _require(project_raw.endswith(suffix) and sha(project_raw[:-len(suffix)] + b"}") == project_sha,
             "The original editable GLEIF project identity differs")
    declared = mapping.get("originalProject", {})
    _require(declared == {"wire": "canonical-body-sha256-last/v1", **descriptors["gleif-project.json"]},
             "The mapping selects a different original research project")
    state = project.get("state", {})
    _require(project.get("schema") == PROJECT + ".package" and project.get("metadata", {}).get("schema") == PROJECT and
             state.get("schema") == PROJECT + ".state" and state.get("workspaceId") == manifest.get("workspaceId") ==
             project.get("metadata", {}).get("id"), "The original project identity or state is incomplete")
    for collection in ("captures", "reviews", "reports", "datasets", "operations"):
        _require(isinstance(state.get(collection), list), "The original editable research history is incomplete")
    objects = {}
    for item in project.get("objects", []):
        ident = exact_id(item.get("sha256"))
        _require(ident not in objects and type(item.get("bytes")) is int and 0 <= item["bytes"] <= MAX_SOURCE,
                 "The original project has repeated or invalid objects")
        try:
            data = base64.b64decode(item.get("base64", ""), validate=True)
        except ValueError as error:
            raise InputError("An original project object is incomplete") from error
        _require(len(data) == item["bytes"] and sha(data) == ident and
                 base64.b64encode(data).decode() == item["base64"], "An original research object changed")
        objects[ident] = data
    required = set()
    for capture_ in state["captures"]:
        for entry in capture_.get("attempts", []):
            _require(len(objects.get(entry.get("sha256"), b"")) == entry.get("bytes") and entry.get("sha256") in objects,
                     "An original source response is absent")
            required.add(entry["sha256"])
    for retained in [*state["reports"], *state["datasets"]]:
        for entry in retained.get("files", []):
            _require(entry.get("sha256") in objects and len(objects[entry["sha256"]]) == entry.get("bytes"),
                     "An original report or dataset file is absent")
            required.add(entry["sha256"])
    for operation in state["operations"]:
        if operation.get("originalProject"):
            entry = operation["originalProject"]
            _require(operation.get("action") == "monitoring.prepare" and entry.get("sha256") in objects and
                     len(objects[entry["sha256"]]) == entry.get("bytes"), "A retained earlier handover project is absent")
            required.add(entry["sha256"])
    _require(required == set(objects), "The complete editable project object closure differs")
    captures = mapping.get("captureIds")
    _require(isinstance(captures, list) and len(captures) == 1, "Choose one explicit complete research capture")
    candidates = [row for row in state["captures"] if row.get("id") == captures[0]]
    _require(len(candidates) == 1 and candidates[0].get("state") == "COMPLETE" and candidates[0].get("next") is None,
             "The selected research capture is not complete")
    capture = candidates[0]
    resources, pages = {}, {}
    for page in capture.get("pages", []):
        data = objects.get(page.get("sha256"))
        _require(data is not None and len(data) == page.get("bytes"), "A selected source page is missing")
        response = _json(data)
        _require(isinstance(response.get("data"), list), "The original GLEIF page is invalid")
        for resource in response["data"]:
            lei = resource.get("id")
            _require(lei not in resources, "The selected original capture repeats an LEI")
            resources[lei], pages[lei] = resource, page
    selected_reviews = {}
    for review in state["reviews"]:
        if review.get("captureId") == captures[0]:
            selected_reviews[review.get("lei")] = review
    frozen_reviews = [{"id": review["id"], "version": review["version"], "captureId": review["captureId"],
                      "lei": review["lei"], "resourceSha256": review["resourceSha256"]}
                     for review in selected_reviews.values()]
    _require(mapping.get("reviews") == frozen_reviews, "The handover does not retain the selected original review versions")
    original_rows = [_json(line) for line in files["original-records.jsonl"].splitlines() if line.strip()]
    ftm_rows = [_json(line) for line in files["portfolio.ftm.json"].splitlines() if line.strip()]
    bindings = mapping.get("records")
    _require(isinstance(bindings, list) and len(bindings) == len(original_rows) == len(ftm_rows) == manifest.get("count") and
             len(bindings) > 0, "The complete selected company population differs")
    expected_leis, seen = [], set()
    scope = mapping.get("selection")
    _require(scope in ("all", "included"), "The original research selection is invalid")
    for lei in resources:
        review = selected_reviews.get(lei)
        if scope == "all" or review and review.get("decision") == "include" and _same_resource(review.get("originalResource"), resources[lei]):
            expected_leis.append(lei)
    for binding, original, projected in zip(bindings, original_rows, ftm_rows):
        lei = binding.get("lei")
        resource = original.get("originalResource")
        resource_text = original.get("resourceText")
        _require(lei in resources and lei not in seen and _same_resource(resource, resources[lei]) and
                 isinstance(resource_text, str) and _json(resource_text) == resource and
                 sha(resource_text.encode()) == binding.get("resourceSha256") and
                 binding.get("captureId") == captures[0] and binding.get("sourcePage") == pages[lei] and
                 original.get("binding") == binding, "A selected entity lost its original source binding")
        if scope == "included":
            _require(selected_reviews.get(lei, {}).get("resourceSha256") == binding["resourceSha256"],
                     "The included review belongs to a different source resource")
        expected = _entity(resource, fields)
        _require(projected == expected == original.get("projected") and binding.get("counterpartyId") == expected["id"],
                 "The FtM portfolio differs from the explicitly reviewed original field mapping")
        seen.add(lei)
    _require([row["lei"] for row in bindings] == expected_leis and mapping.get("entities") == ftm_rows,
             "The handover omits or reorders the original selected companies")
    return {"manifest": manifest, "mapping": mapping, "files": files, "descriptors": descriptors,
            "handoverId": packet["id"], "projectSha256": project_sha, "entities": ftm_rows}

def _read(domain, original):
    ident = exact_id(original)
    return inspect_bytes(domain.object_path(ident).read_bytes())

def preview(domain, original, *, offset=0, limit=50):
    if type(offset) is not int or offset < 0 or type(limit) is not int or not 1 <= limit <= 250:
        raise InputError("Choose an original company page of 1–250 records")
    checked = _read(domain, original)
    manifest, mapping = checked["manifest"], checked["mapping"]
    basis = {"schema": SCHEMA + ".intake", "original": original, "handoverId": checked["handoverId"],
             "projectSha256": checked["projectSha256"], "portfolioKey": manifest["portfolioKey"],
             "title": manifest["title"], "count": manifest["count"], "mappingVersion": MAPPING,
             "sourcePreviewSha256": manifest["previewSha256"]}
    rows = checked["entities"][offset:offset + limit]
    return {**basis, "previewSha256": sha(json_bytes(basis)), "workspace": str(domain.ws.root),
            "captureIds": mapping["captureIds"], "fields": mapping["options"]["fields"],
            "researchWorkspaceId": manifest["workspaceId"], "rows": rows, "offset": offset,
            "nextOffset": offset + len(rows) if offset + len(rows) < manifest["count"] else None,
            "files": manifest["files"], "interpretation": mapping["interpretation"],
            "monitoringDefaults": {**MONITORING_DEFAULT,
                "resolutionProperties": [*MONITORING_DEFAULT["resolutionProperties"], "leiCode"]}}

def receive(domain, request):
    """Replay the same explicit request; no matching, dispatch or decision is performed."""
    if not isinstance(request, dict):
        raise InputError("Provide the original reviewed intake request")
    request_id = text(request.get("requestId"), "Original intake request ID", 128)
    reviewer = text(request.get("reviewer"), "Receiving reviewer", 160)
    note = text(request.get("note", ""), "Receiving note", 4000, blank=True)
    original = exact_id(request.get("original"))
    expected = exact_id(request.get("expectedPreviewSha256"))
    request_body = {"requestId": request_id, "original": original, "expectedPreviewSha256": expected,
                    "reviewer": reviewer, "note": note}
    request_sha = sha(json_bytes(request_body))
    with domain.mutex:
        # One immutable receipt in the original domain database; portfolio editions stay immutable.
        receipt_id = sha(json_bytes({"kind": SCHEMA + ".intake", "requestId": request_id}))
        prior = domain.db.execute("SELECT body FROM os_research_intakes WHERE id=?", (receipt_id,)).fetchone()
        if prior:
            retained = _json(prior[0])
            _require(retained.get("requestSha256") == request_sha, "Continue this intake request with its original exact fields")
            verify_receipt(domain, retained)
            return {"portfolio": domain._one("portfolios", retained["portfolioId"]), "receipt": retained, "replayed": True}
        current = preview(domain, original)
        _require(current["previewSha256"] == expected, "Review the exact current handover before receiving")
        checked = _read(domain, original)
        objects = {}
        for name, data in checked["files"].items():
            media = "application/json" if name.endswith(".json") else "text/html" if name.endswith(".html") else "text/plain"
            objects[name] = domain.put_object(io.BytesIO(data), name, media,
                {"kind": SCHEMA, "handoverId": checked["handoverId"], "original": original})["id"]
        portfolio = domain.accept_portfolio(io.BytesIO(checked["files"]["portfolio.ftm.json"]),
            key=current["portfolioKey"], label=current["title"])
        receipt = {"id": receipt_id, "schema": SCHEMA + ".receipt", **request_body, "requestSha256": request_sha,
            "handoverId": checked["handoverId"], "researchWorkspaceId": current["researchWorkspaceId"],
            "projectSha256": checked["projectSha256"], "captureIds": current["captureIds"],
            "files": objects, "receivedAt": time.time(), "portfolioId": portfolio["id"]}
        with domain.db:
            domain._put("research_intakes", receipt)
        return {"portfolio": portfolio, "receipt": receipt, "replayed": False}

def verify_receipt(domain, receipt):
    """Called inside the original export/receive transaction; no source or portfolio mutation."""
    _require(receipt.get("schema") == SCHEMA + ".receipt" and
             receipt.get("id") == sha(json_bytes({"kind": SCHEMA + ".intake", "requestId": receipt.get("requestId")})),
             "The original research custody identity differs")
    request = {key: receipt.get(key) for key in ("requestId", "original", "expectedPreviewSha256", "reviewer", "note")}
    _require(sha(json_bytes(request)) == receipt.get("requestSha256"), "The original intake request changed")
    checked = _read(domain, receipt["original"])
    manifest = checked["manifest"]
    portfolio = domain._one("portfolios", receipt["portfolioId"])
    current = preview(domain, receipt["original"])
    _require(receipt.get("expectedPreviewSha256") == current["previewSha256"] and
             receipt.get("handoverId") == checked["handoverId"] and
             receipt.get("projectSha256") == checked["projectSha256"] and
             receipt.get("researchWorkspaceId") == manifest["workspaceId"] and
             receipt.get("captureIds") == checked["mapping"]["captureIds"] and
             portfolio["key"] == manifest["portfolioKey"] and
             portfolio["source"] == sha(checked["files"]["portfolio.ftm.json"]) and
             set(receipt.get("files", {})) == set(FILES), "The original research portfolio binding differs")
    for name, raw in checked["files"].items():
        _require(receipt["files"][name] == sha(raw) and domain.object_path(receipt["files"][name]).read_bytes() == raw,
                 "An editable research project or report attachment is missing")
    return True

def verify_all(domain):
    for row in domain.db.execute("SELECT body FROM os_research_intakes ORDER BY rowid"):
        verify_receipt(domain, _json(row[0]))

def operation(domain, request_id):
    request_id = text(request_id, "Original intake request ID", 128)
    ident = sha(json_bytes({"kind": SCHEMA + ".intake", "requestId": request_id}))
    with domain.mutex:
        row = domain.db.execute("SELECT body FROM os_research_intakes WHERE id=?", (ident,)).fetchone()
        if row is None:
            return {"requestId": request_id, "committed": False}
        receipt = _json(row[0])
        verify_receipt(domain, receipt)
        return {"requestId": request_id, "committed": True, "receipt": receipt,
                "portfolio": domain._one("portfolios", receipt["portfolioId"])}
