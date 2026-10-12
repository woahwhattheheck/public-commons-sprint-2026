# Agent service-health operations

The merchant MCP server now exposes the original gRPC workspace's complete standard-health workflow: saved-source Check/List, retained Watch, complete native event/service paging, original stop/resume and immutable receiving.

[The complete operator and CLI guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/grpc/HEALTH.md) covers the saved source, exact protocol, native health semantics, connection lifecycle, commands, all six tools and portable receiving.

Use the existing configured grpcWorkspaces host handle. merchant_grpc_health_start takes workspace, revision, operationId and the closed request. Save the UUID before dispatch. The original workspace owns background Watch execution; merchant_grpc_health_read reads its retained history.

Receive merchant_grpc_health_export with the original manifest/file protocol and downloadGrpcHealthExport from ./grpc-health-download.mjs. It restores grpc-health.json, verifies its chained original history and checks the native operation/revision/snapshot identity against the immutable export manifest. The same receiving directory resumes its existing transfer.

The source-owned distribution contribution is grpc-health.json. It joins the original grpc-health command, CLI/native/record/receiving exports, protocol support files and this guide to the existing builder. The original gRPC browser asset contract includes the health panel and its neutral stylesheet.
