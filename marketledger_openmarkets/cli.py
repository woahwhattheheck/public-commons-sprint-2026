from __future__ import annotations

import argparse
import json
import os
import stat
import sys
from pathlib import Path
from typing import Any

from .engine import MarketLedgerError, evaluate_snapshot, stage_action
from .openmarkets import fetch_contest_liquidity, normalize_liquidity_envelope

MAX_INPUT_BYTES = 2_000_000


def _read_json(path_text: str) -> Any:
    path = Path(path_text)
    flags = os.O_RDONLY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        fd = os.open(path, flags)
    except OSError as exc:
        if path.is_symlink():
            raise MarketLedgerError("input path must not be a symlink") from exc
        raise
    owned_fd: int | None = fd
    try:
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode):
            raise MarketLedgerError("input path must be a regular file")
        if st.st_size > MAX_INPUT_BYTES:
            raise MarketLedgerError("input file exceeds size limit")
        with os.fdopen(fd, "r", encoding="utf-8") as handle:
            owned_fd = None
            return json.load(handle)
    finally:
        if owned_fd is not None:
            os.close(owned_fd)


def _write_json(path_text: str, value: Any) -> None:
    body = json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n"
    if path_text == "-":
        sys.stdout.write(body)
        return
    path = Path(path_text)
    parent = path.parent or Path(".")
    if parent.is_symlink() or not parent.exists() or not parent.is_dir():
        raise MarketLedgerError("output parent must be an existing non-symlink directory")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        fd = os.open(path, flags, 0o600)
    except FileExistsError as exc:
        raise MarketLedgerError("output path already exists") from exc
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(body)
    except Exception:
        try:
            path.unlink(missing_ok=True)
        finally:
            raise


def _parse_fee_map(values: list[str]) -> dict[str, str]:
    result: dict[str, str] = {}
    for item in values:
        if "=" not in item:
            raise MarketLedgerError("--fee-bps entries must be PARTNER_ID=BPS")
        partner, value = item.split("=", 1)
        if not partner or partner in result:
            raise MarketLedgerError("fee partner ids must be non-empty and unique")
        result[partner] = value
    return result


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="MarketLedger OpenMarkets evidence CLI")
    sub = parser.add_subparsers(dest="command", required=True)

    norm = sub.add_parser("normalize", help="Normalize a saved OpenMarkets liquidity response")
    norm.add_argument("input")
    norm.add_argument("--fee-bps", action="append", default=[], metavar="PARTNER=BPS")
    norm.add_argument("--fetched-at")
    norm.add_argument("--out", default="-")

    evaluate = sub.add_parser("evaluate", help="Evaluate a MarketLedger snapshot")
    evaluate.add_argument("input")
    evaluate.add_argument("--as-of", required=True)
    evaluate.add_argument("--max-age-seconds", type=int, default=120)
    evaluate.add_argument("--dispersion-threshold-bps", type=int, default=75)
    evaluate.add_argument("--min-available-usd", default="100")
    evaluate.add_argument("--out", default="-")

    live = sub.add_parser("live", help="Read current OpenMarkets liquidity and evaluate it")
    live.add_argument("contest_id")
    live.add_argument("--as-of", required=True)
    live.add_argument("--api-key-env", default="OPENMARKETS_API_KEY")
    live.add_argument("--fee-bps", action="append", default=[], metavar="PARTNER=BPS")
    live.add_argument("--max-age-seconds", type=int, default=120)
    live.add_argument("--dispersion-threshold-bps", type=int, default=75)
    live.add_argument("--min-available-usd", default="100")
    live.add_argument("--out", default="-")

    stage = sub.add_parser("stage", help="Create a data-only human-confirmed action record")
    stage.add_argument("report")
    stage.add_argument("position_hash")
    stage.add_argument("partner_id")
    stage.add_argument("--confirmation-token-env", default="MARKETLEDGER_CONFIRM_TOKEN")
    stage.add_argument("--out", default="-")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.command == "normalize":
            result = normalize_liquidity_envelope(
                _read_json(args.input),
                fee_bps_by_partner=_parse_fee_map(args.fee_bps),
                fetched_at=args.fetched_at,
            )
        elif args.command == "evaluate":
            result = evaluate_snapshot(
                _read_json(args.input), as_of=args.as_of,
                max_age_seconds=args.max_age_seconds,
                dispersion_threshold_bps=args.dispersion_threshold_bps,
                min_available_usd=args.min_available_usd,
            )
        elif args.command == "live":
            api_key = os.environ.get(args.api_key_env, "")
            payload = fetch_contest_liquidity(args.contest_id, api_key)
            snapshot = normalize_liquidity_envelope(payload, fee_bps_by_partner=_parse_fee_map(args.fee_bps), fetched_at=args.as_of)
            result = evaluate_snapshot(
                snapshot, as_of=args.as_of,
                max_age_seconds=args.max_age_seconds,
                dispersion_threshold_bps=args.dispersion_threshold_bps,
                min_available_usd=args.min_available_usd,
            )
        else:
            token = os.environ.get(args.confirmation_token_env, "")
            result = stage_action(_read_json(args.report), position_hash=args.position_hash, partner_id=args.partner_id, confirmation_token=token)
        _write_json(args.out, result)
        return 0
    except (MarketLedgerError, OSError, json.JSONDecodeError) as exc:
        sys.stderr.write(f"marketledger: {exc}\n")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
