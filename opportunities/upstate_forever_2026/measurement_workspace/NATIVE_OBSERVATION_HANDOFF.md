# Measurements → native observation context

Use this panel inside the existing **Measured observations** desk, beneath the native chemistry panel. It transfers one original property-measurement import from the current SQLite Measurements store into the same native Workspace's observations. Monitoring change reads that native observations collection. This adapter closes that explicit store boundary; it does not start a temporal analysis or model.

## Original workflow

1. Receive a complete original laboratory/WQP file through the existing Measurements intake. Retain its actual scientific mapping and examine rejected rows, alternative source revisions and quality review.
2. Expand **Use a retained Measurements source in Monitoring change**. Select the original import and give the new context record a title.
3. Choose **Inspect original handoff**. Review the source SHA, original mapping, complete counts and first20 original occurrences. The projection displays original reported values/units beside the retained canonical point or bound and its normalized unit.
4. Confirm the source and context projection, then choose **Retain exact native context**. The server captures the same source revision again and requires the exact preview identity. A changed source, review, mapping or implementation requires a fresh inspection.
5. In **Monitoring change → Analyze your imported measurements**, select the saved title. The original analysis owner’s existing temporal controls determine dates, seasons, station selection and reviewed qualifier meanings. The native observation ID and full proposed interpretation can be downloaded from the handoff.
6. Open any saved handoff and download **Complete original source and native observation JSON**. It contains the complete original import, mapping, canonical rows, reviews, selected/alternative revision context, rejected original rows, native observation and source collection references. Native portable Workspace transport retains the source collection and observations as usual.

The same original import may be captured again after actual review changes; earlier handoffs remain immutable. Refreshing a catalogue never writes or repeats a source handoff. Closing or switching workspaces cancels the browser view, and the existing extension records a late write's returned identity without repeating it.

## Scientific meaning

The handoff uses the import's existing versioned canonical normalization. It never replaces the original source text. The retained CSV is explicitly a **canonical context projection**, with original reported values and units, canonical JSON, source row numbers and import/record IDs alongside every row. The complete source capture also remains embedded in the native observation metadata, so the unchanged CLOUD13 temporal source package includes the original file and rejected-row population rather than depending on a machine-local pointer.

All native rows use `measurement_support=other_context`, `observation_kind=source_context`, and `value_basis=context`. This generic support preserves pH, temperature, depth, optical measures, microbial counts, chemical concentrations and their actual units without labeling all properties concentrations. Native annual-load admission is always zero. A separate scientifically supported annual-load workflow retains its existing requirements.

A resolved left-censored upper bound becomes a `<` context row, a resolved right-censored lower bound becomes a `>` row, and an uncensored finite canonical measurement becomes a numerical context row. No below-limit value becomes zero or half a limit. No above-limit value becomes a point estimate. An unresolved interval, malformed quantity, original excluded review or unresolved/superseded source revision is retained with `context-only` and its explicit source disposition. Original detection-limit arrays, typed interpretation, analytical method authority, speciation, depth and physical/time bases remain in the full source quantity and canonical row. Original raw CSV columns also remain individually available as original:<column> in the native projection, so the temporal owner can explicitly map a legacy laboratory dimension absent from its earlier canonical edition. Result/activity depths, their original units and reference points, and relative depth are retained together as one structured depth key for cohort separation; no unit or depth datum is silently collapsed. Nonnegative temporal support is never inferred; the analysis owner may explicitly select it where scientifically justified.

The original source may contain agreeing duplicate occurrences. Their import ID + canonical record ID + source line yields distinct native occurrence IDs. Original activity/result identifiers remain available for the temporal engine's existing scientific grouping. This does not invent independent replicates.

## Existing API and source ownership

Additive sources:
- `measurement_workspace/engine/native_observations.mjs`: one original import captured in an existing consistent SQLite read, with current normalizer/source/link/record checks.
- `measurement_workspace/native_observations.py`: explicit preview, context preparation, immutable source retention and saved reopening using original `model.observations.ingest`.
- `operator/web/measured_native_observations.mjs`: the existing Measurements extension's source/preview/confirmation/saved-source panel.

The shared HTTP hook is `GET /native-observations/catalogue` and `GET /native-observations/imports/:id?expected_revision=...` under the existing Measurements API. The native extension route `POST /api/measurements/native-observations` accepts `{workspace,action,...}`, with actions `catalog`, `preview`, `prepare`, `get`, and `export`. Preview/prepare receive `selection={import_id,title,value_policy:'retained-canonical-context'}`; preparation additionally requires `expected_id`, `expected_revision` and `confirmed:true`.

CLOUD13's ten internally operated temporal source files are unchanged. No blocked publication is retried. Current Flow, load integration, Results/Inspect, source reconciliation, guided intake and source-shaped handback paths retain their cumulative source. The fragment adds only this handoff's paths and the existing shared hooks; it does not substitute an older whole application.

## Receiving and actual product operation

Use the current CLOUD13/DE49 original application and Workspace at the already accepted source boundary. Install the current cumulative public source plus this additive component, preserving the owner's internally operated temporal files and saved original analyses. Do not create another model process or overwrite an active Workspace. The actual supported service uses Node22.16+; it remains managed by the existing Python Measurements extension.

In that same project, open the current Hartwell132-row import or another already retained original source. Operate inspect → explicit confirmation → native retention → reopen, and then select that exact new title in Monitoring change. Return the original import/capture/native observation IDs and the actual exception if any. The source path review and V8 module parsing do not claim a native SQLite/Python or browser execution.

Before calling this client-facing product ready, the producing peer must actually open/run/render the exact outgoing version, look at the rendered screen or real screenshots, and operate important controls. Check desktop/screenshare and narrow390px widths, populated/empty/loading/error states, downloads and reopening. Capturing screenshots without viewing them is insufficient. Fix unstyled, cramped, clipped, overflowing or unreadable output. Code review, DOM counts, HTTP200, unit checks and peer approval do not replace seeing the product.

All attachments count: open the final HTML, PDF/report, CSV/JSON, archive and working project as the recipient would; extract archives and open their contained deliverables. Preserve original controls, source history and vendor policies. Use plain industrial design with readable tables, clear hierarchy, restrained controls and consistent spacing. Keep the same product finishing course; do not force restarts or revive owner-stopped work.

## Existing equipped receiver command

From the actual cumulative application directory, the source-only catalogue command is:

```sh
/usr/local/bin/python -B -m measurement_workspace.native_observations --workspace /mnt/data/eco-trends/workspace --action catalog --output /mnt/data/eco-trends/native-observation-catalog.json
```

Use the original owner's confirmed Workspace path if its retained directory differs. This starts only the existing managed Measurements service when needed; it does not launch a model. For preview/prepare, --selection names a complete JSON with the exact selected import ID/title/policy, followed by the returned expected_id/expected_revision and explicit confirmation for prepare. Preserve each returned JSON as a separate immutable output. The browser controls expose the same operations. Closing this CLI owns only its own managed service child, not the original operator server or scientific processes.
