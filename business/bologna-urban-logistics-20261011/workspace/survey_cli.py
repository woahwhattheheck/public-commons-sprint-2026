#!/usr/bin/env python3
"""Command-line survey operation using the original workspace model and lock."""
from __future__ import annotations

import argparse
import base64
import json
import sys
from pathlib import Path

import model
import survey


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state", type=Path)
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ["schema", "template"]:
        cmd = commands.add_parser(name)
        cmd.add_argument("--out", required=True, type=Path)
    questionnaire = commands.add_parser("questionnaire")
    questionnaire.add_argument("--out", required=True, type=Path)
    preview = commands.add_parser("preview")
    preview.add_argument("--source", required=True, type=Path)
    preview.add_argument("--out", required=True, type=Path)
    commit = commands.add_parser("import")
    commit.add_argument("--source", required=True, type=Path)
    commit.add_argument("--review", required=True, type=Path)
    commit.add_argument("--choices", required=True, type=Path)
    commit.add_argument("--reviewer", required=True)
    commit.add_argument("--reason", required=True)
    commit.add_argument("--non-identifying-reviewed", action="store_true", required=True)
    action = commands.add_parser("action")
    action.add_argument("--json", required=True, type=Path, help="Original action object with expectedRevision and survey.* action")
    for name in ["analyze", "export"]:
        cmd = commands.add_parser(name)
        cmd.add_argument("--cohort")
        cmd.add_argument("--street")
        cmd.add_argument("--role")
        cmd.add_argument("--publication")
        cmd.add_argument("--out", required=True, type=Path)
    source = commands.add_parser("source")
    source.add_argument("--id", required=True)
    source.add_argument("--out", required=True, type=Path)
    args = parser.parse_args(argv)
    if args.command not in {"schema", "template"} and not args.state:
        parser.error("--state is required for this command")
    if args.command == "schema":
        model.write_atomic(args.out, survey._bytes(survey.schema()))
    elif args.command == "template":
        model.write_atomic(args.out, survey.template_csv())
    elif args.command == "action":
        payload = json.loads(args.json.read_text(encoding="utf-8"))
        if not isinstance(payload, dict) or not str(payload.get("action", "")).startswith("survey."):
            raise ValueError("Use a survey.* action object")
        state, result = model.apply_action(args.state, payload)
        print(json.dumps({"revision": state["revision"], "result": result}, ensure_ascii=False))
    elif args.command in {"preview", "import"}:
        raw = args.source.read_bytes()
        payload = {"filename": args.source.name, "csvBase64": base64.b64encode(raw).decode()}
        if args.command == "preview":
            result = survey.preview_import(model.load_state(args.state), payload)
            model.write_atomic(args.out, survey._bytes(result))
        else:
            review = json.loads(args.review.read_text(encoding="utf-8"))
            choices = json.loads(args.choices.read_text(encoding="utf-8"))
            # Filename and bytes remain exactly those reviewed, independent of a moved path.
            payload["filename"] = review["filename"]
            state, result = model.apply_action(args.state, payload | {"action": "survey.import", "expectedRevision": review["workspaceRevision"],
                "reviewToken": review["reviewToken"], "choices": choices, "reviewer": args.reviewer, "reason": args.reason,
                "nonIdentifyingReviewed": args.non_identifying_reviewed})
            print(json.dumps({"revision": state["revision"], "result": result}, ensure_ascii=False))
    else:
        state = model.load_state(args.state)
        if args.command == "questionnaire":
            model.write_atomic(args.out, survey.questionnaire_html(state))
        elif args.command == "source":
            model.write_atomic(args.out, survey.source_bytes(state, args.id))
        else:
            analysis = survey.publication_analysis(state, args.publication) if args.publication else survey.analyze(state,
                {key: getattr(args, key) for key in ["cohort", "street", "role"] if getattr(args, key)})
            if args.command == "analyze":
                model.write_atomic(args.out, survey._bytes(analysis))
            else:
                args.out.mkdir(parents=True, exist_ok=True)
                files = survey.export_tables(analysis)
                manifest = {"schema": "bologna-survey-export/v1", "workspaceRevision": analysis["workspaceRevision"],
                            "publicationId": args.publication, "files": []}
                for name, content in files.items():
                    model.write_atomic(args.out / name, content)
                    manifest["files"].append({"name": name, "bytes": len(content), "sha256": survey._hash(content)})
                model.write_atomic(args.out / "manifest.json", survey._bytes(manifest))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, RuntimeError, OSError, KeyError) as error:
        print(f"{type(error).__name__}: {error}", file=sys.stderr)
        raise SystemExit(2)
