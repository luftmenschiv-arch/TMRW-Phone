import fs from 'node:fs/promises';

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
PROFILE_CACHE_LOCK = threading.Lock()
PRESET_PARAMETERS = {}

try:
    with open(CATALOG_PATH, "r", encoding="utf-8") as catalog_file:
        catalog_value = json.load(catalog_file)
    PRESET_PARAMETERS = {
        str(item.get("id")): dict(item.get("parameters") or {})
        for item in catalog_value.get("presets", [])
        if item.get("id")
    }
except Exception as catalog_error:
    print(f"Voice preset catalog unavailable: {catalog_error}", flush=True)`;

const REFERENCE_ROUTER = `def normalize_profile_id(value):
    value = str(value or DEFAULT_PROFILE_ID).strip().lower()
    safe = "".join(ch for ch in value if ch.isalnum() or ch in "._-")[:96]
    if not safe or safe != value:
        raise ValueError("invalid profile_id")
    return safe


def resolve_profile(profile_id):
    profile_id = normalize_profile_id(profile_id)
    preset = PRESET_PARAMETERS.get(profile_id)
    if profile_id.startswith("female-"):
        resolved_id = "tmrw-female-core"
    elif profile_id.startswith("male-"):
        resolved_id = "tmrw-male-core"
    else:
        resolved_id = profile_id

    candidate = os.path.realpath(os.path.join(VOICE_HOME, "profiles", resolved_id, "voice.voiceprofile.npz"))
    profiles_root = os.path.realpath(os.path.join(VOICE_HOME, "profiles")) + os.sep
    if not candidate.startswith(profiles_root) or not os.path.isfile(candidate):
        if resolved_id == DEFAULT_PROFILE_ID and os.path.isfile(PROFILE):
            candidate = os.path.realpath(PROFILE)
        else:
            raise FileNotFoundError(f"voice profile not installed: {profile_id}")

    with PROFILE_CACHE_LOCK:
        ref = PROFILE_CACHE.get(candidate)
        if ref is None:
            ref = build_reference(candidate)
            PROFILE_CACHE[candidate] = ref
    return ref, preset, profile_id


def preset_value(preset, key, fallback=0.0):
    try:
        return float((preset.get(key) or {}).get("value", fallback))
    except Exception:
        return float(fallback)


def apply_voice_preset(audio, preset):
    """Cheap deterministic colour for the 24 bundled presets; clones stay untouched."""
    if not preset:
        return np.asarray(audio, dtype=np.float32)
    output = np.asarray(audio, dtype=np.float32).reshape(-1)
    if output.size < 8:
        return output

    pitch = preset_value(preset, "PITCH_CENTER")
    rate = preset_value(preset, "SPEAKING_RATE")
    brightness = preset_value(preset, "BRIGHTNESS")
    warmth = preset_value(preset, "WARMTH")
    weight = preset_value(preset, "VOCAL_WEIGHT")
    roughness = preset_value(preset, "ROUGHNESS")
    energy = preset_value(preset, "ENERGY")

    # A single high-quality interpolation pass is deliberately used here: it is
    # dependency-free and keeps the mobile real-time budget predictable.
    speed = float(np.clip(1.0 + rate * 0.0025 + pitch * 0.0018, 0.82, 1.18))
    target = max(8, int(round(output.size / speed)))
    output = np.interp(
        np.linspace(0.0, output.size - 1.0, target, dtype=np.float64),
        np.arange(output.size, dtype=np.float64),
        output,
    ).astype(np.float32)

    tone = float(np.clip((warmth - brightness) / 180.0, -0.38, 0.38))
    if abs(tone) > 0.015:
        smooth = np.convolve(output, np.ones(5, dtype=np.float32) / 5.0, mode="same")
        output = output * (1.0 - max(0.0, tone)) + smooth * max(0.0, tone)
        if tone < 0.0:
            output = output + (output - smooth) * (-tone)

    drive = float(np.clip(1.0 + max(-10.0, roughness + weight * 0.35) / 95.0, 0.92, 1.45))
    output = np.tanh(output * drive) / np.tanh(drive)
    gain = float(np.clip(10.0 ** (energy / 240.0), 0.72, 1.35))
    return np.clip(output * gain, -1.0, 1.0).astype(np.float32, copy=False)


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
  source = replaceRequired(source, '        ref = build_reference()', '        ref, _, _ = resolve_profile(DEFAULT_PROFILE_ID)', 'default-reference');
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
    '        self.created = now()\n        self.ref, self.preset, self.profile_id = resolve_profile(profile_id)\n\n        self.start_hold',
    'turn-profile');
  source = replaceRequired(source,
    '                first_chunk=first_chunk,\n            )',
    '                first_chunk=first_chunk,\n                ref=self.ref,\n            )',
    'normal-t2s-call');
  source = replaceRequired(source,
    '            with ENGINE_LOCK:\n                ref = ENGINE["ref"]\n                encoder = ENGINE["encoder2"]',
    '            with ENGINE_LOCK:\n                ref = self.ref\n                encoder = ENGINE["encoder2"]',
    'gated-t2s-reference');
  source = replaceRequired(source, '        audio, dt = vits_run(seq, sem)\n        raw = wav_bytes(audio)', '        audio, dt = vits_run(seq, sem, self.ref)\n        audio = apply_voice_preset(audio, self.preset)\n        raw = wav_bytes(audio)', 'vits-call');
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

if (process.argv[1] && new URL(import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/u, value => value.slice(1)).replaceAll('/', '\\').toLowerCase() === process.argv[1].toLowerCase()) {
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
