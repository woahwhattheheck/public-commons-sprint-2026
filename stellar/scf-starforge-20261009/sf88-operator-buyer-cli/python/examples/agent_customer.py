"""Run an existing original Buyer intent through a persistent agent customer.

Install the original package with its [agents] extra. Prepare the request with
Buyer.prepare/from_workspace/from_paid_file first, retaining its stable intent.
This host can be restarted with the same --state and --run values.
"""
import argparse
import json

from stellar_forge_buyer import Buyer
from stellar_forge_buyer.agent_workflow import CustomerWorkflow
from stellar_forge_buyer.agent_tools import create_tools


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkout", required=True)
    parser.add_argument("--state", required=True)
    parser.add_argument("--intent", required=True)
    parser.add_argument("--run", required=True)
    parser.add_argument("--format", choices=("auto", "json", "csv", "binary", "sse", "ndjson", "paid-file"), default="auto")
    parser.add_argument("--allow-partial", action="store_true")
    parser.add_argument("--action", choices=("execute", "recover", "review", "cancel"))
    parser.add_argument("--review-key")
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--limit", type=int, default=20)
    args = parser.parse_args()
    buyer = Buyer(checkout=args.checkout, state_dir=args.state, timeout=360)
    with CustomerWorkflow(buyer) as customer:
        customer.register(args.run, intent_id=args.intent, format=args.format,
                          allow_partial=args.allow_partial)
        state = customer.start(args.run)
        if args.action:
            state = customer.resume(args.run, action=args.action, review_key=args.review_key)
        if state["status"] != "AVAILABLE":
            print(json.dumps(state, indent=2))
            return
        tools = {tool.name: tool for tool in create_tools(customer)}
        # This same ToolCall shape is emitted by an existing LangChain agent.
        message = tools["stellar_forge_read"].invoke({
            "name": "stellar_forge_read", "type": "tool_call", "id": args.run + "-page",
            "args": {"run_id": args.run, "offset": args.offset, "limit": args.limit},
        })
        handoff = customer.export(args.run)
        print(json.dumps({"run": state, "model_content": message.content,
                          "page": message.artifact, "handoff": {
                              "directory": handoff["directory"],
                              "manifest_sha256": handoff["manifest_sha256"],
                              "complete": handoff["complete"], "reused": handoff["reused"]}}, indent=2))


if __name__ == "__main__":
    main()
