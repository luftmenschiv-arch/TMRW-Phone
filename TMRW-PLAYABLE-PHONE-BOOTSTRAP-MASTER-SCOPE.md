# TMRW Phone Playable Bootstrap Master Scope

## Authority and outcome

This document is the durable implementation authority for turning the current TMRW Phone production extension into a playable, one-click phone experience.

- Repository: `luftmenschiv-arch/TMRW-Phone-V3`
- Branch: `codex/phone-instant-connect-ui`
- Baseline: `18592f9`
- Product entry point: one Settings action, `ทำให้มือถือพร้อมเล่น`, which becomes `อัปเดตมือถือให้ทันเรื่อง` after the first successful run
- Existing call behavior is a regression contract and must remain playable
- Preview37 is retired. It is not a content source, bootstrap authority, or runtime dependency for this workstream.
- Every checkpoint must be tested, recorded here, committed, and pushed before the next checkpoint is closed.

## Product rules

- A Character Card is a story/cast container. One card may produce multiple Actors and one phone per important character.
- Bootstrap reads the current card, lore/context available from SillyTavern, and existing chat history.
- Quick Start establishes the current playable state first; Deep Backfill imports older history in bounded chunks.
- Re-running bootstrap is idempotent and delta-based. It must not duplicate records or overwrite user-locked state.
- Canon evidence wins. Plausible simulation may fill gaps but may not contradict canon.
- Their Phone is inspection-only in this release. My Phone retains explicit user actions.
- External media generation is forbidden. An optional Image API may search/select existing images. An optional Voice API powers voice calls and archives.
- The phone remains usable when neither optional API is configured.
- Feed refresh must reveal content. A bounded content buffer prevents one LLM request per gesture.

## Checkpoints

| # | Scope | Status | Commit | Verification |
|---|---|---|---|---|
| 0 | Durable scope and baseline | COMPLETE | `2d22fe8` | scope committed and pushed |
| 1 | Stable Phone Shell navigation and home-page restoration | COMPLETE | `3043042` | 33 focused tests passed; package verified |
| 2 | Cast Manifest and bounded RP history reader | COMPLETE | `54b1e9a` | 2 focused tests passed |
| 3 | Quick Start plus resumable Deep Backfill orchestration | COMPLETE | `58b027b` | 4 focused tests passed |
| 4 | One-click Settings bootstrap/update experience | COMPLETE | `798e579` | 15 focused tests passed; package verified |
| 5 | Initial Phone Seed and shared living UI states | COMPLETE | `beb23b4` | 13 focused tests passed; package verified |
| 6 | Adaptive World Pulse and guaranteed Feed buffer refresh | COMPLETE | `7ff9940` | 30 focused tests passed; package verified |
| 7 | App wiring, provider capability settings, and production package closure | COMPLETE | `92fea77` | 58 focused tests passed; package verified |

## Checkpoint 1 — stable Phone Shell

- Preserve Home page when opening and closing an app.
- Preserve page independently per selected Device.
- Preserve the selected Device and Home page across hide/show in the mounted session.
- Keep Back/Home behavior deterministic and avoid recreating unrelated presentation state.
- Preserve existing keyboard, viewport, call, and route regression behavior.

## Checkpoint 2 — Cast Manifest and history reader

- Extract a bounded, stable cast proposal from card metadata, character description/personality/scenario, world/lore context exposed by the host, and chat history.
- Support a single Character Card containing many narrative characters.
- Distinguish important recurring characters from incidental named mentions.
- Generate stable source Actor IDs independent of display-name casing.
- Read long chat history as bounded chunks with source ordinals and stable fingerprints.
- Never depend on Preview37 records.

## Checkpoint 3 — Quick Start and Deep Backfill

- Quick Start uses card/context plus recent messages to make the phone usable first.
- Deep Backfill processes older chunks, records a checkpoint, and resumes safely.
- A second run reads only unprocessed or revised history.
- Bootstrap identity expansion preserves the current player identity and existing cast.
- New Devices and Accounts receive canonical Phone state initialization.
- Failure keeps the last committed checkpoint and exposes retry.

## Checkpoint 4 — one-click experience

- Settings contains one prominent magic action with plain Thai copy.
- Progress is visible and animated; it includes cast, current-state, backfill, seed, and ready stages.
- The phone becomes usable after Quick Start while Deep Backfill may continue.
- The completed action changes to update wording.
- Errors retain progress and provide same-button retry.

## Checkpoint 5 — Initial Phone Seed and living states

- Seed contextual, non-empty baseline records without inventing high-impact canon.
- Seed records are explicitly marked `plausible-simulation` or `story-canon`.
- Shared loading, empty, error, offline, and ready UI states use one visual language.
- Empty states are contextual and useful; normal bootstrapped phones should not look factory-empty.

## Checkpoint 6 — Adaptive World Pulse and Feed buffer

- One pulse evaluates the Story/Branch and relevant Devices together.
- Manual Feed refresh guarantees additional readable items by consuming a buffer.
- Refill occurs in batches and is idempotent; one refresh gesture does not equal one LLM call.
- Thai-netizen feed items use varied persistent voices and may add color without asserting high-impact canon.
- My Phone explicit wallet income/expense evidence can update balances automatically and must not double-apply.

## Checkpoint 7 — app/provider closure

- Connect bootstrap outputs to existing Contacts, Messages, Feed, Gallery, Wallet, Shop, Calendar, Weather, Health, Notes, and related projections where their current domain supports it.
- Expose exactly two optional provider capability areas in Settings: Image API and Voice API.
- Image API is selection/search only and uses safe, no-people-by-default contextual queries.
- Voice API reflects the existing TMRW Voice Companion/runtime capability.
- Run focused tests, full Phase23/production tests, build and verify the production package, deploy/push, and record exact results below.

## Verification log

### Baseline — 2026-09-17

Commands:

```powershell
git status --short --branch
git log -1 --oneline
```

Result:

- worktree clean
- branch synchronized with `origin/codex/phone-instant-connect-ui`
- HEAD `18592f9 Record dialpad UI deployment`

### Checkpoint 1 — 2026-09-17

Implemented settled-swipe page capture, immediate restored-page presentation, and per-Device Home page memory in the mounted Phone Shell. Opening and closing an app no longer loses the page from which it was launched, and switching phones does not leak one owner's Home page into another owner's phone.

Commands:

```powershell
node --test tests/phase23/playable-shell-navigation.test.mjs tests/phase23/instant-connect.test.mjs tests/phase23/outbound-call-playable.test.mjs
npm run build:production-package
npm run verify:production-package
```

Result:

- focused tests: 33 passed, 0 failed
- production package: 241 files, 731 import edges
- package verification: passed

### Checkpoint 2 — 2026-09-17

Added a Preview-independent Cast Manifest extractor for declared card casts, SillyTavern groups, active single-character cards, structured card text, and recurring dialogue speakers. Candidate confidence prevents incidental names from automatically receiving phones. Added a bounded RP history reader with stable source ordinals, revision fingerprints, character/message chunk limits, and a recent-history window for Quick Start.

Commands:

```powershell
node --test tests/phase23/playable-cast-history.test.mjs
```

Result:

- focused tests: 2 passed, 0 failed
- 205-message history fixture split into bounded stable chunks
- no Preview37 input or storage dependency

### Checkpoint 3 — 2026-09-17

Added replay-safe bootstrap orchestration. Quick Start expands the approved cast, initializes the new canonical phones, and reconciles the most recent RP window first. Deep Backfill then walks bounded older chunks and persists progress in Story/Branch-scoped settings. Re-running an unchanged bootstrap reuses the same identity manifest and does not duplicate Actors or Devices. Failure records a retryable state without manufacturing completion.

Commands:

```powershell
node --test tests/phase23/playable-bootstrap-service.test.mjs tests/phase23/playable-cast-history.test.mjs
```

Result:

- focused tests: 4 passed, 0 failed
- Quick Start/Deep Backfill progress persisted
- identity expansion replay produced no duplicate Actors or Devices

### Checkpoint 4 — 2026-09-17

Connected the resumable bootstrap to the production composition root and added one prominent Settings action. The action reads `ทำให้มือถือพร้อมเล่น` before the first run and `อัปเดตมือถือให้ทันเรื่อง` afterwards, exposes animated cast/Quick Start/backfill progress, disables duplicate taps while running, and retains a same-button retry after failure. The active Their Phone roster now follows active Character Card membership, so expanding an ensemble card replaces the retired container phone instead of displaying both.

Commands:

```powershell
node --test tests/phase23/playable-bootstrap-settings-ui.test.mjs tests/phase23/playable-bootstrap-service.test.mjs tests/phase23/playable-cast-history.test.mjs tests/phase23/playable-shell-navigation.test.mjs tests/production-composition/composition-root.test.mjs
npm run build:production-package
npm run verify:production-package
```

Result:

- focused tests: 15 passed, 0 failed
- Settings action state and production construction order verified
- production package built and verified

### Checkpoint 5 — 2026-09-17

Added an idempotent Initial Phone Seed that runs inside the one-click bootstrap after Quick Start reconciliation. Every active phone receives a pinned current-story note, contextual shop suggestions, a low-impact weather estimate, health estimates, and a reminder. Their Phone receives a plausible non-zero wallet balance using a context-sensitive currency; My Phone intentionally leaves Wallet under explicit user/story control. Every generated record is labeled `plausible-simulation` and is replaced safely by later canon. Added one shared visual language for loading, empty, offline, error, and ready states, and connected it to app loading/errors and Feed.

Commands:

```powershell
node --test tests/phase23/initial-phone-seed.test.mjs tests/phase23/living-state.test.mjs tests/phase23/playable-bootstrap-settings-ui.test.mjs tests/phase23/playable-bootstrap-service.test.mjs tests/production-composition/composition-root.test.mjs
npm run build:production-package
npm run verify:production-package
```

Result:

- focused tests: 13 passed, 0 failed
- idempotent seed verified across My Phone and two Their Phone devices
- production package built and verified

### Checkpoint 6 — 2026-09-17

Added an Adaptive World Pulse with six stable Thai-netizen voices that stay outside the Character Card cast and therefore never appear as Their Phone devices. Bootstrap primes six readable posts. Each manual refresh commits three more posts from a nine-item in-memory batch and refills only by batch, so the player never reaches a dead end and a gesture is not tied to an LLM request. Added conservative RP Wallet evidence: explicit amounts such as receiving, paying, buying, or spending update My Phone automatically, replay once, revise the same transaction on edited source text, and ignore vague money prose.

Commands:

```powershell
node --test tests/phase23/adaptive-world-pulse.test.mjs tests/phase23/wallet-rp-evidence.test.mjs tests/phase23/playable-bootstrap-service.test.mjs tests/phase23/playable-bootstrap-settings-ui.test.mjs tests/phase23/instant-connect.test.mjs tests/production-composition/composition-root.test.mjs
npm run build:production-package
npm run verify:production-package
```

Result:

- focused tests: 30 passed, 0 failed
- Feed prime/refresh, hidden ambient identities, Wallet replay/revision, Calls and production graph verified
- production package built and verified

### Checkpoint 7 — 2026-09-17

Closed the provider and package wiring for the playable bootstrap. Settings now exposes exactly two optional capability areas: Image API and Voice API. The Image key is remembered globally across chats without being copied into Story/Branch-scoped IndexedDB rows, reconfigures the existing Pixabay selector immediately, and keeps the no-generation, safe-search, no-people-by-default policy explicit. Voice continues through the existing TMRW Voice Companion/runtime setup. The one-click bootstrap outputs, Initial Phone Seed, Adaptive World Pulse, and RP Wallet evidence remain connected to the existing app projections and the production package includes the complete runtime import closure.

Commands:

```powershell
node --test tests/phase23/provider-settings.test.mjs tests/phase23/playable-bootstrap-settings-ui.test.mjs tests/phase23/adaptive-world-pulse.test.mjs tests/phase23/wallet-rp-evidence.test.mjs tests/phase23/playable-shell-navigation.test.mjs tests/phase23/playable-cast-history.test.mjs tests/phase23/playable-bootstrap-service.test.mjs tests/phase23/initial-phone-seed.test.mjs tests/phase23/living-state.test.mjs tests/phase23/instant-connect.test.mjs tests/phase23/outbound-call-playable.test.mjs tests/phase22/image-provider.test.mjs tests/production-composition/composition-root.test.mjs
npm run build:production-package
npm run verify:production-package
npm run test:p23-f
```

Result:

- focused closure tests: 58 passed, 0 failed
- production package: 249 files, 758 import edges
- package verification: passed; passive import true; protected paths false; retired Preview files not copied
- the broad legacy `test:p23-f` command reached 80 passed and 7 failed. Six failures are module-load failures from pre-existing missing fixtures (`tests/phase1/test-helpers.mjs` and `tests/phase17/notification-fixtures.mjs`); the seventh is the pre-existing legacy package-script contract expecting an absent `test:production-composition` script. No checkpoint 1–7 focused test failed.

### Checkpoint 8 — 2026-09-17

Closed the two mobile usability regressions found during device testing. Every empty app now uses one shared visual system with app-specific copy, artwork, compact panel variants, and a styled fallback for remaining legacy gaps; raw implementation errors are replaced with human recovery notices. Files, Notifications, Calls, Contacts, profile posts, transcripts, Calendar, Maps, Wallet, Shop, Weather, Health, Notes, Search, Voice, and locked/error variants are covered. Gallery retains its richer contact-sheet scene. Mobile write actions now revalidate and, only for an expired or missing uncontested lease caused by browser suspension, reacquire the lease, restart heartbeat, and reopen the Authoring Gate before Settings, one-click bootstrap, Guide, or Feed mutations. Ownership conflicts still fail closed.

Commands:

```powershell
node --test tests/phase23/mobile-lease-resume.test.mjs tests/phase23/app-empty-state-system.test.mjs tests/phase23/gallery-empty-state.test.mjs
npm run build:production-package
npm run verify:production-package
```

Result:

- focused recovery and empty-state tests: 7 passed, 0 failed
- expired uncontested mobile lease recovered at action time; foreign ownership remains blocked
- production package: 250 files, 770 import edges
- package verification passed; passive import true; protected paths false; retired Preview files not copied
- broader legacy UI commands remain blocked at module load by the already-recorded missing `tests/phase17/notification-fixtures.mjs`; no focused checkpoint test failed

### Checkpoint 9 — 2026-09-17

Closed the device-test failures around bootstrap review, stale runtime delivery, Messages, Simple access, and Adaptive Feed. Cast discovery now rejects card-schema labels such as Age, Hair, Height, Build, and Note; inferred names remain candidates and Settings presents a required selection/review panel before any phone identities are changed. Confirming a corrected cast retires obsolete active card memberships, so earlier false phones disappear from the owner roster. An unchanged completed bootstrap is a true no-op, while changed-history seed records use fingerprinted identities and deterministic payloads to avoid idempotency collisions. Simple now grants read access to Their Phone by contract. Messages retains unstarted Instant contacts beside existing threads, renders a designed empty conversation state, and makes Their Phone explicitly read-only. Adaptive Feed v2 no longer quotes raw RP prose, filters legacy malformed pulse posts, and commits real deterministic likes plus Thai-netizen comment previews.

The repository-installed runtime under `v3/` is now mechanically synchronized with the authoritative source and verified byte-for-byte against the packaged runtime. This fixes the deployment gap where Git updated successfully but the browser continued importing stale `v3/` files.

Commands:

```powershell
node --test tests/phase23/playable-cast-history.test.mjs tests/phase23/playable-bootstrap-service.test.mjs tests/phase23/adaptive-world-pulse.test.mjs tests/phase23/playable-bootstrap-settings-ui.test.mjs
node --test tests/phase23/instant-connect.test.mjs tests/phase23/gallery-files-ui.test.mjs tests/phase23/p23-d-shell.test.mjs tests/phase23/production-home-presentation.test.mjs
npm run build:production-package
npm run verify:production-package
```

Result:

- focused bootstrap/cast/feed tests: 7 passed, 0 failed
- Instant/Calls/Messages regression file: 17 passed, 0 failed
- three broader UI files remain blocked at module load by the pre-existing missing `tests/phase17/notification-fixtures.mjs`
- production package: 250 files, 770 import edges; verification passed
- authoritative source, installed `v3/` runtime, and packaged `dist/.../v3/` hashes match for every touched runtime file

### Checkpoint 10 — 2026-09-17

Fixed cast discovery for recurring NPCs that exist only inside roleplay history. The scanner no longer depends on the SillyTavern message author or `Name: dialogue` formatting alone: recurring Thai and English narrative roles such as `ชายเจ้าของบ้าน` can now become reviewable cast candidates after appearing across multiple bot turns. They remain unselected until the player confirms them. Metadata and card-schema labels are rejected through a shared classifier across both structured-card and dialogue discovery, covering false owners such as Note, OOC, Skin, and Status in addition to the earlier physical-profile fields. Settings explains when a candidate was inferred from a recurring narrative role.

Commands:

```powershell
node --test tests/phase23/playable-cast-history.test.mjs tests/phase23/playable-bootstrap-service.test.mjs tests/phase23/playable-bootstrap-settings-ui.test.mjs
npm run build:production-package
npm run verify:production-package
```

Result:

- focused cast/bootstrap/settings tests: 7 passed, 0 failed
- recurring Thai narrative role is offered for review but never auto-approved
- repeated metadata labels do not become cast candidates
- production package: 250 files, 770 import edges; verification passed
- authoritative source, installed `v3/` runtime, and packaged `dist/.../v3/` hashes match for the changed runtime files

### Checkpoint 11 — 2026-09-17

Corrected cast relevance after validating against a real branched SillyTavern chat. Inferred cast discovery now uses a bounded current-story window instead of counting every historical message copied into a long branch, preventing characters from old scenes or ancestor timelines from returning merely because they were frequent hundreds of turns ago. Non-explicit Character Card headings also require corroboration in the current window. The scanner now reads repeated participant rosters from structured RP status headers using the active card and player placeholders as anchors, allowing unnamed-in-card Thai NPCs to be discovered without hardcoded character names. Settings labels these candidates as present in the current scene and still requires player confirmation.

Commands:

```powershell
node --test tests/phase23/playable-cast-history.test.mjs tests/phase23/playable-bootstrap-service.test.mjs tests/phase23/playable-bootstrap-settings-ui.test.mjs
npm run build:production-package
npm run verify:production-package
```

Result:

- focused cast/bootstrap/settings tests: 8 passed, 0 failed
- a Thai NPC present only in a repeated scene roster is discovered without a hardcoded name
- recurring roles outside the current 160-message window are excluded
- incidental scene-roster entries seen only three or four times are excluded
- stale card headings absent from the current story window are excluded

### Checkpoint 12 — 2026-09-17

Fixed the post-confirm bootstrap failure observed on the live mobile database. Repeated cast scans had correctly retired obsolete card memberships but retained their historical Device and Account identities. `PhoneStateService.initializeScope` consequently attempted to replay lifecycle initialization for every historical identity and collided with an older canonical Event whose semantic payload no longer matched. Initialization is now additive: existing Phone State and Account Session projections are preserved, only missing projections are created, and the one-click bootstrap passes the exact Device and Account IDs returned by the newly approved identity manifest instead of walking every historical identity in the Story/Branch. The Initial Phone Seed follows the same approved Device set and skips already committed seed keys before reaching the canonical Event engine, preserving compatibility with seed Events written by older runtime versions whose source-record format changed. Retrying with a revised cast is therefore safe, does not reset an existing phone, and creates or seeds only newly selected phones.

Commands:

```powershell
node --test tests/phase23/playable-cast-history.test.mjs tests/phase23/playable-bootstrap-service.test.mjs tests/phase23/playable-bootstrap-settings-ui.test.mjs tests/phase23/initial-phone-seed.test.mjs
npm run build:production-package
npm run verify:production-package
```

Result:

- focused cast/bootstrap/settings/seed tests: 11 passed, 0 failed
- revised-cast retry adds the missing phone without replaying old lifecycle Events
- existing player Phone State is byte-for-byte preserved across the retry
- legacy seed keys replay as no-ops and unselected historical phones receive no new seed data
- production package: 250 files, 770 import edges; verification passed

### Checkpoint 13 — 2026-09-17

Closed the live Messages and Feed issues found during device review. Messages now excludes conversations whose non-player participants are no longer active members of the current Character Card cast, so retired false-positive actors cannot remain as phantom contacts, and conversation rows sort by the latest canonical message rather than creation order. Adaptive Feed v3 builds and persists a world-social bible from the active card, lore, and current RP history; generated posts, identities, likes, and comments must follow that world's class system, law, economy, technology, morality, and public-information boundary instead of falling back to a modern generic setting.

My Phone is now a writable social surface: the player can create posts, like or unlike, comment, and reply. The player's canonical action renders first, a moving waiting indicator appears while world-aware NPC responses are generated in the background, and each response is added to the existing discussion without requiring another refeed. Nested replies are loaded and displayed instead of being silently hidden. Their Phone remains inspection-only and exposes none of these write controls. The old canned pulse copy remains filtered from presentation.

Commands:

```powershell
node --test tests/phase23/instant-connect.test.mjs tests/phase23/adaptive-world-pulse.test.mjs tests/phase23/social-player-interactions.test.mjs
npm run build:production-package
npm run verify:production-package
```

Result:

- focused Messages/world-feed/player-interaction tests: 21 passed, 0 failed
- inactive-cast thread filtering and latest-message ordering verified
- RP-world grounding, persisted world bible, canonical likes/comments/replies, immediate player rendering, automatic NPC updates, and Their Phone read-only boundary verified
- production package: 250 files, 771 import edges; verification passed
- authoritative source and repository-installed `v3/` runtime synchronized for every changed runtime file

### Checkpoint 14 — 2026-09-17

Fixed the live-device write cascade that made both one-click phone update and Refeed fail after a single canonical idempotency conflict. A rejected domain action can abort its own IndexedDB transaction without closing the proven Authoring Gate for the entire phone, including browser adapters that wrap the original rejection in a different Error object. Lease validation and genuine database/ownership failures still fail closed.

Adaptive Feed now uses content-addressed v4 source records for generated posts, likes, and comments. If an interrupted or legacy refresh leaves a canonical Event behind while its projected feed count is stale, the next batch can safely occupy that numerical slot with different content instead of reusing an older canonical Event key. Existing data is retained and no database reset is required.

Commands:

```powershell
node --test tests/phase23/instant-connect.test.mjs tests/phase23/adaptive-world-pulse.test.mjs tests/phase23/social-player-interactions.test.mjs tests/phase23/fenced-domain-rejection.test.mjs tests/phase23/mobile-lease-resume.test.mjs tests/phase23/playable-bootstrap-service.test.mjs
npm run build:production-package
npm run verify:production-package
```

Result:

- focused Instant/Messages/Feed/player-action/lease/bootstrap tests: 29 passed, 0 failed
- stale feed-slot regression and wrapped domain-rejection regression both verified
- a rejected feed/bootstrap operation no longer disables unrelated phone writes
- production package: 250 files, 771 import edges; verification passed
- authoritative source, repository-installed `v3/` runtime, and packaged runtime synchronized for both changed runtime files

### Checkpoint 15 — 2026-09-17

Decoupled core one-click phone readiness from optional enrichment after the live device still reported a failed all-or-nothing setup beside an expired SillyTavern CSRF request. Approved identity/phone creation and current-history reconciliation remain required. Initial utility seeding and world-feed priming are now best-effort enrichments: either may be unavailable without rolling the whole phone back or leaving Settings in a failed state, and the omitted content can be filled later from its own app. A failed required stage is persisted with its stage name and rendered as Thai recovery guidance rather than a raw implementation error. The extension manifest version was advanced so the host can distinguish this runtime from the previously cached package.

Commands:

```powershell
node --test tests/phase23/playable-bootstrap-service.test.mjs tests/phase23/playable-bootstrap-settings-ui.test.mjs tests/phase23/adaptive-world-pulse.test.mjs tests/phase23/fenced-domain-rejection.test.mjs tests/phase23/mobile-lease-resume.test.mjs
npm run build:production-package
npm run verify:production-package
```

Result:

- focused bootstrap/settings/feed/write-fence/lease tests: 11 passed, 0 failed
- simultaneous optional seed and feed failures still finish with a `ready` playable phone
- failed required stages retain a specific recovery category without exposing raw errors in the normal UI
- package verification passed after manifest cache-version advance

### Checkpoint 16 — 2026-09-17

Reproduced the repeated one-click update on the live Android database through ADB and Chrome DevTools. The database was already `ready` at 911 messages with two phones, so an unchanged chat head and cast triggered an early return before any repair stage ran. The review sheet closed without progress, success, or failure, making the tap look broken and permanently skipping optional app/feed enrichment that may have failed during the earlier run.

Same-head retries now revalidate the approved identity and phone projections, replay the idempotent utility seed, and retry world/feed readiness. They do not rescan the 911-message history or run Deep Backfill again. A normal complete phone therefore incurs no duplicate canonical writes, while a partially enriched phone can heal on the next explicit tap.

Commands:

```powershell
node --test tests/phase23/playable-bootstrap-service.test.mjs tests/phase23/playable-bootstrap-settings-ui.test.mjs tests/phase23/adaptive-world-pulse.test.mjs tests/phase23/fenced-domain-rejection.test.mjs tests/phase23/mobile-lease-resume.test.mjs
npm run build:production-package
npm run verify:production-package
```

Result:

- focused bootstrap/settings/feed/write-fence/lease tests: 12 passed, 0 failed
- same-head retry repairs utility/feed enrichment without replaying chat history
- production package: 250 files, 771 import edges; verification passed
- Android diagnosis confirmed the prior silent no-op against the real 911-message database
