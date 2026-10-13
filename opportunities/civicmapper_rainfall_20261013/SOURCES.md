# First-party source basis

Retrieved October 13, 2026.

- CivicMapper rainfall project: https://www.civicmapper.com/project/3rww-rainfall
  Describes provisional 15-minute gauge/radar data and later quality-controlled gauge/calibrated radar products.
- CivicMapper UpstreamPGH project: https://www.civicmapper.com/project/upstreampgh-gsi-dashboard
  Describes integration of several sensor vendors and separate technical/public dashboard audiences.
- 3 Rivers Wet Weather rainfall service: https://www.3riverswetweather.org/node/158
- Current public application source: https://github.com/3rww/rainfall/tree/1e2d70abec7f7a7ede855cbb9baea15715e03565
  Source repository declares Apache-2.0.
- README.MD, blob bd36b24e2b5a6da5610780d511f24ddb26fdbd57: current Atlas rainfall service and product categories.
- src/store/config.js, blob ad380e5d708f2c48428f1747556edba82dc1eca2: availability endpoint, sensor_columnar format, intervals, historical route selection.
- src/store/features/rainfallThunks.js, blob e2093a17ccdbd87fdcee3faf1cfc6a040d5c1388: POST fields, same-job polling, artifact refresh and inline fallback.
- src/results/engine.js, blob 9979354e865744b5397535ba8d025bb3635950e4: current row/columnar result ingestion and native end-label convention.
- src/components/sidebar/downloadTableUtils.js and src/store/utils/dateTime.js at the same pinned commit: exported time handling.
- src/store/utils/transformers.js, blob 4babc16d055494395775d475d4c18d7cb701ef19, and src/components/sidebar/geomPicker.jsx, blob c4cb0732fded825b12b47fcd345ca01878721eb6: active gauge web_id selection used by the actual request.
- Full observed availability and gauge response packet: source/20261013/publisher-selection.json. Original URLs are https://atlas.3riverswetweather.org/rainfall/v2/latest-observations/?format=json and https://atlas.3riverswetweather.org/rainfall/gauges/. The public HTTPS importer returned complete bytes but did not expose HTTP status or response headers; the packet preserves that distinction.
- Older API documentation: https://3rww.github.io/api-docs/
  Used to interpret source codes. Its planned/v1 routes are not used as the current live contract.

The actual data capture records its public endpoint, selected window/sensors, retrieval time, original raw response, and exact text hash. This source note does not substitute for a retrieved rainfall result.

The code in this directory was written for this workshare. It does not copy the existing CivicMapper or 3RWW user interface, credentials, map assets, application source, or customer data.
