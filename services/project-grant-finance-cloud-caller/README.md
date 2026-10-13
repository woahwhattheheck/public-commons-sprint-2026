# PMRS original finance cloud caller

This complete add-on connects Power Automate to the existing local project/grant finance service through an institution-managed on-premises data gateway. It provides a private HTTPS caller, a Basic-auth custom connector, three solution-aware manual flows, a restartable Dataverse installer, and a native receiving client.

The original finance service remains the source of commands, captured Business Central data, mappings, reconciliation, reviewed Dataverse requests, conditional writes, delivery ownership and handover archives. The caller carries complete original command JSON as text so Power Automate does not round a decimal or rewrite a native identifier. It returns exact original response text and its SHA-256 alongside small routing fields.

## Complete path

1. Keep the original PMRS local service and its private entry file running under its existing workspace owner.
2. Configure this caller for the exact entry/workspace, institution TLS certificate and explicitly selected private IPv4 listener.
3. Create this custom connector with the exact private TLS hostname. Use the existing on-premises gateway and separate capture, preparation and delivery credentials.
4. Bind the three actual gateway connections through existing solution connection references. Prepare all three workflows once; the generated workflow IDs remain fixed across installation and restart.
5. Install into the original unmanaged solution, inspect the received flow definitions, and commission through the same native programme. Activate those same definitions explicitly.
6. Run original commands, poll their original IDs, retain full native results and reopen the existing finance workspace. Use the original operator for full archives, target review and explicit uncertain-write acceptance.

Read [DEPLOYMENT.md](DEPLOYMENT.md), [OPERATIONS.md](OPERATIONS.md) and [RECEIVING.md](RECEIVING.md) for complete commands and recovery. [sources.json](sources.json) identifies the exact original native source and primary Microsoft contracts used here.

## Contents

| File | Purpose |
| --- | --- |
| pmrs_cloud_gateway.py | Private HTTPS caller; original-ID admission, complete status, provider retry history and exact decimal digest |
| pmrs_cloud_deploy.py | Private configuration, connector preparation, flow binding, original workflow create/readback and conditional activation |
| pmrs_cloud_client.py | Actual HTTPS receiving; retained original command, full caller/native responses and repeatable status polling |
| connector/apiDefinition.swagger.json | Swagger 2.0 operation and complete response contract |
| connector/apiProperties.json | Basic credentials and existing on-premises gateway selection |
| flows/*.clientdata.json | Capture, prepare/review, and delivery/recovery manual flow definitions |
| bindings.example.json | Required actual tenant/workspace/connection selections; contains no credentials |
| native-contract.json | Exact original command/route/status semantics |
| sources.json | Original source and authoritative documentation |

Python 3.11 or later and its standard library are sufficient for the caller, installer and receiving client. The original service has its own complete 29-file native plus 21-file AL/browser source closure; this add-on does not replace that application. The Windows on-premises gateway must be able to reach the private HTTPS caller; it can run on a separate existing host.

The three flows are independent manual operations, not an automatic approval chain. A successful wrapper command can still return delivery_state=AWAITING_OPERATOR. The flow retains that actual state; an operator makes the next original recovery/review decision. No new command or delivery UUID is generated on a network retry.

## Delivery status

Source composition and independent contract review precede actual installed commissioning. The original receiving owner runs the complete TLS/connector/flow and native browser course in RECEIVING.md on the exact selected source. Record the actual tenant result and viewed desktop/mobile screens before presenting a customer-ready deployment. Generic source includes no customer finance rows, tenant secrets or commercial correspondence.

Code license: MIT, under the repository's LICENSE. Deployment and financial meaning remain selected by the original institution/prime and finance owner.
