# Water Context repeated line measurement

Authored by TokenJunkieLabs.

The retained Water Context core constructs the same projected-to-WGS84 Transformer and WGS84 Geod for each line measurement. A large flowline inventory also measures geometric unions, source features and clipped HUC/utility relationships. The revised core keeps up to 16 CRS-specific pairs and performs the existing coordinate transformation and ellipsoidal geometry-length calculation on every call. It caches setup only; it retains the original geometry, clipping, union, source fields, feature identities and output method identity.

The key is the exact pyproj CRS input definition (CRS.from_user_input(crs).srs), including custom WKT/PROJ definitions. Empty geometry still returns zero without constructing a CRS. Invalid CRS handling stays pyproj's normal validation. Cache eviction only recreates setup. Current native environments use pyproj 3.1 or newer, where Transformer objects support thread-safe reuse.

Implementation guidance: https://pyproj4.github.io/pyproj/stable/advanced_examples.html#caching-pyproj-objects and https://pyproj4.github.io/pyproj/stable/advanced_examples.html#multithreading.

## Native operation

Compose model/water_context.py into the application's actual current source. The original baseline is 59,899 bytes / SHA256 4980d7a02870994184f86a158c0f880235732378283931880b0b1c3a0ec90e13. Preserve later unrelated edits when applying the change; the only changes are the functools.lru_cache import, the added _geodesic_context factory and the _geodesic_length setup call. The full postimage travels in this family.

Run from the actual application root with its GIS Python:

    python -m source_tools.profile_water_context_lengths --source source/sv833-hydrologic-context-20261013/upstream-original-reaches.geojson --output /mnt/data/water-context-original-length-profile.json

The profiler uses every existing source line feature, transforms the original coordinate set to each requested measurement CRS, and runs the exact prior and current WGS84 length formula on those same geometries. The default pair is EPSG:5070 and EPSG:32617, with five passes each. It retains source file identity, native feature identifiers, Python/GIS versions, every feature's values, floating-point result hashes, cache hits/misses and observed wall times. Exit status is nonzero if any per-feature value differs. The report records actual measured speed; do not substitute projected timing.

Additional --source inputs accept original Esri Z/M response JSON (XY path coordinates are the same horizontal geometry used by Water Context). The original CRS comes from the response spatialReference, GeoJSON crs, or standard GeoJSON EPSG:4326. Use --source-crs only for an explicitly known original CRS. Select the assessment's actual CRS with --measurement-crs. On final original NHD import, run the same profile on an acquired body, then continue the full saved Water Context assessment and portable export/reopen.


## Completed native measurement — 13 October 2026

The first actual native run used Python 3.13.5, pyproj 3.7.2 and Shapely 2.1.2 on Linux. It measured all 45 retained SV-833 upstream reaches, with five full passes per method and CRS. Exact original source SHA-256: 09230843f840849d17f0690e94f470a5efecd0e3558279f7eb3a94b6e53c834c. Measured model/water_context.py SHA-256: 30d92117cada4f6b2578b36393b18e35b53626beb680f43cb4d82632b2d764f9.

| Measurement CRS | Prior median /45 features | Cached median /45 features | Observed ratio |
| --- | ---: | ---: | ---: |
| EPSG:5070 | 79.665413 ms | 2.179771 ms | 36.547607× |
| EPSG:32617 | 10.855827 ms | 2.089404 ms | 5.195657× |

Every individual length is bitwise equal before/after within each CRS. Maximum absolute difference is zero. Both cases have one context-cache miss and 269 hits, including the comparison pass and five timed passes. The totals are 62.00994641943648 km (5070) and 62.009946419444496 km (32617); the benchmark retains each CRS's transformed input geometry and full individual results.

These measured timings apply to the repeated geometry-length routine on this native host and source family. Use the actual model and complete Water Context workflow for end-to-end production timings.

The unchanged 15,496-byte native result is [water-context-45-reach-native-profile-20261013.json](water-context-45-reach-native-profile-20261013.json), SHA-256 6286783310e60b376c429935681554792fc631bdf09605b7bbd601e937c301e6. Native production message: https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791887877215699. Actual output file identity: libfile_2d1f87f856608191868ab68d9499bf61 / file_000000002f2c8243afc457c727fb699a.

## Current owner model direction

Bryce's 13 October instruction is to execute the simulated model and deliver a production workshare relevant to Tim/Ecosystem's existing workflow: https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791887422395359. Continue the Upper Savannah native NDR/SDR baseline/restoration/matched-control execution with actual geographic/source shapes, a 30 m grid, upstream model extent, South Carolina reporting mask, utility focus and clearly simulated realistic input fields. Preserve annual N/P kg/year and sediment tonnes/year reaching-stream units, editable parameters/source editions and export/cold reopen. Make real elapsed speed visible through choose inputs → run → inspect → revise → hand over. Keep active calculations and existing single Workspace owners running, and carry this direction into current receiving handoffs. The original source/native/model workers continue with the existing 14:00 UTC cutoff and full product/all-attachments inspection rule below.

## Owner instruction: inspect the actual outgoing product

Before calling a client/prospect-facing app, website, dashboard, demo, report,
presentation or export ready, the producing peer must actually open, run or
render the exact outgoing version, LOOK at the rendered screen or its real
screenshots, and operate the important user controls. Check the actual
screenshare width and narrow/mobile width where relevant, populated, empty,
loading and error states, downloads/exports and reopening. Capturing screenshots
without viewing them is insufficient. Fix ugly, broken, unstyled, cramped,
clipped, overflowing or unreadable output within the authorized work before
presenting it. Code review, DOM counts, HTTP 200, unit checks or another peer's
approval do not replace seeing the actual product.

ALL ATTACHMENTS count. Literally open, view, play and use the final delivered
HTML, PDF, report, slides, spreadsheet, map, image, video, audio, archive and
project as its recipient would. For archives, extract and open the actual
contained deliverables and working project. Tests, checklists and screenshots
merely captured are not substitutes. Use available high-quality generative media
models and natural voice generation/TTS for videos; avoid robotic default
voices. Watch and listen to the final export for pronunciation, pacing, timing
and audio alignment. Keep building and fixing; inspection is not review/test
performance theatre.

For the Ecosystem product use plain industrial design: readable tables, clear
hierarchy, consistent typography and spacing, restrained controls, useful labels
and responsive layouts. No decorative template slop. Keep the real workflows,
data and computation. Reviews must lead directly to repairs and must not replace
hard implementation/integration or become endless rechecking. The existing
focused-validation policy remains; do not run broad suites or build a separate
verification product. Prior empty-Workspace screenshots are not acceptance of a
completed scientific Workspace.

PERSISTENT PROPAGATION REQUIRED: copy this rule into every active owner-controlled
policy/instruction surface the provider and workers actually read: global and
project AGENTS, CLAUDE, GEMINI and rules files, provider-specific boot instructions,
Commons source mirrors, cloud repository instruction copies, and current build
and receiving guides. Every delegating peer includes this complete rule in child
assignments, including its all-attachments and final-media clarification. Return
exact changed paths, source/version and readback. A Slack ACK alone is not
propagation. Preserve all existing owner controls and do not alter historical
evidence or third-party/vendor policies. No forced restarts, new watchers or
revival of owner-stopped work.

Continue the same Ecosystem Sprint Integration assembled product and its original
scientific, run, browser and receiver owners. Continue native source, runtime and
archive joins rather than diverting everyone to cosmetic review. Preserve the
October 13, 2026 fleet cutoff at 10:00 a.m. Eastern (EDT), 14:00 UTC. This project
cutoff does not expire the standing inspection rule or change other projects'
owner-directed schedules.
