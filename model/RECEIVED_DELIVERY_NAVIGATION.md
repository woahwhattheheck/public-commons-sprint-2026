# Reopen a scientific delivery with its working navigation

The ordinary scientific Workspace receive operation restores the original report,
maps, source files and operator record. It now also builds a received map navigator
from those verified files, before the receiving directory is published.

Open the received Workspace in the existing operator, select the retained delivery,
and choose **Open map atlas**. The report, atlas filters, original file links and
enclosing working archive remain available through the delivery inspection desk.
The receive response also exposes `delivery.files.map_atlas_received_browser`,
`delivery.files.received_delivery_inventory` and
`delivery.files.working_archive` as complete paths and descriptors.

## Original capture and received navigation

The current complete delivery captures its scientific working archive after both
report sets, the final HTML atlas and the delivery manifest have been produced.
Earlier captured editions can predate that final navigation. The receiver handles
each original edition using the complete file inventory actually captured in that
archive, after the same opened archive has been verified and retained as the
working archive.

The new files are under `received-navigation-<original archive SHA256>/` within
the registered Workspace delivery:

- `inventory.json` records the original delivery and selection, complete captured
  file descriptors, the original enclosing archive, map paths and receiving scope.
- `atlas-browser.html` lists those original files and their real lengths and
  SHA256 values. Its inventory link targets that received inventory.

The HTML uses the maintained atlas renderer, including the original map families,
source context, selected alternatives, filter controls and relative PDF links.
Its exact inventory is used by the same delivery inspection routes.

Any HTML atlas that was already present in the captured edition keeps its original
bytes and `map_atlas_browser` descriptor. The added `map_atlas_received_browser`
role selects the new received navigator. If a previous received navigator or
inventory was itself captured, its bytes remain under a SHA256-specific captured
role. Original reports, source records and native results remain the captured editions.

The received inventory describes original inputs and the enclosing archive.
The navigator is derived afterward and recorded in the operator delivery state,
so neither the archive nor the inventory must contain its own hash. Publication
uses the existing receive staging directory and final rename.

Deliveries without an original atlas or scientific report retain their existing
receive behavior. The current outer delivery package and its working snapshot both retain their
original report sets, publication manifest and final atlas.
