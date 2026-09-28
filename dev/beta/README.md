# Local beta candidate

Build a snapshot into a new directory outside this repository:

```sh
node dev/beta/build-beta-candidate.mjs --output=<new-directory> --version=0.1.0-beta.1
node dev/beta/verify-beta-candidate.mjs --candidate=<new-directory>
```

The snapshot contains a built SillyTavern Extension, the Voice Manager source and tools, Android voice service scripts, the preset catalog, 24 distinct preset identities, and 48 bundled EN/JP WAV previews. `beta-candidate.json` records every file's size and SHA-256. The build refuses an existing output directory, so it does not overwrite a prior candidate or the repository's `dist` tree.

This is a **local candidate**, not a public or fresh-device installer. It does not bundle Termux packages, the local voice model/runtime dependencies, SillyTavern, or user data. The public repository, one-command setup, automatic updates, KeyFlow compatibility, and clean-device installation test remain separate gates. Keep the candidate private until those gates are completed.
