# Public beta qualification — 2026-09-27

Version: **0.1.0-beta.2**. Scope: curated public distribution, not stable or fresh-device voice qualification.

## Checked

- Existing beta.1 baseline: 338 files matched the step-1 manifest; 24 distinct profile files and 48 distinct WAV previews.
- beta.2: portable preview URLs derived from the installed module (old folder, new repository folder, per-user route, and encoded folder name). Runtime-pack download is explicitly unavailable until a public pack is qualified; no private-repository download link.
- Focused Phone/voice/KeyFlow regression: **51 passed, 0 failed**. Includes 11 coexistence checks against KeyFlow **1.5.1**, source SHA-256 `2deaca11071743bf660d136b596328de96a345cc07a4567ea54da33f2ddd62e6`.
- One legacy test expected Insungram to open the profile. It now asserts the already-requested chat-first route; the underlying chat creation assertions remain in place.
- Pack verifier checks every payload file, import target, WAV header and profile/preview uniqueness. Public verifier additionally exercises previews from the actual distribution folder and validates exact payload hashes.
- No live paid provider requests, user settings, API keys, chat database or device files were used as release payload.

## Not claimed

- A fresh Android/Termux install with a complete downloadable model/runtime (step 4).
- Automatic update or rollback safety across real installations (step 5).
- Live mobile coexistence, every ST version/provider, all timing conditions or zero bugs.
- Audio quality perfection. Some EN/JA pronunciation remains a known beta limitation.
- Provider availability: HTTP 503 can still exhaust all configured fallback models. Phone's generation deadline can end a call attempt before recovery succeeds.

KeyFlow is optional. Its public 1.5.1 fixes ST's HTTP 500 wrapper around Google's 503/UNAVAILABLE and stops cancellation-time retries. This release does not bundle a second KeyFlow copy or duplicate its retry owner.
