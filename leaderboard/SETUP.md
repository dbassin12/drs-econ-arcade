# The class leaderboard — setup

Five minutes, once. The board is a Google Sheet you own, with a small script in front of it that the
arcade pages talk to. Students never sign in to anything; a new personal best posts their initials,
the game, the level, the score and their title points, and the hub shows the class's bests.

## 1. Make the Sheet

1. Create a new Google Sheet. Name it anything — "DRS Econ Arcade board" is fine.
2. In the Sheet: **Extensions → Apps Script**. An editor opens with an empty `Code.gs`.
3. Delete what is there and paste the whole of `leaderboard/apps-script.js` from this repo.
4. At the top of the pasted file, set:
   - `CLASS_CODE` — a short word your pages will send with every post, e.g. `MACRO27`. It is not a
     password (it ships in the public site); it is what keeps other people's copies of the arcade
     from posting to *your* board.
   - `CLASS_NAME` — the name the hub prints on the board, e.g. `AP Macro · Period 4`.
5. Save (the disk icon).

## 2. Deploy it as a web app

1. **Deploy → New deployment**.
2. Click the gear next to "Select type" and choose **Web app**.
3. Description: anything. **Execute as: Me.** **Who has access: Anyone.** Then **Deploy**.
4. Google asks you to authorize the script the first time. It is your own script on your own Sheet;
   click through "Advanced → Go to (unsafe)" if it warns that the app is unverified — that warning is
   about the script not having been reviewed by Google, and only you ever see it.
5. Copy the **Web app URL**. It ends in `/exec`.

## 3. Point the arcade at it

In `shared/leaderboard.js`, at the top:

```js
const LEADERBOARD_CONFIG = {
  url: 'https://script.google.com/macros/s/…/exec',   // the URL from step 2
  classCode: 'MACRO27',                                // the same word as CLASS_CODE
  refreshSeconds: 30
};
```

Commit and push. GitHub Pages rebuilds in about a minute.

## 4. Check it

Open the hub. The **Class Board** panel should read "AP Macro · 0 players · read at …". Set your
initials with the `???` button, play any level to a score, and the end screen toasts
"🏆 First on the class board". Back on the hub, your row is there in gold.

To try a deployment without committing, open the hub, open the browser console, and run
`Leaderboard.configure({ url: '…/exec', classCode: 'MACRO27' })`, then tap the ↻ on the board.

## Day to day

- **Moderation** is the Sheet. Every post is one row on the `board` tab; delete a row and it is off
  the board on the next read (reads are cached for 15 seconds). Blocked initials are the `BLOCKED`
  list at the top of the script — add to it if the class finds a gap.
- **Arcade Night**: tap 📺 on the hub. The board leads the page in big type and re-reads itself
  every 30 seconds while the tab is visible, so the projector moves as students post.
- **Editing the script later** (a new blocked word, a new class code): save, then
  **Deploy → Manage deployments → ✎ → Version: New version → Deploy**. The URL stays the same.
  Changing `CLASS_CODE` locks out every page still carrying the old one, which is the intended way to
  retire a board between years.
- **A new year, a new class**: change `CLASS_CODE` and `CLASS_NAME`, redeploy, update
  `shared/leaderboard.js`, and clear or archive the `board` tab.

## What is stored, and what is not

Each row: a timestamp, three initials, a game id, a level, a score, title points and the title name.
No names, no emails, no readiness data, no device identifiers. The readiness code students paste into
Schoology never touches this script. Everything else in the arcade is still local to the device.

## If it does not work

- "Can't reach the class board": the URL must end in `/exec`; access must be **Anyone**; a script
  edited after deploying needs a **new version** (step above). School Wi-Fi occasionally blocks
  `script.google.com` — phones on cellular will show whether that is the problem.
- The board reads but a best did not post: the student's initials were still `???` (the hub asks
  them to set it), or the initials are on the blocked list.
- A post refused for "class code": the word in `shared/leaderboard.js` and the one in the script
  differ, or the script was redeployed with a new one and the site has not been rebuilt.

Under the hood: `GET …/exec?code=…` returns the whole board as JSON; `POST …/exec` with a JSON body sent
as `text/plain` lands one best and answers with its rank. Both are exercised by
`node --test leaderboard/apps-script.test.js` before anything is pasted anywhere.
