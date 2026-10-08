# throwShade

**Rate every building you walk into. Find the next one worth the trip.**

throwShade is Beli for architecture: a social app for logging, rating and sharing the buildings, bridges, public art and spaces you visit. You get a personal log, a feed of what your friends actually thought, and a map of the whole world's architecture built on open data. It has no ads and no ranking algorithm.

**Try it:** [shandonherft.com/ThrowShade/app](https://shandonherft.com/ThrowShade/app/) · also packaged as an Android app.

## Screens

| Home | Building | Map |
| --- | --- | --- |
| ![Home feed with stories, Daily Shade and challenges](screenshots/home.jpg) | ![Building page with rating, facts and busyness](screenshots/building.jpg) | ![Map with the "where people go" heatmap](screenshots/map.jpg) |

| Daily Shade | City Bingo | Architect collection |
| --- | --- | --- |
| ![Daily building guessing game](screenshots/daily-shade.jpg) | ![City Bingo card](screenshots/city-bingo.jpg) | ![Mies van der Rohe collection](screenshots/architect.jpg) |

| Weekly challenges | Profile |
| --- | --- |
| ![Weekly challenges](screenshots/challenges.jpg) | ![Profile with stats and travel map](screenshots/profile.jpg) |

## Features

**Log and discover**
- **Rate anything you visit:** 1–5 stars, a note, "what stood out" tags and up to 4 photos. Photos sync, so your friends see them.
- **Worldwide map:** buildings load live from Wikipedia and Wikidata as you pan. It has style-coloured pins, a filter sheet (been / want / friends, type, rating, styles), a friends layer showing whose face is on which pin, and a heatmap of where people go (app visits plus Wikipedia interest).
- **Search** the app's places and the whole world, with recent searches, a style filter, and **Walk near me**, which plans a short architecture walk with a route map.
- **Camera scan:** point your phone at a building and GPS plus the compass work out which one it is, so you can log it on the spot.
- **Building pages** with photos, Wikipedia intros, landmark status and Pritzker facts, weather, an hour-by-hour **typical busyness** chart, more by the same architect, and what's nearby.

**Social**
- **Feed and stories:** friends' logs with hearts and comments, and 24-hour photo stories with an Instagram-style viewer.
- **Follow suggestions** ranked by taste match, plus a **Head-to-Head** page showing where you clash, where you agree, and what they loved that you haven't seen.
- **Lists:** a private Want to Visit list and shared lists, with crawl routes between their places.
- **Share cards:** story-sized images of a rating or a month, ready for Instagram.

**Play**
- **Daily Shade:** guess the day's building from a zoomed-in photo in five tries, with distance-and-direction hints, streaks and friends' scores.
- **City Bingo:** a 4×4 card of things to find in each city you visit.
- **Weekly challenges:** three new ones every Monday, the same for everyone.
- **Architect collections:** collect everything an architect designed, from Wikidata, and earn Fan, Devotee and Completist badges.
- **Badges, levels, a visit calendar, a monthly recap story, and "On this day" memories.**

**Accounts and privacy**
- Handle and password sign-in, private profiles enforced on the server, password change, account deletion, and rate-limited logins.
- Works offline for pages you've already seen, and installs to the home screen.

## How it's built

| Part | What |
| --- | --- |
| **App** (`app/`) | Plain HTML, CSS and JavaScript with no framework and no build step. A single `app.js` handles routing, views and state. A service worker (`sw.js`) caches it for offline use. Hosted on GitHub Pages. |
| **Backend** (`backend/`) | FastAPI + PostgreSQL on Render (`render.yaml`). It handles accounts and sessions, ratings, follows, lists, photos, comments, hearts, stories and game results. The app polls `GET /state` every 30 seconds while it's open. |
| **Android** | A Trusted Web Activity wrapping the live site. Android verifies it through `/.well-known/assetlinks.json` at the domain root; a copy is kept in `app/.well-known/`. |
| **Open data** | Wikidata, Wikipedia and Wikimedia Commons (places, photos, facts), OpenStreetMap (map tiles, Overpass, Nominatim), and Open-Meteo (weather). |

## Run it locally

**App**
```sh
cd app
python -m http.server 5173
```
Open http://localhost:5173 and use your browser's phone/device mode. By default the app talks to the live backend; to point it somewhere else, set `window.TS_API_BASE` before `app.js` loads.

**Backend** (needs a Postgres database)
```sh
cd backend
pip install -r requirements.txt
export DATABASE_URL=postgresql://user:pass@host/db   # PowerShell: $env:DATABASE_URL = "..."
python seed.py                                       # optional: demo critics and ratings
uvicorn app.main:app --reload --port 8000
```
Then load the app with `window.TS_API_BASE = 'http://localhost:8000'`.

## Deploying

- **App:** every push to `main` publishes `app/` through GitHub Pages. Static files are cache-busted with `?v=` numbers in `app/index.html`; bump them when `app.js` or `styles.css` changes.
- **Backend:** Render deploys `backend/` from `main`. `DATABASE_URL` comes from the Render Postgres database. Tables are created on startup.
- **Moving data between databases:** `python backend/scripts/import_state.py state.json` loads a `GET /state` dump into whatever `DATABASE_URL` points at.

## Building data

- `app/data.js`: hand-picked landmarks worldwide, plus fictional demo critics and their ratings.
- `app/wikidata.js`, `app/facts.js`, `app/seed-photos.js` are generated; don't edit them by hand:
  ```sh
  python tools/fetch_wikidata.py --global 450 --local 400 --radius 20 --city Chicago
  python tools/fetch_facts.py
  python tools/fetch_seed_photos.py
  ```
- Everything else loads live while you use the app.

## Files

| File | What |
| --- | --- |
| `app/index.html` | Shell and asset versions |
| `app/app.js` | Routing, views, state, sync with the backend |
| `app/styles.css` | Design tokens and components (light and dark) |
| `app/sw.js` | Service worker: offline use and caching |
| `app/data.js` | Hand-picked places, demo critics, fallback location |
| `app/wikidata.js`, `app/facts.js`, `app/seed-photos.js` | Generated place data, facts and photos |
| `backend/app/main.py` | API endpoints |
| `backend/app/auth.py` | Password hashing, sessions, login checks |
| `backend/app/db.py` | Postgres connection and schema |
| `backend/app/models.py` | Request and response models |
| `backend/seed.py` | Demo data for a fresh database |
| `tools/` | Wikidata / Wikipedia / Commons / OpenStreetMap import scripts |

## Credits

Designed and built by **Shandon Herft**. It started at AEC Tech Chicago Hackathon 2026.

Place data © Wikidata contributors (CC0); intros from Wikipedia (CC BY-SA); photos from Wikimedia Commons under each file's own licence, credited in the app; maps © OpenStreetMap contributors; weather by Open-Meteo.
