# Maintained original bank statement readers

Grant Operations uses the exact OFX and MT940 readers already retained by Merchant bank intake. These files are byte-identical to their maintained source in `woahwhattheheck/smb-showcase-inventory`, tree `2ca0540e094d855f59562abe67b22d0e5a87768c`.

| Original source | Git blob | Retained file |
| --- | --- | --- |
| apps/ofx_statement_intake/intake.py | c19b38f228283c31926fe9eae86a6364a7976943 | ofx_intake.py |
| apps/csv_intake_workbench/mt940/engine.py | ee5a99c5b747e402bfb1f51175e61799859d3121 | mt940_engine.py |

The same original modules are used by `merchant-settlement-accounting/receivables/bank-parsers`. Source terms remain those of the original repository; the selected original snapshot has no separate LICENSE, COPYING or NOTICE file. Both readers use Python's standard library and support the existing Python 3.10+ runtime.

`operations_statement_formats.py` projects the original source reports into the grant desk. Native source identities, dates, currency precision, page balances, pending rows, corrections and original parser findings stay in the retained review. The original OFX/MT940 algorithms are maintained in the files above. The grant projection uses the existing case cash validator, original source store and transaction.
