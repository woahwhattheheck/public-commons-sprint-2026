# Install Document Production and its document merchant

The `document-merchant` selection installs the complete document service, customer production browser and ordered PDF assembly workflow from this public repository. It includes the original paid Jobs service, Request and Checkout, named output receiving, Resource Collections, managed Applications and operating commands. A customer can turn complete CSV or JSON data and HTML or Markdown templates into PDFs, retain the editable source, and receive an ordered archive on another machine.

## Build one complete source edition

Use the full public checkout and the exact committed revision selected for the installation. The source recipe is [document-merchant.json](document-merchant.json).

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/public-commons-checkout \
  --ref FULL_SOURCE_COMMIT \
  --selection document-merchant \
  --out /absolute/private/document-release \
  --offline
~~~

The original builder reads committed source and preserves its repository identities. It includes the complete document product, declared browser assets, application providers, templates and native shared modules used at runtime. Keep the resulting archive and its source manifest together. Use the actual archive filename, byte count and SHA256 in the receiving installation.

An interrupted build continues in the same output directory:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/public-commons-checkout \
  --out /absolute/private/document-release --resume
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --out /absolute/private/document-release --status
~~~

Use a new output directory for a different source edition. The selected output's saved commit and recipe remain the identity of that build.

## Install the private application runtime

Use Linux, Node 22.16 or newer, Python 3.11 or newer, npm and the original Linux `flock` support. Prepare the runtime from the actual completed archive:

~~~sh
node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs prepare \
  --dir /absolute/private/document-runtime \
  --archive /absolute/private/document-release/ACTUAL_ARCHIVE.tgz \
  --sha256 ACTUAL_ARCHIVE_SHA256 \
  --native --feature schema --operator
node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs install \
  --dir /absolute/private/document-runtime
node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs inspect \
  --dir /absolute/private/document-runtime --load --source
node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs run \
  --dir /absolute/private/document-runtime -- document-merchant providers
~~~

Add the original `mcp` feature when selecting a merchant agent installation. The selected source manifest supplies its actual dependencies. A prepared runtime becomes usable when the native installer returns its completed installation status. Continue an interrupted installation through its original `resume --dir SAME_DIRECTORY` operation and retained cache.

The commands below use the installed `starforge` or `document-merchant` executable. They can also follow `runtime-install run --dir ORIGINAL_RUNTIME --`. Register the completed runtime in the existing Runtime workspace to use its Applications catalog. The source remains under the installed package's `source/` directory.

For an upgrade, receive the following complete archive into a new selected runtime through the maintained runtime installer. Keep the current runtime and existing application registration available during receiving, then select the completed following installation in the same saved application.

## Prepare the document merchant

Create a setup using the actual supplier. The product supports `mintpdf`, `snaplab` and `pdfmint`; its retained provider guide distinguishes their accounts, formats and published units.

~~~sh
document-merchant template \
  --provider snaplab --out /absolute/private/document-setup.json
~~~

Complete this original JSON with the real merchant HTTPS origin, native network, asset, recipient and atomic per-document amount. Select the supplier account plan, supported formats, queue allowance, worker count and environment variable name for its key. Put key values and the original payment factory's variables in the private operating environment.

Review both setup and service:

~~~sh
document-merchant review \
  --request /absolute/private/document-setup.json \
  --directory /absolute/private/document-service
document-merchant inspect-service \
  --directory /absolute/private/document-service \
  --initialize /absolute/private/document-setup.json \
  --native-factory /absolute/private/native-factory.mjs \
  --start-worker
~~~

In **Applications**, select the completed runtime and **Document merchant**. Use this document directory, setup, original native payment factory, private environment JSON, selected listener ports and worker choice. Use **Review → Save → Review Start → Start**. The original Jobs announcement supplies the authenticated operator link and actual listeners. Keep the merchant's configured HTTPS routes attached to those original seller and customer listeners.

The equivalent foreground operation is:

~~~sh
document-merchant launch \
  --directory /absolute/private/document-service \
  --initialize /absolute/private/document-setup.json \
  --native-factory /absolute/private/native-factory.mjs \
  --seller-port 0 --customer-port 0 --operator-port 0 --operations-port 0 \
  --start-worker
~~~

Omit `--initialize` to reopen a prepared service from its retained setup. The document application and generic Paid-job merchant refer to the same `merchant-state` resource and lease. Use the live operator interface while it owns that merchant. Stop through its original application before opening standalone commands against the same state.

## Open the customer's Document Production application

Keep the customer's complete original options JSON, including its existing operator or Node profile, runtime and allowed file roots. Its original `checkout` object is retained as a whole. A workspace using the original operator has this basic shape:

~~~json
{
  "directory": "/absolute/private/original-customer-workspace",
  "checkout": {
    "operatorWorkspace": "/absolute/private/original-operator",
    "runtimeDirectory": "/absolute/private/original-runtime"
  }
}
~~~

Select **Document production** in Applications with that same customer configuration and the actual merchant origin, or start its original browser service:

~~~sh
starforge document-merchant compose serve \
  --workspace-options /absolute/private/original-customer-options.json \
  --provider snaplab \
  --merchant-origin https://ACTUAL_MERCHANT_ORIGIN
~~~

The production application uses the customer's existing Request, Checkout, Jobs and Resource library. A saved composition keeps the full dataset, complete templates, grouping and mapping selection. Use the browser to:

1. Receive complete CSV or JSON data and HTML or Markdown templates.
2. Select the actual field mappings, record grouping and document templates; save the composition.
3. Prepare the merchant price and inspect the complete saved native plan.
4. Render at that saved price through the original customer payment operation.
5. Receive existing accepted jobs and download their full PDF and source packages.
6. Export the full native Collection for independent receiving.

Reopen that original workspace and saved composition to continue unfinished work. The application keeps its original request, native quote, ticket, job and received resource identities. Browser closure does not create a second purchase. The installed [composition guide](../../../../products/document-merchant/COMPOSITION.md) covers its exact CLI, source and browser interfaces; [batch operation](../../../../products/document-merchant/BATCHES.md) covers the underlying saved requests and complete receiving.

## Deliver every file and ordered PDF volume

A rendered document carries four original output slots: the full binary PDF, unchanged editable source, complete request metadata and actual render metadata. The named-output engine receives these through the existing job and resource library. Whole-file browser downloads retain the original authenticated delivery route.

For a customer who needs an ordered invoice or report bundle, enable assembly explicitly on an actual PDFMint-backed merchant using `template --provider pdfmint --assembly`. Select its separate complete native assembly payment terms and commission it through the same review and launch flow.

In the original **Document production** application, select received documents in their required business order and retain the customer task reference. **Prepare ordered PDF bundle** saves the complete PDF sources and volume layout. **Prepare assembly price** returns its actual native payment plan. **Assemble at this saved price** uses that exact plan. Continue through **Receive existing assemblies** until its accepted jobs finish, then export the complete PDF bundle.

The delivered archive contains every final ordered volume, complete original PDF sources, the editable assembly plan, membership and result tables, and the original paid-job Collection when assembly jobs were required. Its `index.html` opens the completed delivery. Independent receiving can restore the original source plan and native Collection through the maintained commands in [ASSEMBLY.md](../../../../products/document-merchant/ASSEMBLY.md).

Supplier credits, PDF pages, native purchases, document counts and acceptance of the parent customer task retain their separate meanings. The selected native quote supplies the amount for the actual purchase; the supplier's dated USD plan is its own planning source. Read current supplier usage through the original product's account operation when operating the merchant.

## Continue the same saved operation

| Retained operation | Continuation |
| --- | --- |
| Source build | Same output directory and original builder resume. |
| Application installation | Same selected runtime and native installer resume. |
| Merchant setup | Same retained setup and generated application; review the intended configuration before choosing another installation. |
| Running document service | Original Application Open and Stop actions, or its foreground owner. |
| Saved composition and batch | Same original customer options, saved source and native price plan. |
| Accepted unfinished job | Existing job receiving or its original recovery action. |
| Ordered assembly | Same complete source SHA, volume order and approved native plan. |
| Customer delivery | Original full Collection or complete PDF bundle, followed by independent receiving. |

Application shutdown closes HTTP admission, drains its owned document and delivery work, then closes the original customer or merchant owner. Use the saved original operation when resuming. A changed customer source or ordered bundle becomes an explicitly selected following edition.

## Maintained operating sources

| Area | Complete source |
| --- | --- |
| Merchant, native price and supplier account | [OPERATING.md](../../../../products/document-merchant/OPERATING.md) |
| Managed merchant lifecycle | [APPLICATIONS.md](../../../../products/document-merchant/APPLICATIONS.md) |
| Customer production and complete templates | [COMPOSITION.md](../../../../products/document-merchant/COMPOSITION.md) |
| Paid batches and full Collection receiving | [BATCHES.md](../../../../products/document-merchant/BATCHES.md) |
| Ordered PDFs and independent source receiving | [ASSEMBLY.md](../../../../products/document-merchant/ASSEMBLY.md) |
| Named output contracts and original receiving | [Output packages](../../sf30-seller-sdk/jobs/outputs/README.md) |
| Application runtime installation | [RUNTIME_INSTALL.md](../RUNTIME_INSTALL.md) |

This public edition retains the complete document product from Merchant source `a4abafd2bee1e05bb18c90f4b6ed331b5384163c`, the original named-output contribution `827809903e8d4c9485afeb314ecb7b22ebf4fb12`, and the original browser host extension from PR 957. The native output continuation keeps its compatible full-checkout repository selection from `27ea3b653a2c03799628ec664cb8094bbd87f819` together with the public runtime's retained-directory handling. Existing public storage diagnostics and Collection exports remain in their original source.

The original document commissioning operation continues with its selected merchant account, original customer case and actual native receiver. Its saved native build, installation, render and receiving records identify the edition it has operated.
