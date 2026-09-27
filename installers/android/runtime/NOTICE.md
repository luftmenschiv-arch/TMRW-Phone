# TMRW Local Voice — third-party notices and source

This beta packages a private Python 3.13 environment, the approved optimized
Genie/GPT-SoVITS inference path, speech resources, and whisper.cpp transcription.
No global Python replacement or model retraining is performed by the installer.

Third-party software retains its own copyright and license. The package does not
relicense those components or imply their authors endorse TMRW or its presets.

- Python: `notices/python/` and Python distribution metadata.
- Genie-TTS / GPT-SoVITS: `notices/upstream/genie-MIT.txt` and
  `gpt-sovits-MIT.txt`; model/resource upstream: https://huggingface.co/High-Logic/Genie.
- ONNX Runtime, Abseil, protobuf/utf8_range, RE2, OpenBLAS and LAPACK:
  `notices/upstream/`, including ONNX Runtime third-party notices. The notice
  snapshot URLs and checksums are in `upstream-notices.json`.
- whisper.cpp / ggml: `notices/whisper-LICENSE`; the Whisper model license is in
  `notices/upstream/whisper-model-MIT.txt`. Transcription weights originate from
  https://huggingface.co/ggerganov/whisper.cpp (base-q5_1).
- Bundled Termux support libraries: `notices/termux/` (copyright files and
  upstream documentation). Unused readline/gdbm libraries and their optional
  Python native modules are deliberately not part of this runtime distribution.
- Python packages include their installed source and `.dist-info` metadata and
  license files under `python/site-packages` and `onnx/site-packages`.
- Python-SoXR 0.4.0 / libsoxr: LGPL source, build configuration, license, and build
  instructions accompany this release at `sources/python-soxr-0.4.0/`, including
  `COPYING.LGPL`, `LICENSE.txt`, `BUILDING.md`, `setup.py`, `src/` and `libsoxr/`.
  The Python native extension can be rebuilt/replaced from those sources. Use a
  separate writable copy when experimenting; modifying a verified release's
  files will intentionally cause its integrity check to fail on reinstallation.
  The source is provided with the binary, not merely promised on request.

The included model files are the approved optimized Neutral base identified in
`payload.json`; reference voices are separate preset profiles. Generated speech
is synthetic and is not a recording of a live speaker. Reference permissions
are managed by the project owner and are separate from the engine licenses.

This notice inventory is not a legal warranty. See individual license texts for
terms, notices, authors and disclaimers. Keep these files with redistributed
copies. Release hashes, not mutable upstream branches, identify shipped bytes.
