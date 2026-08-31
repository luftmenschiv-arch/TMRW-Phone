# TMRW—Phone V3

Private synchronization repository for the qualified TMRW Extension production candidate through Phase 23.

Phase 21, Phase 22, and Phase 23 are PASS / CLOSED. Phase 24 is NOT STARTED.

Qualification retained here includes P23-D 21/21 focused and 114/114 affected regression, P23-E 127/127 cross-app UX, and P23-F 153/153 Production lifecycle qualification. See `TMRW-PHASE23-AUDIT-MATRIX.md` for the durable matrix.

Preview37 remains returnable. Autonomous Social and Live AI boundaries remain disabled. Real Voice/TTS runtime is not integrated in Phase23. Production package `auto_update` remains `false`.

Build with `npm run build:production-package`, verify with `npm run verify:production-package`, run Phase23 UX qualification with `npm run test:p23-e`, and run lifecycle qualification with `npm run test:p23-f`.

Do not commit local user data, local QA/browser state, model assets, experiments, or secret local files.
