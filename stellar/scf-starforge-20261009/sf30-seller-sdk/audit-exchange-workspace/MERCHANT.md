# Audit Exchange through the Merchant host

The audit-workspaces provider borrows an original running Audit Exchange application. Start the project through Applications or its native command, then capture its printed URL, workspaceId and instanceId.

Create an ordinary private JSON connection file:

~~~json
{
  "schema": "commons.audit-exchange.connections.v1",
  "workspaces": {
    "building": {
      "label": "Building audit review",
      "url": "http://127.0.0.1:8769/",
      "workspaceId": "ORIGINAL_WORKSPACE_ID",
      "instanceId": "ORIGINAL_INSTANCE_ID",
      "inputs": {
        "audit": {
          "path": "/absolute/original-audit.xml",
          "sha256": "ACTUAL_COMPLETE_FILE_SHA256",
          "mime": "application/xml",
          "sourceReference": "Original audit acquisition reference"
        },
        "weather": {
          "path": "/absolute/original-observed-weather.csv",
          "sha256": "ACTUAL_COMPLETE_FILE_SHA256",
          "mime": "text/csv",
          "sourceReference": "Original observed-weather acquisition URL"
        }
      }
    }
  }
}
~~~

Set auditWorkspaceConnection to that file in the native Merchant configuration, or call initializeAuditMerchantWorkspace from merchant-setup.mjs with directory and connection. The initializer uses the original shared release store and configuration lifecycle and preserves the same setup after interruption.

merchant_audit_workspaces lists aliases and retained input metadata. merchant_audit_connection inspects the live identity. After a restart, inspect the new instance and deliberately attach it with merchant_audit_reconnect; the workspace identity stays fixed.

Every original native action in catalog.mjs is available as merchant_audit_ACTION with a workspace alias. Read workspace.get first and preserve its version. Mutations carry requestId, expectedVersion, actor, note and all original action inputs. Reuse the exact envelope after an interrupted reply or recover the original result with operation.get.

For large input files, use merchant_audit_import_file with a configured input and expectedSha256. kind=source imports complete XML; kind=workspace receives a complete editable ZIP. Source imports can select the original schema and complete official profiles. The provider checks the original ordinary path, full bytes and SHA before sending them to the running application.

merchant_audit_analyse_file joins an explicitly selected source stream to the complete weather input alias. Supply actual source/weather timezones, weather units, observed interval and native model choices through modelOptions. weatherInput and expectedWeatherSha256 select the retained complete CSV; its name and original acquisition reference follow from the connection.

Use source.page, source.bytes and export.read to consume complete large source lists or file bytes. Continue every page/range until nextOffset is null. The final complete byte stream must match the original metadata hash.

An analysis is queued in the original project's durable store. The application's native worker owns its R process, original input and model checkpoints. analysis.resume continues a recoverable same-input operation; it does not change the model inputs.

Closing the borrowed provider closes its waiting clients. The original application, project, queued operation and complete deliverables remain under their original owner.
