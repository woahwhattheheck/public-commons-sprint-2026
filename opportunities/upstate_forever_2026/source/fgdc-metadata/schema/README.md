# Original FGDC CSDGM schema family

This directory retains the complete original FGDC XML Schema 1.0.0 (20030801): the root and all ten section includes. Validate the current ED6E output using the local `fgdc-std-001-1998.xsd` with `source/fgdc-metadata/receive_metadata.py --schema-directory PATH_TO_THIS_DIRECTORY`. This removes the validation host's schema download dependency. The receiver requires its existing `pyproj` and `lxml` packages.

The original DTD 3.0.2 (20020205) is retained for reference. Its projection representation differs from the XSD: the XSD permits `mapproj/mapprojp/otherprj`, while the DTD places `otherprj` directly under `mapproj`. Use the chosen schema consistently. These sources do not by themselves establish that generated metadata conforms; the existing native receiving script validates the actual written XML and exported-file identities.

`capture-manifest.json` records the original URLs, exact byte counts and SHA-256 values. All schema bodies are the complete original downloads, without reformatting. Relative include filenames are preserved.
