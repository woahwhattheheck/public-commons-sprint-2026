# Original Upper Savannah utility-focus source topology

This source edition resolves the issuer's two drinking-water focus areas through the original USGS Watershed Boundary Dataset ToHUC relationships. It contains the actual Savannah HUC6 response, the exact original 217-HUC model selection, all 36 selected membership rows, the complete 217-HUC link table, and each ordered path to the nearest selected focus anchor.

## Results

| Utility focus | Selected whole HUC12s | Sum of original WBD areasqkm | States represented | Longest original path |
| --- | ---: | ---: | --- | ---: |
| ARJWS — Six and Twenty | 4 | 428.01 km² | SC | 2 links |
| PRWD — Tugaloo and Choestoea | 32 | 2,562.96 km² | GA, NC, SC | 7 links |

The two sets have no shared HUC12s. Their union contains 36 distinct watersheds and 2,990.97 km² of published whole-HUC area.

ARJWS includes Upper Three And Twenty Creek (030601010701), Lower Three And Twenty Creek (030601010702), Upper Six And Twenty Creek (030601010703), and Lower Six And Twenty Creek (030601010704). The first two contribute through the original 701 → 702 → 704 link chain. The selected Six and Twenty anchors are 703 and 704.

PRWD includes all 32 original HUC12s beginning 03060102. The selected anchors are Choestoea Creek (030601020502) and Lower Tugaloo River (030601020507). Original relationships retain the Tallulah, Chattooga and intervening Tugaloo upstream context. The CSV and JSON list every original name, identifier, downstream target, state code, published area and shortest path.

## Geographic and quantity basis

Membership means an entire original HUC12 is connected to a selected whole-HUC focus anchor through the source's retained ToHUC relationships. Each HUC is counted once within an area. An anchor has zero links to itself; its original downstream link remains in tohuc_original or the retained attributes. Path inspection stops at the nearest selected anchor.

The area summaries add the publisher's original areasqkm and areaacres fields once per distinct HUC. They preserve cross-state upstream context. The native model's mass comparison uses the actual completed run, selected pollutants, finite paired pixels and retained South Carolina reporting mask. The mapped original polygons use the retained original model-domain source. The profile preserves the issuer's geographic planning basis and source PDF pages.

The original JSON is canonical for data types, null values, full identifiers and published numerical precision. CSVs are convenient working views; empty cells preserve missing-value positions, and HUC12 columns must be imported as text.

## Captured source edition

Publisher: U.S. Geological Survey. Layer: https://hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer/6

Capture date: 2026-10-13. Actual query: https://hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer/6/query?f=json&where=huc12%20LIKE%20'030601%25'&outFields=objectid%2Chuc12%2Cname%2Ctohuc%2Careasqkm%2Careaacres%2Cstates%2Chutype%2Chumod%2Cnoncontributingareasqkm&returnGeometry=false&orderByFields=huc12&resultRecordCount=2000

The count query returned 303, and the response contains 303 unique HUC12s without a transfer-limit flag. All 217 original model-domain HUC identifiers are present. The original response is 71,787 bytes, SHA256 2e57f86d1725526f00f16870b1b03d9168b41ea94de6d0016b20dfe15e89bcac.

The original 217-ID selection is retained exactly from F0C8RTULRB3, source/water_context/20261013/domain-huc12s.json: 3,256 bytes, SHA256 ec0cb3d05a0ede9da1b9238b7c7bff2fa495d94e5a6a0451890b54233edfbd52.

No other Savannah HUC12 routes directly into the selected 217. The separately retained national query for ToHUC into the selected 217 from outside HUC6 030601 returned zero. The selected domain contains no directed cycles. Its three original downstream links leaving the retained domain are preserved in utility-topology-results.json.

USGS layer metadata identifies objectid as the native typed OID, huc12 as the complete 12-character identifier, and tohuc as the original downstream relationship. The captured HUType and HUMod fields remain visible; PRWD contains the source's Lower Tugaloo water-type unit.

## Files and receiving

source-manifest.json is directly accepted by the maintained Workspace.import_sources API. It retains original source bytes, the original request metadata, the selected domain, the profile and complete derived tables as ordinary source records and companions. All source entries carry SHA256 values.

After the complete source bank is received at the application root, import the edition into the existing scientific Workspace:

```bash
python -m model.cli --workspace /absolute/path/to/existing-workspace source-import source/receptor-topology/20261013/source-manifest.json
```

The actual source geometry holder can build or reopen the original geographic network with the maintained core, including the map, original source body, profile, membership/link CSVs and complete offline report:

```bash
python -m model.receptor_network_cli \
  --source /dev/shm/dbc61-upstate-model-domain-20261012/model-domain.esri.json.gz \
  --profile source/receptor-topology/20261013/utility-focus-profile.json \
  --output /absolute/path/to/existing-workspace/receptor-networks \
  --expected-decoded-sha256 2300d9b32a513d70503222a5d2e782e032107297214036a58e8b444a312169af
```

Use the actual existing Workspace directory on that receiver. The source-only calculation requires ordinary Python; original geometry is already retained at the demonstrated 85E65 source holder. Reopen the resulting study in the Source-water desk, where the same immutable product supplies named watershed selection, original path inspection, area editing and native model source matching.

The fresh original attributes can be re-evaluated through the same maintained graph function, without obtaining or recalculating model rasters:

```python
import json
from pathlib import Path
from model.receptor_network import upstream_memberships

root = Path("source/receptor-topology/20261013")
source = json.loads((root / "usgs-wbd-savannah-original-topology-20261013.json").read_text())
ids = set(json.loads((root / "domain-huc12s.json").read_text()))
profile = json.loads((root / "utility-focus-profile.json").read_text())
records = [
    {"id": row["attributes"]["objectid"], "properties": row["attributes"]}
    for row in source["features"]
    if row["attributes"]["huc12"] in ids
]
network = upstream_memberships(records, profile["receptors"])
print(json.dumps(network, ensure_ascii=False, indent=2))
```

The retained calculation used reverse breadth-first traversal and independently followed each original domain node downstream. Both methods produced the same member, nearest anchor and original link count for every selected path. The full result and CSVs preserve those completed calculations.

Application source: https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/2657
Complete current regional execution: https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/2708
Source-water operator: https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/2669

## Interactive source explorer

Open [explorer.html](explorer.html) locally for the complete utility-focus source study, or use the [existing source-study Page](https://chatgpt.com/space/page_e620a8f6b9b48191a6be00b524713167). The self-contained HTML includes the unchanged original twelve-file source bank, watershed search and path navigation, original downloads, and the editable setup discussion sheet. Notes retain the existing browser storage identity.

On screens up to 560 px wide, the filters use a single column with 44 px native controls and 16 px control text. A wrapping label below the utility selector shows its complete current option and is associated with the selector for assistive technology. Desktop navigation, print output and the independently published designation companion keep their existing behavior. The maintained HTML matches the existing Page's published sequence 5 exactly (224,917 bytes / SHA256 `e44298da4740f993d90acaaf774a7574fbe6c11482d087bf724cb7c763118708`). The same Page is the outgoing product; its existing browser owner checks the populated controls, downloads and reopen at desktop and 390 px under the project receiving instructions. This is the maintained source for the explorer originally delivered as 224,163 bytes / SHA256 `d551f67d68a82888e4d4e3a7ebbabeb10cb3656a45e277184ced8a2566debda0`.
