"""Continue the original retained customer programme from the installed Python SDK."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import signal
import sys

from stellar_forge_buyer import ResearchWorkspace
from stellar_forge_buyer.research_customer_receiving import (
    ResearchCustomerCancelled, run_research_customer_delivery)
from stellar_forge_buyer.research_customer_updates import _retained_json
from stellar_forge_buyer.research_workspace import ResearchError
from stellar_forge_buyer.errors import BuyerError


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkout", required=True)
    parser.add_argument("--node", default="node")
    parser.add_argument("--sender-connection", required=True)
    parser.add_argument("--receiver-connection", required=True)
    parser.add_argument("--sender-client", required=True)
    parser.add_argument("--receiver-client", required=True)
    parser.add_argument("--native-programme", required=True,
                        help="The original runResearchCustomerDelivery programme directory.")
    parser.add_argument("--case", required=True, help="That programme's complete retained case.json.")
    parser.add_argument("--case-sha256")
    parser.add_argument("--request-id", required=True,
                        help="Retain this Python operation ID for all continuations.")
    parser.add_argument("--output", required=True)
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--timeout", type=int, default=3600)
    arguments = parser.parse_args(argv)

    def stop(signum, frame):
        raise ResearchCustomerCancelled()
    previous = {kind: signal.signal(kind, stop) for kind in (signal.SIGINT, signal.SIGTERM)}
    try:
        with ResearchWorkspace(checkout=arguments.checkout, node=arguments.node,
                connection_file=arguments.sender_connection, directory=arguments.sender_client,
                timeout=arguments.timeout, request_timeout_ms=900000) as sender:
            with ResearchWorkspace(checkout=arguments.checkout, node=arguments.node,
                    connection_file=arguments.receiver_connection, directory=arguments.receiver_client,
                    timeout=arguments.timeout, request_timeout_ms=900000) as receiver:
                result = run_research_customer_delivery(sender=sender, receiver=receiver,
                    directory=arguments.native_programme, case_file=arguments.case,
                    request_id=arguments.request_id, expected_case_sha256=arguments.case_sha256,
                    resume=arguments.resume)
        output = Path(arguments.output).expanduser().absolute()
        _retained_json(output, result, limit=96 * 1024 * 1024 + 65536)
        print(json.dumps({"state": "COMPLETE", "file": str(output),
                          "projectId": result["projectId"],
                          "updatedDeliveryId": result["update"]["delivery"]["id"],
                          "correctionDeliveryId": result["correction"]["delivery"]["id"]}))
        return 0
    except ResearchCustomerCancelled:
        print(json.dumps({"state": "INTERRUPTED", "requestId": arguments.request_id,
                          "nativeProgramme": arguments.native_programme}), file=sys.stderr)
        return 2
    except ResearchError as error:
        print(json.dumps({"error": error.code, "requestId": error.request_id,
                          "record": error.record}, ensure_ascii=False), file=sys.stderr)
        return 2
    except (BuyerError, OSError, ValueError) as error:
        print(json.dumps({"error": getattr(error, "code", type(error).__name__),
                          "detail": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 2
    finally:
        for kind, handler in previous.items():
            signal.signal(kind, handler)


if __name__ == "__main__":
    raise SystemExit(main())
