"""NARRATION FOR THE DEMO VIDEOS (spec 026) — Kokoro, offline; no text or audio leaves the machine.

    py tools/demo/voice.py <lines.json> <out_dir> [voice]

lines.json is [{"id": "s01", "text": "..."}]; writes <out_dir>/<id>.wav (24 kHz mono) for each line and prints
{"<id>": seconds, ...} as JSON. The model lives in %LOCALAPPDATA%\\kokoro (kokoro-v1.0.onnx + voices-v1.0.bin).
"""
import json
import os
import sys

import soundfile as sf
from kokoro_onnx import Kokoro


def main():
    lines_path, out_dir = sys.argv[1], sys.argv[2]
    voice = sys.argv[3] if len(sys.argv) > 3 else "bm_george"
    model_dir = os.path.join(os.environ.get("LOCALAPPDATA", ""), "kokoro")
    kokoro = Kokoro(os.path.join(model_dir, "kokoro-v1.0.onnx"), os.path.join(model_dir, "voices-v1.0.bin"))
    os.makedirs(out_dir, exist_ok=True)
    with open(lines_path, encoding="utf-8") as f:
        lines = json.load(f)
    lengths = {}
    for line in lines:
        samples, rate = kokoro.create(line["text"], voice=voice, speed=1.0, lang="en-gb")
        sf.write(os.path.join(out_dir, line["id"] + ".wav"), samples, rate)
        lengths[line["id"]] = round(len(samples) / rate, 3)
    print(json.dumps(lengths))


if __name__ == "__main__":
    main()
