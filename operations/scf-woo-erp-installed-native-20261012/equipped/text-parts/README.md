# Original Woo ERP source through text-only Git readers

This directory carries the complete original installed Woo ERP archive as six
base64 text files. Each file is smaller than 1 MiB, so a Git reader that cannot
return a large binary Contents body can deliver the same source to the existing
Woo operation.

The archive remains **3,315,202 bytes**, SHA256
`992c0d8901d0fef531e7f9cfb4b7fdd928423f897f7dcd7d4c4b5eccf181001f`,
Git blob `70afac7386df552e0c91d015357f2794a3759be3`.
It contains all 319 original source files from
`b39da9bbf56ef4bdbd8d81513966ac636fed6c7a`, plus their original manifest.
The manifest SHA256 is
`450c198a644ef1acdf8762f01a446794224e98eb62cee32a1dc76e5af2ba6166`.

## Receive the same source

Retrieve `SOURCE_PARTS.json`, `join-source.py` and every
`archive.part-0001.b64` through `archive.part-0006.b64`
into one source-parts directory. Use the Git reader's UTF-8 mode and save each
complete returned body, including its final newline. `SOURCE_PARTS.json`
records each encoded file hash, decoded byte range and raw hash.

Run with the existing Python 3 runtime:

~~~sh
python3 -B /ABSOLUTE/SOURCE_PARTS/join-source.py \
  /ABSOLUTE/SOURCE_PARTS \
  /ABSOLUTE/ORIGINAL_OPERATION/installed-inputs/Woo_ERP_Installed_Operator_Source_b39da9bb_20261012.zip
~~~

The helper reconstructs the complete archive in a private temporary file,
checks its byte count, SHA256 and Git blob identity, and publishes it atomically.
An existing matching archive is reused. An interrupted join leaves the original
parts available for the same invocation.

Continue through the unchanged source receiver in the parent directory:

~~~sh
python3 -B /ABSOLUTE/EQUIPPED/receive-source.py \
  /ABSOLUTE/ORIGINAL_OPERATION/installed-inputs/Woo_ERP_Installed_Operator_Source_b39da9bb_20261012.zip \
  /ABSOLUTE/ORIGINAL_OPERATION/installed-operator-b39da9bb
~~~

The original receiver verifies all 320 ZIP members and every source file's size,
SHA256 and Git blob. Its result returns the installed merchant entrypoint and
dependency directory. Continue the existing capture, retained download, restart,
Woo restore and cold receiving phases with that directory; the complete operating
instructions remain in [the original equipped guide](../README.md).

## Exact source recovery used for this delivery

The native GitHub action `github_get_pr_diff`, with
`repo_full_name="woahwhattheheck/public-commons-sprint-2026"`,
`pr_number=1842` and `format="patch"`, returned the
original PR's complete UTF-8 Git binary patch. The returned object's
`diff` field contains the new-file literal for this exact ZIP:
`literal 3315202` and the original full Git blob identity.

The literal's standard Git85 lines were decoded and their zlib stream inflated.
The resulting archive matched the original byte count, SHA256 and Git blob.
Its complete 320-member inventory, original manifest SHA256, all 319 source file
SHA256/Git identities and 3,150,764 source bytes were then independently checked.
These parts split that exact recovered archive at aligned base64 boundaries.

For future acquisition of this original file, the same native patch action
remains a source route. Keep the whole patch body in the calling program's
retained storage and print compact metadata. A new-file Git binary literal uses
its leading line character for decoded line length, the remaining characters as
Git85, and zlib for the resulting complete byte stream. Verify the declared
original archive identity before using reconstructed bytes.
