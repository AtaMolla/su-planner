# Semester times: the scheduling model

The **Semester times** page lists every clash-free weekly timetable for a semester of the
student's plan. This file gives the mathematical model behind it and the algorithm the website
uses to solve it in the browser, without a commercial solver.

## 1. The problem

For one semester, the student takes every course planned for it. Each course has one or more
**components** (lecture, recitation, lab, discussion), and each component is offered in several
**sections** that meet at fixed weekly hours. Pick one section of every component so that no two
picked sections meet in the same hour.

There is **no objective function**: any choice that meets these rules is an acceptable timetable,
and the page shows all of them.

Left out of the model: elective placeholders (no course chosen yet), PROJ courses (times are
arranged after registration), summer internships (not taken in Fall or Spring), and courses
missing from that season's schedule. The page lists those separately.

## 2. Mathematical model

**Sets**

| Symbol | Meaning |
|---|---|
| $C$ | courses planned for the semester that have class times |
| $K$ | components of those courses; $K_c \subseteq K$ are the components of course $c$ |
| $S_k$ | sections offered for component $k$; $S = \bigcup_{k \in K} S_k$ |
| $T$ | weekly hour slots: 5 days × 13 hours (08:40 … 20:40) = 65 slots |
| $F \subseteq S$ | sections the student fixed in the side panel |

**Parameter**

$$a_{st} = \begin{cases} 1 & \text{if section } s \text{ meets during slot } t \\ 0 & \text{otherwise} \end{cases}$$

**Decision variable**

$$x_s = \begin{cases} 1 & \text{if section } s \text{ is taken} \\ 0 & \text{otherwise} \end{cases} \qquad s \in S$$

**Constraints**

$$\sum_{s \in S_k} x_s = 1 \qquad \forall k \in K \tag{1}$$

$$\sum_{s \in S} a_{st}\, x_s \le 1 \qquad \forall t \in T \tag{2}$$

$$x_s = 1 \qquad \forall s \in F \tag{3}$$

$$x_s \in \{0, 1\} \qquad \forall s \in S \tag{4}$$

- (1) take exactly one section of every component;
- (2) no two taken sections share an hour. This also stops a course's own lecture and recitation
  from overlapping;
- (3) keep the sections the student fixed;
- (4) binary variables.

**Objective**: none. It is a feasibility problem (equivalently, minimize $0$). The output is the
set of all feasible solutions,

$$X = \{\, x \in \{0,1\}^{|S|} : (1)\text{–}(3) \,\}$$

which a MIP solver would call the *solution pool*.

**Same timetable, different sections.** Two sections of one component with the same row
$a_{s\cdot}$ (they meet at exactly the same hours, e.g. DSA 201 recitations A1 and A2) give the
same weekly timetable. They are merged into one *time option*, so the page counts distinct
timetables and labels the merged sections "A1/A2". The number of clash-free *section combinations*
is shown too.

**When no timetable exists** ($X = \emptyset$), the page still has to say *what* clashes. It then
solves a relaxation: drop (2), and pick sections that minimize the number of overlapping class
pairs, $\sum_{t \in T} \binom{L_t}{2}$ with $L_t = \sum_{s} a_{st} x_s$. The courses that still
share hours are named, with the days and times. This part is the original branch-and-bound search
(`solve` in `js/times.js`).

## 3. The same model in Gurobi (for reference)

The website does not use this code. It shows how the model maps to a MIP solver.
`S_k[k]` lists the sections of component `k`, `slots[s]` the hour slots of section `s`, and `F` the
fixed sections.

```python
import gurobipy as gp
from gurobipy import GRB

m = gp.Model("semester_timetable")
x = m.addVars(S, vtype=GRB.BINARY, name="x")                                     # (4)
m.addConstrs((gp.quicksum(x[s] for s in S_k[k]) == 1 for k in K), name="one")    # (1)
m.addConstrs((gp.quicksum(x[s] for s in S if t in slots[s]) <= 1 for t in T),
             name="no_overlap")                                                  # (2)
for s in F:
    x[s].LB = 1                                                                  # (3)
# No setObjective call: every objective coefficient stays 0, so this is feasibility only.

m.Params.PoolSearchMode = 2            # look for all solutions, not just one
m.Params.PoolSolutions = 2000
m.optimize()
for i in range(m.SolCount):
    m.Params.SolutionNumber = i
    timetable = [s for s in S if x[s].Xn > 0.5]
```

Gurobi needs a license. The model is small, though (tens of binary variables, 65 slot
constraints), so the website solves it exactly with its own search, below.

## 4. The web algorithm

`alternatives()` in `js/times.js` enumerates $X$ exactly with a depth-first search
(backtracking, also called implicit enumeration).

1. **Variables and domains.** One variable per component $k$. Its domain is the component's
   time options (sections merged by identical hours, see above). A fixed section (3) shrinks the
   domain to that one section.
2. **Encoding.** Each option's hours are a 65-bit mask (three 32-bit integers). The hours already
   taken by the partial timetable are one more mask, so the overlap test for constraint (2) is a
   bitwise AND.
3. **Search.** Starting from an empty timetable, repeat:
   - *Forward checking:* for every component not yet assigned, keep only the options that don't
     overlap the taken hours. If any component has none left, this branch can't be completed:
     go back (backtrack).
   - *Fail first:* branch on the component with the fewest options left (the
     minimum-remaining-values rule). Tight components are decided early, which cuts dead ends
     sooner.
   - Try each of its remaining options in turn: add its hours to the mask, recurse, then remove
     them.
   - When every component has an option, record the timetable.
4. **Limits.** It stops after 2,000 timetables (or 400,000 search steps) and then shows "2,000+".
   Fixing a section in the side panel adds constraint (3) and narrows the list.
5. **Results kept.** Results are cached per semester content, so flipping through timetables
   doesn't search again.

**Why the list is complete and correct.** An option is placed only if it overlaps nothing already
placed, so every recorded timetable satisfies (2). It holds exactly one option per component (1)
and only the fixed section where there is one (3). An option is discarded only when it overlaps the
partial timetable, and every completion of that partial timetable contains the same hours, so no
feasible timetable is skipped. Below the 2,000 limit the list is exactly $X$.

**Tested** against brute force: 1,100 random sets of 2 to 6 courses from the Fall and Spring
schedules (404 of them with a fixed section) were also solved by trying every section combination.
The number of timetables and of clash-free section combinations matched in every case.

**Speed.** The worst case is exponential (the product of the domain sizes), but real semesters
are small. A first-year Fall semester (7 courses, about 47 billion section combinations) gives its
first 2,000 timetables in about 4 ms. The example below is solved completely in 106 search steps.
The 4-year plan page only needs to know whether a timetable exists, so it stops at the first one.

## 5. Worked example

Industrial Engineering, Year 2 Spring: MATH 306, IE 311, DSA 201 and IE 303, with the Spring
2026-2027 class times.

| Component | Sections | Time options |
|---|---:|---:|
| MATH 306 lecture | 3 | 3 |
| MATH 306 recitation | 10 | 10 |
| IE 311 lecture | 2 | 2 |
| IE 311 recitation | 2 | 2 |
| DSA 201 lecture | 1 | 1 |
| DSA 201 recitation (A1=A2, B1=B2, C1=C2) | 6 | 3 |
| IE 303 lecture | 1 | 1 |
| **Total** | **25 variables** | |

- Section combinations: 3 × 10 × 2 × 2 × 1 × 6 × 1 = **720**
- Combinations that meet constraint (2): **160**
- Distinct weekly timetables (merging equal-hour sections): **80**, the "Timetable 1 of 80" on the page
- Search steps: **106**, compared with 720 combinations for brute force
