# Opportunity and implementation sources

Prepared 12 October 2026. These are the original sources behind this specific 4Science workshare.

## Original commercial fit

4Science published its DSpace MCP community call on 29 September 2026. It describes a released TypeScript adapter over DSpace REST with desktop and HTTP deployment, and illustrates researcher discovery, librarian metadata work, uploads, and ordinary submissions. That current released source is the foundation of this implementation.

Source: https://4science.com/4science-community-call-develop-an-open-source-mcp-server-for-dspace/

4Science's services include repository migration, institution-specific installation/configuration, APIs and external-system integration, maintenance, and staff training. The proposed workshare applies a retained operating workflow to one of those customer implementations. Buyer demand for this specific paid engagement is a commercial hypothesis to qualify with the company.

Source: https://4science.com/services/

The company's own contact page publishes info@4science.com.

Source: https://4science.com/contact-us/

## Exact upstream code

Repository: https://github.com/4Science/dspace-mcp  
Commit: ee503ba97910f592867c897c1fa938f9e029d03c  
Tree: 6386328dd49282b98840b4dd41340b9c8a110b78

The pinned source registers 15 tools. Its original README table contains 14. The latest source includes the entity-type-checked move tool, local environment authentication, and per-user HTTP OAuth. The delivered workspace uses the original tool registration and DSpaceClient with the locked original MCP SDK.

Original source and license identities are retained in vendor/dspace-mcp/UPSTREAM.json. The AGPL license, notices, source, and upstream contribution documentation remain included.

## Native repository semantics

- DSpace item metadata retains arrays of values with language, authority, confidence, and order. Native JSON Patch defines exact add/remove/replace/move behavior.
- Standard workspace submissions follow configurable submission sections. Administrative create-item archives immediately.
- Virtual metadata derives from related entities. The current DSpace implementation may remove a relationship if its generated value is omitted from a field replacement. This workspace retains virtual values and uses the linked record for changes to generated content.
- Native bundle and file lists are HAL pages. The receiving adapter follows the complete original inventory and checks its native page totals.

Primary contracts:
https://github.com/DSpace/RestContract/blob/main/items.md  
https://github.com/DSpace/RestContract/blob/main/metadata-patch.md  
https://github.com/DSpace/RestContract/blob/main/workspaceitems.md  
https://wiki.lyrasis.org/spaces/DSDOC10x/pages/408944761/Configurable+Entities

## Public source cohort

The original Publications 2 collection UUID is dd1240ae-d7dd-405c-bdc3-d6c960609433 at https://sandbox.dspace.org/server. The retained original cohort contains 44 items over three native pages, 1,216 metadata values, and 408 author values. Of those authors, 63 are generated virtual values. The cohort also has 185 non-latest relationship links to 159 distinct related records.

The public-reader source preserves 25 original extracted HAL JSON response bodies. The provider does not expose wire status, headers, or per-request timestamps; those fields remain null. Full source provenance and original input bytes survive workspace import and export. The linked Person source for 1b19bcc0-4f83-446d-95b7-ec0c806d1578 demonstrates the native relationship behind one generated author.

The exact native wire/file acquisition and the own-record test journey retain their own response and runtime metadata. The official DSpace demo page and current testing guide authorize testing on the published demonstration accounts and submission collections.

https://dspace.org/demo/  
https://wiki.lyrasis.org/spaces/DSPACE/pages/425331100/Try+out+DSpace+10

## Price basis

The $6,400 offer is a fixed implementation proposal based on the complete configured cohort, two correction cycles, original native operating paths, staff receiving, and included defect support. It is not inferred from a public procurement budget or an announced 4Science contract value.
