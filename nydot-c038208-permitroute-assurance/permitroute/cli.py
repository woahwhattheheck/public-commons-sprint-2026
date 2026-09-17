from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any

from .core import (
    PermitEvent, PermitRecord, PermitRouteError, ReplayLedger,
    canonical_json, compare_batches, strict_json_loads,
)
from .receipt import compile_receipt, verify_receipt

def synthetic_records() -> tuple[list[PermitRecord], list[PermitRecord]]:
    legacy_rows = [
        {
            "schema": "permitroute-record/v1",
            "permit_id": "HWP-0001",
            "applicant_ref": "app-1001",
            "district": "1",
            "permit_type": "utility",
            "status": "district_review",
            "submitted_at": "2026-09-01T13:00:00Z",
            "updated_at": "2026-09-05T14:00:00Z",
            "route_agencies": ["DOT-D1", "UTILITY-A"],
            "reviews": [
                {"agency": "UTILITY-A", "decision": "approved", "decided_at": "2026-09-04T16:00:00Z"},
                {"agency": "DOT-D1", "decision": "pending"},
            ],
            "attachment_digests": ["a" * 64],
            "source_system": "legacy-demo",
        },
        {
            "schema": "permitroute-record/v1",
            "permit_id": "HWP-0002",
            "applicant_ref": "app-1002",
            "district": "2",
            "permit_type": "driveway",
            "status": "approved",
            "submitted_at": "2026-08-20T12:00:00Z",
            "updated_at": "2026-09-03T12:00:00Z",
            "route_agencies": ["DOT-D2"],
            "reviews": [
                {"agency": "DOT-D2", "decision": "approved", "decided_at": "2026-09-03T11:00:00Z"}
            ],
            "attachment_digests": ["b" * 64],
            "source_system": "legacy-demo",
        },
    ]
    target_rows = [
        dict(legacy_rows[0]),
        {**legacy_rows[1], "district": "3", "source_system": "target-demo"},
    ]
    target_rows[0] = {**target_rows[0], "source_system": "target-demo"}
    return (
        [PermitRecord.from_mapping(row) for row in legacy_rows],
        [PermitRecord.from_mapping(row) for row in target_rows],
    )

def synthetic_replay() -> dict[str, Any]:
    rows = [
        {
            "schema": "permitroute-event/v1",
            "event_id": "evt-001",
            "permit_id": "HWP-0003",
            "occurred_at": "2026-09-10T10:00:00Z",
            "from_status": "draft",
            "to_status": "submitted",
            "actor_role": "applicant",
        },
        {
            "schema": "permitroute-event/v1",
            "event_id": "evt-002",
            "permit_id": "HWP-0003",
            "occurred_at": "2026-09-10T11:00:00Z",
            "from_status": "submitted",
            "to_status": "triage",
            "actor_role": "intake",
        },
        {
            "schema": "permitroute-event/v1",
            "event_id": "evt-003",
            "permit_id": "HWP-0003",
            "occurred_at": "2026-09-10T12:00:00Z",
            "from_status": "triage",
            "to_status": "district_review",
            "actor_role": "router",
        },
    ]
    ledger = ReplayLedger()
    ledger.seed("HWP-0003")
    for row in rows:
        ledger.apply(PermitEvent.from_mapping(row))
    return ledger.snapshot()

def run_demo() -> dict[str, Any]:
    legacy, target = synthetic_records()
    diff = compare_batches(legacy, target)
    replay = synthetic_replay()
    receipt = compile_receipt(batch_diff=diff, replay=replay)
    return {"batch_diff": diff, "replay": replay, "receipt": receipt}

def _load_records(path: Path) -> list[PermitRecord]:
    raw = strict_json_loads(path.read_bytes())
    if not isinstance(raw, list):
        raise PermitRouteError("record input must be a JSON list")
    return [PermitRecord.from_mapping(item) for item in raw]

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="PermitRoute migration/replay assurance")
    sub = parser.add_subparsers(dest="cmd", required=True)
    demo = sub.add_parser("demo")
    demo.add_argument("--out", type=Path)
    compare = sub.add_parser("compare")
    compare.add_argument("legacy", type=Path)
    compare.add_argument("target", type=Path)
    verify = sub.add_parser("verify")
    verify.add_argument("bundle", type=Path)
    args = parser.parse_args(argv)
    try:
        if args.cmd == "demo":
            bundle = run_demo()
            text = canonical_json(bundle).decode("utf-8") + "\n"
            if args.out:
                args.out.write_text(text, encoding="utf-8")
            else:
                print(text, end="")
            return 0
        if args.cmd == "compare":
            diff = compare_batches(_load_records(args.legacy), _load_records(args.target))
            print(canonical_json(diff).decode("utf-8"))
            return 0 if diff["different_count"] == diff["legacy_only_count"] == diff["target_only_count"] == 0 else 3
        bundle = strict_json_loads(args.bundle.read_bytes())
        if not isinstance(bundle, dict):
            raise PermitRouteError("bundle must be an object")
        ok = verify_receipt(
            bundle.get("receipt"),
            batch_diff=bundle.get("batch_diff"),
            replay=bundle.get("replay"),
        )
        print("VALID" if ok else "INVALID")
        return 0 if ok else 2
    except (PermitRouteError, OSError, TypeError, KeyError) as exc:
        print(f"ERROR: {exc}")
        return 2

if __name__ == "__main__":
    raise SystemExit(main())
