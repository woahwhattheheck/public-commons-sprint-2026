#!/usr/bin/env python3
"""One private desk operation through the original SF101 access/receiver APIs.

The parent owns the state and export paths. Credentials arrive only in this
child's environment; the JSON protocol contains names, never token values.
There is no listener, alternative order store, or payment operation here.
"""
from __future__ import annotations

from contextlib import redirect_stdout
import io
import json
import os
from pathlib import Path
import re
import sqlite3
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


class DeskError(Exception):
    pass


def need(condition, code):
    if not condition:
        raise DeskError(code)


def fields(value, required, optional=()):
    need(isinstance(value, dict), "DESK_OBJECT_REQUIRED")
    need(set(required).issubset(value) and set(value).issubset(set(required) | set(optional)),
         "DESK_OPERATION_FIELDS_INVALID")


def original_cli(module, args):
    # The original CLI owns the receipt/status representation and create-only
    # output. Capture its one result without forwarding native exception text.
    output = io.StringIO()
    with redirect_stdout(output):
        module.main(args)
    value = json.loads(output.getvalue())
    need(isinstance(value, dict), "ORIGINAL_RECEIVER_RESULT_INVALID")
    return value


def perform(request, access, receiver):
    fields(request, ("action", "state", "arguments"))
    need(isinstance(request["action"], str), "DESK_ACTION_INVALID")
    action, args = request["action"], request["arguments"]
    raw_state = request["state"]
    need(isinstance(raw_state, str) and raw_state.startswith("/") and raw_state != "/" and
         os.path.normpath(raw_state) == raw_state and not any(ord(c) < 32 or ord(c) == 127 for c in raw_state),
         "NORMALIZED_PRIVATE_PATH_REQUIRED")
    state = Path(raw_state)
    if action in ("recovery-create", "recovery-inspect", "recovery-restore"):
        fields(args, ("output",), ("destination",))
        if action == "recovery-restore":
            need("destination" in args, "RECOVERY_DESTINATION_REQUIRED")
        else:
            need("destination" not in args, "RECOVERY_DESTINATION_ONLY_FOR_RESTORE")
        import hashlib
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "recovery"))
        import merchant_snapshot
        output = Path(args["output"])
        if action == "recovery-create" and not output.exists():
            result = merchant_snapshot.create_snapshot(state, output)
            result["status"] = "MERCHANT_SNAPSHOT_CREATED"
            return result
        need(output.is_dir() and not output.is_symlink(), "MERCHANT_SNAPSHOT_NOT_FOUND")
        need((output / "snapshot.json").is_file(), "MERCHANT_SNAPSHOT_INCOMPLETE")
        inspected = merchant_snapshot.inspect_snapshot(output)
        manifest = inspected["manifest"]
        need(manifest.get("sourceStateDigest") == hashlib.sha256(str(state).encode("utf-8")).hexdigest(),
             "RECOVERY_MERCHANT_MISMATCH")
        if action == "recovery-restore":
            destination = Path(args["destination"])
            if destination.exists():
                need(destination.is_dir() and not destination.is_symlink(), "RECOVERY_DESTINATION_EXISTS")
                receiver.require_private_dir(str(destination))
                saved = destination / "restoration.json"
                need(saved.is_file() and not saved.is_symlink() and saved.stat().st_size < 16384,
                     "RECOVERY_DESTINATION_EXISTS")
                need(saved.stat().st_mode & 0o077 == 0, "RECOVERY_DESTINATION_EXISTS")
                receipt = json.loads(saved.read_text("utf-8"))
                need(receipt.get("snapshotManifestSha256") == inspected["manifestSha256"] and
                     receipt.get("state") == str(destination), "RECOVERY_DESTINATION_EXISTS")
                return {**receipt, "status": "MERCHANT_RESTORATION_REOPENED"}
            return {**merchant_snapshot.restore_snapshot(output, destination),
                    "status": "MERCHANT_SNAPSHOT_RESTORED"}
        return {"schema": merchant_snapshot.SCHEMA,
                "status": "MERCHANT_SNAPSHOT_REOPENED" if action == "recovery-create" else "MERCHANT_SNAPSHOT_VERIFIED",
                "snapshot": str(output), "createdAt": manifest["createdAt"],
                "manifestSha256": inspected["manifestSha256"],
                "databaseSha256": manifest["database"]["sha256"],
                "orders": len(manifest["orders"]),
                "uniquePaidFiles": len({item["sha256"] for item in manifest["orders"]})}
    state = receiver.require_private_dir(raw_state)
    if action == "status":
        fields(args, ())
        return original_cli(receiver, ["status", "--state=" + str(state)])
    if action == "list":
        fields(args, (), ("after", "limit", "status"))
        limit = args.get("limit", 100)
        need(type(limit) is int, "LIMIT_MUST_BE_1_TO_500")
        return access.list_orders(state, after=args.get("after"), limit=limit,
                                  status=args.get("status", "all"))
    if action in ("show", "verify-file"):
        fields(args, ("ref",))
        return access.show_order(state, args["ref"]) if action == "show" else access.verify_file(state, args["ref"])
    if action == "support":
        fields(args, ("output",))
        return access.export_support(state, args["output"])
    if action == "receipt":
        fields(args, ("ref", "output"))
        # The API can give a precise actionable conflict before invoking the
        # unchanged original receipt writer. It never invents an entitlement.
        detail = access.show_order(state, args["ref"])
        need(detail["order"]["nativeState"] == "ENTITLED", "ORDER_NOT_ENTITLED")
        return original_cli(receiver, ["receipt", "--state=" + str(state), "--ref=" + args["ref"], "--out=" + args["output"]])
    if action == "access":
        fields(args, ("ref", "expectedRevision", "operationId", "actor", "reason", "action"),
               ("expiresAt", "claimEnv"))
        need(type(args["expectedRevision"]) is int, "INVALID_EXPECTED_REVISION")
        if args["action"] != "rotate-token":
            need("claimEnv" not in args, "CLAIM_ENV_ONLY_FOR_TOKEN_ROTATION")
        if args["action"] != "expire":
            need("expiresAt" not in args, "EXPIRY_ONLY_FOR_EXPIRE_ACTION")
        return access.change_access(
            state, ref=args["ref"], expected_revision=args["expectedRevision"],
            operation_id=args["operationId"], actor=args["actor"], reason=args["reason"],
            action=args["action"], expires_at=args.get("expiresAt"), token_env=args.get("claimEnv"),
        )
    raise DeskError("DESK_ACTION_INVALID")


def main():
    os.umask(0o077)
    try:
        import access
        import receiver
    except ImportError:
        print('{"ok":false,"error":"ORIGINAL_ACCESS_SOURCE_REQUIRED"}')
        return 2
    try:
        raw = sys.stdin.buffer.read(32769)
        need(len(raw) <= 32768, "DESK_INPUT_TOO_LARGE")
        request = json.loads(raw.decode("utf-8"))
        result = perform(request, access, receiver)
        print(json.dumps({"ok": True, "result": result}, separators=(",", ":"), ensure_ascii=False))
        return 0
    except (DeskError, access.AccessError) as error:
        code = str(error)
        if not re.fullmatch(r"[A-Z][A-Z0-9_]{1,100}", code):
            code = "ORIGINAL_ACCESS_OPERATION_FAILED"
    except FileExistsError:
        code = "EXPORT_ALREADY_EXISTS"
    except sqlite3.IntegrityError:
        code = "ORIGINAL_STORE_CONFLICT"
    except (OSError, ValueError, TypeError, KeyError, sqlite3.Error):
        code = "ORIGINAL_STORE_OR_INPUT_UNAVAILABLE"
    except Exception:
        code = "ORIGINAL_ACCESS_OPERATION_FAILED"
    print(json.dumps({"ok": False, "error": code}, separators=(",", ":")))
    return 2


if __name__ == "__main__":
    sys.exit(main())
