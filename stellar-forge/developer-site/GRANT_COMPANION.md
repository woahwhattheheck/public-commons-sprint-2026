# Read the complete product and financing companion

The existing application now opens **Product and financing** at
/grant-companion.html. The reader consumes the same complete
grant-data/product-and-finance.md and grant-data/source-index.json
already selected by the maintained application. It gives the cumulative
customer installations, six-package allocation and financing explanation a
readable chapter interface.

## Read, find and retain the source

Choose a chapter from the index. Previous and Next move through that same
selection. Search looks through the full companion, including tables and code
blocks, and shows the matching chapters with short excerpts. Search terms are
combined: every entered word must occur in a matching chapter. Clear returns
to the complete index. Read all chapters opens the complete text or all current
search matches.

A chapter or subsection link opens its containing chapter. Following a link to
a chapter outside the current search clears that filter, keeping the requested
source visible. The original Markdown headings supply stable anchors; repeated
headings receive distinct anchors in source order.

Print chapter prints the visible selection. Print complete companion includes
every chapter even when a search or selected chapter is active. Long tables
scroll within the page and print with wrapping cells and repeated column
headers. Code blocks retain their original content. The interface uses neutral
colors and adapts to narrow displays.

Download Markdown and Source index save the original complete files, retaining
their source text and line endings. Save offline reader creates one HTML file
with all rendered chapters, the full stylesheet, the same navigation/search
controls, and both original source files for later download. Open that file
directly in a browser. Reading and searching the saved document require no
network request; explicit links to external sources or the original application
open their recorded destinations.

## Continue the original source publication

The original grant-compose command attaches the companion link and a
companion_reader descriptor to its current source index. The descriptor binds
the reader to the same complete companion SHA-256 and byte count. It refreshes
when the canonical manuscript owner composes a later edition.

The original four-file sourcePins contract is preserved:

- /grant.html
- /grant-data/application.md
- /grant-data/product-and-finance.md
- /grant-data/source-index.json

The browser manifest adds the four companion assets. They travel with the
complete developer-site component, its existing server, and the original
grant-reviewer package:

| File | Use |
| --- | --- |
| dist/grant-companion.html | Original reader entry and source-download fallback. |
| dist/grant-companion.css | Responsive chapter, table, navigation and print presentation. |
| dist/grant-companion-core.mjs | Shared complete Markdown renderer, chapter interface and offline export. |
| dist/grant-companion-workspace.mjs | Original source loading, exact edition selection and download actions. |
| grant-companion.mjs | Existing application navigation and source-index integration. |

The browser reads the source index and companion together and compares the
selected byte count and SHA-256. A concurrent publication refreshes that pair
once. If the publisher is still replacing the edition, Reload companion opens
the completed publication; the original download links remain available.

Receive all four assets alongside the current four reader files through the
existing publisher and audience. The current manuscript and submission
drafts stay with their original owners. This reader uses no additional source
manuscript, draft store, dependency installation or application service.
