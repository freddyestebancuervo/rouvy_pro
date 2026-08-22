# Korixa Night Agent — Session Report Template

Every Night Agent session (once real execution exists, post-V1) must produce
a report matching this shape. Fill every field — no field may be silently
omitted.

```
==============================
SESSION
==============================

SESSION_ID =
START_TIME =
END_TIME =
BASE_SHA =
REMOTE_MAIN_PRE =
REMOTE_MAIN_POST =

TASKS_TOTAL =
TASKS_PASS =
TASKS_HOLD =
TASKS_BLOCKED =
TASKS_SKIPPED =


==============================
PER-TASK (repeat for each task)
==============================

ID =
RISK =
STATUS =
ATTEMPTS =
FILES_CHANGED = [...]
CHECKS = [...]
COMMIT_SHA =
BLOCKER =
NEXT_ACTION =


==============================
GLOBAL
==============================

UNAUTHORIZED_MUTATIONS = 0
PRODUCTION_MUTATIONS = 0
MAIN_MUTATIONS = 0
ROOT_MUTATIONS = 0
SECRET_EXPOSURE = NO
```

All `GLOBAL` fields are expected to be `0`/`NO` unless an explicit, separate
authorization for that exact mutation exists and is cited by ID. A non-zero
value here in a V1/V1-derived session is itself a `SESSION_HALT`-worthy
finding, not something to note in passing.
