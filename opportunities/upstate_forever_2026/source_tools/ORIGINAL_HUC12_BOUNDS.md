# Original 217-watershed acquisition bounds

The original model domain contains 217 HUC12 polygons. `original_huc12_bounds.py` derives one native bounding rectangle per polygon from the retained original ZIP, so the NHD continuation can acquire candidates near those watersheds while reusing its existing complete inventories and geometry pages.

The command uses Python's standard library. It reads every original ring and keeps the source decimal coordinates, HUC12 strings and typed object IDs. The output uses the source EPSG:3857 coordinate system.

## Run on the retained source

From the Upstate application root, use the existing operation's original ZIP and capture directory:

~~~sh
python -B -m source_tools.original_huc12_bounds \
  --archive "$ORIGINAL_DOMAIN_ZIP" \
  --output "$NHD_CAPTURE/bounds217"
~~~

The original archive is `dbc61-upstate-model-domain-20261012.zip`, retained as Library file `libfile_cce17e762e948191be1d226b1dbce00d` / `file_00000000982081f4a357dcf78d83f289`. Resolve that existing file or use the source holder's retained local copy. Set the two variables to that operation's actual paths.

The command writes:

| File | Use |
| --- | --- |
| `original-217-huc12-native-bounds.json` | Machine-readable native bounds, source identities, CRS and field metadata, exact domain extrema and original polygon counts. |
| `original-217-huc12-native-bounds.csv` | The same 217 ordered rows for operational inspection and transfer. Keep `huc12` as text when opening in a spreadsheet. |

Each row contains `huc12`, `object_id`, `xmin`, `ymin`, `xmax`, `ymax`, `ring_count` and `vertex_count`. Rows are sorted by the original twelve-digit HUC12 string. The printed result reports the actual output byte counts and SHA256s.

The JSON schema is `upstate.original-huc12-native-bounds/v1`. Its numbers preserve original decimal values; receiving Python code can use this module's `parsed` and `exact_json` functions to preserve that precision. The CSV emits those same decimal values without rounding.

## Source identity and coordinate handling

The reducer checks the complete archive and the retained polygon member before reading the features:

| Original object | Bytes | SHA256 |
| --- | ---: | --- |
| Domain ZIP | 8,800,689 | `1fc35e5d0986e42d93922527d46e38bc5132653db75863934349dbbfaa352c04` |
| `model-domain.esri.json.gz` | Checked by its SHA256 inside the original ZIP | `6f49c2f1dc10709d7957e38e92642a1de4cda44e67e4d70a8bc2ff51388e6af9` |
| Decoded Esri polygon response | 11,220,042 | `2300d9b32a513d70503222a5d2e782e032107297214036a58e8b444a312169af` |
| Canonically encoded sorted 217 HUC12 IDs | Computed from the original polygons | `ec0cb3d05a0ede9da1b9238b7c7bff2fa495d94e5a6a0451890b54233edfbd52` |

It reads the original `feature-bindings.json` and `domain-summary.json` companions from the same checked ZIP, verifies their field/ID bindings and records their identities. Every polygon contributes every ring to its extrema. Holes and disjoint parts therefore remain within the acquisition envelope.

The original domain composer preserved polygon decimal values but converted the aggregate summary bounds through ordinary JSON float serialization. The reducer reproduces that historical conversion only when comparing the summary companion. Its exported per-HUC and aggregate extrema remain the original decimal values.

The retained CRS aliases 3857, 102100 and 102113 are accepted as native Web Mercator; the export declares EPSG:3857. The reducer checks the source's actual field metadata and typed object IDs. If a different HUC field is explicitly required by retained metadata, select it with `--huc-field`.

## Continue the original NHD operation

Use the maintained [NHD original receiver](RESUME_NHD_ORIGINALS.md) with this JSON and the same original domain ZIP. Append `--huc-bounds "$NHD_CAPTURE/bounds217/original-217-huc12-native-bounds.json"` and `--huc-bounds-sha256 "$HUC_BOUNDS_SHA256"` to that operation's receiving command; set `HUC_BOUNDS_SHA256` to the exporter's actual printed JSON hash. Its HUC-envelope continuation retains the existing broad-scope native IDs and geometry, reuses complete covered scopes, and acquires the remaining candidate IDs through the original publisher layer.

The rectangles are acquisition windows. Final river membership remains the intersection of original whole flowlines with the complete original 217-polygon union in `water_context_geometry.select_domain_objects`. The receiver carries the original attributes and coordinate dimensions through that selection and into the source edition.

The exporter and its output belong to the existing source operation. The source ZIP, original HTTP response bank and received geometry remain available to the continuation so an interrupted transfer can reuse completed work.
