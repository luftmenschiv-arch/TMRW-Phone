# Termux installer — Step 4 candidate

**Not a published player command yet.** `install.sh` is a release template and
deliberately exits before modifying anything until reviewed release URLs and
checksums are inserted by `dev/voice/build-termux-installer.mjs`.

## Intended player flow

1. Already have SillyTavern in standard Termux on Android arm64. This installer
   does not install, upgrade, restart, or replace SillyTavern itself.
2. Run the eventual pinned release installer command once. It installs the
   public extension snapshot, private Python 3.13, optimized model/runtime,
   Voice Manager, local transcription, and 24 preset profiles. Allow about
   **4 GiB of free space during installation**, in addition to Termux packages.
3. Open ST normally, configure its model/API, and refresh after any current
   generation finishes. Choose English or Japanese in TMRW's voice settings.
4. Restart ST once after installation, then continue using the same ST command
   or shortcut. The installer adds a managed server plugin and enables
   `enableServerPlugins`, keeping a backup of `config.yaml`. Voice starts in the
   background and recovers after a service failure without blocking ST startup.
   `tmrw-start` remains available for updates; `tmrw-start --stop-voice` pauses
   automatic recovery, and `tmrw-start --voice-only` resumes it.
   This source change needs a new installer release; older downloads do not
   gain the server plugin merely by refreshing the browser extension.

`--st=/absolute/path/to/SillyTavern` selects a non-default ST installation.
An existing legacy Phone or custom voice installation requires a reviewed
migration, not forced replacement. Do not remove it or clear browser storage to
work around this check. Do not enable two Phone copies in the same ST session.

## Safety and repeat installation

- Stable IDs and storage namespace are unchanged. No chat, call history,
  IndexedDB, ST settings, API keys, or player clone files are read for packaging.
- Model downloads use verified 16 MiB parts in persistent local cache. A retry
  reuses complete verified parts, rather than starting the model download over.
- Hashes cover parts, the complete archive, and every extracted payload file.
  Traversal, links, devices, unsafe roots, and unexpected files are rejected.
- A process lock prevents simultaneous activation. Doctor checks happen before
  switching the active pointer. A failed preflight can be retried without
  overwriting the previous installation or downloading a verified payload again.
- User-created profiles are never replaced, including a name collision with a
  bundled preset. Failed payloads remain for diagnosis; cleanup is not implicit.
- Existing extension checkouts must exactly match the pinned public commit and
  be clean. This is repeat installation, **not an updater**. Step 5 remains open.
- Package launchers use a private Python environment, not global pip installs
  or a downgrade of the user's Termux Python.
- Services listen on loopback. Startup refuses occupied ports; shutdown checks
  the owned PID's actual command line and does not kill an unrelated service.

## Qualification boundary

Device testing uses a separate user root and ports 18778/18779. Passing there
does not establish compatibility with every Android device, a clean OS install,
or live SillyTavern API providers. No claim that a provider's 503 is fixed.

Before release: complete the third-party notices/corresponding-source inventory,
host immutable public artifacts, test anonymous HTTPS downloads and the final
bootstrap end to end, then publish the verified installation command. A localhost
candidate index is never a distributable release index. The extension's existing
UI pack-install endpoint is a different schema; do not point it at this CLI index.

## Maintainer tests

`node --test tests/voice-v1/termux-download.test.mjs tests/voice-v1/termux-setup.test.mjs`

Build scripts refuse existing output directories. Keep `payload.json`, the
qualification report and SHA-256 values with each candidate; do not silently
replace a published asset or tag. The bootstrap requires Node.js 22+ and installs
missing Termux prerequisites, but never upgrades ST or runs auto-update jobs.
# Current release status

Step 5 is now released as public beta.4: startup auto-updates, independent pinned
voice pack, health-gated activation/rollback and versioned updater engines.
See ../../AUTO-UPDATE-HANDOFF.md and the public README for current installation
and beta.3 one-time enablement. Any earlier pending gates below are historical.
