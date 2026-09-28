import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function replaceRequired(source, search, replacement, label) {
  if (!source.includes(search)) throw new Error(`runtime-patch-anchor-missing:${label}`);
  return source.replace(search, replacement);
}

const ROUTER_CONSTANTS = `BASE = os.environ.get("TMRW_VOICE_MODEL", os.path.expanduser("~/genie-tts-portable/CharacterModels/genie-v2proplus-base"))
PROFILE = os.environ.get("TMRW_VOICE_PROFILE", os.path.expanduser("~/.tmrw-voice/profiles/tmrw-male-core/voice.voiceprofile.npz"))
VOICE_HOME = os.path.realpath(os.environ.get("TMRW_VOICE_HOME", os.path.expanduser("~/.tmrw-voice")))
CATALOG_PATH = os.environ.get("TMRW_VOICE_CATALOG", os.path.join(VOICE_HOME, "current", "catalog", "presets.v1.json"))
DEFAULT_PROFILE_ID = os.environ.get("TMRW_VOICE_PROFILE_ID", "tmrw-male-core")
PROFILE_CACHE = {}
PROFILE_CACHE_LOCK = threading.Lock()`;

const REFERENCE_ROUTER = `def normalize_profile_id(value):
    value = str(value or DEFAULT_PROFILE_ID).strip().lower()
    safe = "".join(ch for ch in value if ch.isalnum() or ch in "._-")[:96]
    if not safe or safe != value:
        raise ValueError("invalid profile_id")
    return safe


def resolve_profile(profile_id):
    profile_id = normalize_profile_id(profile_id)
    # Each preset is its own cloned speaker; do not recolour generated audio.
    candidate = os.path.realpath(os.path.join(VOICE_HOME, "profiles", profile_id, "voice.voiceprofile.npz"))
    profiles_root = os.path.realpath(os.path.join(VOICE_HOME, "profiles")) + os.sep
    if not candidate.startswith(profiles_root) or not os.path.isfile(candidate):
        if profile_id == DEFAULT_PROFILE_ID and os.path.isfile(PROFILE):
            candidate = os.path.realpath(PROFILE)
        else:
            raise FileNotFoundError(f"voice profile not installed: {profile_id}")

    with PROFILE_CACHE_LOCK:
        ref = PROFILE_CACHE.get(candidate)
        if ref is None:
            ref = build_reference(candidate)
            PROFILE_CACHE[candidate] = ref
    return ref, profile_id


`;

export function patchMobileRuntime(input) {
  let source = String(input);
  const legacyProfile = `~/${['puz', 'zle'].join('')}.voiceprofile.npz`;
  const legacyVoice = ['Puz', 'zle'].join('');
  source = replaceRequired(source,
    `BASE = os.path.expanduser("~/genie-tts-portable/CharacterModels/genie-v2proplus-base")\nPROFILE = os.path.expanduser("${legacyProfile}")`,
    ROUTER_CONSTANTS,
    'paths');
  source = replaceRequired(source, 'def build_reference():\n    d = np.load(PROFILE)', 'def build_reference(profile_path=PROFILE):\n    d = np.load(profile_path)', 'build-reference');
  source = replaceRequired(source, '    return ref\n\n\ndef load_engine():', `    return ref\n\n\n${REFERENCE_ROUTER}def load_engine():`, 'reference-router');
  source = replaceRequired(source, '        ref = build_reference()', '        ref, _ = resolve_profile(DEFAULT_PROFILE_ID)', 'default-reference');
  source = replaceRequired(source,
    'def t2s(text, language, first_chunk):\n    with ENGINE_LOCK:\n        ref = ENGINE["ref"]\n\n        if first_chunk:',
    'def t2s(text, language, first_chunk, ref):\n    with ENGINE_LOCK:\n        if first_chunk:',
    't2s-reference');
  source = replaceRequired(source,
    'def vits_run(text_seq, semantic):\n    with ENGINE_LOCK:\n        ref = ENGINE["ref"]\n        vits = ENGINE["vits"]',
    'def vits_run(text_seq, semantic, ref):\n    with ENGINE_LOCK:\n        vits = ENGINE["vits"]',
    'vits-reference');
  source = replaceRequired(source,
    'class Turn:\n    def __init__(self, expected, language, natural_pause, calibration=False):',
    'class Turn:\n    def __init__(self, expected, language, natural_pause, calibration=False, profile_id=DEFAULT_PROFILE_ID):',
    'turn-signature');
  source = replaceRequired(source,
    '        self.created = now()\n\n        self.start_hold',
    '        self.created = now()\n        self.ref, self.profile_id = resolve_profile(profile_id)\n\n        self.start_hold',
    'turn-profile');
  source = replaceRequired(source,
    '                first_chunk=first_chunk,\n            )',
    '                first_chunk=first_chunk,\n                ref=self.ref,\n            )',
    'normal-t2s-call');
  source = replaceRequired(source,
    '            with ENGINE_LOCK:\n                ref = ENGINE["ref"]\n                encoder = ENGINE["encoder2"]',
    '            with ENGINE_LOCK:\n                ref = self.ref\n                encoder = ENGINE["encoder2"]',
    'gated-t2s-reference');
  source = replaceRequired(source, '        audio, dt = vits_run(seq, sem)\n        raw = wav_bytes(audio)', '        audio, dt = vits_run(seq, sem, self.ref)\n        raw = wav_bytes(audio)', 'vits-call');
  source = replaceRequired(source,
    '            calibration = bool(body.get("calibration", False))\n\n            turn = Turn(',
    '            calibration = bool(body.get("calibration", False))\n            profile_id = str(body.get("profile_id", DEFAULT_PROFILE_ID))\n\n            turn = Turn(',
    'handler-profile');
  source = replaceRequired(source,
    '                calibration=calibration,\n            )',
    '                calibration=calibration,\n                profile_id=profile_id,\n            )',
    'handler-turn-profile');
  source = replaceRequired(source,
    '                "calibration": calibration,\n                "natural_pause_ms":',
    '                "calibration": calibration,\n                "profile_id": turn.profile_id,\n                "natural_pause_ms":',
    'handler-response-profile');
  source = source.replace(`"voice": "${legacyVoice}"`, '"voice": "TMRW Local Voice"');
  return source;
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  const sourcePath = process.argv.slice(2).find(value => !value.startsWith('--'));
  const source = sourcePath ? await fs.readFile(sourcePath, 'utf8') : await new Promise((resolve, reject) => {
    let value = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { value += chunk; });
    process.stdin.once('end', () => resolve(value));
    process.stdin.once('error', reject);
  });
  const patched = patchMobileRuntime(source);
  const outputOption = process.argv.slice(2).find(value => value.startsWith('--output='));
  if (outputOption) await fs.writeFile(outputOption.slice('--output='.length), patched);
  if (process.argv.includes('--check')) process.stdout.write(`ok ${patched.length}\n`);
  else if (!outputOption) process.stdout.write(patched);
}
