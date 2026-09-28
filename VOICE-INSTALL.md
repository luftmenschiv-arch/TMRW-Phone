# TMRW Local Voice — current installation

Do not run old `raw.githubusercontent.com/.../installers/android/install.sh | bash`
instructions from historical commits. That private-source file is a fail-closed
template, not the reviewed public installer. In-app pack install for this Termux
distribution is not enabled.

Players on Android arm64 with SillyTavern already running in Termux should use
the [public beta.4 release instructions](https://github.com/luftmenschiv-arch/SillyTavern-Extension-TMRW-Phone/releases/tag/v0.1.0-beta.4).
The command downloads the reviewed Extension and complete runtime/model with
verified parts. The initial download is about 780 MB and requires 4 GiB free.
Run `tmrw-start` on later Termux sessions; updates are checked only at safe
startup. Existing beta.3 players should follow the one-time beta.4 enablement
steps in that release. Legacy/private installs need separate migration review.

The Windows installer in this source tree has not gone through the current
beta.4 Android/runtime qualification; it is not this public one-command flow.
Maintainers: [Step 4 handoff](TERMUX-INSTALLER-HANDOFF.md) and
[Step 5 handoff](AUTO-UPDATE-HANDOFF.md) record the pack format, hashes, testing
and release boundaries. Do not mutate old release assets or publish an
unqualified private runtime.
