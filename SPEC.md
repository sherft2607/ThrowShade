# throwShade — Product Spec

**Status:** Hackathon build v0.9 · **Date:** 2026-09-26

> throwShade: a mobile app for logging, rating and sharing the buildings you visit, like Beli for architecture.

---

## 1. Overview

throwShade is a phone app for logging and sharing opinions on the buildings you visit. Every building a person visits goes into a personal log with a 1–5 star rating. Friends' logs become a way to discover architecture worth seeing.

The UX borrows from **Beli**, the restaurant app: a friends feed, Been / Want to Visit lists, a map and clean building cards. The visual design follows `Throwing Shade — Screen Map.html` (see §9).

- **Form:** a local web app sized for a phone, recorded for the demo in browser device mode. It is not published to the App Store or Google Play.
- **Context:** started at AEC Tech Chicago Hackathon 2026; designed and built by Shandon Herft.

## 2. Hackathon goal

The recorded demo shows this flow end to end:

1. Sign in.
2. Find a building (search, or nearby).
3. Rate it 1–5 stars, add a note and a photo.
4. See it in your Been list, on the map and in a friend's feed.
5. Open a friend's log and save that building to Want to Visit.

## 3. Decisions made

| Topic | Decision |
| --- | --- |
| Rating | 1–5 whole stars per log, plus optional "what stood out" chips (Design, Material, Structure, Facade, Light, Space, Interior, Detail, Craft, Context, Landscape, Views, Scale, Vibes, Engineering, Sustainability). No ranking. |
| Feed | Shows exactly what the person posted: stars, their critique, the chips they picked, and their own photos (0–4). No stock images. |
| Place types | Buildings, bridges, art (sculpture, murals, installations) and spots (parks, squares, fountains, piers). |
| Profiles | All profiles and logs are public. No private profiles, no follow approval, no private notes. |
| Architect verification | Left out. |
| Platform | Local web app, phone-sized. No native build and no backend. |
| Design | Minimal restyle of the mockups' layout with icons (§9); spec features win where the mockups differ (no ranks, head-to-head or trails). |

## 4. Core loop

```
 Visit ──► Log + rate ──► Share to feed ──► Discover next
   ▲                                             │
   └────── saved to Want to Visit ◄──────────────┘
```

## 5. Navigation

Five bottom tabs, with the mockups' square icons and a black centre "+".

| Tab | Route | Purpose |
| --- | --- | --- |
| Home | `#/feed` | Feed, with the wordmark |
| Lists | `#/lists` | Want to Visit and your custom (shared) lists |
| Search (centre) | `#/find` | Two tabs, each searched on its own: **Architecture** (places, architects, cities; + on a result rates it) and **Users** (all users, with Follow) |
| Map | `#/map` | Map of places with type and status filters; drop a pin to add a place |
| You | `#/me` | Your profile |

Other routes: `#/find` (search places and people), `#/b/<id>` (place), `#/u/<id>` (someone's profile), `#/save/<id>` (save sheet), `#/list/<id>` and `#/list/<id>/invite`, `#/newlist`, `#/followers/<id>`, `#/following/<id>`, `#/editprofile`, `#/pin/<lat>,<lng>`, `#/signin`.

## 6. Screens

| Screen | What it shows |
| --- | --- |
| Sign in | Wordmark; create a user (display name + handle) or continue as a seeded critic |
| Feed | Exactly what each person posted: avatar, "@maya rated **Salk Institute**", stars, critique, chosen aspects, their own photos; Save / Details |
| Map | Filter pills (All / Buildings / Bridges / Art / Spots, then Been / Want to Visit / Friends' picks); greyscale map; pins coloured by style (filled = been, ring = want); style legend; Locate; **Pin** (or long-press) to add a building; bottom building card |
| What's here? (pin) | Mini map + coordinates; buildings already in the app within 120 m; OpenStreetMap buildings at the spot (name, type, address, Wikipedia badge); "+ Name it yourself" form (name, architect, year, style) → rate it |
| Find | Search field; Buildings tab (nearby when empty) and People tab with Follow buttons |
| Log 1/2 — Throw Shade | Bottom sheet: search + nearby buildings with distance |
| Log 2/2 — Your critique | Five star buttons with caption (Throwing shade → Pilgrimage-worthy), "What stood out?" aspect chips, date visited, up to 4 photos, 280-character critique, Post; Delete when editing |
| Building | Photo (user's, else Wikimedia Commons with credit line), name, architect · year · typology · city, style chip, community rating and your rating overlaid on the photo's bottom-right, fact icons, what people like (tags with counts), Throw Shade, Save, Directions, About (Wikipedia intro, address, coordinates, links to Wikipedia / OpenStreetMap / ArchDaily search / Dezeen search), Critiques / Photos tabs |
| Lists | Want to Visit (private) plus custom lists, each with a thumbnail, place count and member avatars; "+" to create a list |
| Save sheet | "Save" on any feed post or place opens it: tick Want to Visit or any of your lists, or create a new list and invite people inline |
| List | Places with who added them; members row; invite sheet (members can view and add places) |
| Profile | Avatar (tap to change photo), edit profile, stats (Logged, Cities, Followers, Following → lists), then two tabs: **Critiques** (a "Where you've been" map styled like the Map tab, with clustered style-coloured pins, a card for the tapped place and a heatmap toggle, then full critique cards) and **Stats** (level with XP bar and streak, badges, Wrapped, friend leaderboard); on your own profile a Dark mode switch (opt-in: always light unless switched on, never follows the system; remembered per device) |

## 7. Data

Everything lives in the browser's `localStorage` under the key `throwingshade.v1`.

| Collection | Fields |
| --- | --- |
| `users` | id, handle, name, bio |
| `follows` | [followerId, followeeId] |
| `visits` | id, userId, buildingId, stars (1–5), note, likes (aspect names), photos (0–4 resized JPEG data URLs), visitedOn, createdAt |
| `want` | userId, buildingId, createdAt |
| `lists` | id, name, ownerId, members (user ids), items [{buildingId, addedBy, createdAt}], createdAt |
| `places` | Places users pinned: id (`osm-way-…` or `pin-…`), kind, name, architect, year, typology, style, city, country, lat, lng, address, osm, qid, image, credit, blurb, wiki, source (`osm` / `user`), addedBy, createdAt |

- Buildings are static in `app/data.js` (59 buildings, weighted to New York).
- One visit per user per building; logging again updates it and moves it to the top of feeds.
- Logging a building removes it from your Want to Visit list.
- New users follow every seeded critic, and the critics follow them back, so a new log shows up in their feeds straight away.
- If a photo overflows storage, the log saves without the photo.

## 8. Building data

Three sources, merged at load in `app.js`:

| Source | What | How |
| --- | --- | --- |
| `app/data.js` | 59 hand-picked landmarks worldwide, seeded critics and their logs | Hand-written |
| `app/wikidata.js` | 568 Chicago-area places: 366 buildings, 58 bridges, 68 artworks, 76 spots (+ Wikidata photos/intros for 57 of the hand-picked landmarks) | Generated by `tools/fetch_wikidata.py` |
| `state.places` | Buildings users add by dropping a pin | OpenStreetMap at runtime |

**Import (`tools/fetch_wikidata.py`).** Queries Wikidata for everything with a named architect within `--radius` km of `TS_DEMO_LOCATION`, plus up to `--per-kind` bridges, artworks and spots by Wikidata class (bridge; sculpture, statue, mural, installation, public art; park, square, fountain, pier, garden), plus (optionally) the most notable buildings worldwide (`--global N`). It adds photo credits from the Commons API and 2-sentence intros from the Wikipedia API. Hand-picked buildings are pinned via their Wikipedia article titles. Responses are cached in `tools/.cache/`, and the script backs off when Wikimedia rate-limits it.

```sh
python tools/fetch_wikidata.py --global 0 --local 400 --radius 20 --city Chicago   # Chicago (current)
python tools/fetch_wikidata.py --global 450 --local 400 --radius 20 --city Chicago # + worldwide
```

**Facts (`tools/fetch_facts.py` → `app/facts.js`).** Shown as small icons under a place's name (leaf = sustainability certification, columns = landmark status, medal = awards / Pritzker-winning architect, wheelchair = step-free, ticket = free or paid entry, clock = hours) and listed with sources in About under "Recognition & access".

| Fact | Source |
| --- | --- |
| Landmark status (National Register, National Historic Landmark, Chicago Landmark, UNESCO …) | Wikidata P1435 |
| Awards | Wikidata P166 on the building |
| Pritzker Prize architect (with year) | Wikidata P166 = Q133160 on the architect |
| Step-free access, entry fee, opening hours, website | OpenStreetMap tags on the element with the same Wikidata id |
| Sustainability certifications (LEED, WELL, Passive House, BREEAM …) | Hand-checked only (`TS_CERTS` / `leed` in `app/data.js`); no made-up ratings |

**Drop a pin (runtime).**
1. Overpass API: buildings within 25 m of the pin, named buildings within 90 m, plus artworks, bridges, parks, squares, fountains, piers and attractions nearby; each result is tagged building / bridge / art / spot. Two public servers, 12 s timeout each.
2. Nominatim reverse geocode in parallel: the address and city, and the fallback candidate if Overpass fails.
3. Picking an OSM building reuses an existing entry if it has the same OSM id, the same Wikidata id, or a similar name within 80 m. Otherwise it creates a new building.
4. If OSM links the building to Wikidata/Wikipedia, the app fetches the photo, intro, year and Commons credit. It ignores Wikidata items without coordinates, which usually means the tag points at a company rather than the building.
5. Lookups are cached per ~10 m in `localStorage`, and "Name it yourself" always works, even offline.

**Location.** `TS_DEMO_LOCATION` in `data.js` is the Chicago Loop. `force: true` ignores the device's real location, so the recording looks right wherever it's filmed.

**Licences.** Wikidata is CC0. Wikipedia intros are CC BY-SA, linked from each building. Commons photos show photographer and licence under the hero. OpenStreetMap data is ODbL and credited on the map. ArchDaily and Dezeen have no public API, so the app only links to their search pages.

## 9. Visual design

Minimal, built on the layout of `Throwing Shade — Screen Map.html`.

- **Brand:** the name is **throwShade**, written in camel case as a bold wordmark. "Throw Shade" stays as the verb on the log button.
- **Type:** IBM Plex Sans (bundled in `app/fonts`).
- **Colour:**
  - Ink `#1c1c1e` on white, with greys `#6e6e73` / `#a1a1a6` and hairlines `#ececea`.
  - Other colour comes only from photos, the style palette on pins, chips and hatching, and the blue "you are here" dot.
- **Surfaces:**
  - No cards and no shadows on content. Feed items and list rows are separated by hairlines.
  - Stat boxes use a faint fill.
  - Shadows are kept only for floating elements: map controls, the map card, the log sheet and toasts.
- **Controls:**
  - Outlined 10px buttons with one solid black primary button per screen, pill filters, and text-style feed actions ("Want to visit", "Details").
  - A flat bottom nav with a black "+".
  - No Feed/Map toggle; Map is a nav tab.
- **Icons:** inline line icons after Lucide (ISC licence) in `app.js` (`icon(name)`).
- **Map:** greyscale OpenStreetMap tiles with style-coloured pins (filled = been, ring = want).

## 10. Tech

| Layer | Choice |
| --- | --- |
| App | Vanilla HTML/CSS/JS, no build step (`app/index.html`, `styles.css`, `app.js`, `data.js`) |
| Routing | Hash routes |
| Storage | `localStorage` |
| Map | Leaflet 1.9.4 from unpkg + OpenStreetMap tiles (needs internet) |
| Building data | Wikidata SPARQL (build time), Wikipedia + Commons APIs, Overpass + Nominatim (runtime) |
| Run | Any static server, e.g. `python -m http.server 5173` in `app/` |

## 11. Demo checklist

- [ ] `TS_DEMO_LOCATION` is the Chicago Loop with `force: true`; re-run the import if the demo city changes.
- [ ] Rehearse a pin drop on a building that isn't in the list; have one "Name it yourself" spot ready in case Overpass is slow.
- [ ] Record in Chrome DevTools device mode (iPhone 12/13/14, 390 × 844).
- [ ] Before each take: **You → Reset demo data**, then create a fresh account.
- [ ] Run-through: sign up → Feed → "+" → pick a nearby building → 4★, note, photo → Post → Lists → Map "Been" → You → Switch account to @mara.k → your log is at the top of her feed → back as you, "+ Want to Visit" on a friend's card.
- [ ] Have a photo on the recording machine ready to upload.
- [ ] Record a backup take in case the network drops and map tiles don't load.

## 12. Open questions

- [ ] Run the worldwide import (`--global 450`) once Chicago is signed off.
- [ ] Logo: keep the text wordmark, or design one?
