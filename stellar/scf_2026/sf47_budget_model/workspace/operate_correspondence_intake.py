"""Complete original correspondence receiving and portable reopening programme."""
from __future__ import annotations
import argparse
import base64
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from zipfile import ZipFile
from issuer_correspondence import (
    inspect_correspondence, source_candidates, prepare_source_commands,
    write_correspondence_bundle, verify_correspondence_bundle,
    zip_correspondence_bundle,
)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=True, sort_keys=True, indent=2) + "\n", encoding="utf-8")


def operate(case_input, destination):
    source = Path(case_input).absolute()
    original_input = source.read_bytes()
    inputs = json.loads(original_input)
    if inputs.get("schema") != "stellar-forge.correspondence-operating-input.v1":
        raise ValueError("Use the complete original correspondence case input.")
    root = Path(destination).absolute()
    root.mkdir(parents=True, exist_ok=True)
    identity_path = root / "INPUT_IDENTITY.json"
    identity = {"inputSha256": sha(original_input), "operation": inputs["operation"]}
    if identity_path.exists() and json.loads(identity_path.read_bytes()) != identity:
        raise ValueError("The existing receiving directory belongs to different original inputs.")
    if not identity_path.exists():
        save(identity_path, identity)
    prior = root / "OPERATING_RESULT.json"
    if prior.exists():
        result = json.loads(prior.read_bytes())
        if result.get("inputSha256") != sha(original_input):
            raise ValueError("The existing operation belongs to different original inputs.")
        for case in result["cases"]:
            verify_correspondence_bundle(root / case["directory"])
            verify_correspondence_bundle(root / case["reopenedDirectory"])
        return result
    cases = []
    for index, spec in enumerate(inputs["cases"], 1):
        identity = spec["id"]
        if not isinstance(identity, str) or not identity or any(c not in "abcdefghijklmnopqrstuvwxyz0123456789-" for c in identity):
            raise ValueError("Use a stable lowercase case identity.")
        original_path = (source.parent / spec["originalPath"]).resolve()
        if not original_path.is_relative_to(source.parent.resolve()):
            raise ValueError("Keep each original file inside the private operating input directory.")
        raw = original_path.read_bytes()
        if len(raw) != spec["bytes"] or sha(raw) != spec["sha256"]:
            raise ValueError("The received provider original differs from the case input.")
        inspection = inspect_correspondence(raw, spec["filename"], spec.get("mediaType"))
        if inspection["original"]["sha256"] != spec["sha256"]:
            raise ValueError("The correspondence receiver did not preserve the original identity.")
        expected = spec.get("expectations", {})
        if "subject" in expected and inspection["metadata"]["subject"] != expected["subject"]:
            raise ValueError("The received subject differs from the original provider read.")
        if "messageId" in expected and inspection["metadata"]["messageId"] != expected["messageId"]:
            raise ValueError("The received Message-ID differs from the original provider read.")
        for item in expected.get("textParts", []):
            matches = [row for row in inspection["textParts"]
                       if row["mediaType"] == item["mediaType"] and row["bytes"] == item["bytes"] and row["sha256"] == item["sha256"]]
            if len(matches) != 1:
                raise ValueError("A complete text part differs from the independent provider full-message read.")
        for item in expected.get("attachments", []):
            matches = [row for row in inspection["attachments"]
                       if row["filename"] == item["filename"] and row["bytes"] == item["bytes"]]
            if len(matches) != 1:
                raise ValueError("A complete attachment differs from the provider's original attachment inventory.")
            if item.get("sha256") and matches[0]["sha256"] != item["sha256"]:
                raise ValueError("The complete attachment bytes differ from their independently retained original.")
        choices = source_candidates(raw, inspection, observed_at=spec["observedAt"], source_url=spec["sourceUrl"])
        selected = [row["path"] for row in choices if row["available"]]
        commands = prepare_source_commands(
            raw, inspection, selected, expected_version=1,
            actor=inputs["operator"], request_prefix="correspondence-" + identity,
            observed_at=spec["observedAt"], source_url=spec["sourceUrl"])
        replay = prepare_source_commands(
            raw, inspection, selected, expected_version=1,
            actor=inputs["operator"], request_prefix="correspondence-" + identity,
            observed_at=spec["observedAt"], source_url=spec["sourceUrl"])
        if commands != replay:
            raise ValueError("The retained original receiving sequence did not replay exactly.")
        for item in commands["commands"]:
            decoded = base64.b64decode(item["body"]["data"]["contentBase64"], validate=True)
            if len(decoded) != item["bytes"] or sha(decoded) != item["sha256"]:
                raise ValueError("The prepared native source command changed selected original bytes.")
        directory = "received/" + identity
        report = write_correspondence_bundle(
            raw, spec["filename"], root / directory, media_type=spec.get("mediaType"),
            observed_at=spec["observedAt"], source_url=spec["sourceUrl"])
        repeated = write_correspondence_bundle(
            raw, spec["filename"], root / directory, media_type=spec.get("mediaType"),
            observed_at=spec["observedAt"], source_url=spec["sourceUrl"])
        if repeated != report:
            raise ValueError("Reopening the original immutable receiving bundle changed it.")
        save(root / "commands" / (identity + ".json"), commands)
        zip_path = root / "handover" / (identity + ".zip")
        archive = zip_correspondence_bundle(root / directory, zip_path)
        reopened = root / "reopened" / identity
        existing_reopened = reopened.exists()
        if not existing_reopened:
            reopened.mkdir(parents=True, exist_ok=False)
        with ZipFile(zip_path) as package:
            for member in package.infolist():
                relative = PurePosixPath(member.filename)
                if relative.is_absolute() or ".." in relative.parts:
                    raise ValueError("An unsafe ZIP member was received.")
            if not existing_reopened:
                package.extractall(reopened)
        verified = verify_correspondence_bundle(reopened, raw=raw, filename=spec["filename"])
        if verified["manifestSha256"] != report["manifestSha256"]:
            raise ValueError("The complete ZIP did not reopen the original correspondence manifest.")
        case = {
            "id": identity, "purpose": spec["purpose"], "original": inspection["original"],
            "subject": inspection["metadata"]["subject"], "messageId": inspection["metadata"]["messageId"],
            "parts": len(inspection["parts"]), "textParts": len(inspection["textParts"]),
            "attachments": len(inspection["attachments"]),
            "attachmentIdentities": [{key: row[key] for key in ("path", "filename", "bytes", "sha256", "decodeIssue")} for row in inspection["attachments"]],
            "nativeSourceChoices": len(choices), "selectedSourcePaths": selected,
            "preparedSourceCommands": len(commands["commands"]),
            "warnings": inspection["warnings"],
            "directory": directory, "reopenedDirectory": "reopened/" + identity,
            "bundleFiles": len(report["files"]), "manifestSha256": report["manifestSha256"],
            "zip": {"path": str(zip_path.relative_to(root)), "bytes": archive["bytes"], "sha256": archive["sha256"]},
        }
        cases.append(case)
        print(json.dumps({"stage": "original-correspondence-received", **case}, ensure_ascii=True), flush=True)
    result = {
        "schema": "stellar-forge.correspondence-operating-result.v1",
        "state": "COMPLETE", "completedAt": datetime.now(timezone.utc).isoformat(),
        "operation": inputs["operation"], "inputSha256": sha(original_input),
        "cases": cases,
        "originalFiles": len(cases),
        "originalBytes": sum(case["original"]["bytes"] for case in cases),
        "nativeSourceCommandsPrepared": sum(case["preparedSourceCommands"] for case in cases),
        "privateSourceHandling": "Original correspondence and source commands remain in this private operating case.",
    }
    save(prior, result)
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("case_input")
    parser.add_argument("destination")
    args = parser.parse_args()
    print(json.dumps(operate(args.case_input, args.destination), ensure_ascii=True, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
