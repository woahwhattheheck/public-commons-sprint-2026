# Original Woo ERP merchant-agent receiving

This continuation receives the two original Woo ERP projects from
BC08-WOO-ERP-RECEIVING-20261012-02 through the maintained merchant MCP, installed
command and complete file receiver. It uses the original WordPress/Woo store,
application-password client, selected Acumatica contract, native ERP documents and
owned line identities.

The original engine is [PR1593](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/1593),
author head5441e721d2e9810591fa8a1cef82d667734d5576. Its full operating flow delivers
the original order, resolves the lost response, corrects the same source lines,
receives the tax correction and performs the browser/CLI cold project reopen.
The installed operator is [PR1721](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/1721).
[WOO_ERP.md](../../stellar-forge/mcp-merchant-operator/WOO_ERP.md) contains the
complete customer workflow.

## Attach to the original native operation

The original owner keeps the installed store, database, receiver, source
selection and foreground admission. Select the complete published source edition
containing this companion, its distribution registrations and current merchant
provider/catalog modules. Reuse the original Node22+ runtime, Linux flock and
source dependencies, including the existing re2js module.

The driver takes the original private journey configuration already created by
native-erp/run_operation.py. It reads that configuration's original credential
file and environment names within the operating process. It obtains the two
original operation IDs from phase-delivery-result.json and requires the completed
phase-reopen-result.json.

Run the capture phase after the original browser/CLI reopen, while the existing
store and ERP receiver are still running:

~~~sh
node operations/scf-woo-erp-installed-native-20261012/operate.mjs \
  ORIGINAL_PRIVATE_JOURNEY_JSON capture PINNED_OPERATOR_COMMIT
~~~

The native owner then uses its existing runtime snapshot and restore API to
retain the complete delivered state and restore the same Woo-only source for
receiving. Run the receive phase on those restored original orders:

~~~sh
node operations/scf-woo-erp-installed-native-20261012/operate.mjs \
  ORIGINAL_PRIVATE_JOURNEY_JSON receive PINNED_OPERATOR_COMMIT
~~~

The original runtime's existing Python integration can compose these phases after
run_phase(runtime, journey_path, "reopen"):

~~~python
def merchant_agent_phase(phase):
    child = runtime._spawn(
        [NODE, str(OPERATOR_SOURCE / "operations/scf-woo-erp-installed-native-20261012/operate.mjs"),
         str(journey_path), phase, OPERATOR_COMMIT],
        "erp-merchant-agent-" + phase,
    )
    code = child.wait()
    if code:
        raise RuntimeError("Original ERP merchant-agent " + phase + " exited " + str(code))

merchant_agent_phase("capture")
runtime.snapshot(PRIVATE / "output/agent-capture-full-operating-state.sql", include_erp=True)
cold = runtime.snapshot(PRIVATE / "output/agent-woo-only-receiving.sql")
runtime.restore(cold["path"])
merchant_agent_phase("receive")
runtime.snapshot(PRIVATE / "output/agent-reopened-full-operating-state.sql", include_erp=True)
~~~

OPERATOR_SOURCE and OPERATOR_COMMIT are the original owner's selected complete
source and immutable commit. Include that source in the same native operation's
maintained source/admission selection before using the hook.

## Complete native receiving

Capture initializes the original Woo merchant host and opens its real MCP HTTP
server. The installed distribution resolves the ERP contribution and forwards
merchant-woo-erp orders through the actual client. The same configured provider
advertises all23 ERP tools.

For each original order, the driver reads the current native journal and its
paged source editions, retains the complete original project and mapping, and
downloads both files with their exact manifests. The first project deliberately
interrupts after a checkpointed prefix. The MCP closes and reopens on its original
listener; the retained downloader resumes that same file and verifies every byte.
The installed inspect-local command and private source handle reopen the original
project digest.

Receiving imports those complete downloaded projects into the restored original
Woo store. It selects each original mapping using the current selection guard,
binds the actual Woo source through the native contract check, and reconciles the
existing ERP document. It then exports and receives the new complete journal.

The original target document keys, owned native line crosswalks, source digests,
source edition IDs and request history must remain identical. Native import
history must retain the exact downloaded project digest. The original ERP receiver
must report the same PUT count and document count. A final MCP restart reads the
same received journal revisions.

This is a continuation of the author's full published-contract development
receiver operation. Its outcome records the original receiver kind.

## Retained result and continuation

The original output directory receives installed-erp/:

| Path | Contents |
| --- | --- |
| owner.json | Original journey, source, store and operation identities. |
| installed-registration.json | The installed contribution resolved by the maintained CLI. |
| capture.json | Both complete project/mapping manifests and original source/target identities. |
| received/ | Full original projects and mappings, manifests and retained download checkpoints. |
| reopened/ | Complete native projects after import, binding and receiving. |
| journey-capture.json / journey-receive.json | Actual native operation events and returned identifiers. |
| native-outcome.json | Completed receiving, original project digests, restart and ERP write counts. |
| failure-capture.json / failure-receive.json | An original runtime failure and the events already completed. |

The merchant host configuration stays under the original private runtime's
installed-erp-host directory. Its source files contain environment references.
The original complete output archive therefore carries the customer artifacts and
receiving records through the author's existing retention step.

A completed capture reopens its same retained files. Native repeated project
imports reuse their original import digest. A receive continuation reads the
current journal and only performs the still-needed native bind/reconcile steps.
The actual exported completion manifest, complete project bytes and original Woo
database remain the receiving unit.
