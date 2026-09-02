# DRS ECON ARCADE — Build Plan

**Owner:** David Bassin · **Builder:** David + Claude Code · **Host:** Vercel (team `dbassin12s-projects`, hobby/free)
**Players:** 18 AP Macro seniors, on phones, Chromebooks, and home laptops
**Mission:** games that train the AP skills quizzes can't — graph manipulation, cause→effect chains, calculations, and policy judgment — and that feel like games, not worksheets.

---

## 0. Decisions already made (don't relitigate)

- **HTML/CSS/JS in the browser. Not Java.** Browser Java has been dead since ~2015; it would require installs and dies on phones/Chromebooks. Plain web tech runs instantly on every device a student owns. No frameworks, no build step — every game is one self-contained HTML file. (If a game ever outgrows one file, split JS into a module — still no bundler.)
- **One hub, one URL.** `index.html` is the arcade menu; each game is its own page. Students bookmark once, QR once.
- **Vercel, free tier, via GitHub.** Push → auto-deploy. 18 students is a rounding error on the free tier (100GB/mo bandwidth).
- **Local high scores only (v1).** `localStorage`, arcade-style 3-letter initials. Class competition happens on the projector. A shared leaderboard is a later phase, not a blocker.
- **2D, not 3D.** The AP exam is 2D graphs — a 3D AD-AS curve actively hurts transfer, and 3D chugs on school Chromebooks. "Fun" comes from juice (sound, streaks, screen shake, particles, personality), which is how Duolingo/Kahoot feel fun in 2D. One tasteful exception: a CSS-3D spinning coin on the Fed Chair title screen. If you want true 3D someday, that's the "Econ City" stretch project (backlog) with Three.js from cdnjs — a separate game, not a retrofit.

## 1. The roster

| # | Game | You are… | Trains | Phase |
|---|---|---|---|---|
| 1 | **Shift Happens** | a graph surgeon under time pressure | Skill 4 graphing + cause→effect (Units 3–6) | P0 |
| 2 | **Fed Chair** | the Fed chair in 1975 / 1980 / 2008 / 2021 | monetary policy, lags, expectations (U4–5) | P1 |
| 3 | **The Investor** | an investor reacting to the Fed | bond↔rate inverse, real vs nominal, transmission (U4 + personal-finance weave) | P2 |
| 4 | **Crisis Country** | finance minister of a country in trouble | policy mix, FOREX, trade-offs (U5–6) | P3 |
| 5 | Sort Circuit | a speed-sorter | definitions/classification (all units) | P4 |
| 6 | Calc Blitz | a human calculator | the 16–20% of MCQs that are math | P4 |
| 7 | Graph Doctor | an FRQ grader | graph hygiene (finds hidden errors) | P4 |
| 8 | **Micro & Macro Blaster** (port) | — | your existing game, moved onto the hub so it stops depending on your Mac | P4 |

## 2. What "fun, not dry" means — the Juice Checklist

Every game must ship with ALL of these before it counts as done. This is the difference between a game and a worksheet with a timer:

1. **Sound** — synthesized with WebAudio (no audio files): correct = rising arpeggio, wrong = soft buzz, streak milestones = coin cascade, final 3 seconds = tick-tock, boss intro = brass stab. Mute toggle, persisted. AudioContext created only on first tap (browser rule).
2. **Streaks & multipliers** — visible combo meter, flame stages (x2 🔥 → x5 🔥🔥🔥), streak-break "crack" moment.
3. **Motion** — springy curve slides, screen shake on wrong, confetti particle burst (canvas) on level clear, animated gauge needles. Respect `prefers-reduced-motion`.
4. **Personality** — every scenario has a voice: BREAKING-news ticker headlines with jokes and Five Towns flavor ("Bagel prices spike across the Five Towns"), two bickering advisors (Dr. Hawk 🦅 vs Prof. Dove 🕊), the President phoning to pressure you (say no → hidden Integrity badge — the actual Burns/Nixon story).
5. **Stakes & progression** — hearts/lives, locked levels, bronze/silver/gold medals, an **AP-score stamp (1–5)** slammed on the end screen, unlockable titles ("Intern" → "Regional Fed President" → "MAESTRO").
6. **The learning beat** — every wrong answer shows a one-line WHY before play resumes ("Oil is an input cost → SRAS shifts left. That's cost-push."). This is non-negotiable; it's where the learning lives.
7. **Arcade-night mode** — a big-type projector view (scores + initials) so class sessions end with a podium.

## 2b. The AP-prep layer — every game trains for May 7, measurably

Fun is the delivery mechanism; the payload is the exam. Five requirements, enforced on every game (this is the **AP Prep Checklist**, equal in rank to the Juice Checklist):

1. **Everything is tagged.** Every scored interaction carries its CED topic (`"ced":"4.6"`) and skill category (1 Principles · 2 Interpretation · 3 Manipulation · 4 Graphing) — the round-card schema already has the field; no untagged content ships.
2. **The Skill Tracker.** `shared/arcade.js` exposes `track(ced, skill, correct)`; every game calls it on every answer. The hub grows a **"My AP Readiness"** panel: a 6-unit heat map (per-topic accuracy, green/yellow/red), weakest-topic callout, a *rough* projected score band (accuracy weighted by the real unit exam weights: U1 5–10% … U5 20–30%; label it "estimate"), and a **"play this next"** recommendation pointing at the level that drills the weakest topic. The arcade becomes a self-updating diagnostic, not just entertainment.
3. **Readiness codes → your gradebook.** One tap copies a compact summary string (initials + per-unit accuracy + items answered, base64). Students paste it into a Schoology assignment; you get class-wide weak-topic data with zero backend and zero student accounts. Use it to steer the Apr 7 mock item-analysis day and the Apr 14 weak-topic clinics.
4. **Exam-voice moments at exam pace.** Each level/run ends with a short **Exit Exam**: 3 MCQs written in genuine College Board phrasing ("Assume the economy is operating below full employment…", "Which of the following would most likely…") with distractors built from real misconceptions — timed at **70 seconds per question**, the actual Section I pace (60 Q / 70 min), with a visible pace bar. Game-voice during play, exam-voice at the exit: students learn the translation both ways.
5. **WHY lines are rubric sentences.** Every explanation is written as the sentence that would earn the FRQ point ("Expansionary fiscal policy increases AD; the price level rises and real output increases toward full employment") — so feedback doubles as FRQ phrasing practice. Occasional "Say it like the FRQ" bonus: the chain appears with one link blanked; tap the right link, earn the point.

**Item-writing rule:** cards *paraphrase* the style of released items and AP Classroom questions — never copy secure or verbatim College Board items into the game (copyright + exam security). You QA every card against the Fall 2026 CED before it ships.

## 3. Game specs

### 3.1 Shift Happens (P0 — build first)

**Loop (per round, ~15 sec):** BREAKING card slides in ("Consumer confidence falls") → 8-second timer bar → student taps the curve they think moves (it glows), then drags it or taps ◀ / ▶ / **"No shift — movement along"** → spring animation, verdict → 2–3 rapid consequence chips ("Price level? ▲▼ — Real GDP? ▲▼ — Unemployment? ▲▼") → next card.

**Scoring:** +100 shift, +25/chip, speed bonus up to +50, streak multiplier ×1–×5. 3 hearts per level. Wrong = shake + heart cracks + the WHY line.

**Levels (8 rounds + 1 boss each; unlock next at 75%, medals 75/85/95):**
1. *Demand Rookie* — AD only (C, I, G, Xn stories)
2. *Supply Side* — + SRAS (input costs, productivity, expectations)
3. *Gap Attack* — full AD-AS; extra chip: "Recessionary or inflationary gap?"; boss = double shift
4. *Money Market* — MS/MD, nominal i (Fed actions, price level, income, payment tech)
5. *Loanable Funds* — S/D of LF, real r; crowding-out boss
6. *FOREX Floor* — market for USD; chips ask appreciate/depreciate + effect on Xn
7. *Phillips Finale* — the trap level: AD shifts = movement ALONG the SRPC; SRAS shifts / expectations MOVE it

**Trick cards** ("the price level rises" on an AD-AS screen → correct answer is *movement along*, not a shift) appear from L2 on — this is the #1 AP trap.

**Level Exit Exam (AP layer):** clearing the boss unlocks a 3-question exam-voice MCQ set on that level's topics at 70 sec/question; medal counts only after it. Gold + perfect exit exam = "Exam Ready" ribbon on that unit in the hub heat map.

**Graphs:** one generic SVG component, re-labeled per market. **Axis labels must match CED conventions exactly** (PL & Real GDP; nominal i & Q of money; real r & Q of loanable funds; price of $ in foreign currency; π% & u%) — the game silently teaches correct FRQ labeling.

**Round data schema (author content as data, not code):**
```json
{ "head": "OPEC slashes oil production", "emoji": "🛢️", "graph": "adas",
  "curve": "SRAS", "dir": "L",
  "chips": [ {"q":"Price level?","a":"up"}, {"q":"Real GDP?","a":"down"} ],
  "why": "Oil is an input cost → SRAS left. Cost-push inflation: PL up, GDP down.",
  "ced": "3.6" }
```
~12 cards per level. Every card carries a `ced` topic tag and a `why`. (Ask Claude Code to draft cards, then **you** QA them against the CED — you're the economist.)

### 3.2 Fed Chair (P1)

**Loop:** pick an era → mission briefing → 10 turns (quarters). Each turn: read gauges (inflation, unemployment, growth — animated dials with the 2% target band and u* line) + news ticker + dueling advisor quips → set the policy rate (±100/50/25/0 bps) and any era-special action → END TURN → the economy responds *with lags* → scripted shock events pop mid-run.

**Model (simple, tuned, honest):**
- Demand: `gap += -k·(realRate − neutral) + demandShock` (policy hits output **next turn**)
- Okun: `u = u − 0.5·gap`
- Phillips: `π = πExp + 0.5·gap + supplyShock` (inflation lags **two** turns behind policy)
- Expectations: `πExp = a·πExp + (1−a)·π` — anchoring `a` varies by era (1970s ≈ 0.5 = unanchored; that's the whole lesson)
- 2008: zero lower bound; unlock **[Launch QE]**. 2021: you set **administered rates (IORB)** — ample-reserves language, matching the new CED.

**Eras & scripted beats:** 1975 Burns (OPEC aftershock, wage-price spiral, Nixon's phone call), 1980 Volcker (credibility meter: consecutive high-rate turns re-anchor expectations faster; can you break 13% inflation without u > 11%?), 2008 Bernanke (Lehman event card: bail out or not; deflation spiral risk at the ZLB), 2021 Powell ("it's transitory," reopening + supply-chain shocks).

**End screen:** a **newspaper front page** whose headline depends on your run ("MAESTRO!" vs "WIN Buttons For Everyone") + AP stamp + *"What really happened"* — 4 sentences of true history and an SVG chart overlaying **your** inflation path vs the **historical** one. That comparison is the deepest learning moment in the arcade.

**FRQ debrief (AP layer):** after the newspaper, one screen translates the run into exam language — "What you just did, the way the FRQ asks it": a short FRQ-style prompt about a turn you actually played (e.g., "The economy is in a recessionary gap. (a) Identify an open-market operation the Fed could use. (b) Explain how it affects the federal funds rate."), answered by tapping chain links, then the full-credit rubric sentences revealed. Tracked like everything else.

### 3.3 The Investor (P2) — your idea, speced

**Premise:** you have $10,000 and 12 quarters. Each quarter the Fed (an NPC with a personality per playthrough) moves rates; news drops; **you allocate** across 5 buckets: cash / 10-yr bonds / stocks / real estate / 1-yr CD. Returns follow simple, honest rules: bond prices move **inverse** to rates (long > short duration), stocks like growth but hate rate spikes, real estate loves falling mortgage rates, cash is safe but inflation quietly eats it (real vs nominal shown side by side every turn — the killer lesson).

**Twist that makes it a game:** before each Fed meeting you get one **signal** of variable reliability ("hawkish whispers…") — commit your allocation *before* the announcement. Score = real (inflation-adjusted) portfolio value; leaderboard initials. Badges: "Bond Whisperer" (profit from a rate cut in bonds), "Inflation Survivor" (positive real return in the high-inflation run), "Diamond Hands" (held stocks through a crash that recovered).

**Teaches:** bond↔rate inverse (MEA-3.A.3, an exam favorite), nominal vs real return (4.2), rate transmission (4.6), diversification — and it IS the personal-finance weave, as a game.

**AP layer:** every quarter's outcome closes with the exam question underneath it, in exam voice ("Interest rates rose. Which of the following happened to the price of previously issued bonds, and why?") — the arcade's densest source of Unit 4 MCQ reps.

### 3.4 Crisis Country (P3) — your idea, speced

**Premise:** you're the finance minister of a fictional country (procedurally named: "Bassinia," "Republic of Woodmere"…). Each run = one crisis drawn from a deck: recession, hyperinflation, currency collapse, oil shock, trade war. Each turn you pick from policy cards — fiscal (G↑, taxes, stabilizers), monetary (via your central bank, if it's independent…), exchange-rate (float/peg/intervene), trade — each card shows its AD-AS/FOREX logic **after** you commit. Advisors argue; the IMF calls with strings attached; elections loom (popularity meter vs. economy meter — the political-economy tension is the fun).

**Win:** stabilize inflation + unemployment + reserves before turn 12. **Teaches:** the whole policy toolkit interacting (U3–U6), open-economy constraints, why "just print money" ends badly — the hyperinflation run is basically Weimar with a scoreboard.

**AP layer:** each policy card, once committed, flips over to show its effect written as an FRQ chain (`G↑ → AD→ right → PL↑, Y↑, u↓` plus the FOREX leg when relevant) in CED notation; the end screen's Exit Exam draws its 3 questions from the chains the player actually triggered.

### 3.5 P4 quick games (one evening each, shared engine)
Sort Circuit (swipe-sorting: GDP or not / M1-M2 / expansionary-contractionary / current vs financial account) · Calc Blitz (numpad ladder: multiplier, CPI, real GDP, u-rate, Fisher, bank multiplier) · Graph Doctor (spot 3 planted errors in a drawn graph — trains exactly what loses FRQ points) · **Blaster port**: drop the existing game's folder into `/games/blaster/` and add a hub card. If it's currently served by a local server, it almost certainly needs zero changes as static files.

## 4. Architecture (tell Claude Code exactly this)

```
drs-econ-arcade/
├── index.html          # hub: marquee, initials entry, game cards + local bests
├── games/
│   ├── shift-happens.html
│   ├── fed-chair.html
│   ├── investor.html
│   └── crisis-country.html
├── shared/
│   ├── arcade.css      # tokens + UI kit (buttons, cards, gauges, hearts)
│   └── arcade.js       # sound synth, storage, confetti, screen-shake, initials, medal/AP-stamp,
│                       #   track(ced, skill, correct) + readiness() heat-map data + readiness-code export
└── CLAUDE.md           # the contract (appendix B)
```

- **Style tokens** (match the Level Up game you already built, so the arcade feels like one product): bg `#131F24` / panel `#1B2B33` / green `#58CC02` / gold `#FFC800` / blue `#1CB0F6` / red `#FF4B4B` / purple `#CE82FF`; fonts Nunito (800/900 for display) + JetBrains Mono for numbers; chunky Duolingo-style buttons with pressed-shadow.
- **`localStorage` keys:** `arcade.initials`, `arcade.muted`, `arcade.<game>.best`, `arcade.<game>.progress`, `arcade.mastery` (the tracker: `{ "4.6": {right: 12, total: 15, skills: {...}}, ... }`). Wrap reads/writes in try/catch.
- **Hub "My AP Readiness" panel:** 6-unit heat map from `arcade.mastery`, weakest-topic callout, estimated score band (unit-weight-adjusted accuracy), "play this next" link, and the copyable readiness code (see §2b).
- **Mobile first:** pointer events (touch + mouse), tap targets ≥ 48px, portrait layouts, no hover-only interactions, `<meta name="viewport">` everywhere.
- **No external assets**: no images (emoji + SVG only), no audio files (WebAudio synth), fonts from Google Fonts only.

## 5. Ship it (deploy + student access)

1. **Repo:** `gh repo create drs-econ-arcade --public` (or private — Vercel doesn't care). Commit the skeleton.
2. **Vercel:** vercel.com → Add New → Project → import `drs-econ-arcade` from GitHub → Framework preset: **Other** (it's static) → Deploy. Your team is `dbassin12's projects` (hobby). Result: `https://drs-econ-arcade.vercel.app` — every `git push` redeploys in ~20 seconds. (Alternative from the terminal: `npx vercel --prod`.)
3. **Access for 18 students:** pin the URL in Schoology → materials; print a QR poster for the board; it works on phones on their own data even if school Wi-Fi is grumpy. **Test once on school Wi-Fi** — if the district blocks `*.vercel.app` (rare), Plan B is GitHub Pages (same repo, Settings → Pages, `drsbassin.github.io/drs-econ-arcade`), Plan C is a $12/yr custom domain which filters almost never block.
4. **No accounts, no data:** scores live on each student's device. Nothing to COPPA/FERPA about. (The future shared leaderboard should stay initials-only for the same reason.)

## 6. Build order & session-sized milestones

| Phase | Sessions | Definition of done |
|---|---|---|
| **P0** | 2–3 evenings | Hub + Shift Happens L1–3 pass the Juice Checklist; deployed; you score a 5 on L1 on your phone |
| **P1** | 2–3 evenings | Fed Chair: 1975 + 2008 playable with newspaper endings + history-compare chart; then 1980 + 2021 |
| **P2** | 2 evenings | The Investor: 3 Fed personalities, badges, real-vs-nominal display |
| **P3** | 2–3 evenings | Crisis Country: recession + hyperinflation crises (add currency crisis later) |
| **P4** | 1 evening each | Sort Circuit → Calc Blitz → Graph Doctor → Blaster port |
| Stretch | — | Shared leaderboard (Vercel KV or a Claude artifact with shared db) · PWA install · "Econ City" 3D tycoon |

**Classroom sync (already on your pacing calendar):** Nov 9 AD-game day → Shift Happens L1–2 · Dec 9 U3 review game → L1–3 arcade night · Feb 10 MV=PQ day → Fed Chair 1975 · Feb 24 FOMC-for-a-Day → Fed Chair tournament (pairs, projector podium) · Mar 22 FOREX speed round → L6 · Apr review games → full arcade rotation. The Investor doubles as the Unit 4 personal-finance weave (Dec 17–Jan 12). So: **P0 must ship by Nov 9, Fed Chair by Feb 10.** Both are comfortable.

## 7. Content QA rule (the teacher's job, not Claude's)

Every card/scenario ships only after YOU check: (a) econ is airtight per the **Fall 2026 CED** (watch: ample reserves/IORB framing in anything Fed-related; reserve market model is now fair game), (b) the `why` line would earn the FRQ point, (c) at least 1 in 8 cards is a trick/no-shift card, (d) labels match CED graph conventions. Keep a `content/` review habit: play each new level once before students do.

---

## Appendix A — kickoff prompt for Claude Code (paste as-is)

> Read GAME_PLAN.md and CLAUDE.md in this folder. Scaffold the repo per §4: hub + shared/arcade.css + shared/arcade.js (WebAudio synth sfx, localStorage helpers with try/catch, confetti canvas, screen-shake, initials entry, medal + AP-stamp components, and the Skill Tracker: track(ced, skill, correct), readiness() aggregation, readiness-code export). The hub includes the "My AP Readiness" heat-map panel per §2b. Then build games/shift-happens.html per §3.1: levels 1–3 only, 12 round-cards per level (draft them from the schema; tag each with its CED topic + skill; include 2 trick "no shift" cards per level from L2), each level ending in a 3-question exam-voice Exit Exam at 70 sec/question. Meet every item on BOTH checklists — Juice (§2) and AP Prep (§2b). Mobile-first pointer events, 48px targets, reduced-motion respected. When it runs clean, deploy: gh repo create drs-econ-arcade, push, then npx vercel --prod, and give me the URL.

Then per phase: "Build fed-chair.html per §3.2 — 1975 and 2008 eras first," etc.

## Appendix B — CLAUDE.md for the repo (paste into a new file)

```markdown
# DRS Econ Arcade — rules for Claude
- Plain HTML/CSS/JS. No frameworks, no bundlers, no npm deps. One self-contained file per game.
- Every game imports shared/arcade.css + shared/arcade.js. Match the existing style tokens; never invent a new palette.
- Content is data: round cards / scenarios live in a const JSON block at the top of each game file, one entry per line, each with a "ced" tag and a "why" line. Never bury content in logic.
- The Juice Checklist (GAME_PLAN.md §2) AND the AP Prep Checklist (§2b) are both acceptance criteria. A game without sound, streaks, WHY-lines, and an end-screen celebration is not done; neither is one whose items aren't ced+skill tagged, that skips the exam-voice Exit Exam, or that fails to call track() on every answer.
- WHY lines are written as full-credit FRQ rubric sentences. Exit Exams use College Board stem phrasing at 70 seconds per question. Never copy real secure/released items verbatim — paraphrase the style.
- Econ accuracy beats gameplay: if a mechanic requires bending the economics, change the mechanic. CED (Fall 2026) conventions for all graph labels; Fed content uses the ample-reserves / IORB framing.
- Mobile first: pointer events, ≥48px tap targets, portrait-friendly, no hover-dependent UI. Test with devtools mobile emulation before calling anything done.
- localStorage only (keys: arcade.*), wrapped in try/catch. No accounts, no analytics, no external requests except Google Fonts.
- After any change: open the file in a browser, play one full round/turn, check the console for errors. Then commit with a message naming the game and change.
```
