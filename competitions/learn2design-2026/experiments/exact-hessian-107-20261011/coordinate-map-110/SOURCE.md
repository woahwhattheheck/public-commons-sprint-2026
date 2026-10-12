# ROOT110-R semantic coordinate map: Team6966 matched-run handoff

## Exact candidate

This bundle contains the corrected ROOT110-R source based on completed Root107 `ExactHessianTR104`. It adds an optional per-property map from the archived semantic data, with the default still `coordinate_map="identity"`. The mapped arm preserves the baseline physical sigmoid clip interval `sigmoid(-15)..sigmoid(15)` through per-index asymmetric coordinate bounds, restores an explicit identity sigmoid/logit pair or aborts after a partial install failure, and obtains the problem size from the documented public API.

- Corrected `candidate/submission.py` SHA-256: `0c0ffd4da1a9a55406c29dd3d0de0cac05a481dd853ff2a256b420325f46c9d0`
- Helper `candidate/l2d_coordmap.py` SHA-256: `19e0117794f92debec27a7ea1c93f6ceb01b6cfb5cb08872bed68895d774d031`
- Unified patch against exact Root107 baseline: `candidate/submission.patch`, SHA-256 `b84fe85359f2c700955cd13493af61cdec50ad105395e091169118bc4d81886c`
- Baseline `candidate/baseline/submission.py` SHA-256: `474e9191fbaa2a058257d0f616608bd207a757ec58481a1a838c2315f155ba17`
- ROOT110-R response source SHA-256: `800a34126a207b8e09669d75d41ee9cc3742f15e0c0ae08fa1296efa885a0842`
- Root107 response source SHA-256: `8f49b479d0019337a0d61c427c251950707a315b9ab60c7a833d803c59dbb019`

## Real-JAX focused result

The internal CPU-only Kaggle run used actual JAX/jaxlib 0.11.1, CPU backend (`cpu:0`), Python 3.13.15, NumPy 2.1.3, float32, and `jax_enable_x64=false`. Its candidate files and result are included under `validation/`. Nine focused cases passed, including clip-endpoint comparisons, finite/nonzero float32 autodiff across every active mapped clip interval, fail-closed property-map behavior, explicit identity restore/abort, same-seed bounded-start equivalence, public-size lookup, and the Root107 fake-Objective hook/lifecycle. This is not a UIFO physical-objective evaluation or a score result.

Result JSON SHA-256: `b965b53dc633f09bf2f6c8ed4b3e8aba313bcc11cee59c64f069b0b84885210d`.

## Requested single matched internal comparison

Please use the existing Team6966 native runner/phase workflow and an actually available, nonconflicting GPU allocation. Isolate the coordinate-map effect by using this exact corrected submission/helper hash in both arms:

- identity control: `coordinate_map="identity"` (default)
- challenger: `coordinate_map="l2d_property_v1", coordinate_map_problem_size=3`

Use the existing public held-out UIFO topology set 7/8/9, optimizer seed 42, and the established 180-second Objective budget per topology per arm, if that is the current approved matched protocol and capacity fits. If exact identity cells already exist, reuse them only if candidate source, runner, framework, hardware, Objective settings and cell condition all match this exact source and matched comparison. Otherwise run the paired cells from the bundled source. Do not combine the map with another optimizer change, change the objective/bounds/penalty, or add a separate four-hour Objective. Keep one Objective per problem/arm and preserve all histories/errors/raw artifacts.

For each cell retain: exact candidate/helper/runner hashes, topology/optimizer seed, hardware/device and Python/JAX/JAXlib versions, warm-up and logging behavior, `best_feasible_logged_loss`, feasible count/rate, time-to-first-feasible, call count, elapsed/overrun, and any Hessian OOM/failure. The two coordinate vectors are not byte-identical: compare physical starts under the active forward map; the custom inverse preserves the same bounded physical random-start distribution. A T4 result must be labeled T4, with no H100 parity claim. No official score or entry claim is requested; this is internal validation of a proposed improvement.

The runner should return a measured result or a concrete runtime/capacity failure to the original #sim-data thread. Preserve the current counted incumbent until a matched measured result supports any promotion.
