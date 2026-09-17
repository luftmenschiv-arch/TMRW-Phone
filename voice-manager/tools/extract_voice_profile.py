#!/usr/bin/env python3
import argparse, gc, os
from pathlib import Path
import numpy as np
from genie_tts.Audio.ReferenceAudio import ReferenceAudio
from genie_tts.ModelManager import model_manager, load_session_with_fp16_conversion

parser = argparse.ArgumentParser()
parser.add_argument('--audio', required=True)
parser.add_argument('--transcript', required=True)
parser.add_argument('--language', choices=('English', 'japanese'), required=True)
parser.add_argument('--output', required=True)
parser.add_argument('--model', default=os.environ.get('TMRW_VOICE_MODEL', str(Path.home()/'.tmrw-voice/current/model')))
args = parser.parse_args()

output = Path(args.output); output.parent.mkdir(parents=True, exist_ok=True)
ref = ReferenceAudio(prompt_wav=args.audio, prompt_text=args.transcript, language=args.language)
arrays = {'phonemes_seq': np.array(ref.phonemes_seq, copy=True), 'text_bert': np.array(ref.text_bert, copy=True), 'ssl_content': np.array(ref.ssl_content, copy=True)}
model_manager.cn_hubert = None; model_manager.roberta_model = None; model_manager.roberta_tokenizer = None; gc.collect()
encoder = load_session_with_fp16_conversion(str(Path(args.model)/'prompt_encoder_fp32.onnx'), str(Path(args.model)/'prompt_encoder_fp16.bin'), ['CPUExecutionProvider'])
ref.update_global_emb(prompt_encoder=encoder)
arrays.update(global_emb=np.array(ref.global_emb, copy=True), global_emb_advanced=np.array(ref.global_emb_advanced, copy=True))
temporary = output.with_suffix('.partial.npz'); np.savez(temporary, **arrays); os.replace(temporary, output)
print('{"ok":true}')
