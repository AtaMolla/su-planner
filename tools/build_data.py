"""Build data/courses.js from a course-data JSON file or URL.

Usage:
    python tools/build_data.py SOURCE [TERM_CODE]

SOURCE     a local .json file or an http(s) URL holding {courses, instructors, places}
TERM_CODE  Sabancı term code, e.g. 202601 = Fall 2026-2027 (default 202601)

The output is a plain .js file so index.html also works when opened from disk.
"""
import json
import pathlib
import sys
import urllib.request

SEASONS = {"01": "Fall", "02": "Spring", "03": "Summer"}
OUT = pathlib.Path(__file__).resolve().parent.parent / "data" / "courses.js"


def term_name(code):
    year = int(code[:4])
    return f"{SEASONS.get(code[4:], 'Term')} {year}-{year + 1}"


def load(src):
    if src.startswith(("http://", "https://")):
        with urllib.request.urlopen(src, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    return json.loads(pathlib.Path(src).read_text(encoding="utf-8"))


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    data = load(sys.argv[1])
    missing = [k for k in ("courses", "instructors", "places") if k not in data]
    if missing:
        sys.exit(f"Source data is missing: {', '.join(missing)}")

    term = sys.argv[2] if len(sys.argv) > 2 else "202601"
    out = {
        "term": term,
        "termName": term_name(term),
        "courses": data["courses"],
        "instructors": data["instructors"],
        "places": data["places"],
    }
    OUT.parent.mkdir(exist_ok=True)
    body = json.dumps(out, ensure_ascii=False, separators=(",", ":"))
    OUT.write_text(f"window.COURSE_DATA = {body};\n", encoding="utf-8")
    print(f"Wrote {len(out['courses'])} courses ({out['termName']}) to {OUT}")


if __name__ == "__main__":
    main()
