# RES-001 operator-only positive evaluator control

This directory is **NOT an agent starter**, task hint, or candidate submission.
Never copy it into either Muse workspace or expose its source to Muse.
It stays under the external held-out harness.

`dist/server.js` implements the RES-001 HTTP contract by importing the
certified Silk Web V2 registry build from the separate operator checkout.
That dependency is **deliberate for evaluator validation**, not permitted as
a direct import in either Muse condition.

Only use it to check that the held-out evaluator recognizes a correct API
implementation and awards all 41 fixed checks (65 weighted points).

From the Silk Web development checkout:

    node experiments/harness/res001-evaluate.mjs --candidate ABSOLUTE_PATH_TO_experiments/harness/res001-reference --report ABSOLUTE_PATH_OUTSIDE_THIS_REPO

Expected: exit 0, 41/41 checks, weightedScore 100.
If it fails, inspect the private report and fix the reference control,
**not the frozen evaluator**, unless a documented evaluator defect requires
an explicit re-freeze before any paid agent runs.

No model inference calls occur in this process.
