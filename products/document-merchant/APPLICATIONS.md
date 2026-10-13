# Document merchant in Applications

The **Document merchant** application prepares and operates the existing document
service through the maintained Applications screen. It uses the selected MintPDF,
snaplab or PDFMint configuration, original native payment factory, paid Jobs
merchant and complete PDF/source output package.

The same saved application owns its seller, customer listener, private operator,
worker and optional completed-result dispatcher. Its **Open**, **Stop** and
continuation actions use the original managed service. The document directory
contains the retained setup and original `merchant-state` directory.

## Prepare the supplier and native price

Create the complete editable setup template:

```sh
document-merchant template --provider snaplab --out /absolute/private/document-setup.json
```

Choose `mintpdf`, `snaplab` or `pdfmint` for the actual supplier. MintPDF also
supports `--provider mintpdf --anonymous`, which retains its published anonymous
allowance as the supplier plan. `document-merchant providers` lists the dated
provider contracts and their original documentation URLs.

Complete the JSON with the existing merchant's public HTTPS origin and actual
Stellar payment terms. The native asset, recipient and amount belong to that
merchant's payment configuration. Select the supplier plan, key environment name,
source formats, queue and worker limits. Keep this file private on the operating
host.

The actual provider key goes in the private Applications environment JSON. For
example, a snaplab setup names `SNAPLAB_API_KEY`; the environment JSON contains
that name and its actual key string alongside the original factory's required
variables. The setup file contains environment names.

Review the whole setup and service before starting:

```sh
document-merchant review \
  --request /absolute/private/document-setup.json \
  --directory /absolute/private/document-service

document-merchant inspect-service \
  --directory /absolute/private/document-service \
  --initialize /absolute/private/document-setup.json \
  --native-factory /absolute/private/native-factory.mjs \
  --start-worker
```

Both are read operations. The first returns the document configuration, supplier
planning basis, native function prices and output descriptors. The second adds
the exact source, factory, listener ports, environment references and worker or
delivery choices that will start.

A new service can be one missing directory below an existing private parent.
The first Start prepares it through the original document setup. An interrupted
setup reuses its retained input and exact generated application. An existing
service reads its own saved setup.

## Save and start the application

Open the installed runtime workspace and choose **Applications**. Select the
runtime containing the complete document source, then **Document merchant**.

| Field | Selection |
| --- | --- |
| Private document merchant directory | The original document directory, or the new reviewed directory. |
| Document setup JSON | Complete original setup for a new service; a prepared service can reopen from its retained setup. |
| Original native payment factory | The existing `.mjs` factory used by this merchant's native payment route. |
| Private environment JSON | Provider key and the original factory, intake or destination variables. |
| Start the original job worker | Process eligible settled jobs using the configured provider, worker and memory limits. |
| Seller port | Loopback port behind the existing HTTPS purchase route; 0 selects an available port. |
| Customer port | Loopback port behind public intake, status, input and result routes. |
| Private operator port | Authenticated operator port; 0 selects an available port. |
| Seller operations port | Original seller operations view; 0 selects an available port. |
| Open page | `jobs`, `inputs`, `resolutions` or configured `deliveries`. |
| Public intake override | Optional original intake configuration over the document functions. |
| Completed-result destinations | Optional original signed result-delivery configuration. |
| Existing custom result-delivery queue | The selected existing queue, or the default inside `merchant-state`. |
| Start result delivery | Starts the original dispatcher with its configured destinations. |

Use **Review**, **Save**, **Review Start** and **Start**. Review retains the
configuration, complete source files and exact native service choices. Start
uses those choices to prepare or reopen the same document merchant. Applications
receives the authenticated original Jobs operator announcement.

**Open** goes to the selected operator page. Related links open Document jobs,
Input receiving, Job resolution and configured Result delivery for that same
merchant. The configured public HTTPS origin remains the customer purchase and
intake entry point. The displayed loopback URLs are the actual local listeners.

The document application's resource identity is the original Paid-job merchant
identity for `<document-directory>/merchant-state`. Selecting this merchant
through the generic Paid-job merchant application refers to the same resource.
The native merchant lease also governs direct CLI commands.

## Fulfill a customer document

The setup writes `customer-setup.json` with the actual merchant origin, functions,
native price, source media types and example files.

```sh
document-merchant customer-setup \
  --directory /absolute/private/document-service \
  --out /absolute/private/document-customer-setup.json
```

A customer opens its existing **Request** application, loads that origin, selects
`renderHtml` or supported `renderMarkdown`, and adds the entire editable source
file. The input contains a title and original task reference. The native request
and checkout retain that exact source and advertised one-document price.

After the original purchase settles, the worker calls the configured supplier
and returns all four files:

| Slot | Customer delivery |
| --- | --- |
| `pdf` | Complete binary `document.pdf`. |
| `source` | The unchanged UTF-8 HTML or Markdown supplied by the customer. |
| `request` | Complete source and rendering request metadata. |
| `render` | Actual supplier response metadata and document result identity. |

The customer receives the package into its existing resource library.
Multi-document work uses the same functions, Requests, checkouts, jobs and
receiving. [BATCHES.md](BATCHES.md) covers saved batches, their exact prices,
same-request recovery and complete Collection export.

The Commons customer integration renders a saved Lead Pack's exact HTML edition
and attaches the received PDF to its original Case Desk delivery. Original case
and edition IDs remain the task and receiving identity. The PDF's editable
source remains that original HTML edition.

## Read provider use and merchant price

```sh
document-merchant price \
  --directory /absolute/private/document-service \
  --documents 25 --supplier-units 25

document-merchant usage \
  --directory /absolute/private/document-service \
  --out /absolute/private/provider-usage-current.json
```

Price review reads the saved supplier plan and merchant payment. The usage
command reads the provider's actual account endpoint and saves the complete
response. It can run while the managed service owns its Jobs state because it
reads the setup and supplier account.

One customer document request has one native merchant price and one complete
output package. Supplier render, cache or document-credit consumption has its
own accounting. A parent task can contain several paid documents and other work;
its completion follows that original task. A prepaid purchase and later
allowance use retain their original native accounting.

The supplier planning source is dated in `SOURCE_CHECKED_ON`. Original contracts:

- MintPDF: <https://mintpdf.dev/openapi.json> and <https://mintpdf.dev/>
- snaplab: <https://snaplab.dev/docs> and <https://snaplab.dev/>
- PDFMint: <https://pdf.mintapis.com/docs> and <https://pdf.mintapis.com/>

Actual account usage and the selected account plan provide the operating
allowance for a customer run.

## Stop, reopen and continue

Use **Stop** on the saved application. The original service closes admission on
its seller, customer and operator listeners, drains its worker and configured
delivery dispatcher, then releases the merchant state. The native exit record
remains with that managed operation.

Reopen the same saved application and document directory. **Review Start** reads
its retained setup and current selected source, factory and environment.
**Start** reopens that merchant and resumes eligible original jobs when the
worker is selected. Completed outputs and pending customer requests remain in
their original stores.

An interrupted setup continues from `setup.json` and its generated files. A
changed setup, supplier, application or service input produces its specific
source-change error. Restore the original file to continue that operation, or
select the intended completed configuration through the saved application's
normal review. A replacement merchant uses its own directory.

Use the original Job resolution view for retained job decisions. Supplier
allowance and authentication failures remain the corresponding provider/job
outcome. Once the account issue is corrected, continue that original job through
its existing recovery or retry action. Customer batch receiving continues the
same accepted request and job.

## Foreground CLI

The same service runs in a terminal with its private environment already selected:

```sh
document-merchant launch \
  --directory /absolute/private/document-service \
  --initialize /absolute/private/document-setup.json \
  --native-factory /absolute/private/native-factory.mjs \
  --seller-port 0 --customer-port 0 --operator-port 0 --operations-port 0 \
  --start-worker
```

For a prepared service, omit `--initialize` to read its saved setup. The command
prints the complete native Jobs startup announcement and remains in the
foreground. SIGINT and SIGTERM close that same service and retain its jobs.

`launch` accepts the optional original intake and result-delivery configuration,
custom queue, dispatcher and landing choices in the field table. `--port` is an
alias for `--operator-port`. Each nonzero service port must be distinct.

The existing `document-merchant serve` command operates an already prepared
merchant with original Jobs serve arguments. `document-merchant jobs` forwards
offline Jobs operations after the running service closes. Use its browser for
job operations while that service owns the merchant lease.

## JavaScript and TypeScript

The installed product exports the same service from `./document-merchant` and
`./document-merchant/launch`.

```js
import {
  readDocumentServiceSelection,
  openDocumentService
} from './source/products/document-merchant/index.mjs';

const options = {
  directory: '/absolute/private/document-service',
  configurationFile: '/absolute/private/document-setup.json',
  nativeFactoryPath: '/absolute/private/native-factory.mjs',
  startWorker: true,
  operatorPort: 0
};
const reviewed = await readDocumentServiceSelection(options);
// Present this complete selection in the original operating flow.
const stop = new AbortController();
const interrupt = () => stop.abort();
process.once('SIGINT', interrupt);
process.once('SIGTERM', interrupt);
let service;
try {
  service = await openDocumentService(options, {
    expectedSelection: reviewed.selectionSha256,
    env: process.env,
    signal: stop.signal
  });
  console.log(service.launch.entryUrl);
  await service.closed;
} finally {
  process.off('SIGINT', interrupt);
  process.off('SIGTERM', interrupt);
  await service?.close();
}
```

`reviewDocumentMerchant` returns the new, incomplete or prepared setup without
creating files. `readDocumentServiceSelection` returns the complete stable
source/service hash. Its meaning stays the same before and after first setup.

`openDocumentService` returns the original Jobs model, listeners, selection,
launch, `closed` promise and `close()`, plus `documentSelection`.
`runDocumentServiceCommand` adds foreground signal handling.
`readDocumentServiceLaunch` reads the original private managed launch and
authenticated live operator identity.

The Applications adapter uses the original `job-service-launch.json` and
`job-service-exit.json` files in the existing managed operation. The merchant's
job store and supplier setup remain their original records.

## Receive the installed workflow

Build the existing `document-merchant` selection from its completed immutable
repository revision. Its contribution declares the document Applications
provider. The package includes the original runtime compatibility entry,
complete document source, current Jobs service, customer Requests, batch
receiving and operating guides.

Receive this package into the existing native runtime installation. Reopen the
Applications host to load its completed catalog. Existing saved applications
keep their identities and histories.

For the first customer operation, select the actual merchant factory and
customer workspace already used by the native payment operation. Use the real
provider account or its returned anonymous allowance. Prepare and start the
document application, receive its authenticated listener, fulfill the selected
customer HTML edition through the existing batch, receive all four files and
attach the PDF through the original Case Desk action. Stop and reopen the same
application, then read that completed original customer job and its files.
