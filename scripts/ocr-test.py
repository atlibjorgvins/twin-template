#!/usr/bin/env python3
"""
Phase 0 gate for the receipt-OCR work (docs/ocr-service-plan.md).

OCRs a folder of images with the same models the NAS service will use
(PP-OCRv5_mobile_det + latin_PP-OCRv5_mobile_rec) and prints every line
with its confidence, so we can judge ONE thing before building anything:

    do Icelandic glyphs (þ ð æ ö é í á ú ý) survive on real receipts?

That is the go/no-go. Secondary: are the amount lines ("Samtals",
"1.234 kr") readable, and do creased/rotated photos still detect.

Usage
-----
    # one-time setup (from the repo root)
    python3 -m venv .venv-ocr
    .venv-ocr/bin/pip install "paddlepaddle==3.0.0" "paddleocr==3.1.0"

    # drop 5-10 real receipts + 2-3 screenshots into a folder, then:
    .venv-ocr/bin/python scripts/ocr-test.py ~/Desktop/receipts

    # write the raw result as parser fixtures (Phase 4 uses these):
    .venv-ocr/bin/python scripts/ocr-test.py ~/Desktop/receipts --json out/

Nothing here talks to Directus or the network beyond the one-off model
download on first run — it is a local sanity check only.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".tif", ".tiff", ".bmp"}

# The glyphs that decide the gate.
ICELANDIC = "þðæöéíáúýÞÐÆÖÉÍÁÚÝ"
# Keywords the Phase 4 parser will hunt for — worth surfacing per image.
AMOUNT_HINTS = re.compile(r"samtals|alls|til grei|heildar|upph|total", re.IGNORECASE)
DATE_RE = re.compile(r"\b(\d{1,2}[./]\d{1,2}[./]\d{2,4}|\d{4}-\d{2}-\d{2})\b")
MONEY_RE = re.compile(r"\b\d{1,3}(?:[.\s]\d{3})*(?:,\d{2})?\b\s*(?:kr|isk)?", re.IGNORECASE)


def build_ocr():
    """PP-OCRv5 mobile det + latin mobile rec — exactly what Phase 1 bakes in."""
    from paddleocr import PaddleOCR

    return PaddleOCR(
        text_detection_model_name="PP-OCRv5_mobile_det",
        text_recognition_model_name="latin_PP-OCRv5_mobile_rec",
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
        lang="latin",
    )


def lines_from_result(result) -> list[dict]:
    """Normalise PaddleOCR 3.x output to the service's contract:
    [{ text, box, score }] — same shape POST /ocr will return."""
    out: list[dict] = []
    for page in result or []:
        # 3.x returns dict-like results (predict API).
        data = page.get("res", page) if isinstance(page, dict) else page
        texts = data.get("rec_texts") or []
        scores = data.get("rec_scores") or []
        boxes = data.get("rec_polys") or data.get("dt_polys") or []
        for i, text in enumerate(texts):
            score = float(scores[i]) if i < len(scores) else 0.0
            raw_box = boxes[i] if i < len(boxes) else None
            box = [[float(x), float(y)] for x, y in raw_box] if raw_box is not None else None
            out.append({"text": text, "score": score, "box": box})
    return out


def summarise(path: Path, lines: list[dict], elapsed: float) -> dict:
    joined = "\n".join(l["text"] for l in lines)
    found_glyphs = sorted({ch for ch in joined if ch in ICELANDIC})
    scores = [l["score"] for l in lines] or [0.0]
    return {
        "file": path.name,
        "lines": len(lines),
        "seconds": round(elapsed, 2),
        "mean_score": round(sum(scores) / len(scores), 3),
        "min_score": round(min(scores), 3),
        "icelandic_glyphs": "".join(found_glyphs),
        "amount_hint_lines": [l["text"] for l in lines if AMOUNT_HINTS.search(l["text"])],
        "date_candidates": DATE_RE.findall(joined),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="Phase 0 PaddleOCR gate for Icelandic receipts")
    ap.add_argument("folder", type=Path, help="folder of receipt images")
    ap.add_argument("--json", type=Path, default=None,
                    help="also write <name>.json per image (parser fixtures)")
    ap.add_argument("--quiet", action="store_true", help="summaries only, no per-line dump")
    args = ap.parse_args()

    if not args.folder.is_dir():
        print(f"not a folder: {args.folder}", file=sys.stderr)
        return 2

    images = sorted(p for p in args.folder.iterdir() if p.suffix.lower() in IMAGE_SUFFIXES)
    if not images:
        print(f"no images in {args.folder} (looked for {', '.join(sorted(IMAGE_SUFFIXES))})",
              file=sys.stderr)
        return 2

    print(f"→ {len(images)} image(s) from {args.folder}")
    print("  loading PP-OCRv5 mobile det + latin mobile rec "
          "(first run downloads the models)…\n")
    ocr = build_ocr()

    if args.json:
        args.json.mkdir(parents=True, exist_ok=True)

    summaries = []
    for path in images:
        t0 = time.time()
        try:
            result = ocr.predict(str(path))
        except Exception as exc:  # noqa: BLE001 — a bad file shouldn't kill the run
            print(f"✗ {path.name}: {type(exc).__name__}: {exc}\n")
            continue
        lines = lines_from_result(result)
        elapsed = time.time() - t0
        s = summarise(path, lines, elapsed)
        summaries.append(s)

        print(f"── {path.name}  ({s['lines']} lines, {s['seconds']}s, "
              f"mean {s['mean_score']}, min {s['min_score']})")
        if s["icelandic_glyphs"]:
            print(f"   icelandic glyphs seen: {s['icelandic_glyphs']}")
        else:
            print("   icelandic glyphs seen: (none — check whether the receipt has any)")
        if s["amount_hint_lines"]:
            print(f"   amount keyword lines: {s['amount_hint_lines']}")
        if s["date_candidates"]:
            print(f"   date candidates: {s['date_candidates']}")
        if not args.quiet:
            for l in lines:
                flag = "  " if l["score"] >= 0.90 else ("~ " if l["score"] >= 0.70 else "! ")
                print(f"   {flag}{l['score']:.2f}  {l['text']}")
        print()

        if args.json:
            (args.json / f"{path.stem}.json").write_text(
                json.dumps({"file": path.name, "lines": lines}, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )

    if not summaries:
        print("nothing OCR'd successfully.")
        return 1

    all_glyphs = "".join(sorted({ch for s in summaries for ch in s["icelandic_glyphs"]}))
    mean = sum(s["mean_score"] for s in summaries) / len(summaries)
    low = [s["file"] for s in summaries if s["mean_score"] < 0.80]
    print("═" * 62)
    print(f"GATE SUMMARY — {len(summaries)} image(s), mean confidence {mean:.3f}")
    print(f"  Icelandic glyphs recognised anywhere: {all_glyphs or '(none)'}")
    print(f"  images with mean < 0.80: {low or 'none'}")
    print(f"  images with an amount keyword line: "
          f"{sum(1 for s in summaries if s['amount_hint_lines'])}/{len(summaries)}")
    print(f"  images with a date candidate: "
          f"{sum(1 for s in summaries if s['date_candidates'])}/{len(summaries)}")
    print()
    print("  Judge: do þ ð æ ö come out correct in the lines above (not as")
    print("  ?/e/o/blank)? If yes → build the latin-model service as specced.")
    print("  If no → fall back to the `en` model + accent-tolerant fuzzy")
    print("  matching in the parser (spec Phase 0, decide once).")
    if args.json:
        print(f"\n  fixtures written to {args.json}/ — Phase 4 parser tests use these.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
