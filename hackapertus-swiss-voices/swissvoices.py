#!/usr/bin/env python3
"""Swiss Voices: reproducible, human-reviewed Apertus localization evaluations.

Stdlib-only; no third-party SDK, no network access except explicit `run`.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import pathlib
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent
CASES = ROOT / "data" / "cases.jsonl"
SUPPORTED = {"de-CH", "fr-CH", "it-CH"}


def canon(o):
    return json.dumps(o, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def digest(o):
    return hashlib.sha256(canon(o).encode("utf-8")).hexdigest()


def load_jsonl(path):
    if not pathlib.Path(path).exists():
        return []
    rows = []
    for n, line in enumerate(pathlib.Path(path).read_text(encoding="utf-8").splitlines(), 1):
        if line.strip():
            try:
                rows.append(json.loads(line))
            except ValueError as e:
                raise ValueError(f"{path}:{n}: {e}") from e
    return rows


def append_jsonl(path, row):
    path = pathlib.Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
    with os.fdopen(fd, "a", encoding="utf-8") as file:
        file.write(canon(row) + "\n")


def read_cases():
    rows = load_jsonl(CASES)
    assert rows, "No localization cases available"
    ids = set()
    for row in rows:
        assert row["id"] not in ids, f"Duplicate case ID: {row['id']}"
        ids.add(row["id"])
        assert row["locale"] in SUPPORTED, row["id"]
        assert row["prompt"].strip() and row["rubric"].strip(), row["id"]
        assert row.get("source") == "original-synthetic", row["id"]
    return rows


def endpoint_url(endpoint, allow_local_http):
    parsed = urllib.parse.urlparse(endpoint)
    if parsed.scheme != "https":
        if not (allow_local_http and parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "localhost", "::1"}):
            raise ValueError("Inference requires HTTPS, or --allow-local-http with loopback host")
    if parsed.username or parsed.password or parsed.fragment or not parsed.netloc:
        raise ValueError("Endpoint cannot include credentials, fragment, or empty host")
    if not re.match(r"^/v1/chat/completions/?$", parsed.path):
        raise ValueError("Pass an OpenAI-compatible /v1/chat/completions endpoint")
    return endpoint


def request_case(endpoint, model, case, api_key, timeout):
    messages = [
        {"role": "system", "content": "Respond to the user in the same Swiss locale and language as their prompt. Avoid ungrounded certainty. Do not invent sources."},
        {"role": "user", "content": case["prompt"]},
    ]
    payload = {"model": model, "messages": messages, "temperature": 0, "max_tokens": 450}
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if api_key:
        headers["Authorization"] = "Bearer " + api_key
    request = urllib.request.Request(endpoint, method="POST", data=canon(payload).encode("utf-8"), headers=headers)
    started = time.monotonic()
    try:
        with urllib.request.urlopen(request, timeout=timeout) as stream:
            raw = stream.read(2 * 1024 * 1024 + 1)
            if len(raw) > 2 * 1024 * 1024:
                raise ValueError("Response too large")
            obj = json.loads(raw)
        content = obj["choices"][0]["message"]["content"]
        if not isinstance(content, str):
            raise ValueError("Non-text completion returned")
        return {"status": "ok", "response": content, "latency_ms": int((time.monotonic() - started) * 1000), "request_sha256": digest(payload)}
    except urllib.error.HTTPError as e:
        # Deliberately omit provider error bodies; these can echo request headers.
        return {"status": "http_error", "http_status": int(e.code), "request_sha256": digest(payload)}
    except (urllib.error.URLError, TimeoutError, ValueError, KeyError, IndexError, TypeError, json.JSONDecodeError) as e:
        return {"status": "request_error", "error_type": type(e).__name__, "request_sha256": digest(payload)}


def cmd_cases(args):
    rows = read_cases()
    print(f"{len(rows)} original cases: " + ", ".join(f"{loc}={sum(r['locale']==loc for r in rows)}" for loc in sorted(SUPPORTED)))
    if args.show:
        for c in rows:
            print(f"{c['id']} [{c['locale']}] {c['prompt']}")


def cmd_run(args):
    endpoint = endpoint_url(args.endpoint, args.allow_local_http)
    if args.api_key_env and args.api_key_env not in os.environ:
        raise ValueError(f"Missing environment variable {args.api_key_env}; no requests sent")
    api_key = os.getenv(args.api_key_env, "") if args.api_key_env else ""
    rows = read_cases()
    if args.ids:
        ids = set(args.ids.split(","))
        if ids - {c["id"] for c in rows}:
            raise ValueError(f"Unknown case IDs: {sorted(ids - {c['id'] for c in rows})}")
        rows = [c for c in rows if c["id"] in ids]
    if args.limit:
        rows = rows[:args.limit]
    output = pathlib.Path(args.output)
    if output.exists() and output.stat().st_size:
        raise ValueError("Refusing to append into an existing result file; choose a new output to avoid mixed runs")
    print(f"Running {len(rows)} prompts with {args.model}; results -> {output}", file=sys.stderr)
    for row in rows:
        evidence = request_case(endpoint, args.model, row, api_key, args.timeout)
        record = {"case_id": row["id"], "case_sha256": digest(row), "model": args.model, "endpoint_host": urllib.parse.urlparse(endpoint).hostname, "utc": dt.datetime.now(dt.timezone.utc).isoformat(), **evidence}
        record["evidence_sha256"] = digest(record)
        append_jsonl(output, record)
        print(f"{row['id']}: {record['status']}", file=sys.stderr)


def verify_run(rows, cases):
    ids = {x["id"]: x for x in cases}
    valid = {}
    for row in rows:
        ident = row["case_id"]
        if ident not in ids or row["case_sha256"] != digest(ids[ident]):
            raise ValueError(f"Unknown or changed case {ident}")
        stored = dict(row)
        expected = stored.pop("evidence_sha256", None)
        if expected != digest(stored):
            raise ValueError(f"Evidence digest mismatch for {ident}")
        if ident in valid:
            raise ValueError(f"Duplicate result for {ident}; use one run per file")
        valid[ident] = row
    return valid


def cmd_review(args):
    cases = read_cases()
    results = verify_run(load_jsonl(args.results), cases)
    if args.case_id not in results or results[args.case_id]["status"] != "ok":
        raise ValueError("Only a successfully generated response can be reviewed")
    if not args.reviewer.strip() or not args.notes.strip():
        raise ValueError("Reviewer ID and notes must be nonempty")
    reviews = load_jsonl(args.reviews)
    if any(r["case_id"] == args.case_id and r["evidence_sha256"] == results[args.case_id]["evidence_sha256"] for r in reviews):
        raise ValueError("Existing review for this evidence; edit with a separate superseding review process")
    entry = {"case_id": args.case_id, "evidence_sha256": results[args.case_id]["evidence_sha256"], "verdict": args.verdict, "reviewer": args.reviewer, "notes": args.notes, "utc": dt.datetime.now(dt.timezone.utc).isoformat()}
    entry["review_sha256"] = digest(entry)
    append_jsonl(args.reviews, entry)
    print(f"Appended human verdict for {args.case_id} to {args.reviews}")


def cmd_report(args):
    cases = read_cases()
    results = verify_run(load_jsonl(args.results), cases)
    reviews = load_jsonl(args.reviews)
    active = {}
    for rev in reviews:
        stored = dict(rev)
        checksum = stored.pop("review_sha256", None)
        if checksum != digest(stored):
            raise ValueError("Review record digest mismatch")
        ident = rev["case_id"]
        if ident not in results or rev["evidence_sha256"] != results[ident]["evidence_sha256"] or ident in active:
            raise ValueError(f"Stale, unknown, or duplicate review for {ident}")
        if results[ident]["status"] != "ok":
            raise ValueError(f"Cannot review failed response {ident}")
        active[ident] = rev
    per_locale = {}
    for loc in sorted(SUPPORTED):
        subset = [c for c in cases if c["locale"] == loc]
        ids = {c["id"] for c in subset}
        per_locale[loc] = {"cases": len(subset), "attempted": len(ids & results.keys()), "model_responses": sum(results[i]["status"] == "ok" for i in ids & results.keys()), "human_reviewed": len(ids & active.keys()), "passed": sum(active[i]["verdict"] == "pass" for i in ids & active.keys()), "failed": sum(active[i]["verdict"] == "fail" for i in ids & active.keys()), "needs_review": sum(active[i]["verdict"] == "uncertain" for i in ids & active.keys())}
    report = {"generated_utc": dt.datetime.now(dt.timezone.utc).isoformat(), "corpus_sha256": digest(cases), "model_inference_verified": any(r["status"] == "ok" for r in results.values()), "human_review_verified": bool(active), "score_denominator": "human_reviewed_only", "by_locale": per_locale, "results_file": str(args.results), "reviews_file": str(args.reviews), "note": "Scores describe recorded human judgment, not ground-truth model safety, locale fluency, or verified competition acceptance."}
    print(json.dumps(report, indent=2, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("cases", help="Validate and show authored multilingual cases")
    p.add_argument("--show", action="store_true")
    p.set_defaults(func=cmd_cases)
    p = sub.add_parser("run", help="Run live model inference; makes paid/network requests ONLY when invoked")
    p.add_argument("--endpoint", required=True, help="Full HTTPS chat completions URL")
    p.add_argument("--model", required=True, help="Exact Apertus model ID returned by chosen provider")
    p.add_argument("--api-key-env", default="APERTUS_API_KEY", help="Env var name, not the key itself; blank for unauthenticated localhost")
    p.add_argument("--output", default="out/results.jsonl")
    p.add_argument("--ids", help="Comma-separated case IDs")
    p.add_argument("--limit", type=int, help="Maximum cases")
    p.add_argument("--timeout", type=float, default=40.0)
    p.add_argument("--allow-local-http", action="store_true", help="Allow unencrypted localhost endpoint only")
    p.set_defaults(func=cmd_run)
    p = sub.add_parser("review", help="Append independent review of one live response")
    p.add_argument("--results", required=True)
    p.add_argument("--reviews", default="out/reviews.jsonl")
    p.add_argument("--case-id", required=True)
    p.add_argument("--verdict", choices=("pass", "fail", "uncertain"), required=True)
    p.add_argument("--reviewer", required=True)
    p.add_argument("--notes", required=True)
    p.set_defaults(func=cmd_review)
    p = sub.add_parser("report", help="Aggregate only verified evidence and reviewer labels")
    p.add_argument("--results", default="out/results.jsonl")
    p.add_argument("--reviews", default="out/reviews.jsonl")
    p.set_defaults(func=cmd_report)
    args = parser.parse_args()
    try:
        args.func(args)
    except (ValueError, AssertionError) as e:
        parser.error(str(e))


if __name__ == "__main__":
    main()
