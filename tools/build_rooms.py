"""Write data/rooms.js: every room in FASS, FENS, SBS and UC with its type, seats and equipment.

Usage:
    python tools/build_rooms.py

Reads SU's public room search (suis.sabanciuniv.edu/HbbmInst/SABANCI_ROOMS.main_request):
  - POST sabanci_rooms.p_response with buildings=FASS,FENS,FMAN,UC lists the rooms
    (SBS is "FMAN" there),
  - GET sabanci_rooms.R_ATTRIBUTE?b_code=..&r_code=.. lists one room's equipment.
When a room is busy comes from the class times in data/courses.js and data/schedule-*.js,
so this file only holds what the rooms are.
"""
import datetime
import html
import json
import pathlib
import re
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = pathlib.Path(__file__).resolve().parent.parent
BASE = "https://suis.sabanciuniv.edu/HbbmInst/"
BUILDINGS = {"FASS": "FASS", "FENS": "FENS", "FMAN": "SBS", "UC": "UC"}  # site code -> our code
NAMES = {
    "FASS": "Faculty of Arts and Social Sciences",
    "FENS": "Faculty of Engineering and Natural Sciences",
    "SBS": "Sabancı Business School",
    "UC": "University Center",
}


def get(url, data=None):
    req = urllib.request.Request(url, data=urllib.parse.urlencode(data).encode() if data else None,
                                 headers={"User-Agent": "su-planner room list"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8", "replace")


def text(cell):
    return " ".join(html.unescape(re.sub(r"<[^>]+>", " ", cell)).replace("\xa0", " ").split())


def room_list():
    today = datetime.date.today().strftime("%d/%m/%y")
    page = get(BASE + "sabanci_rooms.p_response",
               {"s_date": today, "e_date": today, "buildings": ",".join(BUILDINGS)})
    rooms = []
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", page, re.S | re.I):
        link = re.search(r"R_ATTRIBUTE\?b_code=([^&\"']+)&(?:amp;)?r_code=([^\"'&]+)[\"']", row, re.I)
        if not link:
            continue
        cells = [text(c) for c in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S | re.I)]
        # cells: building code, building name, room code, room name, category, capacity, ...
        b, code = urllib.parse.unquote(link.group(1)), urllib.parse.unquote(link.group(2))
        rooms.append({"b": BUILDINGS.get(b, b), "site": b, "code": code, "name": cells[3],
                      "type": cells[4], "seats": int(cells[5] or 0)})
    return rooms


def attributes(room):
    page = get(BASE + f"sabanci_rooms.R_ATTRIBUTE?b_code={room['site']}&r_code={urllib.parse.quote(room['code'])}")
    page = re.sub(r"<(script|style)[\s\S]*?</\1>", "", page, flags=re.I)
    words = [w.strip() for w in html.unescape(re.sub(r"<[^>]+>", "\n", page)).replace("\xa0", " ").split("\n")]
    words = [w for w in words if w]
    if "Attribute List" not in words:
        return []
    return [w for w in words[words.index("Attribute List") + 1:] if w != "No attribute found."]


def main():
    rooms = room_list()
    with ThreadPoolExecutor(4) as pool:
        for room, attrs in zip(rooms, pool.map(attributes, rooms)):
            room["attrs"] = attrs
    names = sorted({a for r in rooms for a in r["attrs"]})
    out = {
        "fetched": datetime.date.today().isoformat(),
        "buildings": NAMES,
        "attributes": names,
        # [building, room code, name, type, seats, [attribute indexes]]
        "rooms": [[r["b"], r["code"], r["name"], r["type"], r["seats"], [names.index(a) for a in r["attrs"]]]
                  for r in sorted(rooms, key=lambda r: (r["b"], r["code"]))],
    }
    path = ROOT / "data" / "rooms.js"
    path.write_text("window.ROOM_DATA = " + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";\n",
                    encoding="utf-8")
    print(f"{path}: {len(rooms)} rooms, {len(names)} attributes")


if __name__ == "__main__":
    main()
