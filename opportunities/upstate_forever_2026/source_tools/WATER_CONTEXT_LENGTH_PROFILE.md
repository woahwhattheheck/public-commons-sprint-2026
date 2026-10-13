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
