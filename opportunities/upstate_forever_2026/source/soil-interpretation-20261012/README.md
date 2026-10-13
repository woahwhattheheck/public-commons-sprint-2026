# Original USDA erodibility interpretation metadata

This is the original successful USDA Soil Data Access response captured on 12 October 2026 at 05:45 UTC. The complete HTTP entity and receipt are retained together.

- Body: `soil-erodibility-rule-form.body`
- Bytes: **22,972**
- SHA-256: **8c66678db4e2e1ef3806db50f9c5f29cb0d809a50501717d55f55ff2cb677b18**
- Native form POST: `https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest`
- Request and native response headers/time are in the adjacent capture receipt.

The original table includes four matching attributes. The whole-soil K row is attribute **51**, `chorizon.kwfact`, Dominant Condition, Surface Layer, with nulls preserved. The separate rock-free K row is attribute **19**, `chorizon.kffact`. Native numeric and textual fields remain unchanged in this original response.

The full source adapter in `source_tools/soil_sources.py` consumes this exact metadata and requests actual native polygon/mapunit/interpretation data for the selected upstream model domain. Its prepared source is added as a distinct observed edition through the existing `upstate.sources/v1` composer.

Primary USDA description and request interface: https://sdmdataaccess.nrcs.usda.gov/documents/AdvancedQueries.html .
