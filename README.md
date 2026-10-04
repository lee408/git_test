# Clearhead: a personal GTD system

An installable web app (PWA) built around *Getting Things Done*. It runs on Windows (Chrome or Edge) and Android (Chrome). Data is local-first: each device keeps a full copy and works offline. Devices sync through one JSON file in a private Dropbox app folder. No server, no account with anyone but Dropbox.

It's designed around four ways task systems usually fail:

| Problem | What the app does about it |
| --- | --- |
| **Capture friction** | An always-visible capture bar (press <kbd>N</kbd> on Windows). Android "Share → Clearhead" sends any link or text straight to the inbox. Long-press the app icon for **Quick capture**. Optional shorthand: `@phone +Tax_return ~15m !low due:fri`. |
| **Overwhelm** | The **Now** screen asks where you are, how much time you have and your energy, then shows the ~5 best-fitting actions only. Starred ("focus") and overdue items rise to the top. Everything else stays out of sight. |
| **Vague tasks** | **Process inbox** walks each item through the GTD clarify questions: actionable? project? next physical action? under 2 minutes? delegate? Wording like "sort out…", "look into…" or a bare topic ("Taxes") gets a nudge to rewrite it as a concrete action. Projects without a next action are flagged as **stalled**. |
| **Skipping reviews** | From your review day (Monday by default) a banner stays on the Now screen until you finish the **guided weekly review**. That's a 9-step checklist with live counts (inbox, stalled projects, stale waiting-fors) and a week streak. |
| **Hidden open loops** | The review starts with a **mind sweep**: one guiding question at a time. It covers what's on your mind, the calendar behind and ahead, each active project (showing its outcome, current next action and who you're waiting on), and then work, home and admin, and people and personal. Type one line per thing. Each line goes to the Inbox, and lines under a project card are linked to that project. You can pause and resume it.

## Getting started: the first brain dump

On first launch (an empty app), the Now screen offers a **brain dump**, the big one-off collection GTD starts with. Set aside 1–2 hours. You can pause at any point and **Resume** from Now or Settings. You can re-run it later from Settings → Brain dump; it's worth doing every few months.

1. **Gather your stuff (12 cards):** desk, drawers, wallet and bag, notebooks, post, a walk around your home, email, messages, phone, computer, browser tabs, and your calendar. For each pile, type a line for every thing that needs a decision.
2. **Empty your head (~40 cards):** a deep trigger list covering Work, Home, Money & admin, Health, People, Errands and Plans, ending with worries and "anything else". One line per thing; shorthand works.
3. **Quick sort:** one tap (or key) per item: **Action** (A), **Project** (P), **Done** (D), **Someday** (S), **Reference** (R), **Trash** (T), with Undo. Projects go straight into Projects, flagged as needing a first next action. Only the *Action* items stay in the inbox for the full clarify flow.

Quick sort is also offered from the Inbox and Now whenever 10 or more unsorted items pile up.

## Lists

- **Inbox**: everything you capture, waiting to be clarified.
- **Next actions**: grouped by context (`@home @office @errands @computer @phone @deep @admin`, editable in Settings).
- **Projects**: outcomes needing more than one action, each with its outcome statement, notes and actions.
- **Waiting for**: delegated items, with the person's name and how many days you've waited. After 7 days a *Follow up* button appears.
- **Someday / Maybe** and **Reference**.
- **Upcoming**: real deadlines plus "not before" dates (a tickler). Items with a future start date stay hidden from Now and Next until that day.
- **Done**: the last 30 days.

## Google Calendar

Two kinds of dated action can go into Google Calendar:

- **Deadline** (`due:fri`): an all-day "Due: …" event.
- **Time block** (`at:thu-14:00`, or *Block time on / at* in the editor and the clarify step): a timed event that reserves the slot. Its length comes from the action's time estimate (`~90m`), or 1 hour if there isn't one. Today's time blocks appear at the top of **Now** under *Scheduled today*.

After you save a dated action, Clearhead offers **Add**. The editor and the Upcoming view also have *→ Google Calendar* buttons. Each one opens Google Calendar's own new-event form, already filled in with the title, time, notes, project and context. Nothing is sent until you press **Save** there, and Clearhead needs no Google sign-in or setup.

- **Keep them separate (one-time):** in Google Calendar, go to *Settings → Add calendar → Create new calendar* and name it "Clearhead". Then choose it in the event form's calendar dropdown. The pre-filled form can't select it for you.
- **It's one-way and manual:** changing a date later doesn't move the calendar event. The action shows **Calendar out of date** and offers to re-add it; delete the old event yourself. Completing an action doesn't remove its event.
- You can turn off the "offer after saving" prompt in Settings → Google Calendar, per device.

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

## Hosting on Cloudflare Pages

Android needs the app on an HTTPS address. It's hosted free on Cloudflare Pages, deployed straight from this repo, which can stay private. One-time setup:

1. Sign in at <https://dash.cloudflare.com> (a free account is fine).
2. Go to **Workers & Pages → Create → Pages → Connect to Git**, and authorise GitHub for `lee408/git_test` only.
3. Set up the build:
   - **Production branch:** `main` (or `claude/custom-task-management-qigkim` until it's merged)
   - **Framework preset:** None
   - **Build command:** leave empty
   - **Build output directory:** `app`
4. Choose **Save and Deploy**. You get an address like `https://clearhead-xxx.pages.dev/`. Every push to the production branch redeploys automatically.
5. Add that exact address, with the trailing `/`, as a Redirect URI in your Dropbox app (see below).

`app/_headers` sets a strict content security policy: the page can only talk to itself and Dropbox's API. It also tells browsers to always check for a fresh app shell. When you change app files, bump `VERSION` in `app/sw.js` so installed copies update.

To run it on the PC without hosting: `npm start`, then open `http://localhost:8080`.

## Install

- **Windows:** open the URL in Edge or Chrome, then use the install icon in the address bar (or menu → *Apps → Install*). It gets a Start menu entry and its own window.
- **Android:** open the URL in Chrome, then menu → *Add to Home screen / Install app*. After installing, Clearhead appears in the Android **Share** sheet. Long-pressing its icon gives *Quick capture* and *Process inbox* shortcuts.

## Set up Dropbox sync (about 5 minutes, once)

1. Go to <https://www.dropbox.com/developers/apps> → **Create app**.
2. Choose **Scoped access**, then **App folder**. Name it, e.g. `clearhead-yourname`.
3. On the **Permissions** tab, tick `files.content.write` and `files.content.read` → **Submit**.
4. On the **Settings** tab, under *OAuth 2 → Redirect URIs*, add the exact URL shown in Clearhead's Settings → Sync. That's your Cloudflare address, e.g. `https://clearhead-xxx.pages.dev/`, and/or `http://localhost:8080/`.
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
app/js/sweep.js                   weekly-review mind sweep questions
app/js/braindump.js               first brain dump cards and quick-sort choices
app/js/calendar.js                Google Calendar links for deadlines and time blocks
app/js/store.js                   local storage (per device)
app/js/sync.js                    Dropbox PKCE sign-in + merge-and-upload sync
app/js/app.js                     views, clarify wizard, weekly review, shortcuts
app/sw.js, manifest.webmanifest   offline support, install, share target
app/_headers                      Cloudflare Pages security and cache headers
tests/                            unit tests + browser end-to-end test
```
