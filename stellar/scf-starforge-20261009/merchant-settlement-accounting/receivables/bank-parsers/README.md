# Original statement parsers

This directory retains the existing OFX and MT940 source modules from `woahwhattheheck/smb-showcase-inventory`, tree `2ca0540e094d855f59562abe67b22d0e5a87768c`.

| Maintained original path | Original Git blob | Retained file |
| --- | --- | --- |
| apps/ofx_statement_intake/intake.py | c19b38f228283c31926fe9eae86a6364a7976943 | ofx_intake.py |
| apps/csv_intake_workbench/mt940/engine.py | ee5a99c5b747e402bfb1f51175e61799859d3121 | mt940_engine.py |

The original Python modules are preserved byte for byte. Their original README source pins are OFX bd8e2fd7c2757047b18c6cd8019e3abc21ca1f21 and MT940 22b1d1802a08e6292bf7a33c23abf27dc721800a, retained in the original repository and parser source capsule 07e246c2ae209b586c20de72a162ba0352cf8827. Source terms remain those of the original repository; this source snapshot has no standalone LICENSE, COPYING or NOTICE file.

## Runtime

CSV intake uses the existing Node CSV parser. OFX and MT940 intake require Python 3.10 or later available as `python3`. These original modules use Python's standard library. The fixed `bridge.py` reads one private JSON input, imports the selected original module, calls its `compile_report`, and returns the original report through stdout. `bank-statement-source.mjs` bounds input, runtime and output and projects original statement sections into native bank source rows.

Every import retains the exact original file, a normalized rows document and the complete parser report under the accounting owner's original private exports directory. Original account fields, signed decimal values, dates, precision, pending rows, correction records, page identities, findings and overlap occurrences remain in that report. The bank posting review binds the source file and normalized rows by SHA256 before creating or linking receipts.

OFX uses its original declared encoding and the original DTPOSTED local calendar date. A retained REPLACE is available for an explicit reviewed original receipt correction. Pending observations, DELETE records and transaction currency overrides remain source rows; they create no incoming cash. Same-FITID conflicts require a source resolution reason and use the existing original receipt binding when one exists.

MT940 requires explicit transport, encoding, debit/reversal profile, currency scales and a 100-year date window. Native receipt dating uses the explicitly chosen full value date. Original entry MMDD is retained without an invented year. MT940 transaction identity comes from the original statement/page identity and transaction ordinal; it is labeled STATEMENT_POSITION, while the bank-provided reference remains a separate original field. Supplied statement balances and all original page controls remain visible in parser-report.json.

The native accounting review handles explicit customer splits, original receipt links and corrections, dated invoice allocations, refund conservation and retained customer receipt advice. It uses the same accounting workspace revision, journal and lease as other receivables operations.
