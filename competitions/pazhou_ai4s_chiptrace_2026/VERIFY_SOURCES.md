# Optional raw-input verification for ChipTrace receipts

The existing `chiptrace.py verify report.json` verifies the report's own unkeyed SHA-256 receipt **without** reopening input CSVs. This separate opt-in helper additionally compares the current raw bytes of two explicitly provided files against the recorded baseline/candidate digests.

Run from the repository root:

    python competitions/pazhou_ai4s_chiptrace_2026/verify_sources.py /path/to/report.json --baseline /path/to/baseline.csv --run /path/to/candidate.csv

The helper verifies the canonical report receipt **before** opening source files, rejects missing or malformed input digests, streams large CSVs, and emits one JSON line with `PASS` (exit 0) or `FAIL` (exit 2). Its `baseline_bytes_match` and `run_bytes_match` fields identify changed or swapped inputs. It never uses the report's `baseline_file` or `run_file` fields as paths; the caller supplies both paths explicitly. No CSV data content is printed, transmitted or uploaded.

An unchanged report with mutated CSV bytes fails this stronger check even though the original report-only verifier may still pass. Valid copied or renamed CSVs are accepted if bytes match exactly. The analyzer, report schema, QC thresholds, existing `verify` command and official entry are unchanged.

**Trust limitation:** these are *unkeyed* SHA-256 digests. Someone who rewrites the report and both claimed source files can recompute them. `PASS` establishes consistency with these two provided files, not report authorship, laboratory provenance, experimental validity, clinical suitability, or an official competition score. Compare against independently trusted digests for authenticity.

Focused offline check (from the ChipTrace directory):

    python -m unittest test_verify_sources -v

This is a five-case synthetic check only; no real data, live provider or broader suite is required.
