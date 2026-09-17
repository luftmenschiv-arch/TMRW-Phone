#!/usr/bin/env python3
import argparse, json, os, shutil, subprocess, tempfile
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--audio', required=True)
parser.add_argument('--language', choices=('auto', 'en', 'ja'), default='auto')
parser.add_argument('--model', default=os.environ.get('TMRW_STT_MODEL', str(Path.home()/'.tmrw-voice/current/stt/ggml-base-q5_1.bin')))
args = parser.parse_args()
bundled = Path.home()/'.tmrw-voice/current/stt/whisper-cli'
binary = os.environ.get('TMRW_WHISPER_CLI') or (str(bundled) if bundled.is_file() else shutil.which('whisper-cli'))
ffmpeg = os.environ.get('TMRW_FFMPEG') or shutil.which('ffmpeg')
if not binary: raise SystemExit('whisper-cli-not-installed')
if not ffmpeg: raise SystemExit('ffmpeg-not-installed')
if not Path(args.model).is_file(): raise SystemExit('whisper-model-not-installed')
wav = Path(args.audio).with_suffix('.wav')
subprocess.run([ffmpeg, '-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', args.audio, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', str(wav)], check=True)
with tempfile.TemporaryDirectory(prefix='tmrw-stt-') as temporary:
    output = Path(temporary)/'transcript'
    command = [binary, '-m', args.model, '-f', str(wav), '-otxt', '-of', str(output)]
    if args.language != 'auto': command += ['-l', args.language]
    subprocess.run(command, check=True, stdout=subprocess.DEVNULL)
    text = output.with_suffix('.txt').read_text(encoding='utf-8').strip()
print(json.dumps({'text': text, 'language': args.language, 'editable': True, 'normalized': True}, ensure_ascii=False))
