# Step 5 — completed public beta.4, 2026-09-28

## Published

- Public repo: https://github.com/luftmenschiv-arch/SillyTavern-Extension-TMRW-Phone
- main and tag v0.1.0-beta.4: a041de3144950357a994a7ed6980c63eb9efe345
- Prerelease published, final notes: dev/beta/TERMUX-BETA4-RELEASE.md.
- Assets directory: C:/ai/tmrw-voice-assets/termux-release-0.1.0-beta.4
  All five remote asset sizes/digests match local files; remote-assets-audit.json.
- install.sh SHA 644b4ebb4544793ec95999db39b3927df336978427632002b8dcff13f8e54eef
- installer.tar.gz SHA 59bd080a0f02f667300e07f9fc2efc03833f88791f4c5905089dfdfea4b084f4
- install-index.json SHA def7391657590b7972ae76e17c6fc8d83b70a44f2c025da93afbbf0541185faa
- Model pack remains 1.0.0-beta.1 / SHA
  0915b542c890f7903900253975596c52b606fb3563d31a7bef413d6129dab6ca.
  Part URLs point to immutable beta.3 assets. No model/preview changes this turn.

## Behavior

- Public manifest auto_update:true (private development manifest intentionally
  not enabled). ST's native schedule/settings apply. Local observed ST only
  invokes its auto updater on version change with enableAutoUpdate; it is NOT
  an every-launch poll. tmrw-start also checks public main at safe startup.
- Public-origin main clean checkouts only. Fetch with timeout, reject diverged
  history, verify a separate checkout then merge --ff-only. Store previous ref.
  No git reset/force or user-code overwrite. Validation failure keeps old HEAD.
- Termux partial local clones exposed missing promised blobs with --shared;
  fixed by cloning candidate from public origin and requiring clean status.
- Skip all updates if ST or either voice port occupied; recheck before applying.
  No hot voice restart. Custom ST ports must use TMRW_ST_URL consistently.
- scripts/termux/voice-update.json independently pins reviewed immutable index
  URL/hash and pack version/hash. Only official HTTPS release parts allowed.
  Same active hash -> no index/model download. Downgrades and same-version
  content replacement refused. Download/check/preflight happens before activation.
- Candidate services must both report ready before atomic active-pack switch.
  Failure stops owned candidate processes and preserves/restores prior pointer.
  Pending journal recovers after crash before next update; ST must be stopped.
- Preset/user profiles copied with no-overwrite behavior. No ST data/IndexedDB,
  chat/history/recording settings migrations. New preset content with colliding
  profile IDs will not overwrite player files; future preset migration is separate.
- Small updater has content-addressed engine folders and atomic selector. Engine
  files refresh from a verified public snapshot; stable dispatcher remains minimal.
- --updates-off / --updates-on toggle launcher policy only, not ST native policy.
  --update-only does not start ST. TMRW_NO_UPDATE=1 is a one-run skip.
- Existing public beta.3: update extension through ST to beta.4, close ST and stop
  voice, rerun beta.4 bootstrap once. Existing pack is reused. Private/legacy
  installations must be migrated separately, not force-installed over.

## Evidence

- 78 focused tests pass (14 new updater cases plus 64 prior Phone/KeyFlow/voice/
  installer checks). New real-Git tests verify candidate rejection, dirty-tree
  preservation, fast-forward and busy recheck. Native tar test verifies deferred
  install does not activate. Launcher engine replacement/reuse tested.
- Public verifier: 317 files, 48 previews, 776 imports, checksums and preview fetches
  pass. Tests do not certify every UI regression after an extension activates.
- Isolated Realme Android 13 root:
  /data/data/com.termux/files/home/.tmrw-public-install-qa-20260928
- step5-qualification.json at that root: preparation-branch update from beta.3
  to 7121ac6 succeeded, actual manager/runtime restarted, 27 profile files and
  history preserved. Synthetic candidate startup failure and pending-journal
  recovery passed. Busy deferral and updates-off/on passed. Actual model unchanged.
- step5-final-bootstrap.json: anonymous beta.4 bootstrap/installer/index downloaded
  with matching pins, installed exact final a041de3, both services ready, old
  model/profile/history preserved. Existing dependencies and model payload reused.
- After promoting main, real unmodified launcher --update-only passed at
  2026-09-27T20:58:19.564Z: extension.changed=false, voice.changed=false,
  voice.downloaded=false (voice/last-update.json). Test voice services stopped.
- Source helpers: dev/voice/qualify-step5-android.mjs, verify-step5-final.mjs,
  prepare-step5-release-index.mjs, check-step5-release-assets.mjs.

## Boundaries and follow-up

Owner's working ST and legacy private voice setup are untouched; no live migration
performed. Do not claim the owner's existing launcher has been upgraded.
QA files retained for diagnostics. No player files deleted. ADB connection retained.
Fresh Android package-manager bootstrap, all phone models and live paid providers
are not certified. 503 availability and imperfect preset pronunciation remain.
Release gate checks are not a general automatic rollback of loaded browser code.

Future voice releases must retain schema/protocol compatibility, bump the pack
version, publish/qualify assets first, then update the pinned voice-update.json in
a verified public main snapshot. Do not mutate old release assets or publish an
unqualified runtime from the private development tree. Keep enough disk for old
pack, new pack and resumable cache; no automatic destructive cache cleanup added.
