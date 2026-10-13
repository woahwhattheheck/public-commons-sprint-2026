# Original utility E. coli study in Station geography

Open **Station geography** in the intended Workspace. The **Original utility E. coli study** card receives the maintained original 2021–2025 source edition and builds its saved geography through the existing operator queue.

The source contains 730 original WQP result records at 36 stations: 142 records at 5 ARJWS stations and 588 at 31 Pioneer stations. Original sampled values, detection and quantitation conditions, activity identifiers, and all source companions remain retained.

## Install the complete study family

Use the current complete application source as SOURCE_ROOT and the existing application as CURRENT_APPLICATION:

```sh
python SOURCE_ROOT/operator/install_station_geography.py \
  --application CURRENT_APPLICATION --source-root SOURCE_ROOT
```

The maintained installer receives all 48 files together: its existing 20 Station geography and Assessment context files, the two current observed-station catalogue members and saved assessment-report helper, both microbial model/guide files, this operator guide, and all 22 original microbial data/report/compiler/manifest files. It checks all source members before replacing any installed file, preserves predecessor backups and the existing extension-host registration, and writes the complete file inventory to `operator/station-geography-install.json`. Restart the existing operator after installation to load the current registered action.

SOURCE_ROOT is the full application directory containing `model/`, `operator/` and `source/`. Its original-source edition and native coordinate adapter are retained together. The actual full watershed domain is an independent Workspace source selected by the controls below.

## Choose the geographic context

The default **Use the complete original 217-watershed domain** requires the original model-domain polygon body in this Workspace. The original-source receiver in `source_tools/ORIGINAL_SOURCE_WATER_RECEIVING.md` registers that exact body as the primary vector `original-model-domain`, while retaining the separate 4- and 32-watershed prepared areas.

**Station points and original utility context** builds the same full original observation study without a polygon overlay. **Use the original domain when retained** explicitly allows that station-only edition when the original full domain is unavailable. The saved selection records the actual choice and source identity.

## Build and reopen

Select **Build original E. coli study**. The task imports or reuses the complete maintained source, prepares its exact native selection, and invokes the existing Station geography engine. The engine retains its original map, report, source collection and portable ZIP. The completed task includes the microbial receiving JSON and opens directly into the saved geography edition. Its files also include **Original E. coli interactive explorer.html**: download and open it for the original station/date map and plot, filters, all 63 source fields, original and selected CSV downloads, and printed selection. The full native ZIP retains the complete original companion directory.

The desk retains its queued operation when closed. Reopen its saved task or choose the edition in **Saved station geography**. The task's **Open station geography** button checks the original Workspace and also works when this desk has not previously been opened. Failed or interrupted tasks retain the existing resume control.

The initial source import uses the installed `source/ecoli_utility_context/20261013/source-manifest.json`. A transferred Workspace can reuse a complete supported source edition without an installed data directory. The card and native adapter recognize the same known manifest/report identities: when both are retained, the adapter chooses its current presentation edition; when only the original edition is retained, that complete edition remains available. An explicitly installed manifest selects its exact edition. The saved preparation records the actual manifest, report and source collection identities. Full native build requires the application's normal GIS environment. The preparation-only command and exact source contracts are documented in `model/UTILITY_MICROBIAL_STUDY.md`.

## Source and implementation

The original source and interactive report were published in PR2988, the native scientific adapter in PR3047, and full original-domain primary registration in PR3056. This desk invokes the same adapter and existing geographic engine. The original general station-selection, package receiving, assessment filters, station coverage and export tools remain available alongside the prepared study.
