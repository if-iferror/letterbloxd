# Firefox Add-ons Listing — LetterBloxd

> Last Updated: 2026-10-10

Copy-paste source for addons.mozilla.org (Developer Hub → Submit a New Add-on → "On this site").

## Upload

- **File:** LetterBloxd-1.3.0.zip
- **Compatible platforms:** Desktop only (leave Android unticked).
- **Source code:** "No". The package isn't minified, bundled or built; every file is plain, readable source.

## Describe Add-on

**Name:** LetterBloxd — Block films on Letterboxd

**Add-on URL:** letterbloxd

**Summary** (250 chars max)
Unofficial. Block films you'll never watch, see status badges and add to your watchlist in one click on Letterboxd.

**Description** (paste as-is; AMO shows plain line breaks)

Block the films you'll never watch. LetterBloxd adds a Block button to Letterboxd, plus filters to fade or hide those films everywhere you browse.

FEATURES
• Block — hover any poster and click Ø, or click "Block" on a film's page. Blocked films are saved to a private "Not Interested" list on your own Letterboxd account, so they follow you to any computer.
• A tidier filter menu — Not interested, Watched, Liked and Watchlist each get one row: Show · Fade · Hide · Only.
• Coloured fades — watched films fade toward green, liked toward orange, watchlist toward blue, so you can tell them apart.
• Badges — a small badge on each poster: Icons (seen, loved, watchlisted), Ratings (☆ 3.5) or off.
• One-click watchlist — straight from the poster's hover bar, no "…" menu.
• One-click rating — on hover, the "…" shows your rating, or "☆ Rate" if you haven't rated yet.
• Tidies up after you — watching, liking or watchlisting a blocked film unblocks it, and marking a film watched takes it off your watchlist.
• Instant — everything updates as you click, and blocked films never flash on screen.
• Feedback — a feedback bar (the megaphone tab at the top right).

HOW TO USE
1. Install, then open letterboxd.com while signed in.
2. Hover a poster and click Ø to block it.
3. Open the eye menu on any film grid to Show, Fade, Hide or show Only blocked films.
4. Choose a badge style under Badges in the same menu.

PRIVACY
No analytics, no tracking. LetterBloxd talks to letterboxd.com, as you, and keeps its settings in your browser. The only thing it ever sends the developer is feedback you choose to send, with the extension version, your browser, the kind of page you were on and your LetterBloxd settings. No username, no page address, nothing about your films.

PERMISSIONS
• "Read and change your data on letterboxd.com" — to add buttons, badges and filters, and to update your Not Interested list and watchlist when you click. It runs on no other website.

SUPPORT
Bugs or ideas: https://github.com/if-iferror/letterbloxd/issues

LetterBloxd is free, open source and unofficial. It is not affiliated with or endorsed by Letterboxd.

**Categories:** Social & Communication (alternative: Photos, Music & Videos)

**Support email:** if.iferror@gmail.com
**Support website:** https://github.com/if-iferror/letterbloxd/issues
**Homepage:** https://github.com/if-iferror/letterbloxd

**License:** MIT License

**This add-on has a privacy policy:** Yes. Paste the contents of PRIVACY.md (or link https://github.com/if-iferror/letterbloxd/blob/main/PRIVACY.md if the form allows).

## Notes to Reviewer

LetterBloxd runs only on https://letterboxd.com/*. No build step: all files are plain source.

- content.js runs in the page (world: MAIN) so it can work with Letterboxd's own requests and menus. It only talks to letterboxd.com, as the signed-in user, to update the user's own private "Not Interested" list and watchlist when they click.
- Feedback: only when the user types into the feedback bar and presses Enter. content.js → bridge.js (isolated content script) → background.js, which posts to the developer's Google Form (docs.google.com). Sent: the message, the extension version, browser and OS, a page *type* (e.g. "film page", never the URL) and the extension's display settings. Declared as optional data collection (personalCommunications, technicalAndInteraction); background.js checks permissions.contains() and, if not granted, opens consent.html, whose button calls permissions.request() before anything is sent.
- The linter's innerHTML warnings are for fixed SVG icon strings and numeric ratings defined in the extension; no page or user text is inserted as HTML.
- The "background.service_worker" key is for Chrome; Firefox uses "background.scripts" (same file).

## Version History

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| 1.3.0 | 2026-10-10 | First Firefox release. | Ready |
