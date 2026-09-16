# TMRW Phone Call Production Master Scope

## Authority and operating contract

This file is the durable authority for the TMRW Phone call-production workstream. It exists so the work can continue safely across Codex context compaction, reloads, and separate implementation checkpoints.

- Repository: `luftmenschiv-arch/TMRW-Phone-V3`
- Working branch: `codex/phone-instant-connect-ui`
- Baseline before this scope: `b5e444ed3d26c2204ac34dcd724edfe78545535d`
- Current production target: Android/Termux SillyTavern extension at `http://127.0.0.1:8000`
- Current local voice endpoint: `http://127.0.0.1:18769`
- Implement now: checkpoints 1 through 7 below, in order
- Deferred: checkpoints 8 through 12; do not begin without later approval
- Checkpoint rule: update this file, run the listed verification, and create one focused commit for each completed checkpoint
- Failure rule: preserve deterministic cancellation and fail closed; do not manufacture text, subtitles, audio, duration, dates, or success states

## Product behavior already working — regression contract

These behaviors are already verified and must remain working:

- Instant outgoing calls do not require phone-number/story evidence.
- The exact selected character is called and answers immediately.
- The player types; the character replies with voice.
- The visible call caption is Thai while spoken text is English or Japanese.
- English/Japanese can be switched during an active call.
- Thai captions can be toggled during an active call.
- User input remains visible while the character is thinking.
- Typing is locked while the character is replying; hangup remains available.
- Hangup cancels active LLM, runtime, and playback work.
- Failed LLM generation exposes retry in the same call.
- A timed-out runtime turn resumes without duplicate synthesis.
- A failed voice segment retries once automatically.
- Same-route call updates do not flash the full `กำลังโหลด Phone...` screen.
- Opening TMRW Phone does not summon the mobile keyboard.
- Global voice settings persist across chat, branch, and reload.
- Puzzle is the temporary fallback voice for characters without a configured profile.

## Checkpoint status

| Checkpoint | Scope | Status | Commit | Evidence |
| --- | --- | --- | --- | --- |
| 0 | Durable master scope and baseline | COMPLETE | `2d1e314` | baseline below |
| 1 | Timing Diagnostics | COMPLETE | `3ea2677` | 31 focused tests passed; package verified |
| 2 | Safe speedups: warmup, health cache, connection/turn reuse | COMPLETE | `29042b2` | 33 focused tests passed; package verified |
| 3 | Real Call History dates and measured duration | COMPLETE | `de2c57b` | 36 focused tests passed; package verified |
| 4 | Call Details and ordered transcript | COMPLETE | `391102d` | 35 focused tests passed; package verified |
| 5 | Persistent audio replay, download, retention, and Kept archive | COMPLETE | `da98929` | 41 focused tests passed; package verified |
| 6 | Incremental LLM first segment to TTS | COMPLETE (safe provider fallback) | `614fcc2` | 16 focused tests passed; package verified |
| 7 | Truthful, non-duplicated language/settings behavior | COMPLETE | `13ca624` | 35 focused tests passed; package verified; Android deployed |
| 8 | One-click Runtime/Model installation | DEFERRED | — | later approval required |
| 9 | TMRW Voice Companion | DEFERRED | — | later approval required |
| 10 | Contextual incoming character calls | DEFERRED | — | later approval required |
| 11 | Continue Story After Calls | DEFERRED | — | later approval required |
| 12 | Voice presets and cloning | DEFERRED | — | later approval required |

## Checkpoint 1 — Timing Diagnostics

Capture one bounded record per call turn with stable identifiers and timestamps/durations for:

- user submit
- LLM start, first output when technically observable, and completion
- structured-response validation
- runtime health/warm state
- turn start and chunk push
- synthesis start/ready per segment
- audio fetch ready per segment
- playback start/end per segment
- total time to first audible audio and total turn time

Requirements:

- diagnostics are read-only evidence and never alter generation behavior
- no private reasoning or provider secrets are persisted
- bounded retention prevents unbounded growth
- Diagnostics UI distinguishes LLM, runtime, synthesis, fetch, and playback latency

## Checkpoint 2 — Safe speedups

- Warm the selected local language runtime/model when a call becomes active.
- Warm the newly selected language when language changes during a call.
- Cache successful runtime readiness per endpoint/language for the active call.
- Invalidate readiness on endpoint/language change, runtime failure, or call end.
- Do not issue a redundant health request for every reply.
- Continue using one runtime turn for all segments of a reply.
- Verify that segment N+1 synthesis overlaps playback of segment N.
- Cancel warmup, synthesis, fetch, and playback immediately on hangup.

## Checkpoint 3 — Real Call History dates and duration

- Remove hard-coded repeated `Today` headings.
- Group calls once under Today, Yesterday, or a real local date.
- Show the real call start time and newest calls first.
- Measure connected duration from accepted/active transition to end.
- Ringing time is not connected duration.
- Duration survives reload and is canonical for history/detail/ended surfaces.
- Never write literal zero as the duration of every ended call.

## Checkpoint 4 — Call Details and transcript

Clicking a history row opens Call Details, not the ended-call control surface.

Call Details includes:

- counterpart identity and avatar
- incoming/outgoing state
- date, start time, status, and duration
- language used by available voice segments
- player and character transcript entries in canonical turn order
- Thai subtitle plus spoken English/Japanese metadata where available
- callback action where the current mode permits it

Transcript/history remains scoped to its exact Story and Branch and is not injected visibly into the main RP chat.

## Checkpoint 5 — Persistent call audio

- Persist actual audio bytes, not temporary Blob URLs.
- Bind each segment to Story, Branch, call session, transcript entry, character identity, language, order, duration, subtitle, and spoken text.
- Support per-segment play/pause and sequential whole-call replay.
- Prevent overlapping playback.
- Support per-segment download with stable filenames.
- Default temporary retention proposal: newest 20 calls or 200 MB, whichever limit is reached first.
- Evict oldest unkept audio first; never auto-delete Kept audio.
- `เก็บสายนี้ไว้` marks the call audio Kept.
- Show temporary/Kept/total storage usage and allow explicit temporary cleanup.
- Deleting audio never deletes canonical transcript/history.
- Browser Kept protects against app eviction only; download is the durable user-owned copy.
- Already-released historical Blob URLs are not represented as recoverable audio.

## Checkpoint 6 — Incremental LLM to first-segment TTS

- Do not wait for the entire multi-segment answer before synthesizing a complete first segment.
- Use a deterministic, bounded framing protocol for complete `subtitle_th` + `spoken_text` pairs.
- Validate each complete pair before sending it to voice.
- Never speak partial JSON, partial strings, narration, or malformed content.
- Continue later LLM segments while the first segment synthesizes/plays when the SillyTavern provider path permits streaming.
- Preserve names, terms of address, emotion, and meaning between Thai subtitle and spoken output.
- Preserve manual LLM retry and per-segment voice retry semantics.
- If the provider cannot expose safe incremental output, retain the complete-response path rather than simulate streaming.

## Checkpoint 7 — Truthful language/settings behavior

- `ภาษาที่ใช้ในการโทรตอนนี้` is the single authoritative active language control.
- English and Japanese are mutually exclusive and hot-switchable during a call.
- Per-character voice profile controls voice identity/preset; it must not silently compete with the active global language.
- Remove, hide, or accurately relabel the currently ineffective per-character language choice.
- Verify every Natural/Soft/Expressive control affects the runtime; otherwise label it unavailable instead of pretending it works.
- Preserve global Voice Calls, character voice, Thai captions, active language, delivery, and installed-runtime state across chat/branch/reload.

## Deferred scope — checkpoints 8 through 12

### 8. One-click Runtime/Model installation

Runtime, English, and Japanese have separate install/detect controls. Installed assets are detected without duplicate download; only one language is active. Manual endpoint editing moves to Advanced.

### 9. TMRW Voice Companion

Android/iOS companion owns offline runtime, model installation, durable audio storage, health, and export while the call UI remains in SillyTavern/Safari where practical.

### 10. Contextual incoming character calls

Context-aware incoming call decision, incoming UI, accept/decline, correct identity, character speaks first, and the same transcript/audio history contract.

### 11. Continue Story After Calls

Optionally continue the main RP after hangup with call context available to the character without dumping raw transcript into the visible chat or generating twice.

### 12. Voice presets and cloning

Preset selection, sample validation, preview, per-character binding, privacy controls, delete/replace, and English/Japanese capability reporting.

## Verification log

### Baseline — 2026-09-17

Parent commit: `b5e444ed3d26c2204ac34dcd724edfe78545535d`

Commands:

```powershell
node --test tests/phase23/outbound-call-playable.test.mjs tests/phase23/instant-connect.test.mjs tests/phase23/context-identity.test.mjs
npm run build:production-package
npm run verify:production-package
```

Recorded result before this scope:

- targeted tests: 29 passed, 0 failed
- production package: 239 files, 729 import edges
- package verification: passed
- deployed Android extension HEAD: `b5e444ed3d26c2204ac34dcd724edfe78545535d`

Every later checkpoint appends its exact commands, pass/fail counts, package verification, commit, and deployment status below this section.

### Checkpoint 1 — Timing Diagnostics — 2026-09-17

Implemented bounded, content-free per-turn timing evidence for user submit, LLM start/completion, structured validation, runtime readiness, runtime turn/chunk setup, synthesis, audio fetch, and playback. Diagnostics retains at most 32 turns and 96 events per turn, and explicitly records that prompt, transcript, spoken text, provider secrets, and reasoning are not stored.

Commands:

```powershell
node --test tests/phase23/call-timing-diagnostics.test.mjs tests/phase23/outbound-call-playable.test.mjs tests/phase23/instant-connect.test.mjs tests/phase23/context-identity.test.mjs
npm run build:production-package
npm run verify:production-package
```

Recorded result:

- focused tests: 31 passed, 0 failed
- production package: 240 files, 730 import edges
- package verification: passed
- deployment: pending checkpoint commit

### Checkpoint 2 — Safe speedups — 2026-09-17

Implemented active-call readiness warmup against the selected endpoint/language, per-call readiness caching, hot-language-switch invalidation, endpoint-change invalidation, runtime-failure invalidation, and hangup cancellation. The runtime's resident engine/model readiness is warmed without manufacturing dummy speech. The existing single-turn multi-segment runtime contract is preserved, and segment N+1 starts rendering before playback of segment N.

Commands:

```powershell
node --test tests/phase23/call-timing-diagnostics.test.mjs tests/phase23/outbound-call-playable.test.mjs tests/phase23/instant-connect.test.mjs tests/phase23/context-identity.test.mjs
npm run build:production-package
npm run verify:production-package
```

Recorded result:

- focused tests: 33 passed, 0 failed
- production package: 240 files, 730 import edges
- package verification: passed
- checkpoint 1 Android deployment: `3ea26778ed1b26c6e04422ad462f7867b8dfc708`
- checkpoint 2 Android deployment: pending checkpoint commit

### Checkpoint 3 — Real Call History dates and measured duration — 2026-09-17

Persisted canonical call start, connected, and end timestamps. Call History now groups entries once by local Today/Yesterday/date and displays the actual call start time. Ending an active call measures from its accepted/active timestamp, persists that duration as canonical call evidence, and no longer writes a literal `0` duration from the production shell.

Commands:

```powershell
node --test tests/phase23/call-history-production.test.mjs tests/phase23/call-timing-diagnostics.test.mjs tests/phase23/outbound-call-playable.test.mjs tests/phase23/instant-connect.test.mjs tests/phase23/context-identity.test.mjs
npm run build:production-package
npm run verify:production-package
```

Recorded result:

- focused tests: 36 passed, 0 failed
- production package: 240 files, 730 import edges
- package verification: passed
- checkpoint 2 Android deployment: pending
- checkpoint 3 Android deployment: pending checkpoint commit

### Checkpoint 4 — Call Details and ordered transcript — 2026-09-17

Added a dedicated Call Details route-state so tapping terminal history no longer presents the ended-call control surface. Details shows the counterpart/avatar, direction, local date and start time, terminal state, measured duration, available voice-language metadata, canonical player/character turns in source-event order, and a scoped callback action when the counterpart is currently callable. Queries remain fenced to the exact Story/Branch; the transcript is not written into the visible main RP chat.

Commands:

```powershell
node --test tests/phase23/call-history-production.test.mjs tests/phase23/instant-connect.test.mjs tests/phase23/outbound-call-playable.test.mjs
npm run build:production-package
npm run verify:production-package
```

Recorded result:

- focused tests: 35 passed, 0 failed
- production package: 241 files, 731 import edges
- package verification: passed
- checkpoint 4 Android deployment: pending checkpoint commit

### Checkpoint 5 — Persistent audio replay, download, retention, and Kept archive — 2026-09-17

Persisted the actual runtime WAV Blob before its temporary playback URL is released, bound to the exact Story/Branch, call, transcript, character Actor/Instance, language, segment order, duration, Thai subtitle, spoken text, MIME type, size, and stable filename. Call Details now supports sequential whole-call replay, non-overlapping per-segment replay, pause/resume, stop, per-segment download, `เก็บสายนี้ไว้`, storage totals, and explicit temporary cleanup. Temporary retention keeps the newest 20 calls or 200 MB and evicts the oldest unkept call audio first; Kept audio is protected. Audio cleanup does not touch canonical call transcript/history. Historical rows without actual Blob bytes are truthfully non-recoverable.

Commands:

```powershell
node --test tests/phase23/persistent-call-audio.test.mjs tests/phase23/call-history-production.test.mjs tests/phase23/call-timing-diagnostics.test.mjs tests/phase23/outbound-call-playable.test.mjs tests/phase23/instant-connect.test.mjs tests/phase23/context-identity.test.mjs
npm test
npm run test:p23-f
npm run build:production-package
npm run verify:production-package
```

Recorded result:

- focused production-call tests: 41 passed, 0 failed
- production package: 241 files, 731 import edges
- package verification: passed
- full legacy aggregate gate: could not start affected files because tracked test imports reference absent fixture files (`tests/phase17/notification-fixtures.mjs`, `tests/phase8/messaging-fixtures.mjs`, `tests/phase7/ui-fixtures.mjs`, and `tests/phase1/test-helpers.mjs`); independent production-composition files that could load reported 80 passes before the missing-fixture/package-script baseline failures
- checkpoint 5 Android deployment: included in final checkpoint 7 deployment

### Checkpoint 6 — Safe incremental LLM capability boundary — 2026-09-17

Inspected the exact SillyTavern generation surface installed on the Android target. Both `generateQuietPrompt()` and `generateRaw()` return a single `Promise` after the provider response completes; their public parameter contracts expose no token, frame, or complete-segment streaming callback. The call coordinator therefore keeps the strict complete structured-response path instead of speaking partial JSON. It now publishes the truthful `complete-response` delivery mode and the reason `sillytavern-generation-api-has-no-safe-stream` in the prepared reply, policy, and timing diagnostics. Existing complete bilingual-pair validation, manual LLM retry, one automatic voice-segment retry, and safe background synthesis of later TTS segments remain intact.

Inspection and verification commands:

```powershell
adb -s 192.168.100.125:41429 shell run-as com.termux sed -n '3050,3135p' files/home/SillyTavern/public/script.js
adb -s 192.168.100.125:41429 shell run-as com.termux sed -n '3970,4150p' files/home/SillyTavern/public/script.js
adb -s 192.168.100.125:41429 shell run-as com.termux grep -R -n "generateQuietPromptStream\|stream.*callback\|onStream" files/home/SillyTavern/public/scripts/st-context.js files/home/SillyTavern/public/script.js
node --test tests/phase23/outbound-call-playable.test.mjs tests/phase23/call-timing-diagnostics.test.mjs
npm run build:production-package
npm run verify:production-package
```

Recorded result:

- installed SillyTavern public generation contract: complete Promise only; no safe incremental callback found
- focused tests: 16 passed, 0 failed
- production package: 241 files, 731 import edges
- package verification: passed
- checkpoint 6 Android deployment: included in final checkpoint 7 deployment

### Checkpoint 7 — Truthful language/settings behavior — 2026-09-17

Made `ภาษาที่ใช้ในการโทรตอนนี้` the only active language selector. English and Japanese remain mutually exclusive, global, persistent, and hot-switchable; character profiles now control voice identity only and explicitly say that they use the active call language. Removed the duplicate base/instance language buttons. The generation and playback paths no longer fall back to a character-profile language when the global value is unset; English is the deterministic migration default until the global setting is selected or detected. Replaced the non-functional Natural/Soft/Expressive selector with truthful text: Natural is active and the current runtime does not yet support Soft or Expressive. Also removed stale copy claiming that a failed voice turn silently becomes a text call.

Commands:

```powershell
node --test tests/phase23/presentation-correction.test.mjs tests/phase23/outbound-call-playable.test.mjs tests/phase23/instant-connect.test.mjs
npm run build:production-package
npm run verify:production-package
```

Recorded result:

- focused settings/call tests: 35 passed, 0 failed
- production package: 241 files, 731 import edges
- package verification: passed
- Android deployment: fast-forwarded clean Termux worktree from `3ea2677` to `13ca624`
- deployed-file smoke check: authoritative language label found in the live extension tree

Deployment commands:

```powershell
git bundle create C:\ai\tmrw-phone-checkpoints-1-7.bundle codex/phone-instant-connect-ui
adb -s 192.168.100.125:41429 push C:\ai\tmrw-phone-checkpoints-1-7.bundle /data/local/tmp/tmrw-phone-checkpoints-1-7.bundle
adb -s 192.168.100.125:41429 shell run-as com.termux files/usr/bin/git -C files/home/SillyTavern/data/default-user/extensions/TMRW-Phone-V3 fetch /data/local/tmp/tmrw-phone-checkpoints-1-7.bundle codex/phone-instant-connect-ui:refs/remotes/local-deploy/codex/phone-instant-connect-ui
adb -s 192.168.100.125:41429 shell run-as com.termux files/usr/bin/git -C files/home/SillyTavern/data/default-user/extensions/TMRW-Phone-V3 merge --ff-only refs/remotes/local-deploy/codex/phone-instant-connect-ui
```
