"""Complete original Gravitee source preparation on the existing case connection.
This adapter is read-only. Attachments and Installation saves retain the original
Operations.command request/transaction and whole case export/receiving.
"""
from __future__ import annotations
import base64
import json
import os
from pathlib import Path
import re
import subprocess
from copy import deepcopy
from model import Problem, canonical
import operations_installations as installations
import operations_workshare_installations as workshares

ROUTE = re.compile(r"^/api/operations/(operation-[a-f0-9]{32})/gravitee/(inspect|member|template|prepare)$")
MAX_OUTPUT = 64 * 1024 * 1024
FIELDS = {"expectedVersion", "sourceId", "expectedSourceSha256", "path", "offset", "limit",
          "document", "bindings", "cohortSourceId", "expectedCohortSha256"}


def fail(message, code="GRAVITEE_SOURCE_INPUT", status=422):
    raise Problem(message, status, code)


def engine(payload):
    try:
        run = subprocess.run(
            [os.environ.get("GRANT_GRAVITEE_NODE", "node"), str(Path(__file__).with_name("operations_gravitee_engine.mjs"))],
            input=canonical(payload), text=True, encoding="utf-8", capture_output=True,
            timeout=60, check=False)
    except FileNotFoundError as exc:
        raise Problem("Select the installed Node runtime for the original Gravitee application.", 503,
                      "GRAVITEE_ENGINE_UNAVAILABLE") from exc
    except subprocess.TimeoutExpired as exc:
        raise Problem("The read-only Gravitee source operation did not finish. The original case is unchanged.", 504,
                      "GRAVITEE_ENGINE_TIMEOUT") from exc
    if len(run.stdout.encode("utf-8")) > MAX_OUTPUT:
        fail("The complete original source report exceeds the supported response size.", status=413)
    try:
        result = json.loads(run.stdout)
    except ValueError as exc:
        raise Problem("The installed Gravitee source reader returned no complete response.", 502,
                      "GRAVITEE_ENGINE_RESPONSE") from exc
    if not isinstance(result, dict) or result.get("ok") is not True or run.returncode:
        error = result.get("error", {}) if isinstance(result, dict) else {}
        fail(str(error.get("message", "The original source reader rejected this edition.")))
    return result["result"]


def perform(ops, case_id, action, body):
    if not isinstance(body, dict) or set(body) - FIELDS:
        fail("Use the complete declared Gravitee source request.")
    with ops._snapshot():
        context = ops._context(case_id)
        installations._current(context, body.get("expectedVersion"))
        source_id = body.get("sourceId")
        if not isinstance(source_id, str) or not re.fullmatch(r"source-[a-f0-9]{32}", source_id):
            fail("Select a complete original handover attached to this case.")
        metadata, raw = ops.source(case_id, source_id)
        if metadata["sha256"] != body.get("expectedSourceSha256"):
            fail("The selected original handover differs from the reviewed source.", "GRAVITEE_SOURCE_CHANGED", 409)
        payload = {"action": action, "packetBase64": base64.b64encode(raw).decode("ascii")}
        if action == "member":
            if not isinstance(body.get("path"), str) or len(body["path"]) > 2048:
                fail("Select a member from the full original inventory.")
            payload.update({key: body[key] for key in ("path", "offset", "limit") if key in body})
        elif action in ("template", "prepare"):
            # Normalize and verify the actual selected original commercial draft.
            # The maintained preparation engine rejects operated/saved targets.
            document = installations.normalized(context, body.get("document"))
            if not document.get("workshare"):
                fail("Receive the original complete commercial Workshare in the Installation editor first.")
            workshares.verify_document(ops, context, document)
            seed = {"source": installations._source(context), "document": document,
                    "installationId": None, "expectedRevision": 0}
            payload.update(seed=seed, caseValue=ops._read(case_id))
            if action == "prepare":
                cohort_id = body.get("cohortSourceId")
                if not isinstance(cohort_id, str) or not re.fullmatch(r"source-[a-f0-9]{32}", cohort_id):
                    fail("Attach the complete selected cohort before preparing the Installation.")
                cohort_metadata, cohort_raw = ops.source(case_id, cohort_id)
                if cohort_metadata["sha256"] != body.get("expectedCohortSha256"):
                    fail("The retained cohort differs from the selected original bytes.", "GRAVITEE_SOURCE_CHANGED", 409)
                payload.update(bindings=deepcopy(body.get("bindings")),
                               cohortBase64=base64.b64encode(cohort_raw).decode("ascii"),
                               cohortSourceId=cohort_id)
        result = engine(payload)
        if action == "prepare":
            prepared = result["prepared"]
            # The original domain resolves all case source/deployment/Workshare references.
            preview = installations.preview(ops, context, prepared["preview"])
            result["nativePreview"] = preview
        return {"schema": "stellar-forge.gravitee-source-desk-result.v1",
                "scope": {"caseId": case_id, "version": context["program"]["version"],
                          "planId": context["program"]["planId"]},
                "source": metadata, "result": result}


def register_static(static):
    for name, media in {
        "operations_gravitee.mjs": "text/javascript; charset=utf-8",
        "operations_gravitee_model.mjs": "text/javascript; charset=utf-8",
        "operations_gravitee.css": "text/css; charset=utf-8",
        "GRAVITEE_SOURCE_DESK.md": "text/markdown; charset=utf-8",
    }.items():
        static["/" + name] = (name, media)


def handle(handler, parsed, ops, method):
    match = ROUTE.fullmatch(parsed.path)
    if not match:
        return False
    if method != "POST":
        raise Problem("Use the original complete read-only source request.", 405, "METHOD_NOT_ALLOWED")
    handler.send(200, perform(ops, match[1], match[2], handler.json_body()))
    return True
