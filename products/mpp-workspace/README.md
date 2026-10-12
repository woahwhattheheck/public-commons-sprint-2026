# Native MPP merchant and customer workspace

This product opens the native Stellar MPP merchant, customer workbench and merchant agent as one retained application. Operators configure paid resources and exact prices, receive a merchant contract, prepare a purchase, approve it through the original spending governor, recover the same purchase after interruption, and receive the original response or complete customer package.

Recurring channel work uses the same application: select an existing funded channel, authorize a useful task budget, receive each cumulative commitment's original response, add funds, collect the merchant's earned commitments while keeping the channel open, recover remaining funds and hand over the complete operating channel. Open **Channel work** in the browser for this workflow.

The browser is the existing native console. The agent is the existing merchant MCP with its native MPP tools. Both use the same private workspace, purchase identities, signed credentials and accounting records.

## Start the product

Use the installed standalone merchant distribution, or replace `starforge mpp-workspace` with `node products/mpp-workspace/cli.mjs` in a source checkout. Node 22 or later, Python 3 and the original Linux `flock` workspace lease are required.

Choose an existing private parent directory and an absolute native runtime directory:

```sh
starforge mpp-workspace runtime-template /absolute/private/mpp-runtime
starforge mpp-workspace runtime-receive /absolute/private/mpp-runtime \
  --cache /absolute/private/mpp-archives --cache-limit-bytes 4194304

starforge mpp-workspace init \
  --dir /absolute/private/mpp-product \
  --runtime /absolute/private/mpp-runtime \
  --name "Native merchant"

starforge mpp-workspace open \
  --dir /absolute/private/mpp-product --browser-only
```

Open the printed private browser URL. Its fragment authenticates the original console. Configure the merchant or receive a customer contract in that browser.

To open the merchant agent as well, supply the existing incoming access token through `MCP_ACCESS_TOKEN`, or the selected `--token-env` name, and omit `--browser-only`. The original MCP OAuth host also accepts `MCP_OAUTH_CONFIG`. The private console receives its own per-session token.

An existing native workspace can be adopted without copying its records:

```sh
starforge mpp-workspace init \
  --dir /absolute/private/mpp-product \
  --runtime /absolute/private/mpp-runtime \
  --workspace /absolute/private/original-native-workspace
```

The existing workspace must be stopped before this product opens it. Its original native lease remains the authority over its writer.

## Use managed Applications

In the installed runtime workspace, open **Applications → Native MPP merchant and customer**. Select the private product directory, browser/agent ports and optional private environment JSON. Review the original workspace identity, active profiles, native runtime and registered customer configurations, then save and start.

Applications runs the original product in a retained terminal. The SF36 governor uses that controlling terminal for its normal approval flow. The startup observation joins the reviewed command, original wrapper process, native child process, retained product session and authenticated native console identity.

Stop drains the merchant agent, accepted console jobs and merchant listener, then closes the original native workspace. Reopen preserves profiles, customer contracts, purchase/preparation IDs, signed credentials, response bytes and accounting history.

## Complete workflows

| Workflow | Original owner used by this product |
|---|---|
| Merchant resources, prices, public origin and native listener | Native MPP console and merchant |
| Customer contract/bundle intake, price/cap review and offer inputs | Native customer workbench |
| Stable preparation and exact request binding | Native buyer and original retained preparation |
| Approval, reservation, finality and budget reconciliation | Existing SF36 governor and SF86 transfer reconciliation |
| Official Stellar charge challenge and transaction credential | Published `@stellar/mpp@0.7.1` with `mppx@0.6.29` and `@stellar/stellar-sdk@15.1.0` |
| Recurring channel tasks, capped cumulative vouchers and useful merchant output | Native channel workbench and the pinned SDK's channel intent |
| Channel funding, ongoing collection, close and remaining-balance refund | Original contract calls, selected funder/recipient fee authority and same-network transaction recovery |
| Complete channel operation, source and input receiving | Native channel handover receiver and immutable-file reader |
| Agent review/configure/prepare/execute/resume/finalize and retained exports | Existing native merchant MCP, including channel status/record/operate/file |
| Twelve-file Node/TypeScript/Python customer receiving | Existing trusted native customer bundle receiver |
| Exact response or customer-bundle transfer over MCP | Existing retained-file manifest/chunk downloader |
| Private process ownership and source-bound start/stop | Existing Applications framework and native workspace lease |

**[OPERATING.md](OPERATING.md)** explains setup, merchant and customer operations, terminal approval, recovery and typed clients. **[RECEIVING.md](RECEIVING.md)** explains customer/response delivery and complete channel receiving. The full **[channel work guide](../../stellar/scf-starforge-20261009/mpp-channel/README.md)** covers task budgets, merchant profiles, work lists, funding, collection, refund and source handover.

## Package interfaces

The distribution contribution supplies the product command, its direct channel command, one Applications provider and four typed exports:

```js
import {
  initializeMppProduct, openMppProduct, inspectMppProduct
} from '@tokenjunkielabs/starforge-merchant/products/mpp-workspace';

import {
  connectMppProduct, connectMppAgent, receiveMppCustomer
} from '@tokenjunkielabs/starforge-merchant/products/mpp-workspace/client';

import {
  inspectMppLaunch, openMppProductManaged
} from '@tokenjunkielabs/starforge-merchant/products/mpp-workspace/managed';

import {
  connectMppChannel
} from '@tokenjunkielabs/starforge-merchant/products/mpp-workspace/channel';
```

Use the package name declared by the installed distribution if your installation renames that package. The exported subpaths are `./products/mpp-workspace`, `./products/mpp-workspace/client`, `./products/mpp-workspace/managed` and `./products/mpp-workspace/channel`. Direct source imports use the corresponding `.mjs` files.

Use `starforge mpp-workspace channel … --dir "$MPP_PRODUCT"` to attach to the current product. `starforge mpp-channel … --workspace "$MPP_WORKSPACE"` operates its stopped native workspace directly. Both paths retain the same channel records and original workspace lease.

All product files and the composed native source retain their original MIT license.
