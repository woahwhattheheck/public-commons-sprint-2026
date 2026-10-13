# F7 tributary preparation — complete source-only receiving package

This release contains **15 complete source and data files** from source commit `2b6cbbf4910743302fd065a395b010f60d784564`. It uses the existing national annual-source importer and exact retained P9 NLDI basins to create the seven-record F7 successor. All eleven original Upper Savannah records remain source context. No P9 data or saved evaluation is changed.

The complete preparation can run with qualified Python, Shapely and pyproj **without a scientific Workspace or full application**. The included unchanged native reader, common primitives and verified-file helper form its local source closure. Importing the resulting source into a Workspace is a later explicit operation using the full native application.

## Receive the source

Save the exact complete text blob `4a4fa4f7f7eb73f6ec40c6421f1330389ab9cea7` as `source-bank.base64.txt`, and the adjacent `materialize_source.py` into the same receiving directory. A normal file download of `source-bank.json.gz` is equivalent. The materializer checks the entire container and every original source member before creating a new source directory.

The original national inputs are the already completed 9072 archive: Drive file `16LDSlej6CJ0FoeO_nVbDL9JR069Njc6t`, **5,287,188 bytes**, SHA-256 `43868c684f747a92395ef570626a25253b517d702eb74ec2aa0eb3a68606112d`. Retain it unchanged. There is no source reacquisition or new NLDI request.

Set `ECO_F7_ROOT` to this operation's actual new directory, `ECO_PYTHON` to the qualified GIS Python and `ECO_F7_ARCHIVE` to the actual materialized original archive:

```bash
"$ECO_PYTHON" "$ECO_F7_ROOT/materialize_source.py" --bank "$ECO_F7_ROOT/source-bank.base64.txt" --output "$ECO_F7_ROOT/source"
PYTHONPATH="$ECO_F7_ROOT/source" "$ECO_PYTHON" "$ECO_F7_ROOT/source/source_tools/prepare_f7_tributaries.py" --archive "$ECO_F7_ARCHIVE" --bundle "$ECO_F7_ROOT/source/source/usgs-annual-2012/upper-savannah" --output "$ECO_F7_ROOT/prepared"
```

The confirmed receiving runtime at ECO-NATIVE-6ACE is `/mnt/data/eco_native_6ace/scientific/runtime/bin/python`. Use that exact existing runtime if operating on that host. Keep its existing source, jobs and Workspaces intact. The new source/prepared/staging paths are separate, and this command does not invoke NDR, SDR, calibration fitting or another model.

If the original archive is already extracted, the adapter accepts `--original-root ACTUAL_DIRECTORY` instead of `--archive`; it verifies the same three original files and accepts the actual `original/` child layout. The complete archive source is preserved and arbitrary ZIP extraction is not used.

The output prints the new preparation ID, seven-record count, eleven-context count and three basin identities. Its source manifest contains the national ZIPs/dictionary, complete F7 target rows, source selection, original NLDI files, native importer, observation CSV/metadata and basin provenance. Publish the complete prepared directory or its complete ZIP with the actual result summary. Do not send only the CSV.

## Bind and use the new source

The original production application can import the complete prepared source later:

```bash
PYTHONPATH="$ECO_APP" "$ECO_PYTHON" -m source_tools.usgs_annual bind --workspace "$ECO_WORKSPACE" --prepared "$ECO_F7_PREPARED"
```

Retain the actual returned observation/source-collection/catchment selector IDs. The optional Workspace mode documented in `source/usgs-annual-2012/upper-savannah/PREPARE_F7.md` requires the full scientific application, rather than this prepare-only runtime closure.

The original P9 scores, selected native profile, predictions, geographic groups and holdout partition remain retained. F7 published standard-error analysis is a distinct related-source sensitivity product. Original final estimators, kg/year values, source water-quality windows and flow support remain explicit. Identical NLDI basin IDs do not by themselves establish same-DEM gauge drainage.

## Verified identities

| Carrier | Bytes | SHA-256 |
|---|---:|---|
| JSON source bank | 322489 | 053aa6d7d0873b215b8b16addc07f714850ae592aae9e1f5780cb441ec5484ed |
| Gzip | 91500 | 7868c0735ab6e6c2f081bebf786856a703e678aca13865ad94d32eec0de9cc2b |
| UTF-8 Base64 | 122000 | 4fec31cbd6c85f91c16109a3671da0bfe6860e51e64e1df23f9bcb391949f1f1 |

All15 paths and Git/byte/SHA identities are in `manifest.json`. Every body matches the anchored source commit, and connected carrier readback/decompression/member verification passed. Native preparation remains to be executed by the existing receiving owner; these source checks are not a claim of a completed native result.

Original coordination: Eco thread `1791724121.853269`, source successor deconfliction `1791918349.495279`.
