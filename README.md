# SU Planner

Course planning for Sabancı University students: a weekly timetable (modelled on how
[SUchedule](https://aburakayaz.github.io/suchedule/) works, written from scratch), an
8-semester degree plan, and a prerequisite flowchart.
Plain HTML, CSS and JavaScript: no build step, no libraries.

## Open it

Double-click `index.html`. It works straight from disk because the data files are
`.js` files, not fetched JSON. The pages are linked in the top bar.

Or serve it locally, which always shows the latest version of every file (plain
`python -m http.server` lets Chrome keep showing old copies of pages):

```
python tools/serve.py
```

then open http://localhost:8765/.

## The pages

All three share the program and "year you started" pickers (saved in the browser), and a
**Double major & minors** box under them: one double major (any of the 14, except your own major)
and any number of the 17 minors. Their requirements come from SU's double major / minor pages for
your entry year (or the newest year they have, if they didn't exist yet).

- Weekly schedule: courses that also count for your double major or a minor get a small tag
  ("Economics DM", "Finance minor").
- 4-year plan: a progress section per double major / minor with its own groups, its total, its
  required courses not yet planned, and a link to its page on SU's site. SU's double major rule
  ([sabanciuniv.edu/en/double-majors-details](https://sabanciuniv.edu/en/double-majors-details)): the
  whole major, every course the double major requires, **at least 30 SU and 60 ECTS on top of the
  major**, and a 3.20 GPA overall and in each program; courses in both programs count for both. So a
  double major tracks its required, core and area groups, its university-course minimum (44 SU in
  FASS/SBS programs, 41 in FENS), any Engineering / Basic Science ECTS minimum your major doesn't
  already have, and the totals (major + 30 SU, major + 60 ECTS). A minor
  ([minor-programs-details](https://sabanciuniv.edu/en/minor-programs-details)) needs its groups and a
  2.72 GPA; some minors add rules (one course from each topic list…) that the planner doesn't check. Courses and the course list show the same tags. Adding or removing one
  offers to rebuild the suggested plan with it: its required courses join the prerequisite order, its
  electives become placeholders (a minor's replace your major's free electives, since they count there
  too), and a double major is topped up to its +30. Expect overloaded semesters with a double major;
  they're marked. The suggestion doesn't assume a course counts twice, so it can land above the
  minimum; picking courses tagged for two programs brings it down. "choose a course" on a double
  major / minor placeholder lists only that group's courses.
- Prerequisites: a **Chart** picker draws your major, your double major or any of your minors.

### Weekly schedule (`index.html`)

- Pick your undergraduate program and the year you started. The course list then follows that
  program's official degree requirements for that year: required courses, core electives, area
  electives, university courses, faculty courses, free electives, then everything else and graduate
  courses (5xx and up). Each heading shows the minimum credits. A course sits under the first
  category that counts it.
- Search courses by code or name, or switch to searching by instructor
  (spaces, case and Turkish accents are ignored: `gul` finds `Gül`).
- Day buttons hide sections that meet on days you switched off.
- Open a course and tick one section from each group (lecture, recitation, lab…).
  Half-picked courses show as dashed placeholders; a complete course lands on the grid in its own colour.
- Hovering a section previews it: green = free, red = clash. Section cards also say what they clash with.
- Click a block on the grid to edit that course; × removes a section and opens the course so you can pick another.
- Clashing hours are tinted red and counted in the bar under the grid. Sections with no fixed time are listed there too.
- **Copy CRNs** copies lines like `CS201 - A: 10190`. **Clear** empties the schedule.
- Keys: `/` jumps to search, `Esc` leaves the single-course view or clears the search.

### 4-year plan (`plan.html`)

- Eight semesters (Fall and Spring of years 1–4), named from the year you started; the current term is marked.
- Three **summers** (after years 1–3) below them, for summer internships: every x95 internship
  (CS 395, IE 395…) and courses SU names "Summer Internship" (MGMT 300, PROJ 303). The suggested
  plan puts x95 internships in the summer after Year 3 and other summer internships in the
  earliest summer after their prerequisites; one left in a Fall/Spring semester is flagged.
  Summers have no 15–20 credit rule and no timetable. PROJ courses are taken during the regular
  semesters. SU's older curricula list a "PROJ 302"; that isn't a separate class, it is PROJ 201,
  so the data uses PROJ 201 and saved plans with PROJ 302 are converted when they load.
- **Suggested plan**: picking a program fills the plan automatically when it's empty (and on a first
  visit); if it already has courses it asks first. The **Suggest plan** button does the same any time.
  Year 1 gets the freshman university courses (codes ending in 1 in Fall, 2 in Spring). Years 2–4 get
  every required course in prerequisite order (by course level, at most ~12 required credits a
  semester, only courses offered now in the current term), enough of each choose-from list
  (e.g. Economics' Mathematics Requirement), PROJ 201 and SPS 303, and placeholders for HUM courses
  and core / area / free electives up to each minimum and the program total. Semesters are evened
  out to 15–20 SU credits.
- A placeholder's **choose a course** jumps to its group in the list; adding a course from that group
  to the semester replaces the placeholder.
- Each semester shows **Under 15** below 15 SU credits and **Overload** above 20. You can still plan
  either; it's just flagged.
- Add courses with **+** in the list (they go to the highlighted semester; click a semester to choose it),
  or drag them in. Drag between semesters to move, or back onto the list to remove.
- Progress meters for every requirement group, against its minimum. Each course is counted once,
  in the first group that still needs credits (extra core electives spill into area, then free).
- Also counted on top: Faculty Courses, and for engineering programs the **Engineering** and
  **Basic Science** ECTS minimums (each course's split comes from SU's course catalog).
- Required courses not yet in the plan are listed as buttons to add them.
- Prerequisite order is checked: a course placed in the same semester as, or before, one of its
  prerequisites gets a red warning on its card ("Needs CS 300 first (same semester)"), the progress
  panel lists such courses (click to jump to them), and adding or moving a course says when it breaks
  the order. Prerequisites missing from the plan get a grey note instead.
- In the current term's semester, courses that aren't offered this term are flagged.
- **Print** prints just the plan; **Clear plan** empties it.

### Semester times (`timetable.html`)

- Every semester of your 4-year plan on a weekly timetable (Mon–Fri, 08:40–20:40).
- Fall semesters use this Fall's times (`data/courses.js`); Spring semesters use the newest Spring
  schedule SU has published (`data/schedule-202602.js`, Spring 2026-2027). If no Spring schedule is
  loaded, Fall times stand in. Future years may differ a little.
- **Alternative timetables**: it finds every clash-free choice of sections (lecture, recitation,
  lab…) for the semester and says how many there are ("80 different timetables work"). **‹ ›** (or
  the arrow keys) flip through them; **Keep this one** saves the shown one as your picks. Sections
  that meet at the same hours count as one timetable ("A1/A2"). Large semesters list the first
  2,000 ("2,000+"). The math model and the search are explained in
  [`docs/schedule-model.md`](docs/schedule-model.md).
- You can fix a section yourself in the side panel; the list then only holds timetables with it.
  "Auto" (or **Clear my picks**) frees it again.
- If no section choice avoids an overlap, it says which courses clash and when, so you can move one
  to another semester. If only your hand-picked sections clash, it says so.
- Flags courses that aren't on that season's schedule (e.g. Fall-only courses planned in Spring),
  courses with no fixed time yet, and elective placeholders. **Copy CRNs** copies the semester's sections.
- PROJ courses (PROJ 201…) run during the semester with meeting times arranged after
  registration, so they're listed in the side panel ("times arranged after you register") but not
  placed on the timetable or checked for clashes. A summer internship left in a Fall/Spring
  semester gets one small line there too ("summer course: belongs in a summer").
- The 4-year plan shows a **Time clash** badge on any semester with an unavoidable overlap (or a
  **Times** link), warns about courses planned in a season they don't run, and the suggested plan
  avoids both.

### How to use (`help.html`)

- Short steps for every page with real screenshots (`img/help/*.webp`) whose numbered markers match
  the steps. Semester times explains flipping through every clash-free timetable. The Semester times
  page links to it ("How it works"), and so does the weekly page's About dialog.
- The screenshots show an Industrial Engineering student who started in Fall 2026, with the
  suggested plan. Retake them after visible UI changes (they come from a headless Chrome script that
  stages that plan and adds the markers).

### Prerequisites (`prereq.html`)

- A flowchart of the program's required, core and area courses: arrows go from a course to the
  courses it opens. Columns are steps; dashed arrows mean "one of several options".
- Prerequisites from other groups (university courses, MATH 101…) are shown as grey dashed boxes; switch them off in the side panel.
- Click a course to highlight everything it needs and everything it opens, and see the details
  (needs, opens, how many later courses depend on it). The search box finds a course in the chart.
- Courses with no links to the others are listed under the chart.

## Update the course data

`data/courses.js` holds Fall 2026-2027 (term `202601`). To load a new term,
point the script at a JSON file or URL shaped like `{courses, instructors, places}`:

```
python tools/build_data.py path/or/url/to/data.json 202602
```

Term codes: `YYYY01` Fall, `YYYY02` Spring, `YYYY03` Summer.

## Update the Spring class schedule

`data/schedule-<TERM>.js` comes from SU's public class search (`bwckschd.p_disp_dyn_sched`).
When a newer Spring term is published, download it and point the pages at it
(the `<script src="data/schedule-….js">` lines in `timetable.html` and `plan.html`):

```
python tools/build_schedule.py 202702
```

## Update the degree requirements

`data/requirements.js` is read from SU's public degree pages
(`suis.sabanciuniv.edu/prod/SU_DEGREE.p_list_degree`; `P_PRG_TYPE=DM` lists double majors,
`P_PRG_TYPE=MINOR` minors) and course catalog pages.
A curriculum depends on the term a student was first admitted, so the file holds
one per Fall entry year. To re-read everything (newest Fall term, then how many years back;
takes about ten minutes):

```
python tools/build_requirements.py 202601 7
```

It maps codes that are really another course (`ALIASES`: PROJ 302 → PROJ 201) and keeps only
facts: requirement categories and minimum credits, course lists (identical
lists stored once), and for each course its name, SU and ECTS credits, Engineering and
Basic Science ECTS, and prerequisites. Spring and Summer admits aren't read.

Prerequisites come from SU's registration system (Banner), which is what registration checks:
the course's current class section first, then its Banner catalog entry. SU's public course
pages can be out of date (one said IE 304 needs IE 312; registration requires IE 311), so they are
used only for courses Banner no longer lists. Old codes that no longer exist (MS 301 → IE 311)
are dropped. To re-read only the prerequisites (a few minutes):

```
python tools/build_requirements.py --prereqs-only
```

## Files

- `index.html`, `plan.html`, `timetable.html`, `prereq.html`: the four tools
- `help.html`, `css/help.css`, `img/help/`: the How to use page and its screenshots
- `js/times.js`: Fall/Spring class times, the search for every clash-free timetable, and the
  least-overlap solver that explains clashes (used by the plan and times pages)
- `docs/schedule-model.md`: the scheduling model (sets, variables, constraints) and the web algorithm
- `data/schedule-202602.js`: Spring 2026-2027 sections (rebuild with `tools/build_schedule.py`)
- `css/style.css`: shared styling (top bar, sidebar, dialogs) and the weekly page
- `css/plan.css`, `css/prereq.css`: the plan and flowchart pages
- `js/shared.js`: requirement helpers and the program/year pickers, used by all pages
- `js/app.js`, `js/plan.js`, `js/prereq.js`: one script per page
- `js/programs.js`: the program picker's list, with each program's SU code
- `data/courses.js`: this term's sections (rebuild with `tools/build_data.py`)
- `data/requirements.js`: requirements and course catalog (rebuild with `tools/build_requirements.py`)
