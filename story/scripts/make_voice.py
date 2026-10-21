"""Narration for the PHIRE videos: Kokoro text-to-speech, one WAV per beat, plus a timing manifest.

Run from the repo root with the voice venv (see story/README.md for the one-time setup):

    story/.voice-venv/bin/python story/scripts/make_voice.py              # both versions
    story/.voice-venv/bin/python story/scripts/make_voice.py --audition   # one line in each British voice

The narration is the `voice` text of each beat in story/js/beats.js. Each sentence is synthesised on its own (so
it keeps natural intonation) and the sentences are joined with a short pause. A sentence is split into
caption-sized phrases, timed within it in proportion to their length. Output goes to story/video/voice/
(git-ignored): <version>/<beat>.wav and <version>.json, which the page reads in video mode with ?voice.
"""

import json
import re
import subprocess
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

STORY = Path(__file__).resolve().parent.parent
MODELS = STORY / ".voice-models"
OUT = STORY / "video" / "voice"

VOICE = "bm_george"  # British voices: bf_alice bf_emma bf_isabella bf_lily bm_daniel bm_fable bm_george bm_lewis
SPEED = 1.08  # a little brisker than the default, as suits short-form video
LANG = "en-gb"
SENTENCE_GAP_S = 0.3
MAX_PHRASE_CHARS = 64  # longest caption phrase, in characters

# Written form in beats.js -> what the voice should say. The captions keep the written form.
PRONOUNCE = [
    (r"\bPHIRE\b", "Fire"),
    (r"\bPOLAR\b", "Polar"),
    (r"\bRonne\b", "Ronnie"),
    (r"\b550 metres\b", "five hundred and fifty metres"),
    (r"\b2014\b", "twenty fourteen"),
]

# Phonemes the espeak front end gets wrong -> corrected phonemes (IPA, as kokoro_onnx's tokenizer writes them)
PHONEME_FIXES = [
    ("kɹˈɛvəsɪz", "kɹɪvˈæsɪz"),  # crevasses: stress on the second syllable, not "crevices"
    ("kɹˈɛvəs", "kɹɪvˈæs"),  # crevasse
]

AUDITION_LINE = "On the last day, we pushed north along the ridge. And in the far corner, the deepest ice lit up with something strange."
AUDITION_VOICES = ["bf_emma", "bf_isabella", "bm_george", "bm_lewis"]


def load_beats():
    js = "import('./js/beats.js').then(m => process.stdout.write(JSON.stringify(m.VERSIONS)))"
    out = subprocess.run(["node", "--input-type=module", "-e", js], cwd=STORY, check=True, capture_output=True, text=True)
    return json.loads(out.stdout)


def spoken(text):
    for pat, rep in PRONOUNCE:
        text = re.sub(pat, rep, text)
    return text


def sentences(text):
    return [s for s in re.split(r"(?<=[.?!])\s+", text.strip()) if s]


def phrases(sentence):
    """Split a sentence into caption phrases at commas and colons, each at most MAX_PHRASE_CHARS where possible."""
    pieces = re.split(r"(?<=[,:;])\s+", sentence)
    out = []
    for p in pieces:
        if out and len(out[-1]) + 1 + len(p) <= MAX_PHRASE_CHARS:
            out[-1] = f"{out[-1]} {p}"
        else:
            out.append(p)
    return out


def trim(samples, sr, pad_s=0.04):
    """Cut leading and trailing silence, keeping a little padding."""
    loud = np.flatnonzero(np.abs(samples) > 0.02 * np.abs(samples).max())
    if not len(loud):
        return samples
    pad = int(pad_s * sr)
    return samples[max(0, loud[0] - pad) : loud[-1] + pad]


def synth(kokoro, text, voice):
    ph = kokoro.tokenizer.phonemize(spoken(text), LANG)
    for wrong, right in PHONEME_FIXES:
        ph = ph.replace(wrong, right)
    samples, sr = kokoro.create(ph, voice=voice, speed=SPEED, lang=LANG, is_phonemes=True)
    return trim(samples, sr), sr


def narrate(kokoro, text, voice):
    """Speech for a beat, and its caption phrases with start and end times in seconds."""
    chunks, timed, t, sr = [], [], 0.0, 24000
    for i, sent in enumerate(sentences(text)):
        samples, sr = synth(kokoro, sent, voice)
        dur = len(samples) / sr
        parts = phrases(sent)
        weights = np.array([len(p) for p in parts], float)
        edges = t + dur * np.concatenate([[0], np.cumsum(weights) / weights.sum()])
        timed += [{"text": p, "start": round(edges[k], 3), "end": round(edges[k + 1], 3)} for k, p in enumerate(parts)]
        chunks.append(samples)
        t += dur
        if i < len(sentences(text)) - 1:
            chunks.append(np.zeros(int(SENTENCE_GAP_S * sr), np.float32))
            t += SENTENCE_GAP_S
    return np.concatenate(chunks), sr, timed


def main():
    from kokoro_onnx import Kokoro

    kokoro = Kokoro(str(MODELS / "kokoro-v1.0.onnx"), str(MODELS / "voices-v1.0.bin"))
    if "--audition" in sys.argv:
        d = OUT / "audition"
        d.mkdir(parents=True, exist_ok=True)
        for v in AUDITION_VOICES:
            audio, sr, _ = narrate(kokoro, AUDITION_LINE, v)
            sf.write(d / f"{v}.wav", audio, sr)
            print(f"  {d / (v + '.wav')}")
        return

    for version, beats in load_beats().items():
        d = OUT / version
        d.mkdir(parents=True, exist_ok=True)
        manifest = {"voice": VOICE, "speed": SPEED, "beats": {}}
        for b in beats:
            if not b.get("voice"):
                continue
            audio, sr, timed = narrate(kokoro, b["voice"], VOICE)
            f = d / f"{b['id']}.wav"
            sf.write(f, audio, sr)
            manifest["beats"][b["id"]] = {"file": f"video/voice/{version}/{f.name}", "seconds": round(len(audio) / sr, 3), "phrases": timed}
            print(f"  {version:5s} {b['id']:12s} {len(audio) / sr:5.1f} s  (beat {b['dur']} s)")
        (OUT / f"{version}.json").write_text(json.dumps(manifest, indent=1))


if __name__ == "__main__":
    main()
