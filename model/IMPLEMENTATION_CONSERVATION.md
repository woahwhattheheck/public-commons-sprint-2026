# Current Conservation selections in Implementation and fieldwork

This complete importer successor composes one exact native-model compatibility correction onto ES-FIELD12's final original-source importer. Its plan store, candidate snapshots, native Community mapping, revision/actor handling, source import identities and existing fieldwork workflow remain the maintained implementation.

## Current source

Predecessor: F0C8HN02FC3, model/implementation_sources.py, 29,917 bytes, SHA256 ce2a043545b0e3850a539f394c9d87c07245f93aa91db84ae6740afce90f89e8.

Final adapter verified independently: F0C8N488BAS, operator/implementation_operator.py, 30,812 bytes, SHA256 12a9023a36c50c8f3b3dd666769ffaca9b8f65828006abfda9c22364c5db67be. Its original binding -> plan -> portfolio -> selection envelope already matches the current Conservation API and needs no source change for this correction.

The current Conservation family is merged in public-commons-sprint-2026, opportunities/upstate_forever_2026, PR2769 / d4007cae62487b7f5a1d860fd2b1d3b96935899d. Retain current model/conservation.py and model/conservation_bindings.py from that application. The current binding is 36,502 bytes, SHA256 172dad7c968aa41c384387950ce306f1dfe34a8d3d04d4bb56c180d0c0845cda; it preserves the original bind_plan signature and adds complete original partial-model/paired-experiment provenance.

## Corrected behavior

An original completed study may select NDR, SDR, or both. With NDR only, its sediment output has availability=not_selected, baseline=null and null native support fields. With SDR only, nitrogen and phosphorus are similarly omitted. The original availability_reason explains that model selection. An alternative's own modeled quantity can still exist when its baseline output was omitted, while paired changes remain unavailable.

The earlier importer rejected not_selected before importing the original plan. This successor accepts that original availability, checks that the omitted baseline quantity and support remain null, and retains its explanation. It preserves the complete original pollutant object, including all alternatives, common-support fields, unit and source case identities, in the existing candidate snapshot. It does not turn unavailable output into zero or create implementation benefit estimates.

The adapter still calls conservation_bindings.bind_plan(ws, source_id, include_geometry=False), reads the exact saved portfolio and selection descriptors, and passes the unchanged complete context envelope to import_selection. The original whole-unit area, reporting-area footprint and genuinely supplied cost/currency retain separate fields. Implementation budget, commitment, actual cost and observed field results remain separately entered records.

## Same existing receiving operation

Use the current actual native Conservation plan when its selected model family is partial, and retain its original plan ID. Run the ordinary implementation.selection.import or implementation.source.import action with kind=conservation_portfolio and that source_id. The existing FIELD12 adapter resolves the source internally; no upload or reconstruction is needed.

Reopen the saved Implementation revision and inspect the original candidate snapshot: omitted pollutant quantity/support are null with availability=not_selected; modeled axes and each alternative remain byte-equivalent JSON values from the saved Conservation candidate. Export through the existing native report/portable workbench. The complete FIELD12 receiving journey then continues assign/edit -> save -> reopen history -> report -> actual visit/activity/result.

The complete source and one exact predecessor guard are in this carrier. If the importer has newer unrelated changes, apply the unique guarded replacement to its maintained source rather than replacing those additions.
