from __future__ import annotations

import argparse
import json
from pathlib import Path

from .core import CareRelay, CareRelayError, RingEvent, canonical_json
from .receipt import compile_receipt, verify_receipt


def _demo_events() -> list[RingEvent]:
    rows = [
        {
            "schema": "ring-simulator-event/v1",
            "event_id": "evt-001",
            "device_id": "front-door-sim",
            "occurred_at": "2026-09-17T05:00:00Z",
            "event_type": "doorbell",
            "classification": "human",
            "zone": "entry",
        },
        {
            "schema": "ring-simulator-event/v1",
            "event_id": "evt-002",
            "device_id": "hall-sim",
            "occurred_at": "2026-09-17T05:02:00Z",
            "event_type": "motion",
            "classification": "animal",
            "zone": "hall",
        },
        {
            "schema": "ring-simulator-event/v1",
            "event_id": "evt-003",
            "device_id": "front-door-sim",
            "occurred_at": "2026-09-17T05:03:00Z",
            "event_type": "device_status",
            "classification": "none",
            "device_health": "degraded",
        },
    ]
    return [RingEvent.from_mapping(row) for row in rows]


def run_demo() -> tuple[dict, dict]:
    relay = CareRelay()
    for event in _demo_events():
        relay.ingest(event)
    snapshot = relay.snapshot()
    proposals = snapshot["proposals"]
    if proposals:
        relay.approve(proposals[0]["proposal_id"], "demo-human", "approved")
    snapshot = relay.snapshot()
    receipt = compile_receipt(snapshot)
    return snapshot, receipt


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="CareRelay offline demo and receipt verifier")
    sub = parser.add_subparsers(dest="cmd", required=True)
    demo = sub.add_parser("demo")
    demo.add_argument("--out", type=Path)
    verify = sub.add_parser("verify")
    verify.add_argument("state", type=Path)
    verify.add_argument("receipt", type=Path)
    args = parser.parse_args(argv)
    try:
        if args.cmd == "demo":
            state, receipt = run_demo()
            payload = {"state": state, "receipt": receipt}
            text = canonical_json(payload).decode("utf-8") + "\n"
            if args.out:
                args.out.write_text(text, encoding="utf-8")
            else:
                print(text, end="")
            return 0
        state = json.loads(args.state.read_text(encoding="utf-8"))
        receipt = json.loads(args.receipt.read_text(encoding="utf-8"))
        ok = verify_receipt(receipt, state)
        print("VALID" if ok else "INVALID")
        return 0 if ok else 2
    except (CareRelayError, OSError, json.JSONDecodeError) as exc:
        print(f"ERROR: {exc}")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
