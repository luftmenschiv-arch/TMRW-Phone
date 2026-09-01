# TMRW—Phone V3

Private synchronization repository for the qualified TMRW Extension production candidate through Phase 23.

Phase 21, Phase 22, and Phase 23 are PASS / CLOSED. Phase 24 is NOT STARTED.

Qualification retained here includes P23-D 21/21 focused and 114/114 affected regression, P23-E 127/127 cross-app UX, and P23-F 153/153 Production lifecycle qualification. Phase23 patch1 corrected the real-Android Preview37 Thread→Message dependency defect. Patch2 proved Production activation but failed Product Owner visual acceptance. Patch3 directly ports the retained Preview37 UI/interaction shell and app presentation, retains the recovered Call UI authority, preserves Production canonical behavior, closes the two post-port content regressions, and passes the bounded direct-Preview qualification (7/7) plus the same 109/109 affected regression set. See `TMRW-PHASE23-AUDIT-MATRIX.md` for the durable matrix.

Preview37 remains returnable. Autonomous Social and Live AI boundaries remain disabled. Real Voice/TTS runtime is not integrated in Phase23. Production package `auto_update` remains `false`.

Build with `npm run build:production-package`, verify with `npm run verify:production-package`, run the dependency patch gate with `npm run test:p23-patch`, run the designed-home patch gate with `npm run test:p23-ui-patch`, run Phase23 UX qualification with `npm run test:p23-e`, and run lifecycle qualification with `npm run test:p23-f`.

Real-Android activation reached the Production V3 shell successfully. Patch2 corrected the raw grid but failed Product Owner visual acceptance because it remained a Production interpretation rather than the retained Preview37 product UI. Patch3 is the qualified direct-Preview candidate and now requires supported Android update plus Product Owner visual inspection. Activation/return must continue through supported Production controls and Preview37 must remain returnable.

Do not commit local user data, local QA/browser state, model assets, experiments, or secret local files.
