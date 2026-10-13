# Complete original WQP observation delivery

The original Eighteenmile lake-sample case now operates from native laboratory intake through readable scientific report, portable field evidence and a complete independently reopened application and Workspace.

## Operate the complete course

From the original application directory:

```sh
python -B source_tools/receive_wqp_delivery.py \
  --workspace /absolute/eighteenmile-workspace \
  --output /absolute/eighteenmile-delivery \
  --create-workspace
```

Omit `--create-workspace` when continuing an existing Workspace. Source defaults are the original `observations/eighteenmile_2023/wqp_20261013/` CSVs and its `field-intake/` plan, mapping and coverage. `--source-directory` and `--case-directory` accept another local copy of these exact original inputs.

The command uses the maintained field receiver, `ImplementationStore`, `implementation_evidence`, `observed_context`, scientific report renderer and `portable.backup/restore`. Completed intake, customer report, archives and receiving survive a resumed command. A completed output retains its original Workspace identity.

The output includes:

* `Eighteenmile_Original_Observations.zip`: reader PDF and offline HTML, all 88 displayed results, complete original stations/activities/results CSVs, full result-field index, original source bindings and portable evidence.
* `Eighteenmile_Complete_Workspace.zip`: complete application, immutable field revisions, original attachments, observation registry, saved reports and reader edition.
* `result.json`: complete operated result, archive identities and native receiving result.

Open `report.html` after extracting the customer ZIP. Unzip the complete Workspace archive into a new directory to get `application/` and `workspace/` side by side. The native CLI also receives the same archive into a separate directory:

```sh
python application/model/cli.py restore Eighteenmile_Complete_Workspace.zip NEW_DIRECTORY
python NEW_DIRECTORY/application/model/cli.py --workspace NEW_DIRECTORY/workspace overview
```

## Reader edition

The seven-page operated edition organizes all original results by station and characteristic. Every displayed record links back to its original one-based CSV data-record number. Reported values, source collection times, original detection conditions, per-result reporting limits and method identifiers remain visible together. Units, fractions and measurement bases remain separate grouping keys. The full original source fields remain in `result-index.json` and the exact original CSVs.

Censored results remain censored. Numeric ranges use only the numeric observations in their stated group. Original publisher station descriptions, coordinates and datum are retained. The native observed-source recipe and its file bindings remain beside the reader edition.

## Native path correction

`ImplementationStore` accepts a Workspace object, a string or a filesystem path. `pathlib.Path` also has a `.root` property, meaning `/` or a drive root. Treating that as a Workspace root sent path-based intake and native portable verification to the wrong directory.

The constructor now recognizes strings and `os.PathLike` before inspecting a Workspace object's `.root`. The observed failure was in `portable_implementation.verify_implementation` during the original full-project export, so the correction also restores native backup/receiving for plans with saved observations.

## Operated original case

The independent receiving Workspace is `c063636a-ae1c-4061-8125-71d600b6974b`. Its plan is `eighteenmile-2023-original-lake-samples`, revision 2, digest `079697f152c573d531d82bbcd998c22adbd9d34c064b847fa44363006250fb6a`.

The completed native course retains 88 results: 82 numeric and six censored, three station records, 88 activities, 48 native visit records, two immutable revisions, two original local-file attachments and the 11-file saved field-report edition. The collection dates span April 5 through October 17, 2023. The independent whole-project receiver preserved the project, original plan, all revision events, attachments and original observation count.

The evidence ZIP contains the original saved plan plus its two local-file source attachments. Reimporting that ZIP into the original store returned `unchanged`. The complete Workspace ZIP contains 2,781 original application and Workspace members. The execution used the existing cloud Python 3.13.5 environment and the real original WQP case.
