# TMRW Phone Instant Connect candidate

Branch: `codex/phone-instant-connect-ui`

This candidate separates character connectivity into three explicit behaviors:

- Instant: My Phone can message or call canonical cast accounts immediately. No phone number or Contact record is fabricated.
- Story: Contacts become available only through the existing explicit story-evidence discovery path.
- Off: automatic character connectivity is disabled.

Instant actions are intentionally available only from My Phone. Their Phone remains an inspection perspective and does not gain player-authoring controls.

Opening Instant mode does not create conversations, calls, messages, contacts, or phone numbers. A canonical DM or Call is created only after the user taps that action. A direct Instant call to the one active Character is then accepted through that Character's canonical Account, Instance, Actor, and primary phone Device so the call surface becomes active without requiring an unavailable second-device action. Group targets, ambiguous endpoints, Story-mode contacts, and ordinary non-Instant calls are not auto-accepted.

The Voice setup surface stores and validates an explicit Local Voice Runtime origin and can test its health before a call. The default `http://127.0.0.1:18769` intentionally means the platform-local runtime: the approved Android/Termux runtime on Mobile and the Windows runtime on PC. A remote origin remains possible for diagnostics, but is not the standalone product path. Invalid origins and unavailable runtimes fail closed. The configured origin is forwarded without changing synthesis text, sampling behavior, voice profile selection, or audio processing.

The approved Android runtime is started with `mobile-runtime/START-TMRW-VOICE-MOBILE.sh`; the launcher verifies the qualified runtime hash and refuses unknown processes or runtime bytes. This repository does not change model assets or declare parity for the Windows runtime. Windows audio parity remains subject to its separate human-listening gate.

The candidate also raises the extension phone surface above the host-side toolbar stacking context and uses the active SillyTavern character name for the single-character presentation instead of a generic `Character card` label.

## Playable outbound Voice flow

An active outbound call now has one bounded turn pipeline:

- the caller's typed line is committed first, then the composer locks and immediately shows `กำลังคิด…`;
- quiet generation has a 30-second deadline and must return one to three paired segments containing a Thai subtitle plus English or Japanese spoken text with matching meaning, names, address, and emotion;
- invalid one-language or malformed output fails closed and exposes a retry action without creating a new call;
- Puzzle synthesis uses one multi-chunk runtime turn, starts the first playable segment while later chunks continue in the background, applies a 20-second deadline per audio request, and retries a failed segment once;
- no bot transcript is exposed until the first real audio artifact is ready; captions and audio then advance together while user input remains locked;
- hangup stays available and cancels generation, synthesis, retry, and playback;
- a missing Character Voice Profile uses the existing Puzzle voice as the temporary playable fallback.

Voice Calls, bot voice, the mutually exclusive English/Japanese selection, delivery, Thai captions, and the runtime origin are stored as device-global preferences. They survive chat, branch, and reload changes. A detected ready runtime enables the initial defaults only once; later manual disables are preserved. Character Voice Profiles remain character-scoped.

## Verification

Run:

```text
node --test tests/phase23/outbound-call-playable.test.mjs tests/phase23/instant-connect.test.mjs tests/phase23/presentation-correction.test.mjs
npm run build:production-package
npm run verify:production-package
```

The targeted Voice/Instant/UI regression set passes 24/24. The broad historical `npm test` command remains blocked by test files already absent from this checkout (including `tests/phase17/notification-fixtures.mjs`, `tests/phase8/messaging-fixtures.mjs`, `tests/phase7/ui-fixtures.mjs`, and `tests/phase1/test-helpers.mjs`); this candidate does not reconstruct unrelated frozen test infrastructure.

The generated production `dist/TMRW-Phone-V3/v3` closure is synchronized byte-for-byte into the repository-root `v3` directory because root `index.js` imports `./v3/production/entry.mjs` directly.

This branch is not merged and is not a release declaration. Android/UI inspection is still required.
