# OTOBO configuration handover

Prepared by TokenJunkieLabs.

This workspace reviews the ten native OTOBO standard configuration families from original YAML exports. It preserves the source exports, target baseline, selected decisions and independently returned target. The browser produces an attributed handover plan; the supplied native emitter validates the actual YAML and creates the selected native files. The existing OTOBO importer applies those files under the operator's control. Migration Acceptance reconciles the independent returned export against the reviewed plan.

## Open the complete review

Use `dist/otobo-review.html` for the self-contained browser edition. It includes the complete browser modules, operating guide, authored reference and source download. Save the HTML in a location appropriate for the configuration data you will open.

The review does not automatically transmit captures, call an OTOBO instance or write browser storage. **Save complete working copy** downloads all selected capture JSON, original YAML bytes, current project, prior full working editions and unfinished form text. Reopen that file through **Open working copy**. A bare original project JSON is also accepted; its captures remain complete, while the surrounding capture JSON is reconstructed and marked accordingly.

A complete working copy and each selected capture can be at most 512 MiB. Plan JSON is limited to 32 MiB. The workspace retains up to 500 prior working editions. A rejected file remains available through **Download selected file**. Keep your previous complete copy before deliberately starting a separate workspace.

## 1. Capture source and target baseline

Run the supplied native capture helper against each original export using the actual installed YAML::XS environment. See **NATIVE_RECEIVING.md** for the exact commands, parser profile and original runtime requirements.

Select the source capture and the independent target baseline under **Captures**. The table shows entry counts and complete-versus-partial scope for every family. Verify the case, source/target roles, workspace references and observation times.

Every capture retains original filename, byte count, SHA-256, Base64 source bytes, native tagged fields and context evidence. The browser uses the capture's tagged trees; it does not reinterpret YAML. Download any retained original under **Source files**.

A family marked partial cannot establish absence. Creating a missing object requires complete target scope for that family. External lookup names, permission types and queue depth need the retained target evidence required by the selected plan.

## 2. Review complete decisions

Choose **Create plan from captures**. This creates an explicit draft that keeps observed target entries and excludes unreviewed new entries. Review each source identity and choose the intended action.

| Family | Available import decision | Material behavior |
|---|---|---|
| Groups, Roles, Types, Templates, Services, SLAs, Queues | Create or overwrite | The selected complete native object is imported under its exact identity. |
| RoleGroups | Replace pair permissions | Each mentioned role/group pair receives the selected complete permission set; unrelated pairs remain. |
| QueueTemplates | Add links | Selected links are added; unrelated existing links are retained. |
| GenericAgents | Create or overwrite | Review complete actions, schedule and activation before approving the job. |

**Keep target** retains the observed target value in the comparison scope. **Exclude** omits that source entry from the selected import and comparison. Neither action deletes target objects.

Open each record to inspect every source field alongside the target baseline and reviewed proposal. Null, empty text, numeric text and original leading zeroes remain distinct. Full tagged values and fields outside a familiar form remain available in the complete plan and capture.

For a dependency reference, select an exact source scalar and an actual target entry and scalar, then enter a reason. The override copies that retained target value. It does not invent a target lookup. Review identity-bearing fields carefully; the core rejects a service Parent/NameShort combination that would change its reviewed name.

The decision form retains unfinished override JSON. **Apply reviewed decision** changes the complete draft plan. **Discard this unapplied draft** preserves the prior full working edition before returning to the current plan decision.

## 3. Seal and attribute a plan

Enter the named reviewer and choose **Review complete plan**. This seals the exact capture IDs, decisions, parser profile, dependencies and native import order into a plan identity. Plan errors prevent approval. Review-level findings describe consequences that the reviewer must assess, including permission replacement and native job behavior.

Enter a stable project identifier, title and concrete review reason. Select the approval checkbox only after reviewing the complete selected scope. **Save attributed plan edition** retains the exact original request, full plan, reviewer and decision history.

The approved native plan download is enabled only when the visible plan still equals the current approved project and no unapplied record drafts remain. A later edit preserves the previous project and requires a new attributed edition. Complete project downloads retain original history even while a different unfinished draft remains in the working copy.

## 4. Emit and import selected native configuration

Download the approved plan and original captures. Use the native prepare/emitter command in **NATIVE_RECEIVING.md**. It reparses original YAML, checks tagged values and emits the selected one-family-root files in reviewed order. Keep the full emitted directory, manifest and command result.

The existing OTOBO operator chooses and runs the original import operation with the appropriate overwrite behavior. Role/group permissions and queue/template links have their own semantics; an overall successful process result is not proof that every intended row changed. Preserve the complete native import log.

Native configuration may reference objects or deployment settings outside the ten selected families. Resolve those references from actual target evidence before import. This product does not infer ticket data, process/ACL definitions, package availability or customer-data migrations from a standard-object export.

## 5. Receive the independent returned target

After import, acquire a fresh target capture from the same target workspace and select it under **Captures**. The workspace preserves the entire prior working edition, including the approved pre-import project, then starts a new project selection bound to the independent after capture.

Use a new project identifier, inspect the original plan and returned differences, and record a new attributed approval. The original plan identity and earlier approval remain in history.

The returned comparison shows exact expected and observed tagged values. A known missing row and a different row can proceed to native comparison as findings. Unknown scope blocks native binding because a partial returned export does not establish absence. A later matching return is another complete captured edition; it does not overwrite the earlier evidence.

## 6. Run the original native comparison

The installed Migration Acceptance runtime remains the source of the actual comparison and acceptance outputs. Use **NATIVE_RECEIVING.md**, the original runtime-ready document and the same receiving operation.

The approved project supplies one table with text columns `family`, `identity_json` and `value_json`, keyed by family and identity. Full source, plan, coverage and projection files remain in the handover. An import log or browser preparation does not replace the independently acquired target evidence.

Open the returned workspace, inspect selected populations and differences, verify that the same exact inputs can repeat the comparison, and retain the review decision with the resulting handover.

## Source and build commands

From a complete checkout:

```sh
node products/migration-acceptance/adaptations/otobo/build-review.mjs /absolute/output/otobo-review.html
```

The builder verifies every selected source file against SOURCE_MANIFEST.json and the original Workbench dependency manifest. It refuses to overwrite a different output edition. The offline page can download its full embedded source packet.

The authored reference covers all ten families and eleven entries. Its independent after capture deliberately retains two differences; matchingAfter.json contains the matching return. These files exercise source handling and comparison preparation and are labelled as an authored reference.

## Recovering a working session

Opening a replacement capture preserves the previous full working edition. Replacing source or baseline clears the current dependent plan and after selection only after preserving that original edition. Replacing the after capture preserves the original plan and creates a new project boundary.

Changing another field during a pending file read prevents the late file from replacing newer work. Invalid UTF-8, JSON or capture identities leave the current workspace unchanged and keep the selected file downloadable.

Use **History** to open or download an earlier full working edition. Opening it also preserves the current edition. The native project retains its own immutable attributed mapping history inside that broader working history.
