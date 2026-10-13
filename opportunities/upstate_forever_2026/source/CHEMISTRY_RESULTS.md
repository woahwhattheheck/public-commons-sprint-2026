# Receive the original chemistry reports

The original REACT12 author delivered complete operated results with the source release. This receiver puts those existing results in the same scientific Workspace used by the maintained application. It imports four original HTML reports and retains their full CSV, JSON, source, wheel, image and ZIP companions through the existing native source writer.

The reports cover the authored four-reach, 20-day transport/reaction example; 36-observation parameter recovery; 512-draw uncertainty ensemble; and eight-observation information-based monitoring selection. Their full projects and requests match the unchanged examples used by `prepare_chemistry_reference.py`. Each source title identifies its numerical-method purpose. Field observation and regional model sources keep their original editions.

## Receive into the current Workspace

Obtain the complete original [operated-results archive](https://drive.google.com/file/d/1KTjnVjuG4xqe89MJvWfY_8YY83vJKwuJ/view) through the existing authorized source receiver. Its original filename is `ASTRA_REACT12_Operated_Results_2026-10-12.zip`, size 1,055,186 bytes and SHA256 `950a6eb4b9780c3ba0ea6e7522b06c65c7945442bef5a0d2835eccd50c4b75c3`.

From the current complete application:

```sh
python source_tools/receive_chemistry_results.py \
  --workspace /actual/scientific-workspace \
  --archive /actual/source/ASTRA_REACT12_Operated_Results_2026-10-12.zip \
  --output /actual/chemistry-operated-source
```

Use the same scientific Workspace selected by the regional receiving operation. Keep the output directory outside it. The original seven authored example files must be present under `integration/reach_chemistry/examples`.

Before importing, the receiver reads all 59 archive members, checks every original manifest entry, and compares each report's complete project/request JSON with its authored example. It preserves the original compact result JSON and the separately formatted source inputs. It then calls `Workspace.import_sources` and reopens all four source entries through an independent Workspace instance. Repeating the same command retains the same source collection.

The output contains `sources.json`, the complete unchanged family under `original/`, the original ZIP, and `opening.json` with the actual source collection, four source IDs and retained report paths. Each report source has all 59 companions: the other 58 original members and the complete original ZIP. The native object store deduplicates identical file bodies.

## Open and use the retained results

Select the returned source collection through the application's existing source interface. The four entry IDs are:

| Source ID | Original report |
| --- | --- |
| react12-original-simulation-results | Twenty-day transport, reactions and mass budgets |
| react12-original-calibration-results | Fitted parameters, original observations and separate fit/holdout scores |
| react12-original-ensemble-results | 512 parameter/prediction draws and uncertainty summaries |
| react12-original-monitoring-results | Eight selected observation candidates and information objective |

The primary file of each entry is its complete offline HTML report. Its retained source directory also contains every original report, input, output table, nested result ZIP and release companion, so relative source relationships remain intact. The source edition is included by the existing full scientific Workspace backup and restore.

For a direct native source reader:

```python
from model.workspace import Workspace
ws = Workspace("/actual/scientific-workspace")
report, source = ws.source_file(
    actual_source_collection_id,
    "react12-original-calibration-results",
)
```

To execute the current native reference again, use [CHEMISTRY_REFERENCE.md](CHEMISTRY_REFERENCE.md) and the maintained [Chemistry browser journey](CHEMISTRY_BROWSER.md). That operation records its own model task and artifacts. The imported original release supplies the corresponding authored inputs and previously operated numerical results for comparison.
