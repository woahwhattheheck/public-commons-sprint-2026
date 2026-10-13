# Run BDNB through the original workflow and Kestra/JMS delivery

The installed BDNB profile composes the six original BDNB actions behind the maintained source-workflow engine. That engine continues to own original API/JMS intake, stable request and correlation identities, retained configuration, native attempts, full outputs, delivery, recipient acknowledgments and portable receiving.

The configuration selects adapter "bdnb". It does not change the native Kestra flow definitions or add a broker client. Read the maintained [native Kestra guide](../../../stellar/scf-starforge-20261009/sf30-seller-sdk/datasette-analysis/kestra/README.md) and [workflow operations](../../../stellar/scf-starforge-20261009/sf30-seller-sdk/datasette-analysis/WORKFLOW.md) for their exact transport contract and installed versions.

## Prepare a complete actual action plan

Save one JSON object containing actions, publication_id and pack_id. Each action is {key,action,body}; key is a unique lowercase name beginning with a letter, followed by letters, digits, underscores or hyphens, at most 64 characters. The plan allows 1–200 actions. Every output entity ID is unique within the plan.

Use the complete already reviewed original BDNB mutation bodies. The plan can import original descriptors, select territories, compare exact editions, record supplied review decisions and publish. It must contain the selected publication and exactly one pack as its final action. The pack selects that publication and uses the same pack_id as the configuration.

The descriptor retains every original file identity and optional source-backed dictionary. A chain comparison keeps its ordered edition_path and passage selections. Original parser and model validation remain authoritative; this workflow does not infer missing source semantics.

Stable native request IDs derive from the original workflow run and each action key. The final pack's native request ID is exactly its pack_id. Both phase and action-key entries in nativeIds preserve those actual IDs. Original entity IDs stay exactly as supplied in the plan.

The workflow business request has the maintained schema stellar-forge.source-workflow-request.v1, actual requestId, correlationId, profile "bdnb-territory" (or the selected configured profile), and parameters {}. The complete plan is the retained configuration; a changed plan requires a successor business request.

## Bind the configuration

workflow.template.json is a template with deliberately unset installation and plan fields. Populate it from actual inputs:

~~~sh
python stellar/scf-starforge-20261009/sf30-seller-sdk/datasette-analysis/workflow_cli.py configure \
  --template products/ntico/bdnb-territory/workflow.template.json \
  --bdnb-plan /private/bdnb/approved-actions.json \
  --analysis-workspace /private/bdnb-analysis \
  --operation-id ACTUAL_ANALYSIS_OPERATION_ID \
  --source-archive /private/bdnb/complete-installed-product.zip \
  --flow-delivery /private/bdnb/actual-rendered-flow-delivery.json \
  --output /private/bdnb/configuration.json
~~~

The source archive and flow delivery options retain the full actual files and their hashes. Supply flow delivery when commissioned; do not manufacture a broker/deployment receipt for local work. The existing Analysis operator must already be running for the selected workspace and operation ID, with the same installed source edition.

Review the resulting configuration, including all action bodies and paths. Retain this exact file with the original business request. The first run binds its full configuration hash; a retry cannot replace it.

## Accept, run and reopen the same request

~~~sh
python stellar/scf-starforge-20261009/sf30-seller-sdk/datasette-analysis/workflow_cli.py accept \
  --workspace /private/bdnb-workflow --request /private/bdnb/original-request.json

python stellar/scf-starforge-20261009/sf30-seller-sdk/datasette-analysis/workflow_cli.py run \
  --workspace /private/bdnb-workflow --request-id ACTUAL_REQUEST_ID \
  --configuration /private/bdnb/configuration.json

python stellar/scf-starforge-20261009/sf30-seller-sdk/datasette-analysis/workflow_cli.py status \
  --workspace /private/bdnb-workflow --request-id ACTUAL_REQUEST_ID --history
~~~

A native failure retains the original request/action binding. Repeating run with the same request/configuration resumes through the inherited action wait/resume path. Completed actions are adopted by their original IDs and entity hashes. Completed workflow results retain every file and whole archive; native-adapter adoption rechecks their bytes.

The full public result contains the publication, pack, all accepted native entities, nativeIds and every output file. The original workflow normalizes the single archive out of the files list before final delivery, preserving one unique filename per complete artifact.

## Native broker delivery

Render the original native flows for the actual authorized namespace, broker/destinations and mounted workflow/configuration paths. Their process flow accepts the original message and calls the same workflow CLI. Its result publication must use the native producer's actual result and count.

The original operations remain publish, published, callback, receive-result, acknowledge and reconcile. An uncertain provider result stays uncertain until the original receipt is reconciled. A local completed Analysis job is not a broker acceptance. Keep native message/correlation/reply properties and the original publication attempt ID.

A customer result receiver verifies the complete result and returns the original receipt. Acknowledgment binds that receipt to the sender's retained request/result hash. The original receive_result and acknowledge flows implement this exchange.

## Full editable workflow handover

~~~sh
python stellar/scf-starforge-20261009/sf30-seller-sdk/datasette-analysis/workflow_cli.py export \
  --workspace /private/bdnb-workflow --request-id ACTUAL_REQUEST_ID \
  --destination /private/delivery/BDNB_Complete_Workflow.zip

python stellar/scf-starforge-20261009/sf30-seller-sdk/datasette-analysis/workflow_cli.py receive \
  --workspace /private/received-workflow \
  --archive /private/delivery/BDNB_Complete_Workflow.zip \
  --sha256 ACTUAL_ARCHIVE_SHA256 \
  --analysis-workspace /private/received-analysis
~~~

The original workflow export carries its retained request/configuration/history, native full outputs, source archive and native flow delivery when supplied. Its receiving path reopens the original complete Analysis archive. Continue with the same installed source and Analysis operation ID, then retain new customer decisions as successor entities.

The separate [domain receiving programme](RECEIVING.md) exercises the complete producer/customer/return data and review course on supplied originals. Run the actual Kestra/broker course as its own retained operation using the commissioned transport. Their receipts describe different execution boundaries and should both remain available.
