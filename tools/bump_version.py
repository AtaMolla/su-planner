"""Stamp every page's CSS, JS and data links with a new version, e.g. js/times.js?v=202610282310.

Run it before uploading changed CSS, JS or data files:
    python tools/bump_version.py

Browsers (and GitHub Pages, which allows 10 minutes of caching) may keep old copies of files.
A new version in the link makes them fetch the new file, so a page never runs with a mix of
new and old scripts.
"""
import datetime
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
ASSET = re.compile(r'((?:src|href)="(?:css|js|data)/[^"?]+\.(?:css|js))(?:\?v=\w+)?"')


def main():
    version = datetime.datetime.now().strftime("%Y%m%d%H%M")
    for page in sorted(ROOT.glob("*.html")):
        text = page.read_text(encoding="utf-8")
        new, count = ASSET.subn(rf'\1?v={version}"', text)
        if new != text:
            page.write_text(new, encoding="utf-8")
        print(f"{page.name}: {count} links")
    print(f"Version {version}")


if __name__ == "__main__":
    main()
