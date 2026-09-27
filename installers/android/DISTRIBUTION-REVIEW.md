# Complete runtime distribution review — still open

The local candidate is not a publicly approved binary release. This file records
concrete packaging work, not a legal opinion or a blanket license certification.
Do not set `qualification.publishApproved` just because the runtime passes tests.

## Known provenance

- Active approved clone-only runtime input SHA-256:
  `1300db3c5ca48945bfdcbf80a72f732e862e82d82122d9d2929bf9192a2aa77b`.
- Packaging changes only the bind-host/port constants to configurable values.
  Packaged runtime SHA-256:
  `b1d45969bc50de04352277029f49b5f63c59ba093785ef40a009bfd44248f457`.
- Approved Neutral model `t2s_shared_fp16.bin` SHA-256:
  `52350b81f9a3fbaa0f707c6c45af85f0edec6ec64231440ea75f9b049bffdabd`.
- Private Python 3.13.12, NumPy 2.2.5, ONNX Runtime 1.24.3,
  Genie-TTS 2.0.2, whisper.cpp 1.9.4 + base-q5_1 transcription model.
- Candidate includes Python license files, whisper.cpp LICENSE, and Python
  distribution metadata/licenses. These are not a complete native-library audit.

## Concrete gaps before public binary upload

1. `libreadline.so.8`, `libgdbm.so` and `libgdbm_compat.so` were copied by the ELF
   dependency resolver from the phone's Termux prefix. Installed versions are
   readline 8.3.3 and gdbm 1.26-1; their on-device copyright files are GPLv3.
   The candidate has neither a corresponding-source bundle/build patches for
   these exact builds nor their copied copyright files. Resolve this, or make
   them explicit upstream Termux package dependencies instead of redistributing
   their binaries. Re-qualify after changing the dependency boundary.
2. Python-SoXR 0.4.0 metadata identifies LGPLv2.1+. The phone contains its original
   source archive and build tree under `soxr-040-android/`, including libsoxr,
   setup files and COPYING.LGPL. Capture the relevant source/build changes in a
   reviewed source bundle; do not assume the wheel's license file alone is enough.
3. Inventory the remaining copied native libraries (Abseil, OpenBLAS, protobuf,
   RE2, OpenSSL, libc++, etc.), their notices, and source/build provenance.
   Preserve all required attribution alongside the distributable artifacts.
4. Record exact model/resource provenance separately from the engine's license.
   The Genie engine's MIT declaration does not by itself establish the terms of
   every model, dictionary, reference recording or preset identity.
5. The preset sources were user-provided game voice references. Technical identity
   tests are not evidence of public redistribution/performer permission. Do not
   describe these as licensed or consented voices without supporting evidence.
   No new voice identity substitutions were made in this installer task.

## Primary references checked 2026-09-28

- [Genie-TTS engine](https://github.com/High-Logic/Genie-TTS)
- [Genie model/resource repository](https://huggingface.co/High-Logic/Genie)
- [Termux readline build recipe](https://github.com/termux/termux-packages/blob/master/packages/readline/build.sh)
- [Termux gdbm build recipe](https://github.com/termux/termux-packages/blob/master/packages/gdbm/build.sh)

The current online readline recipe is newer than the installed 8.3.3 binary;
do not silently label a current-master recipe as the exact original build.

After this review: produce immutable public artifacts, record their qualified
hashes, build the pinned bootstrap, then test anonymous HTTPS installation and
repeat installation. Keep the public UI runtime-pack URL disabled until its
installer schema is deliberately integrated; the new CLI schema is not the old
Voice Manager pack-index schema. Automatic updates belong to Step 5, not this
release gate.
