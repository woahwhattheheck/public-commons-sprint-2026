# NHD queries for the original 217-HUC domain

The maintained `resume_nhd_originals.py` receiver automatically uses the optional
`domain_query_bounds` descriptor in original source-bank revision 13 and later.
It verifies the full five-file bounds source bank, the original domain ZIP,
the retained gzip member and its decoded Esri response before deriving queries.

## Operation

Run the existing receiver with the complete decoded source bank, its published
SHA-256, the original domain archive and a new owned output directory. Existing
retained count/ID scopes and original geometry bodies are reused. Both the
original full-grid mode for older banks and explicit `--huc-bounds` selection
remain available. An explicit HUC inventory takes precedence over the optional
bank-provided reduced-grid plan.

The reduced plan intersects every original HUC envelope with each cell of the
existing four-by-four grid. Each nonempty cell gets one conservative enclosing
rectangle. Three cells contain no source envelope and need no query. Original
polygon rings still determine final feature membership.

The original bounds CSV and historical plan use the source author's float
conversion. They remain unchanged and are verified against that conversion.
The effective query plan uses original Decimal extrema, preserving the interior
grid boundaries and expanding outer edges where the original summary rounded
inward. Its coordinates are serialized as exact JSON before the maintained
source reader sends them to the publisher.

The actual original source has 217 polygons and 273,049 vertices. The historical
16-cell plan has 13 occupied cells. Its most reduced occupied cell is
`tile-4-3`, approximately 19.39% of its original query area. The reduced plan
changes acquisition area while preserving the complete original polygon domain.

## Inspect a plan before acquisition

From the application root:

```sh
python -m source_tools.nhd_domain_queries \
  --inventory RETAINED/inventory-progress.json \
  --retained RETAINED \
  --domain-archive ORIGINAL_DOMAIN.zip \
  --output OWNED/exact-query-plan.json
```

The command verifies the original source identities and writes the exact
effective envelopes, HUC membership, empty-cell list and source provenance.
It makes no network requests. The receiving operation retains this same
computed plan in `domain-query-bounds/exact-query-plan.json` alongside all
original bounds files and the unchanged historical query plan.

## Continued acquisition and receiving

The original bank's immutable `coverage_grid` remains intact. Completed broad
and subdivided count/ID requests are checked against their original request
bodies, and their union can satisfy a reduced query scope. The receiver queries
only unsatisfied scopes through the maintained source reader, which preserves
adaptive subdivision, original count/ID reconciliation and resumable geometry
receiving. Existing geometry IDs are retained in the candidate union.

The source operation ends with the existing original-ring selection, native
source-edition assembly, optional workspace binding and optional WaterContext
assessment. Reports and saved workspaces retain both historical and effective
query provenance.
