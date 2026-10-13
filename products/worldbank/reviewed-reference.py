"""Create the reviewed A/B reference inside the original installed World Bank course.

No provider acquisition is performed. Both customer handovers retain the same
complete original source capture; B records one explicit analyst exclusion.
"""
from __future__ import annotations
import base64
import io
import json
from pathlib import Path
import zipfile
from stellar_forge_buyer.storage import private_directory
from stellar_forge_buyer.worldbank_analysis import core_call, describe, encoded, regular, require, sha, typed_rows, write

SCHEMA = "stellar-forge.worldbank-reviewed-reference.v1"
REASON = "Customer review excludes Canada GDP for 2018; all original provider responses and other observations are unchanged."
KEYS = ("source_id", "country_id", "country_iso3", "indicator_id", "period")


def reviewed_reference(root, core, baseline):
    root = private_directory(Path(root).expanduser().absolute(), create=True)
    core = Path(core).resolve(strict=True)
    baseline = Path(baseline).resolve(strict=True)
    raw = regular(baseline)
    binding = {"baseline": describe(baseline), "core_sha256": sha(regular(core)),
               "source_sha256": sha(regular(core.parent / "source.py"))}
    receipt = root / "reviewed-reference.json"
    if receipt.exists():
        saved = json.loads(regular(receipt))
        require(saved["binding"] == binding, "Continue the exact original reference and source engine.")
        candidate = Path(saved["candidate"]["path"])
        require(describe(candidate) == {key: saved["candidate"][key] for key in ("filename", "bytes", "sha256")},
                "The retained reviewed candidate handover changed.")
        return saved

    def opened(body):
        with zipfile.ZipFile(io.BytesIO(body)) as archive:
            return {name: archive.read(name) for name in archive.namelist() if not name.endswith("/")}
    original_files = opened(raw)
    _, original_rows = typed_rows(original_files["dataset.csv"], json.loads(original_files["dataset.json"]))
    require(len(original_rows) == 42, "Select the original complete 42-observation handover.")
    native = root / "source"
    capture_id, original_review_id = "programme-reference", "programme-original-review"
    state = core_call(core, native, "state")
    capture = next((row for row in state["captures"] if row["id"] == capture_id), None)
    review = next((row for row in state["reviews"] if row["id"] == original_review_id), None)
    if not (capture and capture["status"] == "COMPLETE" and review
            and review.get("captureId") == capture_id
            and review.get("captureSha256") == capture.get("captureSha256")):
        imported = core_call(core, native, "import-package", {
            "id": capture_id, "reviewId": original_review_id, "selectionId": "programme-reference-selection",
            "archiveBase64": base64.b64encode(raw).decode()})
        require(imported["originalPackageSha256"] == sha(raw), "The original handover import changed.")
        capture, review = imported["capture"], imported["review"]
    observations = core_call(core, native, "observations", {"captureId": capture_id, "offset": 0, "limit": 100})
    require(observations["total"] == 42 and len(observations["rows"]) == 42,
            "The original captured cohort is incomplete.")
    matching = [row for row in observations["rows"] if row["country_iso3"] == "CAN"
                and row["indicator_id"] == "NY.GDP.MKTP.CD" and row["period"] == "2018"]
    require(len(matching) == 1, "The explicit excluded source observation is ambiguous.")
    excluded = matching[0]
    request = {"id": "programme-reviewed-candidate", "captureId": capture_id,
               "title": "North America reviewed customer edition", "note": REASON,
               "columns": review["columns"], "choices": review["choices"],
               "excludedKeys": sorted(set(review["excludedKeys"] + [excluded["key"]])),
               "expectedRevision": 0}
    state = core_call(core, native, "state")
    candidate_review = next((row for row in state["reviews"] if row["id"] == request["id"]), None)
    if candidate_review is None:
        candidate_review = core_call(core, native, "review", request)
    else:
        require(all(candidate_review.get(key) == value for key, value in request.items()
                    if key != "expectedRevision"), "Continue the original explicit review choice.")
    require(candidate_review["includedObservations"] == 41, "Only the selected review exclusion is allowed.")
    exported = core_call(core, native, "export", {"id": "programme-reviewed-candidate",
        "reviewId": candidate_review["id"], "expectedRevision": candidate_review["revision"]})
    candidate = Path(exported["directory"]) / "handover.zip"
    candidate_files = opened(regular(candidate))
    original_source = json.loads(original_files["source.json"])
    candidate_source = json.loads(candidate_files["source.json"])
    require(original_source["captureSha256"] == candidate_source["captureSha256"],
            "A review change must preserve the exact original provider capture.")
    _, candidate_rows = typed_rows(candidate_files["dataset.csv"], json.loads(candidate_files["dataset.json"]))
    keyed = lambda row: tuple(row[key] for key in KEYS)
    expected = {keyed(row): row for row in original_rows}
    require(len(expected) == 42 and len(candidate_rows) == 41
            and len({keyed(row) for row in candidate_rows}) == 41
            and all(expected.get(keyed(row)) == row for row in candidate_rows),
            "The reviewed handover changed an original provider value or row identity.")
    missing = [row for key, row in expected.items() if key not in {keyed(item) for item in candidate_rows}]
    require(len(missing) == 1 and missing[0]["country_iso3"] == "CAN"
            and missing[0]["indicator_id"] == "NY.GDP.MKTP.CD" and missing[0]["period"] == "2018",
            "The review excluded another observation.")
    value = {"schema": SCHEMA, "binding": binding,
             "baseline": {**describe(baseline), "path": str(baseline), "rows": 42,
                          "capture_sha256": original_source["captureSha256"]},
             "candidate": {**describe(candidate), "path": str(candidate), "rows": 41,
                           "capture_sha256": candidate_source["captureSha256"]},
             "review": {"id": candidate_review["id"], "revision": candidate_review["revision"],
                        "excluded_key": excluded["key"], "note": REASON},
             "source_selection": candidate_source["selection"], "identity_columns": list(KEYS),
             "provider_revision_claim": False}
    write(receipt, encoded(value), exact=True)
    return value
