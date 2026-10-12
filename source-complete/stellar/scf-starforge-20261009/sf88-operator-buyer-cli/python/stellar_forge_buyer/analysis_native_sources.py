"""Read already saved native MCP purchases through the original Python consumers.

This module performs no request, queue intake, signer, accounting, assembly or
recovery operation. Original native metadata remains on its existing host.
"""
from __future__ import annotations

from pathlib import Path
import re
import subprocess
from urllib.parse import urlsplit, urlunsplit

from .errors import StateError
from .result import BuyerResult
from .runtime import Runtime
from .storage import digest, parse, private_directory, read

_SCHEMA = "stellar-forge.mcp-native-saved-source.v1"
_HASH = re.compile(r"[a-f0-9]{64}")
_ID = re.compile(r"[A-Za-z0-9._:-]{1,128}")
_MAX_SOURCE = 256 * 1024 * 1024
_READER = r"""
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const [checkout,nativeWorkspace,kind,id,inboxAlias]=process.argv.slice(1);
try {
  const {inspectNativeAnalysisSource}=await import(pathToFileURL(resolve(checkout,
    'stellar-forge/mcp-paid-agent/native-analysis-sources.mjs')));
  const source=await inspectNativeAnalysisSource({nativeWorkspace,kind,id,...(inboxAlias?{inboxAlias}:{})});
  process.stdout.write(JSON.stringify(source));
} catch(error) {
  const code=/^[A-Z0-9_]{1,180}$/.test(error?.code??'')?error.code:'RESPONSE_NATIVE_SOURCE_UNAVAILABLE';
  process.stderr.write(JSON.stringify({error:code}));process.exitCode=2;
}
"""


def native_source_paths(directory, kind, identifier, inbox_alias=None):
    if (kind not in {"object", "response"} or not isinstance(identifier, str)
            or not _ID.fullmatch(identifier) or not isinstance(directory, (str, Path))):
        raise StateError("ANALYSIS_NATIVE_SOURCE_SELECTION_REQUIRED")
    if inbox_alias is not None and (kind != "response" or not isinstance(inbox_alias, str)
            or not re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]{0,63}", inbox_alias)):
        raise StateError("ANALYSIS_NATIVE_INBOX_ALIAS_INVALID")
    path = Path(directory).expanduser().absolute()
    if path.resolve() != path:
        raise StateError("ANALYSIS_NATIVE_SOURCE_CANONICAL_DIRECTORY_REQUIRED")
    path = private_directory(path, create=False)
    return {"native_workspace": str(path), "native_kind": kind, "native_id": identifier, "native_inbox": inbox_alias}


def _inspect(paths, checkout, node):
    if checkout is None:
        raise StateError("ANALYSIS_ORIGINAL_RUNTIME_CHECKOUT_REQUIRED")
    selected = native_source_paths(paths["native_workspace"], paths["native_kind"], paths["native_id"], paths.get("native_inbox"))
    try:
        process = subprocess.run([node, "--input-type=module", "-e", _READER, str(checkout),
                                  selected["native_workspace"], selected["native_kind"], selected["native_id"], selected["native_inbox"] or ""],
                                 capture_output=True, timeout=120, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise StateError("RESPONSE_NATIVE_SOURCE_READER_UNAVAILABLE") from None
    if process.returncode:
        code = None
        if len(process.stderr) <= 8192:
            try:
                value = parse(process.stderr)
                code = value.get("error")
            except Exception:
                pass
        raise StateError(code if isinstance(code, str) and re.fullmatch(r"[A-Z0-9_]{1,180}", code)
                         else "RESPONSE_NATIVE_SOURCE_READER_FAILED")
    if len(process.stdout) > 2_097_152:
        raise StateError("RESPONSE_NATIVE_SOURCE_DESCRIPTOR_TOO_LARGE")
    result = parse(process.stdout)
    if (not isinstance(result, dict) or result.get("schema") != _SCHEMA
            or result.get("nativeWorkspace") != selected["native_workspace"]
            or result.get("kind") != selected["native_kind"] or result.get("id") != selected["native_id"]
            or not isinstance(result.get("sourceBindingSha256"), str)
            or not _HASH.fullmatch(result["sourceBindingSha256"])
            or not isinstance(result.get("sourceBinding"), dict)
            or (selected["native_kind"] == "response" and result.get("original", {}).get("inboxAlias") != selected["native_inbox"])
            or not isinstance(result.get("file"), dict) or not isinstance(result.get("paths"), dict)
            or not isinstance(result.get("inputs"), list) or not 1 <= len(result["inputs"]) <= 24):
        raise StateError("RESPONSE_NATIVE_SOURCE_DESCRIPTOR_INVALID")
    file = result["file"]
    if (type(file.get("bytes")) is not int or not 0 <= file["bytes"] <= _MAX_SOURCE
            or not isinstance(file.get("sha256"), str) or not _HASH.fullmatch(file["sha256"])
            or not isinstance(file.get("destination"), str)):
        raise StateError("RESPONSE_NATIVE_SOURCE_FILE_INVALID")
    return result


def _inputs(descriptor):
    inputs, selected, roles = [], {}, set()
    for item in descriptor["inputs"]:
        if (not isinstance(item, dict) or not isinstance(item.get("role"), str)
                or not re.fullmatch(r"[a-z][a-z0-9-]{0,63}", item["role"])
                or item["role"] in roles or type(item.get("bytes")) is not int
                or not 0 <= item["bytes"] <= 8_388_608 or not isinstance(item.get("path"), str)
                or not isinstance(item.get("sha256"), str) or not _HASH.fullmatch(item["sha256"])):
            raise StateError("RESPONSE_NATIVE_SOURCE_INPUT_INVALID")
        path = Path(item["path"])
        if not path.is_absolute() or path.resolve() != path:
            raise StateError("RESPONSE_NATIVE_SOURCE_INPUT_INVALID")
        roles.add(item["role"])
        raw = read(path, max(1, item["bytes"]))
        if len(raw) != item["bytes"] or digest(raw) != item["sha256"]:
            raise StateError("RESPONSE_NATIVE_SOURCE_CHANGED")
        inputs.append(dict(item))
        if item["role"] in {"inbox-execution", "inbox-terminal"}:
            selected[item["role"]] = parse(raw)
    binding = descriptor["sourceBinding"]
    if (binding.get("schema") != _SCHEMA or binding.get("kind") != descriptor["kind"]
            or binding.get("id") != descriptor["id"]
            or binding.get("inputFiles") != [{key: item[key] for key in ("role", "bytes", "sha256")} for item in inputs]
            or binding.get("retainedFile") != {key: descriptor["file"].get(key) for key in ("bytes", "sha256", "contentType")}
            or binding.get("original") != descriptor.get("original")):
        raise StateError("RESPONSE_NATIVE_SOURCE_BINDING_INVALID")
    return inputs, selected


def _endpoint(value):
    if not isinstance(value, str):
        return None
    try:
        url = urlsplit(value)
        return urlunsplit((url.scheme, url.netloc, url.path, "", ""))
    except ValueError:
        return None


def read_native_source(paths, format, checkout, node, cache_dir, original_reader):
    """Return the existing ResponseSource inputs, including native request binding."""
    descriptor = _inspect(paths, checkout, node)
    if format not in ({"json", "csv"} if descriptor["kind"] == "object" else {"json", "csv", "ndjson", "sse"}):
        raise StateError("RESPONSE_NATIVE_SOURCE_FORMAT_REQUIRED")
    inputs, selected = _inputs(descriptor)
    retained = descriptor["file"]
    if descriptor["kind"] == "object":
        session = descriptor["paths"].get("session")
        if not isinstance(session, str):
            raise StateError("RESPONSE_NATIVE_OBJECT_SESSION_REQUIRED")
        original_paths = {"session": session, "object_session": str(Path(session) / "session.json"),
                          "destination": retained["destination"]}
        file, stream, format, original_inputs, context = original_reader(
            "object", original_paths, format, checkout, node, cache_dir)
        saved = file.delivery
        if (saved.get("bytes") != retained["bytes"] or saved.get("sha256") != retained["sha256"]
                or str(file.path) != retained["destination"]
                or context.get("sessionId") != descriptor["original"].get("sessionId")
                or context.get("configurationSha256") != descriptor["original"].get("configurationSha256")
                or context.get("assemblyReceiptSha256") != descriptor["original"].get("nativeReceiptSha256")):
            raise StateError("RESPONSE_NATIVE_OBJECT_DELIVERY_CHANGED")
    else:
        configuration = selected.get("inbox-execution")
        terminal = selected.get("inbox-terminal")
        if not isinstance(configuration, dict) or not isinstance(terminal, dict):
            raise StateError("RESPONSE_NATIVE_INBOX_SOURCE_REQUIRED")
        native, response = terminal.get("summary"), configuration.get("responseFile")
        original = descriptor["original"]
        if (not isinstance(native, dict) or native.get("mode") != "ORIGINAL_OPERATOR_APPROVED_BUYER_ATTEMPT"
                or terminal.get("intentId") != descriptor["id"] or native.get("intentId") != descriptor["id"]
                or terminal.get("attemptId") != original.get("attemptId")
                or configuration.get("operation", {}).get("intentId") != descriptor["id"]
                or not isinstance(response, dict) or response.get("destination") != retained["destination"]):
            raise StateError("RESPONSE_NATIVE_INBOX_SOURCE_CHANGED")
        saved = native.get("responseFile")
        if (not isinstance(saved, dict) or saved.get("status") != "SAVED"
                or (saved.get("destination") or saved.get("path")) != retained["destination"]
                or saved.get("bytes") != retained["bytes"] or saved.get("sha256") != retained["sha256"]):
            raise StateError("RESPONSE_NATIVE_INBOX_SAVED_FILE_CHANGED")
        by_role = {item["role"]: item for item in inputs}
        if by_role["inbox-execution"]["sha256"] != original["configurationSha256"]:
            raise StateError("RESPONSE_NATIVE_INBOX_CONFIG_CHANGED")
        # A consumer envelope preserves the actual summary; it does not invent
        # an exit code, completed payment, receipt or another request result.
        record = {"native": native, "configSha256": original["configurationSha256"],
                  "retainedSourceKind": "SF88_NATIVE_INBOX",
                  "retainedSourceFiles": {"configSha256": by_role["inbox-execution"]["sha256"],
                                          "resultSha256": by_role["inbox-terminal"]["sha256"]}}
        cache = private_directory(Path(cache_dir))
        file = BuyerResult(record, Path(retained["destination"]), response.get("maxBytes", 67_108_864),
                           _runtime=Runtime(checkout, node=node, timeout=120),
                           _response_file={"maxBytes": 67_108_864, **response}, _operation_directory=cache)
        original_inputs, stream = [], None
        context = {"nativeKind": "SF88_NATIVE_INBOX", "intentId": descriptor["id"],
                   "configurationSha256": original["configurationSha256"],
                   "sourceConfigurationSha256": original["sourceConfigSha256"],
                   "nativeStatus": native.get("status"), "paymentStatus": native.get("paymentStatus"),
                   "responseFileStatus": saved["status"], "transportComplete": True,
                   "httpStatus": native.get("httpStatus"), "responseError": saved.get("error"),
                   "sourceBytes": saved["bytes"], "sourceSha256": saved["sha256"],
                   "contentType": saved.get("contentType"),
                   "endpoint": _endpoint(configuration.get("operation", {}).get("url"))}
        if format in {"ndjson", "sse"}:
            # Original framing, final record, record-count and all-byte checks
            # remain in the existing native retained stream exporter.
            delivery = file.export_stream(format=format, allow_partial=False, max_export_bytes=_MAX_SOURCE,
                                          cache_dir=cache / "native-streams")
            original_paths = {"stream": str(delivery.directory),
                              "manifest": str(delivery.directory / "manifest.json"),
                              "request": str(delivery.directory / "source.json")}
            file, stream, format, original_inputs, context = original_reader(
                "stream", original_paths, format, checkout, node, cache_dir)
            if (context.get("sourceBytes") != retained["bytes"]
                    or context.get("sourceSha256") != retained["sha256"]
                    or context.get("transportComplete") is not True):
                raise StateError("RESPONSE_NATIVE_STREAM_SOURCE_CHANGED")
    context = {**context, "nativeSource": descriptor["sourceBinding"],
               "nativeSourceSha256": descriptor["sourceBindingSha256"]}
    return file, stream, format, [*inputs, *original_inputs], context

