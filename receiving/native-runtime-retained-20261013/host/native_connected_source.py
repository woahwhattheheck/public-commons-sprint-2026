"""Receive selected connected source editions through the existing native importer.

The active hosted-app session performs source reads. Original source identity,
byte import, native execution and output delivery keep their maintained APIs.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import importlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import sys
import tempfile
import zlib

SCHEMA = "commons.connected-source-input/v1"
PACKET_SCHEMA = "commons.source-packet/v1"
ENVELOPE_SCHEMA = "commons.compressed-source-envelope.v1"
MAX_SOURCE_BYTES = 64 * 1024 * 1024
MAX_PACKET_BYTES = 96 * 1024 * 1024
MAX_FILES = 16384
SHA256 = re.compile(r"[0-9a-f]{64}")
FENCE = re.compile(r"(?ms)^[ \t]*\x60\x60\x60(?:json)?[ \t]*\r?\n(.*?)^[ \t]*\x60\x60\x60[ \t]*$")


def require(value, message):
    if not value:
        raise ValueError(message)


def encoded(value):
    return json.dumps(value, ensure_ascii=True, sort_keys=True,
                      separators=(",", ":"), allow_nan=False).encode("ascii")


def is_connected(value):
    return isinstance(value, dict) and value.get("schema") == SCHEMA


def packet_bytes(value):
    """Decode the two maintained source envelopes without changing source bytes."""
    require(isinstance(value, dict), "Select an original encoded source packet.")
    if value.get("schema") == PACKET_SCHEMA:
        require(not set(value) - {"schema", "encoding", "data", "bytes", "sha256"},
                "Unknown source packet field.")
        size, digest, data, codec = (value.get(key) for key in ("bytes", "sha256", "data", "encoding"))
    elif value.get("schema") == ENVELOPE_SCHEMA:
        require(not set(value) - {"schema", "codec", "decoded_bytes", "decoded_sha256",
                                 "file_count", "payload_base64"}, "Unknown source envelope field.")
        size, digest, data, codec = (value.get(key) for key in
                                    ("decoded_bytes", "decoded_sha256", "payload_base64", "codec"))
    else:
        raise ValueError("Select a maintained complete source packet.")
    require(type(size) is int and 0 < size <= MAX_SOURCE_BYTES,
            "The decoded source packet must fit within 64 MiB.")
    require(isinstance(data, str) and len(data) <= MAX_PACKET_BYTES,
            "The source packet must contain complete bounded base64 or base85.")
    if codec == "lzma-alone+base85":
        try:
            packet = base64.b85decode(data.encode("ascii"))
        except (ValueError, UnicodeEncodeError) as error:
            raise ValueError("The source packet contains invalid base85.") from error
    else:
        packet = base64.b64decode(data, validate=True)
    if codec in ("gzip+base64", "deflate-raw+base64"):
        decoder = zlib.decompressobj(16 + zlib.MAX_WBITS if codec == "gzip+base64" else -zlib.MAX_WBITS)
        plain = decoder.decompress(packet, size + 1)
        require(len(plain) <= size and decoder.eof and not decoder.unused_data
                and not decoder.unconsumed_tail,
                "The compressed source packet is incomplete or exceeds its declared size.")
    elif codec in ("lzma-alone+base64", "lzma-alone+base85"):
        # Keep lzma optional for existing gzip/deflate/lz77 installations.
        try:
            import lzma
        except ImportError as error:
            raise ValueError("This source encoding requires Python's standard lzma module.") from error
        try:
            decoder = lzma.LZMADecompressor(format=lzma.FORMAT_ALONE, memlimit=MAX_SOURCE_BYTES)
            plain = decoder.decompress(packet, max_length=size + 1)
        except lzma.LZMAError as error:
            raise ValueError("The source packet is not a readable bounded LZMA-alone stream.") from error
        require(len(plain) <= size and decoder.eof and not decoder.unused_data,
                "The compressed source packet is incomplete, has trailing data or exceeds its declared size.")
    elif codec == "commons-lz77-v1+base64":
        plain, index = bytearray(), 0
        while index < len(packet):
            token = packet[index]
            index += 1
            count = token + 1 if token < 128 else token - 128 + 3
            require(len(plain) + count <= size, "The source packet exceeds its declared size.")
            if token < 128:
                require(index + count <= len(packet), "The source packet has an incomplete literal.")
                plain.extend(packet[index:index + count])
                index += count
            else:
                require(index + 2 <= len(packet), "The source packet has an incomplete match.")
                distance = packet[index] * 256 + packet[index + 1]
                index += 2
                require(0 < distance <= len(plain), "The source packet has an invalid match distance.")
                for _ in range(count):
                    plain.append(plain[-distance])
    else:
        raise ValueError("Select gzip+base64, deflate-raw+base64, commons-lz77-v1+base64, "
                         "lzma-alone+base64 or lzma-alone+base85 source encoding.")
    require(len(plain) == size, "The source packet byte count differs from its declaration.")
    if digest is not None:
        require(isinstance(digest, str) and SHA256.fullmatch(digest)
                and hashlib.sha256(plain).hexdigest() == digest,
                "The source packet differs from its retained SHA-256.")
    return bytes(plain)


def decode_packet(value):
    if not isinstance(value, dict) or value.get("schema") not in (PACKET_SCHEMA, ENVELOPE_SCHEMA):
        return value
    result = json.loads(packet_bytes(value))
    require(isinstance(result, dict) and result.get("schema") not in (PACKET_SCHEMA, ENVELOPE_SCHEMA),
            "The source packet must contain one original source manifest.")
    return result


def _outer_json(text):
    # Slack may render indentation as NBSP. Never change a character inside a
    # JSON string, including encoded source, Unicode or escaped quotation marks.
    quoted, escaped, result = False, False, []
    for character in text:
        if quoted:
            result.append(character)
            if escaped:
                escaped = False
            elif character == "\\":
                escaped = True
            elif character == '"':
                quoted = False
        else:
            result.append(" " if character == "\u00a0" else character)
            if character == '"':
                quoted = True
    return json.loads("".join(result))


def _canvas_markdown(result):
    require(isinstance(result, dict) and result.get("isError") is not True,
            "The connected source read returned an error.")
    values = [result, result.get("structuredContent")]
    for block in result.get("content", []):
        if isinstance(block, dict) and block.get("type") == "text":
            try:
                values.append(_outer_json(block.get("text", "")))
            except (TypeError, ValueError):
                continue
    for value in values:
        if isinstance(value, dict) and isinstance(value.get("markdown_content"), str):
            require(len(value["markdown_content"].encode("utf-8")) <= MAX_PACKET_BYTES,
                    "The complete Canvas input exceeds 96 MiB.")
            return value["markdown_content"]
    raise ValueError("The original Canvas read did not return complete markdown.")


def _packet_from_canvas(result, selected):
    matches = []
    for body in FENCE.findall(_canvas_markdown(result)):
        try:
            packet = _outer_json(body)
        except (TypeError, ValueError):
            continue
        if not isinstance(packet, dict):
            continue
        if packet.get("schema") == PACKET_SCHEMA:
            size, digest = packet.get("bytes"), packet.get("sha256")
        elif packet.get("schema") == ENVELOPE_SCHEMA:
            size, digest = packet.get("decoded_bytes"), packet.get("decoded_sha256")
        else:
            continue
        if size != selected["bytes"] or digest not in (None, selected["sha256"]):
            continue
        raw = packet_bytes(packet)
        require(hashlib.sha256(raw).hexdigest() == selected["sha256"],
                "The selected connected source packet has different bytes.")
        matches.append(raw)
    require(matches and all(raw == matches[0] for raw in matches),
            "The Canvas must contain the selected complete source edition.")
    return matches[0]


def _part_bytes(raw, selected):
    require(len(raw) == selected["bytes"]
            and hashlib.sha256(raw).hexdigest() == selected["sha256"],
            "A retained source part differs from its selected original bytes.")
    try:
        return raw.decode("ascii")
    except UnicodeDecodeError as error:
        raise ValueError("Source transport parts must contain original ASCII encoded data.") from error


def _multipart_bytes(source, cache, read_canvas):
    transport = source["transport"]
    pieces, missing = [None] * len(source["parts"]), {}
    for index, part in enumerate(source["parts"]):
        key = hashlib.sha256(encoded({"transport": transport, "part": part})).hexdigest()
        capture = cache / "parts" / (key + ".data") if cache else None
        if capture is not None and capture.exists():
            pieces[index] = _part_bytes(_read_file(capture, part["bytes"]), part)
        else:
            missing.setdefault(part["canvas_id"], []).append((index, part, capture))
    for canvas_id, required in missing.items():
        result = read_canvas(canvas_id)
        if cache is not None:
            provider = encoded(result)
            _write_once(cache / "parts" / "providers"
                        / (hashlib.sha256(provider).hexdigest() + ".json"), provider)
        sizes = {part["bytes"] for _, part, _ in required}
        candidates = {}
        for body in FENCE.findall(_canvas_markdown(result)):
            try:
                envelope = _outer_json(body)
            except (TypeError, ValueError):
                continue
            if not isinstance(envelope, dict) or envelope.get("schema") != transport["schema"]:
                continue
            data = envelope.get(transport["data_field"])
            if not isinstance(data, str) or len(data) not in sizes:
                continue
            try:
                raw = data.encode("ascii")
            except UnicodeEncodeError:
                continue
            candidates[(len(raw), hashlib.sha256(raw).hexdigest())] = raw
        # Retain every available selected part before reporting an incomplete
        # Canvas, so a later source read can resume without fetching it again.
        for index, part, capture in required:
            raw = candidates.get((part["bytes"], part["sha256"]))
            if raw is not None:
                pieces[index] = _part_bytes(raw, part)
                if capture is not None:
                    _write_once(capture, raw)
        require(all(pieces[index] is not None for index, _, _ in required),
                "The Canvas must contain every selected source part requested from it.")
    return packet_bytes({"schema": PACKET_SCHEMA, "encoding": transport["encoding"],
                         "bytes": source["bytes"], "sha256": source["sha256"],
                         "data": "".join(pieces)})


def _read_file(path, maximum):
    path = Path(path).expanduser()
    require(stat.S_ISREG(path.lstat().st_mode), "Select an ordinary retained source file.")
    with path.open("rb") as stream:
        raw = stream.read(maximum + 1)
    require(len(raw) <= maximum, "The retained source input exceeds its complete size limit.")
    return raw


def _write_once(path, raw):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.exists() or path.is_symlink():
        require(_read_file(path, len(raw)) == raw, "The retained source file contains another edition.")
        return
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(prefix=".source-", dir=path.parent, delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(temporary, path)
        except FileExistsError:
            require(_read_file(path, len(raw)) == raw, "The retained source file contains another edition.")
        descriptor = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def _helper(path=None):
    path = path or os.environ.get("COMMONS_HOSTED_APPS_HELPER")
    if not path:
        try:
            return importlib.import_module("library_hosted_apps")
        except ImportError:
            raise ValueError("Supply the current unchanged library_hosted_apps.py with --hosted-apps-helper.") from None
    path = Path(path).expanduser().resolve(strict=True)
    require(path.is_file(), "Select the current unchanged HostedApps helper.")
    name = "commons_connected_source_hosted_" + hashlib.sha256(str(path).encode()).hexdigest()
    spec = importlib.util.spec_from_file_location(name, path)
    require(spec is not None and spec.loader is not None, "The selected HostedApps helper cannot be imported.")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


class CanvasReader:
    def __init__(self, *, helper_path=None, client=None, hosted_module=None, discovery_passes=8):
        require(type(discovery_passes) is int and discovery_passes > 0,
                "Select a positive number of source-tool discovery passes.")
        self.module = hosted_module or _helper(helper_path)
        self.client = client or self.module.HostedAppsClient()
        self.discovery_passes = discovery_passes
        self.connector = None

    def _discover(self):
        for _ in range(self.discovery_passes):
            cursor, seen = None, set()
            for _ in range(100):
                result = self.client._rpc("tools/list", {} if cursor is None else {"cursor": cursor})
                require(isinstance(result.get("tools"), list), "Connected tools/list returned no tools array.")
                for item in result["tools"]:
                    if not isinstance(item, dict):
                        continue
                    name, meta = item.get("name"), item.get("_meta")
                    if not isinstance(name, str) or not isinstance(meta, dict):
                        continue
                    if not (name == "slack_read_canvas" or name.endswith("_slack_read_canvas")
                            or name.endswith(".slack_read_canvas")):
                        continue
                    connector = next((meta[key] for key in
                                      ("connector_id", "connectorId", "app_id", "appId")
                                      if isinstance(meta.get(key), str) and meta[key]), None)
                    if connector:
                        self.client._tools.append(self.module.HostedAppTool(name=name, meta=meta))
                        self.connector = connector
                        return
                cursor = result.get("nextCursor", result.get("next_cursor"))
                if not cursor:
                    break
                require(isinstance(cursor, str) and cursor not in seen,
                        "Connected source discovery returned a repeated or invalid cursor.")
                seen.add(cursor)
        raise ValueError("The current discovery passes did not expose the original Slack Canvas reader; retain this source request.")

    def read(self, canvas_id):
        if self.connector is None:
            self._discover()
        return self.client.call_tool(self.connector, "slack_read_canvas", {"canvas_id": canvas_id})


def _selection(value):
    require(is_connected(value) and not set(value) - {"schema", "inputs", "selection"},
            "Select an original connected source input request.")
    inputs = value.get("inputs")
    require(isinstance(inputs, list) and 0 < len(inputs) <= MAX_FILES,
            "Select the complete original connected source inputs.")
    seen, normalized = set(), []
    for row in inputs:
        require(isinstance(row, dict) and not set(row) -
                {"id", "canvas_id", "bytes", "sha256", "document_schema",
                 "files_pointer", "data_field", "file_encoding", "parts", "transport"},
                "Unknown connected source input field.")
        selected = {**row, "files_pointer": row.get("files_pointer", "/files"),
                    "data_field": row.get("data_field", "data")}
        require(all(isinstance(selected.get(key), str) and selected[key]
                    for key in ("id", "document_schema", "data_field")),
                "Retain each source input ID, document schema and file data field.")
        require(selected["id"] not in seen, "Select each connected source input ID once.")
        require(type(selected.get("bytes")) is int and 0 < selected["bytes"] <= MAX_SOURCE_BYTES
                and isinstance(selected.get("sha256"), str) and SHA256.fullmatch(selected["sha256"]),
                "Retain each complete decoded source packet's byte count and SHA-256.")
        require(isinstance(selected["files_pointer"], str)
                and (not selected["files_pointer"] or selected["files_pointer"].startswith("/")),
                "Select the original file table with its JSON pointer.")
        if "file_encoding" in selected:
            require(selected["file_encoding"] in ("base64", "utf-8"),
                    "Select an explicit base64 or utf-8 fallback for source files.")
        if "canvas_id" in selected:
            require(isinstance(selected["canvas_id"], str) and selected["canvas_id"]
                    and "parts" not in selected and "transport" not in selected,
                    "Select one complete Canvas packet or its ordered transport parts.")
        else:
            parts, transport = selected.get("parts"), selected.get("transport")
            require(isinstance(parts, list) and 0 < len(parts) <= MAX_FILES
                    and isinstance(transport, dict)
                    and not set(transport) - {"schema", "encoding", "data_field"},
                    "Select the ordered original source parts and their transport.")
            transport = {**transport, "data_field": transport.get("data_field", "data")}
            require(all(isinstance(transport.get(key), str) and transport[key]
                        for key in ("schema", "data_field"))
                    and transport.get("encoding") in
                    ("gzip+base64", "deflate-raw+base64", "commons-lz77-v1+base64",
                     "lzma-alone+base64", "lzma-alone+base85"),
                    "Retain the original part schema, data field and supported packet encoding.")
            total = 0
            for part in parts:
                require(isinstance(part, dict) and set(part) == {"canvas_id", "bytes", "sha256"}
                        and isinstance(part["canvas_id"], str) and part["canvas_id"]
                        and type(part["bytes"]) is int and part["bytes"] > 0
                        and isinstance(part["sha256"], str) and SHA256.fullmatch(part["sha256"]),
                        "Retain each ordered Canvas part's encoded byte count and SHA-256.")
                total += part["bytes"]
            require(total <= MAX_PACKET_BYTES, "The complete encoded source parts must fit within 96 MiB.")
            selected["transport"] = transport
        seen.add(selected["id"])
        normalized.append(selected)
    return normalized


def _pointer(value, pointer):
    if not pointer:
        return value
    for token in pointer[1:].split("/"):
        require(re.search(r"~(?![01])", token) is None, "The source-table JSON pointer is malformed.")
        token = token.replace("~1", "/").replace("~0", "~")
        if isinstance(value, list):
            require(re.fullmatch(r"0|[1-9][0-9]*", token), "Select an original source-table index.")
            index = int(token)
            require(index < len(value), "The source-table index is missing.")
            value = value[index]
        else:
            require(isinstance(value, dict) and token in value, "The original source file table is missing.")
            value = value[token]
    return value


def _file(row, source, index):
    require(isinstance(row, dict) and isinstance(row.get("path"), str), "Each source file needs its original path.")
    name = row["path"]
    path = PurePosixPath(name)
    require(name and not path.is_absolute() and path.as_posix() == name
            and ".." not in path.parts and "\\" not in name and "\0" not in name,
            "Select a regular relative source path.")
    codec = row.get("encoding", source.get("file_encoding"))
    require(codec in ("base64", "utf-8") and isinstance(row.get(source["data_field"]), str),
            "Select each complete original source file with explicit base64 or utf-8 encoding.")
    data = row[source["data_field"]]
    require(len(data) <= MAX_PACKET_BYTES, "The source file exceeds its complete encoded size limit.")
    if codec == "base64":
        raw = base64.b64decode(data, validate=True)
        require(base64.b64encode(raw).decode("ascii") == data,
                "The original base64 source file is not canonically encoded.")
    else:
        raw = data.encode("utf-8")
        data = base64.b64encode(raw).decode("ascii")
    require(type(row.get("bytes")) is int and len(raw) == row["bytes"] <= MAX_SOURCE_BYTES
            and isinstance(row.get("sha256"), str)
            and hashlib.sha256(raw).hexdigest() == row["sha256"],
            "A complete source file differs from its selected original bytes.")
    mode = row.get("mode", "100644")
    require(mode in ("100644", "100755"), "Retain the original regular-file mode.")
    blob = hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest()
    uri = ("slack://canvas/" + source["canvas_id"] if "canvas_id" in source
           else "urn:sha256:" + source["sha256"])
    location = {"uri": uri, "input_id": source["id"], "document_schema": source["document_schema"],
                "files_pointer": source["files_pointer"], "index": index,
                "container": {"uri": uri, "bytes": source["bytes"], "sha256": source["sha256"]}}
    if "parts" in source:
        location["transport"] = source["transport"]
        location["parts"] = [{"uri": "slack://canvas/" + part["canvas_id"],
                              "bytes": part["bytes"], "sha256": part["sha256"]}
                             for part in source["parts"]]
    entry = {"path": name, "blob_sha": blob, "size": len(raw), "mode": mode,
             "response": {"sha": blob, "encoding": "base64", "content": data}}
    return entry, {"uri": uri, "bytes": len(raw), "sha256": row["sha256"],
                   "container": location["container"], "locations": [location]}


def read(value, *, cache_directory=None, helper_path=None, client=None,
         hosted_module=None, discovery_passes=8):
    """Return a complete original artifact manifest, reusing pinned source bytes."""
    selected = _selection(value)
    cache = Path(cache_directory).expanduser().absolute() if cache_directory else None
    reader, versions, total = None, {}, 0
    responses = {}

    def read_canvas(canvas_id):
        nonlocal reader
        if canvas_id not in responses:
            if reader is None:
                reader = CanvasReader(helper_path=helper_path, client=client, hosted_module=hosted_module,
                                      discovery_passes=discovery_passes)
            responses[canvas_id] = reader.read(canvas_id)
        return responses[canvas_id]

    for source in selected:
        key = hashlib.sha256(encoded(source)).hexdigest()
        capture = cache / (key + ".json") if cache else None
        if capture is not None and capture.exists():
            raw = _read_file(capture, source["bytes"])
        else:
            if "parts" in source:
                raw = _multipart_bytes(source, cache, read_canvas)
            else:
                result = read_canvas(source["canvas_id"])
                if capture is not None:
                    provider = encoded(result)
                    provider_path = cache / (key + ".providers") / (hashlib.sha256(provider).hexdigest() + ".json")
                    _write_once(provider_path, provider)
                raw = _packet_from_canvas(result, source)
            if capture is not None:
                _write_once(capture, raw)
        require(len(raw) == source["bytes"] and hashlib.sha256(raw).hexdigest() == source["sha256"],
                "The retained connected source packet changed.")
        document = json.loads(raw)
        require(isinstance(document, dict) and document.get("schema") == source["document_schema"],
                "The selected source document schema changed.")
        rows = _pointer(document, source["files_pointer"])
        require(isinstance(rows, list) and len(rows) <= MAX_FILES, "Select the complete original source file table.")
        for index, row in enumerate(rows):
            entry, origin = _file(row, source, index)
            identity = (entry["path"], origin["bytes"], origin["sha256"], entry["mode"])
            if identity in versions:
                versions[identity][1]["locations"].extend(origin["locations"])
            else:
                total += origin["bytes"]
                require(len(versions) < MAX_FILES and total <= MAX_SOURCE_BYTES,
                        "The complete connected source selection exceeds 16384 files or 64 MiB.")
                versions[identity] = (entry, origin)
    selection = value.get("selection")
    if selection is None:
        chosen = list(versions.values())
    else:
        require(isinstance(selection, list) and len(selection) <= MAX_FILES,
                "Supply the complete selected file identities.")
        chosen = []
        for item in selection:
            require(isinstance(item, dict) and not set(item) - {"path", "bytes", "sha256", "mode"},
                    "Select a source path, byte count, SHA-256 and optional original mode.")
            matches = [pair for identity, pair in versions.items()
                       if identity[:3] == (item.get("path"), item.get("bytes"), item.get("sha256"))
                       and ("mode" not in item or identity[3] == item["mode"])]
            require(len(matches) == 1, "The selected complete source file edition is missing or ambiguous.")
            chosen.append(matches[0])
    paths = [entry["path"] for entry, _ in chosen]
    require(chosen and len(paths) == len(set(paths)),
            "Choose one complete edition of every selected source path.")
    request = {"schema": "commons.artifact-source-request/v1",
               "files": sorted((entry for entry, _ in chosen), key=lambda row: row["path"]),
               "origins": {entry["path"]: origin for entry, origin in chosen}}
    import native_source_inputs as sources
    sources.normalized_request(request)
    sources.verify_provided(request, complete=True)
    return request


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--request", required=True, type=Path)
    parser.add_argument("--cache", type=Path)
    parser.add_argument("--hosted-apps-helper", type=Path)
    parser.add_argument("--discovery-passes", type=int, default=8)
    parser.add_argument("--destination", type=Path)
    parser.add_argument("--source-request", type=Path)
    args = parser.parse_args(argv)
    try:
        value = json.loads(_read_file(args.request, MAX_PACKET_BYTES))
        cache = args.cache or args.request.absolute().parent / "connected-source-inputs"
        request = read(value, cache_directory=cache, helper_path=args.hosted_apps_helper,
                       discovery_passes=args.discovery_passes)
        import native_source_inputs as sources
        result = {"ok": True, "schema": SCHEMA, "selection_id": sources.selection_identity(request),
                  "inputs": len(value["inputs"]), "files": len(request["files"]),
                  "bytes": sum(row["size"] for row in request["files"]), "cache": str(cache)}
        if args.destination:
            imported = sources.materialize_reused(request, args.destination)
            require(imported.get("ok") and imported.get("imported"), "The original source importer did not complete.")
            result["import"] = imported
            request = {**request, "files": [{key: item for key, item in row.items() if key != "response"}
                                           | {"source_file": str(args.destination.absolute() / row["path"])}
                                           for row in request["files"]]}
        if args.source_request:
            _write_once(args.source_request, encoded(request))
            result["source_request"] = str(args.source_request)
        print(json.dumps(result, sort_keys=True))
        return 0
    except Exception as error:
        print(json.dumps({"ok": False, "schema": SCHEMA, "error": type(error).__name__,
                          "detail": str(error)}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
