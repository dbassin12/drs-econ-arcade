# DRS Econ Arcade

A hub of browser games for AP Macroeconomics, built by David Bassin for his AP Macro students,
playing on phones, Chromebooks, and home laptops. Every game trains a skill the exam actually
grades — graph manipulation, cause→effect chains, calculations, and policy judgment — and every
scored interaction is tagged with its CED topic, so the hub can grow a "My AP Readiness" heat map
that turns play into a diagnostic. Plain HTML/CSS/JS: no frameworks, no build step, no accounts, no backend. Scores live in
`localStorage` on the student's own device.

## File tree

```
.
├── index.html                    # hub: marquee, initials, game cards, AP readiness panel
├── games/
│   ├── shift-happens.html        # graph surgery under time pressure: seven levels, five markets
│   ├── fed-chair.html            # you are the Fed chair in 1975, 1980, 2008 or 2021
│   ├── fed-chair.model.js        # the Fed macro model, its politics and its eras (pure logic)
│   ├── fed-chair.model.test.js
│   ├── sort-circuit.html         # swipe-sort decks: GDP or not, M1 or not, policy, the balance of payments
│   ├── sort-circuit.test.js
│   ├── calc-blitz.html           # dial-in arithmetic ladders: measurements, multipliers, money & banks
│   ├── calc-blitz.test.js
│   ├── graph-doctor.html         # planted errors on the engine's own graphs, healed with a probe
│   ├── graph-doctor.test.js
│   ├── investor.html             # ten coins, five buckets, twelve quarters, a Fed to read
│   ├── investor.model.js         # the five assets' return rules (pure logic)
│   ├── investor.model.test.js
│   ├── investor.test.js
│   ├── crisis-country.html       # finance minister: one policy card a turn on a small open economy
│   ├── crisis.model.js           # the economy, the cards and the score (pure logic)
│   ├── crisis.model.test.js
│   └── crisis-country.test.js
├── shared/
│   ├── arcade.css                # tokens + the whole UI kit (this is the only stylesheet)
│   ├── arcade.js                 # sound, storage, juice, initials, track()/readiness()
│   ├── arcade.test.js
│   ├── graph.js                  # the SVG graph engine — markets are data
│   └── graph.test.js
├── .gitignore
├── vercel.json                   # security headers for the static deploy — no build settings
├── CLAUDE.md                     # the build contract
├── GAME_PLAN.md                  # the full spec
└── README.md
```

## The games

Every game keeps its content as data at the top of its file (round cards, decks, rung generators,
lesions, scenarios, crises — each item tagged with its CED topic and carrying a WHY line written as
the FRQ rubric sentence), calls `Arcade.track()` on every answer, and ends in an exam-voice Exam
Sprint that is the only multiple choice anywhere and gates the gold medal. Drag is the only input
during play; every game also has a keyboard route.

| Game | You are | Mechanic | Topics |
|------|---------|----------|--------|
| Shift Happens | a graph surgeon | drag the curve the headline moves | Units 3–6 on the AD–AS, money, loanable funds, FOREX and Phillips boards |
| Fed Chair | the Fed chair | set the rate, live with the lag and with Washington | 4.6, 5.1 in four crises |
| Sort Circuit | a speed-sorter | drag a card into a bin | 2.1, 4.3, 3.8/4.6, 6.1 |
| Calc Blitz | a human calculator | dial a knob to the answer | 2.3/2.4/2.6, 3.2/3.8, 4.2/4.4 |
| Graph Doctor | the doctor on call | drop a stethoscope on the planted error | graph labeling across the five markets |
| The Investor | an investor | drag coins between buckets before the Fed speaks | 4.1, 4.2, 4.6 |
| Crisis Country | a finance minister | drag a policy card onto the desk | the policy toolkit, Units 3–6 |

## Run it locally

From the repo root:

```sh
python3 -m http.server 5590
```

Then open <http://localhost:5590/>. Use 5591 if 5590 is busy; never port 3000. Open the file over
`http://`, not `file://` — the shared scripts and stylesheet are loaded by relative path.

Tests (Node's built-in runner, no dependencies):

```sh
node --test shared/*.test.js games/*.test.js
```

## Student URL

**Live now (GitHub Pages):** <https://dbassin12.github.io/drs-econ-arcade/> — every push to `main`
republishes in about a minute.

**Vercel (planned primary host):** import this repo at <https://vercel.com/new> (team
`dbassin12s-projects`, framework preset **Other**, no build command), or run `npx vercel login` and then
`npx vercel --prod` from the repo root. Once it is live, the `*.vercel.app` URL goes here. Either URL
gets pinned in Schoology → Materials plus a QR poster for the board; both work on phones over cellular
if school Wi-Fi blocks one of them.
