# DRS Econ Arcade

A hub of browser games for AP Macroeconomics, built by David Bassin (DRS) for 18 seniors playing on
phones, Chromebooks, and home laptops. Every game trains a skill the exam actually grades — graph
manipulation, cause→effect chains, calculations, and policy judgment — and every scored interaction
is tagged with its CED topic, so the hub can grow a "My AP Readiness" heat map that turns play into a
diagnostic. Plain HTML/CSS/JS: no frameworks, no build step, no accounts, no backend. Scores live in
`localStorage` on the student's own device.

## File tree

```
.
├── index.html                    # hub: marquee, initials, game cards, AP readiness panel
├── games/
│   ├── shift-happens.html        # P0 game: graph surgery under time pressure
│   ├── fed-chair.html            # P0 preview (1975 era): you are the Fed chair
│   ├── fed-chair.model.js        # the Fed macro model (pure logic)
│   └── fed-chair.model.test.js
├── shared/
│   ├── arcade.css                # tokens + the whole UI kit (this is the only stylesheet)
│   ├── arcade.js                 # sound, storage, juice, initials, track()/readiness()
│   ├── arcade.test.js
│   ├── graph.js                  # the SVG graph engine — markets are data
│   └── graph.test.js
├── .gitignore
├── CLAUDE.md                     # the build contract
├── GAME_PLAN.md                  # the full spec
└── README.md
```

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
