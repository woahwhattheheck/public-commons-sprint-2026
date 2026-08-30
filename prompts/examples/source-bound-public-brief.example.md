# Example: source-bound public brief

This example contains no personal data and can be used offline.

## Placeholder values

- `AUDIENCE`: Residents who use the neighborhood cooling room
- `GOAL`: Explain the measured opening hours and identify missing accessibility information
- `FORMAT`: Plain-text bulletin
- `WORD_LIMIT`: 180 words
- `CONSTRAINTS`: Use short sentences; do not imply services not listed
- `EXPERT_REVIEW_TOPICS`: Accessibility and heat-safety advice
- `SOURCE_PACKET`:

```text
[S1] Flyer, revision 2: "Cooling room open Tuesday and Thursday, 14:00–18:00, through 31 August."
[S2] Facilities note: "Step-free entrance status has not been measured."
[S3] Transit note: "Bus route information was not supplied."
```

## What a valid response must demonstrate

- The Tuesday/Thursday hours cite `[S1]`.
- Step-free access is reported as unknown using `[S2]`; it is not guessed.
- Bus information is reported as unknown using `[S3]`.
- Any heat-safety or accessibility recommendation is marked
  `Needs expert review`.
- No phone number, address, transit route, medical instruction, or extra opening
  day is invented.
- The response ends with the template's exact evidence-boundary line.

This is a structural example, not a claim that the cooling room exists.
