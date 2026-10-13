# Original 197-point watershed observation source

This is the unchanged complete218-file source edition used by the existing
Upper Savannah observation and nine-study workflows. It retains197 point
identities,196 distinct official WBD queries, original agency/NLDI coordinate
variants, full response bodies, original source tables and the maintained
rebuild program. All prior184 interpreted rows remain unchanged.

Original source:
https://chatgpt.com/space/page_9fed900fa5108191b4d091fe16c4d824

| Body | Bytes | SHA-256 |
| --- | ---: | --- |
| Complete source JSON | 4024164 | eea01345486cd017db9fdc175e1f192ae709571674d3d02bff0aef47ef98569b |
| Original gzip | 337415 | 50e6bb4197d83bfc171992233af5e614d80870f6aef4a030379ea5df75409561 |

All218 member bodies, totaling3628455 UTF-8 bytes, were independently
checked against their original declared sizes and hashes.

## Receive with the existing native connection

Use the unchanged receive.py in this small source branch. It contains the
same official HostedAppsClient already used by the existing report/map
receiving operations and preserves normal session authentication and metadata.

```sh
python -B receive.py \
 --blob f0bfa4c7bde92712e8b6249ff1ab66f8175b63da \
 --source-sha256 eea01345486cd017db9fdc175e1f192ae709571674d3d02bff0aef47ef98569b \
 --source-bytes 4024164 --files 218 \
 --output ACTUAL_FRESH_RECEIVING_DIRECTORY
```

The receiver's members/ directory is the prepared application source root.
It contains the complete original observations/wbd_station_join_20261013/
directory. Retain that directory within the existing complete application,
preserving any differing file for explicit source-author composition.
Continue the maintained model/observed_station_studies.py workflow and
the existing nine-study build/receive operation on the restored original
b9d5d257-c6bb-4f07-b975-8e8c63705db3 Workspace.

The actual9BCB operation9399 uses:
application /mnt/data/eco-9bcb/restored/application
workspace /mnt/data/eco-9bcb/restored/workspace
Python /opt/pyvenv/bin/python3.13
The separate original calibration companion repair joins the same operation.

The unchanged direct shell bootstrap is also retained in the existing Canvas:
https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C9MSXEYLQ

## Original source replay

```sh
node observations/wbd_station_join_20261013/rebuild.mjs --check
```

Carry the maintained owner direction2026-10-13.3:
https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/e7325cdf95becf30d7507bbf6b4c230193bbb897/opportunities/upstate_forever_2026/CURRENT_OWNER_DIRECTION.md

Continue accepted scientific execution, operate and LOOK at the actual
outgoing product and attachments, and preserve the October13 14:00UTC cutoff.
