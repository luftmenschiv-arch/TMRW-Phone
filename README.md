# TMRW—Phone V3

Private synchronization repository for the qualified TMRW Extension production candidate through Phase 23.

Phase 21, Phase 22, and Phase 23 are PASS / CLOSED. Phase 24 is NOT STARTED.

Qualification retained here includes P23-D 21/21 focused and 114/114 affected regression, P23-E 127/127 cross-app UX, and P23-F 153/153 Production lifecycle qualification. Phase23 patch1 corrected the real-Android Preview37 Thread→Message dependency defect (12/12 dedicated, 35/35 focused migration, 81/81 directly affected activation regressions). Phase23 patch2 corrects the subsequently demonstrated Production-home presentation defect while retaining all real app wiring (54/54 focused shell/navigation and 131/131 UI-only current-release cross-app regressions). See `TMRW-PHASE23-AUDIT-MATRIX.md` for the durable matrix.

Preview37 remains returnable. Autonomous Social and Live AI boundaries remain disabled. Real Voice/TTS runtime is not integrated in Phase23. Production package `auto_update` remains `false`.

Build with `npm run build:production-package`, verify with `npm run verify:production-package`, run the dependency patch gate with `npm run test:p23-patch`, run the designed-home patch gate with `npm run test:p23-ui-patch`, run Phase23 UX qualification with `npm run test:p23-e`, and run lifecycle qualification with `npm run test:p23-f`.

Real-Android activation of patch1 reached the Production V3 shell successfully and exposed the raw-grid launcher presentation defect now corrected by patch2. Patch2 still requires Product Owner update plus real-device visual confirmation; activation/return must continue through supported Production controls and Preview37 must remain returnable.

Do not commit local user data, local QA/browser state, model assets, experiments, or secret local files.
