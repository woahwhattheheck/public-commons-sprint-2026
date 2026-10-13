"""Installation receiving through the existing Operations CLI and private writer."""
from __future__ import annotations
import json
from model import Problem, canonical


def register(command, mutation):
    command("installation-returns", "List complete Installation returns and owner reviews", case=True, output=True)
    target = command("installation-return-seed", "Start receiving against an exact saved Installation", case=True, output=True)
    target.add_argument("--expected-version", type=int, required=True)
    target.add_argument("--installation", required=True)
    target.add_argument("--revision", type=int, required=True)
    target.add_argument("--sha256", required=True)
    target = command("installation-return-review-seed", "Reopen a retained owner review and compare its staged save with the current case", case=True, output=True)
    target.add_argument("--expected-version", type=int, required=True)
    target.add_argument("--review", required=True)
    target.add_argument("--sha256", required=True)
    for name in ("installation-return-preview", "installation-return-save",
                 "installation-return-review-preview", "installation-return-stage"):
        target = command(name, "Review or retain the complete original Installation receiving selection", case=True, output=True)
        target.add_argument("--inputs", required=True, help="Complete original inputs JSON; preserve across retry")
        if name.endswith(("-save", "-stage")):
            mutation(target, version=True)
            target.add_argument("--expected-preview-sha256", required=True)
        else:
            target.add_argument("--expected-version", type=int, required=True)
    target = command("installation-return-export", "Export the selected return with the complete original Operations case", case=True)
    target.add_argument("--review", required=True)
    target.add_argument("--output", required=True)


def operate(ops, args, read_bytes, publish):
    action = args.operation
    if action == "installation-returns":
        result = ops.installation_returns(args.case)
    elif action == "installation-return-seed":
        result = ops.seed_installation_return(args.case, {"expectedVersion": args.expected_version,
            "installationId": args.installation, "revision": args.revision, "sha256": args.sha256})
    elif action == "installation-return-review-seed":
        result = ops.seed_installation_return_review(args.case, {"expectedVersion": args.expected_version,
            "retainedReview": {"id": args.review, "sha256": args.sha256}})
    elif action == "installation-return-export":
        return {"reviewId": args.review, "output": publish(args.output, ops.export_installation_return(args.case, args.review))}
    else:
        try:
            inputs = json.loads(read_bytes(args.inputs, 8 * 1024 * 1024))
        except (ValueError, UnicodeError) as exc:
            raise Problem("Retain the complete original receiving input JSON.", 422, "INVALID_JSON") from exc
        if action in ("installation-return-preview", "installation-return-review-preview"):
            method = ops.preview_installation_return if action == "installation-return-preview" else ops.preview_installation_return_review
            result = method(args.case, {"expectedVersion": args.expected_version, "inputs": inputs})
        else:
            result = ops.command(args.case, {"expectedVersion": args.expected_version, "requestId": args.request_id,
                "actor": args.actor, "note": args.note,
                "action": "installation.return" if action == "installation-return-save" else "installation.return-stage",
                "data": {"inputs": inputs, "expectedPreviewSha256": args.expected_preview_sha256}})
    return {"output": publish(args.output, (canonical(result) + "\n").encode("utf-8"))} if args.output else result
