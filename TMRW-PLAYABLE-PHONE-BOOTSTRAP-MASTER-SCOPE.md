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
| 0 | Durable scope and baseline | IN PROGRESS | — | repository clean at `18592f9` |
| 1 | Stable Phone Shell navigation and home-page restoration | NOT STARTED | — | pending |
| 2 | Cast Manifest and bounded RP history reader | NOT STARTED | — | pending |
| 3 | Quick Start plus resumable Deep Backfill orchestration | NOT STARTED | — | pending |
| 4 | One-click Settings bootstrap/update experience | NOT STARTED | — | pending |
| 5 | Initial Phone Seed and shared living UI states | NOT STARTED | — | pending |
| 6 | Adaptive World Pulse and guaranteed Feed buffer refresh | NOT STARTED | — | pending |
| 7 | App wiring, provider capability settings, and production package closure | NOT STARTED | — | pending |

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

