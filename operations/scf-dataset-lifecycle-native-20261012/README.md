# NDJSON managed release and customer continuity

This retained operation runs the original NDJSON source workspace, SF82 managed
release system, SF30 dataset version controller, SF100 data-room writer and SF88
verified receiver in one complete two-edition workflow.

The Python driver creates two original source editions, prepares their merchant
and managed release packages, and invokes merchant.mjs. The merchant driver
stages and initializes the first release, starts its seller, publishes the next
dataset with current snapshot/revision guards, continues an old cursor, retains
both original complete page chains, activates and restores retained editions,
and reopens the merchant and its stopped version store. Python then receives
both finalized data rooms, reconstructs their source and mapping, performs the
native exact-number query and keyed comparison, and reopens the exported
original project.

Run from a complete source checkout with Node 22+ and Python 3. Use an absent
output directory under an existing private parent:

~~~sh
python3 -B operations/scf-dataset-lifecycle-native-20261012/ndjson.py \
  --checkout /absolute/original/checkout \
  --output /private/ndjson-lifecycle-operation \
  --terms /absolute/original/checkout/operations/scf-dataset-lifecycle-native-20261012/terms.example.json \
  --root-driver /absolute/original/checkout/operations/scf-dataset-lifecycle-native-20261012/merchant.mjs \
  --node node
~~~

The checked-in terms are the example challenge-mode inputs for this software
operation. The original public route produces HTTP402; its private authenticated
dataset controller supplies the native data pages used by the source delivery.
The resulting native-outcome.json records the actual controller, data-room,
restoration and project outcomes.

The operation preserves integer 9007199254740993 and the exact decimal change
from 0.123456789012345678901 to 0.123456789012345678902. The two-edition mapping
also exercises nested JSON and missing, null and empty values. Its keyed
comparison has one added, one removed, one changed and one unchanged record.

Source preparation leaves the selected version-store directory absent until
explicit initialization. Repeated preparation reuses the exact retained package.
A live initialization reuses the running original instance, and a stopped-store
initialization preserves its current snapshot and revision.
