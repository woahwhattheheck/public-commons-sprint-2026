# Original annual watershed reference yields

This complete existing native assessment delivery was generated from the retained original source bodies using producer commit c6e6c80f9c0ae1f35eb4f15813f2e93ec7f30c99 (PR3907). The completed archive is `native-assessment-microbial-delivery.zip`: 2867503 bytes, SHA256 `14041f85f6ec686137c4f06e745a460f875de4db8e012832f5aca3bb042f5058`.

Extract the ZIP into a new directory. Open `association/OPEN_ASSESSMENT_ASSOCIATIONS.html` to use the populated original station, geographic, annual-reference and microbial views. The archive has 134 members, including the normal `sources.json` and `observed-report.json` for the existing Workspace source-import and scientific report composer. All 17 original/derived source entries are present; original completed observations, station identities, basin geometry, source editions and raw records remain attached.

The new **Annual reference yields** section has all eleven original targets across five whole contributing basins. The original annual mass is divided by the original full-polygon area in hectares. Raw TSS remains raw; TSS_CONV remains source context. Source-global dates, exact units, full table-row identities and all ten original overlap/containment relations are in the three downloadable annual-reference files. The standalone copies here are byte-identical to `association/` inside the archive.

The full producer source successor is `integration/original-annual-yields-source-178d-20261013.json`; each of its ten source/input files includes the complete byte-exact source, length and SHA256. Compose these over the current maintained application, retaining its current dependencies and other scientific workflows. The producer uses the exact retained microbial presentation companions at b91a8dd8936fae52666d65c215475e89debdeb6c when reproducing this immutable input edition; newer main versions of those three companions have different hashes.

Use the existing ES9960/A74F/S1/0730 scientific-context receiving operation to import this complete archive and compose its ordinary report. No native model or geometry recalculation is needed for this source report. Continue the same project, domain collection, task records and completed runs.

## Inspect the actual outgoing files

The producing receiver must open the exact populated HTML and actual composed PDF/report pages, operate the source/basin/station filters and annual links, download and reopen the CSV/JSON, then reopen the retained archive/project contents in their normal application. Look at actual pixels at screenshare and narrow widths. Return the affected viewed pages/screenshots through the existing operation so the source owner can inspect and repair any concrete layout/control issue. Generated HTML/source checks do not establish a rendered visual pass. The full current owner instruction (AGENTS blob46be323017be913780d0d2850b7658861744508d) is retained in the receiving guide, including all-attachment inspection and the existing14:00UTC sprint cutoff.

## Existing receiving route when binary Git reads are unavailable

`native-assessment-microbial-delivery.zip.base64.json` is the same completed ZIP in the standard `commons.artifact-base64/v1` UTF-8 envelope. Retrieve this text with the current connected Git file/blob reader, then decode it into the exact existing archive. This avoids relying on a receiver's direct binary HTTP/DNS route. It does not create another source edition or controller.

~~~python
import base64, hashlib, json
from pathlib import Path
packet = json.loads(Path("native-assessment-microbial-delivery.zip.base64.json").read_text(encoding="utf-8-sig"))
assert packet["schema"] == "commons.artifact-base64/v1"
body = base64.b64decode(packet["content_base64"], validate=True)
assert len(body) == packet["bytes"] == 2867503
assert hashlib.sha256(body).hexdigest() == packet["sha256"] == "14041f85f6ec686137c4f06e745a460f875de4db8e012832f5aca3bb042f5058"
out = Path("native-assessment-microbial-delivery.zip")
if out.exists():
    assert out.read_bytes() == body
else:
    out.write_bytes(body)
print("ANNUAL_DELIVERY_READY", out, len(body), flush=True)
~~~

Continue the unchanged original source/archive intake and populated report inspection above. Preserve the same0730 annual7303/9808 operation and all original project/task identities.
