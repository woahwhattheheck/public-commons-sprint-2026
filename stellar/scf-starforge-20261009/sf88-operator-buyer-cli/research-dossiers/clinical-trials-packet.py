"""MIT. Read the original ClinicalTrials portable packet for Research dossier receiving.
No provider request, publisher, workspace lease, projection build or posting action runs here.
"""
from __future__ import annotations
import argparse
import base64
from decimal import Decimal
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import sys
from urllib.parse import urlsplit, parse_qsl
import zipfile

PACKET = "stellar-forge.clinicaltrials-packet.v1"
PROVIDER = "clinicaltrials-gov"
ORIGIN = "https://clinicaltrials.gov"
MAX_PACKET = 128 * 1024 * 1024
MAX_TOTAL = 2 * 1024 * 1024 * 1024
MAX_EDITION = 64 * 1024 * 1024
SHA = re.compile(r"[a-f0-9]{64}\Z")
NCT = re.compile(r"NCT[0-9]{8}\Z")


def need(condition, code):
    if not condition:
        raise ValueError(code)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def pairs(values):
    result = {}
    for key, value in values:
        need(key not in result, "CLINICALTRIALS_DUPLICATE_JSON_KEY")
        result[key] = value
    return result


def document(data, exact=False):
    text = data.decode("utf-8-sig", errors="strict")
    return json.loads(text, object_pairs_hook=pairs,
                      parse_float=Decimal if exact else float,
                      parse_int=Decimal if exact else int,
                      parse_constant=lambda value: need(False, "CLINICALTRIALS_JSON_NUMBER_INVALID"))


def lexical(value):
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, list):
        return [lexical(item) for item in value]
    if isinstance(value, dict):
        return {key: lexical(item) for key, item in value.items()}
    return value


def name(value):
    need(isinstance(value, str) and value and "\\" not in value and "\0" not in value,
         "CLINICALTRIALS_PACKET_PATH_INVALID")
    parsed = PurePosixPath(value)
    need(not parsed.is_absolute() and str(parsed) == value and
         all(part not in {".", ".."} for part in parsed.parts),
         "CLINICALTRIALS_PACKET_PATH_INVALID")
    return value


def typed(value):
    if isinstance(value, Decimal):
        return ["number", str(value)]
    if isinstance(value, dict):
        return ["object", [[key, typed(value[key])] for key in sorted(value)]]
    if isinstance(value, list):
        return ["array", [typed(item) for item in value]]
    return [type(value).__name__, value]


def selected(value, *keys):
    for key in keys:
        if not isinstance(value, dict):
            return None
        value = value.get(key)
    return value


class Packet:
    def __init__(self, path, expected):
        need(SHA.fullmatch(expected or "") is not None, "CLINICALTRIALS_PACKET_SHA_REQUIRED")
        self.path = Path(path)
        flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
        self.file = os.fdopen(os.open(self.path, flags), "rb")
        try:
            self.stat = os.fstat(self.file.fileno())
            need(stat.S_ISREG(self.stat.st_mode) and 0 < self.stat.st_size <= MAX_PACKET,
                 "CLINICALTRIALS_PACKET_SIZE_INVALID")
            self.sha = expected
            hashed = hashlib.sha256()
            while chunk := self.file.read(1024 * 1024):
                hashed.update(chunk)
            need(hashed.hexdigest() == expected, "CLINICALTRIALS_PACKET_CHANGED")
            self.file.seek(0)
            self.archive = zipfile.ZipFile(self.file)
            entries = self.archive.infolist()
            need(0 < len(entries) <= 20001, "CLINICALTRIALS_PACKET_MEMBER_LIMIT")
            self.entries = {}
            total = 0
            for entry in entries:
                member = name(entry.filename)
                need(member not in self.entries and not entry.is_dir() and not entry.flag_bits & 1,
                     "CLINICALTRIALS_PACKET_MEMBER_INVALID")
                mode = entry.external_attr >> 16
                need(not stat.S_IFMT(mode) or stat.S_ISREG(mode),
                     "CLINICALTRIALS_PACKET_SPECIAL_MEMBER")
                need(entry.compress_type in {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED} and
                     0 <= entry.file_size <= 512 * 1024 * 1024,
                     "CLINICALTRIALS_PACKET_MEMBER_SIZE")
                total += entry.file_size
                need(total <= MAX_TOTAL + 8 * 1024 * 1024, "CLINICALTRIALS_PACKET_TOTAL_LIMIT")
                self.entries[member] = entry
            need("manifest.json" in self.entries, "CLINICALTRIALS_PACKET_MANIFEST_REQUIRED")
            self.manifest_bytes = self.read("manifest.json", 8 * 1024 * 1024)
            self.manifest = document(self.manifest_bytes)
            need(isinstance(self.manifest, dict) and self.manifest.get("schema") == PACKET and
                 self.manifest.get("application") == "stellar-forge.clinicaltrials-workspace.v1" and
                 isinstance(self.manifest.get("files"), dict) and
                 isinstance(self.manifest.get("captures"), list),
                 "CLINICALTRIALS_ORIGINAL_PACKET_REQUIRED")
            declared = self.manifest["files"]
            need(set(declared) | {"manifest.json"} == set(self.entries),
                 "CLINICALTRIALS_PACKET_UNDECLARED_MEMBER")
            for member, expected_info in declared.items():
                name(member)
                need(isinstance(expected_info, dict) and type(expected_info.get("bytes")) is int and
                     SHA.fullmatch(expected_info.get("sha256", "")) is not None and
                     expected_info["bytes"] == self.entries[member].file_size,
                     "CLINICALTRIALS_PACKET_FILE_DECLARATION_CHANGED")
                hasher = hashlib.sha256()
                with self.archive.open(member) as inp:
                    while chunk := inp.read(1024 * 1024):
                        hasher.update(chunk)
                need(hasher.hexdigest() == expected_info["sha256"],
                     "CLINICALTRIALS_PACKET_MEMBER_CHANGED")
            ids = [capture.get("id") for capture in self.manifest["captures"]]
            need(all(isinstance(value, str) and re.fullmatch(r"capture-[a-f0-9-]{36}", value)
                     for value in ids) and len(set(ids)) == len(ids),
                 "CLINICALTRIALS_CAPTURE_ID_INVALID")
            self.unchanged()
        except BaseException:
            self.file.close()
            raise

    def read(self, member, maximum=MAX_EDITION):
        member = name(member)
        need(member in self.entries and self.entries[member].file_size <= maximum,
             "CLINICALTRIALS_SELECTED_MEMBER_SIZE")
        data = self.archive.read(member)
        need(len(data) == self.entries[member].file_size, "CLINICALTRIALS_MEMBER_TRUNCATED")
        return data

    def verified(self, member, sha, size=None, maximum=MAX_EDITION):
        data = self.read(member, maximum)
        need(digest(data) == sha and (size is None or len(data) == size),
             "CLINICALTRIALS_CAPTURE_FILE_CHANGED")
        return data

    def unchanged(self):
        current = os.fstat(self.file.fileno())
        fields = ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns")
        need(all(getattr(current, field) == getattr(self.stat, field) for field in fields),
             "CLINICALTRIALS_PACKET_CHANGED")

    def close(self):
        try:
            self.unchanged()
        finally:
            self.archive.close()
            self.file.close()

    def capture(self, capture_id):
        found = next((row for row in self.manifest["captures"] if row["id"] == capture_id), None)
        need(found is not None, "CLINICALTRIALS_CAPTURE_NOT_FOUND")
        return found

    def inspect(self):
        keys = ("id", "configuration", "status", "version", "pageCount", "rowCount", "expectedRows",
                "byteCount", "source", "createdAt", "completedAt", "error")
        return {"schema": "stellar-forge.clinicaltrials-research-input.v1",
                "packetSha256": self.sha, "packetBytes": self.stat.st_size,
                "manifestSha256": digest(self.manifest_bytes),
                "originalSchema": PACKET, "createdAt": self.manifest.get("createdAt"),
                "captures": [{key: row.get(key) for key in keys} for row in self.manifest["captures"]],
                "nativeBuilds": self.manifest.get("native", {}).get("builds", []),
                "memberCount": len(self.entries) - 1,
                "uncompressedBytes": sum(row.file_size for key, row in self.entries.items()
                                         if key != "manifest.json")}

    def edition(self, plan):
        need(isinstance(plan, dict) and isinstance(plan.get("question"), str) and
             isinstance(plan.get("label"), str) and isinstance(plan.get("operationId"), str),
             "CLINICALTRIALS_RECEIVING_PLAN_INVALID")
        capture = self.capture(plan.get("captureId"))
        configuration = capture.get("configuration")
        need(isinstance(configuration, dict) and isinstance(configuration.get("query"), dict) and
             isinstance(capture.get("pages"), list), "CLINICALTRIALS_CAPTURE_CONFIGURATION_INVALID")
        results = []
        source_pages = []
        expected_token = None
        raw_bytes = 0
        whole_digest = hashlib.sha256()
        ids = set()
        for index, page in enumerate(capture["pages"]):
            need(page.get("index") == index and page.get("tokenUsed") == expected_token,
                 "CLINICALTRIALS_ORIGINAL_CURSOR_CHANGED")
            url = urlsplit(page.get("url", ""))
            query_pairs = parse_qsl(url.query, keep_blank_values=True)
            need(len(dict(query_pairs)) == len(query_pairs), "CLINICALTRIALS_PAGE_QUERY_DUPLICATE")
            expected_query = {**configuration["query"], "format": "json",
                              "markupFormat": configuration["markupFormat"],
                              "pageSize": str(configuration["pageSize"])}
            if expected_token is not None:
                expected_query["pageToken"] = expected_token
            if index == 0:
                expected_query["countTotal"] = "true"
            need(url.scheme == "https" and url.netloc == "clinicaltrials.gov" and
                 url.path == "/api/v2/studies" and not url.fragment and
                 dict(query_pairs) == expected_query and page.get("finalUrl") == page.get("url") and
                 page.get("status") == 200, "CLINICALTRIALS_ORIGINAL_REQUEST_CHANGED")
            prefix = "registry/" + capture["id"] + "/"
            for field in ("bodyPath", "ndjsonPath", "receiptPath"):
                need(isinstance(page.get(field), str) and page[field].startswith(prefix) and
                     PurePosixPath(page[field]).parent.as_posix() == prefix[:-1],
                     "CLINICALTRIALS_CAPTURE_MEMBER_BINDING_CHANGED")
            raw = self.verified(page["bodyPath"], page["sha256"], page["bytes"])
            receipt = document(self.verified(page["receiptPath"], page["receiptSha256"], maximum=1024 * 1024))
            need(all(receipt.get(key) == page.get(key) for key in receipt),
                 "CLINICALTRIALS_PAGE_RECEIPT_CHANGED")
            parsed = document(raw, exact=True)
            need(isinstance(parsed, dict) and isinstance(parsed.get("studies"), list),
                 "CLINICALTRIALS_WHOLE_STUDIES_REQUIRED")
            expected_token = parsed.get("nextPageToken")
            need(expected_token is None or isinstance(expected_token, str) and expected_token,
                 "CLINICALTRIALS_ORIGINAL_CURSOR_INVALID")
            need(page.get("nextPageToken") == expected_token,
                 "CLINICALTRIALS_ORIGINAL_CURSOR_CHANGED")
            ndjson = self.verified(page["ndjsonPath"], page["ndjsonSha256"])
            whole_digest.update(ndjson)
            lines = ndjson.splitlines(keepends=True)
            need(len(lines) == len(parsed["studies"]) == page["rowCount"],
                 "CLINICALTRIALS_STUDY_COUNT_CHANGED")
            for position, (line, original) in enumerate(zip(lines, parsed["studies"])):
                need(line.endswith(b"\n") and len(line) <= 16 * 1024 * 1024,
                     "CLINICALTRIALS_ORIGINAL_RECORD_INVALID")
                study = document(line, exact=True)
                need(typed(study) == typed(original), "CLINICALTRIALS_PAGE_STUDY_CONTENT_CHANGED")
                nct = selected(study, "protocolSection", "identificationModule", "nctId")
                need(isinstance(nct, str) and NCT.fullmatch(nct),
                     "CLINICALTRIALS_ORIGINAL_STUDY_ID_CHANGED")
                ids.add(nct)
                protocol = study["protocolSection"]
                status = protocol.get("statusModule", {})
                design = protocol.get("designModule", {})
                identity = protocol["identificationModule"]
                raw_text = line.decode("utf-8", errors="strict")
                summary = lexical({
                    "nctId": nct, "title": identity.get("briefTitle", nct),
                    "officialTitle": identity.get("officialTitle"),
                    "studyType": design.get("studyType"), "phases": design.get("phases", []),
                    "status": status.get("overallStatus"), "statusVerifiedDate": status.get("statusVerifiedDate"),
                    "start": status.get("startDateStruct"),
                    "primaryCompletion": status.get("primaryCompletionDateStruct"),
                    "completion": status.get("completionDateStruct"),
                    "lastUpdatePosted": status.get("lastUpdatePostDateStruct"),
                    "resultsFirstPosted": status.get("resultsFirstPostDateStruct"),
                    "enrollment": design.get("enrollmentInfo"),
                    "conditions": selected(protocol, "conditionsModule", "conditions") or [],
                    "interventions": selected(protocol, "armsInterventionsModule", "interventions") or [],
                    "primaryOutcomes": selected(protocol, "outcomesModule", "primaryOutcomes") or [],
                    "sponsor": selected(protocol, "sponsorCollaboratorsModule", "leadSponsor"),
                    "hasResults": study.get("hasResults"),
                    "resultsSections": list(study.get("resultsSection", {})),
                    "recordSha256": digest(line), "recordBytes": len(line),
                    "sectionSha256": {key: digest(json.dumps(typed(value), ensure_ascii=False,
                        separators=(",", ":")).encode()) for key, value in study.items()},
                    "captureId": capture["id"], "pageIndex": index, "pageStudyIndex": position,
                    "pageSha256": page["sha256"], "pageUrl": page["url"],
                    "sourceNumbers": "The full source text retains exact JSON numeric tokens; summary numeric values are displayed as strings."
                })
                results.append({"id": nct, "title": summary["title"], "url": ORIGIN + "/study/" + nct,
                                "content": raw_text, "description": selected(protocol, "descriptionModule", "briefSummary") or "",
                                "publishedAt": selected(status, "lastUpdatePostDateStruct", "date") or "",
                                "metadata": summary})
            raw_bytes += len(raw)
            source_pages.append({key: page.get(key) for key in (
                "index", "url", "finalUrl", "requestedAt", "receivedAt", "status", "sha256", "bytes",
                "rowCount", "tokenUsed", "nextPageToken", "bodyPath", "receiptPath", "receiptSha256",
                "ndjsonPath", "ndjsonSha256")})
            need(index == len(capture["pages"]) - 1 or expected_token is not None,
                 "CLINICALTRIALS_CURSOR_CHAIN_ENDED")
        need(len(results) == capture.get("rowCount") and len(source_pages) == capture.get("pageCount") and
             raw_bytes == capture.get("byteCount") and expected_token == capture.get("nextPageToken"),
             "CLINICALTRIALS_CAPTURE_TOTALS_CHANGED")
        source_sha = whole_digest.hexdigest()
        if capture.get("source") is not None:
            need(capture["source"] == source_sha, "CLINICALTRIALS_ORIGINAL_SOURCE_CHANGED")
            native_source = self.verified("native/sources/" + source_sha + ".ndjson", source_sha)
            need(len(native_source) == sum(row["metadata"]["recordBytes"] for row in results),
                 "CLINICALTRIALS_ORIGINAL_SOURCE_SIZE_CHANGED")
        versions = []
        for request in capture.get("versionRequests", []):
            need(request.get("url") == ORIGIN + "/api/v2/version" and
                 request.get("finalUrl") == request.get("url") and request.get("status") == 200,
                 "CLINICALTRIALS_VERSION_REQUEST_CHANGED")
            body = self.verified(request["bodyPath"], request["sha256"], request["bytes"], 1024 * 1024)
            version_value = document(body)
            need(isinstance(version_value, dict) and isinstance(version_value.get("apiVersion"), str) and
                 isinstance(version_value.get("dataTimestamp"), str), "CLINICALTRIALS_VERSION_VALUE_INVALID")
            versions.append({"request": request, "value": {**version_value, "timezone": "UTC"}})
        complete = capture.get("status") == "completed"
        if complete:
            need(source_pages and expected_token is None and capture.get("source") == source_sha and
                 len(versions) >= 2 and all(row["value"] == capture.get("version") for row in versions) and
                 (capture.get("expectedRows") is None or capture["expectedRows"] == len(results)),
                 "CLINICALTRIALS_COMPLETE_CAPTURE_CHANGED")
        builds = [row for row in self.manifest.get("native", {}).get("builds", [])
                  if row.get("source") == capture.get("source") and capture.get("source")]
        warnings = [
            "Registry entries describe submitted study information. This dossier does not infer efficacy, eligibility, regulatory approval or medical advice.",
            "Equal provider version observations do not establish a transactional registry snapshot.",
            "Dates retain the source precision and ACTUAL/ESTIMATED type. A cohort comparison describes these selected retained captures."
        ]
        if not complete:
            warnings.append("This is a partial retained capture. Original status: " + str(capture.get("status")) +
                            (". " + capture["error"] if capture.get("error") else ""))
        self.file.seek(0)
        encoded_packet = base64.b64encode(self.file.read(MAX_PACKET + 1)).decode("ascii")
        self.unchanged()
        return {
            "schema": "sf88-research-results-v1", "provider": PROVIDER, "success": True,
            "status": "AVAILABLE" if complete else "PARTIAL", "query": plan["question"], "label": plan["label"],
            "sourceTerms": "ClinicalTrials.gov public registry data; source terms: " + ORIGIN + "/about-site/terms-conditions",
            "warnings": warnings, "results": results,
            "usage": {
                "operationId": plan["operationId"], "sourceId": plan["sourceId"], "captureId": capture["id"],
                "scope": configuration, "coverage": "COMPLETE_CAPTURE" if complete else "PARTIAL_CAPTURE",
                "complete": complete, "occurrences": len(results), "uniqueStudies": len(ids),
                "providerTotal": capture.get("expectedRows"), "pages": len(source_pages),
                "sourceBytes": raw_bytes, "nextPageToken": expected_token,
                "stoppedReason": None if complete else capture.get("error") or "Original capture remains " + str(capture.get("status")),
                "sourceSha256": source_sha, "originalSourceSha256": capture.get("source"),
                "sourceVersion": capture.get("version"), "createdAt": capture.get("createdAt"),
                "completedAt": capture.get("completedAt"), "nativeBuilds": builds
            },
            "sourcePages": source_pages, "sourceVersions": versions,
            "sourcePacket": {"schema": PACKET, "sha256": self.sha, "bytes": self.stat.st_size,
                             "manifestSha256": digest(self.manifest_bytes), "base64": encoded_packet}
        }


def publish(path, value):
    data = (json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n").encode()
    need(len(data) <= MAX_EDITION, "CLINICALTRIALS_DOSSIER_EDITION_SIZE_LIMIT")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    with os.fdopen(os.open(path, flags, 0o600), "wb") as out:
        out.write(data)
        out.flush()
        os.fsync(out.fileno())
    return {"bytes": len(data), "sha256": digest(data)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True)
    parser.add_argument("--expected-sha256", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--plan")
    args = parser.parse_args()
    packet = Packet(args.input, args.expected_sha256)
    try:
        if args.plan:
            with open(args.plan, "rb") as inp:
                raw_plan = inp.read(1024 * 1024 + 1)
            need(len(raw_plan) <= 1024 * 1024, "CLINICALTRIALS_PLAN_SIZE_LIMIT")
            value = packet.edition(document(raw_plan))
        else:
            value = packet.inspect()
        result = publish(args.output, value)
        print(json.dumps({"status": "CLINICALTRIALS_RETAINED_SOURCE_READ", **result}))
    finally:
        packet.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        code = str(error)
        if not re.fullmatch(r"CLINICALTRIALS_[A-Z0-9_]+", code):
            code = "CLINICALTRIALS_PACKET_READ_FAILED"
        print(json.dumps({"error": code}), file=sys.stderr)
        raise SystemExit(1)
