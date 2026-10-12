# Source and license

This module combines the original 4Science `dspace-mcp` implementation with an operator workspace by TokenJunkie Labs.

The original implementation is pinned to commit `ee503ba97910f592867c897c1fa938f9e029d03c` and tree `6386328dd49282b98840b4dd41340b9c8a110b78`. Every upstream source file is listed with its original Git blob identity in `UPSTREAM.json`. The original copyright, AGPL license, contributor notices, package lock, and source are included under `vendor/dspace-mcp/`.

The complete workspace module is provided under AGPL-3.0-only. The license text is `vendor/dspace-mcp/LICENSE`. This notice applies to this directory, not to other projects in the containing repository. Preserve upstream notices and provide the corresponding source when distributing or offering a modified version over a network, as required by that license.

The vendor source is unchanged. `scripts/build-upstream.mjs` verifies original Git blob identities and uses Node's TypeScript transformation to create the runnable original modules. `bridge.mjs` registers the original tools with the original DSpaceClient and the locked MCP SDK. Its instance-level HAL inventory helper follows every native bundle, bitstream, and draft page; the upstream upload's bundle lookup uses that same complete helper. The wrapper retains responses, supplies execution recovery, and checks operator plans.

Public DSpace demonstration content remains attributed to its original repository and source records. Captured JSON is provided with source provenance. Institutions control rights and access for their own repository content. The commercial service is configuration, integration, receiving, and handover of this open-source workflow.

