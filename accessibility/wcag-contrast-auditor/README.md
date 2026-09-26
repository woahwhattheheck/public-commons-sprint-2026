# Offline WCAG 2.x Contrast Auditor

A tiny, dependency-free command-line checker for text foreground/background color contrast. It is designed for classrooms, nonprofits, accessibility reviews, and low-connectivity environments where installing a browser extension or package is inconvenient.

## What it checks

The script implements the WCAG 2.x sRGB relative-luminance and contrast-ratio calculation and compares a color pair with the text thresholds below.

| Conformance | Normal text | Large text |
| --- | ---: | ---: |
| AA | 4.5:1 | 3.0:1 |
| AAA | 7.0:1 | 4.5:1 |

`--large-text` only selects the large-text threshold. The script does **not** decide whether a font's rendered size and weight qualify as large text; the reviewer must make that classification from the page being audited.

## Requirements

Python 3.9+ and the standard library only. No network access is used.

## Examples

```bash
python contrast.py '#111111' '#FFFFFF'
python contrast.py '#777' '#fff' --large-text
python contrast.py '#767676' '#FFFFFF' --level AA --json
```

Exit codes are automation-friendly:

- `0` — the pair meets the requested threshold;
- `1` — the pair is valid but does not meet the requested threshold;
- `2` — invalid arguments or color syntax.

Accepted colors are three- or six-digit sRGB hex values, with or without `#`.

## Audit a palette

Use `--csv` to evaluate multiple named pairs without invoking the tool once per
pair. CSV files use UTF-8 (an optional byte-order mark is accepted).

```csv
name,foreground,background,level,large_text
Body text,#111111,#FFFFFF,AA,false
Large heading,#777,#fff,AA,true
Secondary text,#767676,#FFFFFF,,
```

```bash
python contrast.py --csv palette.csv
python contrast.py --csv palette.csv --json
cat palette.csv | python contrast.py --csv - --level AAA
```

`foreground` and `background` are required columns. `name`, `level`, and
`large_text` are optional; column order is flexible. Headers must be unique and
use those exact names. Empty `level` and `large_text` cells inherit the command's
`--level` and `--large-text` settings (AA and normal text by default).
`large_text` accepts only `true` or `false`, ignoring case. A row can explicitly
use `false` to select normal text even when the command uses `--large-text`.

Every record gets PASS, FAIL, or ERROR, its record number and ending source line.
JSON includes the original cells, normalized colors, threshold, and summary
counts. Invalid colors, levels, booleans, or cell counts produce row errors while
the rest of the palette is still evaluated. Empty files, invalid headers,
unreadable files, and malformed CSV quoting abort the audit. A palette must
contain at least one pair. Quotes and embedded commas follow normal CSV rules.

The process exits `2` if any row has an error, otherwise `1` if any pair fails,
otherwise `0`. Pass/fail uses the full calculated ratio before display rounding.
`--csv` cannot be combined with positional colors. All processing stays local;
the tool reads the CSV and writes the report to standard output.

## Single-pair verification

```bash
python contrast.py '#000' '#fff' --json
python contrast.py '#777' '#fff' --json
```

Black on white returns 21:1 and exit 0. `#777` on white is below the normal-text
AA threshold and returns exit 1, even if a shortened display appears near 4.5:1.

## Verification notes and limitations

- This is a **WCAG 2.x contrast-ratio** helper for text color pairs. It is not a complete WCAG audit.
- It does not inspect font size/weight, gradients, background images, opacity/compositing, focus indicators, icons, or non-text contrast.
- It does not implement APCA or any future WCAG 3 conformance model.
- A passing ratio does not by itself make a page accessible; keyboard access, semantics, zoom/reflow, motion, labels, language, and other requirements still need review.
- The calculation uses the WCAG sRGB linearization breakpoint `0.04045` and coefficients `0.2126`, `0.7152`, `0.0722`.

For normative accessibility decisions, verify against the current W3C WCAG specification and applicable organizational/legal requirements.

## Primary sources

- W3C, *Web Content Accessibility Guidelines (WCAG) 2.2*: https://www.w3.org/TR/WCAG22/
- W3C Technique G18, 4.5:1 text contrast calculation: https://www.w3.org/WAI/WCAG22/Techniques/general/G18.html
- W3C Technique G17, 7:1 enhanced text contrast: https://www.w3.org/WAI/WCAG22/Techniques/general/G17
- W3C Technique G145, 3:1 large-text contrast: https://www.w3.org/WAI/WCAG22/Techniques/general/G145

## License

Code in this folder is provided under the repository's MIT license.
