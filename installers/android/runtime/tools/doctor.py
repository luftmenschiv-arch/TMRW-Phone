import json, os, sys, subprocess
from pathlib import Path

root = Path(__file__).resolve().parent.parent
assert sys.version_info[:2] == (3, 13), 'requires-bundled-python-3.13'
assert Path(sys.base_prefix).resolve() == root / 'python', 'python-escaped-pack'
import numpy, onnx, onnxruntime, soundfile, pyopenjtalk
from genie_tts.Core.Inference import get_phones_and_bert
for language, text in [('English', 'Hello, it is nice to speak with you today.'), ('japanese', 'こんにちは、今日はどんなお話をしましょうか。')]:
    result = get_phones_and_bert(text, language)
    assert result is not None, 'g2p-failed-' + language
subprocess.run([str(root/'stt/whisper-cli'), '--help'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
assert (root/'stt/ggml-base-q5_1.bin').stat().st_size > 50000000
print(json.dumps({'ok': True, 'python': sys.version.split()[0], 'numpy': numpy.__version__, 'onnxruntime': onnxruntime.__version__, 'languages': ['en', 'ja'], 'stt': True}))
