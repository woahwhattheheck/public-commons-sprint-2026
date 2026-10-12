# Merchant input requests for durable paid jobs

A customer can choose one of the merchant's configured functions, provide its inputs, and receive the original private purchase ticket. The merchant uses the same durable job store, customer listener, configured application and SF30 purchase route. Its worker begins after the original native settlement activates the job.

This intake is the preparation step for the [customer Request workspace](../../../sf88-operator-buyer-cli/job-workspace/intake/README.md). It supports merchant schemas and examples, exact configured payment terms, stable customer references, recovery of a lost response, and withdrawal before native submission.

## Enable an existing merchant

The original job store pins its merchant configuration and application. Keep those original files and their paths when reopening an existing store. Select intake functions in a separate JSON file:

~~~json
{
  "enabled": true,
  "functions": ["analyze"]
}
~~~

Save this as an operator-owned file such as /srv/starforge/merchant/intake.json. The included example-intake.json has this shape. Each selected ID must already exist in the original merchant configuration.

Start the existing merchant with the additional selector:

~~~sh
starforge jobs serve \
  --config /srv/starforge/merchant/merchant.json \
  --state /srv/starforge/merchant/state \
  --intake-config /srv/starforge/merchant/intake.json \
  --native-factory /srv/starforge/merchant/native-runtime.mjs \
  --seller-port 8476 \
  --customer-port 8477 \
  --operator-port 8478 \
  --operations-port 8479 \
  --start-worker
~~~

The process prints the seller, customer, operator, settlement-operations and public intake addresses. It owns one original merchant model and state lease. Stop this process normally before reopening the same state from a separate command.

The selector contains only enabled, functions and accessTokenEnvironment. It cannot supply a payment option, function body, application path, worker environment or handler. Selected functions inherit those values from the original merchant.

An enabled selector can also be embedded as the intake property in a **new** merchant configuration. The included example-merchant.json enables analyze and refers to the original application at ../example-application.mjs. Keep that relative layout when copying the example. Configure the actual public origin, native runtime, facilitator and payment asset/recipient using the [merchant installation guide](../INSTALL.md).

An external --intake-config selector takes precedence over the embedded property for this listener. A selector containing only {"enabled":false} disables intake. This separate selector lets an existing merchant add or remove advertised input functions while keeping its original store identity.

## Route the existing customer listener

The public origin is the original merchant's configured HTTPS origin. Route its /jobs/ prefix to the existing customer listener. The native purchase paths, such as /analysis, continue through the original seller route.

For example, inside the existing TLS virtual host:

~~~nginx
location /jobs/ {
    proxy_pass http://127.0.0.1:8477;
    proxy_set_header Host $http_host;
}
~~~

The customer listener binds to 127.0.0.1. It checks the Host and any Origin header against the configured merchant. Its existing status and result endpoints share the same listener, response headers, capacity and shutdown lifecycle with intake.

The published intake routes are:

| Method and path | Purpose |
| --- | --- |
| GET or HEAD /jobs/intake/v1/functions | Read selected functions, their schemas, examples, configured terms and limits. |
| POST /jobs/intake/v1/requests | Prepare or recover one original job and return its private purchase ticket. |
| POST /jobs/intake/v1/withdrawals | Withdraw the same original job while it remains unsubmitted. |

Use the printed intake URL to inspect the live catalog. With the service stopped, the original CLI can print the same configured catalog:

~~~sh
starforge jobs intake-catalog \
  --config /srv/starforge/merchant/merchant.json \
  --state /srv/starforge/merchant/state \
  --intake-config /srv/starforge/merchant/intake.json
~~~

The command opens the same original merchant lease. The public GET is the appropriate interface while the service is running.

## Optional customer access

To require a merchant-issued intake key for new requests, add its environment reference to the selector:

~~~json
{
  "enabled": true,
  "functions": ["analyze"],
  "accessTokenEnvironment": "SF_JOBS_INTAKE_KEY"
}
~~~

Supply that variable to the merchant process through the existing deployment environment. Its value must contain 16–1024 visible ASCII characters. The catalog reports access-token authentication; it exposes the selected function definitions and terms, and keeps the variable name and key value private.

The customer Request page stores the supplied key in its private local request record. Its original HTTPS client sends the key only to the selected merchant origin in x-sfjobs-intake-token. An intake key does not become an application-worker environment variable.

Changing the environment value rotates access for new requests. A customer that already holds the claim of an existing original job can recover that same job's lost ticket. The merchant checks the existing claim, original function and input identity before returning it. Withdrawal similarly uses the original job claim, so an access-key rotation cannot strand an unsubmitted job.

## Input and ticket identity

The catalog schema is stellar-forge.job-intake-catalog.v1. Each function contains its ID and description, original inputSchema and example, output metadata, execution and byte limits, original payment requirements, and purchaseUrl. functionSha256 binds that complete definition. catalogSha256 binds the whole advertised catalog.

A customer request uses this shape:

~~~json
{
  "schema": "stellar-forge.job-intake-request.v1",
  "catalogSha256": "SHA256_FROM_THE_CATALOG",
  "functionSha256": "SHA256_FROM_THE_SELECTED_FUNCTION",
  "functionId": "analyze",
  "reference": "demand:2026.10",
  "claimToken": "CUSTOMER_GENERATED_BASE64URL_CLAIM",
  "label": "October demand report",
  "input": {
    "values": [2, 4, 6, 8],
    "window": 2
  }
}
~~~

The customer workspace generates and saves the claim before sending this body. It also saves the exact reference, selected terms and input digest. References use the original 1–80 character job identifier, including letters, digits, periods, underscores, colons and hyphens. Labels retain their exact spelling and spaces.

The merchant validates the submitted input through the original function schema. It then calls the original model.createJob with the selected function, exact input, label, reference and claim. An existing reference returns the same job only when the original claim, function and input agree. A different request cannot replace that job.

The response has schema stellar-forge.job-intake-response.v1 and contains handoff, the original stellar-forge.job-handoff.v1 ticket. That ticket binds the original paid URL, sf98_order query, x-sf98-order-id header, job-claim header, request body, payment requirements and anticipated acceptance URLs. The customer retains it before importing it into original Checkout.

New requests require the current advertised catalog and access settings. After a reply is lost, a later catalog selection or key rotation can still recover a **pre-existing** job through its original claim and unchanged function definition. That recovery cannot create a new job using retired catalog settings.

## Continue the paid workflow

The prepared record is visible in the merchant's existing Jobs workspace. The customer selects **Open Checkout**, reviews the original request and uses the configured SF88 approval flow to purchase it. A successful native settlement moves the original job into its execution lifecycle.

The intake service does not choose a replacement price or application. Its returned payment requirements are the same original configured option used by SF30. The customer's original checkout, native approval, result acceptance, job buyer and resource library continue from the retained ticket.

Merchant retry, execution cancellation, result publication, native settlement reconciliation and worker recovery retain their existing interfaces. See the [merchant product guide](../README.md) and [customer guide](../../../sf88-operator-buyer-cli/job-workspace/intake/README.md) for the rest of that workflow.

## Withdrawal and interruptions

A customer can withdraw a saved request before the original merchant records a submission. For an unsent local draft this is a local state change. For a sent request, the customer reads original job status and sends its claim, reference, expected revision and reason to the withdrawal route.

The merchant checks capability, current revision and PREPARED state inside the original serialized store update. Native staging uses that same store. Whichever operation commits first determines whether the job is submitted or cancelled. An already-staged job continues through its original checkout and merchant controls.

If a network response was lost, the customer first resolves the same saved request before withdrawing it. Repeating a completed withdrawal returns the same cancelled original job. Closing either application drains its active intake work and retains the original IDs and claims for reopening.

Queue exhaustion returns the original queue error. Keep the saved request and continue it when capacity is available. An invalid input remains visible in the customer's saved request; a corrected input uses a new reference so an existing prepared job keeps its original meaning.

## Embed in an existing merchant process

The public listener accepts an optional selector directly:

~~~js
import { openJobMerchant } from '../model.mjs';
import { startCustomerServer } from '../customer.mjs';

const model = await openJobMerchant({
  configPath: '/srv/starforge/merchant/merchant.json',
  directory: '/srv/starforge/merchant/state',
});
const customer = await startCustomerServer({
  model,
  port: 8477,
  intakeConfig: { enabled: true, functions: ['analyze'] },
});
~~~

The owning process also starts its original seller and worker as described in the merchant guide. It closes the customer listener before closing the same model. createJobIntake in service.mjs provides catalog(), prepare(), withdraw() and drain() for another existing HTTP host that applies equivalent request limits and host authorization.
