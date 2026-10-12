# Recurring FRED briefing workspace

Open **fred-recurring-briefings-responsive-20261012.zip** for the current complete saved case. It includes the source, producing project, independently received project, full HTML/CSV/JSON reports, and portable v3 project bundle.

After extracting it, open `work/outputs/successor.html` to read the complete report. The offline report includes filters, paged comparisons, source details, and complete CSV/JSON downloads. The wide tables have labelled keyboard focus targets and the controls wrap on narrow screens. The full operating guide is `source/stellar/scf-starforge-20261009/sf30-seller-sdk/fred/TEMPLATES.md`.

Maintained source: [public PR2359](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/2359), merge `344414c57830f22d44c0b79d927622c7675dda4a`; [standalone PR258](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/pull/258), merge `aa88ce408cc46b091edaaaac9f7bef1a74505416`.

## The saved case

The retained UNRATE, CPIAUCSL and GDP capture contains 2,219 observations. A calendar-2025 analyst review supplies a twelve-month template using the earliest latest observation date across its selected series. The original GDP observation date 2026-04-01 anchors the May 2025–April 2026 successor.

The reporting window contains 28 original observations: 12 unemployment, 12 consumer price and 4 GDP. Both monthly source missing markers remain explicit. Its 76 comparison rows contain 20 new periods, 20 periods leaving the window and 36 unchanged comparisons.

The original and receiving workspaces share project `e91d081a-451b-4349-b0a0-beaa0a04ec1f`, revision 5. The complete v3 bundle retains its original capture, reviews, briefing files, template and successor lineage.

## Complete native outputs

| Archive | Native completion | Bytes | SHA256 |
| --- | --- | ---: | --- |
| fred-recurring-briefings-20261012.zip | 2026-10-12 16:25:01 UTC | 483934 | 509fcdb9b0cd672ff3519149824e244e01e3aa206953c606524693c5bd5bdddf |
| fred-recurring-briefings-responsive-20261012.zip | 2026-10-12 16:33:11 UTC | 489568 | 51f7de62ec95629d93c7e405489ae913ec8dcc9b9c1286ab9985471d79d84526 |

Both original native journeys completed on Node 24.19.0 with exit 0. Each ran the complete import, review, template, successor, export, independent receive and reopen sequence. All three reports match byte for byte between producing and receiving workspaces.

The current HTML is 152956 bytes; the CSV is 29550 bytes and the complete JSON is 213562 bytes. The layout continuation preserved the project revision, operation IDs, template and successor identity, portable bundle, CSV and JSON. Its full source adoption record is inside the current archive.

`native-result.json` is the complete original first-run result. Each archive also retains its own complete `work/outputs/native-result.json`, source tree, workspace files and native execution output. `run_native.py` is the original source receiving wrapper; `run_successor.py` is the same-case continuation wrapper.
