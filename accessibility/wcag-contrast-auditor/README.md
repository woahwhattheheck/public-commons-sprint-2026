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

## Run the tests

```bash
python -m unittest -v test_contrast.py
python -O -m unittest -v test_contrast.py
```

The regression suite covers color parsing, the 1:1 and 21:1 extrema, order independence, a pair on either side of the AA 4.5:1 boundary, AA/AAA large-text thresholds, JSON output, and CLI exit codes.

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
