# TMRW Phone Instant Connect candidate

Branch: `codex/phone-instant-connect-ui`

This candidate separates character connectivity into three explicit behaviors:

- Instant: My Phone can message or call canonical cast accounts immediately. No phone number or Contact record is fabricated.
- Story: Contacts become available only through the existing explicit story-evidence discovery path.
- Off: automatic character connectivity is disabled.

Instant actions are intentionally available only from My Phone. Their Phone remains an inspection perspective and does not gain player-authoring controls.

Opening Instant mode does not create conversations, calls, messages, contacts, or phone numbers. A canonical DM or Call is created only after the user taps that action. A direct Instant call to the one active Character is then accepted through that Character's canonical Account, Instance, Actor, and primary phone Device so the call surface becomes active without requiring an unavailable second-device action. Group targets, ambiguous endpoints, Story-mode contacts, and ordinary non-Instant calls are not auto-accepted.

The Voice setup surface now stores and validates an explicit Windows Voice Runtime origin and can test its health before a call. The default remains `http://127.0.0.1:18769`; Android testing against a PC must use that PC's reachable LAN origin, for example `http://192.168.1.20:18769`. Invalid origins and unavailable runtimes fail closed. The configured origin is forwarded without changing synthesis text, sampling behavior, voice profile selection, or audio processing.

The Windows runtime must be started separately with a LAN-reachable bind when testing from Android. This repository does not change, bundle, or declare parity for the Windows runtime. Windows audio parity remains subject to its separate human-listening gate.

The candidate also raises the extension phone surface above the host-side toolbar stacking context and uses the active SillyTavern character name for the single-character presentation instead of a generic `Character card` label.

## Verification

Run:

```text
node --test tests/phase23/instant-connect.test.mjs tests/phase23/smart-contact-discovery.test.mjs
npm run build:production-package
npm run verify:production-package
```

The generated production `dist/TMRW-Phone-V3/v3` closure is synchronized byte-for-byte into the repository-root `v3` directory because root `index.js` imports `./v3/production/entry.mjs` directly.

This branch is not merged and is not a release declaration. Android/UI inspection is still required.
