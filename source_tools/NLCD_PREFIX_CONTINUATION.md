# Continue the original NLCD source after transfer progress

The original regional receiving operation uses the 2025 Annual NLCD CONUS
Collection 1 Version 2 national archive. It retains the original 217-HUC domain,
1,000 m source buffer, native class values and archive-backed local preparation.

This complete adopter continues the existing receiving operation after its
in-place partial file has grown or has been renamed to the completed archive.
The original handoff remains unchanged. Its capture receipts, source selection,
HTTP recovery, native preparation programme and published data identities remain
the same.

## Source identity

- National archive:
  https://www.mrlc.gov/downloads/sciweb1/shared/mrlc/data-bundles/Annual_NLCD_LndCov_2025_CU_C1V2.zip
- Original observed total: 1,457,983,950 bytes.
- Original strong ETag: `"56e711ce-64fec1a6cfdae"`.
- Original retained prefix: 218,248,092 bytes;
  SHA256 `2d1b6efed9193ffbb5dd9499567fef15c8e13de31c275506a421c110c465c25e`.
- Unchanged `Upstate_Original_NLCD_Prefix_Continuation.json`: 272,004 bytes;
  SHA256 `7fecf93725718e268e6f911abe456e5d9016aed52acced1b0c20310964ede7bb`.
- Original domain ZIP: 8,800,689 bytes;
  SHA256 `1fc35e5d0986e42d93922527d46e38bc5132653db75863934349dbbfaa352c04`.

Materialize that exact existing handoff and original domain through their
established authenticated source route. Preserve the final newline in the
handoff: its original byte count and hash include it.

## Choose the existing receiving operation

Use the actual installed scientific interpreter, current application source and
the original operation's persistent directory. Keep its source files together on
that filesystem. The original `PREFIX_ADOPTION.json` binds the receiving root to
the exact handoff bytes. Existing source receipts and mutable range-recovery
state remain authoritative.

The maintained prefix recovery is
`source_tools/recover_original_nlcd_prefix.py`, originally published in commit
`68ba68d65bf688bb7b86abc936ea5ec9109edac9`. Use it only for the initial missing
prefix on an unadopted receiving root:

~~~bash
"$UPSTATE_PYTHON" -B source_tools/recover_original_nlcd_prefix.py \
  "$UPSTATE_HANDOFF" --root "$UPSTATE_NLCD_ROOT"
~~~

That command receives the original prefix from the same public entity, checking
its exact response range, total length, strong validator and retained prefix
hash. An already-received original prefix can be supplied directly to the
adopter instead.

## Adopt and continue through native preparation

From the current application root, use this published successor entrypoint:

~~~bash
"$UPSTATE_PYTHON" -B source_tools/adopt_original_nlcd_prefix.py \
  "$UPSTATE_HANDOFF" \
  --prefix "$UPSTATE_NLCD_ROOT/inputs/Annual_NLCD_LndCov_2025_CU_C1V2.zip.partial" \
  --root "$UPSTATE_NLCD_ROOT" \
  --execute \
  --domain-archive "$UPSTATE_DOMAIN_ARCHIVE"
~~~

On first adoption, the supplied seed must be exactly the original prefix. Once
the root is adopted, the same command verifies the original prefix within the
retained current partial or completed archive. It accepts an in-place partial
that has grown and a completed archive whose old partial filename no longer
exists. A changed handoff, mismatched original prefix, missing retained source
state, or conflicting original source body still fails.

Keep calling the current application's `source_tools/adopt_original_nlcd_prefix.py`
for this continuation. The original older adopter inside the unchanged handoff
is retained as source history; it is not the successor entrypoint.

Omit `--execute` to perform only source adoption. With `--execute`, the existing
capacity-aware HTTP continuation runs first, followed by the original national
receiver and local domain preparation. The source's original locks protect both
stages. There is no second acquisition or alternative model engine.

## Read the actual stage outputs

The existing operation records its progress and usable source separately:

| Retained output | Meaning |
| --- | --- |
| `PREFIX_ADOPTION.json` | This root selected the exact original handoff. |
| `http-native-recovery/progress.json` | Latest original byte-range and actual host capacity observation. |
| `http-native-recovery/receiving.json` | The original HTTP recovery completed its full entity. |
| `RESULT.json` | `SOURCE_READY`: actual prepared source ID, manifest identity, native/prepared grid and domain selection. |
| `prepared/sources.json` | Original Workspace source import manifest and retained companions. |
| `DELIVERY_RESULT.json` | The separate full source package completed. |

The receiver writes `RESULT.json` and the prepared manifest before constructing
the full portable source ZIP. A later package-capacity error does not undo those
completed source files. Verify and import the retained prepared manifest through
the original Workspace source API; preserve the original archive and companions.
The same operation can finish its packaging when space is available.

Use the actual returned `source_manifest` and `source_id`; do not substitute the
original national archive for the prepared categorical raster. The maintained
terrain and soil preparations consume that exact local reference edition.

## Join the regional model and four source areas

Compose the prepared NLCD, original reporting/model-domain vectors, DEM and
PRISM source editions with the existing `source_tools.compose` or
`source_tools.operator_source_intake`. The regional biophysical table is the
existing project source. Original R and K sources complete the SDR input chain.

The existing `model.regional_job` core command creates the baseline independently
of the presentation overlays:

~~~bash
"$UPSTATE_PYTHON" -B -m model.regional_job run \
  --workspace "$UPSTATE_WORKSPACE" \
  --plan "$UPSTATE_REGIONAL_CORE_PLAN" \
  --source-reference "$UPSTATE_APPLICATION_REFERENCE" \
  --output "$UPSTATE_CORE_RESULT"
~~~

Bind the actual regional grid and completed baseline ID to the already-prepared
four ARJWS/Pioneer source areas. Their published source-water polygons lie in
Upper Savannah and need a spatially overlapping reporting area. The separate
Gura engine case retains its own geography and source inputs.

Continue through the original Scenario analysis and Receiving waters methods:
per-area physical values stay separate from overlap-safe receiving-water family
unions. Full seven-map delivery uses the selected completed NDR and SDR runs.

## Source change

The predecessor adopter is 9,424 bytes, SHA256
`5854a3c56821656123e8e3e6dadc32cab0341b9165d98c07e10717f926eae517`,
inside the original handoff. The successor moves only its exact external-seed
check behind the existing matching adoption receipt. The retained target's
original-prefix validation and native source/preparation bodies remain unchanged.
