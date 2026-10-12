# Paid application jobs in Applications

The **Paid application jobs** entry opens the complete customer workflow in the maintained Applications console. A customer selects a merchant function, prepares a request, reviews its original checkout, approves the payment, follows execution and receives the verified result into the existing resource library. Request, Checkout, Jobs, Library and Collections share one private customer directory and one running application.

The installed command is `job-workspace`. The Applications producer is the existing [application-job-checkout.mjs](../../../distribution/runtime-workspace/application-job-checkout.mjs). It composes the selected runtime, reviewed files, managed command, original terminal, stop and recovery already supplied by [Applications](../../../distribution/runtime-workspace/APPLICATIONS.md).

## Select and start the customer

Choose **Paid application jobs** from a READY installation containing the current paid-jobs customer, merchant intake and original browser approval bridge. The source interface is exported by that installation's `sf88-operator-buyer-cli/job-workspace/launch.mjs`; the launcher reads it from the selected installation before preparing a start.

Complete these settings:

| Setting | Meaning |
| --- | --- |
| Private job customer directory | Reopen the existing customer, or choose one new directory in an existing private parent. |
| Original initialized operator workspace | Select the existing original buyer workspace containing `workspace.json` and `operator.json`. |
| Original private Node buyer profile | Select this private, owned profile instead of an operator workspace. Exactly one operator source is required. |
| Approval interface | `browser` by default. `terminal` explicitly selects the original managed terminal. |
| Open page | `request` by default; also accepts `checkout`, `jobs`, `library` or `collections`. |
| Terminal Python executable | The original managed terminal uses the reviewed executable, defaulting to `/usr/bin/python3`. |
| Local port | Use `0` to choose an available loopback port. |
| Private environment JSON | Optional original environment selection. Credentials remain in that private file or the original operator source. |

Use the console's **Review configuration**, **Save configuration**, **Review start** and **Start reviewed application** actions. Each step retains the original reviewed runtime and file identities. Select **Open application** once its actual startup appears. The selected landing opens directly, and the run exposes links to the other four destinations.

The original managed terminal remains available for lifecycle output. With browser approval, the payment decision appears in the customer's Checkout page. With terminal approval, use the original Applications terminal panel when the original buyer presents its prompt.

The selected installed runtime supplies the native SF88 source. Applications does not take a separate customer-entered runtime path for this product. The producer pins the original CLI, buyer client, customer host, launch reader, intake and checkout controllers. Browser mode additionally pins the selected original bridge. The existing runtime profile and source manifest retain the remainder of the installation.

## Request, review and receive

On **Request**, enter the merchant's public HTTPS origin and load its actual function catalog. The catalog supplies the available function IDs, input schema and example, exact payment terms, output type and limits. Select the desired function and enter its real input. The merchant operator controls function selection and payment configuration; see the [merchant intake guide](../../../sf30-seller-sdk/jobs/intake/README.md).

If the catalog requires an intake access key, enter it through the private request controls. The key remains part of that private request's credential custody. It is not a public application setting or URL parameter.

Save the request draft, inspect its input and terms, then choose **Prepare job**. The customer saves its original reference, claim and selected function before sending the merchant request. The merchant creates the original prepared job, and the customer retains the exact returned ticket before importing it into Checkout. The [Request guide](../intake/README.md) covers request recovery, key updates and withdrawal.

Open the linked **Checkout**. Its offline review is performed by the original SF88 buyer using the retained ticket and selected operator source. Inspect the actual reviewed resource, network, asset, recipient and maximum atomic amount. Start the original checkout operation and use its selected approval interface.

In browser mode, the page shows the original SF62 approval snapshot for that specific original intent and active task. Review the displayed request and make the original decision. Changing a checkout, cancelling its task or closing the host closes that pending review with its owner. The shared browser bridge and original buyer own decision validation.

When the original paid response accepts the job, the customer retains that accepted response and its original buyer operation. **Jobs** shows its current status and original execution history. Fetch the completed result to receive its verified bytes into the resource library. Library metadata retains the original job identity, accepted source, result size and SHA-256. Open the resource, label it, add it to a collection and export it through the existing library and collection controls.

An interrupted browser request does not discard the saved operation. **Request** retries the same saved merchant reference and claim when preparation needs recovery. **Checkout** reopens its original native operation after an attempt. **Jobs** reopens its accepted buyer and result. These are separate stages of the same customer workflow.

## Choose the page without creating another customer

The landing selection only changes which original page Applications opens:

| Landing | Destination | Useful for |
| --- | --- | --- |
| `request` | `/jobs/request/` | New input requests and retained preparation recovery |
| `checkout` | `/jobs/checkout/` | Reviewing tickets, approval and original buyer recovery |
| `jobs` | `/jobs/` | Accepted jobs, status, result retrieval and labels |
| `library` | `/` | Received resources, previews and original resource operations |
| `collections` | `/collections` | Organizing and reopening retained resources |

The same host issues all five private links. Their capability remains in the original URL fragment and private managed-run record. Switching pages does not start another process or create a second customer store.

To change a saved application's landing or approval interface, stop its existing run, edit and save the reviewed configuration, then review and start the same application again. Keep its original customer directory. Existing imported checkouts retain their originally selected native runtime and operator source; the selected installation supplies the defaults for future imports.

## Direct installed command and library API

The same application can be started directly:

~~~sh
starforge job-workspace serve \
  --state /private/job-customer \
  --operator-workspace /private/original-buyer \
  --approval-mode browser \
  --landing request \
  --port 0
~~~

Replace `--operator-workspace` with `--operator-profile` when using the original private Node profile. A direct operator may also use the existing `--runtime` option for an explicit original SF88 source; the managed Applications producer derives this path from its selected installation.

The `serve` command accepts both interface options. Standalone `checkout-execute` continues to use its original terminal approval. The existing request, checkout, accepted-job and library commands keep their saved state and operation identities.

The typed `./buyer/job-workspace` entry exports the same host and launch helpers:

~~~js
const host = await startJobCustomerWorkspace({
  model,
  port: 0,
  browserApproval: true,
  landing: 'request',
});

// host.entryUrl is the selected original page.
// host.launch is the exact private startup announcement.
await host.close();
await model.close();
~~~

The host closes its intake tasks, original checkout child and browser broker before its owning model releases the customer lease. Repeated close calls share their actual completion.

## Existing catalog, command and observer joins

The maintained shared writer retains these three existing hooks:

~~~js
jobCheckoutApplication(common);
validateJobCheckoutSelection(settings);

const original = await prepareJobCheckoutApplication(
  settings, runtimeDirectory, inputPath,
);
args.push(...original.args);
inputs.push(...original.inputs);
createDirectories.push(...original.createDirectories);
~~~

Their signatures are unchanged. The common branch continues to append the port once and handle terminal Python, private environment selection and the existing managed state resource. Keep the current application ID `job-checkout`, command `job-workspace` and original resource-key behavior for the selected customer directory.

The prepared command now contains reviewed `--approval-mode` and `--landing` arguments. The source reader exports `JOB_WORKSPACE_APPLICATIONS`, with schema `stellar-forge.sf88.job-workspace-applications.v1`, the original launch schema and the supported mode and landing names. The producer requires this actual selected-source interface before preparing a new managed launch. Older original launch records remain readable by their original API without assigning them an invented mode.

The existing `job-workspace` stdout branch awaits:

~~~js
const startup = await jobCheckoutStartup(request, line);
~~~

It returns `{url, links, original}`. Save all three in the existing serialized `application-url.json` write:

~~~js
{
  // Keep the current schema, applicationId, operationId,
  // command, source and observedAt fields.
  url: startup.url,
  links: startup.links,
  original: startup.original,
}
~~~

The additive shared-writer change is `links: startup.links` in that existing job-workspace branch. The original Applications model already exposes retained link arrays as `privateLinks`; its current view renders those links alongside the chosen application entry.

The producer reads the selected source's `readJobWorkspaceLaunch` before accepting a startup. It matches the private customer path, native runtime, operator selection, actual PID, instance UUID, all five canonical local routes, approval mode, landing and chosen entry URL against the original private launch file. A standalone stdout URL does not select a destination.

The original launch schema remains `stellar-forge.sf88.job-workspace-launch.v1`. New launches include `approvalMode`, `landing` and `entryUrl` alongside the established customer, source, operator, listener and private-file fields. The reader accepts these optional expectations:

~~~js
await readJobWorkspaceLaunch({
  directory,
  runtimeDirectory,
  operatorWorkspace,
  pid,
  approvalMode: 'browser',
  landing: 'request',
});
~~~

## Stop, reopen and continue the native result

**Stop application** addresses the existing managed run. The original host drains preparation requests and native children, closes its approval broker and HTTP listener, marks its own launch instance CLOSED, and releases the customer through its original owner. The retained Requests, Checkouts, accepted jobs, verified resources and collections remain in the same directory.

Reopen the saved application to inspect its earlier run. A new reviewed start opens that same customer and produces a fresh private listener. Continue an unfinished stage from its existing request, original checkout operation or accepted-job entry.

The native browser continuation in this directory exercises the same merchant intake, original approval, SDK, worker, result and collection path. Its completed-core cloud mode receives the original finished merchant records and earlier result before continuing the customer phases. The [cloud continuation guide](../../../sf30-seller-sdk/jobs/CLOUD_NATIVE.md) describes that original state transfer and the retained outputs.
