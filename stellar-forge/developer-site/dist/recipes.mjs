// MIT. Original Stellar Forge onboarding recipes.
// Composed from ASTRA26B1’s eight-path contribution; source identity is retained below.
// The seller, buyer and agent records preserve 543F’s current native setup commands.
// No browser network request, payment operation or credential handling occurs here.

export const ROLES = Object.freeze({
  "seller": {
    "meta": "NATIVE MERCHANT WORKSPACE",
    "title": "Run the workspace you prepared.",
    "description": "Install the maintained source archive and launch the exported workspace with the original seller and operations dashboard.",
    "checklist": [
      "Download and extract your configured workspace above.",
      "Install the local toolkit archive with Node.js 22.16 or later.",
      "Run the workspace and open the two printed local URLs."
    ],
    "docs": "https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/stellar/scf-starforge-20261009/distribution/README.md",
    "label": "TERMINAL / YOUR MERCHANT WORKSPACE",
    "command": "# From the parent of your extracted merchant directory:\nnpm install --ignore-scripts --offline --omit=optional \\\n  /absolute/path/to/the-package.tgz\nnpx --no-install starforge doctor\nnpx --no-install starforge run --workspace ./merchant -- --port 0\n\n# Open the seller URL + /_seller/docs\n# Open the separate operations URL printed at startup.",
    "result": "The original seller loads your JSON files and advertises every configured resource. Unpaid requests return native HTTP 402 challenges; the operations view tracks the running service."
  },
  "woo": {
    "meta": "SF104 / WOOCOMMERCE CHECKOUT",
    "title": "Connect a WooCommerce digital product.",
    "description": "Import the native route exported from a saved Woo product at /woo.html, review its exact terms and download a complete merchant setup packet.",
    "checklist": [
      "Open WooCommerce setup from the navigation and import the saved product route JSON.",
      "Review the shop, seller, native facilitator and private service directory; download and extract the packet.",
      "Prepare the original plugin and native merchant, then follow the included buyer, delivery and release instructions."
    ],
    "docs": "https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/stellar/scf-starforge-20261009/sf104-woocommerce-merchant-bridge/GATEWAY.md",
    "label": "TERMINAL / EXTRACTED WOO SETUP PACKET",
    "command": "# Open /woo.html, import the shop's saved route exports,\n# then download and extract the reviewed setup packet.\n# Run from that extracted directory with the complete original toolkit:\nTOOLKIT=/absolute/path/to/checkout-or-installed-package\nnode merchant.mjs prepare --toolkit \"$TOOLKIT\"\nnode merchant.mjs inspect --toolkit \"$TOOLKIT\"\n\n# Install the generated original plugin folder in WordPress.\n# Define the WordPress PHP constant SF98_WEBHOOK_SECRET in wp-config.php.\n# Supply the same private value in both Node service environments.\n# Then follow README.md / BUYER.md for ingress and native operation:\nnode merchant.mjs preflight --toolkit \"$TOOLKIT\"\nnode merchant.mjs serve --toolkit \"$TOOLKIT\"\n# In a separate terminal:\nnode merchant.mjs deliver --toolkit \"$TOOLKIT\"",
    "result": "The original gateway creates an unpaid order and private buyer handoff. Native settlement is delivered to the same Woo review queue; the merchant's original release action completes the order and enables Woo download permissions."
  },
  "buyer": {
    "meta": "SF88 / NATIVE BUYER WORKSPACE",
    "title": "Prepare a buyer for the selected merchant.",
    "description": "Use an existing merchant review configuration to create the original private buyer workspace, then review its terms and diagnose setup.",
    "checklist": [
      "Follow the buyer guide to prepare the actual merchant review JSON.",
      "Initialize a new private workspace with your existing testnet public payer address.",
      "Review and diagnose the workspace before choosing execution."
    ],
    "docs": "https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/README.md",
    "label": "TERMINAL / BUYER SETUP AND REVIEW",
    "command": "git clone --depth 1 \\\n  https://github.com/woahwhattheheck/public-commons-sprint-2026.git\ncd public-commons-sprint-2026\n\nnpm --prefix stellar/scf-starforge-20261009/sf88-operator-buyer-cli \\\n  ci --ignore-scripts --no-audit --no-fund\n\nnode stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs \\\n  --init-workspace --config /private/chosen-merchant-review.json \\\n  --dir /private/merchant-operator --actor owner-operator \\\n  --service chosen-merchant --payer ACTUAL_TESTNET_PUBLIC_ADDRESS \\\n  --python /usr/bin/python3\nnode stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs \\\n  --review-workspace --dir /private/merchant-operator\nnode stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs \\\n  --diagnose-workspace --dir /private/merchant-operator",
    "result": "A private native workspace using the original buyer, signer setup, spend governor and retained evidence. These commands set up, review and diagnose; the guide supplies the deliberate execution step. Python 3.11+ is also required."
  },
  "agent": {
    "meta": "MCP / PERSISTENT OPERATOR WORKSPACE",
    "title": "Connect agents to the original commerce tools.",
    "description": "Run the maintained MCP service with a trusted catalog, selected seller origins and persistent quote state. Keep the existing access token in the operator environment.",
    "checklist": [
      "Select the actual catalog and seller origins in trusted host configuration.",
      "Set a new private state directory and start the original MCP server.",
      "Use search, describe, preview and retained history; configure native approval/signing in the original operator module."
    ],
    "docs": "https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/stellar-forge/mcp-paid-agent/DURABILITY.md",
    "label": "TERMINAL / PERSISTENT MCP SERVER",
    "command": "git clone --depth 1 \\\n  https://github.com/woahwhattheheck/public-commons-sprint-2026.git\ncd public-commons-sprint-2026\n\nexport BAZAAR_DISCOVERY_URL=https://your-trusted-catalog.example\nexport PAID_RESOURCE_ORIGINS=https://your-approved-seller.example\nexport MCP_STATE_DIR=/private/commerce/mcp-quotes\n# Keep the existing MCP_ACCESS_TOKEN in this environment.\nnode stellar-forge/mcp-paid-agent/serve.mjs\n\n# Later, read retained quote history from another terminal:\nnode stellar-forge/mcp-paid-agent/history.mjs \\\n  --state-dir /private/commerce/mcp-quotes --format json",
    "result": "The original server listens on loopback port 3210 and retains quote history in built-in SQLite. Its trusted host adapter supplies actual approve/signPayment callbacks when configured. The same quote IDs and interrupted-operation history survive restart."
  },
  "dataset": {
    "meta": "JSON DATASET / LOCAL TOOLKIT",
    "title": "Start a dataset merchant.",
    "description": "Create an editable dataset workspace using the maintained local source archive.",
    "checklist": [
      "Use Node.js 22.16 or later and the supplied toolkit archive.",
      "Replace the starter rows in merchant/data/catalog.json and set the actual merchant terms in seller.json.",
      "Keep the whole merchant directory, including its private working files, when upgrading the toolkit."
    ],
    "docs": "https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/stellar/scf-starforge-20261009/distribution/README.md",
    "label": "TERMINAL / NEW DATASET WORKSPACE",
    "command": "npm install --ignore-scripts --offline --omit=optional \\\n  /absolute/path/to/the-package.tgz\nnpx --no-install starforge doctor\nnpx --no-install starforge init --dir ./merchant --template dataset\n\n# Edit merchant/data/catalog.json and merchant/seller.json.\nnpx --no-install starforge run --workspace ./merchant -- --port 0",
    "result": "The original seller and operations dashboard print their local addresses. The starter uses demonstration terms and returns native HTTP 402; configure the actual recipient, asset, prices and native facilitator through the maintained guide."
  },
  "application": {
    "meta": "NODE APPLICATION / ORIGINAL SELLER",
    "title": "Connect your Node application.",
    "description": "Create a persistent application workspace around the original seller lifecycle.",
    "checklist": [
      "Use the complete source checkout with Node.js 22.16 or later.",
      "Edit merchant/application.mjs to call the application and define its public resource terms in seller.json.",
      "Keep the merchant directory and use its original operations dashboard for the running service."
    ],
    "docs": "https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/stellar/scf-starforge-20261009/distribution/README.md",
    "label": "TERMINAL / NEW APPLICATION WORKSPACE",
    "command": "git clone --depth 1 \\\n  https://github.com/woahwhattheheck/public-commons-sprint-2026.git\ncd public-commons-sprint-2026\n\nnode stellar/scf-starforge-20261009/distribution/cli.mjs doctor\nnode stellar/scf-starforge-20261009/distribution/cli.mjs init --dir ../merchant --template application\n\n# Edit ../merchant/application.mjs and ../merchant/seller.json.\nnode stellar/scf-starforge-20261009/distribution/cli.mjs run --workspace ../merchant -- --port 0",
    "result": "The original seller invokes the trusted application handler through its existing request and payment lifecycle. Startup prints seller and operations URLs. The maintained guide supplies the native payment dependencies and configured facilitator options."
  },
  "api": {
    "meta": "OPENAPI / NATIVE MERCHANT WORKSPACE",
    "title": "Turn your existing API into a paid service.",
    "description": "Review an original OpenAPI document, choose operations and backend bindings, then save and reopen the native merchant package.",
    "checklist": [
      "Use Node.js 22+ and keep a private project directory outside the checkout.",
      "Load the original OpenAPI JSON, select operations, set public terms and map backend authentication to existing environment-variable names.",
      "Validate, save a new package, start the challenge preview and open operations. Keep RUN.md and the original saved inputs for later launches."
    ],
    "docs": "https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/stellar/scf-starforge-20261009/sf61-openapi-seller-import/workspace/README.md",
    "label": "TERMINAL / API MERCHANT WORKSPACE",
    "command": "git clone --depth 1 \\\n  https://github.com/woahwhattheheck/public-commons-sprint-2026.git\ncd public-commons-sprint-2026\n\n# Choose a new private directory outside the checkout.\nmkdir -m 700 /private/api-projects\nnode stellar/scf-starforge-20261009/sf61-openapi-seller-import/workspace/server.mjs \\\n  --out-parent /private/api-projects --port 0",
    "result": "Open the complete local URL printed at startup. The workspace uses the original SF61 compiler, SF30 upstream seller, SF82 package and SF96 operations. Supported GET, HEAD and JSON POST backends need no custom handler; credential values remain in the host environment."
  },
  "postgres": {
    "meta": "POSTGRESQL / QUERY WORKSPACE",
    "title": "Choose the database fields you want to sell.",
    "description": "Use the existing database role and native metadata browser to select public columns, filters, ordering and merchant terms.",
    "checklist": [
      "Use Node.js 22.16+ and install the original pinned PostgreSQL adapter.",
      "Prepare the private source declaration using the PostgreSQL guide and the existing read-only database connection environment.",
      "Review actual metadata and a selected query, export a new private package, then use its generated START instructions with the original seller."
    ],
    "docs": "https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/workspace/README.md",
    "label": "TERMINAL / POSTGRESQL MERCHANT WORKSPACE",
    "command": "git clone --depth 1 \\\n  https://github.com/woahwhattheheck/public-commons-sprint-2026.git\ncd public-commons-sprint-2026\n\ncd stellar/scf-starforge-20261009/sf30-seller-sdk\nnpm ci --prefix postgres --omit=dev --ignore-scripts --no-audit --no-fund\n\n# Point to your existing private connection/source declaration.\nnode postgres/workspace/server.mjs \\\n  --source /private/existing-source.json \\\n  --output /private/merchant-packages",
    "result": "The original workspace reads the configured database catalog, validates the selected projection and exports source.json, service.json and launch guidance. Saved packages preserve the original database role and source limits; a changed schema requires a new selection and review."
  },
  "s3": {
    "meta": "S3 / PRIVATE OBJECT DELIVERY",
    "title": "Offer an existing private file or dataset.",
    "description": "Pin selected object versions into the original whole-file or chunked seller workflow.",
    "checklist": [
      "Use Node.js 22+ and the original S3 adapter with the existing deployment role or credential environment.",
      "Prepare the private source and public payment JSON using the S3 guide, including exact object selections.",
      "Generate the release on its deployment host, start the original handlers, and retain the original source/service/objects files."
    ],
    "docs": "https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/stellar/scf-starforge-20261009/sf30-seller-sdk/s3/README.md",
    "label": "TERMINAL / S3 MERCHANT RELEASE",
    "command": "git clone --depth 1 \\\n  https://github.com/woahwhattheheck/public-commons-sprint-2026.git\ncd public-commons-sprint-2026\n\nnpm ci --ignore-scripts --no-audit --no-fund \\\n  --prefix stellar/scf-starforge-20261009/sf30-seller-sdk/s3\n\n# Use your prepared source and public merchant terms.\nnode stellar/scf-starforge-20261009/sf30-seller-sdk/s3/cli.mjs configure \\\n  --source /private/merchant/source.json \\\n  --payment /private/merchant/public-payment-terms.json \\\n  --origin https://downloads.your-merchant.example \\\n  --directory /private/merchant/release-001\n\nnode stellar/scf-starforge-20261009/sf30-seller-sdk/serve.mjs \\\n  --config /private/merchant/release-001/service.json \\\n  --handlers /private/merchant/release-001/handlers.mjs",
    "result": "Configuration reads selected object metadata and pins size, ETag and version where available. The original seller uses its native challenge/payment lifecycle. Each configured chunk is a separate request; the maintained objects descriptor connects to the original complete-object buyer workflow."
  },
  "python": {
    "meta": "PYTHON / NATIVE BUYER APPLICATION",
    "title": "Use retained purchases from Python.",
    "description": "Import an existing operator request into the maintained Python package, review it through SF88, and recover its saved result in the application.",
    "checklist": [
      "Use Python 3.11+ on Linux or macOS with the full current checkout and its original Node runtime.",
      "Keep the private buyer state outside the installed package. Import the original operator JSON with its stable intent ID.",
      "Review the printed intent. The existing operator terminal owns execution; the application can reopen the same operation and consume retained JSON, CSV or binary results."
    ],
    "docs": "https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python/README.md",
    "label": "TERMINAL / PYTHON BUYER SETUP",
    "command": "git clone --depth 1 \\\n  https://github.com/woahwhattheheck/public-commons-sprint-2026.git\ncd public-commons-sprint-2026\n\nnpm --prefix stellar/scf-starforge-20261009/sf88-operator-buyer-cli \\\n  ci --ignore-scripts --no-audit --no-fund\npython3 -m venv .venv\n. .venv/bin/activate\npython3 -m pip install ./stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python\nexport STELLAR_FORGE_CHECKOUT=\"$PWD\"\n\nstellar-forge-buyer --state /private/data-buyer \\\n  import /private/merchant-order.json\n# Use the intent ID printed by import.\nstellar-forge-buyer --state /private/data-buyer \\\n  review YOUR_EXISTING_INTENT",
    "result": "The package retains the original request and durable operation state. Native review, signer configuration, operator policy and approval stay with SF88. Buyer.operation(intent).recover() reads a saved outcome locally; result.json(), result.csv_rows() and result.open() consume the retained response."
  },
  "release": {
    "meta": "SF82 / MERCHANT RELEASES",
    "title": "Keep configuration changes and rollbacks together.",
    "description": "Stage an existing API workspace, inspect changes, select a release for the next start and manage it through the original release console.",
    "checklist": [
      "Use the full source checkout with Node.js 22+ and a saved native API project.",
      "Create a new private release store. Stage the project and inspect its exact route, price, backend and application changes.",
      "Use the current selection generation when activating later releases; the console distinguishes selected and running versions."
    ],
    "docs": "https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/stellar/scf-starforge-20261009/sf82-seller-pilot/RELEASES.md",
    "label": "TERMINAL / FIRST RELEASE AND CONSOLE",
    "command": "git clone --depth 1 \\\n  https://github.com/woahwhattheheck/public-commons-sprint-2026.git\ncd public-commons-sprint-2026\n\nnode stellar/scf-starforge-20261009/sf82-seller-pilot/release-cli.mjs init \\\n  --store /private/merchant-releases\nnode stellar/scf-starforge-20261009/sf82-seller-pilot/release-cli.mjs stage \\\n  --store /private/merchant-releases --id api-first \\\n  --workspace /private/api-project --port 0\nnode stellar/scf-starforge-20261009/sf82-seller-pilot/release-cli.mjs diff \\\n  --store /private/merchant-releases --to api-first\n\n# For this newly created store, after reviewing the diff:\nnode stellar/scf-starforge-20261009/sf82-seller-pilot/release-cli.mjs activate \\\n  --store /private/merchant-releases --id api-first \\\n  --expect 0 --reason \"Initial reviewed API release\"\nnode stellar/scf-starforge-20261009/sf82-seller-pilot/release-cli.mjs console \\\n  --store /private/merchant-releases --port 8425",
    "result": "The native release store retains the original compiler output and source snapshots. Use the console to start the selected seller and inspect operations. Selecting a changed release takes effect on the next start; retained releases support the original guarded rollback workflow."
  },
  "commerce": {
    "meta": "SF66 / PERSISTENT COMMERCE SESSION",
    "title": "Run the prepared merchant and buyer together.",
    "description": "Compose the existing merchant, configured facilitator, operations dashboard and retained buyer inbox in one foreground session.",
    "checklist": [
      "Use Node.js 22.16+ and Python 3.11+ on the operator’s POSIX host.",
      "Follow the commerce guide to install its native dependencies and prepare the actual seller, facilitator and buyer files.",
      "Save a commerce plan with those exact private paths, initialize a new session directory and retain it across restarts."
    ],
    "docs": "https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/stellar/scf-starforge-20261009/sf66-demo-launcher/COMMERCE.md",
    "label": "TERMINAL / SAVED MERCHANT SESSION",
    "command": "git clone --depth 1 \\\n  https://github.com/woahwhattheheck/public-commons-sprint-2026.git\ncd public-commons-sprint-2026\n\n# Install native dependencies and prepare the plan using COMMERCE.md.\nnode stellar/scf-starforge-20261009/sf66-demo-launcher/commerce-cli.mjs init \\\n  --plan /private/commerce-plan.json \\\n  --directory /private/merchant-session\nnode stellar/scf-starforge-20261009/sf66-demo-launcher/commerce-cli.mjs start \\\n  --directory /private/merchant-session",
    "result": "The session starts the original seller, facilitator and operations, then displays the original buyer inbox. Selected purchases continue through the native operator flow. Later inspect/start commands reopen the same retained session instead of creating another workspace."
  },
  "duckdb": {
    "meta": "DUCKDB / PARQUET MERCHANT",
    "title": "Prepare a merchant from your approved analytics source.",
    "description": "Join a reviewed public merchant plan to the existing private DuckDB or Parquet declaration and create a portable native seller package.",
    "checklist": [
      "Use the DuckDB guide’s Node/Python setup and pinned virtual environment. Keep the approved source files stable while copying.",
      "Prepare the public plan with deliberate examples, actual merchant terms and the exact approved query names.",
      "Inspect the selected copy, prepare a new package under an existing private parent, and run its original launcher. Keep the complete package private."
    ],
    "docs": "https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/stellar/scf-starforge-20261009/sf30-seller-sdk/duckdb/PREPARE.md",
    "label": "TERMINAL / PREPARED DUCKDB MERCHANT",
    "command": "git clone --depth 1 \\\n  https://github.com/woahwhattheheck/public-commons-sprint-2026.git\ncd public-commons-sprint-2026\n\ncd stellar/scf-starforge-20261009/sf30-seller-sdk\nnode duckdb/prepare-cli.mjs inspect \\\n  --source /private/data/source.json \\\n  --plan /private/merchant-plan.json\nnode duckdb/prepare-cli.mjs prepare \\\n  --source /private/data/source.json \\\n  --plan /private/merchant-plan.json \\\n  --directory /private/releases/merchant-001 \\\n  --python /private/duckdb-venv/bin/python\nnode /private/releases/merchant-001/launch.mjs \\\n  --python /private/duckdb-venv/bin/python \\\n  --port 8423 --operations-port 8424",
    "result": "Preparation copies only declared datasets, uses the original reader for native preflight and exports the original service, OpenAPI and customer client. Launch verifies the saved package and reuses SF30. Public metadata contains selected examples and column/parameter definitions; SQL, defaults and actual data stay private."
  },
  "archive": {
    "meta": "LOCAL DISTRIBUTION / SOURCE CHECKOUT",
    "title": "Build the toolkit archive from maintained source.",
    "description": "Create the original local npm-compatible release archive for installation beside a merchant workspace.",
    "checklist": [
      "Use the complete source checkout and Node.js 22.16+.",
      "Choose a new release directory and build from the checked-out source revision.",
      "Install the produced .tgz from a separate application directory, then use the seller, dataset or application recipe."
    ],
    "docs": "https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/stellar/scf-starforge-20261009/distribution/README.md",
    "label": "TERMINAL / LOCAL TOOLKIT RELEASE",
    "command": "git clone --depth 1 \\\n  https://github.com/woahwhattheheck/public-commons-sprint-2026.git\ncd public-commons-sprint-2026\n\nnode stellar/scf-starforge-20261009/distribution/build.mjs \\\n  --out /absolute/new-release-directory --ref HEAD\n\n# Use the archive path printed by the build.\ncd /absolute/path/to/your-application\nnpm install --ignore-scripts --offline --omit=optional \\\n  /absolute/path/to/the-package.tgz\nnpx --no-install starforge doctor",
    "result": "The maintained builder creates the local toolkit archive and release metadata. This is a private npm-compatible source distribution; a public registry publication is not required. Keep application workspaces outside the installed toolkit directory."
  }
});

export const RECIPE_SOURCE = Object.freeze({
  "original_site_source": "845eafe472f15a04b0ada64fcba4a078008897fc",
  "contributor": "ASTRA26B1",
  "canvas_id": "F0C8DGW2RDY",
  "archive_bytes": 47089,
  "archive_sha256": "e5558da845cb73fce8547dc3714ef6c14ee9c2aee5d83efcd5dfdd4e5ff39393",
  "source_module": "dist/setup.mjs",
  "source_module_sha256": "534df8b73ac8e0bb147b93e223c781c979dfbee750fb8cab566529df7b49eb0b",
  "composed_by": "SCF-FRONTDOOR-543F",
  "reconciled_at": "2026-10-11",
  "primary_source_blobs": [
    {
      "path": "stellar/scf-starforge-20261009/sf30-seller-sdk/s3/README.md",
      "sha": "89bf27a25eaffd0b1ef6caa60daa4dffdaa59599"
    },
    {
      "path": "stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python/README.md",
      "sha": "55c60e1925876d2ab83ed12c237306109f7c0612"
    },
    {
      "path": "stellar/scf-starforge-20261009/sf82-seller-pilot/RELEASES.md",
      "sha": "06ea5b675bf9aca2e5906af45a865912f74c6663"
    },
    {
      "path": "stellar/scf-starforge-20261009/distribution/README.md",
      "sha": "8f29dee6345b2ea5a5398bd4a854438af5fbccbc"
    },
    {
      "path": "stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/workspace/README.md",
      "sha": "36305ddb28c33861684b90a5ce567a16afdae604"
    },
    {
      "path": "stellar/scf-starforge-20261009/sf61-openapi-seller-import/workspace/README.md",
      "sha": "98e62773829a8e0c246b41cd0a86b5caa37bfa8e"
    },
    {
      "path": "stellar/scf-starforge-20261009/sf66-demo-launcher/COMMERCE.md",
      "sha": "12c54cbc90234b7b44291e99de248f7f01936f3d"
    },
    {
      "path": "stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/README.md",
      "sha": "a168f0c37bfd34be5c1465de2f98ab17da7470c0"
    }
  ]
});
