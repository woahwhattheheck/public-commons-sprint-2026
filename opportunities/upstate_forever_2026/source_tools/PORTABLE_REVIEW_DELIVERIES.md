# Saved map reviews in scientific Workspace transfers

A working delivery archive can omit ordinary delivery directories to avoid
recursively embedding older ZIPs. Saved map reviews still need their original
delivery-owned raster layers.

The portable writer now follows those saved references automatically when
`include_deliveries=False`. It reads original review bindings and typed atlas
origins, checks the exact delivery ID, file role, byte count and SHA256, and
captures the corresponding received snapshot. The original atlas index,
map/source-context companions, native layers, selection and receiving-water
metadata travel with that snapshot. Nested archive files remain separate.

Prior snapshots are stored at their ordinary
`workspace/deliveries/<original-id>/` paths. Each retains its original artifact
descriptors and a `received_snapshot` state. They retain their original layer
identities and remain available for read-only inspection.

The currently selected delivery uses its existing `delivery/` archive section.
After the verified files are registered at their original Workspace paths, the
receiver adds in-memory aliases for those exact verified bytes before validating
saved spatial reviews and exports. The archive manifest and its member inventory
remain unchanged.

The existing Workspace backup and restore commands perform this capture and
receiving work. Continue with the matching application source carried in the
archive, then reopen the saved review or atlas review collection. Existing review
history and export IDs continue to reference the same original native layers.
