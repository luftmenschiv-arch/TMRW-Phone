# TMRW Phone Instant Connect candidate

Branch: `codex/phone-instant-connect-ui`

This candidate separates character connectivity into three explicit behaviors:

- Instant: My Phone can message or call canonical cast accounts immediately. No phone number or Contact record is fabricated.
- Story: Contacts become available only through the existing explicit story-evidence discovery path.
- Off: automatic character connectivity is disabled.

Instant actions are intentionally available only from My Phone. Their Phone remains an inspection perspective and does not gain player-authoring controls.

Opening Instant mode does not create conversations, calls, messages, contacts, or phone numbers. A canonical DM or Call is created only after the user taps that action. Existing Call and Voice presentation paths remain in place.

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
