"""Build a genuine local CSV/evidence/packet demonstration using synthetic data."""
from __future__ import annotations

import argparse
import hashlib
from pathlib import Path

from circularvalue.core import SCHEMA, canonical_json, compile_case, verify_packet
from circularvalue.evidence_check import audit_evidence
from circularvalue.intake import export_tables, import_tables, write_new


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out-dir", type=Path, required=True, help="new directory; existing paths are refused")
    root = parser.parse_args().out_dir
    root.mkdir(mode=0o700)
    evidence_root = root / "retained"
    evidence_root.mkdir(mode=0o700)
    retained = {
        "baseline.txt": "SYNTHETIC: annual packaging procurement baseline for this demonstration only.\n",
        "retention.txt": "SYNTHETIC HYPOTHESIS: possible retention benefit; no actual customer study.\n",
    }
    for name, text in retained.items():
        write_new(evidence_root / name, text)
    mapping = {"baseline": "baseline.txt", "retention": "retention.txt"}
    case = {
        "schema": SCHEMA, "caseId": "synthetic-editable-intake-demo",
        "evaluatedOn": "2026-10-09", "currency": "GBP", "horizonYears": 3,
        "discountRateBps": 500, "maxEvidenceAgeDays": 365,
        "oneOffCostMinor": 10000, "annualRecurringCostMinor": 1000,
        "evidence": [
            {"id": eid, "sourceType": "synthetic_demo", "locator": f"synthetic://{filename}",
             "sha256": hashlib.sha256(retained[filename].encode("utf-8")).hexdigest(),
             "observedOn": "2026-10-01", "note": retained[filename].strip()}
            for eid, filename in mapping.items()
        ],
        "levers": [
            {"id": "procurement", "label": "Synthetic annual procurement avoidance",
             "category": "direct_cash", "confidence": "modeled", "lowMinor": 5000,
             "centralMinor": 10000, "highMinor": 15000, "evidenceIds": ["baseline"]},
            {"id": "retention", "label": "Synthetic retention hypothesis",
             "category": "customer_retention", "confidence": "hypothesis", "lowMinor": 0,
             "centralMinor": 1000, "highMinor": 3000, "evidenceIds": ["retention"]},
        ],
    }
    tables = export_tables(case)
    for name, text in tables.items():
        write_new(root / name, text)
    rebuilt = import_tables(tables["case.csv"], tables["evidence.csv"], tables["levers.csv"])
    packet = compile_case(rebuilt)
    report = audit_evidence(rebuilt, evidence_root, mapping)
    if rebuilt != case or not verify_packet(rebuilt, packet) or not report["allMatched"]:
        raise RuntimeError("local demonstration did not verify")
    for name, value in {"case.json": rebuilt, "packet.json": packet,
                        "mapping.json": mapping, "evidence-report.json": report}.items():
        write_new(root / name, canonical_json(value) + "\n")
    print("SYNTHETIC DEMO — CSV round-trip and packet verified; retained evidence matched 2/2")
    print("Decision state:", packet["decisionSupportState"])
    print("Case SHA-256:", packet["sourceCaseSha256"])
    print("Packet SHA-256:", packet["packetSha256"])
    print("Output:", root)


if __name__ == "__main__":
    main()
