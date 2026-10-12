# Native acceptance source

This branch preserves the single Berkeley daily-cashiering workflow used alongside the original permitting comparator. All transaction rows are explicitly authored local examples; this file contains no City, Clariti, ACI or Munis operational data.

The controller is kept separate from production application code. Its deployment layout is:

- `PROJECT/source/revenue/berkeley-clariti-32600118-20261010/`: the complete reviewed application source.
- `PROJECT/source-composition.json`: exact installed path, byte-count and SHA256 inventory.
- `PROJECT/native-run/build.py`: the exact controller preserved here.
- `PROJECT/native-run/`: the one retained SQLite database, request journal, phase checkpoint and outputs.

Use the maintained Commons native foreground with operation `berkeley-daily-cashiering-native-82e4-20261012`; inspect any existing record before continuing it. No new operation is registered by this source publication. The original controller verifies every source hash before opening the workspace, retains each mutation UUID and payload before execution, and resumes accepted phases from `build.json`.

A successful actual execution writes `native-run/result.json`. The result's `database_path` is the current saved workspace. Its first financial packet and receiving backup are retained historical editions; the later current database includes the explicit corrected-source refresh and renewed close. A browser continuation must preserve those accepted editions and use its own labeled run within the same database.

This source preservation does not itself assert a passing execution.