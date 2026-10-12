#!/usr/bin/env python3
"""Resume the retained installed S3 operation through its maintained native foreground."""
import argparse
import json
import pathlib
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, help="Original private input JSON")
    parser.add_argument("--host-root", required=True, help="Complete selected maintained native runtime")
    parser.add_argument("--expected-runtime-sha256", required=True)
    parser.add_argument("--recover-failure", help="Exact retained original recoverable failure SHA")
    args = parser.parse_args()
    input_path = pathlib.Path(args.input).resolve(strict=True)
    request = json.loads(input_path.read_text())
    if request.get("schema") != "stellar-forge.s3-installed-receiving-input.v1":
        raise ValueError("Select the original installed-receiving input")
    root = pathlib.Path(request["root"]).resolve(strict=True)
    if input_path.parent != root:
        raise ValueError("Keep the original input in its retained receiving root")
    host = pathlib.Path(args.host_root).resolve(strict=True)
    sys.path.insert(0, str(host))
    from native_foreground import load_native, resume_foreground
    from native_runtime_handoff import runtime_identity
    native = load_native(str(host))
    identity = runtime_identity(native)
    if identity.get("sha256") != args.expected_runtime_sha256:
        raise RuntimeError("The complete selected native runtime identity changed")
    operation = request["operationId"]
    records = str(root / "native-records")
    record = native.run_path(operation, records)
    if not (record / "request.json").is_file():
        raise RuntimeError("Select the existing original native operation; resume does not start one")
    report = native.inspect(record)
    failure = report.get("failure_recovery") or {}
    if args.recover_failure:
        if failure.get("can_recover") is not True or failure.get("failure_sha256") != args.recover_failure:
            raise RuntimeError("The selected recoverable failure no longer matches the original record")
    print(json.dumps({
        "operation": operation,
        "runtime_sha256": identity["sha256"],
        "original_state": report.get("state"),
        "failure_recovery": failure,
        "continuation": "original foreground resume-memory",
    }), flush=True)
    return resume_foreground(
        native, operation, records, action="resume-memory",
        recover_failure=args.recover_failure, report_format="summary",
    )


if __name__ == "__main__":
    main()
