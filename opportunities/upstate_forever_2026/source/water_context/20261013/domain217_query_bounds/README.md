# Original217 WBD native EPSG:3857 bounds

The217-row CSV was executed from the exact retained original geometry body, decoded SHA2562300d9b32a513d70503222a5d2e782e032107297214036a58e8b444a312169af. Each envelope uses every coordinate in every original ring, without reprojection, simplification, buffer or rounding. Original HUC12 strings, objectid, globalid, tnmid, feature ordering and exact original-rings pointer are retained.

Use the envelopes as original source-side query geometry for NHD/FW capture. Keep final feature intersection against the original polygon rings: an envelope also covers space outside its polygon. Each CSV row retains original source ID, URI, vintage and compressed/decoded source hashes.

Reproduce with `python derive_domain217_bounds.py --domain EXTRACTED_ORIGINAL217 --output OWNED_OUTPUT`.

Original source remains the existing domain archive and its companions. The accompanying sources.json imports this derived query-bounds table; it does not replace original watershed geometry.
