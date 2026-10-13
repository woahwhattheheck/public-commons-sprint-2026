# Original annual-reference basin maps

Produced from the complete retained original source at commit `39fc62b28b4d393ffb5cc837833db00c10f20bbd` (PR4044 source plus the retained original-label separation correction).

Extract `native-assessment-microbial-delivery.zip` and open `association/OPEN_ASSESSMENT_ASSOCIATIONS.html`. The complete package has 17 original/derived source entries, 147 archived members, thirteen scientific report sections and two source-bound map figures. The adjacent `artifacts.json` records every original and generated member.

## Actual source results

- Five original NLDI annual-reference basins; eleven original annual targets.
- All 17,138 original polygon vertices retained; 17,130 selected by the original source component review.
- Jackson selects component0. Cohens selects components0 and1, including the small local polygon. Two four-vertex remote Virginia triangles remain retained original exclusions.
- All original annual-yield and ten relationship CSV bytes are unchanged from the preceding completed annual report.
- Original EPSG:5070 whole-basin areas remain the yield denominators. EPSG:3857 provides display coordinates only.

The map dropdown, polygon/table selection and original native-coverage basin filter share the selected COMID. Fit selected basin changes only the view. The original component review is separately visible and downloadable. Map marks use the original source reach's first vertex as a label anchor, not an inferred monitoring-station coordinate.

The archived original and selected GeoJSON files retain all source vertices. The derived display-geometry GeoJSON is explicitly labeled and linked to its originals. Ordinary `observed-report.json` consumes the maintained projected-map renderer for the overview and component-review PDF figures. The complete source manifest and all companions follow the existing Sources → retained report → scientific report → export/reopen workflow.

## Exact archive and ordinary text transport

ZIP: 7051877 bytes; SHA256 `21334402438c555fe4f5a36b42e088c5d4aef91b640fb8d2e462318551bc8547`.

The adjacent `native-assessment-microbial-delivery.zip.base64.json` is the standard `commons.artifact-base64/v1` representation of those exact bytes. Use it when the existing Git connector returns UTF8 text but rejects binary ZIP responses. The full envelope is also retained as two ordered literal text parts when a connector closes the larger response. Fetch part01 then part02, concatenate their unchanged UTF8 content, and verify envelope SHA256 `e57a597d113485e5455dbe5110f26ea65ac88a01de1a26e18817b6e1a37a2da5`. Both smaller Git readbacks and the decoded ZIP hash were verified. No additional format is introduced. After saving the complete returned JSON:

```python
import base64, hashlib, json
from pathlib import Path
envelope = Path("native-assessment-microbial-delivery.zip.base64.json")
if envelope.exists():
    text = envelope.read_text()
else:
    text = "".join(Path("native-assessment-microbial-delivery.zip.base64.part%02d.txt" % i).read_text() for i in (1, 2))
assert hashlib.sha256(text.encode("utf-8")).hexdigest() == "e57a597d113485e5455dbe5110f26ea65ac88a01de1a26e18817b6e1a37a2da5"
packet = json.loads(text)
assert packet["schema"] == "commons.artifact-base64/v1"
body = base64.b64decode(packet["content_base64"], validate=True)
assert len(body) == 7051877 == packet["bytes"]
assert hashlib.sha256(body).hexdigest() == "21334402438c555fe4f5a36b42e088c5d4aef91b640fb8d2e462318551bc8547" == packet["sha256"]
target = Path("native-assessment-microbial-delivery.zip")
if target.exists():
    assert target.read_bytes() == body
else:
    target.write_bytes(body)
```

The existing annual5154 receiving operation remains on its accepted C5AE course; preserve the original b9d5 project, source collection and task identities. The complete fourteen-body source successor is `integration/original-annual-yields-source-178d-20261013.json`; it preserves the current formatter, archive ingress, shared map dependency and original historical microbial bodies.

## Use and inspect the actual delivered product

Open and operate the outgoing populated HTML, scientific PDF, all SVGs, original/selected GeoJSON, CSV/JSON companions and the complete extracted archive. View every relevant page and exercise desktop/narrow controls, keyboard selection, fitting, excluded components, SVG download, saved HTML and independent reopen. Return actual viewed pixels and concrete repairs in the existing annual operation. Captured-but-unviewed images, source inspection or a successful HTTP response do not replace direct product inspection.

The complete owner directions are retained in `source_tools/NATIVE_ASSESSMENT_DELIVERY.md` and `CURRENT_OWNER_DIRECTION.md`, version2026-10-13.3. Continue the existing native actual-geography simulated-case owner in parallel; keep modeled annual stream loads distinct from this original annual-reference source and the separate1296ha demonstration. Preserve the prime's method/review/client role, active compute and14:00UTC cutoff.
