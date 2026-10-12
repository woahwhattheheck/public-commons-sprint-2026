# Native Odoo 19 service delivery and billing API

This guide defines the source contract for the OBS service-delivery addon. Its baseline is the original Odoo Community `19.0` commit `5120de57bb998f4e551a815edeb158d9f17fb89a`, read on 2026-10-12. The addon should carry an engagement through the original sales order, project, timesheet and accounting models, with one atomic public method for each business operation.

## 1. Bind the addon to the actual version

Use Odoo 19 field names. The original Odoo 18 comparison is pinned separately at `57f8ae149db8bcad3da2e44c4c8e412f80f3189f`.

| Model / value | Odoo 19 baseline | Odoo 18 comparison |
| --- | --- | --- |
| `sale.order.line` unit field | `product_uom_id` | `product_uom` |
| `sale.order.line` tax field | `tax_ids` | `tax_id` |
| `sale.order.line` ordered quantity | `product_uom_qty` | `product_uom_qty` |
| `product.product` unit field | `uom_id` | Use the deployed product schema |

`line_subsection` is a native sale/invoice display type alongside sections and notes. Preserve the original invoice-line preparation instead of rebuilding lines from quantities and prices.

Sources: [19 sales line](https://github.com/odoo/odoo/blob/5120de57bb998f4e551a815edeb158d9f17fb89a/addons/sale/models/sale_order_line.py); [18 sales line](https://github.com/odoo/odoo/blob/57f8ae149db8bcad3da2e44c4c8e412f80f3189f/addons/sale/models/sale_order_line.py).

Native SQL constraints use a named `models.Constraint` class attribute. The original module model declares `_name_uniq = models.Constraint('UNIQUE (name)', ...)`. An engagement replay key can use the same form:

```python
_operation_key_unique = models.Constraint(
    'UNIQUE (engagement_id, operation_key)',
    'This operation key has already been used for this engagement.',
)
```

Both key columns must be required if every operation is meant to be unique; a nullable SQL key permits more than one null value. Store and compare a canonical request fingerprint on replay so a reused key with different intent cannot return the wrong prior result.

Source: [original module constraint and version fields](https://github.com/odoo/odoo/blob/5120de57bb998f4e551a815edeb158d9f17fb89a/odoo/addons/base/models/ir_module.py).

## 2. Confirm the sale through its native method

Call `sale.order.action_confirm()` after checking the engagement's company, order and normal write access. The source validates analytic distribution, writes the confirmation values and invokes `_action_confirm()`. The `sale_project` extension generates the original projects and tasks using `_timesheet_service_generation()` in the order's company. Reuse those generated records in the engagement.

`send_email` in the context controls order-confirmation mail. `disable_project_task_generation` disables the native generation hook. A confirmation operation should use deliberate context values for its intended flow. The return is normally `True`; read the saved order/project/task IDs as the result.

Sources: [sales confirmation](https://github.com/odoo/odoo/blob/5120de57bb998f4e551a815edeb158d9f17fb89a/addons/sale/models/sale_order.py); [project generation hook](https://github.com/odoo/odoo/blob/5120de57bb998f4e551a815edeb158d9f17fb89a/addons/sale_project/models/sale_order.py).

## 3. Create the invoice through the timesheet-aware wizard

The period-aware path is the original `sale.advance.payment.inv` transient model. Its public `create_invoices()` method performs the amount check, calls `_create_invoices(sale_order_ids)` and returns the native invoice-opening action. An addon method that must retain exact invoice IDs can make the same native calls internally:

```python
wizard = self.env['sale.advance.payment.inv'].with_company(order.company_id).create({
    'sale_order_ids': [Command.set(order.ids)],
    'advance_payment_method': 'delivered',
    'deduct_down_payments': True,
    'consolidated_billing': False,
    'date_start_invoice_timesheet': start_date or False,
    'date_end_invoice_timesheet': end_date or False,
})
wizard._check_amount_is_positive()
invoices = wizard._create_invoices(order)
invoices = invoices.sudo(self.env.su)
action = order.action_view_invoice(invoices=invoices)
```

The surrounding addon method must validate its selected order and period and hold the engagement/order operation lock before calling this sequence. This example deliberately selects one order per invoice with `consolidated_billing=False`; let a separate explicit multi-order operation choose consolidation.

| Native field / parameter | Exact behavior |
| --- | --- |
| `advance_payment_method='delivered'` | Regular invoice; respects each product's original invoice policy, including ordered-quantity products. |
| `date_start_invoice_timesheet`, `date_end_invoice_timesheet` | Inclusive timesheet period bounds; false means no bound. |
| `deduct_down_payments` | Defaults to true and becomes the sale `_create_invoices(final=...)` argument. |
| `consolidated_billing` | Defaults to true. The wizard passes `grouped=not consolidated_billing`. |
| Sale `_create_invoices(grouped=True)` | Keeps invoices grouped by sales order. False can combine orders using the original invoice grouping keys. |
| Sale `_create_invoices(date=...)` | The original parameter is unused; do not treat it as the invoice date. |
| Percentage/fixed advances | Use `percentage` with `amount`, or `fixed` with `fixed_amount`, through the same original wizard. These paths require exactly one order. |

The `sale_timesheet` wizard override first calls order lines' `_recompute_qty_to_invoice(start, end)` and then supplies the same period in the context for invoice/timesheet linking. Calling only `order.with_context(timesheet_start_date=..., timesheet_end_date=...)._create_invoices()` omits the period quantity calculation.

The native quantity method handles delivered-timesheet domains, existing invoice links, canceled invoices, credit notes and period bounds. It caps quantities in the credit-note case using delivered minus invoiced. Use this original logic rather than summing hours independently. A created draft already owns its timesheet links and therefore counts in retry/review logic.

Sources: [timesheet invoice wizard](https://github.com/odoo/odoo/blob/5120de57bb998f4e551a815edeb158d9f17fb89a/addons/sale_timesheet/wizard/sale_make_invoice_advance.py); [base invoice wizard](https://github.com/odoo/odoo/blob/5120de57bb998f4e551a815edeb158d9f17fb89a/addons/sale/wizard/sale_make_invoice_advance.py); [period quantities](https://github.com/odoo/odoo/blob/5120de57bb998f4e551a815edeb158d9f17fb89a/addons/sale_timesheet/models/sale_order_line.py); [timesheet linking](https://github.com/odoo/odoo/blob/5120de57bb998f4e551a815edeb158d9f17fb89a/addons/sale_timesheet/models/account_move.py).

## 4. Keep the original financial roles and return semantics

The base sales path allows an authorized salesperson to generate a draft from an accessible sales order even without arbitrary invoice-create rights. Its `_create_account_invoices()` uses sudo for that specific draft creation and returns that elevated recordset. Restore the caller's privilege level before subsequent accounting actions, as in `invoices.sudo(self.env.su)` above. Preserve native record access and company checks around the business operation.

The original `sale.advance.payment.inv` ACL is assigned to `sales_team.group_sale_salesman`. Project users/managers receive read-only access to sales records from `sale_project`. Posting/reversal belongs to the native `account.group_account_invoice` role. An addon ACL for `base.group_user` grants access to the addon itself; it does not grant those underlying sales/accounting capabilities.

`account.move.action_post()` calls `_post(soft=False)` in the usual path. `_post` checks the native invoice role unless already sudoed. `action_post()` can return a confirmation-window action instead of posting when abnormal-invoice confirmation is enabled, and can also return a bill-autopost wizard. A success result should include the actual move states and preserve a returned native action. Calling `_post()` with its default `soft=True` can defer future entries instead of posting them immediately.

Native posting applies required-field, active journal/currency/account, bank trust, company and lock-date logic. It can adjust the accounting date for a locked period. Return the saved date and totals from Odoo rather than assuming the requested values were the final ones.

Sources: [account move actions](https://github.com/odoo/odoo/blob/5120de57bb998f4e551a815edeb158d9f17fb89a/addons/account/models/account_move.py); [sales ACL](https://github.com/odoo/odoo/blob/5120de57bb998f4e551a815edeb158d9f17fb89a/addons/sale/security/ir.model.access.csv); [project ACL](https://github.com/odoo/odoo/blob/5120de57bb998f4e551a815edeb158d9f17fb89a/addons/sale_project/security/ir.model.access.csv); [accounting ACL](https://github.com/odoo/odoo/blob/5120de57bb998f4e551a815edeb158d9f17fb89a/addons/account/security/ir.model.access.csv).

## 5. Correct an invoice through the native reversal wizard

Use `account.move.reversal` and its original `reverse_moves(is_modify=...)` method. The wizard has required `company_id` and computed/stored required `journal_id`; a deterministic addon call can supply both explicitly. `move_ids` is the selected posted move set. `date` defaults to the caller's current date, while `reason` is optional.

Before creation, check that the selected moves are existing posted customer invoices attached to this engagement, are in one permitted company, and remain writable through the caller's normal role. Choose an active journal of the same type as the original move. The native context defaults independently validate posted state and one company when `active_model='account.move'` and `active_ids` are supplied.

```python
moves = self.env['account.move'].browse(move_ids).exists()
moves.check_access('write')
company = moves.company_id
wizard = self.env['account.move.reversal'].with_company(company).with_context(
    active_model='account.move', active_ids=moves.ids,
).create({
    'move_ids': [Command.set(moves.ids)],
    'company_id': company.id,
    'journal_id': journal.id,
    'date': reversal_date,
    'reason': reason,
})
previous_credit_ids = set(moves.reversal_move_ids.ids)
action = wizard.reverse_moves(is_modify=True)
replacement_invoices = wizard.new_move_ids
credit_notes = moves.reversal_move_ids.filtered(
    lambda move: move.id not in previous_credit_ids
)
```

`reverse_moves()` returns an `ir.actions.act_window` dictionary. It does not return an invoice recordset. With `is_modify=True`, `wizard.new_move_ids` contains the new replacement invoice(s); the generated credit notes must be retained separately through the original moves' `reversal_move_ids`. With `is_modify=False`, `new_move_ids` contains the reversals.

For a present/past correction date, modification requests native cancellation/reconciliation of the originals through their reversals and creates replacement draft invoices. A future reversal date switches the credit to `auto_post='at_date'`, which changes the cancellation timing. Return the native states and scheduling fields so the correction result accurately describes that timing.

Yes: the `sale_timesheet` override reattaches original timesheets to the replacement **draft** invoice during `reverse_moves(is_modify=True)`, before the call returns. It maps the new invoice lines back through their original `sale_line_ids` and writes `timesheet_invoice_id` on those timesheets in the same transaction.

Ordinary posted credit-note handling clears the relevant old timesheet invoice links. Deleting draft invoice lines clears their link while protecting the timesheet's original `so_line`, preserving delivered work. These behaviors are already implemented in the native extensions.

Use original recovery actions instead of writing accounting states directly. `button_draft()` checks audit/hash restrictions and rejects protected cash-basis or exchange-difference entries; `button_cancel()` invokes native draft and reconciliation logic. The addon should retain the original invoice, credit and replacement IDs together with its replay result.

Sources: [base reversal wizard](https://github.com/odoo/odoo/blob/5120de57bb998f4e551a815edeb158d9f17fb89a/addons/account/wizard/account_move_reversal.py); [timesheet replacement hook](https://github.com/odoo/odoo/blob/5120de57bb998f4e551a815edeb158d9f17fb89a/addons/sale_timesheet/models/account_move_reversal.py); [draft-line unlink](https://github.com/odoo/odoo/blob/5120de57bb998f4e551a815edeb158d9f17fb89a/addons/sale_timesheet/models/account_move_line.py); [timesheet credit hook](https://github.com/odoo/odoo/blob/5120de57bb998f4e551a815edeb158d9f17fb89a/addons/sale_timesheet/models/account_move.py); [account recovery](https://github.com/odoo/odoo/blob/5120de57bb998f4e551a815edeb158d9f17fb89a/addons/account/models/account_move.py).

## 6. Atomic operations and replay

Odoo 19 JSON-2 makes each request one SQL transaction; separate HTTP calls cannot be joined into one transaction. Expose a public engagement method that performs validation, native business changes and durable result recording together. The public method can call the private native wizard/model methods internally.

Use a unique operation key and request fingerprint, validate ordinary ACL/company access, lock the engagement and selected order before the quantity/state read, then call the source-native operation and save its original record IDs and action. On a repeated identical key, return the saved result. On a different payload with the same key, reject the mismatch. These replay/serialization measures are addon implementation recommendations derived from the inspected call chain; the base invoice path has no engagement-specific idempotency key.

Return a meaningful empty/no-invoice result if the native recordset is empty. Native `raise_if_nothing_to_invoice` defaults to true, while the sales access fallback can return an empty recordset. Preserve an actual native exception as a rolled-back operation so it can be corrected and tried again with clear intent.

Official API source: https://www.odoo.com/documentation/19.0/developer/reference/external_api.html

## 7. Report the installed source accurately

The native module model uses historically inverted field names:

| Native field | Actual meaning |
| --- | --- |
| `ir.module.module.latest_version` | Version installed in this database. |
| `ir.module.module.installed_version` | Latest manifest version currently on disk. |
| `ir.module.module.state` | Installation state. |

The original base ACL grants `ir.module.module` access to `base.group_system`, not `base.group_user`. A base-user addon profile can expose a deliberately narrow, allowlisted read-only summary of its required modules using controlled metadata elevation. Keep source paths and arbitrary module operations out of that public method.

`odoo.modules.module.get_module_path(name, display_warning=False)` returns a path or `None`; the pinned implementation delegates to `Manifest.for_addon(...)` and marks the legacy wrapper for future deprecation. Check for a missing module before reading an allowlisted source file. A manifest version alone does not establish the exact source commit; retain the chosen source revision and digest the particular original files used by the receiving run.

Sources: [module fields and constraint](https://github.com/odoo/odoo/blob/5120de57bb998f4e551a815edeb158d9f17fb89a/odoo/addons/base/models/ir_module.py); [base ACL](https://github.com/odoo/odoo/blob/5120de57bb998f4e551a815edeb158d9f17fb89a/odoo/addons/base/security/ir.model.access.csv); [module location implementation](https://github.com/odoo/odoo/blob/5120de57bb998f4e551a815edeb158d9f17fb89a/odoo/modules/module.py).

## 8. Use the original demo and full receiving path

The native module manifests select `addons/sale_timesheet/data/sale_service_demo.xml` and `addons/sale_project/data/sale_project_demo.xml`. Reuse their source XMLIDs after loading the original modules with demonstration data.

| Original XMLID | Useful source value |
| --- | --- |
| `sale_timesheet.sale_order_1` | Original confirmed order for `base.res_partner_2`, reference AGR. |
| `sale_timesheet.sale_line_13` | Senior Architect line, 25 ordered hours, 10% discount. |
| `sale_timesheet.product_service_deliver_timesheet_1` | Senior Architect, list price 200/hour, `delivered_timesheet`, `task_in_project`. |
| `sale_timesheet.product_service_deliver_timesheet_2` | Junior Architect, list price 100/hour, same native timesheet service flow. |
| `sale_timesheet.employee_jjo` | Original employee fixture. |
| `sale_project.so_template_project` | Original sales-order project template. |

The source demo calls `action_confirm()` for its original four sales orders. The Kitchen Assembly product chooses `service_type='milestones'` only when the loading user has `project.group_project_milestone`; otherwise it becomes manual. Inspect the loaded product state before selecting it for the milestone receiving journey.

The Odoo 19 CLI provides the original database and module operations. Use the same private configuration/data directory and explicit fresh database names for the complete receiving journey:

```bash
odoo-bin db -c /private/odoo.conf init obs_receiving --with-demo
odoo-bin module install -c /private/odoo.conf -d obs_receiving sale_timesheet YOUR_ADDON
odoo-bin db -c /private/odoo.conf dump obs_receiving /private/OBS_Receiving.zip
odoo-bin db -c /private/odoo.conf load obs_reopened /private/OBS_Receiving.zip --neutralize
```

`db init` initializes the minimum/base modules. The module installation command loads the selected addon and its declared dependencies using that same original runtime. Native `db dump` defaults to ZIP with its filestore and manifest. Native `db load` defaults to copying the database with a new UUID; `--move` preserves the UUID. A ZIP restore includes its filestore. A raw PostgreSQL dump uses `pg_restore`, as the Odoo CLI load path accepts ZIP.

Use an explicit dump file path. In this pinned CLI, the stdout branch invokes `dump_db(database, stdout)` without forwarding the requested format/filestore options. The original `--neutralize` restore runs neutralization before the restored database becomes visible to cron workers.

The full receiving result should retain the original order, generated project/tasks, period invoice, correction/replacement links, operation replay and restored database state together with the ZIP. Open the restored records through the original Odoo addon rather than constructing a separate viewer.

Sources: [timesheet demo](https://github.com/odoo/odoo/blob/5120de57bb998f4e551a815edeb158d9f17fb89a/addons/sale_timesheet/data/sale_service_demo.xml); [project demo](https://github.com/odoo/odoo/blob/5120de57bb998f4e551a815edeb158d9f17fb89a/addons/sale_project/data/sale_project_demo.xml); [CLI database commands](https://github.com/odoo/odoo/blob/5120de57bb998f4e551a815edeb158d9f17fb89a/odoo/cli/db.py); [CLI module commands](https://github.com/odoo/odoo/blob/5120de57bb998f4e551a815edeb158d9f17fb89a/odoo/cli/module.py); [database dump and restore](https://github.com/odoo/odoo/blob/5120de57bb998f4e551a815edeb158d9f17fb89a/odoo/service/db.py).
