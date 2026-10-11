# LetterBloxd

**Block the films you'll never watch.** A free, open-source extension for Letterboxd that adds a Block button, a tidier filter menu, status badges and one-click watchlisting.

Letterboxd can hide films you've watched or watchlisted, but there's no way to say "I've seen the trailer, I'm never watching this." LetterBloxd adds that.

> Unofficial. LetterBloxd is a fan-made extension and isn't affiliated with or endorsed by Letterboxd.

## What's new in 1.3.0

- New name (formerly Letternoxd).
- The film-page button is now **Block**.
- Badges come in two styles: **Icons** or **Ratings**.
- A feedback bar (the megaphone tab at the top right).
- Works in Firefox.

## Features

**Block films**
- Hover any poster and click **Ø** in the top-right corner, or click **Block** on a film's page.
- Blocked films are saved to a private "Not Interested" list on your own Letterboxd account, so they follow you to any computer.

**A tidier filter menu** (the eye icon above any film grid)
- Not interested, Watched, Liked and Watchlist each get one row: **Show · Fade · Hide · Only**.
- Fades are coloured and independent: watched toward green, liked toward orange, watchlist toward blue, so you can tell them apart at a glance.

**Badges**
- A small badge in each poster's corner. Pick a style under **Badges** in the eye menu: **Icons** (seen, loved, watchlisted), **Ratings** (☆ 3.5) or **Off**.

**Quick actions**
- **Watchlist in one click** from each poster's hover bar, without the "…" menu.
- **Rate in one click**: on hover, the "…" becomes your rating (☆ 3.5), or ☆ Rate if you've seen it but not rated it.

**Tidies up after you**
- Watching, liking or watchlisting a blocked film unblocks it automatically.
- Marking a film watched takes it off your watchlist.
- Everything updates the moment you click, and blocked films are hidden before the page finishes drawing.

**Feedback**
- A feedback bar (the megaphone tab at the top right). Type and press Enter.

## Your data

Blocked films live in a private "Not Interested" list on your Letterboxd account; edit it like any other list. Settings stay in your browser.

LetterBloxd only talks to letterboxd.com, as you. The one exception is feedback you choose to send: your message, plus the extension version, your browser and OS, the kind of page you were on (never its address) and your LetterBloxd settings. No username, nothing else. Firefox asks before the first send. Details in [PRIVACY.md](PRIVACY.md).

## Install

**From the Chrome Web Store** (Chrome, Arc, Brave, Edge): *link coming soon*.

**From Firefox Add-ons** (Firefox 128 or later): *link coming soon*.

The same files work in both browsers.

**From this repository, in Chrome, Arc, Brave or Edge:**

1. Download this repository (green **Code** button → **Download ZIP**) and unzip it somewhere permanent.
2. Go to `chrome://extensions` (Arc: `arc://extensions`, Brave: `brave://extensions`, Edge: `edge://extensions`).
3. Turn on **Developer mode** (top right), click **Load unpacked**, and choose the unzipped folder.
4. Reload any open Letterboxd tabs.

To update, replace the files, click ↻ on the extension's card, and reload Letterboxd.

**From this repository, in Firefox:**

1. Download and unzip this repository as above.
2. Go to `about:debugging#/runtime/this-firefox` and click **Load Temporary Add-on…**.
3. Choose the `manifest.json` file inside the unzipped folder.
4. Reload any open Letterboxd tabs.

Firefox removes temporary add-ons when it restarts, so for everyday use install it from Firefox Add-ons instead.

## Good to know

- Pages may show a few fewer posters than usual; a note under the grid says how many were hidden.
- Page totals (e.g. "1,234 films") still count hidden films.
- Desktop browsers only; the Letterboxd apps aren't affected.
- A Letterboxd redesign may need an update.

## Troubleshooting

Open the browser console on a Letterboxd page and run:

- `lbNotInterested.state()` to see what the extension knows (your list, saved films, settings).
- `lbNotInterested.resync()` to re-read your "Not Interested" list now. It otherwise refreshes every 6 hours, when you return to a tab after 10 minutes, and whenever you click Ø.

## License

MIT
