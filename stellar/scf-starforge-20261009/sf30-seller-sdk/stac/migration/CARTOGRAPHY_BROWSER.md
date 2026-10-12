# Print-publication workspace

This panel belongs to the original QGIS migration application. It consumes saved original or corrected QGIS projects and retains plans, native publications and corrections in that same workspace.

## Operator workflow

1. Open Print publication and select the saved QGIS project.
2. Enter the title, subtitle and attribution. Choose A4 or A3, orientation and 150 or 300 dpi. Use the saved project extent or enter coordinates in its retained CRS.
3. Keep the original visible layers and order, or select the explicit layers to publish. An empty explicit selection remains a draft error, including after refresh. The original project keeps its labels, symbology and referenced resources.
4. Select **Review layout and sources**. Inspect the actual selected project and layer/source bindings. If correcting an earlier publication, review its retained comparison before saving.
5. Enter a review note, acknowledge the displayed source and layout, and save the reviewed plan. Changing the draft requires a fresh source review; the saved command carries that reviewed workspace revision. The two comparison/note reminders are completed by the displayed acknowledgment and note before saving, and the backend checks the exact comparison again.
6. Select **Render saved plan**. The native QGIS renderer saves an editable QGZ project, QPT layout, PDF map and PNG map with the immutable plan and operating record.
7. Open the rendered preview or download individual saved files. **Reopen editable publication** asks the original native receiver to open the exact saved project and layout.
8. Use **Prepare a correction** on a saved publication to create its following reviewed edition. Earlier outputs and source bindings stay in the workspace.

An omitted map.layerIds selects the original visible layers in saved order. An explicit empty list is invalid; the browser preserves that distinction across refresh. A reviewed plan normalizes its selected exact layer IDs.

The source review precedes native rendering. The image shown after rendering is the actual saved PNG.

## Original host integration

Publish these two files together under migration/public/:

- cartography.mjs
- cartography.css

Load cartography.css from the original migration shell. Its rules are scoped to .cartography. Import and mount the module once for the selected workspace; the shell should retain the mounted controller while navigating to other operator panels.

    import {mount} from './cartography.mjs';
    const panel = mount({
      root,
      api,
      mutate,
      download,
      onChange,
      storageKey,
      getWorkspace
    });
    await panel.ready;

The module returns ready, refresh() and destroy(). Call destroy() when that workspace closes. It removes its listeners and generated image URLs.

getWorkspace() returns {id,title,revision}. storageKey is the original browser identity prefix; the panel appends the selected workspace ID. api(command,payload) returns the original command result or {ok:true,result}. Errors may throw or return {ok:false,error:{code,message}}.

mutate(command,args) is the original host's retained-command dispatcher. It must preserve explicitly supplied requestId and revision when preparing or continuing that request, and retain its original actor and complete arguments before the network dispatch. The panel retains the same request ID and arguments locally so it can select the original command after browser loss; this record does not replace the host journal or the workspace's original request table.

Read commands:
- cartography.inventory → {workspaceId,revision,projects,plans,publications,operations}
- cartography.preview({spec}) → {workspaceId,revision,spec,project,layerBindings,comparison,issues,ready}
- cartography.operation({requestId}) → {found,workspaceId,revision,operation,plan?,publication?,result?}
- cartography.publication({publicationId}) → the full publication, directly or as {publication}
- cartography.download({publicationId,kind}) → {path,descriptor,mimeType,filename}
- cartography.reopen({publicationId}) → the original native reopen result

Mutation commands:
- cartography.save-plan({spec,revision,requestId})
- cartography.publish({planId,revision,requestId})

A publication identifies its original rendering request through requestId. A saved plan also keeps its creating requestId. When the same content-addressed plan already exists, the original cartography.plan-saved event identifies the newly accepted request while the plan keeps its original identity. The operation lookup returns that original saved event/result and plan. This lets the browser recover an accepted original result after a lost response. Inventory and lookup must return the selected workspace ID and actual current revision.

download uses only descriptor.path, the original workspace-relative declared file. A native download response may separately carry an absolute path; that absolute value does not become a browser download URL.

For a normal download the panel calls download(relativePath). For an inline rendered preview it calls download(relativePath,{returnBlob:true,descriptor}), expecting a Blob or {blob}. The original host owns authenticated streaming and exact-path checks. The panel checks the complete Blob size and SHA256 against the retained PNG descriptor before displaying it. If the host performs a normal download instead, the original PNG still opens through that path.

## Recovery and continuation

A pending browser record is saved before dispatch. **Check saved result** reads the original operation, then refreshes the inventory. A matching saved plan or publication finishes that same request without another mutation. Otherwise **Continue original request** uses the original request ID, complete arguments and reviewed revision.

The backend's started, needs-attention, complete and derived output-ready records remain visible in Native operations. Original dispatch admission determines whether a retained command is still running or can continue; the panel never creates a replacement native operation.

A refused stale review can return to the current draft after the original lookup confirms no saved result. A fresh review then creates a new explicit decision. The previous refused request remains in the original host history.

An accepted save stays completed if a following inventory refresh fails. Restoring the connection and refreshing the same workspace reopens its saved output. Browser storage failure prevents a new command from being dispatched before its request can be retained.

## Receiving this component

Use this panel inside the existing migration receiving case. Carry the original project through review, native render, editable reopen and a corrected publication. Exercise a lost render response and restore the same original request; verify the accepted publication remains complete if only the following inventory GET fails. Inspect the actual rendered PNG on desktop and a 390px viewport, including long source names and explicit layer selection across refresh. Keep the original QGIS native operation and the original portable project receiving; there is one application and one set of project/publication records.
