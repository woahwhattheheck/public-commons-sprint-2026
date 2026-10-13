# Collaborative Document Workbench

Collaborative Document Workbench provides a complete document service for a team or customer: original document intake, reviewed migration, tenant and document permissions, shared editing, offline work, durable storage, checkpoints, recovery and an editable handover. The browser and customer agent use the same application and history.

This selected package contains the complete original 50-file workbench, its pinned Hocuspocus, Tiptap and Yjs source and dependency records, the managed Applications adapter, 23 Merchant tools, Installation workorder and operating guides. The original native application remains under `source/products/collaborative-documents/workbench/`.

## Build and install the selected product

Use the intended immutable commit of [the public source repository](https://github.com/woahwhattheheck/public-commons-sprint-2026). The complete product selection is `collaborative-documents`.

```sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/checkout --ref ORIGINAL_COMMIT \
  --selection collaborative-documents \
  --out /absolute/packages/collaborative-documents
```

Retain the builder's returned package archive, source commit, manifest and archive SHA-256 together. Install that actual archive in the intended application directory:

```sh
npm install --ignore-scripts --offline --omit=optional /absolute/path/to/returned-package.tgz
npx --no-install starforge source
npx --no-install starforge registrations --source collaborative-documents
```

Use `npx --no-install starforge` for the commands below when the package executable directory is not already on PATH. The [source-selection guide](./source/stellar/scf-starforge-20261009/distribution/SOURCE_SELECTIONS.md) covers the original build and continuation operations.

The generic Merchant package and the original document runtime are separate complete outputs. Prepare the selected application with **Node 24**, the actual npm and Python executables, and its original pinned dependencies. The [full preparation guide](./source/products/collaborative-documents/PREPARING.md) covers acquisition, interrupted preparation, portable export and independent receiving.

```sh
starforge collaborative-documents-prepare prepare \
  --directory /absolute/private/collaboration/runtime-preparation \
  --npm /absolute/npm --python /absolute/python3
```

A completed preparation returns the actual `primary.applicationDirectory`, `primary.runtimeReadyFile`, `receiving.applicationDirectory`, `receiving.runtimeReadyFile` and portable runtime archive. Configure the returned paths. A received host has its own observed runtime receipt and application directory.

## Start the same application through Applications

The [complete operating guide](./source/products/collaborative-documents/OPERATING.md) includes the private authentication schema and launch configuration. Create the customer's actual actors and tenant memberships, and keep authentication, workspace, launch configuration and generated connection outside the unchanged application source.

Prepare or attach the selected Merchant runtime using the maintained [runtime installation guide](./source/stellar/scf-starforge-20261009/distribution/RUNTIME_INSTALL.md). Open its Runtime workspace and choose **Applications → Collaborative Document Workbench**. Select the private launch configuration, review and save, connect the saved application, then start it. Open the address reported by that same application.

Applications owns the running process and its resource lease. Stop drains the original HTTP requests, uploads, jobs and native collaboration. Restart uses the retained application and workspace. The same private configuration can also be used for an explicit foreground operation:

```sh
starforge collaborative-documents-managed \
  --configuration /absolute/private/collaboration/launch.json --port 0
```

## Prepare and operate a customer's documents

1. Create the customer project and retain its original request ID and returned project ID.
2. Upload the complete original JSON, HTML or Yjs inputs. Retain their byte lengths, hashes and source records.
3. Configure the actual tenants, actors and document grants. Review the source mapping and every migration row; retain an import or skip decision and its reason.
4. Freeze the source and configuration edition, apply the reviewed migration, and follow the original native job through completion.
5. Start the deployment and open the intended tenant, document and epoch with the appropriate actor.
6. Save a drained checkpoint and complete handover when the receiving edition is ready.

The [original browser operator guide](./source/products/collaborative-documents/workbench/OPERATOR.md) explains every control. The selected reference schema is retained with the application; additional customer content models belong to their own explicit schema and migration adaptation.

Shared and offline editing use the original Hocuspocus provider, Tiptap collaboration extensions, Yjs document and y-indexeddb cache. Storage confirmation compares both the complete binary update and its state vector with the persisted receipt. Tenant membership and explicit project grants control access throughout the browser, native persistence and retained-file reads.

## Recover a request or restore an edition

Project creation and actions retain the actor, request ID, expected revision and full payload before dispatch. After an uncertain result, read the original request receipt and continue with the same ID and payload. Upload recovery uses the original upload, committed offset and digest.

A configuration rollback preserves current document data. Content restoration selects a checkpoint, explicit documents and a reason, drains the deployment and creates new document epochs while retaining the former history. Offline state from a former epoch remains separate. The operator explicitly starts the restored deployment.

The [operating guide's recovery sections](./source/products/collaborative-documents/OPERATING.md) cover request recovery, checkpoint download, runtime rollback and content restoration.

## Operate through the customer agent

The private Merchant provider exposes 23 tools for declared workspace aliases: connection and status, project reads and actions, complete source uploads, original request recovery, authorized document and persistence reads, full artifacts and retained-file inspection.

A host alias selects the customer's existing workspace, connection and actor. The provider rechecks current tenant and document grants before releasing retained content. The agent reads complete source, checkpoint, handoff and job artifacts with their original byte lengths and SHA-256 values. Disconnect closes the agent attachment; Applications controls the application lifecycle.

The [complete tool catalog and configuration](./source/products/collaborative-documents/OPERATING.md) give exact argument schemas, private host setup and the original CLI commands. Tool discovery itself opens no customer workspace.

## Deliver the complete editable service

Keep these outputs together:

- The complete selected Merchant package and its source manifest.
- The original prepared-runtime archive, dependency locks and actual receiving-host binding.
- The customer's full project/source/binary-history handoff, checkpoint and original request history.
- The actual Installation workorder, agreed source population, receiving environment and support terms.

Independent receiving uses the full runtime and original editable workbench, opens the received service closed, and uses its own private authentication. The customer can inspect earlier editions, continue editing, create another checkpoint and produce the next handover.

The [complete receiving guide](./source/products/collaborative-documents/RECEIVING.md) preserves the original native and browser course, including two authenticated editors, offline reload and reconnect, persistence, access revocation, restoration and independent onward editing.

## Commissioning and grant material

The [Installation profile](./source/stellar/scf_2026/sf49_data_commissioning/installation-workorders/collaborative-documents.json) joins a real customer workorder to the existing Installation workflow. The [grant chapter](./source/stellar-forge/developer-site/GRANT_COLLABORATIVE_DOCUMENTS.md) explains the reusable product and the customer adaptation it can support.

Use the original commissioning case for customer identity, scope, price, receiving decisions and support. The shipped source, original engines, complete operating guides and editable receiving programme travel with that case.
