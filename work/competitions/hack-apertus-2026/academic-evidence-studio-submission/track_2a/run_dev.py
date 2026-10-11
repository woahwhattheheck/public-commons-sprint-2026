#!/usr/bin/env python3
"""Resume genuine Task B development inference without losing completed cases.

The organizer entrypoint remains main.py. This Linux-only dev runner delegates
every prediction to that same implementation and keeps successful per-case
results on disk. It never retries a failed request within one invocation.
"""
from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
import tempfile
from pathlib import Path

import main as solution


def digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def encode(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), allow_nan=False).encode("utf-8")


def atomic_write(path: Path, data: bytes) -> None:
    name = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as handle:
            name = handle.name
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(name, path)
        name = None
        directory = os.open(path.parent, os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if name is not None:
            Path(name).unlink(missing_ok=True)


def run(input_path: Path, output: Path, checkpoint: Path,
        strategy: str, max_chars: int) -> int:
    input_path = input_path.resolve(strict=True)
    if strategy not in solution.STRATEGIES or max_chars <= 0:
        raise ValueError("invalid strategy or maximum context size")
    # Read once: the manifest and all cases describe the same immutable bytes.
    raw_input = input_path.read_bytes()
    cases = []
    seen = set()
    for line_number, line in enumerate(raw_input.decode("utf-8").splitlines(), 1):
        if not line.strip():
            continue
        case = solution.strict_loads(line)
        if solution.validate_case(case) != "B":
            raise ValueError("run_dev supports Task B reference text only; use main.py for PDFs")
        if case["id"] in seen:
            raise ValueError(f"duplicate case ID at line {line_number}")
        seen.add(case["id"])
        cases.append(case)
    if not cases:
        raise ValueError("no development cases")
    manifest = {
        "version": 1,
        "input_sha256": digest(raw_input),
        "predictor_sha256": digest(Path(solution.__file__).read_bytes()),
        "runner_sha256": digest(Path(__file__).read_bytes()),
        "case_count": len(cases),
        "strategy": strategy,
        "max_context_chars": max_chars,
        "base_url": os.environ.get("BASE_URL") or os.environ.get("LLM_BASE_URL"),
        "model": os.environ.get("MODEL_NAME") or os.environ.get("LLM_NAME") or solution.DEFAULT_MODEL,
        "request_timeout_seconds": os.environ.get("REQUEST_TIMEOUT_SECONDS", "180"),
    }
    # Credentials are deliberately absent from this source/configuration binding.
    checkpoint.mkdir(parents=True, exist_ok=True)
    output.parent.mkdir(parents=True, exist_ok=True)
    with (checkpoint / "run.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise RuntimeError("this checkpoint already has an active runner") from exc
        manifest_path = checkpoint / "manifest.json"
        if manifest_path.exists():
            if solution.strict_loads(manifest_path.read_bytes()) != manifest:
                raise ValueError("checkpoint source, data, model or configuration differs; use a new directory")
        else:
            if any(checkpoint.glob("case-*.json")):
                raise ValueError("checkpoint cases exist without their manifest")
            atomic_write(manifest_path, encode(manifest) + b"\n")
        completed = []
        try:
            for index, case in enumerate(cases):
                path = checkpoint / f"case-{index:06d}.json"
                case_sha = digest(encode(case))
                if path.exists():
                    row = solution.strict_loads(path.read_bytes())
                    if row.get("case_sha256") != case_sha or row["prediction"].get("id") != case["id"]:
                        raise ValueError(f"checkpoint case mismatch at index {index}")
                    prediction = row["prediction"]
                else:
                    prediction = solution.predict_case(case, input_path, input_path.parent,
                                                       strategy, max_chars)
                    atomic_write(path, encode({"case_sha256": case_sha,
                                               "prediction": prediction}) + b"\n")
                completed.append(prediction)
        except Exception:
            # A separate partial file lets evaluate_dev account for the full
            # gold denominator. Never replace a previously complete output.
            atomic_write(checkpoint / "predictions.partial.jsonl",
                         b"".join(encode(row) + b"\n" for row in completed))
            raise
        atomic_write(output, b"".join(encode(row) + b"\n" for row in completed))
        print(json.dumps({"completed": len(completed), "total": len(cases),
                          "output": str(output), "checkpoint": str(checkpoint)}))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--checkpoint-dir", required=True, type=Path)
    parser.add_argument("--strategy", choices=solution.STRATEGIES,
                        default=os.environ.get("CONTEXT_STRATEGY", "full"))
    parser.add_argument("--max-context-chars", type=int,
                        default=int(os.environ.get("MAX_CONTEXT_CHARS", "120000")))
    args = parser.parse_args()
    return run(args.input, args.output, args.checkpoint_dir,
               args.strategy, args.max_context_chars)


if __name__ == "__main__":
    raise SystemExit(main())
