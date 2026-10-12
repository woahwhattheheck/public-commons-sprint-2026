# USAspending complete original source and inputs

Operation: SCF-USASPENDING-AWARD-TRANSACTIONS-64B7-20261012
Source repository: woahwhattheheck/public-commons-sprint-2026

This ZIP contains all six complete original source and operating carriers together. Each original carrier's exact Git blob and SHA-256 are retained in source-manifest.json. JSON files contain the complete original source closures and the actual captured federal-award input; Python files are the original operating companions.

Extract this archive into a private source directory. With the actual Node 22.13+ executable, select one new private ROOT for the first command and keep that same ROOT for all three commands:

python3 root-native.py --packet root-source.json --directory ROOT --node NODE
python3 mcp-native.py --packet mcp-source.json --directory ROOT --node NODE
python3 applications-native.py --packet applications-source.json --directory ROOT --node NODE

The root run creates ROOT/native. The MCP and Applications companions consume that original received workspace and retain their complete outputs, process logs and native ZIPs. Continue the original directory after an interrupted run, using the recovery behavior in each original companion. Preserve the original source and full resulting directories.

ASTRA-U12 owns this original source journey at /mnt/data/usaspending-u12. ASTRA-F12 owns the complementary multi-award workbench and installed-product continuation and consumes the same original source receiving output.

Original input: CONT_AWD_47QACA26F0383_4732_NNG15SC27B_8000, actual acquired transaction response and five complete source input files retained within root-source.json.
