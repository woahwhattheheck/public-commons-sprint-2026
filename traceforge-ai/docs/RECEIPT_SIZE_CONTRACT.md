# Receipt size contract

TraceForge accepts up to 256,000 UTF-8 evidence bytes and 5,000 physical lines. JSON serialization can expand one accepted control byte to six ASCII bytes (`U+0001` becomes `\u0001`), so a fixed 1 MB verifier ceiling cannot cover every valid analysis packet.

The shared CLI/HTTP verifier ceiling is derived from the product's bounded inputs:

- `MAX_EVIDENCE_BYTES * 6` for worst-case JSON escaping;
- `MAX_EVIDENCE_LINES * 64` for line-object and indentation overhead;
- `MAX_MODEL_OUTPUT_BYTES * 3` for one investigator output plus a skeptic reason that may appear in both the skeptic verdict and the final verification reason;
- 256,000 fixed bytes for schema, receipt, model identity, and formatting margin.

That yields 2,496,000 bytes. `render_analysis_packet()` also measures the actual UTF-8 output before CLI write or HTTP response. Future schema growth or an unexpectedly large model identity therefore fails closed before TraceForge can emit a packet that its own verifier rejects.

The byte ceiling is a resource boundary, not an authenticity claim. Receipt verification remains an integrity check over the supplied packet and checksum.
