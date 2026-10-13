# Authored four-type reference programme

These complete inputs were authored for this reusable adapter. They contain no buyer schema, nonprofit identity, real person, API credential or observed provider result. No Bubble endpoint was called.

## Authored record roster

Each side contains four data types: two organizations, two people, two cases and two documents. Source and destination use different native record IDs and different field names. Organization/member/case/document codes are the explicit common business keys.

The mapping also expands the two people records into three organization-membership rows. Captured parent lookups resolve every original reference within its own independent side. The twelve relationship checks (six relationships on each side) have zero orphan rows.

An absent email and an explicit null are retained in the full originals and both follow the selected nullable output policy. Document asset objects are intentionally encoded as canonical JSON text. Their example.org URLs are metadata, not downloaded files. The decimal zero remains exactly 0.00.

CASE-001 amount is 1234.50 in source and 1234.49 in the separately authored destination. That one-cent difference is intentional and must remain visible in native parity and the exact case-amount-by-organization control. This reference programme therefore must not become a passing migration by replacing expected values or changing the selected tolerance.

Source capture: authored-bubble-source-20261013, declared interval 00:00–00:03 UTC.
Destination capture: authored-bubble-expected-20261013, declared interval 00:10–00:13 UTC.
The response bodies and times are fixture inputs, explicitly marked as authored in both captures.

project.json is the whole initial mapping. reviewed-project.json includes one attributed authored-example review, its complete original request, previous mapping and capture hash. Replaying that exact request produces the same revision, and saving/opening the full project preserves its bytes. Those operations were executed through the unchanged maintained project functions.

For actual commissioning, replace both full captures and the entire reviewed mapping with the actual selected sources. Keep the original fixture as history; do not relabel it as a customer observation.
