# Operate the complete native CoCart receiving workflow

This folder starts an owned PHP/MariaDB/WordPress/WooCommerce store, installs the selected original CoCart release and the existing SF104 gateway, then runs the original SDK and browser through a real cart, checkout, Woo order, buyer handoff and receiving workspace. The main [customer guide](../README.md) covers installation into a merchant's existing store and the application's everyday operation.

## Runtime and source selection

Use Python 3, Node 22 or newer, Playwright with an installed Chromium executable, and the retained PHP 8.3/MariaDB runtime layout. The runtime directory supplied as `--php-runtime` contains `root/usr/bin/php8.3`, `root/usr/bin/mariadb`, `root/usr/sbin/mariadbd`, `root/usr/bin/mariadb-install-db`, the corresponding libraries, and `downloads/wp-cli.phar`.

Select the actual original archives and source tree:

| Input | Selected source |
| --- | --- |
| WordPress | Original WordPress 7.1.3 archive, with the wordpress/ root |
| WooCommerce | Original installed 11.2.1 directory via --woocommerce-directory, or an original archive via --woocommerce-zip |
| CoCart Community | Commit 6a3a613936c1abc1d5d8b78cc920d862b1ae542d, plugin 4.9.7 |
| CoCart SDK | Original @cocartheadless/sdk 1.2.1 package |
| SF104 gateway | The eleven plugin files listed by native-runtime.py at commit 8bc1c6168fce0392f74bfea8b7d0efd387cd48f2 |
| Headless application | The complete parent cocart/ directory published with this runtime |

The CoCart archive SHA-256 is `3165184e7a50eafc82f499e1091e55ede447ce1ebd35f759e99efa6cb28e8102`. The SDK package SHA-256 is `dda3aa36e2163dfe4e4febbfbde64b55d38db4e8b161e939e0c4bcd63ec9fec8`. The runtime checks these complete original bytes, each selected gateway Git blob, and the original CoCart archive's export-ignore rules. An installed WooCommerce directory is copied into the new instance with a complete file hash manifest.

The selected development product and payment terms are in `selected-mapping.json`. Its source locators identify the original development terms. Native product creation records the actual new product, approving local operator and approval timestamp. For a different merchant, use their saved approved product through the main customer workflow.

## Run the owned store and browser together

Use an empty owned runtime root and a durable checkpoint directory. In a runtime where /dev belongs to one tool invocation, start, operate, export and close the instance within that same invocation. Retain the complete output before that invocation exits.

Create a command JSON using the actual installed Node, source, Chromium and module paths:

~~~json
{
  "operation": "run",
  "requestId": "cocart-native-customer-receiving",
  "timeout": 600,
  "argv": [
    "/installed/node/bin/node",
    "--max-old-space-size=192",
    "/checkout/stellar/scf-starforge-20261009/sf104-woocommerce-merchant-bridge/cocart/native/native-receiving.mjs",
    "--chromium",
    "/installed/chromium/chrome-headless-shell",
    "--node-modules",
    "/installed/node_modules"
  ]
}
~~~

The runtime passes its actual product/profile, original SDK entry, PHP transport origin and private administrative credentials directly to the child process. Preserve the real paths when preparing the command file.

~~~sh
python native-runtime.py \
  --root /private/cocart-native-store \
  --php-runtime /installed/woo-runtime \
  --wordpress-zip /retained/wordpress-7.1.3.zip \
  --woocommerce-directory /retained/woocommerce-11.2.1 \
  --cocart-zip /retained/cocart-community-6a3a613936c1.zip \
  --sdk-tgz /retained/cocartheadless-sdk-1.2.1.tgz \
  --bridge-source /checkout/stellar/scf-starforge-20261009/sf104-woocommerce-merchant-bridge \
  --source-pins sf104-source-pins.json \
  --cocart-pins cocart-source-pins.json \
  --cocart-attributes cocart.gitattributes \
  --seed-source selected-mapping.json \
  --origin https://cocart.sf104.test \
  --command-json /private/cocart-receiving-command.json \
  --checkpoint-dir /private/cocart-receiving-output
~~~

The canonical merchant identity is the selected HTTPS .test origin. The owning native runtime exposes a distinct loopback HTTP transport, records that binding, and serves WordPress's original routes. Browser requests go to that actual PHP store while retaining the original merchant URLs and native responses.

A fresh WordPress bootstrap runs the native `wp rewrite structure /%postname%/` command before product/profile export. This keeps the real exported checkout URL consistent with WordPress's saved permalink configuration and the subsequent checkout request.

The MariaDB instance binds to its own ephemeral loopback TCP port. PHP sessions, uploads and runtime temporary files live under the owned root. The source installs local receiving controls for mail, updates and scheduled background work. Native children are closed when the owning runtime exits.

## Original browser operation and recovery

The operation opens the actual catalog, creates a guest cart, adds the selected product, calculates and changes quantities, removes and restores the item, clears the cart, and adds it again. The saved one-product mapping admits quantity one at USD 2.50. Its quantity-two cart is visibly ineligible at USD 5.00.

The browser then changes quantity to one, prepares an explicit replacement checkout, transfers the guest cart through the original `CoCart_Load_Cart` implementation, completes the native Woo form, and downloads the order's exact buyer-handoff JSON. The application validates that file through the existing SF104 buyer module, attaches it to the original cart operation and exports the complete receiving workspace.

The receiving driver records its checkout dispatch before the Place order click. On continuation, it resolves the existing result from the same operation. To resume an interrupted operation whose owned store still exists, use the same root with `--reopen`, the same PHP runtime, command file and checkpoint directory. Original prepared requests, cart IDs and progress are retained. Inspect the saved native response and order state when an interrupted dispatch has no completed response.

The downloaded receiving workspace is imported into a new destination. A fresh browser opens it at 390 pixels, preserving the same revision, native response objects and Woo handoff. Subsequent customer continuation uses the original saved store profile and the transport binding chosen by its operator.

## Complete output and completed native run

`CoCart_Native_Receiving_Output.zip` contains the native product/profile and final Woo order snapshots, original application objects and receiving export, operating source identities, browser captures, progress and native PHP logs. `Runtime_State.json` records the final operation status and child-process closure. Keep the archive with the original customer's receiving materials.

The completed operation on 12 October 2026 used WordPress 7.1.3, WooCommerce 11.2.1, CoCart 4.9.7 and SDK 1.2.1. It created native product 12 and Woo order 13 on attempt one; completed sixteen workflow steps and eight cart operations; retained twenty-seven native cart snapshots; downloaded the 858-byte original buyer handoff; and received forty-eight complete objects in a 309,276-byte workspace. A fresh 390-pixel browser reopened the same workspace revision without page errors or horizontal overflow.

The exact completed output is 1,029,868 bytes, SHA-256 `5d6d10c830df56c4874a5746129be2d7bbf1fc18326fc50c84f53e18a1470976`. The original CoCart commercial case carries its complete receiving materials, proposed customer workshare and native production plan. Use the existing [gateway operation](../../OPERATIONS.md) for the joined buyer payment, merchant fulfilment and refunds.
