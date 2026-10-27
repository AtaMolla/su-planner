"""Download a term's class schedule (sections, days, times, rooms, instructors) from
Sabancı's public class search and save it as data/schedule-<TERM>.js.

Usage:
    python tools/build_schedule.py TERM

TERM  e.g. 202602 = Spring 2026-2027 (01 Fall, 02 Spring, 03 Summer)

The output uses the same compact shape as data/courses.js ({courses, instructors,
places}, meeting start = hourly row from 08:40, -1 = no fixed time), so the
semester timetable page can read both the same way.
"""
import html
import json
import pathlib
import re
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

BASE = "https://suis.sabanciuniv.edu/prod/"
OUT_DIR = pathlib.Path(__file__).resolve().parent.parent / "data"
SEASONS = {"01": "Fall", "02": "Spring", "03": "Summer"}
DAYS = {"M": 0, "T": 1, "W": 2, "R": 3, "F": 4}
FIRST_SLOT = 8 * 60 + 40  # 08:40, the first hourly row
# Long building names on the schedule -> the short ones students use.
BUILDINGS = [
    (re.compile(r"Fac\.\s*of\s*Engin\.\s*and\s*Nat\.\s*Sci\.", re.I), "FENS"),
    (re.compile(r"Fac\.\s*of\s*Arts\s*and\s*Social\s*Sci\.", re.I), "FASS"),
    (re.compile(r"Sabancı\s+Business\s+School", re.I), "SBS"),
    (re.compile(r"Faculty\s+of\s+Management", re.I), "FMAN"),
]

SECTION_RE = re.compile(r'<th CLASS="ddlabel"[^>]*>\s*<a href="[^"]*crn_in=(\d+)"[^>]*>(.*?)</a>', re.I | re.S)
# A meeting row: seven cells, none of which may run into the next cell.
ROW_RE = re.compile(r"<tr>\s*" + r"\s*".join([r'<td CLASS="dddefault">((?:(?!</?td).)*?)</td>'] * 7), re.I | re.S)
MEETINGS_RE = re.compile(r"Scheduled Meeting Times</caption>(.*?)</table>", re.I | re.S)
CODE_RE = re.compile(r"^([A-Z]+) (\d+)([A-Z]*)$")


def post(path, pairs):
    data = urllib.parse.urlencode(pairs).encode()
    for attempt in range(3):
        try:
            req = urllib.request.Request(BASE + path, data=data, headers={"User-Agent": "su-planner/1.0"})
            with urllib.request.urlopen(req, timeout=60) as resp:
                body = resp.read().decode("utf-8", "replace")
            time.sleep(0.3)  # be gentle with the university server
            return body
        except OSError:
            if attempt == 2:
                raise
            time.sleep(2 * (attempt + 1))
    return ""


def subjects(term):
    page = post("bwckgens.p_proc_term_date", [("p_calling_proc", "bwckschd.p_disp_dyn_sched"), ("p_term", term)])
    block = re.search(r'<select[^>]*name="sel_subj"[^>]*>(.*?)</select>', page, re.I | re.S)
    return re.findall(r'<option value="([^"]+)"', block.group(1), re.I) if block else []


def search(term, subj):
    # Banner wants a "dummy" value first for every multi-select field.
    pairs = [("term_in", term)] + [(f, "dummy") for f in (
        "sel_subj", "sel_day", "sel_schd", "sel_insm", "sel_camp", "sel_levl", "sel_sess", "sel_instr", "sel_ptrm", "sel_attr")]
    pairs += [("sel_subj", subj), ("sel_crse", ""), ("sel_title", ""), ("sel_schd", "%"), ("sel_insm", "%"),
              ("sel_from_cred", ""), ("sel_to_cred", ""), ("sel_camp", "%"), ("sel_levl", "%"), ("sel_ptrm", "%"),
              ("sel_instr", "%"), ("sel_attr", "%"), ("begin_hh", "0"), ("begin_mi", "0"), ("begin_ap", "a"),
              ("end_hh", "0"), ("end_mi", "0"), ("end_ap", "a")]
    return post("bwckschd.p_get_crse_unsec", pairs)


def text(cell):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", cell))).strip()


def minutes(clock):
    m = re.match(r"(\d+):(\d+)\s*([ap])m", clock.strip(), re.I)
    hour, minute, ap = int(m.group(1)), int(m.group(2)), m.group(3).lower()
    if ap == "p" and hour != 12:
        hour += 12
    if ap == "a" and hour == 12:
        hour = 0
    return hour * 60 + minute


def place_name(where):
    for pattern, short in BUILDINGS:
        where = pattern.sub(short, where)
    return where


def parse(page):
    """[(code, type, name, crn, group, instructor, [(day, start, duration, place)])] for one result page."""
    found = []
    heads = list(SECTION_RE.finditer(page))
    for k, head in enumerate(heads):
        block = page[head.end(): heads[k + 1].start() if k + 1 < len(heads) else len(page)]
        parts = text(head.group(2)).rsplit(" - ", 3)
        if len(parts) != 4:
            continue
        name, crn, code, group = parts
        m = CODE_RE.match(code)
        if not m:
            continue
        meetings = []
        instructor = ""
        table = MEETINGS_RE.search(block)
        for kind, clock, days, where, _dates, _stype, teachers in ROW_RE.findall(table.group(1) if table else ""):
            if text(kind).lower() != "class":
                continue
            instructor = instructor or text(teachers)
            place = place_name(text(where))
            clock = text(clock)
            day_letters = [d for d in text(days) if d in DAYS]
            if "-" not in clock or not day_letters:
                meetings.append((5, -1, -1, place))  # no fixed time
                continue
            start_s, end_s = (minutes(x) for x in clock.split("-"))
            start = round((start_s - FIRST_SLOT) / 60)
            duration = max(1, round((end_s + 10 - start_s) / 60))
            meetings += [(DAYS[d], start, duration, place) for d in day_letters]
        found.append((f"{m.group(1)} {m.group(2)}", m.group(3), name, crn, group, instructor or "TBA", meetings))
    return found


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    term = sys.argv[1]
    subs = subjects(term)
    if not subs:
        sys.exit(f"No subjects listed for {term}; is the term published?")
    with ThreadPoolExecutor(max_workers=4) as workers:
        pages = list(workers.map(lambda s: search(term, s), subs))

    courses, instructors, places = {}, [], []
    index = lambda lst, v: lst.index(v) if v in lst else (lst.append(v) or len(lst) - 1)
    for page in pages:
        for code, ctype, name, crn, group, teacher, meetings in parse(page):
            course = courses.setdefault(code, {"name": name, "code": code, "classes": {}})
            if not ctype:
                course["name"] = name  # the lecture's title names the course
            course["classes"].setdefault(ctype, []).append({
                "crn": crn,
                "schedule": [{"day": d, "place": index(places, p), "start": s, "duration": du} for d, s, du, p in meetings],
                "group": group,
                "instructors": index(instructors, teacher),
            })

    out_courses = []
    for code in sorted(courses, key=lambda c: (c.split()[0], int(c.split()[1]))):
        c = courses[code]
        classes = [{"type": t, "sections": c["classes"][t]} for t in sorted(c["classes"], key=lambda t: (t != "", t))]
        out_courses.append({"name": c["name"], "code": code, "classes": classes})

    year = int(term[:4])
    data = {"term": term, "termName": f"{SEASONS.get(term[4:], 'Term')} {year}-{year + 1}",
            "courses": out_courses, "instructors": instructors, "places": places}
    out = OUT_DIR / f"schedule-{term}.js"
    body = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    out.write_text(f'window.SU_SCHEDULES = window.SU_SCHEDULES || {{}};\nwindow.SU_SCHEDULES["{term}"] = {body};\n', encoding="utf-8")
    sections = sum(len(cl["sections"]) for c in out_courses for cl in c["classes"])
    print(f"Wrote {len(out_courses)} courses, {sections} sections ({data['termName']}) to {out}")


if __name__ == "__main__":
    main()
