# Offline crew workspace

Every newly prepared native crew packet now contains a self-contained field-workbench.html with its original saved plan, selected visit list and available original attachment bodies already included.

Open that file on the field device. The packet opens its original plan immediately and displays the selected visits in the preparation order. It retains the complete plan so the existing native return can reconcile every original record and source reference.

## Field workflow

Choose a selected visit in the packet toolbar. Open visit uses the existing visit editor; Record fieldwork opens the existing structured field form with that actual visit selected. Print visit sheet uses the maintained original field-sheet renderer.

Record actual observations, collection times, sample IDs and files through those existing forms. Save browser draft retains the working copy on this device. Export completed plan + files uses the original evidence-bundle producer and carries the complete working plan and available original files. Export plan JSON and Download original plan are separately available.

Return the complete ZIP through the original native workspace's plan-and-files import. The original saved native revision remains in the working plan, allowing the maintained field return and reconciliation workflow to handle newer native revisions.

## Original files and local continuity

The native producer streams retained original attachments into the standalone HTML as base64. It verifies their original byte counts and SHA256 values during writing and checks that they are referenced by the actual saved plan. Repeated content is included once. Attachment data is not interpolated into executable JavaScript.

On first open the existing browser evidence vault verifies each decoded original before committing it. This enables the full original-file return without asking the crew to locate each attachment beside the workbench. The original crew ZIP still contains the same independent source attachments.

Each packet has a separate draft namespace derived from its original project and deployment ID. Reopening the same packet opens the local working plan, including later field edits, rather than replacing it with the original. Other packet editions and the generic portable workspace retain their own drafts.

The toolbar's Download original plan always exports the original embedded revision. Open this packet's working plan returns to its retained local draft after another plan was opened. The working copy keeps the original native plan ID and revision.

If the device cannot store attachment bytes, the plan remains usable and the toolbar identifies the storage error. The complete crew ZIP retains those original files, and the existing Handover controls can import a complete file bundle or attach matching originals. Files absent from the original native preparation are listed separately. A complete ZIP export uses the original evidence checks and identifies any still-missing file.

## Product integration

The maintained offline builder accepts optional field_packet and field_files inputs. With no packet it continues to build the generic portable implementation workbench. The native field_deployment producer supplies the exact plan, deployment ID, selected visits and retained source descriptors.

The full saved plan is validated before writing. Source files are streamed in 192KiB blocks, and the completed HTML is atomically published only after every selected source matches its original bytes and hash. The build result records the packet/project/plan/revision/visit identities and original attachment descriptors in offline-build.json.

The packet identity already binds the offline builder and all maintained browser source files. New packets therefore identify this complete builder edition while older completed packets continue to reopen their original members.

The implementation installer includes implementation_field_start.mjs. The additive offline-field-crew component fragment includes the complete source and guide in application assembly. The existing scientific-fieldwork receiving command consumes this native producer without changing its selected Study or whole Workspace archive formats.

## Source responsibilities

The new controller selects and opens existing records and invokes existing visit, structured-form, print and evidence-export methods. Implementation validation, native revision creation, field-return reconciliation, measurement definitions and original scientific calculations stay in their maintained modules.
