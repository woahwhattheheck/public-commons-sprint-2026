# Receive a saved map through the customer review workflow

This adapter continues the original regional Workspace operation. The spatial
operator owns source intake, the saved geographic reviews, the native map
export, the browser session and the first full Workspace backup.

`customer_spatial_receiving.py` and `customer_spatial_receiving.mjs` join the
completed saved maps, original 217-feature upstream source edition and all 33
source-linked issuer requirements to the existing customer review engine.
The same browser exports a response, the original engine imports that response,
and the full Workspace restore reopens the same records and files.

## Source composition

Use the customer review component from private PR36085,
merge `381e124aa9c0978cd7430935eb24c29ebbe2c096`, with this paired receiving
adapter. The complete nine-file component is retained in
[the original source carrier](https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8LQKGF62).
The regional issuer and intake sources are retained in
[the original regional carrier](https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8Q2JTTTK).

The original source composition and application materializer remain responsible
for the whole application member set. These adapters pin their direct customer
engine, command, offline desk and original issuer inputs. Preserve the spatial
renderer, model source and later compatible online operator additions in the
existing cumulative source composition. Every included file still belongs in
that composition's complete byte/hash inventory before native execution.

The original issuer PDF is 7,470,549 bytes, SHA256
`04313cdda0b19f98b4081ef1eeec2f52707437759f9058f8d0e5abc8d83d6dbf`,
at `source/acceptance/20261012/official-rfp.pdf`. Its source manifest and the
five retained acceptance files are unchanged.

## Join the completed maps

The existing spatial owner exports the selected saved geographic view through
`SpatialExports`, using the original cached `SpatialReview` instance. After
that original export returns `state: "complete"`, place its exact ID in the
existing receiving control before the first customer phase:

```javascript
control.spatial_export_ids = [exported.id];
await customer.beforeBackup({context, control, report, persist, stage});
```

Keep `spatial_export_ids` in that same retained control during restore. More than
one complete map may be selected. Each may refer to its own saved geographic
view in the original Workspace; the review retains that export's actual
`review_id`, complete file set and original saved view. The original
`report.review_id` continues to identify the regional source review.

The optional map array is copied into the existing
`upstate.customer-spatial-receiving-context/v1` document. With an empty array,
the context keeps its original source-only shape. Previously retained context,
review, response and source records are preserved. A changed selection receives
its own customer context and review through the existing operation owner.

The native Python interface is unchanged:

```bash
python -B operator/customer_spatial_receiving.py --context customer-context.json prepare
python -B operator/customer_spatial_receiving.py --context customer-context.json \
  --response browser-response.json import-response
python -B received/application/operator/customer_spatial_receiving.py \
  --context customer-context.json --application received/application \
  --workspace received/workspace restored
```

The original browser module still exposes `beforeBackup` and `restored`.
The spatial programme invokes them before its first backup and after its original
restore. Retain the exact context path and the original complete output
directory between these phases.

## What the customer receives

The review engine selects each completed map with `spatial_export_ids`. Its
original native inspection supplies the complete 14-file export and
`export.json`. The map PDF, SVG, PNG, package, saved view, annotations,
provenance and source description remain exact original artifacts. They appear
beside the retained upstream source and issuer PDF in the ordinary review desk.

The native adapter records each selected completed export and its actual saved
geographic view in the same customer state. Packet creation, response import
and restore compare the original record identities, original relative file
paths and all recorded byte counts and hashes. Selection comparison uses the
original engine's normalization, so an older source-only selection still
reopens with its empty map list.

The browser reads every returned artifact. For each selected map, it also loads
the actual original PNG from the exported packet and records its intrinsic
width, height and source identity. The restored desk repeats that original map
preview alongside the retained response history.

The current regional response uses the stated C79F internal engineering
identity. It retains the two original source/planning questions and the
remaining 31 requirements as unreviewed. The paired source preserves those
comments and every artifact decision. Subsequent reviewers can use the same
ordinary draft, response import and correction workflow.

Each phase result includes `spatial_export_ids` and the selected export
descriptors. The completed browser/restore result includes `map_previews`
with the exact export ID, artifact ID, original PNG hash and observed native
image dimensions. The existing spatial owner retains these results together
with the complete customer package and full Workspace archive in its original
delivery.
