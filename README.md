# Clearhead: a personal GTD system

An installable web app (PWA) built around *Getting Things Done*. It runs on Windows (Chrome or Edge) and Android (Chrome). Data is local-first: each device keeps a full copy and works offline. Devices sync through one JSON file in a private Dropbox app folder. No server, no account with anyone but Dropbox.

It's designed around four ways task systems usually fail:

| Problem | What the app does about it |
| --- | --- |
| **Capture friction** | An always-visible capture bar (press <kbd>N</kbd> on Windows). Android "Share → Clearhead" sends any link or text straight to the inbox. Long-press the app icon for **Quick capture**. Optional shorthand: `@phone +Tax_return ~15m !low due:fri`. |
| **Overwhelm** | The **Now** screen asks where you are, how much time you have and your energy, then shows the ~5 best-fitting actions only. Starred ("focus") and overdue items rise to the top. Everything else stays out of sight. |
| **Vague tasks** | **Process inbox** walks each item through the GTD clarify questions: actionable? project? next physical action? under 2 minutes? delegate? Wording like "sort out…", "look into…" or a bare topic ("Taxes") gets a nudge to rewrite it as a concrete action. Projects without a next action are flagged as **stalled**. |
| **Skipping reviews** | From your review day (Monday by default) a banner stays on the Now screen until you finish the **guided weekly review**. That's a 9-step checklist with live counts (inbox, stalled projects, stale waiting-fors) and a week streak. |

## Lists

- **Inbox**: everything you capture, waiting to be clarified.
- **Next actions**: grouped by context (`@home @office @errands @computer @phone @deep @admin`, editable in Settings).
- **Projects**: outcomes needing more than one action, each with its outcome statement, notes and actions.
- **Waiting for**: delegated items, with the person's name and how many days you've waited. After 7 days a *Follow up* button appears.
- **Someday / Maybe** and **Reference**.
- **Upcoming**: real deadlines plus "not before" dates (a tickler). Items with a future start date stay hidden from Now and Next until that day.
- **Done**: the last 30 days.

## Daily and weekly rhythm

1. **All day:** capture anything the moment it appears. Don't organise it yet.
2. **Once a day (5–10 min):** process the inbox to zero (<kbd>P</kbd>, or the *Process* button).
3. **Whenever you have a gap:** open **Now**, tap your context, time and energy, and do the top item.
4. **Monday morning (~30 min):** do the weekly review when the banner appears.

## Run it locally

```bash
npm start          # serves app/ at http://localhost:8080
npm test           # unit tests for the GTD logic, parsing and sync merge
npm run e2e        # browser test incl. two-device sync (needs the playwright package)
```

There's no build step. `app/` is the whole app.

## Hosting (needed for the Android install)

Android needs the app on an HTTPS URL. Any static host works; put the `app/` folder online:

- **GitHub Pages:** free. On a free GitHub plan the repo must be public (only the code is public, never your tasks). In repo settings → Pages, deploy from a branch, or add a workflow that publishes `app/`.
- **Netlify or Cloudflare Pages:** free, and works with a private repo. Set the publish directory to `app`.
- **Just the PC:** `npm start` and install from `http://localhost:8080`.

When you change app files, bump `VERSION` in `app/sw.js` so installed copies pick up the update.

## Install

- **Windows:** open the URL in Edge or Chrome, then use the install icon in the address bar (or menu → *Apps → Install*). It gets a Start menu entry and its own window.
- **Android:** open the URL in Chrome, then menu → *Add to Home screen / Install app*. After installing, Clearhead appears in the Android **Share** sheet. Long-pressing its icon gives *Quick capture* and *Process inbox* shortcuts.

## Set up Dropbox sync (about 5 minutes, once)

1. Go to <https://www.dropbox.com/developers/apps> → **Create app**.
2. Choose **Scoped access**, then **App folder**. Name it, e.g. `clearhead-yourname`.
3. On the **Permissions** tab, tick `files.content.write` and `files.content.read` → **Submit**.
4. On the **Settings** tab, under *OAuth 2 → Redirect URIs*, add the exact URL shown in Clearhead's Settings → Sync. That's your hosted URL, e.g. `https://you.github.io/clearhead/`, and/or `http://localhost:8080/`.
5. Copy the **App key** (not the secret; it isn't needed).
6. In Clearhead → **Settings → Sync**, paste the app key → **Connect Dropbox** → allow.
7. Repeat step 6 on each device with the same app key.

How sync works:

- It runs on open, a few seconds after each change, every 5 minutes while open, and when you come back online.
- Merging is per item: if you edit different things on the phone and the PC, both edits survive. If you edit the *same* item on both, the latest edit wins. Deletions sync too.
- Dropbox only ever sees `Apps/<your app>/clearhead.json`. The app can't read anything else in your Dropbox.
- Settings → Backup can export or import a JSON copy at any time. Import merges rather than overwrites.

## Known limits

- Reminders are in-app (banners and badges), not phone push notifications. Push would need a server, which a local-first design avoids. Put hard-time appointments in your calendar, as GTD recommends.
- Dropbox apps start in "development" status, which is fine for personal use on your own account.

## Project layout

```
app/index.html, styles.css        UI shell
app/js/model.js                   GTD logic: capture parsing, Now ranking, review, merge
app/js/store.js                   local storage (per device)
app/js/sync.js                    Dropbox PKCE sign-in + merge-and-upload sync
app/js/app.js                     views, clarify wizard, weekly review, shortcuts
app/sw.js, manifest.webmanifest   offline support, install, share target
tests/                            unit tests + browser end-to-end test
```
