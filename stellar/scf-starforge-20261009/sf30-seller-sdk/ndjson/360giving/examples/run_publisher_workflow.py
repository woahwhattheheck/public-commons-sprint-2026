#!/usr/bin/env python3
"""Operate both complete, original SCVO publisher editions and their receiving workflow."""
from argparse import ArgumentParser, Namespace
from pathlib import Path
import datetime as dt
import json
import runpy

PROFILE = Path(__file__).resolve().parents[1]
EDITION_NAMES = ["digital-ethics-fund-2022", "connecting-to-care-fund-2024"]

def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--out", required=True)
    parser.add_argument("--source-root", default=str(PROFILE / "examples"))
    parser.add_argument("--transport-root")
    parser.add_argument("--reviewer", default="TJLabs publisher receiving operator")
    args = parser.parse_args()
    api = runpy.run_path(str(PROFILE / "publisher.py"))
    out = Path(args.out).resolve()
    source_root = Path(args.source_root).resolve()
    out.mkdir(parents=True, exist_ok=True)
    result = {"schema": "stellar-forge.360giving-operated-editions.v1",
              "startedAt": dt.datetime.now(dt.timezone.utc).isoformat(), "editions": []}
    for name in EDITION_NAMES:
        capture = api["json_file"](PROFILE / "examples" / (name + "-capture.json"))
        source = source_root / (name + ".json")
        source_bytes = api["raw_file"](source)
        api["need"](len(source_bytes) == capture["decoded"]["bytes"] and
                    api["digest"](source_bytes) == capture["decoded"]["sha256"],
                    "Select the complete original publisher bytes for " + name)
        transport = None
        if args.transport_root:
            transport = Path(args.transport_root).resolve() / (name + ".transport.bin")
            transport_bytes = api["raw_file"](transport)
            api["need"](len(transport_bytes) == capture["transport"]["bytes"] and
                        api["digest"](transport_bytes) == capture["transport"]["sha256"],
                        "Select the original HTTP transport for " + name)
        original = out / name
        status = api["prepare"](Namespace(
            source=str(source), source_url=capture["sourceUrl"],
            registry=str(PROFILE / "examples" / (name + "-registry.json")),
            capture=str(PROFILE / "examples" / (name + "-capture.json")),
            transport=str(transport) if transport else None, out=str(original)))
        report = api["json_file"](original / "report.json")
        api["need"](status == 0, "Complete the original publisher review for " + name)
        generated_mapping = api["raw_file"](original / "mapping.json")
        supplied_mapping = api["raw_file"](PROFILE / "examples" / (name + "-mapping.json"))
        api["need"](generated_mapping == supplied_mapping,
                    "The supplied native mapping differs from the production profile")
        decisions_path = out / (name + "-decisions.json")
        decisions = api["json_file"](original / "decisions-template.json")
        decisions.update({
            "reviewer": args.reviewer,
            "reviewedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
            "reviews": [{"findingId": row["id"], "status": "retain_source",
                         "notes": "Preserve the publisher's original value and this source review question."}
                        for row in report["findings"]],
            "metadataFromRegistry": list(report["registryMetadata"]),
            "changes": []})
        if decisions_path.exists():
            decisions = api["json_file"](decisions_path)
        else:
            api["write_json"](decisions_path, decisions)
        candidate = out / (name + "-candidate")
        api["candidate"](Namespace(workspace=str(original), decisions=str(decisions_path), out=str(candidate)))
        archive = out / (name + "-publisher-receiving.zip")
        if not archive.exists():
            api["export"](Namespace(workspace=str(original), decisions=str(decisions_path),
                                    candidate=str(candidate), out=str(archive)))
        received = out / "second-operator" / name
        if not received.exists():
            api["receive"](Namespace(file=str(archive), out=str(received)))
        else:
            api["verify_workspace"](received)
        second_candidate = out / "second-operator" / (name + "-candidate")
        received_api = runpy.run_path(str(received / "operator" / "publisher.py"))
        received_api["candidate"](Namespace(workspace=str(received),
                                             decisions=str(received / "review" / "decisions.json"),
                                             out=str(second_candidate)))
        candidate_bytes = api["raw_file"](candidate / "candidate-package.json")
        second_bytes = api["raw_file"](second_candidate / "candidate-package.json")
        api["need"](candidate_bytes == second_bytes, "Receiving changed the selected candidate edition")
        api["need"](api["raw_file"](original / "grants.ndjson") ==
                    api["raw_file"](candidate / "grants.ndjson"),
                    "Registry metadata preparation changed the original grants")
        entry = {
            "dataset": name, "source": capture["decoded"],
            "grantCount": report["grantCount"], "currencyTotals": report["currencyTotals"],
            "schemaErrors": report["schemaErrors"], "publisherQuestions": report["findings"],
            "mapping": {"file": name + "/mapping.json", "sha256": api["digest"](generated_mapping),
                        "bytes": len(generated_mapping)},
            "candidate": api["json_file"](candidate / "candidate.json"),
            "receiving": {"file": archive.name, "sha256": api["digest"](api["raw_file"](archive)),
                          "bytes": archive.stat().st_size,
                          "secondOperator": str(received),
                          "secondCandidateSha256": api["digest"](second_bytes)},
            "originalGrantValuesPreserved": True}
        result["editions"].append(entry)
    result["completedAt"] = dt.datetime.now(dt.timezone.utc).isoformat()
    result_path = out / "publisher-operation.json"
    if result_path.exists():
        prior = api["json_file"](result_path)
        api["need"](api["exact"](prior["editions"]) == api["exact"](result["editions"]),
                    "Existing complete operation contains different editions")
        result = prior
    else:
        api["write_json"](result_path, result)
    print(api["exact"]({"result": str(result_path), "completedAt": result["completedAt"],
                        "editions": len(result["editions"]),
                        "grants": sum(row["grantCount"] for row in result["editions"]),
                        "sourceAndCandidateReceiving": "complete"}))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
