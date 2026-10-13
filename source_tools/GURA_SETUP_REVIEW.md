# Original Gura scientific setup and project receiving

This command completes a scientific setup from an actual saved Gura project using the maintained source-class catalog and scenario builder. It assembles ordinary Workspace objects, retains the original scientific choices and source files, and invokes the existing setup review/export/backup/reopen workflow.

## Required existing application and source case

Install these additive files into the maintained Upper Savannah application. Keep the original model, native model runtime, Workspace and review modules.

- Scientific setup implementation: PR2996, merge `334c35b62d2555cc61a90863a0cf238b800f22a9`.
- Maintained `source_tools/gura_comparison.py`, especially `catalog`, `make_plan` and its existing `_check_plan` verifier.
- Original `source_tools/receive_scientific_setup.py` from PR2996.
- An actual populated Gura Workspace and its original `receiving.json`, schema `upstate.gura-original-receiving/v1`.

The original receipt names its actual project, source collection, grid, coefficient profile, baseline scenario and programme. The catalog verifies that those choices still match the saved source edition, original coefficient CSV and reporting-mask class counts.

If the equipped receiver instead has the original driver's `gura-receiving/gura-receiving-state.json` and an already prepared baseline run, the maintained `source_tools.gura_receipt` adapter from PR3002 can bind that existing case to the shared receipt:

```sh
python -B -m source_tools.gura_receipt \
  --workspace ACTUAL_GURA_WORKSPACE \
  --output OWNED_OUTPUT/original-receipt/receiving.json
```

Use that adapter's actual returned path with this assembler. The original workflow also has its own ordinary `source/receiving.json`; use the actual receipt that belongs to the selected project.

## 1. Read the real source catalog

Run from the installed application root:

```sh
python -B -m source_tools.gura_setup_review \
  --workspace ACTUAL_GURA_WORKSPACE \
  --receiving ACTUAL_ORIGINAL_RECEIVING_JSON \
  --catalog \
  --output-dir OWNED_OUTPUT/gura-setup-catalog
```

This writes `gura-setup-catalog.json` with the actual project ID, grid/profile/baseline IDs, source tables, observed reporting-mask class counts, cell area, original watershed features, and existing setup choices.

The catalog reads the real raster and mask through the maintained Gura code. It requires that source classes exist in the original coefficient profile. Reporting counts and areas come from the selected grid. A source code present only in a coefficient table is not an observed source footprint.

## 2. Select the scientific question and actual alternatives

The supplied `source/gura-scientific-setup-request.json` is a concrete analytical request authored for this receiving exercise. It asks about two original-class counterfactuals: general agriculture (5) to forest (8), and general agriculture (5) to agroforestry (19). The native catalog must show observed class 5 and the original profile must support the target codes.

Those names are from the retained official Gura tables. The NDR original loads for class 5 are P=3.57 and N=27; class 8 P=1.36 and N=1.4; class 19 P=2.48 and N=15.2, in the original table's model input convention. The SDR original C/P factors are respectively 0.412/1, 0.025/1, and 0.121/0.6. These are source coefficients, not predicted model results. The maintained profile remains authoritative and all selected-model columns are retained without reinterpreting their units.

The request contains the analytical question, reporting/model-domain rationale, proposed validation, optional observations/additional source collections and assigned roles. It contains no manually copied native IDs. The assembler binds those IDs directly from the verified original plan and Workspace.

```sh
python -B -m source_tools.gura_setup_review \
  --workspace ACTUAL_GURA_WORKSPACE \
  --receiving ACTUAL_ORIGINAL_RECEIVING_JSON \
  --request source/gura-scientific-setup-request.json \
  --convert 5:8 --convert 5:19 \
  --output-dir OWNED_OUTPUT/gura-scientific-setup
```

The alternatives are explicit. If the original source has no class-5 reporting cells, select a scientifically appropriate observed class and update both the question and explicit class choices together. The command rejects an absent source class through the original plan builder.

For a different source-authored scientific question, copy the request as `upstate.gura-setup-request/v1` and retain the author’s actual fields. Optional `expected_resolution_m` compares a requested specification with the actual grid; omit it when no such requirement applies. The application stores the real resolution in every case. In particular, the original Gura grid and the Upper Savannah 30 m study are separate source selections.

An explicitly retained Gura plan can also supply the alternatives:

```sh
python -B -m source_tools.gura_setup_review \
  --workspace ACTUAL_GURA_WORKSPACE \
  --receiving ACTUAL_ORIGINAL_RECEIVING_JSON \
  --request ACTUAL_SCIENTIFIC_REQUEST_JSON \
  --plan ACTUAL_SAVED_GURA_PLAN_JSON \
  --output-dir OWNED_OUTPUT/gura-scientific-setup-from-plan
```

All cases in that explicitly selected plan are included. To select a subset, repeat `--case ACTUAL_CASE_KEY`. The original plan verifier checks its digest, receipt, source inventory, observed classes, native selection and distinct physical changes. The exact original plan bytes and verified case keys travel with the setup.

## 3. Review, export and reopen

The receiving command performs the complete workflow:

1. Verify the original receipt and actual source catalog or retained plan.
2. Retain the exact incoming request, receipt and optional plan bytes.
3. Save each explicitly selected scenario through ordinary `Workspace.save_scenario`.
4. Import the assembled scientific record, original definitions, catalog and readable HTML as a standard `upstate.sources/v1` collection.
5. Bind the actual original source collection, selected grid/profile/baseline, saved alternatives, additional sources and observations into the existing scientific setup selection.
6. Use the merged setup receiving workflow to capture original source companions and prepared grid inputs, create the ordinary customer review, export its current response generation, back up the complete Workspace, restore it and compare the original selections and source files after reopen.

The existing customer-review workflow receives actual scientific reviewer responses. The supplied request leaves that person unassigned. The receiving output returns the actual review ID and current response generation.

## Retained deliverable

```text
OUTPUT/
  assembly-admission.json
  assembly/
    original-receiving.json
    original-request.json
    original-plan.json             # only when --plan supplied
    contrast-plan.json
    class-catalog.json
    assembly.json
    index.html
    sources.json
  scientific-setup-selection.json
  review-receiving/
    invocation.json
    original-selection.json
    captured-setup.json
    specification.json
    response-template.json
    customer-review/
    review-export.json
    workspace-transfer.zip
    workspace-transfer.json
    reopened/
    restore.json
    reopened-review.json
    receiving-result.json
  gura-setup-result.json
```

The readable source sheet opens with the real project, question, grid and original-source support, then lists exact patches and all original class counts. The standard scientific setup packet provides the full coefficient profile, grid alignment/NoData, reporting/model-domain definitions, originals/sidecars, observations and review requirements.

Use an output directory outside the source Workspace and application. Repeating the same original selection reuses the retained admission and native object identities. Changing a request, receipt, plan or case selection requires its own output directory. Source publication holds the existing Workspace lock; review and portable transfer use their original locking after that publication completes.

## Source references

- Original InVEST 3.20 NDR archive: https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/data/NDR.zip — 701,988 bytes, SHA-256 `df4ba0d9b96152d3bc5eef3c41b6ec701f62ec3548dc4d4c8af8bea53c6c7d`.
- Original InVEST 3.20 SDR archive: https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/data/SDR.zip — 726,334 bytes, SHA-256 `34351a1305d8e6258c2d566917cfeab5f152096e930ef5b0a834968146bdc779`.
- Retained official NDR table: `source/gura-original-tables-3.20/NDR/biophysical_table_gura.csv`, SHA-256 `e3f503cb1c82fb1035225eb68eb84303de8de7842b1bda6e94f4754fe538c42c`.
- Retained official SDR table: `source/gura-original-tables-3.20/SDR/biophysical_table_Gura.csv`, SHA-256 `b27b1549a41c4929f161e3b18962d6bc8627c10ed7ed27e504203c175a0f5f69`.
- Actual selected coefficient rows and source archive/argument edition remain in the original receiving record and retained Workspace profile. The original-datastack and pinned-table intake paths are preserved as their own source editions.
