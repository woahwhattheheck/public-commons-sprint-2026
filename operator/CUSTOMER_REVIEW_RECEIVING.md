# Receive and reopen a complete customer review

The Customer reviews workspace can receive an ordinary review ZIP, retain its complete original archive, join its compatible selection and response history to the restored project, and reopen the received desk on another computer. Each received package remains identifiable by its receipt and original archive hash.

## Choose the right receiving action

| File received | Action |
| --- | --- |
| Complete ordinary customer review ZIP | **Customer reviews → Receive review package** |
| Response JSON exported by a customer review desk | Open the retained review and choose **Receive response** |
| Complete engineering handback ZIP | Open the retained review, choose **Engineering handbacks → Receive handback package** |

A response JSON contains decisions and requested corrections. An ordinary review ZIP contains the selected original work and its included history. An engineering handback also relates the customer's original request to the engineer's selected revised work. Keep the complete exported file for the corresponding action.

## 1. Restore the source project and select its workspace

Open the restored project that owns the incoming review. The receiver checks the original project and source bindings and the included history before joining the package. Restore the original project and its required source material when moving the work to another computer.

The receiving form captures the selected workspace. Changing workspaces while uploading prevents the receive action from being queued into the new workspace. Changing the selected file, replacing the form, or closing it during upload also prevents that upload from submitting a different selection. Open the receiving form again in the intended workspace when this happens.

## 2. Receive the original ZIP

From **Customer reviews**, choose **Receive review package**. You can also open a particular retained review and use its **Receive review package** action; that route additionally requires the incoming package to belong to that review.

Select the complete original ZIP and inspect the filename and byte count. Choose **Receive review package** to upload it and queue the native receive task. The task validates the package, retains the full ZIP in the workspace, and joins its original compatible records.

Follow the task's completion or reported issue in the native task view. A completed task offers **Open received package**, **Open retained review**, and **Open received desk** when its local desk is ready. The complete original archive and received review/history JSON are available as task downloads.

## 3. Inspect the received package

Choose **Received packages** on the Customer reviews page to see the catalogue for the current workspace. Each row identifies:

- The original review title, purpose, and review ID.
- The received time, original ZIP filename, member count, archive size, and package hash.
- The included response generation and number of retained responses in that package.
- The selected original file and requirement counts.

Search the catalogue by review, purpose, filename, response ID, package ID, or package hash. Open a retained review's **Received packages** tab to see only packages for that review. **All received packages** returns to the workspace catalogue. Refresh to include a newly completed receive task.

**Inspect received package** opens the original package's detail. It includes the original review, selected file labels and paths, original file hashes and sizes, requirements, and the complete included response history. Expand the complete review and response document or package record for all retained fields. Download the original ZIP or received review/history JSON from the same view.

## 4. Understand the two response generations

The detail displays both **Included response generation** and **Current retained response**.

The included generation belongs to this particular ZIP. A package exported before any responses continues to show **Initial review before responses**. A package exported through a particular response continues to identify that original response.

The current retained response belongs to the review's present history in this workspace. Later customer responses may already be retained there. A notice identifies when the received package and current retained history differ.

**Open received desk** opens the included generation. **Open retained review** opens the current retained review, where later responses and engineering work can be inspected. Opening a received package does not replace its included generation with a newer response.

## 5. Open the received desk after moving computers

The original receipt and ZIP travel with the retained project. A desk directory on the sender's computer does not need to exist on the receiving computer.

When a valid package needs a local desk, its detail offers **Open on this computer**. Inspect the selected package and included response generation in the confirmation form, then choose **Open received desk**. The native task recreates that package's local desk from its retained original archive.

A ready desk offers **Open received desk** directly. If the backend reports a package issue, the detail shows that issue. Review the task and original package records and correct the specific source or package problem before trying again.

The local desk renders the original packet data using the maintained review viewer. The original archive remains byte-for-byte downloadable. The receiving operation does not execute an incoming ZIP's HTML as an authenticated operator application.

## 6. Continue the customer and engineering workflow

The received desk contains the package's original selected work and included responses. Continue the review there and export its response JSON. Return to the corresponding retained review and use **Receive response** to join the new response through its original predecessor.

If later responses have already been retained, inspect the original response history and reconcile the draft against the intended generation before receiving it. Retain the incoming package to preserve the work and decisions that the customer originally saw.

Use **Engineering handbacks** to assign requested changes, select the actual revised work, prepare an engineering response, and export its complete handback. The ordinary package receiver leaves those engineering editions in their existing workflow.

## Operator integration

The existing Customer reviews module owns this workflow; it does not require a second application.

- `GET /api/reviews/packets` returns the workspace's received-package catalogue. An optional `review_id` selects one original review.
- `GET /api/reviews/packet?receipt_id=…` returns the original receipt, review, included responses, current response identity, downloads, and local desk state.
- `customer.review.packet.receive` receives a native `upload_id`, with optional expected `review_id`.
- `customer.review.packet.open` recreates the local desk for one retained `receipt_id`.

Completed native tasks identify their original receipt and review through `_review.kind = "received-review"`. Browser actions use those identifiers, preserve the selected workspace through asynchronous upload and reads, and accept local desk links only on the current operator origin.
