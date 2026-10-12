"""MIT. Official ClinicalTrials.gov v2 requests and whole-study source values."""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urljoin, urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler

from clinical_shared import HERE, InputError, load_json, source_json

BASE = "https://clinicaltrials.gov/api/v2"
MAX_RESPONSE = 64 * 1024 * 1024
NCT = re.compile(r"NCT[0-9]{8}\Z")
CONTRACT = load_json((HERE / "contracts" / "api-contract.json").read_bytes())
PARAMETERS = {item["name"]: item for item in CONTRACT["parameters"]}
MANAGED = {"format", "fields", "countTotal", "pageSize", "pageToken", "markupFormat"}
KEEP_HEADERS = {"date", "etag", "last-modified", "content-type", "content-length", "retry-after"}

def now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")

def sha(data):
    return hashlib.sha256(data).hexdigest()

def text(value, name, maximum=8192, empty=False):
    if not isinstance(value, str) or len(value) > maximum or "\0" in value or (not empty and not value.strip()):
        raise InputError(name + " must be text within its documented size limit")
    return value

def parse_document(data, maximum=MAX_RESPONSE):
    """Use the original NDJSON numeric, duplicate-member, Unicode and depth rules."""
    if len(data) > maximum:
        raise InputError("Original JSON response exceeds the selected page size; reduce pageSize")
    try:
        value = json.loads(data.decode("utf-8"), parse_int=source_json.JsonNumber,
                           parse_float=source_json.JsonNumber,
                           parse_constant=source_json._constant, object_pairs_hook=source_json._pairs)
        source_json._validate_tree(value)
        return value
    except (UnicodeError, json.JSONDecodeError, RecursionError) as error:
        raise InputError("Original response is not a complete UTF-8 JSON document") from error

def config(raw):
    if not isinstance(raw, dict) or set(raw) - {"name", "query", "pageSize", "markupFormat", "maxStudies", "maxBytes"}:
        raise InputError("Configure name, query, pageSize, markupFormat, maxStudies and maxBytes")
    name = text(raw.get("name", "ClinicalTrials cohort"), "Cohort name", 160)
    query = raw.get("query", {})
    if not isinstance(query, dict) or set(query) - (set(PARAMETERS) - MANAGED):
        raise InputError("Use a documented ClinicalTrials search/filter parameter; full source fields and paging are managed by the capture")
    result = {}
    for key, value in query.items():
        value = text(value, key, empty=True)
        if not value.strip():
            continue
        definition = PARAMETERS[key]["schema"]
        if definition.get("type") == "array":
            pieces = re.split(r"[,|]", value)
            if any(not part.strip() for part in pieces) or len(pieces) > definition.get("maxItems", 100000):
                raise InputError("Invalid list for " + key)
            item = definition.get("items", {})
            pattern = item.get("pattern")
            if pattern and any(not re.fullmatch(pattern, part.strip()) for part in pieces):
                raise InputError("Invalid value for " + key)
            if item.get("$ref", "").endswith("/Status") and any(part.strip() not in CONTRACT["statuses"] for part in pieces):
                raise InputError("Use a documented registry status")
            if key == "sort" and any(part.strip().split(":")[0] == "NCTId" for part in pieces):
                raise InputError("ClinicalTrials sorts date/numeric fields or @relevance; NCTId is not a supported sort field")
        elif definition.get("pattern") and not re.fullmatch(definition["pattern"], value):
            raise InputError("Invalid provider expression for " + key)
        result[key] = value
    size = raw.get("pageSize", 100)
    maximum = raw.get("maxStudies", 100000)
    max_bytes = raw.get("maxBytes", 256 * 1024 * 1024)
    if type(size) is not int or not 1 <= size <= 1000:
        raise InputError("Choose a pageSize from 1 to 1000")
    if type(maximum) is not int or not 1 <= maximum <= 1000000:
        raise InputError("Choose a maxStudies from 1 to 1000000")
    if type(max_bytes) is not int or not 1024 <= max_bytes <= 256 * 1024 * 1024:
        raise InputError("Choose a retained raw-source maxBytes from 1024 to 268435456")
    markup = raw.get("markupFormat", "markdown")
    if markup not in {"markdown", "legacy"}:
        raise InputError("Choose markdown or legacy markup")
    warnings = []
    if any(k.startswith("query.") and re.fullmatch(r"[Nn][Cc][Tt][0-9]+(?:[ ,]+[Nn][Cc][Tt][0-9]+)*", v.strip()) for k,v in result.items()):
        warnings.append("A query containing only NCT IDs causes ClinicalTrials.gov to ignore filters. Review the actual returned cohort.")
    return {"name": name, "query": result, "pageSize": size, "markupFormat": markup,
            "maxStudies": maximum, "maxBytes": max_bytes, "warnings": warnings}

def study_url(configuration, page_token=None, count_total=False):
    query = {**configuration["query"], "format": "json", "markupFormat": configuration["markupFormat"],
             "pageSize": str(configuration["pageSize"])}
    if page_token is not None:
        query["pageToken"] = text(page_token, "Original page token", 65536)
    if count_total:
        query["countTotal"] = "true"
    return BASE + "/studies?" + urlencode(query)

class ProviderError(InputError):
    def __init__(self, message, receipt=None, body=None):
        super().__init__(message)
        self.receipt, self.body = receipt, body

class RegistryRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        target = urljoin(req.full_url, newurl)
        parsed = urlsplit(target)
        if parsed.scheme != "https" or parsed.netloc != "clinicaltrials.gov" or not parsed.path.startswith("/api/v2/"):
            raise ProviderError("Registry redirected outside its original API; review the retained response")
        return super().redirect_request(req, fp, code, msg, headers, target)

def request(url, timeout=90, maximum=MAX_RESPONSE):
    parsed = urlsplit(url)
    if parsed.scheme != "https" or parsed.netloc != "clinicaltrials.gov" or not parsed.path.startswith("/api/v2/"):
        raise InputError("Use the original ClinicalTrials.gov v2 API")
    start = now()
    req = Request(url, headers={"Accept": "application/json", "Accept-Encoding": "identity",
                              "User-Agent": "Starforge-ClinicalTrials/1.0 (retained-registry-client)"})
    receipt = {"method": "GET", "url": url, "requestedAt": start}
    try:
        try:
            response = build_opener(RegistryRedirects()).open(req, timeout=timeout)
        except HTTPError as error:
            response = error
        with response:
            body = response.read(maximum + 1)
            receipt.update(status=response.status, finalUrl=response.url, receivedAt=now(),
                           headers={k.lower():v for k,v in response.headers.items() if k.lower() in KEEP_HEADERS},
                           bytes=len(body), sha256=sha(body))
        if len(body) > maximum:
            raise ProviderError("Registry page exceeds the selected response limit; use a smaller pageSize", receipt, body)
        if receipt["status"] != 200:
            retry = receipt["headers"].get("retry-after")
            raise ProviderError("ClinicalTrials.gov returned HTTP " + str(receipt["status"]) +
                                (". Retry-After: " + retry if retry else ""), receipt, body)
        return body, receipt
    except ProviderError:
        raise
    except (URLError, TimeoutError, OSError) as error:
        receipt.update(receivedAt=now(), error=type(error).__name__)
        raise ProviderError("The registry request did not complete. Its original cursor remains retained; resume after connectivity returns.",
                            receipt) from error

def version(body):
    value = parse_document(body, 65536)
    if not isinstance(value, dict) or not isinstance(value.get("apiVersion"), str):
        raise InputError("Registry version response is missing apiVersion")
    if not re.fullmatch(r"2\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?", value["apiVersion"]):
        raise InputError("This workspace uses the retained ClinicalTrials v2 contract")
    stamp = value.get("dataTimestamp")
    if not isinstance(stamp, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}", stamp):
        raise InputError("Registry dataTimestamp is required to bind one captured data edition")
    return {"apiVersion": value["apiVersion"], "dataTimestamp": stamp, "timezone": "UTC"}

def selected(value, path, default=None):
    for part in path:
        if not isinstance(value, dict) or part not in value:
            return default
        value = value[part]
    return value

def summary(study):
    if not isinstance(study, dict):
        raise InputError("Every returned study must be a JSON object")
    protocol = study.get("protocolSection", {})
    ident = selected(protocol, ["identificationModule","nctId"])
    if not isinstance(ident, str) or not NCT.fullmatch(ident):
        raise InputError("Each whole study requires its exact NCT identifier")
    return {"nctId": ident, "title": selected(protocol, ["identificationModule","briefTitle"]),
            "status": selected(protocol, ["statusModule","overallStatus"]),
            "lastUpdate": selected(protocol, ["statusModule","lastUpdatePostDateStruct","date"]),
            "sponsor": selected(protocol, ["sponsorCollaboratorsModule","leadSponsor","name"]),
            "studyType": selected(protocol, ["designModule","studyType"]),
            "hasResults": study.get("hasResults"),
            "modules": {name: sorted(value) for name,value in study.items() if isinstance(value, dict)}}

def page(body):
    value = parse_document(body)
    if not isinstance(value, dict) or not isinstance(value.get("studies"), list):
        raise InputError("Expected the original paged studies response")
    token = value.get("nextPageToken")
    if token is not None:
        text(token, "Original nextPageToken", 65536)
    total = value.get("totalCount")
    if total is not None:
        if not isinstance(total, source_json.JsonNumber) or not re.fullmatch(r"[0-9]+", total):
            raise InputError("Original totalCount must be an exact nonnegative integer")
        total = int(total)
    studies = []
    for study in value["studies"]:
        brief = summary(study)
        raw = (source_json.exact_json(study) + "\n").encode()
        if len(raw) > source_json.MAX_RECORD:
            raise InputError("A whole study exceeds the original 16 MiB NDJSON record limit")
        studies.append((brief, raw))
    return studies, token, total

def field_changes(before, after):
    """Full original nested values, keyed by the NCT study rather than row position."""
    absent = object()
    def visit(left, right, path):
        if left is absent or right is absent:
            yield {"path": path, "kind": "added" if left is absent else "removed",
                   "before": None if left is absent else source_json.exact_json(left),
                   "after": None if right is absent else source_json.exact_json(right)}
        elif isinstance(left, dict) and isinstance(right, dict):
            for key in sorted(set(left) | set(right)):
                yield from visit(left.get(key, absent), right.get(key, absent), [*path,key])
        elif isinstance(left, list) and isinstance(right, list):
            for i in range(max(len(left),len(right))):
                yield from visit(left[i] if i<len(left) else absent, right[i] if i<len(right) else absent, [*path,i])
        elif source_json.exact_json(left) != source_json.exact_json(right):
            yield {"path":path,"kind":"changed","before":source_json.exact_json(left),"after":source_json.exact_json(right)}
    return list(visit(before, after, []))

def default_mapping(name="Registry review"):
    columns = []
    def scalar(name, path, kind="string", optional=False):
        columns.append({"name":name,"path":path,"mode":"scalar","type":kind,
                        "nullable":optional,"missing":"null" if optional else "error"})
        if optional:
            columns.append({"name":name+"_state","path":path,"mode":"state","type":"string",
                            "nullable":False,"missing":"error"})
    p=["protocolSection"]
    scalar("nct_id",p+["identificationModule","nctId"])
    scalar("title",p+["identificationModule","briefTitle"])
    scalar("status",p+["statusModule","overallStatus"],optional=True)
    scalar("lead_sponsor",p+["sponsorCollaboratorsModule","leadSponsor","name"],optional=True)
    scalar("study_type",p+["designModule","studyType"],optional=True)
    scalar("last_update",p+["statusModule","lastUpdatePostDateStruct","date"],optional=True)
    scalar("enrollment",p+["designModule","enrollmentInfo","count"],kind="integer",optional=True)
    scalar("has_results",["hasResults"],kind="boolean",optional=True)
    return source_json.validate_plan({"schema":source_json.SCHEMA,"name":name,"recordPath":[],
        "columns":columns,"keys":["nct_id"],"filters":["status","lead_sponsor","study_type","has_results"],
        "ranges":["last_update","enrollment"],"sorts":["nct_id","last_update","enrollment"],
        "maxRows":1000000,"maxBytes":268435456,"maxCellChars":65536,"defaultLimit":50,"maxLimit":250})


def pretty_json(value,level=0):
    """Display the original parsed values without converting numeric lexemes."""
    if isinstance(value,dict):
        if not value:return "{}"
        return "{\n"+",\n".join("  "*(level+1)+source_json.exact_json(k)+": "+pretty_json(v,level+1)
                               for k,v in value.items())+"\n"+"  "*level+"}"
    if isinstance(value,list):
        if not value:return "[]"
        return "[\n"+",\n".join("  "*(level+1)+pretty_json(v,level+1) for v in value)+"\n"+"  "*level+"]"
    return source_json.exact_json(value)
