"""Explicit preparation, review, one native purchase, recovery, and local export."""
from __future__ import annotations

import argparse
import json
import os
import sys

from . import TenderlyCustomer, TenderlyResult, TenderlySimulationRequest
from ._storage import TenderlyError, read, require, sha256
from .models import MAX_BODY_BYTES
from .selection import load_selection


def _print(value) -> None:
    print(json.dumps(value, ensure_ascii=False, allow_nan=False, indent=2))


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("prepare", "review", "execute", "recover", "export", "inspect", "finalize", "accounting", "list"):
        command = commands.add_parser(name)
        command.add_argument("--checkout", default=os.environ.get("STELLAR_FORGE_CHECKOUT"),
                             help="root of the matching original Node source release")
        command.add_argument("--state-dir", required=True, help="original private Python buyer application state")
        command.add_argument("--node", default="node")
        command.add_argument("--timeout", type=int, default=360, help="original native runtime deadline in seconds")
        if name not in ("prepare", "list"):
            command.add_argument("--intent-id", "--intent", dest="intent", required=True)
        if name in ("recover", "execute"):
            command.add_argument("--export", dest="export_directory", help="new complete analyst-export directory")
        if name == "export":
            command.add_argument("--output", "--out", dest="out", required=True, help="new complete analyst-export directory")
        if name == "finalize":
            command.add_argument("--outbox")
            command.add_argument("--merchant-route")
        if name == "prepare":
            source = command.add_mutually_exclusive_group(required=True)
            source.add_argument("--config", help="existing native SF88 POST configuration")
            source.add_argument("--workspace", help="existing native SF88 operator workspace")
            source.add_argument("--handoff", help="original private merchant-operation handoff")
            source.add_argument("--discovery", help="original saved SF88 catalog discovery")
            command.add_argument("--request", required=True, help="exact seven-field merchant JSON body")
            command.add_argument("--selection", help="public customer selection exported from the reviewed merchant plan")
            command.add_argument("--network-id", "--network", dest="network_id", help="advanced explicit EVM network when selection is unavailable")
            command.add_argument("--intent-id", "--intent", dest="intent", help="explicit original intent for workspace or catalog preparation")
            command.add_argument("--row", type=int, help="exact selected catalog row")
            command.add_argument("--accept", type=int, help="exact selected payment option")
            command.add_argument("--url", help="exact merchant POST URL for the selected catalog offer")
            command.add_argument("--operator-profile", "--profile", dest="profile", help="original private operator and signer configuration")
            command.add_argument("--max-response-bytes", type=int)
            command.add_argument("--response-timeout-ms", type=int)
            command.add_argument("--request-timeout-ms", type=int)
    opened = commands.add_parser("open-export", help="local analyst read without buyer, Node, wallet, or network")
    opened.add_argument("directory")
    request = commands.add_parser("request", help="inspect the exact merchant body and explicit EVM context locally")
    request.add_argument("--request", required=True)
    request.add_argument("--selection", help="public selection from the reviewed merchant plan")
    request.add_argument("--network-id", "--network", dest="network_id")
    return parser


def _request(args):
    selected = load_selection(args.selection)
    network = args.network_id if args.network_id is not None else selected["networkId"] if selected else None
    require(network is not None, "CUSTOMER_SELECTION_OR_EXPLICIT_NETWORK_REQUIRED")
    require(selected is None or selected["networkId"] == network, "CUSTOMER_SELECTION_NETWORK_MISMATCH")
    body = read(args.request, MAX_BODY_BYTES)
    request = TenderlySimulationRequest.from_bytes(body, network_id=network)
    return body, request, selected


def _run(args) -> int:
    if args.command == "open-export":
        _print(TenderlyResult.open_export(args.directory).describe())
        return 0
    if args.command == "request":
        body, request, selected = _request(args)
        _print({"expected": request.expected, "bodyBytes": len(body), "bodySha256": sha256(body),
                "simulationRequest": request.provider_context(), "selection": selected})
        return 0
    require(args.checkout is not None, "MATCHING_ORIGINAL_CHECKOUT_REQUIRED")
    customer = TenderlyCustomer(checkout=args.checkout, state_dir=args.state_dir,
                                node=args.node, timeout=args.timeout)
    if args.command == "prepare":
        body, request, selected = _request(args)
        if args.config:
            require(args.intent is None, "CONFIG_RETAINS_ITS_ORIGINAL_INTENT")
            operation = customer.from_config(args.config, request=request, request_body=body, selection=selected)
        elif args.workspace:
            operation = customer.from_workspace(args.workspace, request=request, intent_id=args.intent,
                                                request_body=body, selection=selected)
        elif args.handoff:
            require(args.intent is None, "HANDOFF_RETAINS_ITS_ORIGINAL_INTENT")
            require(args.accept is not None, "EXPLICIT_PAYMENT_OPTION_REQUIRED")
            operation = customer.from_operation_handoff(args.handoff, accept=args.accept, request=request, selection=selected)
        else:
            require(args.row is not None and args.accept is not None and args.intent is not None
                    and (args.url is not None or selected is not None),
                    "EXPLICIT_CATALOG_ROW_PAYMENT_OPTION_INTENT_AND_URL_REQUIRED")
            operation = customer.prepare(args.discovery, row=args.row, accept=args.accept, intent_id=args.intent,
                url=args.url, request=request, request_body=body, selection=selected)
        options = {name: getattr(args, name) for name in
                   ("max_response_bytes", "response_timeout_ms", "request_timeout_ms") if getattr(args, name) is not None}
        if args.profile is not None or options:
            operation.configure(args.profile, **options)
        _print(operation.inspect())
        return 0
    if args.command == "list":
        _print({"operations": [operation.inspect() for operation in customer.list_operations()]})
        return 0
    operation = customer.operation(args.intent)
    if args.command == "inspect":
        _print(operation.inspect())
    elif args.command == "review":
        review = operation.review()
        _print({"request": operation.request_document(config_sha256=review.config_sha256),
                "nativeReview": review.native, "reviewFile": str(operation.directory / "review.json")})
    elif args.command in ("execute", "recover", "export"):
        result = operation.execute(review=operation.saved_review()) if args.command == "execute" else operation.recover()
        if result is None:
            _print({"result": None, "operation": operation.inspect()})
            return 2
        output = result.describe()
        destination = args.out if args.command == "export" else args.export_directory
        if destination:
            output["exportDirectory"] = str(result.export(destination))
        _print(output)
    elif args.command == "finalize":
        options = {}
        if args.outbox is not None or args.merchant_route is not None:
            require(args.outbox is not None and args.merchant_route is not None,
                    "ORIGINAL_OUTBOX_AND_MERCHANT_ROUTE_REQUIRED_TOGETHER")
            options = {"outbox": args.outbox, "merchant_route": args.merchant_route}
        result = operation.finalize(**options)
        _print(result.record)
        return 0 if result.finalized else 2
    elif args.command == "accounting":
        result = operation.recover_finalization()
        _print(result.record if result else {"accounting": None})
    return 0


def main() -> int:
    args = _parser().parse_args()
    try:
        return _run(args)
    except (TenderlyError, OSError) as error:
        _print({"error": str(error) if isinstance(error, TenderlyError) else type(error).__name__})
        return 2
    except ImportError:
        _print({"error": "INSTALL_MATCHING_ORIGINAL_STELLAR_FORGE_BUYER_PACKAGE"})
        return 2
    except Exception as error:
        # Native SDK errors expose constant codes. Preserve them without dumping
        # private configurations, arbitrary provider bodies, or environment data.
        code = getattr(error, "code", None)
        if isinstance(code, str):
            _print({"error": code, "returncode": getattr(error, "returncode", None)})
            return 2
        raise


if __name__ == "__main__":
    sys.exit(main())
