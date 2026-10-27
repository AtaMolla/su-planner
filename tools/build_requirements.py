"""Build data/requirements.js from Sabancı's public degree-requirement pages.

Usage:
    python tools/build_requirements.py [NEWEST_TERM] [YEARS]

NEWEST_TERM  the latest Fall admit term to read, e.g. 202601 = Fall 2026-2027 (default 202601)
YEARS        how many Fall entry years to read, going back from NEWEST_TERM (default 7)

Each program's curriculum depends on the term the student was first admitted.
For every entry year it reads the 12 undergraduate degree programs, plus every
double major and minor program listed on SU's site: the requirement summary
(categories and minimum credits), the courses listed under each category, and
the separate elective-pool pages linked from it. Only course codes, category
names and credit numbers are kept. Identical course lists are stored once.
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
OUT = pathlib.Path(__file__).resolve().parent.parent / "data" / "requirements.js"
SEASONS = {"01": "Fall", "02": "Spring", "03": "Summer"}

# App program id -> SU program code (from the degree list page).
PROGRAMS = {
    "cs": "BSCS", "dsa": "BSDSA", "ee": "BSEE", "ie": "BSMS", "mat": "BSMAT",
    "me": "BSME", "bio": "BSBIO", "econ": "BAECON", "psir": "BAPSIR",
    "psy": "BAPSY", "vacd": "BAVACD", "mgmt": "BAMAN",
}
# ECTS minimums that overlap the other categories rather than being course pools:
# every course carries its own Engineering / Basic Science share of its ECTS.
OVERLAY_AREAS = {"ENG_SCIE": "eng", "BASIC_SCIE": "basic"}
SPLIT_RE = re.compile(r"ENGINEERING\s*:\s*([\d.,]+)\s*/\s*BASIC\s*:\s*([\d.,]+)", re.I)

COURSE_RE = re.compile(r"subj_code=([A-Z]+)&(?:amp;)?crse_numb=([0-9A-Z]+)")
ANCHOR_RE = re.compile(r'<a\s+name\s*=\s*"?([A-Za-z0-9_-]+)"?', re.I)  # e.g. BSCS-DM_R
# Program lists by type: "" = degree programs, "DM" = double majors, "MINOR" = minors.
LIST_RE = re.compile(r'href="SU_DEGREE\.p_select_term\?P_PROGRAM=([^&"]+)[^"]*"[^>]*>\s*([^<]+?)\s*<')
SUMMARY_RE = re.compile(
    r'<a href="#([^"]+)"[^>]*>([^<]+)</a>\s*</td>'
    r'\s*<td[^>]*>([^<]*)</td>\s*<td[^>]*>([^<]*)</td>\s*<td[^>]*>([^<]*)</td>')
POOL_RE = re.compile(r'href="(SU_DEGREE\.p_list_courses\?[^"]+)"')
# One course row: code link, name link, ECTS credits, SU credits.
ROW_RE = re.compile(
    r'subj_code=([A-Z]+)&(?:amp;)?crse_numb=([0-9A-Z]+)[^>]*>[^<]*</a>\s*</td>\s*'
    r'<td[^>]*>\s*<a[^>]*>([^<]*)</a>\s*</td>\s*'
    r'<td[^>]*>\s*([^<]*?)\s*</td>\s*<td[^>]*>\s*([^<]*?)\s*</td>')
TOTAL_RE = re.compile(
    r'<b>\s*Total\s*</b>\s*</td>\s*<td[^>]*>\s*<b>([^<]*)</b>\s*</td>\s*<td[^>]*>\s*<b>([^<]*)</b>')

# Codes on SU's pages that are really another course: PROJ 302 isn't a separate class,
# it is PROJ 201.
ALIASES = {"PROJ 302": "PROJ 201"}

# Every course seen on any page: code -> [name, SU credits, ECTS credits].
CATALOG = {}


def fetch(path, form=None):
    data = urllib.parse.urlencode(form).encode() if form else None
    for attempt in range(3):
        try:
            req = urllib.request.Request(BASE + path, data=data, headers={"User-Agent": "su-planner/1.0"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                body = resp.read().decode("utf-8", "replace")
            time.sleep(0.3)  # be gentle with the university server
            return body
        except OSError:
            if attempt == 2:
                raise
            time.sleep(2 * (attempt + 1))
    return ""


def list_programs(kind):
    """[(SU code, name)] from a degree list page; kind is "DM" or "MINOR"."""
    page = fetch(f"SU_DEGREE.p_list_degree?P_LEVEL=UG&P_LANG=EN&P_PRG_TYPE={kind}")
    found = []
    for code, name in LIST_RE.findall(page):
        name = html.unescape(name).strip()
        name = re.sub(r"\s*\((?:Previous Name|Pre\. Name)[^)]*\)", "", name)  # drop "(Previous Name: …)"
        name = re.sub(r"\s+Minor$", "", name)
        if (code, name) not in found:
            found.append((code, name))
    return found


def number(cell):
    cell = cell.strip().replace(",", ".")
    try:
        value = float(cell)
    except ValueError:
        return None
    return int(value) if value.is_integer() else value


def codes_in(text):
    """Course codes listed in `text`, in order; their names and credits go into CATALOG."""
    for subj, numb, name, ects, su in ROW_RE.findall(text):
        if f"{subj} {numb}" not in ALIASES:
            CATALOG[f"{subj} {numb}"] = [html.unescape(name).strip(), number(su), number(ects)]
    return list(dict.fromkeys(ALIASES.get(f"{s} {n}", f"{s} {n}") for s, n in COURSE_RE.findall(text)))


def read_program(code, term):
    page = fetch("SU_DEGREE.p_degree_detail",
                 {"P_TERM": term, "P_PROGRAM": code, "P_LANG": "EN", "P_LEVEL": "UG", "P_SUBMIT": "Select"})
    anchors = [(m.group(1), m.start()) for m in ANCHOR_RE.finditer(page)]
    starts = {name: pos for name, pos in anchors}
    categories = []
    overlays = []
    for area, name, ects, su, count in SUMMARY_RE.findall(page):
        if area in OVERLAY_AREAS:
            overlays.append({"id": area, "name": html.unescape(name).strip(),
                             "field": OVERLAY_AREAS[area], "ects": number(ects)})
            continue
        if area not in starts:
            continue
        begin = starts[area]
        end = min([p for _, p in anchors if p > begin] + [len(page)])
        section = page[begin:end]
        courses = codes_in(section)
        for link in POOL_RE.findall(section):
            courses += [c for c in codes_in(fetch(html.unescape(link))) if c not in courses]
        categories.append({
            "id": area,
            "name": html.unescape(name).strip(),
            "su": number(su),
            "ects": number(ects),
            "minCourses": number(count),
            "courses": courses,
        })
    total = TOTAL_RE.search(page)
    totals = {"ects": number(total.group(1)), "su": number(total.group(2))} if total else {}
    return categories, totals, overlays  # categories is empty when the program had no curriculum that year


PREREQ_RE = re.compile(r"Prerequisite:(.*?)(?:Corequisite:|ECTS Credit:|General Requirements:)", re.S)
PREREQ_TOKEN_RE = re.compile(r"\(|\)|\band\b|\bor\b|\b[A-Z]{2,5} \d{2,5}[A-Z]?\b")


def parse_prereq(text):
    """'(MATH 201 ... or MATH 212 ...) and MATH 203 ...' -> [['MATH 201', 'MATH 212'], ['MATH 203']]:
    every inner list is needed, and any one course from it is enough."""
    tokens = PREREQ_TOKEN_RE.findall(html.unescape(re.sub(r"<[^>]+>", " ", text)))
    pos = 0

    def peek():
        return tokens[pos] if pos < len(tokens) else None

    def either():  # a or b
        nonlocal pos
        node = both()
        while peek() == "or":
            pos += 1
            node = ("or", node, both())
        return node

    def both():  # a and b
        nonlocal pos
        node = single()
        while peek() == "and":
            pos += 1
            node = ("and", node, single())
        return node

    def single():
        nonlocal pos
        tok = peek()
        if tok == "(":
            pos += 1
            node = either()
            if peek() == ")":
                pos += 1
            return node
        if tok is None or tok in (")", "and", "or"):
            raise ValueError("unexpected token")
        pos += 1
        return ("code", tok)

    def groups(node):  # rewrite as AND of OR-groups
        if node[0] == "code":
            return [frozenset([node[1]])]
        if node[0] == "and":
            return groups(node[1]) + groups(node[2])
        return [a | b for a in groups(node[1]) for b in groups(node[2])]

    tokens = [ALIASES.get(t, t) for t in tokens]
    if not tokens:
        return []
    try:
        result = groups(either())
    except (ValueError, IndexError, RecursionError):
        return []
    return sorted({tuple(sorted(g)) for g in result})[:20]


def course_details(code):
    """A course's Engineering ECTS, Basic Science ECTS and prerequisites, from its catalog page."""
    subj, numb = code.split(" ", 1)
    try:
        page = fetch(f"sabanci_www.p_get_courses?levl_code=UG&subj_code={subj}&crse_numb={numb}&lang=eng")
    except OSError:
        return None, None, []
    m = SPLIT_RE.search(page)
    eng, basic = (number(m.group(1)), number(m.group(2))) if m else (None, None)
    p = PREREQ_RE.search(page)
    # Some pages list the course as its own prerequisite; drop those groups.
    prereq = [list(g) for g in parse_prereq(p.group(1)) if code not in g] if p else []
    return eng, basic, prereq


def term_name(term):
    year = int(term[:4])
    return f"{SEASONS.get(term[4:], 'Term')} {year}-{year + 1}"


def main():
    newest = sys.argv[1] if len(sys.argv) > 1 else "202601"
    years = int(sys.argv[2]) if len(sys.argv) > 2 else 7
    terms = [f"{int(newest[:4]) - k}{newest[4:]}" for k in range(years)]

    double_majors = list_programs("DM")
    minors = list_programs("MINOR")
    print(f"Found {len(double_majors)} double majors and {len(minors)} minors")

    entry = lambda code, name=None: {"code": code, **({"name": name} if name else {}), "terms": {}, "totals": {}, "overlays": {}}
    out = {
        "terms": [], "pools": [], "catalog": CATALOG,
        "programs": {pid: entry(code) for pid, code in PROGRAMS.items()},
        "doubleMajors": {code: entry(code, name) for code, name in double_majors},
        "minors": {code: entry(code, name) for code, name in minors},
    }
    # Every (where to store it, SU code, term) to read, fetched a few at a time.
    jobs = []
    for term in terms:
        jobs += [(out["programs"][pid], code, term) for pid, code in PROGRAMS.items()]
        jobs += [(out["doubleMajors"][code], code, term) for code, _ in double_majors]
        jobs += [(out["minors"][code], code, term) for code, _ in minors]
    with ThreadPoolExecutor(max_workers=4) as workers:
        results = list(workers.map(lambda job: read_program(job[1], job[2]), jobs))

    pool_index = {}

    def pool_id(courses):
        key = "\n".join(courses)
        if key not in pool_index:
            pool_index[key] = len(out["pools"])
            out["pools"].append(courses)
        return pool_index[key]

    found = {term: 0 for term in terms}
    for (target, code, term), (cats, totals, overlays) in zip(jobs, results):
        if not cats:
            continue
        if code in PROGRAMS.values():
            found[term] += 1
        target["totals"][term] = totals
        if overlays:
            target["overlays"][term] = overlays
        target["terms"][term] = [
            {k: v for k, v in c.items() if k != "courses"} | {"pool": pool_id(c["courses"])} for c in cats
        ]
    for term in terms:
        if not found[term]:
            raise SystemExit(f"No requirements found for {term}; the page layout may have changed.")
        out["terms"].append({"term": term, "termName": term_name(term)})
        extra = sum(1 for group in ("doubleMajors", "minors") for p in out[group].values() if term in p["terms"])
        print(f"{term_name(term)}: {found[term]} programs, {extra} double majors and minors")

    # Catalog entries become [name, SU, ECTS, Engineering ECTS, Basic Science ECTS, prerequisites].
    codes = sorted(CATALOG)
    with ThreadPoolExecutor(max_workers=4) as workers:
        for code, details in zip(codes, workers.map(course_details, codes)):
            CATALOG[code] = CATALOG[code][:3] + list(details)
    missing = sum(1 for v in CATALOG.values() if v[3] is None)
    with_prereq = sum(1 for v in CATALOG.values() if v[5])
    out["catalog"] = dict(sorted(CATALOG.items()))
    print(f"Catalog: {len(CATALOG)} courses; {with_prereq} have prerequisites; "
          f"{missing} without an Engineering/Basic split")
    body = json.dumps(out, ensure_ascii=False, separators=(",", ":"))
    OUT.write_text(f"window.SU_REQUIREMENTS = {body};\n", encoding="utf-8")
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
