#!/usr/bin/env python3
"""MIT. Amberdata page and summary customers using the original SF88 Python Buyer."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
from urllib.parse import urlencode, urlsplit

PAGE_SCHEMA = "stellar-forge.amberdata-page.v1"
SUMMARY_SCHEMA = "stellar-forge.amberdata-ohlcv-summary.v1"
ORIGINAL_BUYER = Path("stellar/scf-starforge-20261009/sf88-operator-buyer-cli")
ROUTES = {
    "spot_instruments": ("GET", "/spot/instruments"),
    "spot_ohlcv": ("GET", "/spot/ohlcv"),
    "ohlcv_summary": ("POST", "/research/ohlcv-summary"),
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def strict_json(raw):
    def pairs(items):
        value = {}
        for key, item in items:
            require(key not in value, "Duplicate JSON object key.")
            value[key] = item
        return value

    def constant(_):
        raise ValueError("Non-finite JSON value.")

    return json.loads(raw, object_pairs_hook=pairs, parse_constant=constant)


def json_file(path, limit=1_048_576):
    fd = os.open(Path(path).expanduser().absolute(), os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as source:
        before = os.fstat(source.fileno())
        require(stat.S_ISREG(before.st_mode) and before.st_size <= limit,
                "Expected a regular JSON file within the input limit.")
        raw = source.read(limit + 1)
        require(len(raw) == before.st_size and len(raw) <= limit, "The selected JSON file changed while reading.")
    return strict_json(raw.decode("utf-8", errors="strict"))


def inspect_product(product):
    """Bind the merchant's compiled product.json; original offers supply payment terms."""
    require(isinstance(product, dict) and product.get("schema") == "stellar-forge.amberdata-research-plan.v1",
            "Expected the merchant product.json.")
    require(isinstance(product.get("selectionSha256"), str)
            and re.fullmatch(r"[a-f0-9]{64}", product["selectionSha256"]), "The compiled product selection is required.")
    selected = {key: product.get(key) for key in ("provider", "window", "units", "limits")}
    require(all(isinstance(value, dict) for value in selected.values()), "The complete product selection is required.")
    require(hashlib.sha256(canonical(selected).encode("utf-8")).hexdigest() == product["selectionSha256"],
            "The retained product selection changed.")
    origin = urlsplit(product.get("publicOrigin", ""))
    require(origin.scheme == "https" and bool(origin.hostname) and not origin.username and not origin.password
            and not origin.path and not origin.query and not origin.fragment,
            "Expected the selected canonical HTTPS merchant origin.")
    return product


def inspect_page(value, product, operation=None):
    """Read envelope identity; provider numeric tokens stay untouched in its body string."""
    inspect_product(product)
    require(isinstance(value, dict) and value.get("schema") == PAGE_SCHEMA
            and value.get("operation") in ("spot_instruments", "spot_ohlcv"),
            "Expected a complete retained Amberdata page envelope.")
    require(operation is None or operation == value["operation"], "The saved page is for another operation.")
    require(value.get("selectionSha256") == product["selectionSha256"], "The saved page is for another product selection.")
    require(value.get("provider") == product["provider"], "The saved provider selection differs.")
    if value["operation"] == "spot_ohlcv":
        require(value.get("window") == product["window"] and value.get("units") == product["units"],
                "The saved OHLCV window or units differ.")
    require(isinstance(value.get("body"), str), "The exact UTF-8 provider body is required.")
    raw = value["body"].encode("utf-8", errors="strict")
    require(len(raw) <= product["limits"]["maxResponseBytes"] and type(value.get("bodyBytes")) is int
            and len(raw) == value["bodyBytes"] and hashlib.sha256(raw).hexdigest() == value.get("bodySha256"),
            "The saved provider body differs from its bytes or digest.")
    request = value.get("request")
    require(isinstance(request, dict) and type(request.get("pageIndex")) is int
            and 0 <= request["pageIndex"] < product["limits"]["maxPages"], "The original page position is required.")
    if request["pageIndex"] == 0:
        require(request.get("cursor") is None and request.get("previousBodySha256") is None,
                "The initial page must retain its original position.")
    else:
        require(isinstance(request.get("cursor"), str) and bool(request["cursor"])
                and isinstance(request.get("previousBodySha256"), str)
                and re.fullmatch(r"[a-f0-9]{64}", request["previousBodySha256"]), "The original page predecessor is required.")
    continuation = value.get("continuation")
    require(continuation is None or (isinstance(continuation, dict)
            and (continuation.get("token") is None or (isinstance(continuation.get("token"), str) and bool(continuation["token"])))
            and type(continuation.get("pageLimitReached")) is bool), "Invalid merchant continuation envelope.")
    if "interpretation" in value:
        require(isinstance(value["interpretation"], dict) and value["interpretation"].get("status") in ("ready", "unavailable"),
                "Invalid provider interpretation state.")
    return value


def inspect_cloudsync(source, expected_interval=None):
    require(isinstance(source, dict) and source.get("schema") == "stellar-forge.amberdata-cloudsync.v1"
            and source.get("interval") in ("minutes", "hours", "days") and isinstance(source.get("rowsBody"), str)
            and (expected_interval is None or source["interval"] == expected_interval),
            "CloudSync input must retain the original source contract and selected interval.")
    require(hashlib.sha256(source["rowsBody"].encode("utf-8", errors="strict")).hexdigest() == source.get("rowsSha256"),
            "The retained CloudSync rows changed.")
    original, decoder = source.get("original"), source.get("decoder")
    require(isinstance(original, dict) and original.get("format") == "parquet"
            and isinstance(original.get("sha256"), str) and re.fullmatch(r"[a-f0-9]{64}", original["sha256"])
            and type(original.get("bytes")) is int and original["bytes"] > 0 and isinstance(original.get("url"), str),
            "The original Parquet identity is required.")
    require(isinstance(decoder, dict) and decoder.get("numberFormat") == "binary64-roundtrip-json"
            and isinstance(decoder.get("name"), str) and isinstance(decoder.get("version"), str)
            and isinstance(decoder.get("originalRowsSha256"), str) and re.fullmatch(r"[a-f0-9]{64}", decoder["originalRowsSha256"])
            and type(decoder.get("originalRowsBytes")) is int and decoder["originalRowsBytes"] > 0,
            "The actual decoder and original decoded-file identity are required.")
    return source


def operation_inputs(product, operation, *, after=None, pages=(), research_input=None):
    inspect_product(product)
    require(operation in ROUTES, "Choose one of this product's three operation IDs.")
    if operation != "ohlcv_summary":
        require(not pages and research_input is None, "Provider reads accept a prior page, not a summary collection.")
        if after is None:
            return {"query": {}}
        page = inspect_page(after, product, operation)
        require(page["continuation"] is not None, "This page has no continuation.")
        require(not page["continuation"]["pageLimitReached"], "The product page limit has been reached.")
        require(isinstance(page["continuation"]["token"], str) and bool(page["continuation"]["token"]),
                page["continuation"].get("unavailableReason") or "This page has no usable merchant continuation token.")
        return {"query": {"continuation": page["continuation"]["token"]}}
    if research_input is not None:
        require(after is None and not pages and isinstance(research_input, dict),
                "An explicit research input object cannot be combined with page selections.")
        require(len(canonical(research_input).encode("utf-8")) <= product["limits"]["maxInputBytes"],
                "The selected summary input limit has been reached.")
        if "pages" in research_input:
            require(set(research_input) == {"pages"}, "Pages cannot be mixed with CloudSync inputs.")
            return operation_inputs(product, operation, pages=research_input["pages"])
        require("cloudsync" in research_input and set(research_input) <= {"cloudsync", "compareCloudsync"},
                "Choose the original pages or cloudsync research input.")
        inspect_cloudsync(research_input["cloudsync"], product["window"]["timeInterval"])
        if "compareCloudsync" in research_input:
            require(isinstance(research_input["compareCloudsync"], list) and len(research_input["compareCloudsync"]) <= 2,
                    "Choose at most two original CloudSync comparison sources.")
            for source in research_input["compareCloudsync"]:
                inspect_cloudsync(source)
        return {"body": research_input}
    require(after is None and isinstance(pages, (list, tuple))
            and 1 <= len(pages) <= product["limits"]["maxPages"],
            "A summary requires the ordered saved OHLCV page envelopes.")
    previous, seen = None, set()
    for index, value in enumerate(pages):
        page = inspect_page(value, product, "spot_ohlcv")
        require(page["request"]["pageIndex"] == index and page["request"]["previousBodySha256"] == previous,
                "Supply the original page sequence from page zero, in order.")
        require(page["bodySha256"] not in seen, "The same provider page was supplied twice.")
        if index + 1 < len(pages):
            require(page["continuation"] is not None, "A terminal page cannot have a successor.")
        seen.add(page["bodySha256"])
        previous = page["bodySha256"]
    body = {"pages": list(pages)}
    require(len(canonical(body).encode("utf-8")) <= product["limits"]["maxInputBytes"],
            "The selected summary input limit has been reached.")
    return {"body": body}


def inspect_payload(value, product):
    if isinstance(value, dict) and value.get("schema") == PAGE_SCHEMA:
        page = inspect_page(value, product)
        return {key: page[key] for key in ("schema", "operation", "selectionSha256", "provider", "window", "units",
                                          "bodySha256", "bodyBytes", "nativeUpstream")} | {
            "pageIndex": page["request"]["pageIndex"],
            "previousBodySha256": page["request"]["previousBodySha256"],
            "continuationPresent": page["continuation"] is not None,
            "continuationAvailable": bool(page["continuation"] and isinstance(page["continuation"].get("token"), str)
                                          and page["continuation"]["token"]),
            "pageLimitReached": bool(page["continuation"] and page["continuation"]["pageLimitReached"]),
            "continuationUnavailableReason": page["continuation"].get("unavailableReason") if page["continuation"] else None,
            "interpretation": page.get("interpretation"),
        }
    inspect_product(product)
    require(isinstance(value, dict) and value.get("schema") == SUMMARY_SCHEMA
            and value.get("selectionSha256") == product["selectionSha256"],
            "Response is not a summary for this retained product.")
    require(value.get("provider") == product["provider"] and value.get("window") == product["window"]
            and value.get("units") == product["units"], "Summary provider, window or units differ.")
    for name in ("open", "high", "low", "close", "volume"):
        decimal = value.get(name)
        require(decimal is None or (isinstance(decimal, str) and re.fullmatch(r"-?[0-9]+(?:\.[0-9]+)?", decimal)),
                "Summary decimal values must stay strings.")
    require((type(value.get("pageChainComplete")) is bool
             or (value.get("sourceKind") == "cloudsync-parquet" and value.get("pageChainComplete") is None))
            and all(type(value.get(key)) is bool for key in ("intervalCoverageComplete", "complete"))
            and isinstance(value.get("sources"), list) and isinstance(value.get("gaps"), list),
            "Summary completeness and source inventories are required.")
    return value


def consume_result(result, *, product, output=None):
    view = {"native": result.native, "process": {"returncode": result.record.get("returncode"),
            "runtimeError": result.record.get("runtimeError"), "recovered": result.record.get("recovered")},
            "responseFile": result.delivery, "nativeSuccess": result.ok}
    # SF88 already persisted the original response. Export it before interpretation.
    if output is not None:
        try:
            view["exported"] = str(result.save_as(output))
        except Exception as error:
            view["exportError"] = getattr(error, "code", None) or str(error)
    try:
        raw = result.read_bytes(limit=1_048_576)
        view["interpretation"] = inspect_payload(strict_json(raw.decode("utf-8", errors="strict")), product)
        view["interpretationStatus"] = ((view["interpretation"].get("interpretation") or {}).get("status", "unspecified")
                                        if view["interpretation"]["schema"] == PAGE_SCHEMA else "ready")
    except Exception as error:
        view["interpretationStatus"] = "unavailable"
        view["interpretationError"] = getattr(error, "code", None) or str(error)
    return view


class AmberdataCustomer:
    """Small product input adapter; the supplied original Buyer owns all execution."""
    def __init__(self, buyer, product):
        self.buyer = buyer
        self.product = inspect_product(product)

    def prepare(self, *, discovery, row, accept, operation, intent_id, profile, after=None, pages=(), research_input=None):
        inputs = operation_inputs(self.product, operation, after=after, pages=pages, research_input=research_input)
        method, path = ROUTES[operation]
        query = urlencode(inputs.get("query", {}))
        url = self.product["publicOrigin"] + path + ("?" + query if query else "")
        require(len(url) <= 2048, "Request URL exceeds the original seller's 2048-character limit.")
        body = canonical(inputs["body"]).encode("utf-8") if "body" in inputs else None
        # The original saved-discovery preparer binds path/method and copies the
        # selected original amount/network/asset/recipient, retaining its source.
        prepared = self.buyer.prepare(discovery, row=row, accept=accept, intent_id=intent_id,
                url=url, method=method, body=body,
                headers={"Accept": "application/json", **({"Content-Type": "application/json"} if body is not None else {})})
        prepared.configure(profile, max_response_bytes=1_048_576, response_timeout_ms=60_000, request_timeout_ms=60_000)
        return prepared

    def operation(self, intent_id):
        return self.buyer.operation(intent_id)

    def consume(self, result, *, output=None):
        return consume_result(result, product=self.product, output=output)


def arguments(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", default=str(Path(__file__).resolve().parents[5]),
                        help="Original repository/source root containing stellar/")
    parser.add_argument("--state", required=True, help="Private original Python Buyer application state")
    parser.add_argument("--node", default="node")
    actions = parser.add_subparsers(dest="action", required=True)
    prepare = actions.add_parser("prepare", help="Prepare and review one operation from an original saved offer")
    for name in ("discovery", "profile", "product", "intent"):
        prepare.add_argument("--" + name, required=True)
    prepare.add_argument("--operation", required=True, choices=list(ROUTES))
    prepare.add_argument("--row", required=True, type=int)
    prepare.add_argument("--accept", required=True, type=int)
    source = prepare.add_mutually_exclusive_group()
    source.add_argument("--after", help="Previous complete saved provider page")
    source.add_argument("--page", action="append", default=[], help="Ordered saved OHLCV page; repeat per page")
    source.add_argument("--input", help="Complete research input object with its exact source text")
    for name in ("review", "execute", "recover", "inspect"):
        command = actions.add_parser(name)
        command.add_argument("--intent", required=True)
        if name in ("execute", "recover"):
            command.add_argument("--product", required=True)
            command.add_argument("--out", help="New private file for the exact native response bytes")
    actions.add_parser("list")
    return parser.parse_args(argv)


def main(argv=None):
    args = arguments(argv)
    root = Path(args.source_root).expanduser().resolve()
    sys.path.insert(0, str(root / ORIGINAL_BUYER / "python"))
    from stellar_forge_buyer import Buyer
    buyer = Buyer(checkout=root, state_dir=args.state, node=args.node)
    status = 0
    try:
        if args.action == "list":
            output = [operation.inspect() for operation in buyer.list_operations()]
        elif args.action == "prepare":
            customer = AmberdataCustomer(buyer, json_file(args.product))
            operation = customer.prepare(discovery=args.discovery, row=args.row, accept=args.accept,
                    operation=args.operation, intent_id=args.intent, profile=args.profile,
                    after=json_file(args.after) if args.after else None,
                    research_input=json_file(args.input) if args.input else None,
                    pages=[json_file(path) for path in args.page])
            output = {"intentId": operation.intent_id, "directory": str(operation.directory),
                      "review": operation.review().native}
        else:
            operation = buyer.operation(args.intent)
            if args.action == "inspect":
                output = operation.inspect()
            elif args.action == "review":
                output = operation.review().native
            else:
                product = inspect_product(json_file(args.product))
                result = operation.execute(review=operation.review()) if args.action == "execute" else operation.recover()
                output = consume_result(result, product=product, output=args.out) if result is not None else {
                    "status": "ORIGINAL_RESULT_NOT_RECORDED", "operation": operation.inspect()}
                if result is None or not result.ok or output.get("interpretationStatus") == "unavailable" or output.get("exportError"):
                    status = 2
        print(json.dumps(output, ensure_ascii=False, indent=2, allow_nan=False))
    except Exception as error:
        retained = getattr(error, "operation", None)
        print(json.dumps({"error": getattr(error, "code", None) or str(error),
              **({"operationDirectory": str(retained.directory)} if retained is not None else {})}), file=sys.stderr)
        return 2
    return status


if __name__ == "__main__":
    raise SystemExit(main())
