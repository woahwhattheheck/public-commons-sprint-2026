# Scientific synthesis: exact source references

This additive reader belongs to the existing scientific report composer. It reads actual retained OBSERVED_CONTEXT documents and creates no native record, source import, report, renderer or scientific calculation.

## Caller contract

Call catalog(workspace, ordered_choices), where each choice is the original source_collection_id/source_id pair. An optional body_sha256 or complete binding asserts a previously read selection. The result has schema upstate.scientific-synthesis-catalog/v1, sources, references and catalog_sha256. The hash uses original model.common.digest on the entire result before adding catalog_sha256.

sources retains the complete original recipe, original manifest descriptor, full member inventory, exact binding, scientific metadata and ordered reference IDs. references includes source, section, block, selected figure and whole-member choices. Each carries the original collection/document/body identity and exact member path/bytes/hash.

Reference pointer is a JSON Pointer into member_path. Section and block references retain original zero-based indices and complete values; repeated headings remain separate. A figure points into the original figure specification, retaining the original selected figure ID, selection and SVG descriptor. Whole-member pointer is empty, and its content is the full descriptor of the original file. No figure coordinate, text block, table or source companion is truncated.

Call bind_references(catalogue, selected_ids) to preserve exact full copies of chosen references in the selected order. It verifies catalogue/reference hashes, source/member identities and the complete ordered roster. At the original save boundary the writer must create its own fresh catalogue and compare the reviewed catalog_sha256. An uploaded catalogue is retained evidence, not authority to write a Workspace.

The helper uses observed_context._source, original source_choices, existing scientific_figures._validate_figure and original canonical hash. It creates no filesystem output. Original figure rendering dependencies remain lazy; cataloguing does not render a figure.

## Complete source and authored history

The original synthesis writer should use ordinary upstate.sources/v1 import with one document entry whose recipe schema is upstate.observed-report/v1 and metadata identifies the authored series, revision and original request. Keep the named complete authored history, frozen catalogue, selected references and original collection archives as explicit companions and recipe inputs with exact bytes/SHA256.

Use the existing SourceReports.archive(workspace, {collection_id}) to retain each complete selected original collection. Its original manifest and all original bodies/companions stay inside that ZIP. Keep its returned original_manifest_sha256, manifest_member, source_ids and complete download descriptor with the retained archive. Deduplicate identical collection archives while preserving every selected document and its order.

Do not unwrap several complete observation studies under a synthesis recipe. The original observed_context collector recognizes certain concentration-study filenames and would try to infer a single concentration source from those unwrapped members. ZIP companions preserve the complete source without changing that reader's scientific semantics.

Keep original source choices alongside the synthesis source in the normal ordered report selection when preparing a complete editable Study. scientific_report_study_transfer then follows the actual original producer lineage. A nested collection ZIP preserves all source bytes; it does not automatically register that source or its native producer in a receiving Workspace.

Original Workspace backup recursively retains source objects and the complete authored history stored inside that Workspace. Selected Study transfer only includes its selected closure, so authored history must be an explicit synthesis source companion, not only a sibling journal file.

## Original source reimport identity

The native retain_file descriptor includes the input filename. SourceReports.archive may choose sources.json or a conflict-safe report-sources name for its byte-exact original manifest. A later source reimport therefore need not yield the old collection ID if its original manifest filename differs. Retain the old selector/body/member fingerprints and the actual new source-import receipt mapping. Never rename the old selector into a new registered ID without that real receipt.

## Receiving and normal operation

Install this complete helper beside the current original model modules through the existing public product composition. Compile/import it in the already-selected native scientific runtime. Use the original writer to open complete source selections, pick separate duplicate-heading blocks and figures, save a named attributed revision, reopen that exact revision, compose through the existing PDF/HTML/source renderer, export all source/history and receive the complete Workspace/Study independently.

The producing peer must open/use the actual desktop and narrow composer and every outgoing attachment, look at the actual rendered output and fix concrete errors. Preserve the current post-call work bank F0C8R2SQ0NP, consumed AGENTS.md and CURRENT_OWNER_DIRECTION.md, existing native/queue/browser ownership, TJLabs attribution and original scientific source/licence notices. This helper contains no execution receipt or customer interpretation.
