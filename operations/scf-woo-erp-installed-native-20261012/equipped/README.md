# Original Woo ERP installed-source receiving

This source input joins the original BC08 Woo ERP operating project to the complete
merchant-agent capture and customer receiving implemented in merged
[PR1721](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/1721).

The retained source is commit `b39da9bbf56ef4bdbd8d81513966ac636fed6c7a`. The archive contains
319 unchanged original files (3,150,764 source bytes), their complete SHA256/Git
manifest, the configured Woo provider, all23 ERP tools, installed command, complete
file receiver, retained download/restart implementation, release-store initialization,
all current distribution contributions and the original assets loaded during import.
It includes the original Woo PHP/client sources used by these interfaces.

## Receive on the original native host

Supply these three files through the original project's existing file receiver:

| File | Identity |
| --- | --- |
| Woo_ERP_Installed_Operator_Source_b39da9bb_20261012.zip | 3315202 bytes; SHA256 `992c0d8901d0fef531e7f9cfb4b7fdd928423f897f7dcd7d4c4b5eccf181001f`; Git blob `70afac7386df552e0c91d015357f2794a3759be3` |
| receive-source.py | Original source receiving helper; identity in SOURCE_DELIVERY.json. |
| SOURCE_DELIVERY.json | Original source, archive, receiver and companion identities. |

The same equipped Git input reader may retrieve the ZIP by its Git blob. That
reader decodes the provider's base64 blob response as bytes. The original source
receiver checks the full archive, exact320-member inventory, manifest, every
source byte count, SHA256 and Git blob before completing the retained directory.

~~~sh
python3 -B receive-source.py \
  Woo_ERP_Installed_Operator_Source_b39da9bb_20261012.zip \
  /ABSOLUTE/ORIGINAL_PROJECT/installed-operator-b39da9bb
~~~

Select a fresh private directory or reopen that same retained source directory.
The receiver writes the complete source tree under the selected directory.
It publishes files atomically under one local source lease and preserves an
interrupted transfer's completed files. A repeat invocation verifies and reopens
the exact same source. The receiving result returns the original entrypoint and
dependency directory.

Declare this retained directory as the installed operator source in the same
original native operation's source/admission selection. Keep the original Woo
store, database, ERP receiver, browser runtime and operation owner selected.

## Original runtime dependency

Use the original selected Node22.16+ runtime and its existing npm executable.
The captured payment-auto-catalog package and lock retain `re2js@2.8.6`, including
the original npm integrity value. If that dependency is not already installed at
its original source location, run the following inside the same admitted native
operation, with its private npm cache:

~~~sh
cd /ABSOLUTE/ORIGINAL_PROJECT/installed-operator-b39da9bb/stellar-forge/payment-auto-catalog
npm ci --ignore-scripts --no-audit --no-fund --cache /ABSOLUTE/PRIVATE_NPM_CACHE
~~~

The runtime module resolves the dependency from this exact package directory.
The original caller remains responsible for its selected Node/npm paths and
managed runtime declaration.

## Join the complete original ERP journey

The original owner first completes its existing delivery, both order corrections
and browser/CLI cold receiving. It then runs the preserved installed companion
against that operation's original private journey configuration:

~~~sh
node /ABSOLUTE/ORIGINAL_PROJECT/installed-operator-b39da9bb/operations/scf-woo-erp-installed-native-20261012/operate.mjs \
  ORIGINAL_PRIVATE_JOURNEY_JSON capture b39da9bbf56ef4bdbd8d81513966ac636fed6c7a
~~~

Using the same original `NativeWooRuntime`, retain the complete operating SQL,
take a Woo-only snapshot and restore that snapshot. Run the original companion's
receiving phase:

~~~sh
node /ABSOLUTE/ORIGINAL_PROJECT/installed-operator-b39da9bb/operations/scf-woo-erp-installed-native-20261012/operate.mjs \
  ORIGINAL_PRIVATE_JOURNEY_JSON receive b39da9bbf56ef4bdbd8d81513966ac636fed6c7a
~~~

The exact Python hook is in the original [operation guide](../README.md).
Its installed-erp output retains both complete project/mapping files, interrupted
download checkpoints, byte-resumed files after MCP restart, cold imported native
journals and final receiving outcome. The same original ERP receiver supplies
document and PUT counts. The owner's complete operating archive retains this
output together with the original database snapshots and source.

The original operation remains the execution and receiving owner. Its actual
native result belongs in that operation's existing Acro/SCF thread and complete
operating project.
