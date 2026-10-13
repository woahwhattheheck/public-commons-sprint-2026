# Hive Routing Workbench

Review a complete GraphQL application's routing edition, run every agreed client operation on its selected Hive Router, compare a changed edition, choose the accepted deployment and deliver the whole editable workspace to another operator. This package includes the maintained original application, managed Applications, customer-agent tools, Installation work orders and the source needed to continue that work.

## Customer workflow

1. Import a complete edition: router configuration, supergraph, every client operation and supporting source files.
2. Review the original router features and record explicit retain, changed or needs-work decisions.
3. Prepare and start the selected original Hive deployment; run the complete agreed client programme with its retained request IDs.
4. Open the full native responses, compare the changed edition, and explicitly choose cutover or rollback.
5. Export the complete project, independently receive its history and artifacts, and cold reopen both original and receiving workspaces.

The original reference uses the genuine Hive accounts, inventory, products and reviews subgraphs, with twenty client operations in each of initial, changed and rollback phases. Its sixty complete response bodies belong to the existing reference operation. The embedded upstream selection contains the source relevant to the workbench and fixture; building that fixture requires the full pinned upstream checkout described in the original reference guide.

## Build and install the selected product

From the exact selected public checkout, use the maintained builder with Node 24:

```sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo . --ref HEAD --selection hive-routing-workbench \
  --out /absolute/private/packages/hive-routing-workbench
```

The builder records the immutable source commit. Retain its actual returned package archive and manifest. An interrupted build resumes in the same output directory with the same selection and original source pin using `--resume`.

In a separate customer installation directory:

```sh
npm install --ignore-scripts --offline --omit=optional /absolute/returned-package.tgz
npx --no-install starforge source
npx --no-install starforge registrations --source hive-routing-workbench
```

Use the archive actually returned by the builder. This installs the selected source package. The [Runtime installation guide](source/stellar/scf-starforge-20261009/distribution/RUNTIME_INSTALL.md) explains optional host features and the existing Installation Runtime Workspace. Prepare the original Hive/Python runtime separately as described below.

## Open the complete installed guides

These paths are relative to this package-root README.

| Task | Guide or original source |
| --- | --- |
| Configure Applications and operate editions, native results, cutover and delivery | [Operating guide](source/products/hive-routing-workbench/OPERATING.md) |
| Prepare, inspect, export and independently receive the native installation | [Preparation](source/products/hive-routing-workbench/PREPARING.md) |
| Continue the sole original reference and whole installed/browser course | [Receiving](source/products/hive-routing-workbench/RECEIVING.md) |
| Use the original standalone operator | [Original operator](source/products/hive-routing-workbench/workbench/OPERATING.md) |
| Select the full pinned fixture source and its existing build | [Reference source and receiving](source/products/hive-routing-workbench/workbench/reference/README.md) |
| Inspect all 64 maintained source files and declared maintenance | [Original-source manifest](source/products/hive-routing-workbench/original-source.json) |
| Review managed Application configuration and ownership | [Applications](source/stellar/scf-starforge-20261009/distribution/runtime-workspace/APPLICATIONS.md) |
| Configure host-selected customer-agent tools | [Merchant tools](source/stellar-forge/mcp-merchant-operator/README.md) |
| Commission the customer installation | [Installation work order](source/stellar/scf_2026/sf49_data_commissioning/installation-workorders/hive-routing-workbench.json) |
| Read complete customer scope and original source attribution | [Grant chapter](source/stellar-forge/developer-site/GRANT_HIVE_ROUTING_WORKBENCH.md) |

## Prepare the original runtime

Use a compatible Linux x64 or arm64 host, Node 24, and an existing canonical Python 3.11 or later with standard venv/ensurepip support. Keep immutable package source, customer workspace, native preparation and private launch/connection files separate.

```sh
starforge hive-routing-workbench-prepare prepare \
  --directory /absolute/private/hive-preparation \
  --python /absolute/canonical/python3 \
  --router /absolute/retained/hive_router_linux_amd64 \
  --wheel /absolute/retained/PyYAML-6.0.3-compatible.whl

starforge hive-routing-workbench-prepare inspect \
  --result /absolute/private/hive-preparation/PREPARED.json \
  --python /absolute/canonical/python3
```

The example selects the Linux x64 executable; use the actual matching architecture and wheel. The original Hive Router version is 0.3.4 and the maintained Python dependency is PyYAML 6.0.3. Supplying the exact retained router and wheel supports offline preparation. Omitting those optional arguments selects the documented original official acquisition route.

Preparation retains independent primary and receiving installations, complete dependency/source identities and a portable runtime archive. Use the actual returned `applicationDirectory`, `runtimeReadyFile`, `python` and `router` fields; environments are created in their final locations. The full preparation guide gives same-request continuation and independent receive commands.

## Start, stop and continue the installed application

In the existing Runtime Workspace, choose **Hive Routing Workbench**, select the private launch configuration from the operating guide, review and save it, complete its connection and start the original observer. The public receiver waits for the actual `connectionReady` result before Start. Open the returned loopback URL.

Applications Stop closes its owned listener and joins real request handlers. Native routers are independently owned original workers: use the original explicit native Stop control and read its actual closure when stopping one. A retained deployment from an earlier installation remains historical until a receiving-host preparation establishes its own native identity.

| Installed command | Work performed |
| --- | --- |
| `starforge hive-routing-workbench` | Operate the selected original private workspace through its managed listener |
| `starforge hive-routing-workbench-prepare` | Prepare, inspect, export and independently receive the original runtime |
| `starforge hive-routing-workbench-managed` | Own the original listener under Applications |
| `starforge hive-routing-workbench-receive` | Continue the original sixty-response reference and installed agent/browser receiving |

The registered Hive Merchant provider carries all **21 customer-agent tools**, full original request/effect recovery and complete file reads. Retain the same request, actor, source, runtime, operation and owner when resuming interrupted work.

## Original source and receiving

This public selection retains the complete 64-file application and its original licenses. Sixty-three bodies match the current Merchant application exactly; the browser adds a narrow review-form correction that preserves the displayed revision during background refresh. The original Python transaction rejects stale decisions. The manifest retains both earlier server/stopped-router maintenance and the exact preimage and postimage of this correction. The upstream router source pin is `28eafc1bceb3dce8600d0eeea2ce2c2ec9563bb6`. Source provenance remains in the original manifest; current public Runtime, Applications, Merchant and common Grant implementations supply the installed interfaces.

The existing `HIVE-APPLICATION-MIGRATION-0C7A-20261012` operation retains its original fixture/controller44900. The installed receiving command adopts its complete `--reference-result`, or resumes its exact retained `--reference-request` with the same source, Python, ports, router and native lease. It preserves all sixty responses, source/history archives, latest agent/browser decisions and both cold reopens.

Source publication makes the complete implementation available. Before presenting a customer-ready result, the producing owner must run/render the exact outgoing edition, personally look at desktop and narrow populated/empty/loading/error views, operate important controls and downloads, extract and open every outgoing archive/project and attachment, and reopen the delivered workspaces. Captured screenshots, source review and successful artifact writes alone do not establish that result. The complete receiving guide carries this original course and the full standing inspection instruction.

Build and source repository: [public-commons-sprint-2026](https://github.com/woahwhattheheck/public-commons-sprint-2026). Original router license: [MIT](source/products/hive-routing-workbench/workbench/upstream/router/LICENSE_MIT).
