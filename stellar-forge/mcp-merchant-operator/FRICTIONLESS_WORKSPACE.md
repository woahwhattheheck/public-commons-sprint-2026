# Frictionless source workbench

The source workbench takes a complete descriptor or retained source archive through capture, resource inspection, immutable query editions, full native review, publisher source selection and publication planning. It uses the configured Frictionless publisher, its scheduler and the original merchant MCP owner.

The installed application is **Frictionless source workbench**. Its command is **frictionless-agent**. The browser and agent client use the same retained workbench UUID, source editions and operation history.

## Configure the existing merchant

Keep the original merchant configuration and its publisher connection. Add the source-workbench connection filename to that same configuration:

~~~json
{
  "publisherConnection": "publishers.json",
  "frictionlessWorkspaceConnection": "frictionless-workspaces.json"
}
~~~

These are entries to add to the existing merchant configuration. Preserve its remaining fields, authentication, runtime declarations and service connections.

The workspace connection selects an existing publisher alias. Each Frictionless publisher has one source-workbench alias:

~~~json
{
  "schema": "stellar-forge.frictionless-workspace-connection.v1",
  "workspaces": {
    "source_operations": {
      "label": "Source operations",
      "publisher": "original_frictionless_publisher",
      "inputs": {
        "supplier_descriptor": {
          "kind": "descriptor",
          "label": "Supplier data package",
          "path": "/private/source-inputs/datapackage.json"
        },
        "supplier_archive": {
          "kind": "source-archive",
          "label": "Received complete source",
          "path": "/private/source-inputs/source.tar.gz"
        }
      }
    }
  }
}
~~~

Use the real publisher alias and original private file paths. The publisher's kind remains **frictionless**, and its directory remains the original configured directory.

| Input | Declaration | Native operation |
|---|---|---|
| Current publisher source | Built-in alias **current** | Inspect the original selected source, then supply its returned hash for an explicit intake. |
| Local descriptor | **kind: descriptor**, one **path** | Capture the exact original descriptor and its selected resources with the original capture engine. |
| Public descriptor | **kind: descriptor**, one public HTTPS **url** | Capture that declared remote source with the original capture engine. |
| Received source archive | **kind: source-archive**, one private **path** | Receive the complete original native source archive, retaining its original resource and reference selection. |

A descriptor can also declare **resources** as distinct original resource names, **references** as public HTTPS reference URLs and **timeoutSeconds** from 1 through 300. A source archive already contains its original selection and accepts its archive path and optional label.

Descriptors use exactly one path or URL. Public URLs have no embedded credentials, fragments or credential/capability query parameters. Resolve local paths relative to the connection file, or use canonical absolute paths. Keep the original connection and source files private and owned by the running host.

Configuration supports up to 32 workbench aliases and up to 64 declared inputs per workbench. The reserved **current** alias always refers to the original publisher source. Local descriptor files are limited to 8 MiB; received source archives are limited to 256 MiB by the maintained configuration reader.

## Start through installed Applications

1. Open **Applications** in the installed merchant workspace.
2. Choose **Frictionless source workbench**.
3. Select the original merchant configuration file and the declared workspace alias.
4. Select browser and MCP ports, using **0** for available loopback ports.
5. Select the existing MCP token environment name, normally **MCP_ACCESS_TOKEN**, and provide its value through the host's existing private environment mechanism.
6. Review the selected configuration and start the application.
7. Open the returned local operator URL. Use the returned MCP URL and workspace UUID with the existing source client.

Applications binds the exact merchant, publisher-connection and source-workbench-connection files, their sizes and hashes, the publisher alias and its original directory. The normal source-selection and publisher state can continue changing during operation.

The original Applications resource family remains **merchant-mcp** for the selected merchant configuration. Another application using that same merchant configuration shares its existing ownership rules.

## Start from the command line

Inspect configuration without opening the publisher or a listener:

~~~sh
stellar-forge frictionless-agent inspect \
  --config /private/merchant/merchant-mcp.json \
  --workspace source_operations
~~~

The result includes **bindingSha256** and the three exact configuration-file identities. Retain that selection when starting:

~~~sh
stellar-forge frictionless-agent serve \
  --config /private/merchant/merchant-mcp.json \
  --workspace source_operations \
  --expected-binding-sha256 SELECTED_BINDING_SHA256 \
  --port 0 \
  --mcp-port 0 \
  --token-env MCP_ACCESS_TOKEN
~~~

Replace the selected hash with the actual inspection result. The first startup record uses schema **stellar-forge.frictionless-agent-workspace-startup.v1** and status **FRICTIONLESS_AGENT_READY**. It identifies the persistent workbench UUID, original publisher alias/directory, current workbench and publisher instance UUIDs, browser URL and MCP URL.

Serve starts one original merchant MCP owner and borrows its publisher. SIGINT or SIGTERM closes that owner through its original lifecycle. A failed close remains attached to the same owner for retry.

## Complete the source workflow

### 1. Inspect the original selected source and inputs

Open the source workbench and inspect **Current source**. Retain the returned source identity, capture identity, resource declarations and query definitions. Open the declared input you intend to receive.

The agent equivalents are **merchant_frictionless_open**, **merchant_frictionless_current** and **merchant_frictionless_input**. Opening returns the persistent **workspaceId** and current instance identities. Subsequent scoped calls use that exact workspace UUID.

For a local file or the built-in current source, use the exact SHA-256 returned by input inspection. A changed original file is a new input selection requiring its current inspected hash.

### 2. Capture the complete input

Start intake with an operator-chosen label and one caller-retained request UUID. The original capture/source-receive engine performs the work and retains a complete immutable capture.

The intake arguments are **requestId**, current **expectedVersion**, declared **input**, **label** and the inspected **expectedSha256** for local/current inputs. The original request is retained before the operation begins.

Keep the original request identity if the browser or client disconnects. Inspect it through **merchant_frictionless_request** with **action: inspect**. Continue that exact retained request through **action: resume** when appropriate.

### 3. Inspect resources and create an immutable source edition

Read the capture's original package metadata, resource schemas, physical inspection, references, suggested queries and declared files. Page every relevant resource and file list. Open the complete retained file when field detail exceeds a page.

Create a source edition from explicit original query projections. Preserve the source resource names and projected column order. The existing source engine controls supported schema overrides and the captured reference evidence they require.

For precision-sensitive query definitions, use **queriesText**, the literal query JSON returned by original source inspection. It preserves the original Python serialization, including large integer constraints. Edition creation accepts exactly one of structured **queries** or literal **queriesText**.

The agent equivalents are **merchant_frictionless_capture** and **merchant_frictionless_edition**. Source editions are immutable; a revised projection becomes a new edition with its original parent capture and exact query content retained.

### 4. Review every selected row

Run the native review of the selected edition with the actual reviewer and review note. This uses the original source reviewer over every selected row. Read the original review outcome and its complete retained report.

A successful operation can still contain validation findings. Use those actual findings to correct the source contract or query edition and run the appropriate original review again. The workbench preserves the earlier edition and review.

Use **merchant_frictionless_review** with **action: run** to start the review and **action: inspect** to reopen a retained review.

### 5. Select the reviewed source and save the publication plan

Inspect the currently selected publisher source again. Select the reviewed immutable edition with its exact **editionId**, **reviewId** and current **expectedSourceHash**. The existing publisher writer applies the original source selection atomically.

Obtain the publication plan template through **merchant_frictionless_plan_input**, selecting the exact edition and original query. Review the complete plan, then save it with the same caller-retained request semantics through **merchant_frictionless_plan**.

The operator can open the actual saved plan in the original publisher controls. Continue extraction, candidate review, publication, dataset export and customer receiving through those existing controls. The source workbench retains the exact source and plan relationship.

Earlier plans and their source bytes remain available. After an uncertain response, inspect the original request and original saved plan before continuing.

### 6. Compare captured source changes

Compare the relevant immutable source captures. The retained comparison describes original data-file hashes, descriptors, schemas and dialect changes. Use complete native review and the actual downstream queries to assess their operational effect.

The agent equivalent is **merchant_frictionless_compare**, with explicit **create** and **inspect** actions. Its original comparison UUID and full retained file preserve the selected pair.

### 7. Export and reopen the complete source handover

Select the exact reviewed edition and create a source export with its original request UUID. The completed source export contains:

- The original **source.tar.gz** native source archive.
- The frozen source-edition JSON, including exact query JSON text.
- The applicable original native reviews.
- Complete retained capture inspection.
- Original source-selection history and saved publication-plan bindings.
- The receiving instructions and complete file manifest.

Inspect the completed export and read its full download manifest. Retrieve every declared file through **merchant_frictionless_export_file**, retaining the original manifest hash, individual file hashes and byte offsets. The existing source client supports interruption and owner reopening in the same receiving directory.

On the receiving host, declare the original exported source archive as a host input, inspect its exact SHA-256 and use the original source-archive intake. Recreate the applicable source edition from the exported exact query JSON and perform the original review against the receiving environment. The archived edition and review remain source records from their actual originating workspace.

Published dataset generations and customer warehouse state use their existing complete dataset/customer export workflows. Source export identifies the source contract and its original commissioning history.

## Agent operation map

| Work | Original tool |
|---|---|
| List declarations / inspect retained state | **merchant_frictionless_status** |
| Borrow / close the configured workbench | **merchant_frictionless_open**, **merchant_frictionless_close** |
| Inspect original source / declared input | **merchant_frictionless_current**, **merchant_frictionless_input** |
| Start complete intake | **merchant_frictionless_intake** |
| Read retained capture/resources/files | **merchant_frictionless_capture** |
| Create/read immutable query edition | **merchant_frictionless_edition** |
| Run/read complete native review | **merchant_frictionless_review** |
| Read/save original publication plan | **merchant_frictionless_plan_input**, **merchant_frictionless_plan** |
| Select reviewed original publisher source | **merchant_frictionless_select** |
| Compare original source captures | **merchant_frictionless_compare** |
| Create/read complete source export | **merchant_frictionless_export** |
| Inspect/continue original request | **merchant_frictionless_request** |
| Cancel the selected original active job | **merchant_frictionless_cancel** |
| Read/release exact retained bytes | **merchant_frictionless_file**, **merchant_frictionless_file_release** |
| Inspect/read/release complete export | **merchant_frictionless_export_manifest**, **merchant_frictionless_export_file**, **merchant_frictionless_export_file_release** |
| Borrow the original browser | **merchant_frictionless_browser** |

Each mutation receives its caller-retained UUID and the current applicable version or source binding. New UUIDs represent new intended operations. Close uses the persistent workspace UUID plus both current instance UUIDs returned by the original open/status response. The borrowed close drains its browser, retained reads and workbench model; the original merchant publisher remains with its owner.

## Receiving and operational record

Keep the complete original source input, actual capture/review results and finished source export with the work being delivered. Open the original files and receiving guide to reproduce the relevant source edition. Record actual native review and publication results separately from configuration inspection or source compilation.

The installed launcher inspects and opens the product. Starting it does not by itself perform intake, native review, publication or customer receiving. Those steps have their own retained operations and results in the same workspace.
