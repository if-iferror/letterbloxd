# Chrome Web Store Listing — LetterBloxd

> Last Updated: 2026-10-10

Copy-paste source for every field in the Chrome Web Store Developer Dashboard. Fields still needing your input are marked **TO DO**.

## Store Listing

**Extension Name**
LetterBloxd — Block films on Letterboxd

(Must match manifest.json. Note: Google's guidance discourages other companies' names in the extension name. "X for [site]" is common and often accepted, but if the review flags it, rename to just "LetterBloxd" and keep "for Letterboxd" in the descriptions.)

**Short Description** (119 / 132 chars)
Unofficial. Block films you'll never watch, see status badges and add to your watchlist in one click on Letterboxd.

**Detailed Description** (plain text — the store strips formatting)

Hide the films you know you'll never watch. LetterBloxd adds a "Not interested" button to Letterboxd, plus a filter to fade or hide those films everywhere you browse.

FEATURES
• Not interested — hover any poster and click ⃠, or click "Block" on a film's page. Your choices are saved to a private "Not Interested" list on your own Letterboxd account, so they follow you to any computer.
• Show, fade or hide — three new choices in Letterboxd's filter menu, right next to its own "Hide watched films" options.
• One-click watchlist — add or remove a film from your watchlist straight from the poster, without opening the "…" menu.
• Status badges — a small badge on each poster: Icons (seen, loved, watchlisted) or Ratings (your star rating), or off.
• Coloured fades — with Letterboxd's "Fade watched films" on, seen films fade toward green and loved films toward orange, so you can still tell them apart.
• Changed your mind? — watching, loving or watchlisting a film automatically takes it off "Not interested".
• Seen it? — marking a film watched takes it off your watchlist.
• Instant — everything updates the moment you click, and hidden films never flash on screen.

HOW TO USE
1. Install the extension and open letterboxd.com while signed in.
2. Hover a poster and click ⃠ in its top-right corner to mark it Not interested.
3. Open the eye (filter) menu on any film grid and choose Show, Fade or Hide not interested.
4. Turn status badges on or off from the same menu.

PRIVACY
LetterBloxd has no analytics or tracking. It talks to letterboxd.com, where it makes the changes you ask for on your own account, and keeps your settings in your browser. The only thing it ever sends the developer is feedback you choose to type into the feedback bar, along with the extension version, your browser, the kind of page you were on and your LetterBloxd settings. No username, no page address, nothing about your films.

PERMISSIONS
• "Read and change your data on letterboxd.com" — needed to add the buttons, badges and filters to Letterboxd pages, and to update your Not Interested list and watchlist when you click. The extension runs on no other website.

SUPPORT
Found a bug or have an idea? Open an issue at https://github.com/if-iferror/letterbloxd/issues.

LetterBloxd is free, open source and unofficial. It is not affiliated with or endorsed by Letterboxd.

**Category**
Social & Communication *(closest fit for a film-tracking social site; Fun is the alternative)*

**Single Purpose**
Lets you mark films on Letterboxd as "not interested" and hide or fade them while browsing.

**Primary Language**
English

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|-------|-----------|--------|----------|
| Store Icon | 128×128 PNG | ✅ Ready | icons/icon128.png |
| Screenshot 1 | 1280×800 | ✅ Ready | store-assets/screenshot-1.png |
| Screenshot 2 | 1280×800 | ⬜ Recommended | store-assets/screenshot-2.png |
| Screenshot 3 | 1280×800 | ⬜ Recommended | store-assets/screenshot-3.png |
| Small Promo Tile | 440×280 | ✅ Ready | store-assets/promo-small-440x280.png |
| Marquee Promo Tile | 1400×560 | ✅ Ready | store-assets/promo-marquee-1400x560.png |

### Screenshot Notes
1. A film grid in Fade mode: a few faded posters with the white ⃠, plus seen / loved / watchlist badges.
2. The eye menu open, showing Show / Fade / Hide not interested and Show status badges.
3. A film page with "Block" beside Watch / Like / Watchlist.

## Permissions Justification

| Permission | Type | Justification |
|------------|------|---------------|
| `https://letterboxd.com/*` | content script match (shows as host access) | Adds the Not interested button, watchlist button, status badges and Show/Fade/Hide filter to Letterboxd pages, and updates the user's own private "Not Interested" list and watchlist on Letterboxd when they click those buttons. The extension runs on no other site. |

No other permissions are requested (no tabs, storage, cookies, history or all-sites access). Since 1.3.0 the package includes a background service worker; it needs no permissions and only forwards feedback the user chooses to send to the developer's Google Form.

**Remote code:** No. All code is bundled in the package; the extension only exchanges data (not code) with letterboxd.com and, for feedback the user sends, docs.google.com.

## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** Only feedback the user chooses to send (since 1.3.0). Tick **Personal communications**.

What it handles, for the record (all stays between the user's browser and their own Letterboxd account):

| Data Type | Collected by developer? | Transmitted Off-Device? | Purpose | Shared with Third Parties? |
|-----------|-----------|------------------------|---------|---------------------------|
| Personally identifiable info | No | No | — | No |
| Health info | No | No | — | No |
| Financial info | No | No | — | No |
| Authentication info | No | No (uses the existing Letterboxd sign-in; never reads or stores passwords) | — | No |
| Personal communications | **Yes**, only when the user types feedback and presses Enter | To the developer's Google Form (with version, browser, page type and LetterBloxd settings) | Fixing bugs and improving the extension | No |
| Location | No | No | — | No |
| Web history | No | No | — | No |
| User activity | No | Only to letterboxd.com, at the user's request (films they mark) | Updating the user's own list and watchlist | No |
| Website content | No | No | Reads Letterboxd pages to place buttons and badges | No |

**Judgment call:** feedback text is the one thing that reaches the developer, so tick "Personal communications". Version, browser, page type and settings are technical details with no matching category; they are disclosed in the privacy policy. If a reviewer pushes back, also tick "User activity".

### Data Use Certification
- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

## Privacy Policy

**Privacy Policy URL:** https://github.com/if-iferror/letterbloxd/blob/main/PRIVACY.md

## Distribution

**Visibility**: Public
**Regions**: All regions

## Developer Info

**Publisher Name**: IF_IFERROR (non-trader). Update the publisher display name in the dashboard Settings to match.
**Contact Email**: if.iferror@gmail.com (shown publicly; Google sends review and policy notices here)
**Support URL**: https://github.com/if-iferror/letterbloxd/issues
**Homepage URL**: https://github.com/if-iferror/letterbloxd

## Version History

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| 1.3.0 | 2026-10-10 | Renamed to LetterBloxd with a new icon; film-page button is now "Block"; Badges choice (Icons / Ratings / Off); hover buttons sized to large posters; watchlist button in Letterboxd's hover bar; feedback bar with Ko-fi link; Firefox support. | Ready |
| 1.2.1 | 2026-10-06 | Compact filter menu (Show · Fade · Hide · Only), instant Watched / Liked / Watchlist filters, independent coloured fades, rating pill in place of "…", red ⃠ when selected, matching poster corners. | Draft |
| 1.0.0 | 2026-10-04 | First public release: Not interested button and filter, one-click watchlist, status badges, coloured fades, auto-undo, watched-removes-from-watchlist. | Submitted |

## Review Notes

### Known Issues / Limitations
- Depends on Letterboxd's current page structure; a redesign may need an update.
- Page totals (e.g. "1,234 films") still count hidden films.
- The ad-blocker pop-up remover exists only in the developer's personal build; it is not in the published package.

### Rejection History
None yet.
