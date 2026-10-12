#!/usr/bin/env python3
# MIT.
"""Receive the complete 43c feed SDK source packet and prepare its original job."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import re
import stat
import sys
import urllib.parse
import urllib.request

HOST = Path("/workspace/scratch/b0285b3810b3/native-shared-queue/current-host")
DECODER_BLOB = "533bfef89138d6685f059bcc2256a380810f05ba"
PACKET_BLOB = "96acd68fbf461ee6b5809a592f0f4de04f1065d4"
PACKET_BYTES = 179947
PREPARATION_BLOB = "92667ebfdda549d8ebd69afeade7b6f8ec5c681b"
PACKET_PATH = ".swarm-delivery/8f43-feed-sdk-b028/source-packet.json"
REPOSITORY = "woahwhattheheck/public-commons-sprint-2026"


def require(value, message):
    if not value:
        raise ValueError(message)


def blob(data):
    return hashlib.sha1(b"blob " + str(len(data)).encode("ascii") + b"\0" + data).hexdigest()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--packet", type=Path, help="Exact complete retained source-packet.json")
    source.add_argument("--source-commit", help="Immutable public commit containing the exact source packet")
    parser.add_argument("--request-sha256", help="Optional previously observed original43c request SHA-256")
    args = parser.parse_args(argv)
    sys.dont_write_bytecode = True
    if args.request_sha256 is not None:
        require(re.fullmatch("[0-9a-f]{64}", args.request_sha256), "Use the full original request SHA-256")
    if args.packet is not None:
        require(stat.S_ISREG(args.packet.lstat().st_mode), "Read the original regular source packet")
        with args.packet.open("rb") as stream:
            data = stream.read(PACKET_BYTES + 1)
    else:
        require(re.fullmatch("[0-9a-f]{40}", args.source_commit), "Use the full immutable public source commit")
        url = "https://raw.githubusercontent.com/" + REPOSITORY + "/" + args.source_commit + "/" + PACKET_PATH
        request = urllib.request.Request(url, headers={"User-Agent": "Commons-original-feed-source-receiving/1"})
        with urllib.request.urlopen(request, timeout=60) as stream:
            final = urllib.parse.urlsplit(stream.geturl())
            require(final.scheme == "https" and final.hostname == "raw.githubusercontent.com" and
                    final.path == urllib.parse.urlsplit(url).path,
                    "Keep the original immutable public source URL")
            data = stream.read(PACKET_BYTES + 1)
    require(len(data) == PACKET_BYTES and blob(data) == PACKET_BLOB,
            "Receive the exact complete published source packet before adoption")
    decoder_path = HOST / "cloud_source_command.py"
    require(stat.S_ISREG(decoder_path.lstat().st_mode), "Use the complete original installed host decoder")
    decoder = decoder_path.read_bytes()
    require(blob(decoder) == DECODER_BLOB, "Retain the maintained source-packet decoder")
    sys.path.insert(0, str(HOST))
    import cloud_source_command
    require(Path(cloud_source_command.__file__).resolve() == decoder_path.resolve(),
            "Use the decoder from the complete selected host")
    payload = cloud_source_command.decode_packet(json.loads(data))
    selected = payload["preparation"]
    code = selected["source"].encode("utf-8")
    require(selected["sha"] == PREPARATION_BLOB and len(code) == selected["bytes"] and
            blob(code) == PREPARATION_BLOB, "Use the complete reviewed source-preparation caller")
    module = {"__name__": "_original_feed_sdk_source_adoption",
              "__file__": "<original-feed-sdk-source-adoption>"}
    exec(compile(code, module["__file__"], "exec"), module)
    outcome = module["prepare"](payload, expected_request_sha256=args.request_sha256)
    print(json.dumps(outcome, sort_keys=True), flush=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(130)
    except (OSError, ValueError, KeyError, TypeError, ImportError, RuntimeError) as error:
        try:
            print(json.dumps({"schema": "stellar-forge.feed-mcp-sdk-source-adoption.v1",
                "state": "ORIGINAL_SOURCE_RETAINED", "error": type(error).__name__,
                "message": str(error)}), file=sys.stderr, flush=True)
        except OSError:
            pass
        raise SystemExit(2)
