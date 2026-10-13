# Connected offline operations

This host directory carries the complete reusable print-production application and its ZIP, digest and lossless payload helpers. Customer project records remain separate inputs to the application; generic source publication does not publish customer records.

## Start a complete project

Supply the complete print-production project JSON and run:

```sh
node host/print_production_workbench_cli.mjs inspect --record /absolute/path/Working_Record.json
node host/print_production_workbench_cli.mjs build --record /absolute/path/Working_Record.json --out /absolute/path/new-delivery
```

The new directory contains the complete offline application, operating guide, editable record, eighteen record exports, all eleven source files, a member manifest and the whole ZIP. The original application provides the same save/open and complete-project download path.

The UI guide covers the full quotation, goods, artwork, spoilage, rework and dispatch workflow. The engine guide describes exact source-bound pricing and action semantics. Existing approved quotes retain their original source edition and customer snapshot. Production records preserve original entries and append reasoned corrections.

## Publication and delivery

Generic engineering work belongs in this verified-public repository. Prospect and customer records remain on their original private delivery surfaces. Preserve previous source and case identities. Do not create private repositories, change repository visibility, add or enable GitHub Actions, or introduce a parallel sender or shared controller.

Before presenting an outgoing application or attachment as ready, follow the current root AGENTS.md and docs/policies/rendered-product-inspection-policy.md: open the exact outgoing product, inspect the actual rendered desktop and applicable narrow layouts, operate its material controls, inspect the downloadable files in their normal viewers, and reopen complete exports. View captured screenshots; source/DOM checks do not replace seeing the result. Fix concrete defects in the original product and continue delivery. Preserve the original receiving operation and retain exact artifact versions. This guide is the application-level propagation of the existing owner direction, not a separate review process.

## Dependencies

All runtime dependencies needed for offline operation are included. No npm install or hosted service is required. connected_gzip.cjs retains the upstream pako notice and source attribution; connected_sha256.cjs retains its embedded SHA-256 attribution. connected_inline_payload.mjs restores full original application data and source without deleting large inputs. Its compact bootstrap is optional.
