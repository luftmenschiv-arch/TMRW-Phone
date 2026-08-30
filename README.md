# TMRW—Phone V3

Private synchronization repository for the current TMRW Extension production baseline after Phase 22.

## Development

- Runtime/source-of-truth modules live in the top-level source directories.
- Build the installable SillyTavern package with `npm run build:production-package`.
- Verify the generated package with `npm run verify:production-package`.
- Run the focused Phase-22 image-provider tests with `npm test`.

## Installable package

The qualified generated package is retained at `dist/TMRW-Phone-V3` for controlled installation/synchronization.

## Image provider

Pixabay support is optional and provider-neutral. No API key is committed. The default no-key state remains safe and Phone startup does not depend on image-provider availability.

## Repository hygiene

Do not commit SillyTavern user data, chat histories, credentials, local evidence/checkpoints, browser profiles, Voice/Golden/model assets, Pocket upstream content, or local secret files.
