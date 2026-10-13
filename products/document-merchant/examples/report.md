# Example daily dispatch report

**Demonstration source.** All counts and operating events below are example content.

Task reference: example-operations-report  
Reporting day: 12 October 2026

## Dispatch position

The example operation received **340 orders**, dispatched **333**, and retained **seven** for the next review. The report carries the counts and outstanding work together.

| Product group | Received | Dispatched | Outstanding |
| --- | ---: | ---: | ---: |
| Office supplies | 112 | 109 | 3 |
| Workshop equipment | 94 | 91 | 3 |
| Packaging materials | 76 | 75 | 1 |
| Cleaning supplies | 58 | 58 | 0 |
| **Total** | **340** | **333** | **7** |

## Next shift

1. Confirm the replacement shipment for three workshop orders.
2. Confirm carton selection for three office orders.
3. Complete the destination detail for one packaging order.

Keep the original customer order references with each change. A report is useful when the next operator can act from it without reconstructing the source table.

## Customer review

Open the finished PDF and check that every row and the complete handover are present. Review table width, wrapped text and page numbering.

The editable Markdown remains part of the delivery. A customer can change the reporting day and source rows without retyping the PDF.

Unicode source text: café, résumé, España and an en dash –.

## Delivered files

- **document.pdf**: the complete finished document.
- **source.md**: this unchanged editable source.
- **request.json**: the original task title, reference and selected document settings.
- **render.json**: the actual provider operation and complete received PDF metadata.

Supplier requests, document pages and the merchant's original paid customer task remain separate quantities.
