# OpenCV AI Competition 2026 fit

Carrier operation: `OPENCV-2026-PROOFLINE-ZSHR5V8-20260916`.

Current public competition materials checked at TAKE time describe an online OpenCV AI Competition 2026, deadline October 26, requiring a substantive OpenCV 5 image/video analysis component and meaningful AWS usage. The specific published prize-rule schedule lists $12,000 cash across main/special awards. Advertised prizes are not earned revenue.

## Requirement mapping

- **OpenCV 5:** hard production version guard; ECC affine registration; color conversion; absolute differencing; Gaussian blur; Otsu/bounded thresholding; morphology; connected components with stats; affine warping; PNG evidence encoding.
- **Real-world problem:** auditable manufacturing/field visual QA with source-bound evidence and owner review.
- **AWS:** S3 versioned event intake, Lambda OpenCV worker, DynamoDB conditional evidence ledger, least-privilege SAM policies. This is event/custody logic used by the product, not static hosting.
- **Agentic angle:** bounded proposal generator consumes only verified visual evidence and can request human review only.
- **Reproducibility:** synthetic fixture generator produces calibrated registration + known defects without private images.

## Still open / not claimed by source merge

- live AWS stack deployment and production OpenCV 5 runtime receipt;
- competition registration / Devpost submission;
- public demo/video upload;
- any prize, judging result, payment, or revenue.
