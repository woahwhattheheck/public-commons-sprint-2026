# Configure, install and retain the original deployment

## 1. Select the existing workspace and network path

Use the complete original PMRS service with its original businesscentral/contract, web and native source closure. Start/reopen it through its existing launcher and retain its actual private entry file. The entry schema is commons.pmrs-local-entry.v1 and contains its actual loopback URL, token and workspace_id. The caller reloads this entry for every local request, so an ordinary native restart can replace its bearer token without changing the selected workspace.

Select an explicit private IPv4 interface and an institution-managed TLS certificate whose hostname is reachable from the existing Windows on-premises gateway. The gateway machine must trust the issuing CA and resolve that hostname to this listener. Keep the original PMRS service bound to loopback. Allow only the existing gateway/native receiving machines to reach the caller's private listener through the institution's normal network controls.

The caller uses Basic authentication over TLS because Microsoft supports that combination through an on-premises custom connector; API-key authentication is excluded for that gateway. These credentials are separate from Business Central, Dataverse and the native operator bearer tokens.

Run as the existing native workspace owner. Keep private configuration outside published source and outside handover archives:

    python3 -B pmrs_cloud_deploy.py configure \
      --operator-entry /ABSOLUTE/PRIVATE/original-entry.json \
      --listen ACTUAL_PRIVATE_IPV4 --port 9443 \
      --public-host ACTUAL_CERTIFICATE_HOST:9443 \
      --certificate /ABSOLUTE/PRIVATE/server-chain.pem \
      --private-key /ABSOLUTE/PRIVATE/server-key.pem \
      --output /ABSOLUTE/PRIVATE/caller-configuration

This validates the actual native workspace and creates caller.json plus connection-credentials.json in one staged directory. Both files are owner-only. The credential file contains one newly generated credential for each capture/prepare/delivery role. Move the credentials into the institution's normal secret custody and create those exact gateway connections. Never put the credential file in Slack, public Git, a customer source ZIP or a flow definition.

The configuration command creates a new directory and preserves existing directories. On restart, reuse the saved caller.json:

    python3 -B pmrs_cloud_gateway.py \
      --config /ABSOLUTE/PRIVATE/caller-configuration/caller.json

Register this command with the same existing host supervisor that owns the native service. Start the native service first. Retain its exact executable, working directory, operating account and configuration paths in that supervisor's normal service definition. The caller checks the live native workspace before opening its listener. TLS handshakes occur in bounded worker threads; one idle handshake cannot block the listener. Shutdown closes the listener and drains the current handlers.

The public_host must match the actual connector hostname, including its nondefault port. A trusted institutional certificate is required; the caller does not disable certificate verification or generate a self-signed production certificate.

## 2. Prepare and create the connector

    python3 -B pmrs_cloud_deploy.py connector \
      --public-host ACTUAL_CERTIFICATE_HOST:9443 \
      --output /ABSOLUTE/PRIVATE/prepared-connector

Use the tenant's existing paconn installation and account:

    paconn login
    paconn validate --api-def /ABSOLUTE/PRIVATE/prepared-connector/apiDefinition.swagger.json
    paconn create -e ACTUAL_ENVIRONMENT_ID \
      --api-prop /ABSOLUTE/PRIVATE/prepared-connector/apiProperties.json \
      --api-def /ABSOLUTE/PRIVATE/prepared-connector/apiDefinition.swagger.json

Retain the connector ID/API name returned by the actual create. The definition is Swagger 2.0, under the 1 MB definition limit. API responses and requests are bounded to 2 MiB, below Microsoft's documented 3,182,218-byte on-premises connector request limit. Full larger finance archives remain on the original operator's download route.

Create three connections in the selected environment using this same connector and existing on-premises gateway. Use the matching capture, prepare and delivery credentials. Grant connection usage only to the selected original flow operators. The gateway applies the write-kind permissions as well as Basic authentication; a capture credential cannot deliver.

In the original unmanaged solution, create/select each actual connection reference and bind it to its corresponding existing connection. Retain the exact connection_id and connection_reference_logical_name. The installer reads those references and verifies that they point to the selected connector/API and connection; it never creates or copies credentials.

For a later connector update, first use paconn download to retain its actual deployed definition and original connector ID. Use paconn update for that same connector. Do not call create repeatedly to recover an uncertain create. Reconcile the original connector's actual result first.

## 3. Freeze the three flow identities

Copy bindings.example.json to a private working file and fill every field with the actual selections. environment_id supports the normal GUID and Default-GUID forms. organization_url is the actual HTTPS Dataverse origin from Developer resources, without /api/data. Select the existing unmanaged solution unique name, not its display label.

public_host and workspace_id must match caller.json. The generated flows read ReadHealth and verify this exact workspace, then bind the same expected workspace_id into the actual submit body. The caller checks that identity before native dispatch, including after a service restart between the health read and submit. Use the actual connector API name and all three existing connection references.

    python3 -B pmrs_cloud_deploy.py prepare \
      --bindings /ABSOLUTE/PRIVATE/actual-bindings.json \
      --output /ABSOLUTE/PRIVATE/original-flow-deployment

The prepared directory contains three complete workflow payloads and deployment.json with their byte counts, hashes and generated UUIDs. This is the original installation identity. Keep this directory unchanged and reuse it on every restart. Preparation does not contact Dataverse and does not activate a flow.

Review the complete generated clientdata, especially the actual connection references and workspace identity. Each manual flow accepts command_json as a text string and an explicit resume_interrupted boolean. The entire command JSON travels as a string; only its small returned status/ID fields drive polling.

## 4. Install through the supported Dataverse API

Obtain an access token for the selected organization through the tenant's existing approved authentication method, and put it in the process environment variable PMRS_DATAVERSE_ACCESS_TOKEN. The installer does not store or print this token. Use an authorized solution/flow owner identity.

    python3 -B pmrs_cloud_deploy.py install \
      --deployment /ABSOLUTE/PRIVATE/original-flow-deployment

The installer verifies the existing solution and all three connection references, reads each saved workflow UUID, creates only an absent original workflow, and verifies its full definition and solution membership. Create uses the saved primary key and MSCRM.SolutionUniqueName. A lost response cannot generate a second workflow. Original request/response identities and complete response bodies are retained in installation.json and provider-responses/.

The provider creates these flows Off. Inspect them in the solution and run the actual receiving course before activation. After that original commissioning decision:

    python3 -B pmrs_cloud_deploy.py install \
      --deployment /ABSOLUTE/PRIVATE/original-flow-deployment --activate

Activation re-reads the original full definition and uses its current ETag. Existing active flows are preserved. A suspended flow, changed definition, different connection, managed replacement or different solution is surfaced with its retained source; the installer does not overwrite it.

No api.flow.microsoft.com management endpoint is used. Microsoft documents Dataverse workflows/clientdata as the supported route for solution-aware cloud-flow management.

## Restart, quota and rollback

Re-run install with the same deployment directory and refreshed current access token. It starts by reading the retained workflow IDs. Every provider attempt is recorded before dispatch; every complete provider response is saved before advancement. Actual Retry-After becomes a persisted not_before time, shared across the deployment. An unparsed provider retry instruction remains visible for the original operator to resolve.

Never erase deployment.json or regenerate IDs to clear a refusal. A conflicting existing workflow stays intact. For a deliberately changed flow edition, retain the installed full clientdata and the new complete source, and let the original solution owner apply that reviewed solution change. This installer is create/readback/activation, not an unreviewed definition overwriter.

To roll back runtime availability, turn Off these same three flows in the original solution and stop this caller through its existing host supervisor. The original service, workspace, source records, delivery journals and exports remain available. Restore the retained connector/flow edition using the original solution's established deployment/rollback path. Do not delete the finance workspace or create replacement delivery IDs.
