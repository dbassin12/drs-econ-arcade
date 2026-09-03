# DRS Econ Arcade — rules for Claude
- Plain HTML/CSS/JS. No frameworks, no bundlers, no npm deps. One self-contained file per game.
- Every game imports shared/arcade.css + shared/arcade.js. Match the existing style tokens; never invent a new palette.
- Content is data: round cards / scenarios live in a const JSON block at the top of each game file, one entry per line, each with a "ced" tag and a "why" line. Never bury content in logic.
- The Juice Checklist (GAME_PLAN.md §2) AND the AP Prep Checklist (§2b) are both acceptance criteria. A game without sound, streaks, WHY-lines, and an end-screen celebration is not done; neither is one whose items aren't ced+skill tagged, that skips the exam-voice Exit Exam, or that fails to call track() on every answer.
- WHY lines are written as full-credit FRQ rubric sentences. Exit Exams use College Board stem phrasing at 70 seconds per question. Never copy real secure/released items verbatim — paraphrase the style.
- Econ accuracy beats gameplay: if a mechanic requires bending the economics, change the mechanic. CED (Fall 2026) conventions for all graph labels; Fed content uses the ample-reserves / IORB framing.
- Mobile first: pointer events, ≥48px tap targets, portrait-friendly, no hover-dependent UI. Test with devtools mobile emulation before calling anything done.
- localStorage only (keys: arcade.*), wrapped in try/catch. No accounts, no analytics, no external requests except Google Fonts and the class leaderboard (the 2026-09-03 amendment below).
- After any change: open the file in a browser, play one full round/turn, check the console for errors. Then commit with a message naming the game and change.

## Amendments (2026-09-01)

- **Drag is the only input during play.** No multiple choice inside a round. Multiple choice appears only in the post-boss Exam Sprint.
- **The Exam Sprint is post-boss and gates gold only.** Clearing the boss unlocks it; failing it never takes a level away — it only withholds the gold medal.
- **`shared/graph.js` is the graph engine, with markets as data.** Never hand-draw a market inside a game file; add the market to the engine's data and render it through `ArcadeGraph`.
- **Pure logic gets a `*.test.js` next to it.** `node --test shared/*.test.js games/*.test.js leaderboard/*.test.js` must pass with pristine output before every commit.
- **Voice is Web Speech, opt-in.** Off by default, toggled by the student, and never required to play.
- **Never reuse MicroBlaster code or content.** Nothing from `~/projects/MicroBlaster` — no code, no content, no patterns.
- **Test on `python3 -m http.server 5590`** from the repo root (5591 if busy; never port 3000), in a real browser at 360×740 with a clean console.

## Amendment (2026-09-03) — the class leaderboard

- **The class leaderboard is the one network call.** `shared/leaderboard.js` posts a new personal best — initials, game, level, score, title points, title — to the Apps Script endpoint named at its top, and the hub reads the board back through it; `leaderboard/apps-script.js` is that endpoint, `leaderboard/SETUP.md` its deployment. Every page's `connect-src` names its two hosts and nothing else. No other request, ever; with no URL configured the arcade is exactly as local as before.
- Initials only on the board, never names. The Sheet is the moderation tool.
