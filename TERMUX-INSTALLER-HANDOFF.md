# Step 4 — Termux installation candidate (2026-09-28)

## Current: Step 5 complete — beta.4 (2026-09-28)

Public main/tag v0.1.0-beta.4 are at a041de3144950357a994a7ed6980c63eb9efe345.
Automatic startup updates are shipped; details/evidence/limitations are in
AUTO-UPDATE-HANDOFF.md. Earlier Step 5-pending statements below are historical.
The owner's working private install was NOT migrated. Only the isolated QA
installation has the new launcher. Do not tell them their live setup auto-updates.

## Final qualification — 2026-09-28 (supersedes checkpoint below)

- Owner explicitly asked to continue after the quota checkpoint. Step 4 final
  anonymous bootstrap qualification passed at 2026-09-27T20:35:28.826Z.
- GitHub release v0.1.0-beta.3: all 52 assets match local SHA-256 and sizes.
  Audit: C:/ai/tmrw-voice-assets/termux-release-0.1.0-beta.3/remote-assets-audit.json.
- Actual Android downloaded install.sh, installer.tar.gz and install-index.json
  from public HTTPS URLs without credentials; all pins passed. Installed into
  .tmrw-public-install-qa-20260928 only. Complete archive was reused from verified
  cache, not downloaded again. Existing Termux dependencies were reused.
- Installed extension HEAD 1c40816e6501ed62950beaf86f679224b000c908, branch main,
  upstream origin/main, clean checkout. Manager 18778 and runtime 18779 ready.
  User profile and history sentinels preserved. No actual ST server was launched
  in the entry-file fixture. Owner's ST/voice/data remain untouched.
- Re-ran 64 tests: 64 pass, 0 fail. Public verifier: 313 files, 48 previews,
  776 import edges, all checksums and 48/48 preview fetches pass.
- Verification helper: dev/voice/verify-public-bootstrap-qa.mjs.
- Public main and v0.1.0-beta.3 tag both confirmed at the qualified pinned commit
  1c40816e6501ed62950beaf86f679224b000c908. Prerelease is published (not draft),
  with final notes from dev/beta/TERMUX-BETA3-RELEASE.md. Step 4 is complete.
- Stopped only the isolated final QA services, closed the owned localhost QA
  artifact server, and removed our 28778/28779 forwards and 28780 reverse.
  Test files retained for recovery; no player data or working services deleted.
- Step 5 automatic updates remains NOT DONE; auto_update is still false.
- Personal legacy installs deliberately require a separately reviewed migration;
  do not tell the owner to install this over their working private setup.

## Latest checkpoint (supersedes earlier release gates below)

- The user confirmed that public distribution permission for the 24 preset
  voices exists. Do not ask again or substitute/remove the voices.
- Native-library packaging was revised: unused readline/gdbm libraries and
  their three optional Python native modules were moved out of the staging
  pack (preserved in `.tmrw-optional-python-modules-20260928`). Added 11 Termux
  notice folders, 12 upstream notice snapshots, Python-SoXR/libsoxr full source
  and build files, and NOTICE.md. Global Python/working voice were not changed.
- Revised distribution runtime speech/ASR/clone PASS in
  `C:/ai/tmrw-voice-assets/termux-distribution-qualification-20260928-3`.
  ADB-launched services disappeared when their ADB shell ended with no actual
  Termux session holding the app alive. Keeping the QA ADB shell alive allowed
  the whole qualification to pass. Do not conflate this with a missing model.
- Final pack `1.0.0-beta.1`: **780,193,074 bytes**, 47 parts, **5,211** files,
  measured file bytes **1,159,823,546**.
  SHA-256 `0915b542c890f7903900253975596c52b606fb3563d31a7bef413d6129dab6ca`.
- Final pack artifacts: `C:/ai/tmrw-voice-assets/termux-public-pack-1.0.0-beta.1`.
- Release assets: `C:/ai/tmrw-voice-assets/termux-release-0.1.0-beta.3`.
  Bootstrap SHA `b41e3c1518e84bf4a812eed157086fbd86d23c4ce5dad220ad40cb8f9aefa221`;
  installer SHA `d555aa02635673b48d972980c9afd580f867c788c4a2253d4292b73bdabe2fa7`;
  public index SHA `a6eda4612a74692ba299b65b35419d1677923f1ead61f358c4ea684ca6bd5ec5`.
- Public repo preparation branch `release/termux-beta-3` pushed at
  **1c40816e6501ed62950beaf86f679224b000c908**. Public main is still beta.2 until
  final qualification. This commit is pinned in the final public install index.
  It includes all installer source, beta.3 manifests/docs, exact release hashes,
  and the small UI toast directing users to Termux installation.
- A **draft prerelease** `v0.1.0-beta.3` exists targeting that branch. Runtime
  assets are uploading (GH CLI session 37548; inspect completion before retry).
  Expected **52 assets**: 47 parts, installer.tar.gz, install-index.json,
  install.sh, extension zip, SHA256SUMS.txt. Do not overwrite existing assets.
- Run `dev/voice/check-termux-release-assets.mjs <final-pack-dir> <release-dir>`
  after upload completes; it checks every remote asset size and SHA-256 digest.
- Final anonymous public bootstrap test is **NOT YET DONE** at this checkpoint.
  Prepared phone fixture `~/.tmrw-public-install-qa-20260928` has a verified final
  archive cached, ST entry-file fixture, a user profile/history sentinel and its
  own bin directory. The final test should download bootstrap/installer/index
  anonymously; model download/resume was already tested with the complete prior
  pack, and release asset digests must all match. State the cache reuse honestly.
- To test final bootstrap: publish the fully verified prerelease, download its
  install.sh anonymously to the phone, then run it with explicit --st, --voice-home
  and --launcher-dir pointing ONLY at that new fixture and voice ports 18778/18779.
  Supply standard Termux PREFIX/PATH/TMPDIR to run-as and keep the ADB parent shell
  alive for subsequent health tests. Prerequisite checks reuse installed tools;
  do not needlessly upgrade the owner's packages.
- Only after success, promote public main to pinned commit 1c40816 (no force),
  update release notes from dev/beta/TERMUX-BETA3-RELEASE.md, and hand off the real
  public installation command. If quota reaches 2% remaining, stop instead and
  preserve the draft plus this checkpoint. Last check was **5% remaining**.
- Private current-source helpers and this handoff should be committed selectively;
  do not include pre-existing dirty UI/audio/catalog work. Public source snapshot
  already contains the UI toast change. Step 5 auto updates still pending.

**Not a completed public release.** The local installer and runtime have passed
an isolated Android install and speech tests; public distribution is gated.
The existing public beta.2 and the owner's working ST/voice install were not
replaced or pushed by this task. Step 5 automatic updates remains pending.

## Implemented source

- `installers/android/download.mjs`: streamed, resumable, checksummed parts,
  space preflight, download lock, bounded part sizes, safe tar validation and
  full payload verification.
- `install-runtime.mjs`: immutable versioned directories, install lock,
  preflight-before-activation, retriable inactive payload, atomic active pointer,
  bundled profile copy without overwriting existing player files.
- `setup.mjs`: standard Termux arm64 checks, pinned index, legacy/duplicate Phone
  detection, pinned public extension commit, isolated doctor and safe launcher.
- `start.mjs` and `runtime/`: private Python environment; loopback voice manager
  and runtime services; owned-process-only stop; occupied-port detection;
  `tmrw-start [--voice-only | --stop-voice]` launcher.
- `install.sh`: replaces the unsafe private-repo installer with a fail-closed
  release template. It is **not** a ready public command. Builder must insert
  reviewed HTTPS release URL and archive/index SHA-256 pins.
- `dev/voice/`: staging, overlay, finalization, binary-safe ADB capture, installer
  build gate, local-only artifact server and real-device qualification scripts.
- `README.md` and `DISTRIBUTION-REVIEW.md` under installers/android describe the
  player flow, boundaries and specific outstanding distribution review.

## Device and isolation

- Connected with the user-supplied current Wireless ADB endpoint; transport 2.
  Realme RMX3370, Android SDK 33. Do not reuse the numeric transport blindly after
  reconnecting; inspect `adb devices -l`.
- Original `.tmrw-voice/current`, Golden core and the real `SillyTavern` were not
  overwritten. Original voice ports 18768/18769 were not listening at the start;
  this task did not start/stop those services.
- Stage: `/data/data/com.termux/files/home/.tmrw-distribution-stage-20260928`.
- First QA user root: `~/.tmrw-termux-qa-20260928` (now stopped).
- Full install fixture: `~/.tmrw-full-install-qa-20260928` with separate `voice`,
  `ST`, `installer` and `bin` directories. `ST` is only a fixture of public entry
  files plus the actually cloned public extension, not a second running ST.
- QA manager/runtime use 18778/18779. PC forwards are 28778/28779; local artifact
  server used 28780 through ADB reverse. Do not confuse these with original ports.
- Extra fixture storage was retained for repeat testing; approx. 25 GB free on
  the phone after installation. No user-created files were removed.

## Exact candidate artifacts

Directory: `C:/ai/tmrw-voice-assets/termux-pack-candidate-20260928-3`.

- Runtime archive: **779,972,713 bytes**, **47** parts (16 MiB except last).
- Archive SHA-256:
  `22a160461f069cd3f9b66ac4b15ab596acdd9c32c97b56844bb48e52cf3fc048`.
- Local install-index SHA-256:
  `623bec227f32ee5e0fc5e023b62bab556d6b07d5dcf2c15b0b12565eb37a358f`.
- Index schema `tmrw-termux-install-v1`; baseUrl is localhost for testing only.
  Never publish that unchanged. The conservative required unpack space is 2 GiB
  although the measured payload files total **1,157,738,003 bytes**, 5,096 files.
- Extension pinned to public beta.2 commit
  `8ad9fb3cb528b8523fc6163e238ea51eca180f76`, verified on the installed Android copy.
- The directories without `-3` and ending `-2` contain failed ADB capture attempts,
  not valid packs. The corrected capture writes a uniquely named remote archive,
  streams it binary-safe and compares its hash to the remote hash before splitting.
- Overlay inputs: `C:/ai/tmrw-voice-assets/termux-overlay-20260928-2`.

## Evidence completed

- Focused regression **64/64 PASS**: prior 51 tests (including KeyFlow 1.5.1)
  plus 13 installer/download/service tests. Includes interrupted downloads,
  corruption, low disk, traversal/links, concurrent install locks, failed preflight
  retry, clone/history preservation, duplicate/legacy extension rejection,
  dirty checkout preservation and refusal to kill unrelated processes.
- Actual phone private runtime doctor: Python 3.13.12, NumPy 2.2.5,
  ONNX Runtime 1.24.3, English/Japanese G2P and whisper executable PASS.
  Termux's global Python is 3.14.6 and was not downgraded.
- Initial relocated stage speech/ASR/clone PASS:
  `C:/ai/tmrw-voice-assets/termux-qualification-20260928-2/qualification.json`.
- Full streamed download, archive/payload verification, extraction, doctor,
  pinned public extension clone and service startup PASS on Android fixture.
- **Installed-pack** English/Japanese WAV generation, transcription, profile
  cloning and runtime restart PASS:
  `C:/ai/tmrw-voice-assets/termux-installed-qualification-20260928/qualification.json`.
  English transcript was the exact test sentence; Japanese matched without
  punctuation. This is functionality evidence, not an audio-quality certification.
- Repeat installation PASS: reused verified installed payload without model
  downloads; **31 profile files**, history fixture and active pointer preserved
  byte-for-byte. Generated `tmrw-start` stop/start round trip PASS. Report:
  `C:/ai/tmrw-voice-assets/termux-installed-qualification-20260928/repeat-qualification.json`.

## Release gates and next actions

1. Await the user's answer about permission/public distribution of the 24
   game-reference preset identities, or their choice of a public runtime-only
   release versus retaining the pack privately. Asked via async question in this
   turn; do not silently replace presets or remove them without that choice.
2. Complete native-library notices and corresponding-source packaging. Concrete
   gaps include readline/gdbm copied binaries and Python-SoXR source/build inputs;
   source paths and upstream evidence are in `DISTRIBUTION-REVIEW.md`. This task
   does not certify redistribution rights for every asset merely from engine MIT.
3. Build a reviewed immutable public index/assets, generate pinned bootstrap,
   test anonymous HTTPS installation and the package-manager prerequisite phase.
   Today's phone already had those system prerequisites; do not call this a clean
   OS/fresh-Termux test. Nor was the final public bootstrap executed.
4. Publish only the reviewed curated release, not the dirty development tree.
   Public UI runtime pack URL is still null; its old manager installer schema is
   not the new CLI schema. Do not simply point one at the other.
5. Step 5 is still separate: auto updates/version migration/rollback. No auto
   updater was enabled or scheduled here.

No GitHub upload/commit/publication was done in this Step 4 turn. The private
development checkout contains unrelated pre-existing changes; do not bulk commit.
Last usage check: 73% consumed of the short window (27% remaining), so the user's
2%-remaining pause-and-push rule had not triggered at that point.
