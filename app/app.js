// throwShade — local demo web app. Vanilla JS, hash routing, state in localStorage.
(function () {
  'use strict';

  // Buildings = hand-curated (enriched from Wikidata) + Wikidata imports + places users pinned (state.places).
  const WD = window.TS_WIKIDATA || { enrich: {}, buildings: [] };
  const BUILDINGS = window.TS_BUILDINGS.map(b => Object.assign({}, b, WD.enrich[b.id] || {})).concat(WD.buildings);
  const BY_ID = Object.fromEntries(BUILDINGS.map(b => [b.id, b]));
  function registerBuilding(b) {
    if (BY_ID[b.id]) Object.assign(BY_ID[b.id], b);
    else { BUILDINGS.push(b); BY_ID[b.id] = b; }
  }
  const STYLES = window.TS_STYLES;
  const KEY = 'throwingshade.v1';
  const HOUR = 3600e3;
  const DAY = 24 * HOUR;
  const INK = '#1f1f1f';
  const LINE = '#dcdad4';
  // Theme: opt-in only — light unless Dark mode was switched on in your profile; never follows the system.
  const THEME_KEY = 'throwingshade.theme';
  function currentTheme() {
    let t = null;
    try { t = localStorage.getItem(THEME_KEY); } catch (e) { /* storage blocked */ }
    return t === 'dark' ? 'dark' : 'light';
  }
  function applyTheme(t) {
    document.documentElement.dataset.theme = t;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = t === 'dark' ? '#121213' : '#ffffff';
  }
  applyTheme(currentTheme());
  const STAR_WORDS = ['', 'Throwing shade', 'Not for me', 'It’s fine', 'Loved it', 'Pilgrimage-worthy'];
  // What a rater liked — toggled as chips in the log sheet, shown on the feed and summed per place.
  const ASPECTS = ['Design', 'Material', 'Structure', 'Facade', 'Light', 'Space', 'Interior', 'Detail', 'Craft',
    'Context', 'Landscape', 'Views', 'Scale', 'Vibes', 'Engineering', 'Sustainability'];
  const KINDS = { building: 'Building', bridge: 'Bridge', art: 'Art', spot: 'Spot' };
  const kindOf = b => b.kind || 'building';
  const MAX_PHOTOS = 4;
  // Illustrated profile pictures offered in Edit profile (app/avatars/avatar_01.png … _32.png).
  const PRESET_AVATARS = Array.from({ length: 32 }, (_, i) => 'avatars/avatar_' + String(i + 1).padStart(2, '0') + '.png');
  // Facts shown as small icons on a place and explained in About: certifications (hand-checked, app/data.js),
  // landmark status / awards / Pritzker architects (Wikidata) — see tools/fetch_facts.py.
  const HERITAGE_NAMES = {
    'National Register of Historic Places listed place': 'National Register of Historic Places',
    'National Register of Historic Places contributing property': 'National Register (contributing property)',
    'part of UNESCO World Heritage Site': 'Part of a UNESCO World Heritage Site',
    'Tentative World Heritage Site': 'UNESCO World Heritage tentative list',
    'New York State Register of Historic Places listed place': 'New York State Register of Historic Places',
  };
  function factsFor(b) {
    const f = (window.TS_FACTS || {})[b.id] || {};
    const certs = [...(f.certs || []), ...(b.leed ? ['LEED ' + b.leed] : []), ...((window.TS_CERTS || {})[b.id] || [])];
    return {
      certs: [...new Set(certs)],
      heritage: (f.heritage || []).map(h => HERITAGE_NAMES[h] || h),
      awards: f.awards || [],
      pritzker: f.pritzker || [],
    };
  }
  // One small icon per kind of recognition; the title explains it, a tap scrolls to the details in About.
  function factIcons(b, size) {
    const f = factsFor(b), out = [];
    const add = (name, title) => out.push(`<span class="fact-ic ${size || ''}" title="${esc(title)}" aria-label="${esc(title)}">${icon(name, 'sm')}</span>`);
    if (f.certs.length) add('leaf', f.certs.join(' · '));
    if (f.heritage.length) add('landmark', f.heritage.join(' · '));
    if (f.awards.length || f.pritzker.length) add('award', [...f.awards, ...f.pritzker.map(p => `Pritzker Prize architect: ${p.name}`)].join(' · '));
    return out.join('');
  }
  function factsHTML(b) {
    const f = factsFor(b), rows = [];
    const row = (ic, label, value) => rows.push(`<div class="fact-row">${icon(ic, 'sm')}<div><div class="caps">${label}</div><div class="small">${value}</div></div></div>`);
    if (f.certs.length) row('leaf', 'Sustainability', esc(f.certs.join(' · ')));
    if (f.heritage.length) row('landmark', 'Landmark status', esc(f.heritage.join(' · ')));
    if (f.awards.length) row('award', 'Awards', esc(f.awards.join(' · ')));
    if (f.pritzker.length) row('award', 'Pritzker Prize architect', esc(f.pritzker.map(p => p.name + (p.year ? ` (${p.year})` : '')).join(' · ')));
    if (!rows.length) return '';
    const src = [(f.heritage.length || f.awards.length || f.pritzker.length) && 'Wikidata', f.certs.length && 'certifying bodies (hand-checked)'].filter(Boolean);
    return `<div id="facts" class="facts"><div class="bold">Recognition</div>${rows.join('')}<div class="tiny muted">Sources: ${src.join(' · ')}</div></div>`;
  }

  // ---------- Backend sync ----------
  // Best-effort mirror of writes to the FastAPI/SQLite backend (backend/).
  // The app stays fully local-first and offline-capable: every call here is
  // fire-and-forget and swallows its own errors, so a slow or absent backend
  // never blocks a render. Comments, activity, badges/levels and Wrapped stay
  // client-only — the backend doesn't model them.
  const API_BASE = window.TS_API_BASE || 'https://throwshade.onrender.com';
  // Signed-in session: a bearer token from /auth/login or /auth/signup, kept on this device.
  const TOKEN_KEY = 'throwingshade.token';
  let authToken = null;
  try { authToken = localStorage.getItem(TOKEN_KEY); } catch (e) { /* storage blocked: sign in each visit */ }
  function setToken(t) {
    authToken = t;
    try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ }
  }
  function sessionLost() {
    if (!authToken) return;
    setToken(null); state.me = null; save();
    toast('Please sign in again'); go('#/signin');
  }
  function authCall(path, body) {
    return fetch(API_BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(async r => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(typeof j.detail === 'string' ? j.detail : 'Check your details and try again');
        return j;
      });
  }
  function apiFetch(path, opts, attempt) {
    attempt = attempt || 1;
    const headers = { 'Content-Type': 'application/json' };
    if (authToken) headers.Authorization = 'Bearer ' + authToken;
    return fetch(API_BASE + path, Object.assign({ headers, cache: 'no-store' }, opts))
      .then(r => {
        if (r.status === 401) { sessionLost(); return r; }
        // Retry server hiccups (Render waking up), not requests the server rejected.
        if (r.status >= 500 && attempt < 4) return new Promise(res => setTimeout(() => res(apiFetch(path, opts, attempt + 1)), attempt * 2000));
        return r;
      })
      .catch(e => {
        if (attempt < 4) return new Promise(res => setTimeout(() => res(apiFetch(path, opts, attempt + 1)), attempt * 2000));
        console.warn('[throwShade] backend unreachable after retries:', e.message);
        return null;
      });
  }
  const sync = {
    postStory(st) {
      return apiFetch('/stories', { method: 'POST', body: JSON.stringify({ user_id: st.userId, place_id: st.buildingId || null, image: st.image, caption: st.caption || null }) })
        .then(r => r && r.ok ? r.json() : null);
    },
    deleteStory(id) { return apiFetch(`/stories/${encodeURIComponent(id)}?user_id=${encodeURIComponent(state.me)}`, { method: 'DELETE' }); },
    updateUser(u) { return apiFetch('/users/' + encodeURIComponent(u.id), { method: 'PUT', body: JSON.stringify({ handle: u.handle, name: u.name, bio: u.bio, private: !!u.private }) }); },
    // Photos go up one at a time (uploadPhoto) and the visit carries only their paths.
    upsertVisit(v) {
      const photos = (v.photos || []).filter(ph => !ph.startsWith('data:')).map(photoPath).slice(0, 4);
      return apiFetch('/visits', { method: 'POST', body: JSON.stringify({ user_id: v.userId, place_id: v.buildingId, stars: v.stars, note: v.note, likes: v.likes, photos, visited_on: v.visitedOn }) });
    },
    uploadPhoto(placeId, image) {
      return apiFetch('/photos', { method: 'POST', body: JSON.stringify({ place_id: placeId, image }) }).then(r => r && r.ok ? r.json() : null);
    },
    postComment(v, text) {
      return apiFetch('/comments', { method: 'POST', body: JSON.stringify({ visit_user_id: v.userId, place_id: v.buildingId, text }) }).then(r => r && r.ok ? r.json() : null);
    },
    deleteVisit(userId, buildingId) { return apiFetch(`/visits?user_id=${encodeURIComponent(userId)}&place_id=${encodeURIComponent(buildingId)}`, { method: 'DELETE' }); },
    follow(a, b) { return apiFetch('/follows', { method: 'POST', body: JSON.stringify({ follower_id: a, followee_id: b }) }); },
    unfollow(a, b) { return apiFetch(`/follows?follower_id=${encodeURIComponent(a)}&followee_id=${encodeURIComponent(b)}`, { method: 'DELETE' }); },
    want(userId, buildingId) { return apiFetch('/want', { method: 'POST', body: JSON.stringify({ user_id: userId, place_id: buildingId }) }); },
    unwant(userId, buildingId) { return apiFetch(`/want?user_id=${encodeURIComponent(userId)}&place_id=${encodeURIComponent(buildingId)}`, { method: 'DELETE' }); },
    createPlace(b) {
      return apiFetch('/places', { method: 'POST', body: JSON.stringify({
        id: b.id, kind: kindOf(b), name: b.name, architect: b.architect || null, year: b.year || null,
        typology: b.typology || null, style: b.style || null, city: b.city || null, country: b.country || null,
        lat: b.lat, lng: b.lng, address: b.address || null, osm: b.osm || null, qid: b.qid || null, image: b.image || null, wiki: b.wiki || null, added_by: b.addedBy || null,
      }) });
    },
    createList(l) { return apiFetch('/lists', { method: 'POST', body: JSON.stringify({ id: l.id, name: l.name, owner_id: l.ownerId }) }); },
    addListItem(listId, buildingId, addedBy) { return apiFetch(`/lists/${encodeURIComponent(listId)}/items`, { method: 'POST', body: JSON.stringify({ place_id: buildingId, added_by: addedBy }) }); },
    removeListItem(listId, buildingId) { return apiFetch(`/lists/${encodeURIComponent(listId)}/items?place_id=${encodeURIComponent(buildingId)}`, { method: 'DELETE' }); },
  };
  // Builds the same shape as seed()/load() from GET /state, so a browser with
  // no local save yet can hydrate from the shared backend instead of always
  // reseeding its own independent copy of app/data.js.
  // GET /state already returns the frontend's camelCase shape (see get_state in backend/app/main.py),
  // with follows as [followerId, followeeId] pairs.
  // The backend sends ISO strings; the app compares and subtracts timestamps, so keep them as numbers.
  const tsOf = t => typeof t === 'number' ? t : (Date.parse(t) || 0);
  function normList(l) { l.createdAt = tsOf(l.createdAt); (l.items || []).forEach(i => { i.createdAt = tsOf(i.createdAt); }); return l; }
  // Log photos uploaded to the backend are stored as "/photos/<id>" and shown from API_BASE.
  const photoSrc = ph => typeof ph === 'string' && ph.startsWith('/photos/') ? API_BASE + ph : ph;
  const photoPath = ph => typeof ph === 'string' && ph.startsWith(API_BASE + '/photos/') ? ph.slice(API_BASE.length) : ph;
  const normStory = st => Object.assign({}, st, { createdAt: tsOf(st.createdAt) });
  function mapVisit(v) {
    return { id: v.id, userId: v.userId, buildingId: v.buildingId, stars: v.stars, note: v.note, likes: v.likes || [], photos: (v.photos || []).map(photoSrc), visitedOn: v.visitedOn, createdAt: tsOf(v.createdAt) };
  }
  function mapWant(w) { return { userId: w.userId, buildingId: w.buildingId, createdAt: tsOf(w.createdAt) }; }
  function buildStateFromBackend(data) {
    const pinned = data.places.filter(p => p.source !== 'seed');
    pinned.forEach(registerBuilding);
    const users = data.users.slice();
    const follows = data.follows.map(f => [f[0], f[1]]);
    return { me: null, users, follows, visits: data.visits.map(mapVisit), want: data.want.map(mapWant), places: pinned, lists: data.lists.map(normList), stories: (data.stories || []).map(normStory), storySeen: {}, activity: [], activitySeen: {} };
  }
  // Pulls anything new from the shared backend into the existing local state,
  // without clobbering local-only data (e.g. the seeded demo content).
  // Comments live on the backend keyed by (log owner, place). Attach them to the matching logs, keep
  // any of ours still sending, and raise an activity item for new comments on your own logs.
  function attachComments(data) {
    if (!data.comments) return;
    // Notify for comments newer than the last sync (remembered across visits); the very first sync just catches up.
    const since = state.commentsSeenAt;
    const byKey = {}, onServer = new Set(data.users.map(u => u.id));
    data.comments.forEach(c => { (byKey[c.visitUserId + '|' + c.buildingId] = byKey[c.visitUserId + '|' + c.buildingId] || []).push({ id: c.id, userId: c.userId, text: c.text, createdAt: tsOf(c.createdAt) }); });
    state.visits.forEach(v => {
      if (!onServer.has(v.userId)) return;
      const known = new Set((v.comments || []).map(c => c.id));
      const server = byKey[v.userId + '|' + v.buildingId] || [];
      if (since && v.userId === state.me) server.forEach(c => {
        if (!known.has(c.id) && c.userId !== state.me && c.createdAt > since) logActivity(state.me, 'comment', { fromUid: c.userId, visitId: v.id, buildingId: v.buildingId });
      });
      v.comments = server.concat((v.comments || []).filter(c => c.pending));
    });
    state.commentsSeenAt = Math.max(since || 0, ...data.comments.map(c => tsOf(c.createdAt)), 1);
  }
  // Hearts: who loved a log. Kept as user ids on the log; new hearts on your logs raise activity.
  function attachHearts(data) {
    if (!data.hearts) return;
    const byKey = {}, onServer = new Set(data.users.map(u => u.id)), since = state.heartsSeenAt;
    data.hearts.forEach(h => { (byKey[h.visitUserId + '|' + h.buildingId] = byKey[h.visitUserId + '|' + h.buildingId] || []).push(h); });
    state.visits.forEach(v => {
      if (!onServer.has(v.userId)) return;
      const list = byKey[v.userId + '|' + v.buildingId] || [];
      if (since && v.userId === state.me) list.forEach(h => {
        if (h.userId !== state.me && tsOf(h.createdAt) > since) logActivity(state.me, 'heart', { fromUid: h.userId, visitId: v.id, buildingId: v.buildingId });
      });
      v.hearts = list.map(h => h.userId);
    });
    state.heartsSeenAt = Math.max(since || 0, ...data.hearts.map(h => tsOf(h.createdAt)), 1);
  }
  function mergeStateFromBackend(data) {
    // Stories expire server-side, so take the backend's list wholesale, plus any of ours still uploading.
    if (data.stories) state.stories = data.stories.map(normStory).concat((state.stories || []).filter(st => st.pending));
    data.places.filter(p => p.source !== 'seed').forEach(p => {
      if (!state.places.find(x => x.id === p.id)) { state.places.push(p); registerBuilding(p); }
    });
    // New people are added; existing ones pick up profile changes (name, bio, private), keeping local-only fields like photo.
    data.users.forEach(u => { const local = state.users.find(x => x.id === u.id); if (local) Object.assign(local, u); else state.users.push(u); });
    // Earlier builds merged visits/follows with the wrong field names, leaving entries with an
    // undefined user or building in saved state; drop those so the backend copy can replace them.
    state.visits = state.visits.filter(x => x.userId && x.buildingId);
    state.follows = state.follows.filter(x => x[0] && x[1]);
    state.want = state.want.filter(x => x.userId && x.buildingId);
    data.visits.forEach(v => {
      const incoming = mapVisit(v);
      // The backend upserts one visit per (user, place) — match on that so re-rates update in place.
      const local = state.visits.find(x => x.id === v.id || (x.userId === v.userId && x.buildingId === v.buildingId));
      if (!local) state.visits.push(incoming);
      else if (local.userId !== state.me && incoming.createdAt > tsOf(local.createdAt)) {
        // Keep local-only fields (photos, comments) — the backend doesn't store them.
        Object.assign(local, { stars: incoming.stars, note: incoming.note, likes: incoming.likes, visitedOn: incoming.visitedOn, createdAt: incoming.createdAt, photos: incoming.photos });
      } else if (local.userId !== state.me && incoming.photos.length && !local.photos.some(ph => incoming.photos.includes(ph))) {
        local.photos = incoming.photos;
      } else if (local.userId === state.me && !(local.photos || []).length && incoming.photos.length) {
        local.photos = incoming.photos;
      }
    });
    data.follows.forEach(f => {
      if (!state.follows.find(x => x[0] === f[0] && x[1] === f[1])) state.follows.push([f[0], f[1]]);
    });
    data.want.forEach(w => {
      if (!state.want.find(x => x.userId === w.userId && x.buildingId === w.buildingId)) state.want.push(mapWant(w));
    });
    data.lists.forEach(l => { if (!state.lists.find(x => x.id === l.id)) state.lists.push(normList(l)); });
  }

  // ---------- Store ----------
  let state = load();
  const freshInstall = !state;
  if (!state) state = seed();
  state.places.forEach(registerBuilding);
  // Saves from before tsOf may hold string timestamps.
  state.visits.forEach(v => { v.createdAt = tsOf(v.createdAt); });
  state.want.forEach(w => { w.createdAt = tsOf(w.createdAt); });
  state.lists.forEach(normList);
  state.stories = state.stories || [];
  state.storySeen = state.storySeen || {};
  // Older saves stored a single `photo` per log and no liked aspects.
  state.visits.forEach(v => {
    if (!v.photos) v.photos = v.photo ? [v.photo] : [];
    delete v.photo;
    if (!v.likes) v.likes = [];
    // "Concept" and "Atmosphere" were folded into "Vibes".
    v.likes = [...new Set(v.likes.map(l => (l === 'Concept' || l === 'Atmosphere' ? 'Vibes' : l)))];
  });
  // Earlier builds shipped demo critics, their logs and two demo lists: saved to every device and
  // seeded into the backend (backend/scripts/remove_demo_data.py clears them there). dropDemo strips
  // them from a saved state or a GET /state payload (same field names); real people's data is untouched.
  const DEMO_USERS = new Set(['u-mara', 'u-theo', 'u-priya', 'u-jonah', 'u-noor', 'u-shandon', 'u-felix', 'u-lena']);
  const DEMO_LISTS = new Set(['l-mies', 'l-bridges']);
  function dropDemo(s) {
    const keep = (key, ok) => { if (Array.isArray(s[key])) s[key] = s[key].filter(ok); };
    keep('users', u => !DEMO_USERS.has(u.id));
    keep('visits', v => !DEMO_USERS.has(v.userId));
    keep('follows', f => !DEMO_USERS.has(f[0]) && !DEMO_USERS.has(f[1]));
    keep('want', w => !DEMO_USERS.has(w.userId));
    keep('lists', l => !DEMO_LISTS.has(l.id) && !DEMO_USERS.has(l.ownerId));
    (s.lists || []).forEach(l => { l.members = (l.members || []).filter(m => !DEMO_USERS.has(m)); });
    keep('stories', st => !DEMO_USERS.has(st.userId));
    keep('comments', c => !DEMO_USERS.has(c.userId) && !DEMO_USERS.has(c.visitUserId));
    keep('hearts', h => !DEMO_USERS.has(h.userId) && !DEMO_USERS.has(h.visitUserId));
    keep('activity', a => !DEMO_USERS.has(a.forUid) && !(a.data && DEMO_USERS.has(a.data.fromUid)));
  }
  if (!state.demoRemoved) {
    dropDemo(state);
    delete state.seedPhotos;
    state.demoRemoved = true;
    save();
  }

  // A fresh device starts empty; people, logs and lists all come from the backend (pullFromBackend).
  function seed() {
    return { me: null, users: [], follows: [], visits: [], want: [], places: [], lists: [], stories: [], storySeen: {}, activity: [], activitySeen: {}, demoRemoved: true };
  }
  function load() {
    try { const s = JSON.parse(localStorage.getItem(KEY)); return s && s.users ? Object.assign({ places: [], lists: [], activity: [], activitySeen: {} }, s) : null; } catch (e) { return null; }
  }
  function save() {
    // Live map places (loadLivePlaces) aren't bundled, so keep any that a visit, want or list now
    // points at — otherwise they'd vanish on reload and on other devices.
    const used = new Set(state.visits.map(v => v.buildingId).concat(state.want.map(w => w.buildingId),
      ...state.lists.map(l => (l.items || []).map(i => i.buildingId))));
    BUILDINGS.forEach(b => {
      if (b.source === 'live' && used.has(b.id) && !state.places.find(p => p.id === b.id)) {
        b.source = 'user'; state.places.push(b); sync.createPlace(b);
      }
    });
    try { localStorage.setItem(KEY, JSON.stringify(state)); return true; } catch (e) { return false; }
  }

  const user = id => state.users.find(u => u.id === id);
  const me = () => user(state.me);
  const followingIds = uid => new Set(state.follows.filter(f => f[0] === uid).map(f => f[1]));
  const followerCount = uid => state.follows.filter(f => f[1] === uid).length;
  const isFollowing = (a, b) => state.follows.some(f => f[0] === a && f[1] === b);
  const visitsBy = uid => state.visits.filter(v => v.userId === uid);
  const visitsFor = bid => state.visits.filter(v => v.buildingId === bid);
  const myVisit = bid => state.visits.find(v => v.userId === state.me && v.buildingId === bid);
  const isWant = (uid, bid) => state.want.some(w => w.userId === uid && w.buildingId === bid);
  const styleColor = b => STYLES[b.style] || INK;

  function avgFor(bid) {
    const vs = visitsFor(bid);
    if (!vs.length) return { avg: null, n: 0 };
    return { avg: vs.reduce((s, v) => s + v.stars, 0) / vs.length, n: vs.length };
  }
  function topRated(limit) {
    return BUILDINGS.map(b => ({ b, a: avgFor(b.id) }))
      .filter(x => x.a.n > 0)
      .sort((x, y) => y.a.avg - x.a.avg || y.a.n - x.a.n)
      .slice(0, limit || 10);
  }
  // Trending: most-logged places community-wide in the last 7 days.
  function trending(limit) {
    const since = Date.now() - 7 * DAY;
    const counts = {};
    state.visits.forEach(v => { if (v.createdAt >= since) counts[v.buildingId] = (counts[v.buildingId] || 0) + 1; });
    return Object.entries(counts).map(([bid, n]) => ({ b: BY_ID[bid], n }))
      .filter(x => x.b)
      .sort((x, y) => y.n - x.n || (avgFor(y.b.id).avg || 0) - (avgFor(x.b.id).avg || 0))
      .slice(0, limit || 10);
  }
  // Radio: a Spotify-radio-style queue of places similar to one seed — same architect/style/kind/city/era win.
  let radioSeedId = null, radioIdx = 0, radioMap = null;
  function radioQueue(seedId) {
    const seed = BY_ID[seedId];
    if (!seed) return [];
    const distMap = new Map(nearest(BUILDINGS).map(x => [x.b.id, x.d]));
    return BUILDINGS.filter(b => b.id !== seedId).map(b => {
      let score = 0;
      if (b.architect && b.architect === seed.architect) score += 6;
      if (b.style && b.style === seed.style) score += 5;
      if (b.city && b.city === seed.city) score += 3;
      if (kindOf(b) === kindOf(seed)) score += 2;
      if (b.year && seed.year && Math.abs(b.year - seed.year) <= 15) score += 2;
      const d = distMap.has(b.id) ? distMap.get(b.id) : 9999;
      score += Math.max(0, 1 - d / 200);
      return { b, score };
    }).filter(x => x.score > 0).sort((x, y) => y.score - x.score).slice(0, 30).map(x => x.b);
  }
  // Recs: places you haven't logged, ranked by friends' ratings, styles you tend to love, and distance.
  function recsFor(uid, limit) {
    const visited = new Set(visitsBy(uid).map(v => v.buildingId));
    const fids = followingIds(uid);
    const styleTotals = {};
    visitsBy(uid).forEach(v => {
      const b = BY_ID[v.buildingId]; if (!b || !b.style) return;
      (styleTotals[b.style] = styleTotals[b.style] || []).push(v.stars);
    });
    const favStyles = new Set(Object.entries(styleTotals)
      .filter(([, arr]) => arr.reduce((s, n) => s + n, 0) / arr.length >= 4)
      .map(([s]) => s));
    const distMap = new Map(nearest(BUILDINGS).map(x => [x.b.id, x.d]));
    const scored = BUILDINGS.filter(b => !visited.has(b.id)).map(b => {
      const friendVs = visitsFor(b.id).filter(v => fids.has(v.userId));
      const friendAvg = friendVs.length ? friendVs.reduce((s, v) => s + v.stars, 0) / friendVs.length : 0;
      const d = distMap.has(b.id) ? distMap.get(b.id) : 9999;
      let score = 0, reason = null, group = null;
      if (friendAvg >= 4) {
        score += friendAvg * 3; group = 'friends';
        const one = friendVs.length === 1 && user(friendVs[0].userId);
        reason = one ? `@${one.handle} gave it ${friendVs[0].stars}★` : `${friendVs.length} friends loved it`;
      }
      if (!reason && favStyles.has(b.style)) { score += 4; group = 'style:' + b.style; reason = `You tend to love ${b.style}`; }
      if (!reason && d < 3) { score += 2; group = 'nearby'; reason = 'Right nearby'; }
      score += Math.max(0, 2 - d / 15);
      return { b, score, reason, group, d };
    }).filter(x => x.reason);
    scored.sort((x, y) => y.score - x.score);
    // Cap how many any one category can contribute, so friend-based recs (which score highest)
    // don't crowd out every other reason — the point is a mix, not one dominant list.
    const counts = {};
    const capped = scored.filter(x => {
      counts[x.group] = (counts[x.group] || 0) + 1;
      return counts[x.group] <= (x.group === 'friends' ? 6 : 4);
    });
    const L = limit || 12;
    if (capped.length < L) {
      const already = new Set(capped.map(x => x.b.id));
      topRated(40).forEach(x => {
        if (capped.length >= L || (counts.top || 0) >= 4) return;
        if (visited.has(x.b.id) || already.has(x.b.id)) return;
        capped.push({ b: x.b, score: 0, reason: 'Highly rated overall', group: 'top', d: distMap.get(x.b.id) });
        counts.top = (counts.top || 0) + 1;
        already.add(x.b.id);
      });
    }
    return capped.slice(0, L);
  }
  function recGroupLabel(g) {
    if (g.startsWith('style:')) return `More ${g.slice(6)} for you`;
    return { friends: 'Friends loved these', nearby: 'Near you', top: 'Highly rated' }[g] || 'Recommended';
  }
  // Guides: shelves grouped by style, kind, city, architect and decade — built from whatever data
  // already exists. Each shelf carries a dim/key so it can filter the full list ("See all") and so
  // shelves matching the viewer's own taste (styles/architects/cities they've rated well) sort first.
  function buildGuides(uid) {
    const guides = [];
    const push = (dim, key, title, list) => guides.push({ dim, key, title, sub: `${list.length} places`, items: rankByRating(list) });
    const byStyle = {};
    BUILDINGS.forEach(b => { if (b.style) (byStyle[b.style] = byStyle[b.style] || []).push(b); });
    Object.entries(byStyle).filter(([, l]) => l.length >= 3).sort((a, b) => b[1].length - a[1].length).slice(0, 4)
      .forEach(([style, list]) => push('style', style, style, list));
    ['bridge', 'art', 'spot'].forEach(k => {
      const list = BUILDINGS.filter(b => kindOf(b) === k);
      if (list.length) push('kind', k, KINDS[k] + 's', list);
    });
    const byCity = {};
    BUILDINGS.forEach(b => { if (b.city) (byCity[b.city] = byCity[b.city] || []).push(b); });
    const topCity = Object.entries(byCity).sort((a, b) => b[1].length - a[1].length)[0];
    if (topCity && topCity[1].length >= 3) push('city', topCity[0], topCity[0], topCity[1]);
    const byArchitect = {};
    BUILDINGS.forEach(b => { if (b.architect) (byArchitect[b.architect] = byArchitect[b.architect] || []).push(b); });
    Object.entries(byArchitect).filter(([, l]) => l.length >= 3).sort((a, b) => b[1].length - a[1].length).slice(0, 3)
      .forEach(([architect, list]) => push('architect', architect, architect, list));
    const byDecade = {};
    BUILDINGS.forEach(b => { if (b.year) { const d = `${Math.floor(b.year / 10) * 10}s`; (byDecade[d] = byDecade[d] || []).push(b); } });
    Object.entries(byDecade).filter(([, l]) => l.length >= 3).sort((a, b) => b[1].length - a[1].length).slice(0, 3)
      .forEach(([decade, list]) => push('decade', decade, decade, list));
    if (uid) {
      const favs = favoritesOf(uid);
      const isFav = g => favs.has(g.dim + ':' + g.key);
      return guides.filter(isFav).concat(guides.filter(g => !isFav(g)));
    }
    return guides;
  }
  // Dims (style/architect/city) the viewer tends to rate 4★+ on their own visits.
  function favoritesOf(uid) {
    const totals = {};
    visitsBy(uid).forEach(v => {
      const b = BY_ID[v.buildingId]; if (!b) return;
      ['style', 'architect', 'city'].forEach(dim => { if (b[dim]) (totals[dim + ':' + b[dim]] = totals[dim + ':' + b[dim]] || []).push(v.stars); });
    });
    const favs = new Set();
    Object.entries(totals).forEach(([k, arr]) => { if (arr.reduce((s, n) => s + n, 0) / arr.length >= 4) favs.add(k); });
    return favs;
  }
  // Taste compatibility: how closely two people's ratings agree on the places they've both logged.
  function compatibility(a, b) {
    const other = new Map(visitsBy(b).map(v => [v.buildingId, v.stars]));
    const diffs = visitsBy(a).filter(v => other.has(v.buildingId)).map(v => Math.abs(v.stars - other.get(v.buildingId)));
    if (diffs.length < 2) return null;
    const avgDiff = diffs.reduce((s, n) => s + n, 0) / diffs.length;
    return { pct: Math.round(100 - (avgDiff / 4) * 100), n: diffs.length };
  }
  // People you don't follow yet, best first: shared taste, then friends-of-friends, then how active they are.
  function suggestedPeople(n) {
    const fids = followingIds(state.me);
    return state.users.filter(u => u.id !== state.me && !fids.has(u.id)).map(u => {
      const c = compatibility(state.me, u.id);
      const via = [...fids].filter(f => isFollowing(f, u.id)).map(user).filter(Boolean);
      const logged = visitsBy(u.id).length;
      const score = (c ? c.pct * (1 + c.n / 5) : 0) + via.length * 40 + Math.min(logged, 30);
      const why = c ? `${c.pct}% taste match \u00b7 ${c.n} shared place${c.n === 1 ? '' : 's'}`
        : via.length ? `Followed by @${via[0].handle}${via.length > 1 ? ` + ${via.length - 1}` : ''}` : `${logged} place${logged === 1 ? '' : 's'} logged`;
      return { u, score, why };
    }).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, n);
  }
  function rankByRating(list) {
    return list.slice().sort((a, b) => (avgFor(b.id).avg || 0) - (avgFor(a.id).avg || 0));
  }
  // The best taste-match among people you follow, for an auto-suggested rival to compare with.
  function bestRival(uid) {
    let best = null;
    followingIds(uid).forEach(fid => {
      const c = compatibility(uid, fid);
      if (c && (!best || c.pct > best.pct)) best = Object.assign({ uid: fid }, c);
    });
    return best;
  }
  // Achievements: computed fresh from existing data, nothing new to store.
  function badgesFor(uid) {
    const vs = visitsBy(uid).filter(v => BY_ID[v.buildingId]);
    const cities = new Set(vs.map(v => BY_ID[v.buildingId].city).filter(Boolean)).size;
    const countries = new Set(vs.map(v => BY_ID[v.buildingId].country).filter(Boolean)).size;
    const photoLogs = vs.filter(v => v.photos && v.photos.length).length;
    const noteLogs = vs.filter(v => v.note && v.note.trim()).length;
    const lowRatings = vs.filter(v => v.stars <= 2).length;
    const avg = vs.length ? vs.reduce((s, v) => s + v.stars, 0) / vs.length : 0;
    const added = state.places.filter(p => p.addedBy === uid).length;
    const starIcon = `<svg viewBox="0 0 24 24" width="20" height="20"><path d="${STAR_PATH}" fill="currentColor"/></svg>`;
    // Newer features: Daily Shade, City Bingo, architect albums, hearts, comments and stories.
    const own = uid === state.me;
    let dailyStreak = 0;
    if (own && state.game) for (let d = gameDay(); state.game[d] && state.game[d].won; d--) dailyStreak++;
    const bingos = own ? bingoCities().filter(c => bingoLines(bingoCard(c)) > 0).length : 0;
    const archFan = Object.keys(archCache).filter(n => { const w = architectWorks(n), seen = w.filter(x => vs.some(v => v.buildingId === x.id)).length; return archBadge(seen, w.length); }).length;
    const heartsGot = vs.reduce((t, v) => t + (v.hearts || []).filter(h => h !== uid).length, 0);
    const commentsLeft = state.visits.reduce((t, v) => t + (v.comments || []).filter(c => c.userId === uid).length, 0);
    const stories = state.stories.filter(st => st.userId === uid).length;
    const B = (id, label, ic, desc, p, t) => ({ id, label, icon: ic, desc, p: Math.min(p, t), t, earned: p >= t });
    return [
      B('first', 'First Log', icon('check'), 'Log your first place.', vs.length, 1),
      B('regular', 'Regular Critic', icon('edit'), 'Log 10 places.', vs.length, 10),
      B('veteran', 'Veteran Critic', icon('layers'), 'Log 25 places.', vs.length, 25),
      B('centurion', 'Centurion', icon('award'), 'Log 100 places.', vs.length, 100),
      B('jetsetter', 'Jetsetter', icon('navigate'), 'Log places in 5 different cities.', cities, 5),
      B('globe', 'World Traveler', icon('pin'), 'Log places in 3 different countries.', countries, 3),
      B('photog', 'Photographer', icon('camera'), 'Add photos to 5 logs.', photoLogs, 5),
      B('wordsmith', 'Wordsmith', icon('feed'), 'Write notes on 10 logs.', noteLogs, 10),
      B('shade', 'Shade Thrower', icon('x'), 'Rate 5 places 2\u2605 or below.', lowRatings, 5),
      { ...B('superfan', 'Superfan', starIcon, 'Average 4.5\u2605+ across 5 logs.', vs.length >= 5 && avg >= 4.5 ? 1 : 0, 1), p: vs.length >= 5 ? Math.min(avg, 4.5) : vs.length, t: vs.length >= 5 ? 4.5 : 5, prog: vs.length >= 5 ? avg.toFixed(1) + '★ avg' : null },
      B('butterfly', 'Social Butterfly', icon('users'), 'Follow 10 people.', followingIds(uid).size, 10),
      B('influencer', 'Influencer', icon('user'), 'Get 15 followers.', followerCount(uid), 15),
      B('trailblazer', 'Trailblazer', icon('building'), 'Add a place to the map yourself.', added, 1),
      B('loved', 'Crowd Pleaser', icon('heart'), 'Get 10 hearts on your logs.', heartsGot, 10),
      B('chatty', 'Conversationalist', icon('feed'), 'Leave 10 comments.', commentsLeft, 10),
      B('story', 'Storyteller', icon('camera'), 'Post 3 stories.', stories, 3),
      B('daily', 'Daily Devotee', icon('clock'), 'Win Daily Shade 7 days in a row.', dailyStreak, 7),
      B('bingo', 'Bingo!', icon('layers'), 'Get a BINGO in any city.', bingos, 1),
      B('collector', 'Collector', icon('award'), 'Become a Fan of 3 architects.', archFan, 3),
    ];
  }
  // Consecutive weeks (Mon–Sun) with at least one log, counting back from this week.
  function streakWeeks(uid) {
    const vs = visitsBy(uid);
    if (!vs.length) return 0;
    const weekStart = ts => { const d = new Date(ts); const day = (d.getDay() + 6) % 7; d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - day); return d.getTime(); };
    const weeks = new Set(vs.map(v => weekStart(v.createdAt)));
    let streak = 0, cursor = weekStart(Date.now());
    while (weeks.has(cursor)) { streak++; cursor -= 7 * DAY; }
    return streak;
  }
  // Level/title: rough XP from logs + earned badges, mapped to a title band.
  const LEVELS = [[0, 'Newcomer'], [50, 'Regular'], [120, 'Architecture Buff'], [250, 'Critic'], [450, 'Senior Critic'], [700, 'Master Critic'], [1000, 'Legend']];
  function levelFor(uid) {
    const vs = visitsBy(uid).filter(v => BY_ID[v.buildingId]).length;
    const badges = badgesFor(uid).filter(x => x.earned).length;
    const xp = vs * 10 + badges * 15;
    let title = LEVELS[0][1], next = LEVELS[1];
    for (let i = 0; i < LEVELS.length; i++) { if (xp >= LEVELS[i][0]) { title = LEVELS[i][1]; next = LEVELS[i + 1] || null; } }
    return { xp, title, next, floor: LEVELS.find(l => l[1] === title)[0] };
  }
  // Weekly challenge: same for everyone, rotates deterministically by the week's date, resets Monday.
  function weekStartTs(ts) { const d = new Date(ts); const day = (d.getDay() + 6) % 7; d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - day); return d.getTime(); }
  const styleOf = vs => vs.map(v => BY_ID[v.buildingId]).filter(Boolean);
  const typeIs = rx => vs => styleOf(vs).filter(b => rx.test([b.typology, KINDS[kindOf(b)], b.name].join(' '))).length;
  const CHALLENGES = [
    { id: 'log3', label: 'Log 3 places', target: 3, count: vs => vs.length },
    { id: 'log5', label: 'Log 5 places', target: 5, count: vs => vs.length },
    { id: 'rate5', label: 'Give something 5\u2605', target: 1, count: vs => vs.filter(v => v.stars === 5).length },
    { id: 'shade', label: 'Throw real shade: rate something 1\u20132\u2605', target: 1, count: vs => vs.filter(v => v.stars <= 2).length },
    { id: 'photo2', label: 'Add photos to 2 logs', target: 2, count: vs => vs.filter(v => v.photos && v.photos.length).length },
    { id: 'note2', label: 'Write notes on 2 logs', target: 2, count: vs => vs.filter(v => v.note && v.note.trim()).length },
    { id: 'style2', label: 'Log 2 places of the same style', target: 2, count: vs => { const m = {}; styleOf(vs).forEach(b => { if (b.style) m[b.style] = (m[b.style] || 0) + 1; }); return Math.max(0, ...Object.values(m)); } },
    { id: 'styles3', label: 'Log 3 different styles', target: 3, count: vs => new Set(styleOf(vs).map(b => b.style).filter(Boolean)).size },
    { id: 'brutal', label: 'Log a Brutalist building', target: 1, count: vs => styleOf(vs).filter(b => b.style === 'Brutalist').length },
    { id: 'deco', label: 'Log an Art Deco building', target: 1, count: vs => styleOf(vs).filter(b => b.style === 'Art Deco').length },
    { id: 'old', label: 'Log something built before 1900', target: 1, count: vs => styleOf(vs).filter(b => b.year && b.year < 1900).length },
    { id: 'new', label: 'Log something built since 2000', target: 1, count: vs => styleOf(vs).filter(b => b.year >= 2000).length },
    { id: 'worship', label: 'Log a place of worship', target: 1, count: typeIs(/church|cathedral|chapel|basilica|temple|mosque|synagogue|shrine|abbey/i) },
    { id: 'museum', label: 'Log a museum or gallery', target: 1, count: typeIs(/museum|gallery/i) },
    { id: 'bridge', label: 'Log a bridge', target: 1, count: vs => styleOf(vs).filter(b => kindOf(b) === 'bridge' || /bridge/i.test(b.typology || '')).length },
    { id: 'cities2', label: 'Log places in 2 different cities', target: 2, count: vs => new Set(styleOf(vs).map(b => b.city).filter(Boolean)).size },
    { id: 'friend', label: 'Log a place a friend loved (4\u2605+)', target: 1, count: vs => vs.filter(v => state.visits.some(f => f.buildingId === v.buildingId && f.userId !== v.userId && f.stars >= 4 && isFollowing(v.userId, f.userId))).length },
  ];
  // Three a week, the same for everyone, picked by hashing the week's Monday.
  function challengesFor(uid) {
    const weekStart = weekStartTs(Date.now());
    const wk = new Date(weekStart).toISOString().slice(0, 10);
    const vs = visitsBy(uid).filter(v => v.createdAt >= weekStart && BY_ID[v.buildingId]);
    const picks = [];
    for (let i = 0; picks.length < 3; i++) {
      let h = 0; const key = wk + ':' + i;
      for (let j = 0; j < key.length; j++) h = (h * 31 + key.charCodeAt(j)) | 0;
      const ch = CHALLENGES[Math.abs(h) % CHALLENGES.length];
      if (!picks.includes(ch)) picks.push(ch);
    }
    return picks.map(ch => { const count = Math.min(ch.target, ch.count(vs)); return { ...ch, wk, count, done: count >= ch.target }; });
  }
  const challengeFor = uid => challengesFor(uid)[0];
  const weekEnds = () => { const d = new Date(weekStartTs(Date.now()) + 7 * DAY); return Math.max(1, Math.ceil((d - Date.now()) / DAY)); };

  // ---------- City Bingo ----------
  // A 4x4 card per city of things to find there. Only squares the city can actually fill are used,
  // seeded by the city name so the card stays put. A square fills with the first log that matches.
  const BINGO_SQUARES = [
    ['A bridge', b => kindOf(b) === 'bridge' || /bridge|viaduct/i.test(b.typology || '')],
    ['Public art', b => kindOf(b) === 'art'],
    ['A public space', b => kindOf(b) === 'spot' || /park|square|plaza|garden/i.test(b.typology || '')],
    ['Brutalist', b => b.style === 'Brutalist'], ['Art Deco', b => b.style === 'Art Deco'], ['Modernist', b => b.style === 'Modernist'],
    ['Contemporary', b => b.style === 'Contemporary'], ['Historic', b => b.style === 'Historic'], ['Postmodern', b => b.style === 'Postmodern'],
    ['High-tech', b => b.style === 'High-tech'], ['Deconstructivist', b => b.style === 'Deconstructivist'],
    ['A place of worship', b => /church|cathedral|chapel|basilica|temple|mosque|synagogue|shrine|abbey/i.test(b.typology || b.name)],
    ['A museum', b => /museum|gallery/i.test(b.typology || b.name)], ['A station', b => /station|terminal|airport/i.test(b.typology || b.name)],
    ['A skyscraper', b => /skyscraper|tower|high-rise|office/i.test(b.typology || b.name)], ['A library', b => /library/i.test(b.typology || b.name)],
    ['A stage', b => /theat|opera|concert|hall|arena|stadium/i.test(b.typology || b.name)], ['A home', b => /house|residen|apartment|villa/i.test(b.typology || '')],
    ['A campus', b => /university|college|school|campus/i.test(b.typology || b.name)],
    ['Before 1900', b => b.year && b.year < 1900], ['1900\u20131945', b => b.year >= 1900 && b.year <= 1945],
    ['1946\u20131979', b => b.year >= 1946 && b.year <= 1979], ['Since 2000', b => b.year >= 2000],
  ];
  // Squares about how you log rather than what: always possible, used to fill out small cities.
  const BINGO_LOG_SQUARES = [
    ['Give it 5\u2605', (b, v) => v.stars === 5], ['Throw shade: 1\u20132\u2605', (b, v) => v.stars <= 2], ['Add a photo', (b, v) => v.photos && v.photos.length],
    ['Write a note', (b, v) => v.note && v.note.trim()], ['A friend\u2019s favourite', (b, v) => state.visits.some(f => f.buildingId === b.id && f.userId !== v.userId && f.stars >= 4)],
    ['Two by one architect', null],
    ['Rate it 3★', (b, v) => v.stars === 3], ['Rate it 4★', (b, v) => v.stars === 4],
    ['A weekend visit', (b, v) => v.visitedOn && [0, 6].includes(new Date(v.visitedOn + 'T12:00').getDay())],
    ['Log before noon', (b, v) => new Date(v.createdAt).getHours() < 12], ['Log after 6pm', (b, v) => new Date(v.createdAt).getHours() >= 18],
    ['First to log it', (b, v) => !state.visits.some(f => f.buildingId === b.id && f.userId !== v.userId)],
    ['A friend has been', (b, v) => state.visits.some(f => f.buildingId === b.id && f.userId !== v.userId && isFollowing(v.userId, f.userId))],
    ['On Wikipedia', b => !!b.wiki], ['Somewhere you want to see', (b, v) => state.want.some(w => w.userId === v.userId && w.buildingId === b.id)],
    ['A wildcard: any log', () => true],
  ];
  const NEAR_ME = 'Near me';
  function bingoPlaces(city) {
    return city === NEAR_ME ? BUILDINGS.filter(b => km(loc, b) <= 25) : BUILDINGS.filter(b => b.city === city);
  }
  function bingoCard(city) {
    const places = bingoPlaces(city);
    const possible = BINGO_SQUARES.filter(([, test]) => places.some(test));
    let h = 0; for (const ch of city) h = (h * 31 + ch.charCodeAt(0)) | 0;
    const rnd = () => { h = (h * 1103515245 + 12345) | 0; return ((h >>> 16) & 0x7fff) / 0x7fff; };
    const pool = possible.slice().sort(() => rnd() - 0.5).slice(0, 12);
    const fill = BINGO_LOG_SQUARES.slice().sort(() => rnd() - 0.5).slice(0, 16 - pool.length);
    const squares = pool.concat(fill).sort(() => rnd() - 0.5).slice(0, 16);
    while (squares.length < 16) squares.push(['A wildcard: any log', () => true]);
    const inCity = new Set(places.map(b => b.id));
    const mine = visitsBy(state.me).filter(v => inCity.has(v.buildingId)).sort((x, y) => x.createdAt - y.createdAt);
    // Each log fills at most one square: squares with the fewest matching logs pick first.
    const byArch = {};
    mine.forEach(v => architectsOf(BY_ID[v.buildingId]).forEach(a => { (byArch[a] = byArch[a] || []).push(v); }));
    const cands = squares.map(([, test]) => test ? mine.filter(v => test(BY_ID[v.buildingId], v))
      : Object.values(byArch).filter(list => list.length >= 2).map(list => list[1]));
    const used = new Set(), hits = [];
    squares.map((_, i) => i).sort((x, y) => cands[x].length - cands[y].length).forEach(i => {
      const v = cands[i].find(c => !used.has(c.id));
      if (v) { used.add(v.id); hits[i] = v; }
    });
    return squares.map(([label], i) => ({ label, hit: hits[i] }));
  }
  const BINGO_LINES = [[0, 1, 2, 3], [4, 5, 6, 7], [8, 9, 10, 11], [12, 13, 14, 15], [0, 4, 8, 12], [1, 5, 9, 13], [2, 6, 10, 14], [3, 7, 11, 15], [0, 5, 10, 15], [3, 6, 9, 12]];
  const bingoLines = card => BINGO_LINES.filter(line => line.every(i => card[i].hit)).length;
  function bingoCities() {
    const counts = {};
    visitsBy(state.me).forEach(v => { const b = BY_ID[v.buildingId]; if (b && b.city) counts[b.city] = (counts[b.city] || 0) + 1; });
    return Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  }
  let bingoCity = null;
  function viewBingo(city) {
    const cities = bingoCities();
    city = city || bingoCity || cities[0] || NEAR_ME;
    bingoCity = city;
    const card = bingoCard(city), lines = bingoLines(card), filled = card.filter(c => c.hit).length;
    return `<div class="screen with-nav">
      <div class="topbar"><button class="btn-sq thin" data-act="back" aria-label="Back">${icon('back')}</button><div class="h1 grow">City Bingo</div></div>
      <div class="pad stack">
        <div class="pills" style="padding:0">${[NEAR_ME].concat(cities).map(c => `<button class="pill ${c === city ? 'on' : ''}" data-go="#/bingo/${encodeURIComponent(c)}">${esc(c)}</button>`).join('')}</div>
        <div class="row-flex" style="justify-content:space-between;align-items:baseline"><b style="font-size:18px">${esc(city)}</b>
          <span class="small muted">${filled}/16${lines ? ` \u00b7 <b class="bingo-word">BINGO${lines > 1 ? ' \u00d7' + lines : ''}</b>` : ''}</span></div>
        <div class="bingo">${card.map((c, i) => {
          const b = c.hit && BY_ID[c.hit.buildingId], inLine = BINGO_LINES.some(line => line.includes(i) && line.every(j => card[j].hit));
          return `<${b ? `button data-go="#/b/${b.id}"` : 'div'} class="bingo-sq ${b ? 'hit' : ''} ${inLine ? 'line' : ''}">
            ${b ? ph(b, { w: 200, cls: 'bingo-ph', go: false }) : ''}<span>${esc(c.label)}</span></${b ? 'button' : 'div'}>`;
        }).join('')}</div>
        <div class="small muted">Log places in ${city === NEAR_ME ? 'the 25 km around you' : esc(city)} that match a square. Fill a row, column or diagonal for BINGO.</div>
      </div><div class="spacer"></div></div>${nav('')}`;
  }
  function viewChallenges() {
    const chs = challengesFor(state.me);
    return `<div class="screen with-nav">
      <div class="topbar"><button class="btn-sq thin" data-act="back" aria-label="Back">${icon('back')}</button><div class="h1 grow">This week</div><span class="small muted">${weekEnds()} day${weekEnds() === 1 ? '' : 's'} left</span></div>
      <div class="pad stack">
        ${chs.map(ch => `<div class="challenge ${ch.done ? 'done' : ''}">
          <div class="row-flex" style="justify-content:space-between;align-items:center;gap:8px"><b>${esc(ch.label)}</b>${ch.done ? `<span class="chip arch-badge">${icon('check', 'sm')}Done</span>` : `<span class="small muted">${ch.count}/${ch.target}</span>`}</div>
          <div class="bar"><div style="width:${Math.round(ch.count / ch.target * 100)}%"></div></div></div>`).join('')}
        <div class="small muted">New challenges every Monday \u2014 the same for everyone.</div>
        <button class="game-card" data-go="#/bingo"><span class="game-card-icon">#</span><span class="grow"><b>City Bingo</b><span class="small muted" style="display:block">Fill a line on your city\u2019s card</span></span>${icon('chevron', 'sm')}</button>
      </div><div class="spacer"></div></div>${nav('')}`;
  }
  function playCardHTML() {
    const chs = challengesFor(state.me), done = chs.filter(c => c.done).length;
    const city = bingoCities()[0], card = city ? bingoCard(city) : null;
    return `<div class="play-row">
      <button class="play-tile" data-go="#/challenges"><b>${done}/3</b><span>Weekly challenges</span><small>${weekEnds()}d left</small></button>
      <button class="play-tile" data-go="#/bingo"><b>${card ? card.filter(c => c.hit).length + '/16' : 'Start'}</b><span>City Bingo</span><small>${city ? esc(city) : 'Log a place'}</small></button>
    </div>`;
  }

  // Monthly leaderboard among the people you follow, plus yourself.
  function monthlyLeaderboard() {
    const start = new Date(); start.setDate(1); start.setHours(0, 0, 0, 0);
    const since = start.getTime();
    const fids = followingIds(state.me); fids.add(state.me);
    const counts = {};
    state.visits.forEach(v => { if (fids.has(v.userId) && v.createdAt >= since) counts[v.userId] = (counts[v.userId] || 0) + 1; });
    return Array.from(fids).map(uid => ({ u: user(uid), n: counts[uid] || 0 })).filter(x => x.u).sort((a, b) => b.n - a.n);
  }
  // ---------- Activity (follows, comments, achievements) ----------
  function logActivity(forUid, type, data) {
    state.activity.push({ id: 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), forUid, type, data, createdAt: Date.now() });
    if (state.activity.length > 300) state.activity.splice(0, state.activity.length - 300);
  }
  function unreadActivity(uid) {
    const seen = state.activitySeen[uid] || 0;
    return state.activity.filter(a => a.forUid === uid && a.createdAt > seen).length;
  }
  function markActivitySeen(uid) { state.activitySeen[uid] = Date.now(); }

  function guideBuildings(dim, key) {
    if (dim === 'style') return BUILDINGS.filter(b => b.style === key);
    if (dim === 'kind') return BUILDINGS.filter(b => kindOf(b) === key);
    if (dim === 'city') return BUILDINGS.filter(b => b.city === key);
    if (dim === 'architect') return BUILDINGS.filter(b => b.architect === key);
    if (dim === 'decade') return BUILDINGS.filter(b => b.year && `${Math.floor(b.year / 10) * 10}s` === key);
    return [];
  }
  function photoFor(bid) {
    const vs = visitsFor(bid).filter(v => v.photos.length).sort((a, b) => (b.userId === state.me) - (a.userId === state.me) || b.createdAt - a.createdAt);
    return vs.length ? vs[0].photos[0] : null;
  }

  // ---------- Formatting ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function isoDate(ts) { const d = new Date(ts); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso + 'T12:00:00');
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function ago(ts) {
    const m = Math.round((Date.now() - ts) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + 'm ago';
    const h = Math.round(m / 60);
    if (h < 24) return h + 'h ago';
    const d = Math.round(h / 24);
    if (d < 7) return d + 'd ago';
    return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }
  function initials(name) {
    return String(name).replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  }
  function km(a, b) {
    if (!a) return Infinity;  // location not shared yet
    const R = 6371, toR = x => x * Math.PI / 180;
    const dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function fmtKm(d) {
    if (!isFinite(d)) return '';
    if (d < 1) return Math.round(d * 1000 / 10) * 10 + ' m';
    if (d < 100) return d.toFixed(1) + ' km';
    return Math.round(d).toLocaleString('en-GB') + ' km';
  }

  // ---------- Drawing helpers ----------
  const STAR_PATH = 'M12 2.6l2.85 5.95 6.55.8-4.8 4.55 1.23 6.5L12 17.2l-5.83 3.2 1.23-6.5-4.8-4.55 6.55-.8z';
  function starSVG(fill, stroke) {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${STAR_PATH}" fill="${fill}" stroke="${stroke}" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
  }
  function starsHTML(n, size) {
    let s = '';
    for (let i = 1; i <= 5; i++) s += i <= n ? starSVG('currentColor', 'currentColor') : starSVG('currentColor', 'currentColor').replace('<svg ', '<svg class="off" ');
    return `<span class="stars ${size || ''}" role="img" aria-label="${n} out of 5 stars">${s}</span>`;
  }
  function scoreHTML(val) {
    return `<span class="score">${val}${starSVG('currentColor', 'currentColor')}</span>`;
  }

  // Line icons, paths after Lucide (ISC licence) — drawn with currentColor so they follow the text colour.
  const ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
    bookmark: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
    bookmarkCheck: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/><path d="m9 10 2 2 4-4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    map: '<path d="M14.1 5.1 9.9 3 3.6 5.2A1 1 0 0 0 3 6.1v13.3a.7.7 0 0 0 1 .6l5-2 4.1 2.1 6.3-2.2a1 1 0 0 0 .6-.9V3.7a.7.7 0 0 0-1-.6z"/><path d="M9.9 3v15M14.1 5.1V21"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
    locate: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
    share: '<path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><path d="m16 6-4-4-4 4M12 2v13"/>',
    back: '<path d="m15 18-6-6 6-6"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1 1"/><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1-1"/>',
    more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3.5"/>',
    navigate: '<path d="m3 11 19-9-9 19-2-8z"/>',
    external: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
    edit: '<path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>',
    switch: '<path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>',
    reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
    refresh: '<path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M3 21v-5h5"/>',
    heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
    feed: '<rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/>',
    building: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M12 6h.01M16 6h.01M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01"/>',
    landmark: '<path d="M3 21h18M5 21v-9M9.7 21v-9M14.3 21v-9M19 21v-9M2.5 9 12 3.5 21.5 9z"/>',
    award: '<circle cx="12" cy="8.5" r="5.5"/><path d="m8.5 13.2-1.5 8.3 5-2.8 5 2.8-1.5-8.3"/>',
    accessible: '<circle cx="15.5" cy="4" r="1.6"/><path d="M9 7.5l4.5-.5 1 5H19l1.5 5M8.8 11.2a5 5 0 1 0 6.1 7.1"/>',
    ticket: '<path d="M3 8.5a2 2 0 0 0 0 4V16a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-3.5a2 2 0 0 1 0-4V5a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1z" transform="translate(0 2)"/><path d="M14 6v2M14 11v2M14 16v2"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    leaf: '<path d="M11 20A7 7 0 0 1 4 13c0-5 4.5-9 12-10 1 7.5-3 12-5 12"/><path d="M15 9c-3 3-5 8-5 11"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
    radio: '<circle cx="12" cy="12" r="2"/><path d="M8.5 8.5a5 5 0 0 1 7 0M5.5 5.5a9 9 0 0 1 13 0M8.5 15.5a5 5 0 0 0 7 0M5.5 18.5a9 9 0 0 0 13 0"/>',
    sliders: '<path d="M3 6h12M19 6h2"/><circle cx="17" cy="6" r="2"/><path d="M3 12h6M13 12h8"/><circle cx="9" cy="12" r="2"/><path d="M3 18h10M17 18h4"/><circle cx="13" cy="18" r="2"/>',
    flame: '<path d="M12 22a6 6 0 0 0 6-6c0-3-2-4.5-3-7-0.5 1.5-1.5 2.5-2.5 2.5C13 9 13.5 6 11 2c0 4-4 6-5.5 9.5A6.8 6.8 0 0 0 5 14a7 7 0 0 0 7 8z"/>',
    bell: '<path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  };
  function icon(name, size) {
    return `<svg class="i ${size || ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  }
  // Hatching: architectural "shade" drawn in the building's style colour — stands in for a photo.
  function hatchURL(color) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#efeeea"/><path d="M-2.5 2.5l5-5M0 10L10 0M7.5 12.5l5-5" stroke="${color}" stroke-width="1.2" stroke-opacity=".42"/></svg>`;
    return `url('data:image/svg+xml,${encodeURIComponent(svg)}')`;
  }
  function hatch(color) {
    return `background-image:${hatchURL(color)};background-size:10px 10px;background-repeat:repeat;`;
  }
  // Wikimedia Commons thumbnail at a given width (redirects to the scaled file).
  function commonsURL(file, w) {
    return 'https://commons.wikimedia.org/wiki/Special:FilePath/' + encodeURIComponent(file).replace(/'/g, '%27') + '?width=' + w;
  }
  // Photo priority: this log's photo → any user photo of the building → Wikimedia Commons image → hatching.
  function photoURL(b, w, own) {
    return own || photoFor(b.id) || (b.image ? commonsURL(b.image, w) : null);
  }
  function ph(b, o) {
    o = o || {};
    const photo = photoURL(b, o.w || 240, o.photo);
    // The hatching sits under the photo, so a slow or failed image still shows something on-style.
    const bg = photo
      ? `background-image:url('${photo}'),${hatchURL(styleColor(b))};background-size:cover,10px 10px;background-repeat:no-repeat,repeat;background-position:center,0 0;`
      : hatch(styleColor(b));
    const go = o.go === false ? '' : ` data-go="#/b/${b.id}"`;
    let inner = o.inner || '';
    if (!photo && o.label) inner += `<span class="ph-label">${esc(o.label)}</span>`;
    if (!photo && o.initials) inner += `<span class="ph-initials">${esc(initials(b.name))}</span>`;
    return `<div class="ph ${photo ? 'photo' : ''} ${o.cls || ''}" style="${bg}${o.style || ''}"${go} aria-label="${esc(b.name)}">${inner}</div>`;
  }
  const makerLine = b => [b.architect, b.city].filter(Boolean).join(' · ');
  function likeChips(likes) {
    return likes && likes.length ? `<div class="chips likes">${likes.map(l => `<span class="chip">${esc(l)}</span>`).join('')}</div>` : '';
  }
  // A log's own photos: 1 full width, 2 side by side, 3 = one large + two, 4 = grid.
  let galleries = [];
  function gallery(list) { galleries.push(list); return galleries.length - 1; }
  function shotsHTML(photos) {
    if (!photos || !photos.length) return '';
    const list = photos.slice(0, MAX_PHOTOS);
    const g = gallery(list);
    return `<div class="shots n${list.length}">${list.map((p, i) => `<button class="shot" data-act="viewphoto" data-g="${g}" data-i="${i}" style="background-image:url('${p}')" aria-label="View photo ${i + 1} of ${list.length}"></button>`).join('')}</div>`;
  }
  const phLabel = b => [b.style, b.year].filter(Boolean).join(' · ').toUpperCase();
  const byLine = b => [b.architect, b.year].filter(Boolean).join(' · ');
  function avatar(u, size) {
    const bg = u.photo ? ` style="background-image:url('${u.photo}');background-size:cover;background-position:center"` : '';
    return `<div class="avatar ${size || ''}"${bg} data-go="#/u/${u.id}" aria-label="${esc(u.name)}">${u.photo ? '' : esc(initials(u.name))}</div>`;
  }
  // The logomark (same artwork as app/icon.svg): a tower lit by a low sun, its shade side and the
  // shadow it throws drawn in the app's diagonal hatching.
  let logoN = 0;
  const LOGO_LINES = Array.from({ length: 26 }, (_, i) => -64 + i * 5).map(o => `<line x1="${o}" y1="64" x2="${o + 64}" y2="0"/>`).join('');
  function logoSVG(size) {
    const n = ++logoN, s = size || 28;
    return `<svg class="logo-mark" viewBox="0 0 64 64" width="${s}" height="${s}" aria-hidden="true">
      <defs><clipPath id="lgSh${n}"><path d="M17 51H37L15 64H-5Z"/></clipPath>
    <clipPath id="lgFc${n}"><path d="M17 50V26H21V18H25V10H27V50Z"/></clipPath></defs>
    <rect width="64" height="64" rx="15" fill="var(--ink)"/>
    <circle cx="48" cy="16" r="7" fill="var(--paper)"/>
    <path d="M0 50H64" stroke="var(--paper)" stroke-width="1.5" opacity=".55"/>
    <g clip-path="url(#lgSh${n})" stroke="var(--paper)" stroke-width="1.6" opacity=".6">${LOGO_LINES}</g>
    <path d="M17 50V26H21V18H25V10H29V18H33V26H37V50Z" fill="var(--paper)"/>
    <g clip-path="url(#lgFc${n})" stroke="var(--ink)" stroke-width="1.6">${LOGO_LINES}</g>
    </svg>`;
  }
  const wordmark = cls => `<div class="${cls}"><span class="wm-throw">throw</span><span class="wm-shade">Shade</span></div>`;

  // ---------- Sound ----------
  const Sound = (() => {
    let ctx;
    function ensure() {
      if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    function tone(freq, dur, type, vol, delay) {
      try {
        const c = ensure();
        const t0 = c.currentTime + (delay || 0);
        const osc = c.createOscillator(), gain = c.createGain();
        osc.type = type || 'sine';
        osc.frequency.setValueAtTime(freq, t0);
        gain.gain.setValueAtTime(0, t0);
        gain.gain.linearRampToValueAtTime(vol || 0.05, t0 + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(gain).connect(c.destination);
        osc.start(t0); osc.stop(t0 + dur + 0.02);
      } catch (e) { /* no audio support */ }
    }
    return {
      tap() { tone(520, 0.05, 'square', 0.025); },
      star() { tone(720, 0.07, 'sine', 0.05); },
      success() { tone(660, 0.09, 'sine', 0.05); tone(880, 0.13, 'sine', 0.05, 0.09); },
    };
  })();
  // Floating icon-only bar on phones; on wide screens CSS turns it into a labelled sidebar
  // (the brand and .nav-label spans are hidden on phones). Names live in aria-label / title.
  function nav(active) {
    const item = (key, href, label, ic) => `<a href="${href}" class="nav-${key} ${active === key ? 'on' : ''}" aria-label="${label}" title="${label}">${icon(ic)}<span class="nav-label">${label}</span>${key === 'you' && state.newAchievement ? '<span class="nav-dot"></span>' : ''}</a>`;
    return `<nav class="nav">
      <a href="#/feed" class="nav-brand" aria-label="throwShade home">${logoSVG(30)}${wordmark('wordmark')}</a>
      ${item('home', '#/feed', 'Home', 'home')}
      ${item('lists', '#/lists', 'Lists', 'bookmark')}
      <a href="#/find" class="plus nav-find ${active === 'find' ? 'on' : ''}" aria-label="Search architecture and people" title="Search">${icon('search')}<span class="nav-label">Search</span></a>
      ${item('map', '#/map', 'Map', 'map')}
      ${item('you', '#/me', 'You', 'user')}
    </nav>`;
  }

  // ---------- Location ----------
  // null until the person shares their location; nothing pretends they're somewhere else.
  let loc = null;
  let locAsked = false;
  function requestLocation(cb) {
    if (!navigator.geolocation) { cb && cb(false, 'unsupported'); return; }
    navigator.geolocation.getCurrentPosition(
      p => { if (!loc) mapView = null; loc = { lat: p.coords.latitude, lng: p.coords.longitude }; cb && cb(true); },
      e => cb && cb(false, e.code === 1 ? 'denied' : 'unavailable'),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }
  const nearest = list => list.map(b => ({ b, d: km(loc, b) })).sort((x, y) => x.d - y.d);
  // Shown where "Nearby" would be until the person shares their location.
  const locPrompt = () => `<button class="game-card" style="margin-top:12px" data-act="uselocation"><span class="game-card-icon">${icon('locate', 'sm')}</span><span class="grow"><b>See what’s near you</b><span class="small muted" style="display:block">Share your location to sort places by distance</span></span>${icon('chevron', 'sm')}</button>`;

  // ---------- UI state ----------
  const root = document.getElementById('app');
  let beenMap = null, beenSel = null, beenUid = null, beenHeat = false, inviteSel = new Set(), newListPublic = false;
  let mapKind = 'all', mapFilter = 'all', mapStyles = new Set(), mapHeat = false, mapSel = null, map = null, mapMarkers = {}, mapView = null, pinMode = false, pinMap = null, mapFocus = false, heatLayer = null;
  let mapMode = 'pins', mapMinRating = 0, mapQ = '', clusterGroup = null, mapQTimer, mapFiltersOpen = false, mapDraft = null, mapFriends = false;
  let findQ = '', findTab = 'arch', findStyle = '';
  let listSort = 'top';
  let bTab = 'critiques';
  let pTab = 'critiques';
  let draft = null;
  let resetArmed = false;
  let delArmed = false;
  let pickedPhoto;
  // Profile picture chosen on sign-in or in Edit profile, applied on submit.
  function setPicked(src) {
    pickedPhoto = src;
    document.querySelectorAll('.avatar-pick.on').forEach(x => x.classList.remove('on'));
    const pv = document.getElementById('su-avatar');
    if (pv) pv.style.backgroundImage = `url('${src}')`;
  }
  function randomAvatar(except) {
    const pool = PRESET_AVATARS.filter(p => p !== except);
    return pool[Math.floor(Math.random() * pool.length)];
  }
  const trail = [];

  // ---------- Views ----------
  let signinMode = 'login';
  function viewSignin() {
    // Someone signed in before accounts had passwords lands here with their handle filled in.
    const prior = state.me && me();
    const login = signinMode === 'login';
    if (!login && !pickedPhoto) pickedPhoto = randomAvatar();
    const field = (id, label, attrs) => `<div class="field"><label for="${id}">${label}</label><input id="${id}" class="input" autocapitalize="none" spellcheck="false" ${attrs}></div>`;
    return `<div class="screen"><div class="signin">
      <div class="mark-group">${logoSVG(48)}${wordmark('mark')}</div>
      <div class="muted">Rate every building you walk into. Find the next one worth the trip.</div>
      <div class="tabs" style="margin-top:6px">
        <button class="${login ? 'on' : ''}" data-act="signinmode" data-k="login">Log in</button>
        <button class="${login ? '' : 'on'}" data-act="signinmode" data-k="signup">Sign up</button>
      </div>
      ${login ? `
      ${prior ? `<div class="small muted">Accounts now have passwords. Log in as <b>@${esc(prior.handle)}</b> and choose one \u2014 the first password you enter becomes yours.</div>` : ''}
      ${field('li-handle', 'Handle', `placeholder="ada.c" autocomplete="username" value="${prior ? esc(prior.handle) : ''}"`)}
      ${field('li-pass', 'Password', 'type="password" autocomplete="current-password"')}
      <button class="btn-primary" data-act="dologin">Log in</button>` : `
      <div class="signin-avatar">
        <button class="avatar-edit" data-act="shuffleavatar" aria-label="Try another profile picture"><div class="avatar lg" id="su-avatar" style="background-image:url('${pickedPhoto}')"></div><span class="avatar-edit-badge">${icon('refresh', 'sm')}</span></button>
      </div>
      ${field('su-name', 'Display name', 'placeholder="Ada Critic" autocomplete="name" autocapitalize="words"')}
      ${field('su-handle', 'Handle', 'placeholder="ada.c" autocomplete="username"')}
      ${field('su-pass', 'Password', 'type="password" placeholder="At least 8 characters" autocomplete="new-password"')}
      <button class="btn-primary" data-act="signup">Start throwing shade</button>`}
    </div></div>`;
  }

  function heartBtn(v) {
    const hearts = v.hearts || [], on = hearts.includes(state.me);
    return `<button class="link heart-btn ${on ? 'on' : ''}" data-act="heart" data-id="${v.id}" aria-label="${on ? 'Unlove' : 'Love'} this log" aria-pressed="${on}">${icon('heart', 'sm')}${hearts.length || ''}</button>`;
  }
  function feedCard(v) {
    const u = user(v.userId), b = BY_ID[v.buildingId];
    if (!u || !b) return '';
    const mine = v.userId === state.me;
    const mv = myVisit(b.id);
    let action;
    if (mine) action = `<button class="link" data-go="#/log/${b.id}">${icon('edit', 'sm')}Edit</button><button class="link" data-act="sharelog" data-id="${v.id}">${icon('share', 'sm')}Share</button>`;
    else if (mv) action = `<button class="link" data-go="#/b/${b.id}">${icon('check', 'sm')}Been · you gave ${mv.stars}★</button>`;
    else action = `<button class="link ${isSaved(b.id) ? 'on' : ''}" data-go="#/save/${b.id}">${isSaved(b.id) ? icon('bookmarkCheck', 'sm') + 'Saved' : icon('bookmark', 'sm') + 'Save'}</button>`;
    const where = [kindOf(b) !== 'building' && KINDS[kindOf(b)], b.city, ago(v.createdAt)].filter(Boolean).join(' · ');
    return `<div class="card">
      <div class="card-head">
        ${avatar(u)}
        <div class="who"><b data-go="#/u/${u.id}">${mine ? 'You' : esc(u.handle)}</b> rated <b data-go="#/b/${b.id}">${esc(b.name)}</b><div class="small muted">${esc(where)}</div></div>
      </div>
      ${v.photos && v.photos.length ? shotsHTML(v.photos) : ph(b, { w: 800, cls: 'feed-hero',
        inner: `<span class="feed-hero-name">${esc(b.name)}<small>${esc(makerLine(b))}</small></span>` })}
      <div class="rating-line">${starsHTML(v.stars, 'md')}<span class="small muted">${STAR_WORDS[v.stars]}</span></div>
      ${v.note ? `<div class="quote">${esc(v.note)}</div>` : ''}
      ${likeChips(v.likes)}
      <div class="card-actions">${heartBtn(v)}${action}<button class="link" data-go="#/b/${b.id}">Details${icon('chevron', 'sm')}</button></div>
    </div>`;
  }

  function viewHome(tab) {
    if (tab === 'map') {
      const head = `<div class="topbar"><div class="h1">Map</div></div>`;
      const KIND_LABEL = { all: 'All types', building: 'Buildings', bridge: 'Bridges', art: 'Art', spot: 'Spots' };
      const items = mapBuildings();
      const listBody = mapMode === 'list' ? `<div class="screen" style="position:static;flex:1;overflow-y:auto"><div class="stack-6 pad">
          ${rankByRating(items.map(x => x.b)).length ? rankByRating(items.map(x => x.b)).map((b, i) => {
            const a = avgFor(b.id);
            return `<button class="row" data-go="#/b/${b.id}">
              <span class="rank">${i + 1}</span>
              ${ph(b, { style: 'width:44px;height:44px', go: false })}
              <div class="grow"><div class="ellipsis">${esc(b.name)}</div><div class="sub ellipsis">${esc(makerLine(b))}</div></div>
              ${a.avg ? scoreHTML(a.avg.toFixed(1)) : '<span class="small muted">No logs</span>'}
            </button>`;
          }).join('') : `<div class="empty">Nothing matches these filters.</div>`}
        </div></div>` : '';
      const active = mapActiveFilters();
      return `<div class="screen with-nav fixed" style="display:flex;flex-direction:column">
        ${head}
        <div class="pad" style="padding-bottom:10px;display:flex;gap:8px;align-items:center">
          <div class="input-wrap grow">${icon('search', 'sm')}<input class="input" data-input="mapq" value="${esc(mapQ)}" placeholder="Search this map"></div>
          <button class="btn-sq" data-act="mapmode" data-k="${mapMode === 'list' ? 'pins' : 'list'}" aria-label="${mapMode === 'list' ? 'Show map' : 'Show list'}" title="${mapMode === 'list' ? 'Map' : 'List'}">${icon(mapMode === 'list' ? 'map' : 'feed', 'sm')}</button>
          <button class="btn-sq filter-btn ${active.length ? 'on' : ''}" data-act="mapfilterstoggle" aria-label="Filters${active.length ? ` (${active.length} on)` : ''}">${icon('sliders', 'sm')}${active.length ? `<span class="filter-count">${active.length}</span>` : ''}</button>
        </div>
        ${active.length ? `<div class="pills active-filters">${active.map(x => `<button class="pill on" data-act="mapclear" data-f="${x.f}" data-k="${esc(x.k)}">${x.dot ? `<span class="dot" style="background:${x.dot}"></span>` : ''}${esc(x.label)}<span class="x">\u00d7</span></button>`).join('')}
          ${active.length > 1 ? '<button class="pill" data-act="mapclearall">Clear all</button>' : ''}</div>` : ''}
        ${listBody}
        <div class="map-wrap" style="position:relative;flex:1;display:${mapMode === 'list' ? 'none' : 'block'}">
          <div id="map"></div>
          <button class="btn-sq map-heatbtn ${mapHeat ? 'on' : ''}" data-act="toggleheat" aria-label="Show where people go">${icon('flame')}</button>
          ${mapHeat ? '<div class="heat-legend"><span>Where people go</span><small class="muted">App visits + Wikipedia interest</small><i></i><span class="muted">Quiet</span><span class="muted" style="margin-left:auto">Busy</span></div>' : ''}
          <button class="btn-sq map-locate" data-act="locate" aria-label="Locate me">${icon('locate')}</button>
          <button class="btn-sq map-pinbtn" id="pinbtn" data-act="droppin" aria-label="Drop a pin to add a building">${icon('pin')}</button>
          <button class="btn-sq map-friendsbtn ${friendsLayer() ? 'on' : ''}" data-act="togglefriends" aria-label="Show where friends have been">${icon('users')}</button>
          <div class="map-hint" id="map-hint" hidden>Tap a place to add it · or long-press</div>
          <div id="map-card"></div>
        </div>
        ${mapFiltersOpen ? `<div class="sheet-backdrop" data-act="mapfilterclose"></div><div class="filter-sheet" id="map-sheet">${mapSheetInner()}</div>` : ''}
      </div>${nav('map')}`;
    }
    const fids = followingIds(state.me);
    const items = state.visits.filter(v => fids.has(v.userId) || v.userId === state.me).sort((a, b) => b.createdAt - a.createdAt).slice(0, 60);
    const u = me(), hr = new Date().getHours();
    const hello = hr < 5 ? 'Up late' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
    const weekAgo = Date.now() - 7 * DAY;
    const mineCount = visitsBy(state.me).length;
    const lastLog = id => Math.max(0, ...visitsBy(id).map(v => v.createdAt));
    const activeCount = [...fids].filter(id => lastLog(id) >= weekAgo).length;
    const rail = (title, link, list, meta) => list.length ? `
      <div class="section-title" style="margin-top:6px"><span>${title}</span>${link ? `<button class="link" data-go="${link}">See all${icon('chevron', 'sm')}</button>` : ''}</div>
      <div class="rail flush">${list.map(x => `<button class="rail-item" data-go="#/b/${x.b.id}">
        ${ph(x.b, { w: 300, cls: 'rail-photo', label: phLabel(x.b), go: false })}
        <div class="rail-name ellipsis">${esc(x.b.name)}</div><div class="rail-meta muted ellipsis">${meta(x)}</div></button>`).join('')}</div>` : '';
    const trend = trending(10);
    const trendRail = rail('Trending', '#/trending', trend, x => `${x.n} log${x.n === 1 ? '' : 's'} this week`);
    const near = loc ? nearest(BUILDINGS.filter(b => b.image || photoFor(b.id))).slice(0, 12) : [];
    const nearRail = rail('Near you', '#/find', near, x => esc(fmtKm(x.d)));
    const feed = items.length ? items.map(feedCard).join('') :
      `<div class="empty">Your feed is empty.<br>Follow some critics to see what they’re rating.</div><button class="btn dashed" data-act="findpeople">${icon('users', 'sm')}Find people</button>`;
    // No wordmark header: the greeting leads the page and the bell sits beside it.
    return `<div class="screen with-nav">
      <div class="pad home">
        <div class="hello"><div class="grow"><div class="hello-title">${hello}, ${esc((u.name || '').split(' ')[0])}</div>
          <div class="muted small">${mineCount} place${mineCount === 1 ? '' : 's'} rated${activeCount ? ` · ${activeCount} friend${activeCount === 1 ? '' : 's'} posted this week` : ''}</div></div>
          <a href="#/activity" class="btn-sq thin bell-btn" style="position:relative" aria-label="Activity">${icon('bell')}${unreadActivity(state.me) ? '<span class="nav-dot" style="top:6px;right:6px"></span>' : ''}</a></div>
        ${storyRow()}
        <div class="home-cta-row"><button class="btn on home-cta" data-go="#/find">${icon('plus', 'sm')}Throw some shade</button>
          <button class="btn-sq home-scan" data-go="#/scan" aria-label="Scan a building with your camera">${icon('camera')}</button></div>
        ${memoryHTML()}
        ${recapCardHTML()}
        ${gameCardHTML()}
        ${playCardHTML()}
        ${trendRail}${nearRail}
        <div class="section-title" style="margin-top:14px"><span>From your circle</span></div>
      </div>
      <div class="stack pad feed">${feed}</div><div class="spacer"></div></div>${nav('home')}`;
  }

  function viewGuide(dim, key) {
    const list = rankByRating(guideBuildings(dim, key));
    const title = dim === 'kind' ? KINDS[key] + 's' : key;
    const rows = list.length ? list.map((b, i) => {
      const a = avgFor(b.id);
      return `<button class="row" data-go="#/b/${b.id}">
        <span class="rank">${i + 1}</span>
        ${ph(b, { style: 'width:44px;height:44px', go: false })}
        <div class="grow"><div class="ellipsis">${esc(b.name)}</div><div class="sub ellipsis">${esc(makerLine(b))}</div></div>
        ${a.avg ? scoreHTML(a.avg.toFixed(1)) : ''}
      </button>`;
    }).join('') : `<div class="empty">Nothing here yet.</div>`;
    const completion = dim === 'city' ? (() => {
      const seen = new Set(visitsBy(state.me).map(v => v.buildingId));
      const done = list.filter(b => seen.has(b.id)).length;
      return list.length ? `<div class="pad"><div class="banner" style="display:flex;flex-direction:column;gap:8px">
        <div class="row-flex" style="justify-content:space-between"><b>You've seen ${done} of ${list.length}</b><span class="small muted">${Math.round(done / list.length * 100)}%</span></div>
        <div class="bar"><div style="width:${Math.round(done / list.length * 100)}%"></div></div>
      </div></div>` : '';
    })() : '';
    return `<div class="screen with-nav">
      <div class="topbar"><button class="btn-sq" data-act="back" aria-label="Back">${icon('back')}</button><div class="h1">${esc(title)}</div></div>
      ${completion}
      <div class="stack-6 pad">${rows}</div>
      <div class="spacer"></div>
    </div>${nav('')}`;
  }

  function viewTrending() {
    const list = trending(50);
    const rows = list.length ? list.map((x, i) => `<button class="row" data-go="#/b/${x.b.id}">
        <span class="rank">${i + 1}</span>
        ${ph(x.b, { style: 'width:44px;height:44px', go: false })}
        <div class="grow"><div class="ellipsis">${esc(x.b.name)}</div><div class="sub ellipsis">${esc(makerLine(x.b))}</div></div>
        <span class="small muted">${x.n} log${x.n === 1 ? '' : 's'}</span>
      </button>`).join('') : `<div class="empty">No logs in the last 7 days yet.</div>`;
    return `<div class="screen with-nav">
      <div class="topbar"><button class="btn-sq" data-act="back" aria-label="Back">${icon('back')}</button><div class="h1 grow">Trending</div></div>
      <div class="stack-6 pad">${rows}</div>
      <div class="spacer"></div>
    </div>${nav('')}`;
  }

  function viewRadio(seedId) {
    const seed = BY_ID[seedId];
    if (!seed) return viewNotFound();
    if (radioSeedId !== seedId) { radioSeedId = seedId; radioIdx = 0; }
    const queue = radioQueue(seedId);
    if (!queue.length) {
      return `<div class="screen with-nav">
        <div class="topbar"><button class="btn-sq" data-act="back" aria-label="Back">${icon('back')}</button><div class="h1">Similar Places</div></div>
        <div class="pad"><div class="empty">Not enough similar places to ${esc(seed.name)} yet.</div></div>
      </div>${nav('')}`;
    }
    if (radioIdx >= queue.length) radioIdx = 0;
    const b = queue[radioIdx];
    const a = avgFor(b.id);
    return `<div class="screen with-nav">
      <div class="topbar"><button class="btn-sq" data-act="back" aria-label="Back">${icon('back')}</button><div class="h1 grow ellipsis">Similar to ${esc(seed.name)}</div></div>
      <div class="pad stack">
        ${ph(b, { w: 900, cls: 'hero', style: 'height:220px;border-radius:16px', label: phLabel(b) })}
        <div><div class="h-building">${esc(b.name)}</div><div class="muted" style="margin-top:2px">${esc(makerLine(b))}</div></div>
        <div class="row-flex" style="align-items:center;justify-content:space-between">
          ${a.avg ? scoreHTML(a.avg.toFixed(1)) : `<span class="muted small">Not rated yet</span>`}
          <span class="small muted">${radioIdx + 1} of ${queue.length}</span>
        </div>
        <div class="pin-map" id="radiomap" style="height:130px"></div>
        <div class="small muted" style="margin-top:-6px">${fmtKm(km(seed, b))} from ${esc(seed.name)}</div>
        <div class="row-flex">
          <button class="btn block ${isSaved(b.id) ? 'on' : ''}" data-go="#/save/${b.id}">${isSaved(b.id) ? icon('bookmarkCheck', 'sm') + 'Saved' : icon('bookmark', 'sm') + 'Save'}</button>
          <button class="btn block" data-go="#/b/${b.id}">${icon('external', 'sm')}Open</button>
        </div>
        <button class="btn-primary" data-act="radioskip">Next similar place</button>
      </div>
      <div class="spacer"></div>
    </div>${nav('')}`;
  }

  function buildingRow(b, right) {
    return `<button class="row" data-go="#/b/${b.id}">
      ${ph(b, { style: 'width:38px;height:38px', go: false })}
      <div class="grow"><div class="ellipsis">${esc(b.name)}</div><div class="sub ellipsis">${esc(makerLine(b))}</div></div>
      ${right || ''}
    </button>`;
  }

  function findResults() {
    const q = findQ.trim().toLowerCase();
    const section = (title, rows) => rows.length ? `<div class="caps find-section">${title}</div>${rows.join('')}` : '';
    const personRow = u => {
      const f = isFollowing(state.me, u.id);
      return `<div class="row" data-go="#/u/${u.id}">
        ${avatar(u)}<div class="grow"><b>${esc(u.name)}</b><div class="sub">@${esc(u.handle)} · ${visitsBy(u.id).length} logged</div></div>
        <button class="btn ${f ? '' : 'on'}" data-act="follow" data-id="${u.id}">${f ? 'Following' : 'Follow'}</button>
      </div>`;
    };
    // Tap the row to open the place; the + rates it straight away (the log flow used to live on the centre button).
    const placeRow = x => `<div class="row" data-go="#/b/${x.b.id}">
        ${ph(x.b, { style: 'width:38px;height:38px', go: false })}
        <div class="grow"><div class="ellipsis">${esc(x.b.name)}${factIcons(x.b, 'xs') ? `<span class="inline-facts">${factIcons(x.b, 'xs')}</span>` : ''}</div><div class="sub ellipsis">${esc([KINDS[kindOf(x.b)] !== 'Building' && KINDS[kindOf(x.b)], makerLine(x.b), fmtKm(x.d)].filter(Boolean).join(' · '))}</div></div>
        <button class="btn-sq thin" style="width:34px;height:34px" data-go="#/log/${x.b.id}" aria-label="Rate ${esc(x.b.name)}">${icon('plus', 'sm')}</button>
      </div>`;
    const pinLink = `<button class="btn dashed" style="height:48px;width:100%;margin-top:12px" data-act="pinfrommap">${icon('pin', 'sm')}Can’t find it? Drop a pin</button>`;
    if (findTab === 'users') {
      const others = state.users.filter(u => u.id !== state.me).sort((a, b) => a.name.localeCompare(b.name));
      const people = q ? others.filter(u => u.handle.toLowerCase().includes(q) || u.name.toLowerCase().includes(q)) : others;
      if (!people.length) return `<div class="empty" style="margin-top:12px">No users match “${esc(findQ)}”.</div>`;
      const sugg = q ? [] : suggestedPeople(5);
      const suggRow = x => personRow(x.u).replace(/<div class="sub">[^]*?<\/div>/, `<div class="sub">${esc(x.why)}</div>`);
      return section('Suggested for you', sugg.map(suggRow)) + section(q ? 'Users' : `All users · ${people.length}`, people.map(personRow));
    }
    const recent = (state.recentSearches || []).slice(0, 8);
    const recentHTML = recent.length ? `<div class="row-flex" style="justify-content:space-between;align-items:baseline;margin-top:6px"><div class="caps">Recent</div><button class="link small" data-act="clearrecent">Clear</button></div>
      <div class="chips">${recent.map(r => `<button class="chip" data-act="recentq" data-k="${esc(r)}">${icon('clock', 'sm')}${esc(r)}</button>`).join('')}</div>` : '';
    const styleOk = b => !findStyle || b.style === findStyle;
    if (!q && findStyle) return section(loc ? `${findStyle} near you` : findStyle, nearest(BUILDINGS.filter(styleOk)).slice(0, 30).map(placeRow)) + pinLink;
    if (!q && !loc) return recentHTML + locPrompt() + pinLink;
    if (!q) return recentHTML + `<button class="game-card" style="margin-top:12px" data-go="#/crawl/near"><span class="game-card-icon">${icon('navigate', 'sm')}</span><span class="grow"><b>Walk near me</b><span class="small muted" style="display:block">A short architecture walk from where you are</span></span>${icon('chevron', 'sm')}</button>`
      + section('Nearby', nearest(BUILDINGS).slice(0, 15).map(placeRow)) + pinLink;
    const places = nearest(BUILDINGS.filter(b => b.source !== 'live' && styleOk(b) && [b.name, b.architect, b.city, b.country, b.style, b.typology, KINDS[kindOf(b)]].join(' ').toLowerCase().includes(q))).slice(0, 40);
    const shown = new Set(places.map(x => x.b.id));
    const world = worldQ === findQ.trim() ? worldResults.filter(b => !shown.has(b.id) && styleOk(b)).map(b => ({ b, d: km(loc, b) })) : [];
    const pending = q.length >= 3 && worldQ !== findQ.trim();
    const worldSection = world.length ? section('Worldwide', world.map(placeRow))
      : pending ? `<div class="caps find-section">Searching worldwide…</div>` : '';
    if (!places.length && !world.length && !pending) return `<div class="empty" style="margin-top:12px">No architecture matches “${esc(findQ)}”.</div>` + pinLink;
    return section('Architecture', places.map(placeRow)) + worldSection + pinLink;
  }

  function viewFind() {
    return `<div class="screen with-nav">
      <div class="topbar"><div class="h1">Search</div></div>
      <div class="tabs" style="margin:0 20px 12px">
        <button class="${findTab === 'arch' ? 'on' : ''}" data-act="findtab" data-k="arch">Architecture</button>
        <button class="${findTab === 'users' ? 'on' : ''}" data-act="findtab" data-k="users">Users</button>
      </div>
      <div class="pad" style="display:flex;gap:8px;align-items:center"><div class="input-wrap grow">${icon('search')}<input class="input" data-input="find" value="${esc(findQ)}" placeholder="${findTab === 'users' ? 'Search users by name or handle' : 'Search buildings, bridges, art, architects, cities'}" autocomplete="off" autocapitalize="none"></div>
        ${findTab === 'users' ? '' : `<button class="btn-sq find-cam" data-go="#/scan" aria-label="Scan a building with your camera">${icon('camera', 'sm')}</button>`}</div>
      ${findTab === 'users' ? '' : `<div class="find-styles">${['', ...Object.keys(STYLES)].map(st => `<button class="style-chip sm ${findStyle === st ? 'on' : ''}" data-act="findstyle" data-k="${esc(st)}">${st ? `<span class="dot" style="background:${STYLES[st]}"></span>${esc(st)}` : 'All styles'}</button>`).join('')}</div>`}
      <div id="results" class="stack-6 pad">${findResults()}</div>
      <div class="spacer"></div>
    </div>${nav('find')}`;
  }

  // ---------- Lists: Want to Visit (private) + custom lists shared with invited members ----------
  const myLists = () => state.lists.filter(l => l.members.includes(state.me)).sort((a, b) => b.createdAt - a.createdAt);
  const inList = (l, bid) => l.items.some(i => i.buildingId === bid);
  const isSaved = bid => isWant(state.me, bid) || myLists().some(l => inList(l, bid));
  const handles = ids => ids.map(user).filter(Boolean).map(u => '@' + u.handle);
  function listMeta(l) {
    const n = l.items.length;
    const others = handles(l.members.filter(m => m !== state.me));
    const who = l.ownerId === state.me
      ? (others.length ? 'with ' + others.slice(0, 2).join(', ') + (others.length > 2 ? ` +${others.length - 2}` : '') : 'only you')
      : 'invited by ' + handles([l.ownerId]).join('');
    return `${n} place${n === 1 ? '' : 's'} · ${who}`;
  }
  function listTile(l) {
    const first = l.items.length && BY_ID[l.items[l.items.length - 1].buildingId];
    return first ? ph(first, { w: 160, style: 'width:52px;height:52px', go: false }) : `<div class="list-icon">${icon('bookmark')}</div>`;
  }

  // Tabs: your lists, Recs and Guides.
  function viewLists(tab) {
    const tabs = `<div class="tabs" style="margin:0 20px 12px">
      <button class="${tab === 'mine' ? 'on' : ''}" data-go="#/lists">My lists</button>
      <button class="${tab === 'recs' ? 'on' : ''}" data-go="#/lists/recs">Recs</button>
      <button class="${tab === 'guides' ? 'on' : ''}" data-go="#/lists/guides">Guides</button></div>`;
    let body;
    if (tab === 'recs') {
      const recs = recsFor(state.me, 16);
      const groups = [];
      const byGroup = {};
      recs.forEach(x => {
        if (!byGroup[x.group]) { byGroup[x.group] = { label: recGroupLabel(x.group), items: [] }; groups.push(byGroup[x.group]); }
        byGroup[x.group].items.push(x);
      });
      body = `<div class="pad">${groups.length ? groups.map(g => `
        <div class="section-title" style="margin-top:8px">${esc(g.label)}</div>
        <div class="stack-6" style="margin-bottom:8px">${g.items.map(x => {
          const a = avgFor(x.b.id);
          return `<div class="row" data-go="#/b/${x.b.id}">
            ${ph(x.b, { style: 'width:44px;height:44px', go: false })}
            <div class="grow"><div class="ellipsis">${esc(x.b.name)}</div><div class="sub ellipsis">${esc(x.reason)}</div></div>
            ${a.avg ? scoreHTML(a.avg.toFixed(1)) : ''}
            <button class="btn-sq thin" style="width:36px;height:36px" data-go="#/save/${x.b.id}" aria-label="${isSaved(x.b.id) ? 'Saved' : 'Save'}">${icon(isSaved(x.b.id) ? 'bookmarkCheck' : 'bookmark', 'sm')}</button>
          </div>`;
        }).join('')}</div>`).join('') : `<div class="empty">Log a few places and follow some critics — recs show up here.</div>`}</div>`;
    } else if (tab === 'guides') {
      const trend = trending(10);
      const trendShelf = trend.length ? `
        <div class="section-title" style="margin-top:8px"><span>Trending <span class="muted small">· last 7 days</span></span><button class="link" data-go="#/trending">See all${icon('chevron', 'sm')}</button></div>
        <div class="rail flush">${trend.map(x => `<button class="rail-item" data-go="#/b/${x.b.id}">
          ${ph(x.b, { w: 300, cls: 'rail-photo', label: phLabel(x.b), go: false })}
          <div class="rail-name ellipsis">${esc(x.b.name)}</div>
          <div class="rail-meta muted">${x.n} log${x.n === 1 ? '' : 's'} this week</div>
        </button>`).join('')}</div>` : '';
      const guides = buildGuides(state.me);
      body = `<div class="pad">${trendShelf}${guides.length ? guides.map(g => `
        <div class="section-title" style="margin-top:8px"><span>${esc(g.title)} <span class="muted small">· ${esc(g.sub)}</span></span><button class="link" data-go="#/guide/${g.dim}/${encodeURIComponent(g.key)}">See all${icon('chevron', 'sm')}</button></div>
        <div class="rail flush">${g.items.slice(0, 10).map(b => `<button class="rail-item" data-go="#/b/${b.id}">
          ${ph(b, { w: 300, cls: 'rail-photo', label: phLabel(b), go: false })}
          <div class="rail-name ellipsis">${esc(b.name)}</div>
          <div class="rail-meta muted">${esc(b.city || '')}</div>
        </button>`).join('')}</div>`).join('') : (trendShelf ? '' : `<div class="empty">Nothing to group yet.</div>`)}</div>`;
    } else {
      const vs = visitsBy(state.me).filter(v => BY_ID[v.buildingId]).sort((a, b) => b.stars - a.stars || b.createdAt - a.createdAt);
      const beenCover = vs.length && BY_ID[vs[0].buildingId];
      const wantItems = state.want.filter(w => w.userId === state.me).sort((a, b) => b.createdAt - a.createdAt);
      const want = wantItems.length;
      const wantCover = want && BY_ID[wantItems[0].buildingId];
      const lists = myLists();
      body = `<div class="stack-6 pad">
        ${!vs.length && !want && !lists.length ? `<div class="empty">Lists are how you collect places — start with Want to Visit, or make your own to share with friends, like "Chicago rooftop bars."</div>` : ''}
        <button class="row" data-go="#/list/been">
          ${beenCover ? ph(beenCover, { w: 160, style: 'width:52px;height:52px', go: false }) : `<div class="list-icon">${icon('check')}</div>`}
          <div class="grow"><b>Been</b><div class="sub">${vs.length} place${vs.length === 1 ? '' : 's'} logged · only you</div></div>
          ${icon('chevron', 'sm')}
        </button>
        <button class="row" data-go="#/list/want">
          ${wantCover ? ph(wantCover, { w: 160, style: 'width:52px;height:52px', go: false }) : `<div class="list-icon">${icon('bookmark')}</div>`}
          <div class="grow"><b>Want to Visit</b><div class="sub">${want} place${want === 1 ? '' : 's'} · only you</div></div>
          ${icon('chevron', 'sm')}
        </button>
        ${lists.map(l => `<button class="row" data-go="#/list/${l.id}">
          ${listTile(l)}
          <div class="grow"><b class="ellipsis">${esc(l.name)}</b><div class="sub ellipsis">${esc(listMeta(l))}</div></div>
          <div class="avatars">${l.members.slice(0, 3).map(m => user(m)).filter(Boolean).map(u => avatar(u, 'xs').replace('data-go', 'data-x')).join('')}</div>
        </button>`).join('')}
      </div>
      <div class="pad" style="margin-top:14px;display:flex;gap:10px">
        <button class="btn block dashed" style="height:52px" data-go="#/newlist">${icon('plus', 'sm')}New list</button>
        <button class="btn block dashed" style="height:52px" data-go="#/discover-lists">${icon('search', 'sm')}Discover</button>
      </div>`;
    }
    return `<div class="screen with-nav">
      <div class="topbar"><div class="h1">Lists</div><button class="btn-sq thin" data-go="#/newlist" aria-label="New list">${icon('plus')}</button></div>
      ${tabs}${body}
      <div class="spacer"></div>
    </div>${nav('lists')}`;
  }

  function placeRow(b, sub, remove) {
    return `<div class="row" data-go="#/b/${b.id}">
      ${ph(b, { w: 120, style: 'width:44px;height:44px', go: false })}
      <div class="grow"><div class="ellipsis">${esc(b.name)}</div><div class="sub ellipsis">${esc(sub)}</div></div>
      ${remove || ''}
    </div>`;
  }

  function viewWantList() {
    const items = state.want.filter(w => w.userId === state.me).sort((a, b) => b.createdAt - a.createdAt);
    const rows = items.map(w => {
      const b = BY_ID[w.buildingId]; if (!b) return '';
      return placeRow(b, makerLine(b), `<button class="btn-sq thin" style="width:34px;height:34px" data-act="unwant" data-id="${b.id}" aria-label="Remove">${icon('x', 'sm')}</button>`);
    }).join('');
    return `<div class="screen with-nav">
      <div class="topbar"><button class="btn-sq thin" data-act="back" aria-label="Back">${icon('back')}</button><div class="h1 grow">Want to Visit</div></div>
      ${items.length >= 2 ? `<div class="pad" style="padding-bottom:12px"><button class="btn dashed" style="width:100%;height:48px" data-go="#/crawl/want">${icon('navigate', 'sm')}Plan a Crawl</button></div>` : ''}
      <div class="stack-6 pad">${rows || '<div class="empty">Nothing saved yet.<br>Tap Save on any place.</div>'}</div>
      <div class="spacer"></div>
    </div>${nav('lists')}`;
  }

  function viewDiscoverLists() {
    const lists = state.lists.filter(l => l.public).sort((a, b) => b.createdAt - a.createdAt);
    const rows = lists.length ? lists.map(l => {
      const owner = user(l.ownerId);
      return `<button class="row" data-go="#/list/${l.id}">
        ${listTile(l)}
        <div class="grow"><b class="ellipsis">${esc(l.name)}</b><div class="sub ellipsis">${l.items.length} place${l.items.length === 1 ? '' : 's'}${owner ? ' · by @' + esc(owner.handle) : ''}</div></div>
        ${icon('chevron', 'sm')}
      </button>`;
    }).join('') : `<div class="empty">No public lists yet. Make one discoverable when you create it.</div>`;
    return `<div class="screen with-nav">
      <div class="topbar"><button class="btn-sq thin" data-act="back" aria-label="Back">${icon('back')}</button><div class="h1 grow">Discover Lists</div></div>
      <div class="stack-6 pad">${rows}</div>
      <div class="spacer"></div>
    </div>${nav('lists')}`;
  }

  function viewBeenList() {
    const vs = visitsBy(state.me).filter(v => BY_ID[v.buildingId]).sort((a, b) => b.stars - a.stars || b.createdAt - a.createdAt);
    const rows = vs.map((v, i) => {
      const b = BY_ID[v.buildingId];
      return `<button class="row" data-go="#/b/${b.id}">
        <span class="rank">${i + 1}</span>
        ${ph(b, { w: 120, style: 'width:44px;height:44px', go: false })}
        <div class="grow"><div class="ellipsis">${esc(b.name)}</div><div class="sub ellipsis">${esc(b.city)} · ${fmtDate(v.visitedOn)}</div></div>
        ${starsHTML(v.stars)}
      </button>`;
    }).join('');
    return `<div class="screen with-nav">
      <div class="topbar"><button class="btn-sq thin" data-act="back" aria-label="Back">${icon('back')}</button><div class="h1 grow">Been</div></div>
      <div class="stack-6 pad">${rows || '<div class="empty">You haven’t logged anything yet.<br>Tap the + to throw shade at your first place.</div>'}</div>
      <div class="spacer"></div>
    </div>${nav('lists')}`;
  }

  function viewList(id) {
    const l = state.lists.find(x => x.id === id);
    const member = l && l.members.includes(state.me);
    if (!l || (!member && !l.public)) return viewNotFound();
    const rows = l.items.slice().sort((a, b) => b.createdAt - a.createdAt).map(it => {
      const b = BY_ID[it.buildingId]; if (!b) return '';
      const adder = user(it.addedBy);
      const canRemove = member && (it.addedBy === state.me || l.ownerId === state.me);
      return placeRow(b, [b.city, adder && (adder.id === state.me ? 'added by you' : 'added by @' + adder.handle)].filter(Boolean).join(' · '),
        canRemove ? `<button class="btn-sq thin" style="width:34px;height:34px" data-act="unlist" data-list="${l.id}" data-id="${b.id}" aria-label="Remove">${icon('x', 'sm')}</button>` : '');
    }).join('');
    const members = l.members.map(user).filter(Boolean);
    const leaderboard = members.length > 1 ? members.map(u => ({ u, n: l.items.filter(it => it.addedBy === u.id).length }))
      .sort((a, b) => b.n - a.n) : [];
    return `<div class="screen with-nav">
      <div class="topbar"><button class="btn-sq thin" data-act="back" aria-label="Back">${icon('back')}</button><div class="h1 grow ellipsis">${esc(l.name)}</div>
        ${member ? `<button class="btn-sq thin" data-go="#/list/${l.id}/invite" aria-label="Invite people">${icon('users')}</button>` : ''}</div>
      <div class="pad members" ${member ? `data-go="#/list/${l.id}/invite"` : ''}>
        <div class="avatars">${members.slice(0, 5).map(u => avatar(u, 'xs').replace('data-go', 'data-x')).join('')}</div>
        <span class="small muted">${members.length} member${members.length === 1 ? '' : 's'} · ${l.ownerId === state.me ? 'you made this list' : 'made by @' + esc(user(l.ownerId).handle)}${l.public ? ' · public' : ''}</span>
        ${member ? '<span class="small" style="margin-left:auto">Invite</span>' : ''}
      </div>
      ${l.items.length >= 2 ? `<div class="pad" style="padding-bottom:12px"><button class="btn dashed" style="width:100%;height:48px" data-go="#/crawl/${l.id}">${icon('navigate', 'sm')}Plan a Crawl</button></div>` : ''}
      ${leaderboard.length ? `<div class="pad" style="padding-bottom:8px"><div class="section-title tight">Who's added the most</div>
        <div class="stack-6">${leaderboard.map((x, i) => `<div class="row" data-go="#/u/${x.u.id}">
          <span class="rank">${i + 1}</span>${avatar(x.u)}
          <div class="grow">${x.u.id === state.me ? 'You' : '@' + esc(x.u.handle)}</div>
          <b>${x.n}</b>
        </div>`).join('')}</div></div>` : ''}
      <div class="stack-6 pad">${rows || '<div class="empty">No places yet.<br>Tap Save on any place to add it here.</div>'}</div>
      <div class="spacer"></div>
    </div>${nav('lists')}`;
  }

  // Name + invite picker, used by "New list" and inside the save sheet.
  function newListForm(bid) {
    const others = state.users.filter(u => u.id !== state.me);
    return `<div class="field"><label for="nl-name">List name</label><input id="nl-name" class="input" placeholder="e.g. Brutalist crawl" maxlength="40" autocomplete="off"></div>
      <div class="field"><div class="label">Invite people <span class="muted" style="font-weight:400">optional</span></div>
        <div class="chips">${others.map(u => `<button class="pill ${inviteSel.has(u.id) ? 'on' : ''}" data-act="pickinvite" data-u="${u.id}">@${esc(u.handle)}</button>`).join('')}</div></div>
      <button class="pill ${newListPublic ? 'on' : ''}" data-act="togglepublic">${icon('search', 'sm')}${newListPublic ? 'Discoverable by everyone' : 'Make discoverable'}</button>
      <button class="btn-primary" data-act="createlist" data-bid="${bid || ''}">Create list</button>`;
  }

  function viewNewList() {
    return sheet('New list', 1, 1, `<button class="btn-sq thin" data-act="closelog" aria-label="Close">${icon('x')}</button>`, newListForm(''));
  }

  function checkRow(act, attrs, on, title, sub, lead) {
    return `<button class="row check-row ${on ? 'on' : ''}" data-act="${act}" ${attrs}>
      ${lead}<div class="grow"><b class="ellipsis">${esc(title)}</b><div class="sub ellipsis">${esc(sub)}</div></div>
      <span class="check">${icon('check', 'sm')}</span>
    </button>`;
  }

  function viewSaveTo(bid) {
    const b = BY_ID[bid];
    if (!b) return viewNotFound();
    const want = state.want.filter(w => w.userId === state.me).length;
    return sheet('Save to list', 1, 1,
      `<button class="btn-sq thin" data-act="closelog" aria-label="Close">${icon('x')}</button>`,
      `<div class="banner" style="display:flex;gap:12px;align-items:center;padding:10px">
         ${ph(b, { w: 120, style: 'width:48px;height:48px', go: false })}
         <div style="line-height:1.3;min-width:0"><b class="ellipsis" style="display:block">${esc(b.name)}</b><div class="small muted ellipsis">${esc(makerLine(b))}</div></div>
       </div>
       <div class="stack-6">
         ${checkRow('togglewant', `data-id="${bid}"`, isWant(state.me, bid), 'Want to Visit', `${want} place${want === 1 ? '' : 's'} · only you`, `<div class="list-icon">${icon('bookmark')}</div>`)}
         ${myLists().map(l => checkRow('togglelist', `data-list="${l.id}" data-id="${bid}"`, inList(l, bid), l.name, listMeta(l), listTile(l))).join('')}
       </div>
       <button class="btn dashed" style="height:48px" data-act="newlistform">${icon('plus', 'sm')}New list</button>
       <div id="newlist" class="stack" hidden>${newListForm(bid)}</div>
       <div class="sheet-foot"><button class="btn-primary" data-act="closelog">Done</button></div>`);
  }

  function viewInvite(id) {
    const l = state.lists.find(x => x.id === id);
    if (!l || !l.members.includes(state.me)) return viewNotFound();
    const others = state.users.filter(u => u.id !== state.me);
    return sheet(`Invite to “${esc(l.name)}”`, 1, 1,
      `<button class="btn-sq thin" data-act="closelog" aria-label="Close">${icon('x')}</button>`,
      `<div class="small muted">Members can see the list and add places to it.</div>
       <div class="stack-6">${others.map(u => {
         const on = l.members.includes(u.id);
         return checkRow(u.id === l.ownerId ? 'noop' : 'invite', `data-list="${l.id}" data-u="${u.id}"`, on, u.name,
           '@' + u.handle + (u.id === l.ownerId ? ' · owner' : ''), avatar(u).replace('data-go', 'data-x'));
       }).join('')}</div>
       <div class="sheet-foot"><button class="btn-primary" data-act="closelog">Done</button></div>`);
  }

  function viewBuilding(id) {
    const b = BY_ID[id];
    if (!b) return viewNotFound();
    const a = avgFor(b.id), mv = myVisit(b.id);
    const fids = followingIds(state.me);
    const vs = visitsFor(b.id).sort((x, y) =>
      (y.userId === state.me) - (x.userId === state.me) || fids.has(y.userId) - fids.has(x.userId) || y.createdAt - x.createdAt);
    const photos = vs.flatMap(v => v.photos);
    const likeCounts = {};
    vs.forEach(v => v.likes.forEach(l => { likeCounts[l] = (likeCounts[l] || 0) + 1; }));
    const liked = Object.entries(likeCounts).sort((x, y) => y[1] - x[1]);
    const want = isWant(state.me, b.id);
    let tabBody;
    if (bTab === 'photos') {
      tabBody = photos.length
        ? `<div class="photo-grid">${(g => photos.map((p, i) => `<button class="ph photo" data-act="viewphoto" data-g="${g}" data-i="${i}" style="background-image:url('${p}');background-size:cover;background-position:center" aria-label="View photo ${i + 1}"></button>`).join(''))(gallery(photos))}</div>`
        : `<div class="empty">No photos yet. Log a visit to add the first.</div>`;
    } else {
      tabBody = vs.length ? vs.map(v => {
        const u = user(v.userId); if (!u) return '';
        return `<div style="display:flex;gap:10px">
          ${avatar(u)}
          <div class="grow" style="line-height:1.4">
            <b data-go="#/u/${u.id}">${v.userId === state.me ? 'You' : esc(u.handle)}</b> · ${starsHTML(v.stars)}
            <span class="small muted"> · ${fmtDate(v.visitedOn)}</span>
            ${v.note ? `<div>${esc(v.note)}</div>` : ''}
            ${likeChips(v.likes)}
            ${shotsHTML(v.photos)}
            <button class="link" data-go="#/comments/${v.id}">${icon('feed', 'sm')}${(v.comments || []).length ? `${v.comments.length} comment${v.comments.length === 1 ? '' : 's'}` : 'Comment'}</button>
          </div></div>`;
      }).join('') : `<div class="empty">No critiques yet. Be the first to throw shade.</div>`;
    }
    // Credit the Commons photographer whenever the hero is the Commons image (not a user's photo).
    const heroIsCommons = !photoFor(b.id) && b.image;
    const credit = heroIsCommons && b.credit
      ? `<div class="credit">Photo: ${esc(b.credit.artist)}${b.credit.license ? ' · ' + esc(b.credit.license) : ''} · <a href="${esc(b.credit.page)}" target="_blank" rel="noopener">Wikimedia Commons</a></div>`
      : heroIsCommons ? `<div class="credit"><a href="${esc(commonsURL(b.image, 1200))}" target="_blank" rel="noopener">Photo: Wikimedia Commons</a></div>` : '';
    const q = encodeURIComponent(b.name + (b.city ? ' ' + b.city : ''));
    const links = [
      b.wiki && `<a class="chip" href="${esc(b.wiki)}" target="_blank" rel="noopener">Wikipedia${icon('external', 'sm')}</a>`,
      b.osm && `<a class="chip" href="https://www.openstreetmap.org/${esc(b.osm)}" target="_blank" rel="noopener">OpenStreetMap${icon('external', 'sm')}</a>`,
      `<a class="chip dashed" href="https://www.archdaily.com/search/all?q=${encodeURIComponent(b.name)}" target="_blank" rel="noopener">ArchDaily${icon('external', 'sm')}</a>`,
      `<a class="chip dashed" href="https://www.dezeen.com/?s=${q}" target="_blank" rel="noopener">Dezeen${icon('external', 'sm')}</a>`,
    ].filter(Boolean).join('');
    const adder = b.addedBy && user(b.addedBy);
    return `<div class="screen with-nav">
      ${ph(b, { cls: 'hero', w: 1000, label: phLabel(b), go: false, inner: `
        <button class="btn-sq left" data-act="back" aria-label="Back">${icon('back')}</button>
        <div class="hero-ratings">
          <span class="hero-rating" title="Community rating">${a.avg ? `${starSVG('currentColor', 'currentColor')}<b>${a.avg.toFixed(1)}</b><span class="muted">· ${a.n} log${a.n === 1 ? '' : 's'}</span>` : '<span class="muted">No ratings yet</span>'}</span>
          ${mv ? `<span class="hero-rating mine" title="Your rating">You ${starSVG('currentColor', 'currentColor')}<b>${mv.stars}</b></span>` : ''}
        </div>` })}
      ${credit}
      <div class="pad stack" style="padding-top:16px">
        <div><div class="h-building">${esc(b.name)}</div>
          <div class="muted" style="margin-top:2px">${[architectsOf(b).length ? architectsOf(b).map(archLink).join(' · ') : esc(b.architect || ''), ...[b.year, b.typology, b.city].filter(Boolean).map(x => esc(String(x)))].filter(Boolean).join(' · ')}</div>
          ${factIcons(b) ? `<button class="fact-icons" data-act="tofacts" aria-label="See recognition">${factIcons(b)}</button>` : ''}</div>
        <div class="chips"><span class="chip"><span class="dot" style="background:${styleColor(b)}"></span>${esc(b.style)}</span>${kindOf(b) !== 'building' ? `<span class="chip dashed">${KINDS[kindOf(b)]}</span>` : ''}${b.country ? `<span class="chip dashed">${esc(b.country)}</span>` : ''}</div>
        ${liked.length ? `<div><div class="caps" style="margin-bottom:8px">What people like</div><div class="chips">${liked.map(([l, n]) => `<span class="chip">${esc(l)}<b class="count">${n}</b></span>`).join('')}</div></div>` : ''}
        <div class="action-row">
          <button class="btn-primary" data-go="#/log/${b.id}">${mv ? 'Edit your critique' : 'Throw Shade'}</button>
          <button class="btn-ic ${isSaved(b.id) ? 'on' : ''}" data-go="#/save/${b.id}" aria-label="${isSaved(b.id) ? 'Saved' : 'Save'}" title="${isSaved(b.id) ? 'Saved' : 'Save'}">${icon(isSaved(b.id) ? 'bookmarkCheck' : 'bookmark')}</button>
          <a class="btn-ic" href="https://www.google.com/maps/search/?api=1&query=${b.lat},${b.lng}" target="_blank" rel="noopener" aria-label="Directions" title="Directions">${icon('navigate')}</a>
        </div>
        <button class="btn dashed" style="width:100%;height:48px" data-go="#/radio/${b.id}">${icon('layers', 'sm')}Similar Places</button>
        <div class="about">
          <div class="bold">About</div>
          ${b.blurb ? `<div class="quote">${esc(b.blurb)}</div>` : b.enriching ? '<div class="muted small">Looking up Wikipedia…</div>' : ''}
          ${b.address ? `<div class="small muted">${esc(b.address)}</div>` : ''}
          <div class="small muted">${b.lat.toFixed(5)}, ${b.lng.toFixed(5)}${adder ? ` · pinned by @${esc(adder.handle)}` : ''}</div>
          <div class="chips">${links}</div>
          ${factsHTML(b)}
        </div>
        ${visitTimingHTML(b)}
        ${relatedRailsHTML(b)}
        <div class="tabs">
          <button class="${bTab === 'critiques' ? 'on' : ''}" data-act="btab" data-k="critiques">Critiques · ${vs.length}</button>
          <button class="${bTab === 'photos' ? 'on' : ''}" data-act="btab" data-k="photos">Photos · ${photos.length}</button>
        </div>
        ${tabBody}
      </div>
      <div class="spacer"></div>
    </div>${nav('')}`;
  }

  function viewProfile(uid) {
    const u = user(uid);
    if (!u) return viewNotFound();
    const own = uid === state.me;
    const vs = visitsBy(uid);
    const cities = new Set(vs.map(v => BY_ID[v.buildingId] && (BY_ID[v.buildingId].city || BY_ID[v.buildingId].country))).size;
    // Full critique cards: their photos (or the place's), place, date, stars, note and tags.
    const recent = vs.slice().sort((a, b) => b.createdAt - a.createdAt).map(v => {
      const b = BY_ID[v.buildingId]; if (!b) return '';
      const where = [kindOf(b) !== 'building' && KINDS[kindOf(b)], b.city, fmtDate(v.visitedOn)].filter(Boolean).join(' · ');
      return `<div class="crit-card">
        ${v.photos && v.photos.length ? shotsHTML(v.photos) : ph(b, { w: 600, cls: 'crit-photo', label: phLabel(b) })}
        <div class="crit-body">
          <div class="row-flex" style="align-items:flex-start">
            <div class="grow" style="min-width:0"><b class="crit-name" data-go="#/b/${b.id}">${esc(b.name)}</b><div class="small muted ellipsis">${esc(where)}</div></div>
            <span class="chip" style="flex-shrink:0"><span class="dot" style="background:${styleColor(b)}"></span>${esc(b.style)}</span>
          </div>
          <div class="rating-line">${starsHTML(v.stars, 'md')}<span class="small muted">${STAR_WORDS[v.stars]}</span></div>
          ${v.note ? `<div class="quote">${esc(v.note)}</div>` : ''}
          ${likeChips(v.likes)}
          <div class="card-actions">${v.userId === state.me ? `<button class="link" data-go="#/log/${b.id}">${icon('edit', 'sm')}Edit</button>` : `<button class="link ${isSaved(b.id) ? 'on' : ''}" data-go="#/save/${b.id}">${isSaved(b.id) ? icon('bookmarkCheck', 'sm') + 'Saved' : icon('bookmark', 'sm') + 'Save'}</button>`}<button class="link" data-go="#/b/${b.id}">Details${icon('chevron', 'sm')}</button></div>
        </div>
      </div>`;
    }).join('');

    const following = isFollowing(state.me, uid);
    return `<div class="screen with-nav">
      <div class="topbar" style="padding-bottom:0">${own ? '<div class="grow"></div>' : `<button class="btn-sq thin" data-act="back" aria-label="Back">${icon('back')}</button><div class="grow"></div>`}
      </div>
      <div style="display:flex;gap:14px;align-items:center;padding:16px 20px">
        ${avatar(u, 'lg').replace('data-go', 'data-x')}
        <div class="grow" style="line-height:1.3"><b style="font-size:20px">${esc(u.name)}</b><div class="muted">@${esc(u.handle)}</div>${u.bio ? `<div class="small">${esc(u.bio)}</div>` : (own ? `<div class="small muted" data-go="#/editprofile">Add a bio</div>` : '')}</div>
        ${own ? `<div style="width:25%;flex-shrink:0;display:flex;justify-content:center"><button class="btn-sq thin" data-go="#/editprofile" aria-label="Edit profile">${icon('edit')}</button></div>` : ''}
      </div>
      <div class="stat-table" style="margin:0 20px">
        <div><b>${vs.length}</b><div class="tiny muted">Logged</div></div>
        <div><b>${cities}</b><div class="tiny muted">Cities</div></div>
        <div data-go="#/followers/${uid}"><b>${followerCount(uid)}</b><div class="tiny muted">Followers</div></div>
        <div data-go="#/following/${uid}"><b>${followingIds(uid).size}</b><div class="tiny muted">Following</div></div>
      </div>
      ${own ? '' : `<div class="pad" style="margin-top:14px">${following
        ? `<button class="btn ghost" style="width:100%;height:48px;font-weight:600" data-act="follow" data-id="${uid}">${icon('check', 'sm')}Following</button>`
        : `<button class="btn-primary" style="height:48px" data-act="follow" data-id="${uid}">Follow</button>`}</div>`}
      ${own ? '' : (() => {
        const c = compatibility(state.me, uid);
        return c ? `<div class="pad" style="margin-top:10px"><div class="banner" style="display:flex;align-items:center;gap:12px">
          <b style="font-size:22px">${c.pct}%</b>
          <div class="small muted">Taste match · ${c.n} shared place${c.n === 1 ? '' : 's'}</div>
        </div></div>` : '';
      })()}
      ${own ? '' : `<div class="pad" style="margin-top:10px"><button class="btn dashed" style="width:100%;height:48px" data-go="#/compare/${uid}">${icon('layers', 'sm')}Head-to-Head</button></div>`}
      ${!own && u.private && !isFollowing(state.me, uid) ? `<div class="pad" style="padding-top:14px"><div class="banner" style="text-align:center">\ud83d\udd12 <b>Private account</b><div class="small muted">Follow @${esc(u.handle)} to see their logs.</div></div></div>` : ''}
      <div class="pad" style="padding-top:14px">
        <div class="tabs">
          <button class="${pTab === 'critiques' ? 'on' : ''}" data-act="ptab" data-k="critiques">Critiques · ${vs.length}</button>
          <button class="${pTab === 'calendar' ? 'on' : ''}" data-act="ptab" data-k="calendar">Calendar</button>
          <button class="${pTab === 'collections' ? 'on' : ''}" data-act="ptab" data-k="collections">Collections</button>
          <button class="${pTab === 'stats' ? 'on' : ''}" data-act="ptab" data-k="stats">Stats</button>
        </div>
      </div>
      <div class="pad" style="padding-top:16px;display:flex;flex-direction:column;gap:18px">
        ${pTab === 'calendar' ? calendarHTML(uid) : pTab === 'collections' ? collectionsHTML(uid) : pTab === 'stats' ? `
        ${(() => {
          const lvl = levelFor(uid), streak = streakWeeks(uid);
          const pct = lvl.next ? Math.round((lvl.xp - lvl.floor) / (lvl.next[0] - lvl.floor) * 100) : 100;
          return `<div class="level-card">
            <div class="row-flex" style="align-items:center"><b class="grow" style="font-size:17px">${esc(lvl.title)}</b>${streak >= 2 ? `<span class="chip">${icon('flame', 'sm')}${streak}-week streak</span>` : ''}</div>
            <div class="bar"><div style="width:${pct}%"></div></div>
            <div class="small muted">${lvl.xp} XP${lvl.next ? ` · ${lvl.next[0] - lvl.xp} XP to ${esc(lvl.next[1])}` : ' · Max level'}</div>
          </div>`;
        })()}
        ${own ? (() => {
          const chs = challengesFor(uid);
          return `<button class="banner" data-go="#/challenges" style="display:flex;flex-direction:column;gap:8px;text-align:left;width:100%">
            <div class="row-flex" style="justify-content:space-between;align-items:center"><b class="small">This week's challenges</b><span class="small muted">${chs.filter(c => c.done).length}/3</span></div>
            ${chs.map(ch => `<div class="row-flex" style="align-items:center;gap:8px"><span class="grow small">${ch.done ? '✓ ' : ''}${esc(ch.label)}</span><span class="tiny muted">${ch.count}/${ch.target}</span></div>`).join('')}
          </button>`;
        })() : ''}
        ${(() => {
          const badges = badgesFor(uid);
          const earned = badges.filter(x => x.earned).length;
          return `<div><div class="section-title">Badges<button class="link" data-go="#/badges/${uid}">${earned} of ${badges.length} \u00b7 See all${icon('chevron', 'sm')}</button></div>
            <div class="badge-grid">${badges.map(x => `<div class="badge-tile ${x.earned ? 'on' : 'locked'}" title="${esc(x.desc)}">
              <div class="badge-icon">${x.icon}</div>
              <div class="badge-label">${esc(x.label)}</div>
            </div>`).join('')}</div>
          </div>`;
        })()}
        ${vs.length ? `<button class="wrap-cta" data-go="#/wrapped/${uid}">
          <span class="wrap-cta-dots">${Object.values(STYLES).slice(0, 4).map(c => `<i style="background:${c}"></i>`).join('')}</span>
          <span class="grow"><b>${own ? 'Your Wrapped' : esc(u.name.split(' ')[0]) + '’s Wrapped'}</b><span class="small">${vs.length} building${vs.length === 1 ? '' : 's'}, one recap</span></span>
          ${icon('chevron', 'sm')}</button>` : ''}
        ${own ? `<button class="row" data-go="#/leaderboard">
          <div class="list-icon">${icon('users')}</div>
          <div class="grow"><b>Friend Leaderboard</b><div class="sub">Who's logged the most this month</div></div>
          ${icon('chevron', 'sm')}
        </button>` : ''}
        ${own ? (() => {
          const rival = bestRival(uid);
          if (!rival) return '';
          const ru = user(rival.uid);
          return `<button class="row" data-go="#/compare/${ru.id}">
            ${avatar(ru)}
            <div class="grow"><b>Compare with @${esc(ru.handle)}</b><div class="sub">${rival.pct}% taste match · your closest match</div></div>
            ${icon('chevron', 'sm')}
          </button>`;
        })() : ''}
        ` : `
        <div><div class="section-title tight">Where ${own ? 'you’ve' : esc(u.name.split(' ')[0]) + ' has'} been<span class="small muted" style="font-weight:400">${cities} ${cities === 1 ? 'city' : 'cities'}</span></div>
          <div class="been-wrap">
            <div id="beenmap" class="been-map">${vs.length ? '' : '<div class="map-fallback">Log a place to start your map.</div>'}</div>
            ${vs.length ? `<button class="btn-sq map-heatbtn ${beenHeat ? 'on' : ''}" data-act="beenheat" aria-label="Toggle heatmap">${icon('flame')}</button>
            <button class="btn-sq map-locate" data-act="beenfit" aria-label="Show everywhere">${icon('locate')}</button>
            <div id="been-card"></div>` : ''}
          </div></div>
        <div class="crit-list">${recent || '<div class="empty">Nothing logged yet.</div>'}</div>
        `}
        ${own ? `<button class="theme-toggle ${currentTheme() === 'dark' ? 'on' : ''}" data-act="theme" aria-pressed="${currentTheme() === 'dark'}">${icon(currentTheme() === 'dark' ? 'moon' : 'sun')}<b class="grow">Dark mode</b><span class="switch"></span></button>` : ''}
        ${own ? `<button class="btn block ghost" data-go="#/settings">${icon('sliders', 'sm')}Account settings</button>` : ''}
        ${own ? `<button class="btn block ghost" data-act="switch">${icon('switch', 'sm')}Switch account</button>` : ''}
      </div>
      <div class="spacer"></div>
    </div>${nav(own ? 'you' : '')}`;
  }

  // Same look as the Map tab: style-coloured pins, clustered when zoomed out, a card for the tapped place.
  function beenPinIcon(b) {
    return window.L.divIcon({ className: '', html: `<div class="pin k-${kindOf(b)} ${beenSel === b.id ? 'sel' : ''} ${beenHeat ? 'dim' : ''}" style="--c:${styleColor(b)}"></div>`, iconSize: [20, 20], iconAnchor: [10, 10] });
  }
  function renderBeenCard(uid) {
    const el = document.getElementById('been-card');
    if (!el) return;
    const b = BY_ID[beenSel];
    if (!b) { el.innerHTML = ''; return; }
    const v = visitsBy(uid).find(x => x.buildingId === b.id);
    const own = uid === state.me;
    el.innerHTML = `<button class="map-card" data-go="#/b/${b.id}">
      ${ph(b, { w: 160, style: 'width:56px;height:56px', go: false })}
      <div class="grow" style="line-height:1.3;min-width:0"><b class="ellipsis" style="display:block">${esc(b.name)}</b><div class="small muted ellipsis">${esc(byLine(b))}</div>
        <div class="small">${esc(b.city || b.country || '')}${v && v.visitedOn ? ` · ${fmtDate(v.visitedOn)}` : ''}</div></div>
      ${v ? `<div style="font-size:18px;text-align:right">${scoreHTML(v.stars)}<div class="small muted">${own ? 'you' : esc(user(uid).name.split(' ')[0])}</div></div>` : ''}
    </button>`;
  }
  function initBeenMap(uid) {
    const el = document.getElementById('beenmap');
    if (!el || !window.L) return;
    const places = [...new Set(visitsBy(uid).map(v => v.buildingId))].map(id => BY_ID[id]).filter(Boolean);
    if (!places.length) return;
    if (beenUid !== uid) { beenUid = uid; beenSel = null; }
    beenMap = window.L.map(el, { zoomControl: false, attributionControl: true, scrollWheelZoom: false, worldCopyJump: true });
    window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors', maxZoom: 19 }).addTo(beenMap);
    const markers = {};
    const group = window.L.markerClusterGroup ? window.L.markerClusterGroup({ maxClusterRadius: 46, spiderfyOnMaxZoom: true, showCoverageOnHover: false }) : window.L.layerGroup();
    places.forEach(b => {
      const m = window.L.marker([b.lat, b.lng], { icon: beenPinIcon(b) });
      m.on('click', () => {
        const prev = beenSel; beenSel = b.id;
        [prev, b.id].forEach(id => { if (markers[id]) markers[id].setIcon(beenPinIcon(BY_ID[id])); });
        renderBeenCard(uid);
      });
      markers[b.id] = m;
      group.addLayer(m);
    });
    beenMap.addLayer(group);
    if (beenHeat && window.L.heatLayer) {
      window.L.heatLayer(visitsBy(uid).map(v => BY_ID[v.buildingId]).filter(Boolean).map(b => [b.lat, b.lng, 1]), {
        radius: 34, blur: 28, maxZoom: 17, minOpacity: .35,
        gradient: { 0.2: '#ffd60a', 0.45: '#ff9f1c', 0.7: '#ff4d6d', 1: '#c1121f' },
      }).addTo(beenMap);
    }
    fitBeenMap(places);
    renderBeenCard(uid);
    setTimeout(() => beenMap && beenMap.invalidateSize(), 0);
  }
  function fitBeenMap(places) {
    if (!beenMap || !places.length) return;
    if (places.length === 1) beenMap.setView([places[0].lat, places[0].lng], 14);
    else beenMap.fitBounds(places.map(b => [b.lat, b.lng]), { padding: [36, 36], maxZoom: 14 });
  }

  // Architecture crawl: greedy nearest-neighbour ordering starting from the viewer's location.
  function crawlOrder(items) {
    const remaining = items.slice();
    const order = [];
    let cur = loc;
    while (remaining.length) {
      remaining.sort((a, b) => km(cur, a) - km(cur, b));
      cur = remaining.shift();
      order.push(cur);
    }
    return order;
  }
  // "near" or "near-<Style>": a walk built for you from the best places within ~1.5 km.
  function walkNear(style) {
    const pool = BUILDINGS.filter(b => b.lat && km(loc, b) <= 1.5 && (!style || b.style === style));
    const score = b => (avgFor(b.id).avg || 0) * 2 + (b.image ? 2 : 0) + (b.wiki ? 1 : 0) + (b.architect ? 1 : 0) - km(loc, b);
    return pool.sort((a, b) => score(b) - score(a)).slice(0, 6);
  }
  function crawlItems(listId) {
    if (/^near/.test(listId || '')) return walkNear(decodeURIComponent(listId.slice(5)) || null);
    if (listId === 'want') return state.want.filter(w => w.userId === state.me).map(w => BY_ID[w.buildingId]).filter(Boolean);
    const l = state.lists.find(x => x.id === listId);
    return l ? l.items.map(it => BY_ID[it.buildingId]).filter(Boolean) : [];
  }
  function viewCrawl(listId) {
    const items = crawlItems(listId);
    const near = /^near/.test(listId || ''), style = near ? decodeURIComponent(listId.slice(5)) : '';
    const styleChips = near ? `<div class="pills" style="padding:0 20px 12px">${['', 'Modernist', 'Brutalist', 'Art Deco', 'Contemporary', 'Historic', 'Postmodern'].map(st =>
      `<button class="pill ${st === style ? 'on' : ''}" data-go="#/crawl/near${st ? '-' + encodeURIComponent(st) : ''}">${st || 'Best nearby'}</button>`).join('')}</div>` : '';
    if (items.length < 2) {
      return `<div class="screen with-nav">
        <div class="topbar"><button class="btn-sq thin" data-act="back" aria-label="Back">${icon('back')}</button><div class="h1 grow">Crawl Route</div></div>
        ${styleChips}<div class="pad">${near && !loc ? locPrompt() : `<div class="empty">${near ? 'Not enough places within 1.5 km of you for a walk \u2014 try another style, or a different spot.' : 'Need at least 2 places on this list to plan a crawl.'}</div>`}</div>
      </div>${nav('lists')}`;
    }
    const order = crawlOrder(items);
    let total = 0;
    const legs = order.map((b, i) => { const prev = i === 0 ? loc : order[i - 1]; const d = km(prev, b); total += d; return { b, d }; });
    const mins = Math.round(total / 5 * 60); // ~5 km/h walking pace
    const waypoints = order.slice(0, -1).map(b => `${b.lat},${b.lng}`).join('|');
    const dest = order[order.length - 1];
    const gmaps = `https://www.google.com/maps/dir/?api=1&origin=${loc.lat},${loc.lng}&destination=${dest.lat},${dest.lng}${waypoints ? '&waypoints=' + encodeURIComponent(waypoints) : ''}&travelmode=walking`;
    const rows = legs.map((leg, i) => `<button class="row" data-go="#/b/${leg.b.id}">
        <span class="rank">${i + 1}</span>
        ${ph(leg.b, { style: 'width:44px;height:44px', go: false })}
        <div class="grow"><div class="ellipsis">${esc(leg.b.name)}</div><div class="sub">${fmtKm(leg.d)} from ${i === 0 ? 'you' : 'previous stop'}</div></div>
      </button>`).join('');
    return `<div class="screen with-nav">
      <div class="topbar"><button class="btn-sq thin" data-act="back" aria-label="Back">${icon('back')}</button><div class="h1 grow">${near ? 'Walk near you' : 'Crawl Route'}</div></div>
      ${styleChips}
      <div class="pad"><div class="walk-map" id="walk-map"></div></div>
      <div class="pad"><div class="banner" style="display:flex;justify-content:space-between;align-items:center"><b>${fmtKm(total)} total</b><span class="small muted">~${mins} min walk · ${order.length} stops</span></div></div>
      <div class="stack-6 pad">${rows}</div>
      <div class="pad"><a class="btn-primary" href="${gmaps}" target="_blank" rel="noopener">${icon('navigate', 'sm')}Open full route in Maps</a></div>
      <div class="spacer"></div>
    </div>${nav('lists')}`;
  }
  // Numbered stops joined by a dashed line, starting from where you are.
  let walkMap = null;
  function initWalkMap(order) {
    const el = document.getElementById('walk-map');
    if (!el || !window.L || order.length < 2) return;
    if (walkMap) { walkMap.remove(); walkMap = null; }
    walkMap = window.L.map(el, { zoomControl: false, attributionControl: false, dragging: true });
    window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(walkMap);
    const pts = [[loc.lat, loc.lng]].concat(order.map(b => [b.lat, b.lng]));
    window.L.polyline(pts, { color: '#1c1c1e', weight: 3, dashArray: '6 6' }).addTo(walkMap);
    window.L.marker(pts[0], { icon: window.L.divIcon({ className: '', html: '<div class="pin me"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }) }).addTo(walkMap);
    order.forEach((b, i) => window.L.marker([b.lat, b.lng], { icon: window.L.divIcon({ className: '', html: `<div class="walk-stop">${i + 1}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] }) })
      .on('click', () => go('#/b/' + b.id)).addTo(walkMap));
    walkMap.fitBounds(pts, { padding: [24, 24] });
    setTimeout(() => walkMap && walkMap.invalidateSize(), 0);
  }
  function compareStats(a, b) {
    const of = uid => visitsBy(uid).filter(v => BY_ID[v.buildingId]);
    const va = of(a), vb = of(b);
    const citiesOf = vs => new Set(vs.map(v => BY_ID[v.buildingId].city).filter(Boolean)).size;
    const avgOf = vs => vs.length ? vs.reduce((s, v) => s + v.stars, 0) / vs.length : 0;
    const topStyleOf = vs => {
      const m = {}; vs.forEach(v => { const s = BY_ID[v.buildingId].style; if (s) m[s] = (m[s] || 0) + 1; });
      const e = Object.entries(m).sort((x, y) => y[1] - x[1])[0]; return e ? e[0] : '—';
    };
    return {
      logged: [va.length, vb.length], cities: [citiesOf(va), citiesOf(vb)],
      avg: [avgOf(va), avgOf(vb)], style: [topStyleOf(va), topStyleOf(vb)],
      followers: [followerCount(a), followerCount(b)],
    };
  }
  function viewCompare(uid) {
    const other = user(uid);
    if (!other || uid === state.me) return viewNotFound();
    const me = user(state.me);
    const s = compareStats(state.me, uid);
    const c = compatibility(state.me, uid);
    const statRow = (label, [a, b], fmt) => {
      fmt = fmt || (x => x);
      const aWin = a > b, bWin = b > a;
      return `<div class="row-flex" style="justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--line)">
        <b style="width:70px;text-align:left;${aWin ? '' : 'color:var(--text-3);font-weight:400'}">${fmt(a)}</b>
        <span class="small muted" style="flex:1;text-align:center">${esc(label)}</span>
        <b style="width:70px;text-align:right;${bWin ? '' : 'color:var(--text-3);font-weight:400'}">${fmt(b)}</b>
      </div>`;
    };
    return `<div class="screen with-nav">
      <div class="topbar"><button class="btn-sq thin" data-act="back" aria-label="Back">${icon('back')}</button><div class="h1 grow">Head-to-Head</div></div>
      <div class="pad" style="display:flex;align-items:center;justify-content:space-between">
        <div style="text-align:center;width:33%">${avatar(me, 'md').replace('data-go', 'data-x')}<div class="small" style="margin-top:6px"><b>You</b></div></div>
        <div class="h1">VS</div>
        <div style="text-align:center;width:33%">${avatar(other, 'md').replace('data-go', 'data-x')}<div class="small" style="margin-top:6px"><b class="ellipsis">${esc(other.name.split(' ')[0])}</b></div></div>
      </div>
      ${c ? `<div class="pad"><div class="banner" style="text-align:center"><b style="font-size:22px">${c.pct}%</b><div class="small muted">Taste match · ${c.n} shared place${c.n === 1 ? '' : 's'}</div></div></div>` : ''}
      <div class="pad stack-6" style="margin-top:6px">
        ${statRow('Places logged', s.logged)}
        ${statRow('Cities', s.cities)}
        ${statRow('Avg rating', s.avg, x => x ? x.toFixed(1) + '★' : '—')}
        ${statRow('Top style', s.style)}
        ${statRow('Followers', s.followers)}
      </div>
      ${(() => {
        // Shared places, most agreed and most disputed, plus their favourites you haven't seen yet.
        const theirs = new Map(visitsBy(uid).map(v => [v.buildingId, v.stars]));
        const shared = visitsBy(state.me).filter(v => theirs.has(v.buildingId) && BY_ID[v.buildingId])
          .map(v => ({ b: BY_ID[v.buildingId], mine: v.stars, them: theirs.get(v.buildingId), diff: Math.abs(v.stars - theirs.get(v.buildingId)) }));
        const been = new Set(visitsBy(state.me).map(v => v.buildingId));
        const loved = visitsBy(uid).filter(v => v.stars >= 4 && !been.has(v.buildingId) && BY_ID[v.buildingId]).sort((a, b) => b.stars - a.stars).slice(0, 8);
        const row = x => `<button class="row" data-go="#/b/${x.b.id}">${ph(x.b, { style: 'width:40px;height:40px', go: false })}
          <div class="grow ellipsis">${esc(x.b.name)}</div><span class="small" style="white-space:nowrap">You ${x.mine}\u2605 \u00b7 ${esc(other.handle)} ${x.them}\u2605</span></button>`;
        const agree = shared.filter(x => x.diff === 0).slice(0, 5), clash = shared.filter(x => x.diff >= 2).sort((a, b) => b.diff - a.diff).slice(0, 5);
        return `<div class="pad stack-6" style="margin-top:14px">
          ${clash.length ? `<div class="caps">Where you clash</div>${clash.map(row).join('')}` : ''}
          ${agree.length ? `<div class="caps" style="margin-top:10px">Where you agree</div>${agree.map(row).join('')}` : ''}
          ${loved.length ? `<div class="caps" style="margin-top:10px">${esc(other.handle)} loved \u2014 you haven\u2019t been</div>${loved.map(v => {
            const b = BY_ID[v.buildingId];
            return `<button class="row" data-go="#/b/${b.id}">${ph(b, { style: 'width:40px;height:40px', go: false })}<div class="grow ellipsis">${esc(b.name)}<div class="sub ellipsis">${esc(makerLine(b))}</div></div>${starsHTML(v.stars)}</button>`;
          }).join('')}` : ''}
          ${!shared.length && !loved.length ? '<div class="empty">Log a few of the same places to compare taste.</div>' : ''}
        </div>`;
      })()}
      <div class="spacer"></div>
    </div>${nav('')}`;
  }

  function viewLeaderboard() {
    const rows = monthlyLeaderboard();
    const monthName = new Date().toLocaleDateString('en-GB', { month: 'long' });
    const body = rows.length ? rows.map((x, i) => `<div class="row" data-go="#/u/${x.u.id}">
        <span class="rank">${i + 1}</span>
        ${avatar(x.u)}
        <div class="grow"><b>${x.u.id === state.me ? 'You' : esc(x.u.name)}</b><div class="sub">@${esc(x.u.handle)}</div></div>
        <b>${x.n}</b>
      </div>`).join('') : `<div class="empty">Follow some critics to see a leaderboard.</div>`;
    return `<div class="screen with-nav">
      <div class="topbar"><button class="btn-sq thin" data-act="back" aria-label="Back">${icon('back')}</button><div class="h1 grow">Leaderboard</div></div>
      <div class="pad"><div class="caps">${monthName} · places logged</div></div>
      <div class="stack-6 pad">${body}</div>
      <div class="spacer"></div>
    </div>${nav('')}`;
  }

  function viewComments(vid) {
    const v = state.visits.find(x => x.id === vid);
    const b = v && BY_ID[v.buildingId];
    if (!v || !b) return viewNotFound();
    const author = user(v.userId);
    const comments = v.comments || [];
    const rows = comments.length ? comments.map(c => {
      const cu = user(c.userId); if (!cu) return '';
      return `<div style="display:flex;gap:10px">
        ${avatar(cu)}
        <div class="grow" style="line-height:1.4">
          <b data-go="#/u/${cu.id}">${c.userId === state.me ? 'You' : esc(cu.handle)}</b> <span class="tiny muted">${ago(c.createdAt)}</span>
          ${c.userId === state.me || v.userId === state.me ? `<button class="link tiny comment-del" data-act="deletecomment" data-v="${v.id}" data-id="${c.id}">Delete</button>` : ''}
          <div>${esc(c.text)}</div>
        </div>
      </div>`;
    }).join('') : `<div class="empty">No comments yet. Say something.</div>`;
    return `<div class="screen with-nav">
      <div class="topbar"><button class="btn-sq thin" data-act="back" aria-label="Back">${icon('back')}</button><div class="h1 grow">Comments</div></div>
      <div class="pad">
        <button class="row" data-go="#/b/${b.id}">
          ${ph(b, { style: 'width:38px;height:38px', go: false })}
          <div class="grow"><div class="ellipsis"><b>${author ? '@' + esc(author.handle) : ''}</b> rated ${esc(b.name)}</div><div class="sub">${starsHTML(v.stars)}</div></div>
        </button>
      </div>
      <div class="pad row-flex" style="padding-bottom:16px">
        <input class="input" id="comment-in" placeholder="Add a comment" autocomplete="off">
        <button class="btn-sq" data-act="postcomment" data-id="${v.id}" aria-label="Post comment">${icon('check', 'sm')}</button>
      </div>
      <div class="stack-6 pad">${rows}</div>
      <div class="spacer"></div>
    </div>${nav('')}`;
  }

  function viewActivity() {
    const items = state.activity.filter(a => a.forUid === state.me).sort((a, b) => b.createdAt - a.createdAt).slice(0, 100);
    const rows = items.length ? items.map(a => {
      if (a.type === 'follow') {
        const u = user(a.data.fromUid); if (!u) return '';
        return `<button class="row" data-go="#/u/${u.id}">${avatar(u)}<div class="grow"><b>@${esc(u.handle)}</b> started following you</div><span class="tiny muted">${ago(a.createdAt)}</span></button>`;
      }
      if (a.type === 'comment') {
        const u = user(a.data.fromUid); const b = BY_ID[a.data.buildingId];
        if (!u || !b) return '';
        return `<button class="row" data-go="#/comments/${a.data.visitId}">${avatar(u)}<div class="grow"><b>@${esc(u.handle)}</b> commented on your ${esc(b.name)} log</div><span class="tiny muted">${ago(a.createdAt)}</span></button>`;
      }
      if (a.type === 'heart') {
        const u = user(a.data.fromUid), b = BY_ID[a.data.buildingId];
        if (!u || !b) return '';
        return `<button class="row" data-go="#/b/${b.id}">${avatar(u)}<div class="grow"><b>@${esc(u.handle)}</b> loved your ${esc(b.name)} log</div><span class="tiny muted">${ago(a.createdAt)}</span></button>`;
      }
      if (a.type === 'achievement') {
        return `<button class="row" data-go="#/me"><div class="list-icon">${icon('check', 'sm')}</div><div class="grow">${esc(a.data.label)}</div><span class="tiny muted">${ago(a.createdAt)}</span></button>`;
      }
      return '';
    }).join('') : `<div class="empty">Nothing yet. Follows, comments and unlocks show up here.</div>`;
    return `<div class="screen with-nav">
      <div class="topbar"><button class="btn-sq thin" data-act="back" aria-label="Back">${icon('back')}</button><div class="h1 grow">Activity</div></div>
      <div class="stack-6 pad">${rows}</div>
      <div class="spacer"></div>
    </div>${nav('')}`;
  }

  function viewFollowList(uid, kind) {
    const u = user(uid);
    if (!u) return viewNotFound();
    const ids = kind === 'followers' ? state.follows.filter(f => f[1] === uid).map(f => f[0]) : Array.from(followingIds(uid));
    const people = ids.map(user).filter(Boolean);
    const rows = people.length ? people.map(p => {
      const f = isFollowing(state.me, p.id);
      return `<div class="row" data-go="#/u/${p.id}">
        ${avatar(p)}<div class="grow"><b>${esc(p.name)}</b><div class="sub">@${esc(p.handle)} · ${visitsBy(p.id).length} logged</div></div>
        ${p.id === state.me ? '' : `<button class="btn ${f ? '' : 'on'}" data-act="follow" data-id="${p.id}">${f ? 'Following' : 'Follow'}</button>`}
      </div>`;
    }).join('') : `<div class="empty">${kind === 'followers' ? 'No followers yet.' : 'Not following anyone yet.'}</div>`;
    return `<div class="screen with-nav">
      <div class="topbar"><button class="btn-sq thin" data-act="back" aria-label="Back">${icon('back')}</button><div class="h1 grow">${kind === 'followers' ? 'Followers' : 'Following'}</div></div>
      <div class="stack-6 pad">${rows}</div>
      <div class="spacer"></div>
    </div>${nav('')}`;
  }

  // ---------- Wrapped ----------
  // A story-style recap of one critic's logs: tap right/left to move, slides auto-advance.
  const WRAP_MS = 6000;
  let wrapUid = null, wrapIdx = 0, wrapTimer = null;

  function wrapStars(n) { return '★'.repeat(n) + '<span style="opacity:.35">' + '★'.repeat(5 - n) + '</span>'; }
  function wrapPersona(avg) {
    if (avg >= 4.5) return ['The Superfan', 'Every building is a pilgrimage.'];
    if (avg >= 3.8) return ['The Romantic', 'Generous, with a clear eye.'];
    if (avg >= 3) return ['The Fair Judge', 'Honest ratings, no favourites.'];
    return ['The Shade Thrower', 'Few buildings survive the gaze.'];
  }

  function wrapTally(list) {
    const m = {};
    list.filter(Boolean).forEach(x => { m[x] = (m[x] || 0) + 1; });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }

  function wrapSlides(u) {
    const own = u.id === state.me;
    const first = esc(u.name.split(' ')[0]);
    const who = own ? 'You' : first;
    const vs = visitsBy(u.id).filter(v => BY_ID[v.buildingId]).sort((a, b) => b.stars - a.stars || b.createdAt - a.createdAt);
    const bs = vs.map(v => BY_ID[v.buildingId]);
    const tally = wrapTally;
    const year = new Date().getFullYear();
    const intro = {
      bg: INK,
      html: `<div class="w-kicker">throwShade Wrapped ${year}</div>
        <div>${avatar(u, 'lg').replace('data-go', 'data-x')}</div>
        <div class="w-big">${own ? 'Your' : first + '’s'} year in shade</div>
        <div class="w-sub">Every building ${own ? 'you' : first} walked into, rated and remembered. Tap to begin.</div>`,
    };
    if (!vs.length) {
      return [intro, {
        bg: '#1d6f8c',
        html: `<div class="w-big">Nothing logged yet</div><div class="w-sub">${own ? 'Log a building and your' : first + ' hasn’t logged anything, so their'} Wrapped fills itself in.</div>
          ${own ? '<div class="w-btns"><button class="w-btn" data-go="#/log">Log a building</button></div>' : ''}`,
      }];
    }

    const slides = [intro];
    const cities = new Set(bs.map(b => b.city).filter(Boolean)).size;
    const countries = new Set(bs.map(b => b.country).filter(Boolean)).size;
    slides.push({
      bg: '#1d6f8c',
      html: `<div class="w-kicker">${who} logged</div>
        <div class="w-huge" data-count="${vs.length}">0</div>
        <div class="w-big">building${vs.length === 1 ? '' : 's'}</div>
        <div class="w-sub">across ${cities} cit${cities === 1 ? 'y' : 'ies'}${countries > 1 ? ` in ${countries} countries` : ''}.</div>`,
    });

    const topV = vs[0], topB = bs[0];
    slides.push({
      bg: '#111',
      photo: ph(topB, { w: 900, go: false, cls: 'wrap-photo' }),
      bottom: true,
      html: `<div class="w-kicker">${own ? 'Your' : first + '’s'} #1</div>
        <div class="w-big">${esc(topB.name)}</div>
        <div class="w-sub">${esc(makerLine(topB))}</div>
        <div class="w-stars">${wrapStars(topV.stars)}</div>
        ${topV.note ? `<div class="w-quote">“${esc(topV.note)}”</div>` : ''}`,
    });

    if (vs.length > 1) {
      slides.push({
        bg: '#2f6b4f',
        html: `<div class="w-kicker">Top buildings</div>
          <div class="w-list">${vs.slice(0, 5).map((v, i) => `<div class="w-row"><span class="n">${i + 1}</span>${ph(BY_ID[v.buildingId], { w: 120, go: false })}
            <div class="grow"><b>${esc(BY_ID[v.buildingId].name)}</b><span class="s">${esc(BY_ID[v.buildingId].city || '')} · ${v.stars}★</span></div></div>`).join('')}</div>`,
      });
    }

    const styles = tally(bs.map(b => b.style));
    if (styles.length) {
      const [style, n] = styles[0];
      slides.push({
        bg: STYLES[style] || '#7c6a58',
        html: `<div class="w-kicker">Top style</div>
          <div class="w-big">${esc(style)}</div>
          <div class="w-sub">${n} of ${vs.length} logs · ${Math.round(n / vs.length * 100)}%</div>
          <div class="w-list">${styles.slice(0, 4).map(([s, c]) => `<div><div class="w-bar-label"><span>${esc(s)}</span><span>${c}</span></div><div class="w-bar"><div style="width:${Math.round(c / n * 100)}%"></div></div></div>`).join('')}</div>`,
      });
    }

    const architects = tally(bs.map(b => b.architect));
    if (architects.length && architects[0][1] > 1) {
      const [name, n] = architects[0];
      const works = bs.filter(b => b.architect === name).slice(0, 3);
      slides.push({
        bg: '#8a4fa0',
        html: `<div class="w-kicker">Most-logged architect</div>
          <div class="w-big">${esc(name)}</div>
          <div class="w-sub">${n} buildings. ${who} keep${own ? '' : 's'} coming back.</div>
          <div class="w-thumbs">${works.map(b => ph(b, { w: 200, go: false })).join('')}</div>`,
      });
    }

    const looks = tally(vs.flatMap(v => v.likes));
    if (looks.length) {
      slides.push({
        bg: '#c2410c',
        html: `<div class="w-kicker">${who} notice${own ? '' : 's'} the</div>
          <div class="w-huge" style="font-size:72px">${esc(looks[0][0])}</div>
          <div class="w-sub">Tagged ${looks[0][1]} time${looks[0][1] === 1 ? '' : 's'}. Also on the list:</div>
          <div class="w-chips">${looks.slice(1, 7).map(([l, c]) => `<span class="w-chip">${esc(l)} ${c}</span>`).join('')}</div>`,
      });
    }

    const dated = bs.filter(b => b.year).sort((a, b) => a.year - b.year);
    if (dated.length > 1 && dated[dated.length - 1].year - dated[0].year >= 10) {
      const old = dated[0], young = dated[dated.length - 1];
      slides.push({
        bg: '#a68a1d',
        html: `<div class="w-kicker">Time travel</div>
          <div class="w-huge" data-count="${young.year - old.year}">0</div>
          <div class="w-big">years of architecture</div>
          <div class="w-list">
            <div class="w-row">${ph(old, { w: 120, go: false })}<div class="grow"><span class="s">Oldest · ${old.year}</span><b>${esc(old.name)}</b></div></div>
            <div class="w-row">${ph(young, { w: 120, go: false })}<div class="grow"><span class="s">Newest · ${young.year}</span><b>${esc(young.name)}</b></div></div>
          </div>`,
      });
    }

    const low = vs[vs.length - 1];
    if (vs.length > 1 && low.stars <= 3) {
      const lb = BY_ID[low.buildingId];
      slides.push({
        bg: '#b3364a',
        photo: ph(lb, { w: 900, go: false, cls: 'wrap-photo' }),
        bottom: true,
        html: `<div class="w-kicker">Most shade thrown at</div>
          <div class="w-big">${esc(lb.name)}</div>
          <div class="w-stars">${wrapStars(low.stars)}</div>
          ${low.note ? `<div class="w-quote">“${esc(low.note)}”</div>` : `<div class="w-sub">${STAR_WORDS[low.stars]}.</div>`}`,
      });
    }

    const avg = vs.reduce((s, v) => s + v.stars, 0) / vs.length;
    const [persona, line] = wrapPersona(avg);
    slides.push({
      bg: '#1c1c1e',
      html: `<div class="w-kicker">Average rating</div>
        <div class="w-huge"><span data-count="${avg.toFixed(1)}" data-dec="1">0</span><span style="font-size:.5em">★</span></div>
        <div class="w-kicker" style="margin-top:12px">Critic type</div>
        <div class="w-big">${persona}</div>
        <div class="w-sub">${line}</div>`,
    });

    slides.push({
      bg: STYLES[styles[0][0]] || INK,
      last: true,
      html: `<div class="w-card">
          <div style="display:flex;align-items:center;gap:12px">${avatar(u, 'md').replace('data-go', 'data-x')}<div class="grow"><b>${esc(u.name)}</b><div class="small muted">throwShade Wrapped ${year}</div></div></div>
          <div class="w-card-grid">
            <div><div class="caps">Top buildings</div>${bs.slice(0, 3).map((b, i) => `<div><b>${i + 1}</b> ${esc(b.name)}</div>`).join('')}</div>
            <div><div class="caps">Top style</div><div><b>${esc(styles[0][0])}</b></div>
              <div class="caps" style="margin-top:8px">Architect</div><div><b>${esc(architects[0][0])}</b></div></div>
            <div><div class="caps">Logged</div><div class="w-card-num">${vs.length}</div></div>
            <div><div class="caps">Critic type</div><div><b>${persona}</b></div></div>
          </div>
        </div>
        <div class="w-btns"><button class="w-btn ghost" data-act="wrapreplay">Replay</button><button class="w-btn" data-act="wrapshare" data-id="${u.id}">Share</button></div>`,
    });
    return slides;
  }

  // ----- Wrapped share sheet -----
  let wrapShare = null; // { uid, blob, url }
  const SHARE_BRANDS = {
    instagram: ['Instagram', 'radial-gradient(circle at 30% 107%, #fdf497 0%, #fd5949 45%, #d6249f 60%, #285AEB 90%)',
      '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="#fff" stroke="none"/></svg>'],
    facebook: ['Facebook', '#1877F2',
      '<svg viewBox="0 0 24 24" fill="#fff"><path d="M13.5 22v-8h2.7l.4-3.2h-3.1V8.8c0-.9.3-1.6 1.6-1.6h1.7V4.4c-.3 0-1.3-.1-2.5-.1-2.5 0-4.1 1.5-4.1 4.2v2.3H7.5V14h2.7v8z"/></svg>'],
    x: ['X', '#000',
      '<svg viewBox="0 0 24 24" fill="#fff"><path d="M17.8 3h3.1l-6.8 7.8 8 10.2h-6.3l-4.9-6.4L5.3 21H2.2l7.3-8.3L1.9 3h6.4l4.4 5.9zm-1.1 16.2h1.7L7.4 4.7H5.6z"/></svg>'],
    threads: ['Threads', '#000',
      '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="M16.5 11.2c-.6-2.6-2.4-3.7-4.6-3.7-2.9 0-4.4 2-4.4 4.5 0 2.7 1.7 4.5 4.6 4.5 2.4 0 4.2-1.3 4.2-3.3 0-1.8-1.4-2.7-3.2-2.7-1.6 0-2.8.8-2.8 2 0 1 .9 1.7 2.1 1.7 2.8 0 3.4-2.9 3.2-5.6"/><path d="M19.5 7.5C18.2 4.5 15.5 3 12 3 6.8 3 4 6.8 4 12s2.8 9 8 9c4 0 6.6-2 7.6-5"/></svg>'],
    whatsapp: ['WhatsApp', '#25D366',
      '<svg viewBox="0 0 24 24" fill="#fff"><path d="M12 2.5a9.4 9.4 0 0 0-8.1 14.2L2.6 21.4l4.8-1.3A9.4 9.4 0 1 0 12 2.5zm5.4 13.3c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.1-4.5-3.9-4.7-4.1-.1-.2-1.1-1.5-1.1-2.9s.7-2.1 1-2.4c.3-.3.6-.3.8-.3h.6c.2 0 .4 0 .6.5l.9 2.1c.1.2.1.4 0 .5l-.3.5-.4.5c-.1.1-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.4 2.4 1.5.3.1.5.1.6-.1l.9-1.1c.2-.3.4-.2.6-.1l2 .9c.3.1.5.2.5.3.1.1.1.6-.1 1.2z"/></svg>'],
    line: ['LINE', '#06C755',
      '<svg viewBox="0 0 24 24" fill="#fff"><path d="M12 3C6.5 3 2 6.6 2 11c0 3.9 3.5 7.2 8.3 7.9.3.1.8.2.9.5.1.3.1.7 0 1l-.1.9c0 .3-.2 1 .9.6 1.1-.5 6-3.5 8.2-6.1 1.2-1.3 1.8-2.8 1.8-4.8C22 6.6 17.5 3 12 3zM8.3 13.5H6.3a.5.5 0 0 1-.5-.5V9a.5.5 0 0 1 1 0v3.5h1.5a.5.5 0 0 1 0 1zm2 -.5a.5.5 0 0 1-1 0V9a.5.5 0 0 1 1 0zm4.8 0a.5.5 0 0 1-.9.3L12 10.5V13a.5.5 0 0 1-1 0V9a.5.5 0 0 1 .9-.3l2.2 2.8V9a.5.5 0 0 1 1 0zm3.2-2.5a.5.5 0 0 1 0 1h-1.5v1h1.5a.5.5 0 0 1 0 1h-2a.5.5 0 0 1-.5-.5V9c0-.3.2-.5.5-.5h2a.5.5 0 0 1 0 1h-1.5v1z"/></svg>'],
  };

  function wrapSummary(uid) {
    const u = user(uid);
    const vs = visitsBy(uid).filter(v => BY_ID[v.buildingId]).sort((a, b) => b.stars - a.stars || b.createdAt - a.createdAt);
    const bs = vs.map(v => BY_ID[v.buildingId]);
    const avg = vs.length ? vs.reduce((t, v) => t + v.stars, 0) / vs.length : 0;
    const style = (wrapTally(bs.map(b => b.style))[0] || [''])[0];
    return {
      u, vs, bs, avg, style,
      architect: (wrapTally(bs.map(b => b.architect))[0] || [''])[0],
      persona: wrapPersona(avg)[0],
      color: STYLES[style] || INK,
      link: location.href.split('#')[0] + '#/wrapped/' + uid,
      text: `${u.name}’s throwShade Wrapped: ${vs.length} buildings logged${bs[0] ? ', #1 is ' + bs[0].name : ''}.`,
    };
  }

  // Story-sized (1080×1920) PNG of the summary card, drawn on a canvas so it can be saved or posted.
  async function wrapImage(uid) {
    const w = wrapSummary(uid);
    const W = 1080, F = '"IBM Plex Sans", system-ui, sans-serif';
    try { await Promise.all([document.fonts.load('700 40px "IBM Plex Sans"'), document.fonts.load('400 40px "IBM Plex Sans"')]); } catch (e) {}
    const img = w.u.photo ? await new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = w.u.photo; }) : null;
    const c = document.createElement('canvas');
    c.width = W; c.height = 1920;
    const x = c.getContext('2d');
    // Word-wrap to a width; a single word wider than the line is split by characters.
    const lines = (t, max) => {
      const out = [];
      let cur = '';
      String(t).split(/\s+/).filter(Boolean).forEach(word => {
        const test = cur ? cur + ' ' + word : word;
        if (x.measureText(test).width <= max) { cur = test; return; }
        if (cur) out.push(cur);
        while (x.measureText(word).width > max) {
          let i = word.length;
          while (i > 1 && x.measureText(word.slice(0, i)).width > max) i--;
          out.push(word.slice(0, i)); word = word.slice(i);
        }
        cur = word;
      });
      if (cur) out.push(cur);
      return out;
    };
    const L = 110, CW = W - 2 * L, col2 = L + CW / 2 + 10;

    // Two passes: measure to size the canvas and card, then draw.
    const layout = card => {
      const draw = !!card;
      const text = (font, color, t, left, y, max, lh) => {
        x.font = font; x.fillStyle = color;
        const ls = lines(t, max);
        if (draw) ls.forEach((l, i) => x.fillText(l, left, y + i * lh));
        return y + (ls.length - 1) * lh;
      };
      const caps = (t, left, y) => { if (draw) { x.font = `700 28px ${F}`; x.fillStyle = '#a1a1a6'; x.fillText(t.toUpperCase(), left, y); } };
      x.textAlign = 'center';
      if (draw) {
        x.fillStyle = w.color; x.fillRect(0, 0, W, c.height);
        x.font = `700 38px ${F}`; x.fillStyle = 'rgba(255,255,255,.85)'; x.fillText(`THROWSHADE WRAPPED ${new Date().getFullYear()}`, W / 2, 190);
        x.save(); x.beginPath(); x.arc(W / 2, 400, 140, 0, Math.PI * 2); x.fillStyle = '#fff'; x.fill(); x.clip();
        if (img) x.drawImage(img, W / 2 - 140, 260, 280, 280);
        else { x.fillStyle = INK; x.font = `700 90px ${F}`; x.textBaseline = 'middle'; x.fillText(initials(w.u.name), W / 2, 405); x.textBaseline = 'alphabetic'; }
        x.restore();
        x.fillStyle = '#fff'; x.beginPath(); x.roundRect(L, card.T, CW, card.bottom - card.T, 48); x.fill();
      }
      let y = text(`700 76px ${F}`, '#fff', w.u.name, W / 2, 650, 900, 86);
      y = text(`400 40px ${F}`, 'rgba(255,255,255,.8)', '@' + w.u.handle, W / 2, y + 62, 900, 48);

      const T = y + 78;
      x.textAlign = 'left';
      caps('Top buildings', L + 60, T + 90);
      y = T + 160;
      w.bs.slice(0, 5).forEach((b, i) => {
        if (draw) { x.font = `700 44px ${F}`; x.fillStyle = INK; x.fillText(String(i + 1), L + 60, y); }
        y = text(`400 42px ${F}`, INK, b.name, L + 120, y, CW - 180, 52) + 66;
      });
      const gy = y + 34;
      if (draw) { x.fillStyle = '#ececea'; x.fillRect(L + 60, gy - 60, CW - 120, 2); }
      caps('Logged', L + 60, gy);
      caps('Average', col2, gy);
      if (draw) {
        x.font = `700 96px ${F}`; x.fillStyle = INK;
        x.fillText(String(w.vs.length), L + 60, gy + 100);
        x.fillText(w.avg.toFixed(1) + '★', col2, gy + 100);
      }
      caps('Top style', L + 60, gy + 190);
      caps('Critic type', col2, gy + 190);
      const a = text(`700 42px ${F}`, INK, w.style, L + 60, gy + 245, CW / 2 - 90, 52);
      const b = text(`700 42px ${F}`, INK, w.persona, col2, gy + 245, L + CW - 60 - col2, 52);
      const bottom = Math.max(a, b) + 70;
      const foot = Math.max(1800, bottom + 130);
      if (draw) { x.textAlign = 'center'; x.font = `700 56px ${F}`; x.fillStyle = '#fff'; x.fillText('throwShade', W / 2, foot); }
      return { T, bottom, height: foot + 120 };
    };
    const card = layout(null);
    if (card.height > c.height) c.height = card.height;
    layout(card);
    return new Promise(res => c.toBlob(res, 'image/png'));
  }

  async function openWrapShare(uid) {
    const host = root.querySelector('.wrap');
    if (!host || host.querySelector('.wrap-sheet')) return;
    const bg = document.createElement('div');
    bg.className = 'wrap-sheet-bg'; bg.dataset.act = 'shareclose';
    const sheet = document.createElement('div');
    sheet.className = 'wrap-sheet';
    const opt = (act, label, face, style) => `<button class="share-opt" data-act="${act}"><span class="ic" style="${style || ''}">${face}</span>${label}</button>`;
    sheet.innerHTML = `<div class="grab"></div>
      <div class="wrap-sheet-preview"><div class="spin"></div></div>
      <div class="share-row">
        ${opt('sharedl', 'Download', icon('download'))}
        ${opt('sharecopy', 'Copy link', icon('link'))}
        ${Object.entries(SHARE_BRANDS).map(([k, [label, bgc, svg]]) => opt('shareto', label, svg, `background:${bgc}`).replace('data-act="shareto"', `data-act="shareto" data-to="${k}"`)).join('')}
        ${opt('sharemore', 'More', icon('more'))}
      </div>`;
    host.append(bg, sheet);
    if (wrapShare && wrapShare.uid !== uid) { URL.revokeObjectURL(wrapShare.url); wrapShare = null; }
    if (!wrapShare) {
      const blob = await wrapImage(uid);
      // A data: URL downloads as a real .png everywhere; some mobile browsers mangle blob: downloads.
      const dataURL = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
      wrapShare = { uid, blob, dataURL, url: URL.createObjectURL(blob) };
    }
    const pv = sheet.querySelector('.wrap-sheet-preview');
    if (pv) pv.innerHTML = `<img src="${wrapShare.url}" alt="Wrapped share image">`;
  }
  function closeWrapShare() {
    const host = root.querySelector('.wrap');
    if (!host) return;
    host.querySelectorAll('.wrap-sheet, .wrap-sheet-bg').forEach(el => el.remove());
  }
  function wrapDownload() {
    if (!wrapShare) { toast('Still making the image — try again in a second'); return false; }
    const a = document.createElement('a');
    a.href = wrapShare.dataURL; a.type = 'image/png';
    a.download = `throwshade-wrapped-${user(wrapShare.uid).handle}.png`;
    document.body.appendChild(a); a.click(); a.remove();
    return true;
  }
  const isMobile = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  // On a phone try the app first and fall back to the website if nothing took over the screen.
  function openTarget(web, app) {
    if (app && isMobile()) {
      const t = setTimeout(() => { if (!document.hidden) location.href = web; }, 1500);
      document.addEventListener('visibilitychange', () => clearTimeout(t), { once: true });
      location.href = app;
    } else window.open(web, '_blank', 'noopener');
  }
  function wrapFile() {
    return wrapShare ? new File([wrapShare.blob], `throwshade-wrapped-${user(wrapShare.uid).handle}.png`, { type: 'image/png' }) : null;
  }

  function viewWrapped(uid) {
    const u = user(uid);
    if (!u) return viewNotFound();
    if (wrapUid !== uid) { wrapUid = uid; wrapIdx = 0; }
    const slides = wrapSlides(u);
    wrapIdx = Math.max(0, Math.min(wrapIdx, slides.length - 1));
    const s = slides[wrapIdx];
    const last = wrapIdx === slides.length - 1;
    const bars = slides.map((_, i) => `<div><span class="${i < wrapIdx || (i === wrapIdx && last) ? 'done' : i === wrapIdx ? 'run' : ''}"></span></div>`).join('');
    return `<div class="screen fixed wrap" style="background:${s.bg}">
      ${s.photo || ''}
      <div class="wrap-bars">${bars}</div>
      <button class="btn-sq wrap-close" data-act="wrapclose" aria-label="Close">${icon('x')}</button>
      <button class="wrap-tap prev" data-act="wrapprev" aria-label="Previous"></button>
      ${last ? '' : '<button class="wrap-tap next" data-act="wrapnext" aria-label="Next"></button>'}
      <div class="wrap-body ${s.bottom ? 'bottom' : ''}" data-n="${slides.length}">${s.html}</div>
    </div>`;
  }

  function startWrap() {
    clearTimeout(wrapTimer);
    const body = root.querySelector('.wrap-body');
    if (!body) return;
    root.querySelectorAll('[data-count]').forEach(el => {
      const to = +el.dataset.count, dec = +(el.dataset.dec || 0), t0 = Date.now();
      const tick = setInterval(() => {
        const k = Math.min(1, (Date.now() - t0) / 1000);
        el.textContent = (to * (1 - Math.pow(1 - k, 3))).toFixed(dec);
        if (k >= 1 || !el.isConnected) clearInterval(tick);
      }, 30);
    });
    if (wrapIdx < +body.dataset.n - 1) wrapTimer = setTimeout(() => { if (currentPath().startsWith('/wrapped')) actions.wrapnext(); }, WRAP_MS);
    else if (body.querySelector('.w-card')) { Sound.success(); celebrate(); }
  }

  // ---------- Stories ----------
  // 24-hour stories, Instagram-style: photo posts plus anything rated in the last day, per person.
  const STORY_MS = 24 * HOUR, STORY_SLIDE_MS = 5000;
  let storyUid = null, storyIdx = 0, storyTimer = null, storyDraft = null;
  const storyImg = st => st.image || API_BASE + '/stories/' + encodeURIComponent(st.id) + '/image';
  function storySlides(uid) {
    const since = Date.now() - STORY_MS;
    const posts = state.stories.filter(st => st.userId === uid && st.createdAt >= since).map(st => ({ key: st.id, at: st.createdAt, story: st }));
    const logs = visitsBy(uid).filter(v => v.createdAt >= since && BY_ID[v.buildingId]).map(v => ({ key: 'v-' + v.id, at: v.createdAt, visit: v }));
    return posts.concat(logs).sort((a, b) => a.at - b.at);
  }
  const storyUnseen = uid => storySlides(uid).some(sl => !state.storySeen[sl.key]);
  // People you follow with something in the last day: unwatched first, then most recent.
  function storyPeople() {
    const last = uid => { const sl = storySlides(uid); return sl.length ? sl[sl.length - 1].at : 0; };
    return [...followingIds(state.me)].filter(id => user(id) && last(id))
      .sort((a, b) => storyUnseen(b) - storyUnseen(a) || last(b) - last(a));
  }
  function storyRow() {
    const u = me(), mine = storySlides(state.me).length;
    const people = storyPeople(), withStory = new Set(people);
    const others = [...followingIds(state.me)].filter(id => user(id) && !withStory.has(id));
    // The ring decides where a tap goes, so drop the avatar's own profile link.
    const face = u => avatar(u, 'md').replace(/ data-go="[^"]*"/, '');
    const bubble = (id, ring, go) => `<button class="story" data-go="${go}">
        <span class="story-ring ${ring}">${face(user(id))}</span><span class="story-name ellipsis">${esc(user(id).handle)}</span></button>`;
    return `<div class="stories">
      <div class="story"><button class="story-ring ${mine ? (storyUnseen(state.me) ? 'on' : 'seen') : ''}" data-go="${mine ? '#/story/' + state.me : '#/newstory'}" aria-label="Your story">${face(u)}</button>
        <button class="story-plus" data-go="#/newstory" aria-label="Add to your story">${icon('plus', 'sm')}</button><span class="story-name">Your story</span></div>
      ${people.map(id => bubble(id, storyUnseen(id) ? 'on' : 'seen', '#/story/' + id)).join('')}
      ${others.map(id => bubble(id, '', '#/u/' + id)).join('')}
      <button class="story" data-act="findpeople"><span class="story-ring"><span class="avatar md story-add">${icon('users', 'sm')}</span></span><span class="story-name">Find</span></button>
    </div>`;
  }
  function viewStory(uid) {
    const u = user(uid), slides = u ? storySlides(uid) : [];
    if (!slides.length) return `<div class="screen with-nav"><div class="topbar"><button class="btn-sq thin" data-act="storyclose" aria-label="Close">${icon('x')}</button></div><div class="pad"><div class="empty">No story right now.</div></div></div>${nav('home')}`;
    if (storyUid !== uid) { storyUid = uid; storyIdx = Math.max(0, slides.findIndex(sl => !state.storySeen[sl.key])); }
    storyIdx = Math.min(storyIdx, slides.length - 1);
    const sl = slides[storyIdx];
    if (!state.storySeen[sl.key]) { state.storySeen[sl.key] = Date.now(); save(); }
    const bars = slides.map((_, i) => `<div><span class="${i < storyIdx ? 'done' : i === storyIdx ? 'run story-run' : ''}"></span></div>`).join('');
    const tag = b => b ? `<button class="story-tag" data-go="#/b/${b.id}">${icon('pin', 'sm')}${esc(b.name)}</button>` : '';
    let bg, body;
    if (sl.story) {
      const st = sl.story;
      bg = `<div class="wrap-photo story-photo" style="background-image:url('${storyImg(st)}')"></div>`;
      body = `${st.caption ? `<div class="story-caption">${esc(st.caption)}</div>` : ''}${tag(st.buildingId && BY_ID[st.buildingId])}`;
    } else {
      const v = sl.visit, b = BY_ID[v.buildingId];
      bg = ph(b, { w: 1200, cls: 'wrap-photo', go: false });
      body = `<div class="story-rated">${starsHTML(v.stars, 'md')}<span>${STAR_WORDS[v.stars]}</span></div>
        ${v.note ? `<div class="story-caption">“${esc(v.note)}”</div>` : ''}${tag(b)}`;
    }
    const del = uid === state.me && sl.story ? `<button class="story-del" data-act="storydelete" data-id="${sl.story.id}">Delete</button>` : '';
    return `<div class="screen fixed wrap story-view">${bg}
      <div class="wrap-bars">${bars}</div>
      <div class="story-head">${avatar(u, 'xs')}<b>${uid === state.me ? 'Your story' : esc(u.handle)}</b><span>${esc(ago(sl.at))}</span>${del}</div>
      <button class="btn-sq wrap-close" data-act="storyclose" aria-label="Close">${icon('x')}</button>
      <button class="wrap-tap prev" data-act="storyprev" aria-label="Previous"></button>
      <button class="wrap-tap next" data-act="storynext" aria-label="Next"></button>
      <div class="wrap-body bottom">${body}</div>
    </div>`;
  }
  function startStory() {
    clearTimeout(storyTimer);
    if (root.querySelector('.story-view')) storyTimer = setTimeout(() => { if (currentPath().startsWith('/story/')) actions.storynext(); }, STORY_SLIDE_MS);
  }
  function viewNewStory() {
    if (!storyDraft) storyDraft = { image: null, caption: '', bid: '' };
    const d = storyDraft;
    // Tag options: places you've rated (newest first), then what's nearby.
    const mine = visitsBy(state.me).slice().sort((a, b) => b.createdAt - a.createdAt).map(v => BY_ID[v.buildingId]);
    const opts = [...new Set(mine.concat(nearest(BUILDINGS).slice(0, 25).map(x => x.b)).filter(Boolean))].slice(0, 40);
    return `<div class="screen with-nav">
      <div class="topbar"><button class="btn-sq thin" data-act="storycancel" aria-label="Cancel">${icon('x')}</button><div class="h1 grow">New story</div></div>
      <div class="pad stack">
        <label class="story-pick ${d.image ? 'has' : ''}"${d.image ? ` style="background-image:url('${d.image}')"` : ''}>
          ${d.image ? '<span class="story-pick-change">Change photo</span>' : `${icon('camera')}<span>Add a photo</span>`}
          <input type="file" accept="image/*" hidden data-change="storyphoto"></label>
        <input class="input" data-input="storycaption" maxlength="200" placeholder="Say something (optional)" value="${esc(d.caption)}">
        <select class="input" data-change="storyplace"><option value="">Tag a place (optional)</option>${opts.map(b => `<option value="${b.id}"${d.bid === b.id ? ' selected' : ''}>${esc(b.name)}</option>`).join('')}</select>
        <button class="btn on" style="height:48px" data-act="storypost"${d.image ? '' : ' disabled'}>Share to your story</button>
        <div class="small muted" style="text-align:center">Stories disappear after 24 hours.</div>
      </div>
    </div>${nav('home')}`;
  }

  // ---------- Visit calendar ----------
  // A diary month view: each day someone visited a place shows its photo; tap a day to list them.
  let calFor = null, calMonth = null, calDay = null;
  function calendarHTML(uid) {
    const dayOf = v => v.visitedOn || isoDate(v.createdAt);
    const byDay = {};
    visitsBy(uid).filter(v => BY_ID[v.buildingId]).forEach(v => { (byDay[dayOf(v)] = byDay[dayOf(v)] || []).push(v); });
    // Open on the month of the latest visit, per profile.
    if (calFor !== uid) { calFor = uid; calDay = null; calMonth = (Object.keys(byDay).sort().pop() || isoDate(Date.now())).slice(0, 7); }
    const [y, m] = calMonth.split('-').map(Number);
    const first = new Date(y, m - 1, 1), days = new Date(y, m, 0).getDate(), lead = (first.getDay() + 6) % 7;
    const today = isoDate(Date.now()), cells = [];
    for (let i = 0; i < lead; i++) cells.push('<div class="cal-cell cal-blank"></div>');
    for (let d = 1; d <= days; d++) {
      const key = `${calMonth}-${String(d).padStart(2, '0')}`, list = byDay[key] || [];
      const cls = (key === today ? ' today' : '') + (key === calDay ? ' sel' : '');
      cells.push(list.length
        ? `<button class="cal-cell has${cls}" data-act="calday" data-k="${key}" aria-label="${list.length} visit${list.length === 1 ? '' : 's'} on ${esc(fmtDate(key))}">${ph(BY_ID[list[0].buildingId], { w: 120, cls: 'cal-ph', go: false })}<span>${d}</span>${list.length > 1 ? `<i>${list.length}</i>` : ''}</button>`
        : `<div class="cal-cell${cls}"><span>${d}</span></div>`);
    }
    const n = Object.keys(byDay).filter(k => k.startsWith(calMonth)).reduce((t, k) => t + byDay[k].length, 0);
    const sel = calDay && calDay.startsWith(calMonth) ? byDay[calDay] || [] : [];
    return `<div class="cal">
      <div class="cal-head">
        <button class="btn-sq thin" data-act="calmonth" data-k="-1" aria-label="Previous month">${icon('back', 'sm')}</button>
        <div class="grow" style="text-align:center"><b>${esc(first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }))}</b>
          <div class="small muted">${n ? `${n} visit${n === 1 ? '' : 's'}` : 'No visits this month'}${n && uid === state.me ? ` · <button class="link small" data-act="sharemonth">Share</button>` : ''}</div></div>
        <button class="btn-sq thin" data-act="calmonth" data-k="1" aria-label="Next month">${icon('chevron', 'sm')}</button>
      </div>
      <div class="cal-grid">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(x => `<div class="cal-dow">${x}</div>`).join('')}${cells.join('')}</div>
      ${sel.length ? `<div class="stack-6" style="margin-top:14px"><div class="caps">${esc(fmtDate(calDay))}</div>${sel.map(v => {
        const b = BY_ID[v.buildingId];
        return `<button class="row" data-go="#/b/${b.id}">${ph(b, { style: 'width:44px;height:44px', go: false })}
          <div class="grow"><div class="ellipsis">${esc(b.name)}</div><div class="sub ellipsis">${esc(makerLine(b))}</div></div>${starsHTML(v.stars)}</button>`;
      }).join('')}</div>` : ''}
    </div>`;
  }

  // ---------- Scan: point the camera at a building ----------
  // No image recognition: GPS says where you stand, the compass says which way the phone faces, and the
  // known building nearest the middle of that view (bundled + live Wikipedia places) is the match.
  let scan = null;
  function viewScan() {
    return `<div class="screen fixed scan">
      <video id="scan-video" autoplay playsinline muted></video>
      <div class="scan-aim"></div>
      <div class="scan-status" id="scan-status">Starting camera…</div>
      <button class="btn-sq scan-close" data-act="scanclose" aria-label="Close">${icon('x')}</button>
      <div class="scan-card" id="scan-card"></div>
    </div>`;
  }
  const scanStatus = t => { const el = document.getElementById('scan-status'); if (el) el.textContent = t; };
  function bearingTo(a, b) {
    const r = x => x * Math.PI / 180, dl = r(b.lng - a.lng);
    const y = Math.sin(dl) * Math.cos(r(b.lat)), x = Math.cos(r(a.lat)) * Math.sin(r(b.lat)) - Math.sin(r(a.lat)) * Math.cos(r(b.lat)) * Math.cos(dl);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }
  function startScan() {
    stopScan();
    const s = scan = { stream: null, watch: null, pos: null, heading: null, fetchedAt: null, timer: null, list: [], lock: null, sig: '' };
    const video = document.getElementById('scan-video');
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
        .then(st => { if (scan !== s) { st.getTracks().forEach(t => t.stop()); return; } s.stream = st; video.srcObject = st; })
        .catch(() => { video.classList.add('off'); toast('Camera unavailable — you can still pick from the list'); });
    } else video.classList.add('off');
    if (navigator.geolocation) {
      s.watch = navigator.geolocation.watchPosition(p => {
        s.pos = { lat: p.coords.latitude, lng: p.coords.longitude };
        loc = { lat: s.pos.lat, lng: s.pos.lng, label: 'your location', demo: false };
        scanCandidates(s); scanUpdate();
      }, e => scanStatus(e.code === 1 ? 'Location is blocked — allow it for this site to scan' : 'Couldn’t find your location'),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 });
    } else scanStatus('This browser can’t share your location');
    s.onOrient = e => {
      // iOS gives a true compass heading; Android gives alpha on the absolute event (counter-clockwise).
      let h = e.webkitCompassHeading;
      if (h == null && e.absolute && e.alpha != null) h = 360 - e.alpha;
      if (h == null || scan !== s) return;
      s.heading = (h + ((screen.orientation && screen.orientation.angle) || 0) + 360) % 360;
      if (!s.timer) s.timer = setTimeout(() => { s.timer = null; scanUpdate(); }, 150);
    };
    window.addEventListener('deviceorientationabsolute', s.onOrient);
    window.addEventListener('deviceorientation', s.onOrient);
    scanUpdate();
  }
  function stopScan() {
    if (!scan) return;
    const s = scan;
    scan = null;
    if (s.stream) s.stream.getTracks().forEach(t => t.stop());
    if (s.watch != null) navigator.geolocation.clearWatch(s.watch);
    window.removeEventListener('deviceorientationabsolute', s.onOrient);
    window.removeEventListener('deviceorientation', s.onOrient);
    clearTimeout(s.timer);
  }
  async function scanCandidates(s) {
    // Pull live places around you again once you've walked ~80 m from the last fetch.
    if (s.fetchedAt && km(s.fetchedAt, s.pos) < 0.08) return;
    s.fetchedAt = { ...s.pos };
    try { await livePlaces({ generator: 'geosearch', ggscoord: s.pos.lat + '|' + s.pos.lng, ggsradius: 600, ggslimit: 60 }); } catch (e) { /* bundled places still work */ }
    if (scan === s) { s.sig = ''; scanUpdate(); }
  }
  function scanUpdate() {
    const s = scan, card = document.getElementById('scan-card');
    if (!s || !card) return;
    if (!s.pos) { if (s.watch != null) scanStatus('Finding your location…'); return; }
    const near = BUILDINGS.map(b => ({ b, d: km(s.pos, b) * 1000 })).filter(x => x.d < 600);
    const needPerm = s.heading == null && window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function';
    let list;
    if (s.heading == null) {
      list = near.sort((x, y) => x.d - y.d);
      scanStatus(needPerm ? 'Turn on the compass to aim' : 'No compass here — showing the closest places');
    } else {
      // Favour what's dead ahead, then what's close: a near building blocks the view of far ones.
      list = near.map(x => ({ ...x, diff: Math.abs(((bearingTo(s.pos, x.b) - s.heading + 540) % 360) - 180) }))
        .filter(x => x.diff < 35 || x.d < 25)
        .map(x => ({ ...x, score: Math.exp(-((x.diff / 14) ** 2)) / (1 + x.d / 120) }))
        .sort((x, y) => y.score - x.score);
      scanStatus(list.length ? 'Point at a building' : 'Nothing known that way — turn a little');
    }
    const locked = s.lock && near.find(x => x.b.id === s.lock);
    if (locked) list = [locked].concat(list.filter(x => x.b.id !== s.lock));
    s.list = list.slice(0, 4);
    const top = s.list[0];
    // Only touch the DOM when the answer changes, so taps on the card never land on a replaced button.
    const sig = s.list.map(x => x.b.id + ':' + Math.round(x.d / 10)).join() + needPerm + !!locked;
    if (sig === s.sig) return;
    s.sig = sig;
    card.innerHTML = !top ? (needPerm ? `<button class="btn on" data-act="scancompass">Turn on compass</button>` : '') : `
      <div class="scan-match">${ph(top.b, { style: 'width:56px;height:56px;border-radius:12px', go: false })}
        <div class="grow" style="min-width:0"><div class="caps">${locked ? 'Your pick' : s.heading == null ? 'Closest' : 'Looking at'}</div>
          <b class="ellipsis" style="display:block">${esc(top.b.name)}</b>
          <div class="sub ellipsis">${esc([top.b.architect, Math.round(top.d) + ' m away'].filter(Boolean).join(' · '))}</div></div></div>
      ${s.list.length > 1 ? `<div class="scan-alts"><span class="small muted">Not it?</span>${s.list.slice(1).map(x => `<button class="chip" data-act="scanpick" data-id="${x.b.id}">${esc(x.b.name)}</button>`).join('')}</div>` : ''}
      <div class="scan-actions"><button class="btn" data-go="#/b/${top.b.id}">Details</button><button class="btn on" data-go="#/log/${top.b.id}">${icon('plus', 'sm')}Log it</button></div>
      ${needPerm ? `<button class="link" data-act="scancompass">Turn on compass to aim</button>` : ''}`;
  }

  // ---------- Daily Shade: guess today's building ----------
  // Everyone gets the same building each day (picked from the bundled places, so every device agrees).
  // Five guesses; each miss zooms out, sharpens the photo and adds a clue. Guesses show distance and
  // direction to the answer, Worldle-style.
  const GAME_EPOCH = Date.UTC(2026, 9, 1), GAME_TRIES = 5;
  const GAME_POOL = BUILDINGS.filter(b => b.source !== 'live' && b.source !== 'user' && b.image && b.architect && b.year && b.lat && kindOf(b) === 'building')
    .sort((a, b) => a.id < b.id ? -1 : 1);
  const gameDay = () => Math.floor((Date.parse(isoDate(Date.now()) + 'T00:00:00Z') - GAME_EPOCH) / DAY) + 1;
  function gameAnswer(day) {
    let h = 2166136261;
    for (const ch of 'shade-' + day) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    return GAME_POOL[(h >>> 0) % GAME_POOL.length];
  }
  let gameQ = '', gameResults = [];
  const gameRec = day => { state.game = state.game || {}; return state.game[day] = state.game[day] || { guesses: [], done: false, won: false }; };
  function gameStreak() {
    let n = 0;
    for (let d = gameDay(); state.game && state.game[d] && state.game[d].won; d--) n++;
    if (!n && state.game && state.game[gameDay() - 1]) for (let d = gameDay() - 1; state.game[d] && state.game[d].won; d--) n++;
    return n;
  }
  const ARROWS = ['\u2191', '\u2197', '\u2192', '\u2198', '\u2193', '\u2199', '\u2190', '\u2196'];
  function guessInfo(guessId, ans) {
    const g = BY_ID[guessId];
    if (!g || g.id === ans.id) return { right: true, km: 0, sq: '\ud83d\udfe9' };
    const d = km(g, ans);
    return { right: false, km: d, arrow: ARROWS[Math.round(bearingTo(g, ans) / 45) % 8], sq: d < 50 ? '\ud83d\udfe8' : d < 1000 ? '\ud83d\udfe7' : '\u2b1b' };
  }
  function gameCardHTML() {
    const day = gameDay(), rec = (state.game || {})[day];
    const sub = !rec || !rec.guesses.length ? 'Guess today\u2019s building in 5 tries'
      : rec.done ? (rec.won ? `Solved in ${rec.guesses.length}/5 \u00b7 ${gameStreak()}-day streak` : 'Missed today \u2014 see the answer')
      : `${GAME_TRIES - rec.guesses.length} guesses left`;
    return `<button class="game-card" data-go="#/daily"><span class="game-card-icon">?</span>
      <span class="grow"><b>Daily Shade #${day}</b><span class="small muted" style="display:block">${sub}</span></span>${icon('chevron', 'sm')}</button>`;
  }
  function viewDaily() {
    const day = gameDay(), ans = gameAnswer(day), rec = gameRec(day);
    const misses = rec.guesses.length, done = rec.done;
    const stage = done ? GAME_TRIES : misses;
    const blur = [2, 1.2, 0.6, 0, 0, 0][stage], zoom = [2.6, 2.1, 1.7, 1.35, 1.12, 1][stage];
    const clues = [
      `${ans.style} \u00b7 ${ans.typology}`,
      `Built in the ${Math.floor(ans.year / 10) * 10}s`,
      `In ${ans.country || ans.city}`,
      `By ${ans.architect.split(' \u00b7 ')[0]}`,
    ].slice(0, done ? 4 : misses);
    const rows = rec.guesses.map(id => {
      const g = BY_ID[id], gi = guessInfo(id, ans);
      return `<div class="game-guess ${gi.right ? 'right' : ''}"><span class="grow ellipsis">${esc(g ? g.name : id)}</span>
        <span>${gi.right ? 'Got it' : `${fmtKm(gi.km)} ${gi.arrow}`}</span><span>${gi.sq}</span></div>`;
    }).join('');
    const q = gameQ.trim().toLowerCase(), tried = new Set(rec.guesses);
    const sugg = !done && q.length >= 2 ? BUILDINGS.filter(b => b.source !== 'live' && !tried.has(b.id) && b.name.toLowerCase().includes(q)).slice(0, 6) : [];
    const friends = done ? gameResults.filter(r => r.day === day && r.userId !== state.me && isFollowing(state.me, r.userId) && user(r.userId)) : [];
    const photo = photoURL(ans, 1600);
    return `<div class="screen with-nav">
      <div class="topbar"><button class="btn-sq thin" data-act="back" aria-label="Back">${icon('back')}</button><div class="h1 grow">Daily Shade #${day}</div>
        ${gameStreak() ? `<span class="chip">${gameStreak()}-day streak</span>` : ''}</div>
      <div class="pad stack">
        <div class="game-photo"><div style="background-image:url('${photo}');filter:blur(${blur}px);transform:scale(${zoom})"></div></div>
        ${clues.length ? `<div class="chips">${clues.map(c => `<span class="chip">${esc(c)}</span>`).join('')}</div>` : '<div class="small muted">Which building is this? Every wrong guess reveals more.</div>'}
        ${rows ? `<div class="stack-6">${rows}</div>` : ''}
        ${done ? `
          <div class="game-end"><b>${rec.won ? `Nice \u2014 ${rec.guesses.length}/5` : 'Out of guesses'}</b>
            <div>It\u2019s <b data-go="#/b/${ans.id}">${esc(ans.name)}</b>, ${esc(ans.architect)}, ${ans.year}.</div></div>
          <div class="scan-actions"><button class="btn" data-go="#/b/${ans.id}">See the building</button><button class="btn on" data-act="gameshare">Share result</button></div>
          ${friends.length ? `<div class="caps">Friends today</div>${friends.map(r => `<div class="row">${avatar(user(r.userId))}<div class="grow"><b>@${esc(user(r.userId).handle)}</b></div><span>${r.won ? r.guesses + '/5' : 'X/5'}</span></div>`).join('')}` : '<div class="small muted" style="text-align:center">Come back tomorrow for a new building.</div>'}`
        : `
          <div class="input-wrap">${icon('search', 'sm')}<input class="input" id="game-in" data-input="gameq" value="${esc(gameQ)}" placeholder="Guess ${misses + 1} of 5 \u2014 type a building" autocomplete="off"></div>
          <div class="stack-6" id="game-sugg">${sugg.map(b => `<button class="row" data-act="gameguess" data-id="${b.id}">${ph(b, { style: 'width:36px;height:36px', go: false })}<div class="grow ellipsis">${esc(b.name)}<div class="sub ellipsis">${esc(b.city || '')}</div></div></button>`).join('')}</div>`}
      </div></div>${nav('home')}`;
  }

  // ---------- Architect collections ----------
  // Collect an architect's buildings like an album: Wikidata lists everything they designed (one query,
  // cached on this device), visited works show in colour, the rest greyed out, with badges for progress.
  const ARCH_KEY = 'throwingshade.arch.v1';
  let archCache = {};
  try { archCache = JSON.parse(localStorage.getItem(ARCH_KEY) || '{}'); } catch (e) { archCache = {}; }
  const archLoading = {};
  // The app joins credits with " · "; "A & B" is split too when both sides look like full names.
  function architectsOf(b) {
    return (b.architect || '').split(' \u00b7 ').flatMap(a => {
      const parts = a.split(' & ');
      return parts.length > 1 && parts.every(x => x.trim().includes(' ')) ? parts : [a];
    }).map(a => a.trim()).filter(a => a.length > 2 && !/^unknown/i.test(a));
  }
  const archLink = name => `<span class="arch-link" data-go="#/architect/${encodeURIComponent(name)}">${esc(name)}</span>`;
  async function loadArchitect(name) {
    if (archCache[name] && archCache[name].works || archLoading[name]) return;
    archLoading[name] = true;
    try {
      const found = await api(WDAPI, { action: 'wbsearchentities', search: name, language: 'en', type: 'item', limit: 7 });
      const hit = (found.search || []).find(h => /architect|firm|practice|designer|engineer|studio/i.test(h.description || '')) || (found.search || [])[0];
      if (!hit) { archCache[name] = { works: [] }; return; }
      const ent = (await api(WDAPI, { action: 'wbgetentities', ids: hit.id, props: 'claims' })).entities[hit.id] || {};
      const portrait = ((ent.claims || {}).P18 || [])[0];
      const q = `SELECT ?item ?itemLabel ?coord ?img ?inc ?countryLabel ?sl WHERE {
        ?item wdt:P84 wd:${hit.id}; wdt:P625 ?coord; wikibase:sitelinks ?sl.
        OPTIONAL { ?item wdt:P18 ?img } OPTIONAL { ?item wdt:P571 ?inc } OPTIONAL { ?item wdt:P17 ?country }
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } } ORDER BY DESC(?sl) LIMIT 400`;
      const rows = await fetch('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(q), { headers: { Accept: 'application/sparql-results+json' } })
        .then(r => r.json()).then(j => j.results.bindings);
      const works = {};
      rows.forEach(r => {
        const v = k => r[k] && r[k].value, qid = v('item').split('/').pop(), m = /Point\(([-\d.eE]+) ([-\d.eE]+)\)/.exec(v('coord') || '');
        if (works[qid] || !m || /^Q\d+$/.test(v('itemLabel'))) return;
        works[qid] = { qid, name: v('itemLabel'), lat: +m[2], lng: +m[1], year: parseInt(v('inc'), 10) || null, country: v('countryLabel'),
          image: v('img') ? decodeURIComponent(v('img').split('/').pop()) : undefined };
      });
      archCache[name] = { qid: hit.id, desc: hit.description, portrait: portrait && portrait.mainsnak.datavalue && portrait.mainsnak.datavalue.value, works: Object.values(works) };
      // Keep the 25 most recently loaded architects on the device.
      const keys = Object.keys(archCache);
      if (keys.length > 25) keys.slice(0, keys.length - 25).forEach(k => { delete archCache[k]; });
      try { localStorage.setItem(ARCH_KEY, JSON.stringify(archCache)); } catch (e) { /* full: keep in memory */ }
    } catch (e) { /* offline or Wikidata busy: the bundled works still show */ }
    finally { delete archLoading[name]; }
    if (/^\/(architect\/|me|u\/|b\/)/.test(currentPath())) render();
  }
  // An architect's works as app places: Wikidata's list when loaded (reusing places the app already
  // has, matched by Wikidata id), else what's bundled.
  function architectWorks(name) {
    const bundled = BUILDINGS.filter(b => architectsOf(b).includes(name));
    const c = archCache[name];
    if (!c || !c.works || !c.works.length) return bundled;
    const byQid = {};
    BUILDINGS.forEach(b => { if (b.qid) byQid[b.qid] = b; });
    const list = c.works.map(w => byQid[w.qid] || (registerBuilding({ id: 'wd-' + w.qid, kind: 'building', name: w.name, architect: name, year: w.year,
      typology: 'Building', style: liveStyle([], w.year), country: w.country, lat: w.lat, lng: w.lng, qid: w.qid, image: w.image, source: 'live' }), BY_ID['wd-' + w.qid]));
    const ids = new Set(list.map(b => b.id));
    return list.concat(bundled.filter(b => !ids.has(b.id)));
  }
  function archBadge(seen, total) {
    if (total > 1 && seen >= total) return 'Completist';
    if (total >= 4 && seen * 2 >= total) return 'Devotee';
    if (seen >= 3) return 'Fan';
    return '';
  }
  function viewArchitect(name) {
    loadArchitect(name);
    const c = archCache[name] || {};
    const works = architectWorks(name);
    const seenIds = new Set(visitsBy(state.me).map(v => v.buildingId));
    const seen = works.filter(b => seenIds.has(b.id)), badge = archBadge(seen.length, works.length);
    const pct = works.length ? Math.round(seen.length / works.length * 100) : 0;
    const sorted = seen.concat(works.filter(b => !seenIds.has(b.id)));
    return `<div class="screen with-nav">
      <div class="topbar"><button class="btn-sq thin" data-act="back" aria-label="Back">${icon('back')}</button><div class="h1 grow ellipsis">${esc(name)}</div></div>
      <div class="pad stack">
        <div class="arch-head">
          ${c.portrait ? `<div class="avatar lg" style="background-image:url('${commonsURL(c.portrait, 200)}');background-size:cover;background-position:center"></div>` : `<div class="avatar lg">${esc(initials(name))}</div>`}
          <div class="grow" style="min-width:0">${c.desc ? `<div class="small muted">${esc(c.desc)}</div>` : ''}
            <b style="font-size:18px">You\u2019ve seen ${seen.length} of ${works.length}${archLoading[name] ? '\u2026' : ''}</b>
            ${badge ? `<div><span class="chip arch-badge">${badge}</span></div>` : ''}</div>
        </div>
        <div class="bar"><div style="width:${pct}%"></div></div>
        <div class="small muted">${archLoading[name] ? 'Finding everything they designed\u2026' : c.works ? 'Works from Wikidata \u00b7 visited ones in colour' : 'Works in throwShade'} \u00b7 Fan at 3, Devotee at half, Completist at all</div>
        <div class="arch-grid">${sorted.map(b => `<button class="arch-tile ${seenIds.has(b.id) ? 'seen' : ''}" data-go="#/b/${b.id}">
          ${ph(b, { w: 300, cls: 'arch-ph', go: false })}${seenIds.has(b.id) ? `<span class="arch-check">${icon('check', 'sm')}</span>` : ''}
          <span class="arch-name ellipsis">${esc(b.name)}</span><span class="arch-meta ellipsis">${esc([b.year, b.city || b.country].filter(Boolean).join(' \u00b7 '))}</span></button>`).join('')}</div>
      </div><div class="spacer"></div></div>${nav('')}`;
  }
  // Profile tab: every architect someone has visited, most-collected first.
  function collectionsHTML(uid) {
    const seenIds = new Set(visitsBy(uid).map(v => v.buildingId)), counts = {};
    visitsBy(uid).forEach(v => { const b = BY_ID[v.buildingId]; if (b) architectsOf(b).forEach(a => { counts[a] = (counts[a] || 0) + 1; }); });
    const names = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b));
    if (!names.length) return `<div class="empty">Log a building to start collecting its architect.</div>`;
    names.slice(0, 12).forEach(n => { if (!archCache[n]) setTimeout(() => loadArchitect(n), 0); });
    return `<div class="stack-6">${names.map(n => {
      const works = architectWorks(n), seen = works.filter(b => seenIds.has(b.id)).length, badge = archBadge(seen, works.length);
      return `<button class="row" data-go="#/architect/${encodeURIComponent(n)}">
        <div class="grow" style="min-width:0"><div class="ellipsis"><b>${esc(n)}</b>${badge ? ` <span class="chip arch-badge">${badge}</span>` : ''}</div>
          <div class="bar" style="margin-top:6px"><div style="width:${works.length ? Math.round(seen / works.length * 100) : 0}%"></div></div></div>
        <span class="small muted" style="white-space:nowrap">${seen} / ${archCache[n] && archCache[n].works ? works.length : '\u2026'}</span></button>`;
    }).join('')}</div>`;
  }

  // ---------- Share cards ----------
  // Story-sized PNGs (1080x1920) for a single rating or a month of visits, shared through the
  // phone's share sheet (Instagram, WhatsApp...) or downloaded on a computer.
  const loadImg = src => new Promise(res => {
    if (!src) return res(null);
    const i = new Image(); i.crossOrigin = 'anonymous';
    i.onload = () => res(i); i.onerror = () => res(null); i.src = src;
  });
  function coverDraw(x, img, dx, dy, dw, dh) {
    const r = Math.max(dw / img.width, dh / img.height), sw = dw / r, sh = dh / r;
    x.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, dx, dy, dw, dh);
  }
  function wrapText(x, text, max) {
    const out = []; let cur = '';
    String(text).split(/\s+/).filter(Boolean).forEach(w => { const t = cur ? cur + ' ' + w : w; if (x.measureText(t).width <= max || !cur) cur = t; else { out.push(cur); cur = w; } });
    if (cur) out.push(cur);
    return out;
  }
  async function directPhotos(urls, w) {
    const files = urls.map(u => { const m = /Special:FilePath\/([^?]+)/.exec(u || ''); return m ? decodeURIComponent(m[1]) : null; });
    const want = [...new Set(files.filter(Boolean))];
    const map = {};
    for (let i = 0; i < want.length; i += 50) {
      try {
        const j = await fetch('https://commons.wikimedia.org/w/api.php?' + qs({ action: 'query', format: 'json', origin: '*', prop: 'imageinfo', iiprop: 'url', iiurlwidth: w,
          titles: want.slice(i, i + 50).map(f => 'File:' + f).join('|') })).then(r => r.json());
        const alias = {};
        ((j.query || {}).normalized || []).forEach(n => { alias[n.to] = n.from; });
        Object.values((j.query || {}).pages || {}).forEach(pg => {
          const info = (pg.imageinfo || [])[0];
          if (info) map[(alias[pg.title] || pg.title).replace(/^File:/, '')] = info.thumburl || info.url;
        });
      } catch (e) { /* fall back to the original links */ }
    }
    return urls.map((u, i) => files[i] ? (map[files[i]] || map[files[i].replace(/_/g, ' ')] || u) : u);
  }
  async function shareCardBlob(kind, data) {
    const W = 1080, H = 1920, F = '"IBM Plex Sans", system-ui, sans-serif';
    try { await Promise.all([document.fonts.load('700 40px "IBM Plex Sans"'), document.fonts.load('400 40px "IBM Plex Sans"')]); } catch (e) { /* system font */ }
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    x.fillStyle = '#111'; x.fillRect(0, 0, W, H);
    if (kind === 'rating') {
      const img = await loadImg((await directPhotos([data.photo], 1080))[0]);
      if (img) coverDraw(x, img, 0, 0, W, H);
      const g = x.createLinearGradient(0, H * 0.35, 0, H);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.88)');
      x.fillStyle = g; x.fillRect(0, 0, W, H);
      x.textBaseline = 'top';
      x.font = `700 84px ${F}`; const titleL = wrapText(x, data.title, W - 160).slice(0, 3);
      x.font = `400 46px ${F}`; const noteL = data.note ? wrapText(x, '\u201c' + data.note + '\u201d', W - 160).slice(0, 4) : [];
      const blockH = titleL.length * 96 + 24 + 48 + 28 + 84 + (noteL.length ? 40 + noteL.length * 62 : 0) + 56 + 44;
      let y = H - 130 - blockH;
      x.fillStyle = '#fff'; x.font = `700 84px ${F}`; titleL.forEach(l => { x.fillText(l, 80, y); y += 96; });
      y += 24; x.font = `400 40px ${F}`; x.fillStyle = 'rgba(255,255,255,.8)'; x.fillText(data.sub, 80, y); y += 48;
      y += 28; x.font = `700 72px ${F}`; x.fillStyle = '#fff'; x.fillText('\u2605'.repeat(data.stars) + '\u2606'.repeat(5 - data.stars), 80, y); y += 84;
      if (noteL.length) { y += 40; x.font = `400 46px ${F}`; noteL.forEach(l => { x.fillText(l, 80, y); y += 62; }); }
      y += 56; x.font = `400 38px ${F}`; x.fillStyle = 'rgba(255,255,255,.8)'; x.fillText(`@${data.handle} on throwShade`, 80, y);
      x.textBaseline = 'alphabetic';
    } else {
      // Month grid: up to 12 photos, 3 across.
      const imgs = await Promise.all((await directPhotos(data.photos.slice(0, 12), 400)).map(loadImg));
      const cols = 3, gap = 16, size = (W - 160 - gap * 2) / 3, top = 420;
      x.fillStyle = '#fff'; x.font = `700 96px ${F}`; x.fillText(data.title, 80, 230);
      x.font = `400 44px ${F}`; x.fillStyle = 'rgba(255,255,255,.75)'; x.fillText(data.sub, 80, 310);
      imgs.forEach((img, i) => {
        const cx = 80 + (i % cols) * (size + gap), cy = top + Math.floor(i / cols) * (size + gap);
        x.save(); x.beginPath(); x.roundRect ? x.roundRect(cx, cy, size, size, 28) : x.rect(cx, cy, size, size); x.clip();
        if (img) coverDraw(x, img, cx, cy, size, size); else { x.fillStyle = '#2a2a2a'; x.fillRect(cx, cy, size, size); }
        x.restore();
      });
      x.font = `400 38px ${F}`; x.fillStyle = 'rgba(255,255,255,.8)'; x.fillText(`@${data.handle} on throwShade`, 80, H - 120);
    }
    x.font = `700 44px ${F}`; x.fillStyle = '#fff'; x.fillText('throwShade', 80, 120);
    return new Promise(res => {
      try { c.toBlob(b => res(b), 'image/png'); } catch (e) { res(null); }  // a photo without CORS taints the canvas
    });
  }
  async function shareCard(kind, data, name) {
    toast('Making your card\u2026');
    let blob = await shareCardBlob(kind, data);
    if (!blob && data.photo) blob = await shareCardBlob(kind, Object.assign({}, data, { photo: null }));
    if (!blob) return toast('Couldn\u2019t make the image');
    const file = new File([blob], name + '.png', { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: data.title }).catch(() => {});
    } else {
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast('Card downloaded');
    }
  }

  // ---------- Monthly recap ----------
  // A short story of one month: how much you logged, the best and the worst, your style and cities.
  let recapMonth = null, recapIdx = 0, recapTimer = null;
  const monthKey = ts => isoDate(ts).slice(0, 7);
  const monthLabel = mk => { const [y, m] = mk.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long' }); };
  const monthVisits = mk => visitsBy(state.me).filter(v => (v.visitedOn || isoDate(v.createdAt)).startsWith(mk) && BY_ID[v.buildingId]);
  // Last month while it's fresh (first ten days), otherwise this month once there's enough in it.
  // "On this day": a log from this date in an earlier year, else from a month or a week ago.
  function memoryHTML() {
    const today = isoDate(Date.now()), md = today.slice(5);
    const mine = visitsBy(state.me).filter(v => BY_ID[v.buildingId]).map(v => ({ v, day: v.visitedOn || isoDate(v.createdAt) }));
    const back = n => isoDate(Date.now() - n * DAY);
    const pick = mine.filter(x => x.day.slice(5) === md && x.day < today).map(x => ({ ...x, when: `${+today.slice(0, 4) - +x.day.slice(0, 4)} year${+today.slice(0, 4) - +x.day.slice(0, 4) === 1 ? '' : 's'} ago today` }))[0]
      || mine.filter(x => x.day === back(30)).map(x => ({ ...x, when: 'A month ago today' }))[0]
      || mine.filter(x => x.day === back(7)).map(x => ({ ...x, when: 'A week ago today' }))[0];
    if (!pick) return '';
    const b = BY_ID[pick.v.buildingId];
    return `<button class="memory" data-go="#/b/${b.id}">${ph(b, { w: 300, cls: 'memory-ph', go: false })}
      <span class="grow" style="min-width:0"><span class="caps">${esc(pick.when)}</span><b class="ellipsis" style="display:block">${esc(b.name)}</b>
        <span class="small muted">You gave it ${'\u2605'.repeat(pick.v.stars)}${pick.v.note ? ` \u00b7 \u201c${esc(pick.v.note.slice(0, 40))}${pick.v.note.length > 40 ? '\u2026' : ''}\u201d` : ''}</span></span></button>`;
  }
  function recapCandidate() {
    const now = new Date(), last = monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 15).getTime()), cur = monthKey(Date.now());
    if (now.getDate() <= 10 && monthVisits(last).length) return last;
    return monthVisits(cur).length >= 3 ? cur : null;
  }
  function recapCardHTML() {
    const mk = recapCandidate();
    if (!mk) return '';
    const n = monthVisits(mk).length;
    return `<button class="game-card" data-go="#/recap/${mk}"><span class="game-card-icon">${icon('clock', 'sm')}</span>
      <span class="grow"><b>Your ${esc(monthLabel(mk))} in shade</b><span class="small muted" style="display:block">${n} building${n === 1 ? '' : 's'} \u00b7 tap to watch</span></span>${icon('chevron', 'sm')}</button>`;
  }
  function recapSlides(mk) {
    const vs = monthVisits(mk), bs = vs.map(v => BY_ID[v.buildingId]);
    const best = vs.slice().sort((a, b) => b.stars - a.stars || b.createdAt - a.createdAt)[0];
    const worst = vs.slice().sort((a, b) => a.stars - b.stars || b.createdAt - a.createdAt)[0];
    const tally = list => Object.entries(list.filter(Boolean).reduce((m, k) => (m[k] = (m[k] || 0) + 1, m), {})).sort((a, b) => b[1] - a[1]);
    const style = tally(bs.map(b => b.style))[0], cities = tally(bs.map(b => b.city));
    const photo = b => ph(b, { w: 1200, cls: 'wrap-photo', go: false });
    const slides = [{ bg: '#111', html: `<div class="r-kicker">${esc(monthLabel(mk))} in shade</div><div class="r-big">${vs.length}</div><div class="r-sub">building${vs.length === 1 ? '' : 's'} logged</div>` }];
    if (best) slides.push({ photo: photo(BY_ID[best.buildingId]), bottom: true, html: `<div class="r-kicker">Your top rating</div><div class="r-title">${esc(BY_ID[best.buildingId].name)}</div><div class="r-sub">${'\u2605'.repeat(best.stars)}${best.note ? ` \u00b7 \u201c${esc(best.note)}\u201d` : ''}</div>` });
    if (worst && worst !== best && worst.stars < best.stars) slides.push({ photo: photo(BY_ID[worst.buildingId]), bottom: true, html: `<div class="r-kicker">Most shade thrown</div><div class="r-title">${esc(BY_ID[worst.buildingId].name)}</div><div class="r-sub">${'\u2605'.repeat(worst.stars)}${'\u2606'.repeat(5 - worst.stars)}</div>` });
    if (style) slides.push({ bg: STYLES[style[0]] || '#111', html: `<div class="r-kicker">Your style this month</div><div class="r-title">${esc(style[0])}</div><div class="r-sub">${style[1]} of ${vs.length}</div>` });
    if (cities.length) slides.push({ bg: '#111', html: `<div class="r-kicker">Where you went</div><div class="r-title">${cities.slice(0, 3).map(c => esc(c[0])).join('<br>')}</div><div class="r-sub">${cities.length} cit${cities.length === 1 ? 'y' : 'ies'}</div>` });
    slides.push({ bg: '#111', html: `<div class="r-kicker">That\u2019s your ${esc(monthLabel(mk))}</div><div class="r-title">Share it?</div>
      <button class="btn on recap-share" data-act="recapshare">${icon('share', 'sm')}Share your month</button>` });
    return slides;
  }
  function viewRecap(mk) {
    if (!/^\d{4}-\d{2}$/.test(mk || '') || !monthVisits(mk).length) return viewNotFound();
    if (recapMonth !== mk) { recapMonth = mk; recapIdx = 0; }
    const slides = recapSlides(mk);
    recapIdx = Math.max(0, Math.min(recapIdx, slides.length - 1));
    const sl = slides[recapIdx], last = recapIdx === slides.length - 1;
    const bars = slides.map((_, i) => `<div><span class="${i < recapIdx || (i === recapIdx && last) ? 'done' : i === recapIdx ? 'run story-run' : ''}"></span></div>`).join('');
    return `<div class="screen fixed wrap" style="background:${sl.bg || '#111'}">${sl.photo || ''}
      <div class="wrap-bars">${bars}</div>
      <button class="btn-sq wrap-close" data-act="recapclose" aria-label="Close">${icon('x')}</button>
      <button class="wrap-tap prev" data-act="recapprev" aria-label="Previous"></button>
      ${last ? '' : '<button class="wrap-tap next" data-act="recapnext" aria-label="Next"></button>'}
      <div class="wrap-body ${sl.bottom ? 'bottom' : ''}">${sl.html}</div></div>`;
  }
  function startRecap() {
    clearTimeout(recapTimer);
    if (root.querySelector('.wrap-tap.next')) recapTimer = setTimeout(() => { if (currentPath().startsWith('/recap/')) actions.recapnext(); }, 5000);
  }

  function viewBadges(uid) {
    const u = user(uid);
    if (!u) return viewNotFound();
    const list = badgesFor(uid).sort((a, b) => b.earned - a.earned || (b.p / b.t) - (a.p / a.t));
    const earned = list.filter(x => x.earned).length;
    return `<div class="screen with-nav">
      <div class="topbar"><button class="btn-sq thin" data-act="back" aria-label="Back">${icon('back')}</button><div class="h1 grow">${uid === state.me ? 'Your badges' : esc(u.handle) + '\u2019s badges'}</div><span class="small muted">${earned}/${list.length}</span></div>
      <div class="pad stack-6">${list.map(x => `<div class="badge-row ${x.earned ? 'on' : ''}">
        <div class="badge-icon">${x.icon}</div>
        <div class="grow" style="min-width:0"><b>${esc(x.label)}</b><div class="small muted">${esc(x.desc)}</div>
          ${x.earned ? '' : `<div class="bar" style="margin-top:6px"><div style="width:${Math.round(x.p / x.t * 100)}%"></div></div>`}</div>
        <span class="small ${x.earned ? '' : 'muted'}" style="white-space:nowrap">${x.earned ? '\u2713 Earned' : x.prog || `${x.p}/${x.t}`}</span></div>`).join('')}</div>
      <div class="spacer"></div></div>${nav('')}`;
  }

  function viewSettings() {
    const u = me();
    const field = (id, label, attrs) => `<div class="field"><label for="${id}">${label}</label><input id="${id}" class="input" autocapitalize="none" spellcheck="false" ${attrs}></div>`;
    return `<div class="screen with-nav">
      <div class="topbar"><button class="btn-sq thin" data-act="back" aria-label="Back">${icon('back')}</button><div class="h1 grow">Account settings</div></div>
      <div class="pad stack">
        <div class="settings-card"><b>Privacy</b>
          <button class="theme-toggle ${u.private ? 'on' : ''}" data-act="toggleprivate" aria-pressed="${!!u.private}">${icon('user')}<span class="grow" style="text-align:left"><b>Private profile</b><span class="small muted" style="display:block">Only people who follow you see your logs, lists and stories</span></span><span class="switch"></span></button></div>
        <div class="settings-card"><b>Change password</b>
          ${field('pw-old', 'Current password', 'type="password" autocomplete="current-password"')}
          ${field('pw-new', 'New password', 'type="password" autocomplete="new-password" placeholder="At least 8 characters"')}
          <button class="btn on" style="height:46px" data-act="changepw">Update password</button>
          <div class="small muted">This signs you out everywhere else.</div></div>
        <div class="settings-card danger"><b>Delete account</b>
          <div class="small muted">Permanently removes @${esc(u.handle)} and everything you\u2019ve logged, saved, posted and commented. This can\u2019t be undone.</div>
          ${field('del-handle', `Type ${esc(u.handle)} to confirm`, 'autocomplete="off"')}
          ${field('del-pass', 'Password', 'type="password" autocomplete="current-password"')}
          <button class="btn danger-btn" style="height:46px" data-act="deleteaccount">Delete my account</button></div>
      </div><div class="spacer"></div></div>${nav('you')}`;
  }

  // Building page: more by the same architect, and what else is close by.
  function relatedRailsHTML(b) {
    const arch = architectsOf(b)[0];
    const byArch = arch ? architectWorks(arch).filter(x => x.id !== b.id && x.lat).sort((x, y) => (y.image ? 1 : 0) - (x.image ? 1 : 0)).slice(0, 10) : [];
    const near = BUILDINGS.filter(x => x.id !== b.id && x.lat).map(x => ({ x, d: km(b, x) })).filter(o => o.d <= 2).sort((a, c) => a.d - c.d).slice(0, 10);
    const tile = (x, meta) => `<button class="rail-item" data-go="#/b/${x.id}">${ph(x, { w: 300, cls: 'rail-photo', label: phLabel(x), go: false })}
      <div class="rail-name ellipsis">${esc(x.name)}</div><div class="rail-meta muted ellipsis">${esc(meta)}</div></button>`;
    const rail = (title, link, items) => items.length ? `<div><div class="section-title">${title}${link ? `<button class="link" data-go="${link}">See all${icon('chevron', 'sm')}</button>` : ''}</div>
      <div class="rail flush">${items.join('')}</div></div>` : '';
    if (arch && !archCache[arch]) setTimeout(() => loadArchitect(arch), 0);
    return rail(`More by ${esc(arch || '')}`, arch ? '#/architect/' + encodeURIComponent(arch) : '', byArch.map(x => tile(x, [x.year, x.city || x.country].filter(Boolean).join(' \u00b7 '))))
      + rail('Nearby', '', near.map(o => tile(o.x, fmtKm(o.d))));
  }

  // ---------- Welcome tour (once, after signing up) ----------
  let tourIdx = 0;
  const TOUR = [
    ['building', 'Rate every building', 'Give anywhere you walk into 1\u20135 stars, tag what stood out, add photos. Honest shade welcome.'],
    ['camera', 'Point, scan, log', 'Use the camera button to identify the building in front of you, or explore the map \u2014 it covers the whole world.'],
    ['award', 'Play every day', 'Guess the Daily Shade building, fill your City Bingo card, finish weekly challenges and collect architects.'],
    ['users', 'Bring your friends', 'Follow people to see their ratings, stories and favourite places, and compare your taste head-to-head.'],
  ];
  function viewWelcome() {
    const [ic, title, body] = TOUR[tourIdx], last = tourIdx === TOUR.length - 1;
    return `<div class="screen"><div class="tour">
      <div class="tour-top"><span class="small muted">${tourIdx + 1} / ${TOUR.length}</span>${last ? '' : '<button class="link" data-act="tourdone">Skip</button>'}</div>
      <div class="tour-icon">${icon(ic)}</div>
      <div class="h1" style="text-align:center">${title}</div>
      <div class="muted" style="text-align:center;line-height:1.5">${body}</div>
      <div class="tour-dots">${TOUR.map((_, i) => `<i class="${i === tourIdx ? 'on' : ''}"></i>`).join('')}</div>
      <button class="btn-primary" data-act="${last ? 'tourdone' : 'tournext'}">${last ? 'Start exploring' : 'Next'}</button>
    </div></div>`;
  }

  function viewEditProfile() {
    const u = me();
    // 15 random presets, always including the current one so it shows as selected.
    const picks = PRESET_AVATARS.filter(p => p !== u.photo).sort(() => Math.random() - .5).slice(0, PRESET_AVATARS.includes(u.photo) ? 14 : 15);
    if (PRESET_AVATARS.includes(u.photo)) picks.splice(Math.floor(Math.random() * 15), 0, u.photo);
    return sheet('Edit profile', 1, 1,
      `<button class="btn-sq thin" data-act="closeedit" aria-label="Close">${icon('x')}</button>`,
      `<div class="field"><div class="label">Profile picture</div>
         <div class="avatar-picker">${picks.map(p => `<button class="avatar-pick ${u.photo === p ? 'on' : ''}" data-act="pickavatar" data-src="${p}" style="background-image:url('${p}')" aria-label="Choose this picture"></button>`).join('')}</div></div>
       <div class="field"><label for="ep-name">Display name</label><input id="ep-name" class="input" value="${esc(u.name)}" maxlength="40"></div>
       <div class="field"><label for="ep-handle">Handle</label><input id="ep-handle" class="input" value="${esc(u.handle)}" maxlength="20" autocapitalize="none"></div>
       <div class="field"><label for="ep-bio">Bio</label><textarea id="ep-bio" class="input" data-input="epbio" maxlength="140" style="height:80px">${esc(u.bio || '')}</textarea>
         <div class="counter" id="ep-bio-count">${(u.bio || '').length} / 140</div></div>
       <div class="sheet-foot"><button class="btn-primary" data-act="saveprofile">Save</button></div>`);
  }

  function sheet(title, step, total, left, body) {
    const bars = Array.from({ length: total }, (_, i) => `<div class="${i < step ? 'on' : ''}"></div>`).join('');
    return `<div class="screen fixed"><div class="scrim" data-act="closelog"></div><div class="sheet">
      <div class="grabber"></div>
      <div class="sheet-head">${left}<div class="title">${title}</div><div class="step">${step} / ${total}</div></div>
      <div class="progress">${bars}</div>
      ${body}
    </div></div>`;
  }

  function logResults(q) {
    q = (q || '').trim().toLowerCase();
    const list = q ? BUILDINGS.filter(b => [b.name, b.architect, b.city, b.style, b.typology, KINDS[kindOf(b)]].join(' ').toLowerCase().includes(q)) : BUILDINGS;
    const rows = nearest(list).slice(0, q ? 40 : 12).map(x => {
      const mv = myVisit(x.b.id);
      return `<button class="row" data-go="#/log/${x.b.id}">
        ${ph(x.b, { style: 'width:38px;height:38px', go: false })}
        <div class="grow"><div class="ellipsis">${esc(x.b.name)}</div><div class="sub ellipsis">${esc(makerLine(x.b))}</div></div>
        <span class="small ${mv ? '' : 'muted'}">${mv ? `Your ${mv.stars}★` : fmtKm(x.d)}</span>
      </button>`;
    }).join('');
    if (!q && !loc) return locPrompt();
    return (q ? '' : `<div class="caps">Nearby</div>`) + (rows || `<div class="empty">No places match “${esc(q)}”.</div>`);
  }

  function viewLogPick() {
    return sheet('Throw Shade', 1, 2,
      `<button class="btn-sq thin" data-act="closelog" aria-label="Close">${icon('x')}</button>`,
      `<div class="input-wrap">${icon('search')}<input class="input" data-input="logq" placeholder="Search buildings, bridges, art, spots" autocomplete="off"></div>
       <button class="btn dashed" style="height:48px" data-act="pinfrommap">${icon('pin', 'sm')}Not listed? Drop a pin on the map</button>
       <div id="logresults" class="stack-6">${logResults('')}</div>`);
  }

  function viewLogRate(bid) {
    const b = BY_ID[bid];
    if (!b) return viewNotFound();
    if (!draft || draft.bid !== bid) {
      const mv = myVisit(bid);
      draft = mv
        ? { bid, stars: mv.stars, note: mv.note || '', date: mv.visitedOn, photos: mv.photos.slice(), likes: mv.likes.slice() }
        : { bid, stars: 0, note: '', date: isoDate(Date.now()), photos: [], likes: [] };
    }
    const starBtns = [1, 2, 3, 4, 5].map(n => `<button data-act="star" data-n="${n}" class="${n <= draft.stars ? 'on' : ''}" aria-label="${n} star${n > 1 ? 's' : ''}">${n <= draft.stars ? starSVG('currentColor', 'currentColor') : starSVG('none', 'currentColor')}</button>`).join('');
    const editing = !!myVisit(bid);
    return sheet('Your critique', 2, 2,
      `<button class="btn-sq thin" data-go="#/log" aria-label="Back">${icon('back')}</button>`,
      `<div class="banner" style="display:flex;gap:12px;align-items:center;padding:10px">
         ${ph(b, { style: 'width:56px;height:56px', go: false })}
         <div style="line-height:1.3"><b style="font-size:16px">${esc(b.name)}</b><div class="small muted">${esc(byLine(b))}</div></div>
       </div>
       <div class="field"><div class="label">Your rating</div><div class="star-input" id="star-input">${starBtns}</div>
         <div class="star-caption" id="star-caption">${STAR_WORDS[draft.stars] || '<span class="muted" style="font-weight:400;font-size:14px">Tap to rate</span>'}</div></div>
       <div class="field"><div class="label">What stood out? <span class="muted" style="font-weight:400">tap all that apply</span></div>
         <div class="chips aspects">${ASPECTS.map(a => `<button class="pill ${draft.likes.includes(a) ? 'on' : ''}" data-act="aspect" data-k="${a}">${a}</button>`).join('')}</div></div>
       <div class="field"><label for="visitdate">Date visited</label><input id="visitdate" class="input" type="date" data-input="date" value="${draft.date}" max="${isoDate(Date.now())}"></div>
       <div class="field"><div class="label">Photos <span class="muted" style="font-weight:400">optional · up to ${MAX_PHOTOS}</span></div>
         <div class="photo-row">
           ${draft.photos.map((p, i) => `<div class="ph photo" style="width:72px;height:72px;background-image:url('${p}');background-size:cover;background-position:center">
              <button class="btn-sq rm" data-act="rmphoto" data-i="${i}" aria-label="Remove photo">${icon('x', 'sm')}</button></div>`).join('')}
           ${draft.photos.length < MAX_PHOTOS ? `<label class="photo-add" for="photo-in" aria-label="Add photos">${icon('camera', 'lg')}</label>` : ''}
         </div>
         <input id="photo-in" type="file" accept="image/*" multiple hidden data-change="photo"></div>
       <div class="field"><label for="critique">Quick critique</label>
         <textarea id="critique" class="input" maxlength="280" data-input="note" placeholder="Say something sharp…">${esc(draft.note)}</textarea>
         <div class="counter" id="note-count">${draft.note.length} / 280</div></div>
       <div class="sheet-foot stack-6">
         <button class="btn-primary" data-act="post">${editing ? 'Update critique' : 'Post critique'}</button>
         ${editing ? `<button class="btn block danger ${delArmed ? 'on' : ''}" data-act="delvisit" data-id="${bid}">${delArmed ? 'Tap again to delete' : 'Delete critique'}</button>` : ''}
       </div>`);
  }

  function viewNotFound() {
    return `<div class="screen with-nav"><div class="topbar"><button class="btn-sq thin" data-act="back" aria-label="Back">${icon('back')}</button></div>
      <div class="pad"><div class="empty">That page doesn’t exist.</div></div></div>${nav('')}`;
  }

  // ---------- Map ----------
  function destroyMap() {
    if (map) { map.remove(); map = null; mapMarkers = {}; heatLayer = null; }
    if (pinMap) { pinMap.remove(); pinMap = null; }
    if (beenMap) { beenMap.remove(); beenMap = null; }
    if (radioMap) { radioMap.remove(); radioMap = null; }
    clusterGroup = null; heatLayer = null;
    pinMode = false;
  }
  function setPinMode(on) {
    pinMode = on;
    const btn = document.getElementById('pinbtn'), hint = document.getElementById('map-hint');
    if (btn) btn.classList.toggle('on', on);
    if (hint) hint.hidden = !on;
    if (on && mapFiltersOpen) { mapFiltersOpen = false; render(); }
  }
  function placePin(latlng) {
    setPinMode(false);
    go(`#/pin/${latlng.lat.toFixed(6)},${latlng.lng.toFixed(6)}`);
  }

  // ---------- Map filters ----------
  const SHOW_LABEL = { been: 'Been', want: 'Want to visit', friends: 'Friends\u2019 places' };
  const KIND_FILTERS = [['all', 'All'], ['building', 'Buildings'], ['bridge', 'Bridges'], ['art', 'Art'], ['spot', 'Spots']];
  function mapActiveFilters() {
    const out = [];
    if (mapFilter !== 'all') out.push({ f: 'show', k: mapFilter, label: SHOW_LABEL[mapFilter] });
    if (mapKind !== 'all') out.push({ f: 'kind', k: mapKind, label: KIND_FILTERS.find(x => x[0] === mapKind)[1] });
    if (mapMinRating > 0) out.push({ f: 'rating', k: String(mapMinRating), label: mapMinRating + '\u2605+' });
    mapStyles.forEach(st => out.push({ f: 'style', k: st, label: st, dot: STYLES[st] }));
    return out;
  }
  // The sheet edits a draft; the map only redraws when you tap "Show".
  function mapSheetInner() {
    const d = mapDraft, n = mapBuildings(d).length;
    const seg = (field, opts) => `<div class="seg">${opts.map(([k, label]) => `<button class="${String(d[field]) === String(k) ? 'on' : ''}" data-act="mfd" data-f="${field}" data-k="${k}">${label}</button>`).join('')}</div>`;
    return `<div class="filter-sheet-head"><b>Filters</b><button class="btn-sq thin" data-act="mapfilterclose" aria-label="Close">${icon('x', 'sm')}</button></div>
      <div class="filter-sheet-body">
        <div class="caps">Show</div>${seg('show', [['all', 'All'], ['been', 'Been'], ['want', 'Want'], ['friends', 'Friends']])}
        <div class="caps">Type</div>${seg('kind', KIND_FILTERS)}
        <div class="caps">Rating</div>${seg('rating', [[0, 'Any'], [3, '3\u2605+'], [4, '4\u2605+'], [4.5, '4.5\u2605+']])}
        <div class="row-flex" style="justify-content:space-between;align-items:baseline"><div class="caps">Style${d.styles.size ? ` \u00b7 ${d.styles.size}` : ''}</div>${d.styles.size ? '<button class="link" data-act="mfdstyleclear">Clear</button>' : '<span class="small muted">Pick any</span>'}</div>
        <div class="style-chips">${Object.entries(STYLES).map(([st, c]) => `<button class="style-chip ${d.styles.has(st) ? 'on' : ''}" data-act="mfdstyle" data-k="${esc(st)}"><span class="dot" style="background:${c}"></span>${esc(st)}</button>`).join('')}</div>
        <div class="map-key"><span><i class="k-dot"></i>Building</span><span><i class="k-sq"></i>Bridge</span><span><i class="k-di"></i>Art</span><span><i class="k-ring"></i>Spot</span><span><i class="k-dot"></i>Filled = been</span><span><i class="k-hollow"></i>Hollow = want</span></div>
      </div>
      <div class="filter-sheet-foot"><button class="btn" data-act="mfdreset">Reset</button><button class="btn on" data-act="mfdapply"${n ? '' : ' disabled'}>${n ? `Show ${n.toLocaleString()} place${n === 1 ? '' : 's'}` : 'No places match'}</button></div>`;
  }
  function refreshMapSheet() { const el = document.getElementById('map-sheet'); if (el) el.innerHTML = mapSheetInner(); }

  function mapBuildings(f) {
    f = f || { show: mapFilter, kind: mapKind, styles: mapStyles, rating: mapMinRating };
    const fids = followingIds(state.me);
    const been = new Set(visitsBy(state.me).map(v => v.buildingId));
    const want = new Set(state.want.filter(w => w.userId === state.me).map(w => w.buildingId));
    const friends = new Set(state.visits.filter(v => fids.has(v.userId)).map(v => v.buildingId));
    const kind = b => been.has(b.id) ? 'been' : want.has(b.id) ? 'want' : 'other';
    let list = BUILDINGS;
    if (f.show === 'been') list = list.filter(b => been.has(b.id));
    if (f.show === 'want') list = list.filter(b => want.has(b.id));
    if (f.show === 'friends') list = list.filter(b => friends.has(b.id));
    if (f.kind !== 'all') list = list.filter(b => kindOf(b) === f.kind);
    if (f.styles.size) list = list.filter(b => f.styles.has(b.style));
    if (f.rating > 0) list = list.filter(b => (avgFor(b.id).avg || 0) >= f.rating);
    if (mapQ.trim()) { const q = mapQ.trim().toLowerCase(); list = list.filter(b => [b.name, b.city, b.architect].filter(Boolean).join(' ').toLowerCase().includes(q)); }
    return list.map(b => ({ b, kind: f.show === 'friends' && kind(b) === 'other' ? 'been' : kind(b) }));
  }
  // People you follow who've logged a place, most recent first.
  function friendVisitors(bid) {
    const fids = followingIds(state.me);
    return state.visits.filter(v => v.buildingId === bid && fids.has(v.userId) && user(v.userId)).sort((a, b) => b.createdAt - a.createdAt);
  }
  const friendsLayer = () => mapFriends || mapFilter === 'friends';
  function pinIcon(b, kind) {
    const fv = friendsLayer() ? friendVisitors(b.id) : [];
    if (fv.length) {
      // Friends layer: the latest friend's face, with a count when several have been.
      const u = user(fv[0].userId), bg = u.photo ? `background-image:url('${u.photo}')` : '';
      return window.L.divIcon({ className: '', html: `<div class="pin-face ${mapSel === b.id ? 'sel' : ''}" style="${bg}">${u.photo ? '' : esc(initials(u.name))}${fv.length > 1 ? `<b>${fv.length}</b>` : ''}</div>`, iconSize: [34, 34], iconAnchor: [17, 17] });
    }
    const cls = kind === 'been' ? '' : kind;
    return window.L.divIcon({ className: '', html: `<div class="pin k-${kindOf(b)} ${cls} ${mapSel === b.id ? 'sel' : ''} ${mapHeat ? 'dim' : ''}" style="--c:${styleColor(b)}"></div>`, iconSize: [20, 20], iconAnchor: [10, 10] });
  }
  function renderMapCard() {
    const el = document.getElementById('map-card');
    if (!el) return;
    const b = BY_ID[mapSel];
    if (!b) { el.innerHTML = ''; return; }
    const a = avgFor(b.id), mv = myVisit(b.id);
    el.innerHTML = `<button class="map-card" style="width:calc(100% - 24px)" data-go="#/b/${b.id}">
      ${ph(b, { w: 160, style: 'width:64px;height:64px', go: false })}
      <div class="grow" style="line-height:1.3"><b>${esc(b.name)}</b><div class="small muted">${esc(byLine(b))}</div>
        <div class="small">${[esc(b.city), fmtKm(km(loc, b))].filter(Boolean).join(' · ')}${mv ? ` · you: ${mv.stars}★` : ''}</div></div>
      <div style="font-size:20px">${a.avg ? scoreHTML(a.avg.toFixed(1)) : '<span class="small muted">No logs</span>'}</div>
    </button>${(() => {
      const fv = friendVisitors(b.id);
      return fv.length ? `<div class="map-card-friends">${fv.slice(0, 4).map(v => `<span>${avatar(user(v.userId), 'xs')}@${esc(user(v.userId).handle)} ${v.stars}★</span>`).join('')}${fv.length > 4 ? `<span class="muted">+${fv.length - 4}</span>` : ''}</div>` : '';
    })()}`;
  }
  function addMarker(b, kind) {
    const m = window.L.marker([b.lat, b.lng], { icon: pinIcon(b, kind) });
    m.on('click', () => {
      const prev = mapSel; mapSel = b.id;
      [prev, b.id].forEach(id => { const r = mapMarkers[id]; if (r) r.marker.setIcon(pinIcon(r.b, r.kind)); });
      renderMapCard();
    });
    mapMarkers[b.id] = { marker: m, b, kind };
    (clusterGroup || map).addLayer(m);
  }

  // Live places: the bundled data only covers a few cities, so on pan/zoom pull the most notable
  // buildings in view (has an architect on Wikidata, ranked by Wikipedia sitelinks). Each area is
  // fetched once per session; results join BUILDINGS like any other place.
  const LIVE_STYLES = [
    ['Brutalist', /brutal/], ['Deconstructivist', /deconstruct/], ['Postmodern', /post-?modern/],
    ['High-tech', /high-tech|structural expressionism|late modern/], ['Art Deco', /art deco|streamline/],
    ['Contemporary', /contemporary|neo-futur|parametric|blobitecture|sustainable|critical regionalism|minimalis/],
    ['Modernist', /modern|international style|bauhaus|functionalis|expressionis|mid-century|organic|new objectivity|prairie|chicago school|constructivis|googie|metabolis|rationalis/],
    ['Historic', /./],
  ];
  function liveStyle(styles, year) {
    const t = styles.join(' ').toLowerCase();
    if (t) return LIVE_STYLES.find(([, rx]) => rx.test(t))[0];
    if (!year) return 'Modernist';
    return year < 1920 ? 'Historic' : year < 1990 ? 'Modernist' : 'Contemporary';
  }
  // Live places from open APIs (no key): Wikipedia finds pages by location or text in ~0.3s, then
  // Wikidata's entity API fills in architect, year and style. Much faster than SPARQL queries.
  const WIKI = 'https://en.wikipedia.org/w/api.php?', WDAPI = 'https://www.wikidata.org/w/api.php?';
  const api = (base, params) => fetch(base + qs({ format: 'json', origin: '*', ...params })).then(r => r.json());
  const chunks = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
  const ARCH_DESC = /building|house|tower|skyscraper|church|cathedral|chapel|basilica|abbey|monastery|temple|shrine|pagoda|synagogue|mosque|museum|gallery|library|station|terminal|airport|stadium|arena|theat|opera|concert|hall|palace|castle|fort|bridge|hotel|school|university|college|hospital|monument|memorial|pavilion|complex|office|headquarters|residence|villa|mansion|tomb|mausoleum|lighthouse|market|mall|cent(er|re)\b|architect/i;
  const NOT_ARCH = /district|neighbo|ward\b|city\b|town\b|village|municipal|prefecture|province|agency|ministry|company|corporation|organi[sz]ation|nation|state\b|empire|era\b|period|river|mountain|island|park\b|garden|street|avenue|road|line\b|railway company|people|person|born/i;
  async function livePlaces(params) {
    const j = await api(WIKI, { action: 'query', prop: 'coordinates|pageimages|description|pageprops', piprop: 'name', pilimit: 50, colimit: 'max', ppprop: 'wikibase_item', ...params });
    const pages = Object.values((j.query && j.query.pages) || {}).filter(p => p.coordinates && p.pageprops && p.pageprops.wikibase_item);
    pages.sort((x, y) => (x.index || 0) - (y.index || 0));
    const byQid = {};
    BUILDINGS.forEach(b => { if (b.qid) byQid[b.qid] = b; });
    const fresh = pages.filter(p => !byQid[p.pageprops.wikibase_item]);
    const ents = {}, labels = {};
    (await Promise.all(chunks(fresh.map(p => p.pageprops.wikibase_item), 50).map(ids => api(WDAPI, { action: 'wbgetentities', ids: ids.join('|'), props: 'claims' }))))
      .forEach(r => Object.assign(ents, r.entities));
    const refIds = (c, k) => (c[k] || []).map(s => s.mainsnak.datavalue && s.mainsnak.datavalue.value).filter(Boolean);
    const refs = new Set();
    fresh.forEach(p => { const c = (ents[p.pageprops.wikibase_item] || {}).claims || {}; ['P84', 'P149', 'P31', 'P131', 'P17'].forEach(k => refIds(c, k).slice(0, 2).forEach(v => refs.add(v.id))); });
    (await Promise.all(chunks([...refs], 50).map(ids => api(WDAPI, { action: 'wbgetentities', ids: ids.join('|'), props: 'labels', languages: 'en' }))))
      .forEach(r => Object.values(r.entities || {}).forEach(e => { labels[e.id] = e.labels && e.labels.en && e.labels.en.value; }));
    return pages.map(p => {
      const qid = p.pageprops.wikibase_item;
      if (byQid[qid]) return byQid[qid];
      const c = (ents[qid] || {}).claims || {};
      const names = (k, n = 2) => refIds(c, k).slice(0, n).map(v => labels[v.id]).filter(Boolean);
      const archs = names('P84'), types = names('P31'), desc = p.description || '';
      if (!archs.length && (!ARCH_DESC.test(desc + ' ' + types.join(' ')) || NOT_ARCH.test(desc))) return null;
      const inc = refIds(c, 'P571')[0], year = inc ? parseInt(inc.time, 10) || null : null;
      const type = types[0] || desc.split(/ in | of /)[0];
      const b = {
        id: 'wd-' + qid, kind: 'building', name: p.title, architect: archs.join(' · '), year,
        typology: type ? type[0].toUpperCase() + type.slice(1) : 'Building', style: liveStyle(names('P149', 3), year),
        city: names('P131', 1)[0], country: names('P17', 1)[0], lat: p.coordinates[0].lat, lng: p.coordinates[0].lon, qid,
        image: refIds(c, 'P18')[0] || (p.pageimage || '').replace(/_/g, ' ') || undefined,
        wiki: 'https://en.wikipedia.org/wiki/' + encodeURIComponent(p.title.replace(/ /g, '_')), source: 'live',
      };
      registerBuilding(b);
      return BY_ID[b.id];
    }).filter(Boolean);
  }
  const liveDone = new Set();
  let liveTimer;
  function loadLivePlaces() {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(async () => {
      // Wikipedia's geosearch covers a 10 km radius, so only look once zoomed in to city level.
      if (!map || map.getZoom() < 11) return;
      const c = map.getCenter(), radius = Math.min(10000, Math.round(c.distanceTo(map.getBounds().getNorthEast())));
      const step = 0.02 * Math.pow(2, 15 - map.getZoom());
      const key = [map.getZoom(), Math.round(c.lat / step), Math.round(c.lng / step)].join();
      if (liveDone.has(key)) return;
      liveDone.add(key);
      const showing = new Set(mapBuildings().map(x => x.b.id));
      try { await livePlaces({ generator: 'geosearch', ggscoord: c.lat + '|' + c.lng, ggsradius: radius, ggslimit: 100 }); }
      catch (err) { liveDone.delete(key); return; }
      if (!map) return;
      // Re-run the active filters so live places respect them, then pin only the new ones.
      mapBuildings().forEach(({ b, kind }) => { if (!showing.has(b.id) && !mapMarkers[b.id]) addMarker(b, kind); });
      refreshHeat();
    }, 300);
  }

  // Worldwide search: Wikipedia full-text search (so "Zaha Hadid" also finds her buildings), architecture only.
  let worldQ = '', worldResults = [], worldTimer;
  function searchWorld(q) {
    clearTimeout(worldTimer);
    if (q.length < 3) { worldQ = q; worldResults = []; return; }
    worldTimer = setTimeout(async () => {
      try { worldResults = await livePlaces({ generator: 'search', gsrsearch: q, gsrlimit: 40 }); }
      catch (err) { worldResults = []; /* offline: bundled results still show */ }
      if (findQ.trim() !== q) return;
      worldQ = q;
      const el = document.getElementById('results');
      if (el) el.innerHTML = findResults();
    }, 350);
  }


  // ---------- Heatmap: where people go ----------
  // Blends the app's own traffic (visits + want-to-visits) with Wikipedia page views from the last
  // ~60 days, so the map glows everywhere from day one, not only where throwShade users are.
  const pageviews = {};
  const wikiTitle = b => b.wiki && b.wiki.includes('/wiki/') ? decodeURIComponent(b.wiki.split('/wiki/')[1]).replace(/_/g, ' ') : null;
  async function loadPageviews(list) {
    const todo = list.filter(b => pageviews[b.id] === undefined && wikiTitle(b));
    todo.forEach(b => { pageviews[b.id] = 0; });
    await Promise.all(chunks(todo, 50).map(async group => {
      try {
        const j = await api(WIKI, { action: 'query', prop: 'pageviews', redirects: 1, titles: group.map(wikiTitle).join('|') });
        const q = j.query || {}, alias = {}, views = {};
        (q.normalized || []).concat(q.redirects || []).forEach(m => { alias[m.from] = m.to; });
        Object.values(q.pages || {}).forEach(pg => { views[pg.title] = Object.values(pg.pageviews || {}).reduce((t, n) => t + (n || 0), 0); });
        group.forEach(b => { let t = wikiTitle(b); for (let i = 0; alias[t] && i < 3; i++) t = alias[t]; pageviews[b.id] = views[t] || 0; });
      } catch (err) { group.forEach(b => { delete pageviews[b.id]; }); }
    }));
    return todo.length > 0;
  }
  function drawHeat() {
    if (!map || !window.L.heatLayer) return;
    if (heatLayer) { map.removeLayer(heatLayer); heatLayer = null; }
    if (!mapHeat) return;
    const traffic = {};
    state.visits.forEach(v => { traffic[v.buildingId] = (traffic[v.buildingId] || 0) + 1; });
    state.want.forEach(w => { traffic[w.buildingId] = (traffic[w.buildingId] || 0) + 1; });
    // Scale to what's in view, so a quiet town still shows its busiest spots; page views on a log
    // scale so one world-famous landmark doesn't wash everything else out.
    const bd = map.getBounds(), items = mapBuildings().map(x => x.b);
    const inView = items.filter(b => bd.contains([b.lat, b.lng]));
    const topT = Math.max(1, ...inView.map(b => traffic[b.id] || 0));
    const topV = Math.log10(1 + Math.max(0, ...inView.map(b => pageviews[b.id] || 0))) || 1;
    const points = items.map(b => {
      const w = Math.min(1, 0.6 * Math.log10(1 + (pageviews[b.id] || 0)) / topV + 0.4 * (traffic[b.id] || 0) / topT);
      return w > 0.05 ? [b.lat, b.lng, w] : null;
    }).filter(Boolean);
    heatLayer = window.L.heatLayer(points, {
      radius: 30, blur: 24, maxZoom: 15, minOpacity: .35, max: 2.5,
      gradient: { 0.2: '#ffd60a', 0.45: '#ff9f1c', 0.7: '#ff4d6d', 1: '#c1121f' },
    }).addTo(map);
  }
  async function refreshHeat() {
    if (!map || !mapHeat) return;
    drawHeat();
    const bd = map.getBounds();
    const inView = mapBuildings().map(x => x.b).filter(b => bd.contains([b.lat, b.lng])).slice(0, 300);
    if (await loadPageviews(inView)) drawHeat();
  }

  function initMap() {
    const items = mapBuildings();
    // No default selection — the card only appears once a specific pin is tapped, not "whatever's nearest".
    if (!items.find(x => x.b.id === mapSel)) mapSel = null;
    renderMapCard();
    if (!window.L) {
      document.getElementById('map').innerHTML = '<div class="map-fallback">Map tiles need an internet connection. Pins and the building card still work from the list views.</div>';
      return;
    }
    map = window.L.map('map', { zoomControl: false, attributionControl: true });
    window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors', maxZoom: 19,
    }).addTo(map);
    clusterGroup = window.L.markerClusterGroup ? window.L.markerClusterGroup({ maxClusterRadius: 46, spiderfyOnMaxZoom: true, showCoverageOnHover: false }) : null;
    const target = clusterGroup || map;
    items.forEach(({ b, kind }) => addMarker(b, kind));
    if (clusterGroup) map.addLayer(clusterGroup);
    if (loc) window.L.marker([loc.lat, loc.lng], { icon: window.L.divIcon({ className: '', html: '<div class="pin me"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }), interactive: false }).addTo(map);
    // Drop a pin: tap after pressing "Pin", or long-press / right-click anywhere.
    map.on('click', e => { if (pinMode) placePin(e.latlng); });
    map.on('contextmenu', e => placePin(e.latlng));
    map.on('moveend', () => { if (map) { mapView = { c: map.getCenter(), z: map.getZoom() }; loadLivePlaces(); refreshHeat(); } });
    const selB = BY_ID[mapSel];
    if (mapFocus && selB) { map.setView([selB.lat, selB.lng], 17); mapFocus = false; }
    else if (mapFilter === 'all' && mapView) map.setView(mapView.c, mapView.z);
    else if (loc && (mapFilter === 'all' || !items.length)) map.setView([loc.lat, loc.lng], 13);
    else if (!items.length || (!loc && mapFilter === 'all')) map.setView([30, 0], 2);  // no location yet: whole world
    else map.fitBounds(items.map(x => [x.b.lat, x.b.lng]), { padding: [60, 60], maxZoom: 14 });
    setTimeout(() => map && map.invalidateSize(), 0);
    if (pendingPinMode) { pendingPinMode = false; setPinMode(true); }
  }

  // ---------- Pin → "What's here?" (OpenStreetMap via Overpass, Nominatim as fallback) ----------
  // The public Overpass servers are shared and sometimes overloaded, so: short timeouts, a second server,
  // Nominatim's nearest address if both fail, results cached per ~10 m, and "Name it yourself" always works.
  const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
  const lookups = {};
  let nameStyle = null, nameKind = 'building', pendingPinMode = false;

  function fetchJSON(url, opts, ms) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ms || 12000);
    return fetch(url, Object.assign({ signal: ctl.signal }, opts || {}))
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .finally(() => clearTimeout(timer));
  }
  const qs = o => Object.entries(o).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');

  // ---------- Weather / best time to visit ----------
  // Open-Meteo needs no API key, so the demo works with live weather straight away.
  const WMO = {
    0: '☀', 1: '🌤', 2: '⛅', 3: '☁',
    45: '🌫', 48: '🌫',
    51: '🌦', 53: '🌦', 55: '🌦', 56: '🌦', 57: '🌦',
    61: '🌧', 63: '🌧', 65: '🌧', 66: '🌧', 67: '🌧',
    71: '🌨', 73: '🌨', 75: '🌨', 77: '🌨',
    80: '🌦', 81: '🌧', 82: '🌧',
    85: '🌨', 86: '🌨',
    95: '⛈', 96: '⛈', 99: '⛈',
  };
  const wmoLabel = c => c === 0 ? 'Clear' : c <= 2 ? 'Mostly clear' : c === 3 ? 'Cloudy' : c <= 48 ? 'Foggy' : c <= 67 || (c >= 80 && c <= 82) ? 'Rainy' : c <= 77 || c >= 85 ? 'Snowy' : c >= 95 ? 'Stormy' : 'Mixed';
  const weatherCache = {};
  const visitDaySel = {}; // buildingId -> selected forecast day index (0 = today)
  const visitExpanded = {}; // buildingId -> is the weather card open

  function weatherKey(lat, lng) { return lat.toFixed(2) + ',' + lng.toFixed(2); }

  function sunTimesFor(b, forDate) {
    if (typeof SunCalc === 'undefined') return null;
    const now = new Date();
    const times = SunCalc.getTimes(forDate || now, b.lat, b.lng);
    return { now, sunrise: times.sunrise, sunset: times.sunset, goldenHour: times.goldenHour, goldenHourEnd: times.goldenHourEnd };
  }

  async function loadWeather(b) {
    const key = weatherKey(b.lat, b.lng);
    if (weatherCache[key]) return;
    weatherCache[key] = { loading: true };
    try {
      const d = await fetchJSON('https://api.open-meteo.com/v1/forecast?' + qs({
        latitude: b.lat, longitude: b.lng, current: 'temperature_2m,weather_code',
        daily: 'weather_code,temperature_2m_max,sunset', temperature_unit: 'fahrenheit', timezone: 'auto', forecast_days: 5,
      }), null, 8000);
      weatherCache[key] = { loading: false, current: d.current, daily: d.daily, tz: d.timezone };
    } catch (e) {
      weatherCache[key] = { loading: false, error: true };
    }
    if (currentPath() === '/b/' + b.id) render();
  }

  // ---------- Typical busyness ----------
  // No open API has real foot traffic, so estimate it: a daily pattern for the kind of place
  // (museums peak early afternoon, stations at rush hour, theatres at night...), shifted for weekends,
  // blended with the hours people actually logged it once there are enough logs.
  const BUSY_TYPES = [
    [/station|terminal|airport|transit|metro|railway/i, { peaks: [[8, 2, 1], [17.5, 2, 1], [13, 3, .45]], weekend: .55 }],
    [/museum|gallery|exhibition|arts? cent/i, { peaks: [[14, 2.6, 1], [11, 1.5, .5]], weekend: 1.3 }],
    [/church|cathedral|chapel|basilica|abbey|monastery|temple|mosque|synagogue|shrine/i, { peaks: [[11, 1.5, .8], [15, 2.5, .6]], weekend: 1.2, sunday: [10.5, 1.5, 1] }],
    [/theat|opera|concert|hall|arena|stadium|cinema/i, { peaks: [[20, 1.6, 1], [14, 2, .3]], weekend: 1.25 }],
    [/library|university|college|school|campus/i, { peaks: [[11, 2.5, 1], [15, 2.5, .9]], weekend: .4 }],
    [/market|mall|shop|retail|store|department/i, { peaks: [[13, 2.5, .8], [17.5, 2, 1]], weekend: 1.35 }],
    [/office|tower|skyscraper|headquarters|commercial|bank|corporate/i, { peaks: [[9, 1.3, .8], [12.5, 1.2, 1], [17, 1.3, .8]], weekend: .35 }],
    [/residen|house|apartment|villa|home/i, { peaks: [[14, 3.5, .5]], weekend: 1.1 }],
    [/park|garden|square|plaza|bridge|pier|art|sculpture|spot|memorial|monument/i, { peaks: [[16.5, 3, 1], [12, 2.5, .6]], weekend: 1.4 }],
  ];
  const BUSY_DEFAULT = { peaks: [[13.5, 3, 1], [11, 2, .5]], weekend: 1.25 };
  function busyCurve(b, dow) {
    const text = [b.typology, KINDS[kindOf(b)], b.name].filter(Boolean).join(' ');
    const t = (BUSY_TYPES.find(([rx]) => rx.test(text)) || [null, BUSY_DEFAULT])[1];
    const weekend = dow === 0 || dow === 6;
    const peaks = dow === 0 && t.sunday ? t.peaks.concat([t.sunday]) : t.peaks;
    const hours = Array.from({ length: 18 }, (_, i) => i + 6);
    const raw = {};
    hours.forEach(h => { raw[h] = peaks.reduce((v, [mu, sd, a]) => v + a * Math.exp(-((h - mu) ** 2) / (2 * sd * sd)), 0); });
    // Blend in the hours people logged this place, once there are enough to mean something.
    const logged = visitsFor(b.id).map(v => new Date(v.createdAt).getHours()).filter(h => h >= 6);
    if (logged.length >= 5) {
      const counts = {};
      logged.forEach(h => { counts[h] = (counts[h] || 0) + 1; });
      const top = Math.max(...Object.values(counts)), peakRaw = Math.max(...hours.map(h => raw[h]));
      hours.forEach(h => { raw[h] = 0.7 * raw[h] + 0.3 * peakRaw * (counts[h] || 0) / top; });
    }
    // Weekdays and weekends share one scale, so a quiet Sunday office reads as quiet.
    const dayMult = weekend ? t.weekend : 1, scale = 100 / Math.max(...hours.map(h => raw[h])) / Math.max(1, t.weekend);
    const at = {};
    hours.forEach(h => { at[h] = Math.min(100, Math.round(raw[h] * scale * dayMult)); });
    return { hours, at, logs: logged.length >= 5 ? logged.length : 0 };
  }

  function visitTimingHTML(b) {
    const key = weatherKey(b.lat, b.lng);
    const w = weatherCache[key];
    if (!w) { loadWeather(b); }
    const selIdx = visitDaySel[b.id] || 0;
    const isToday = selIdx === 0;
    const fmtTime = t => t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

    // Pick the date this card is showing: today (live) or a future forecast day (noon local, so DST doesn't shift it).
    const selDate = isToday ? new Date() : new Date(Date.now() + selIdx * 86400000);
    if (!isToday) selDate.setHours(12, 0, 0, 0);
    const sun = sunTimesFor(b, selDate);
    if (!sun) return '';
    // SunCalc returns true instants; Open-Meteo's daily times are the place's wall clock. Put the sun times on the
    // place's wall clock too, so times read right wherever the viewer is (e.g. Chicago from NY).
    const toPlace = t => (w && w.tz ? new Date(t.toLocaleString('en-US', { timeZone: w.tz })) : t);
    Object.keys(sun).forEach(k => { sun[k] = toPlace(sun[k]); });

    // How busy the place usually is, hour by hour, for the selected day (in the place's time zone).
    const placeNow = w && w.tz ? new Date(new Date().toLocaleString('en-US', { timeZone: w.tz })) : new Date();
    const busy = busyCurve(b, (isToday ? placeNow : selDate).getDay());
    const nowH = placeNow.getHours(), level = v => v >= 70 ? 'busy' : v >= 40 ? 'moderately busy' : 'quiet';
    const open = busy.hours.filter(h => h >= 9 && h <= 19);
    const quietest = open.reduce((q, h) => busy.at[h] < busy.at[q] ? h : q, open[0]);
    const peak = busy.hours.reduce((p, h) => busy.at[h] > busy.at[p] ? h : p, busy.hours[0]);
    const hr = h => new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: 'numeric' });
    let noteHTML, quickNote;
    if (isToday && busy.at[nowH] !== undefined) {
      const lv = level(busy.at[nowH]);
      quickNote = `Usually ${lv} now`;
      noteHTML = `<b>Usually ${lv} around now.</b> ${lv === 'busy' ? `Quieter around ${hr(quietest)}.` : `Busiest around ${hr(peak)}.`}`;
    } else {
      quickNote = `Busiest ~${hr(peak)}`;
      noteHTML = `<b>Busiest around ${hr(peak)}</b>, quietest around ${hr(quietest)}.`;
    }

    const statusHTML = isToday
      ? (w && w.current
          ? `<span class="visit-icon">${WMO[w.current.weather_code] || '☀'}</span>${wmoLabel(w.current.weather_code)}, ${Math.round(w.current.temperature_2m)}°F`
          : w && w.error ? `<span class="visit-icon">—</span>Weather unavailable` : `<span class="visit-icon">…</span>Loading…`)
      : (w && w.daily
          ? `<span class="visit-icon">${WMO[w.daily.weather_code[selIdx]] || '☀'}</span>${wmoLabel(w.daily.weather_code[selIdx])}, ${Math.round(w.daily.temperature_2m_max[selIdx])}°F high`
          : `<span class="visit-icon">…</span>Loading…`);

    let forecastHTML = '';
    if (w && w.daily) {
      const codes = w.daily.weather_code, highs = w.daily.temperature_2m_max, sunsets = w.daily.sunset, dates = w.daily.time;
      const bestIdx = codes.reduce((best, c, i) => (i > 0 && c <= 2 && (best < 0 || c < codes[best])) ? i : best, -1);
      forecastHTML = `<div class="forecast-row">${dates.map((d, i) => {
        const day = i === 0 ? 'Today' : new Date(d + 'T12:00').toLocaleDateString([], { weekday: 'short' });
        return `<button class="forecast-day${i === bestIdx ? ' best' : ''}${i === selIdx ? ' sel' : ''}" data-act="visitday" data-id="${b.id}" data-i="${i}">
          <div class="d">${day}</div>
          <div class="icon">${WMO[codes[i]] || '☀'}</div>
          <div class="t">${Math.round(highs[i])}°</div>
          ${i === bestIdx ? '<div class="badge-best">BEST</div>' : ''}
        </button>`;
      }).join('')}</div>`;
    }

    const expanded = !!visitExpanded[b.id];
    return `<div class="visit-card${expanded ? ' open' : ''}">
      <button class="visit-top" data-act="visitexpand" data-id="${b.id}">
        <div class="visit-status">${statusHTML}</div>
        <div class="visit-quick muted">${quickNote}</div>
        <span class="visit-chevron">${expanded ? '︿' : '﹀'}</span>
      </button>
      ${expanded ? `
      <div class="caps" style="margin-top:12px">Typical busyness · ${isToday ? 'today' : esc(selDate.toLocaleDateString([], { weekday: 'long' }))}</div>
      <div class="busy-bars" role="img" aria-label="${esc(noteHTML.replace(/<[^>]+>/g, ''))}">${busy.hours.map(h =>
        `<i class="${isToday && h === nowH ? 'now' : ''}" style="height:${Math.max(6, busy.at[h])}%" title="${hr(h)}: ${level(busy.at[h])}"></i>`).join('')}</div>
      <div class="busy-axis"><span>6a</span><span>12p</span><span>6p</span><span>11p</span></div>
      <div class="visit-note"><span class="dot-live"></span><span>${noteHTML}</span></div>
      <div class="small muted" style="margin-top:4px">Estimated from the kind of place${busy.logs ? ` and ${busy.logs} throwShade logs` : ''}.</div>
      ${forecastHTML}` : ''}
    </div>`;
  }

  async function overpass(lat, lng) {
    const A = (r) => `(around:${r},${lat},${lng})`;
    const q = `[out:json][timeout:10];(way${A(25)}[building];relation${A(25)}[building];` +
      `way${A(90)}[building][name];relation${A(90)}[building][name];` +
      `nwr${A(70)}[tourism=artwork];way${A(70)}[man_made=bridge];way${A(50)}["bridge:name"];` +
      `nwr${A(120)}[name][leisure~"^(park|garden)$"];nwr${A(90)}[name][place=square];nwr${A(90)}[name][amenity=fountain];` +
      `nwr${A(90)}[name][tourism~"^(attraction|viewpoint)$"];nwr${A(90)}[name][man_made=pier];);out tags center 30;`;
    let lastErr;
    for (const ep of OVERPASS) {
      try {
        const d = await fetchJSON(ep, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, 12000);
        return d.elements || [];
      } catch (e) { lastErr = e; }
    }
    throw lastErr;
  }
  function nominatim(lat, lng) {
    return fetchJSON('https://nominatim.openstreetmap.org/reverse?' + qs({ format: 'jsonv2', lat, lon: lng, zoom: 18, addressdetails: 1, extratags: 1, namedetails: 1 }), null, 8000);
  }

  const TYPE_WORDS = {
    yes: 'Building', commercial: 'Commercial building', office: 'Office building', retail: 'Retail building',
    residential: 'Residential building', apartments: 'Apartment building', house: 'House', detached: 'House',
    church: 'Church', cathedral: 'Cathedral', chapel: 'Chapel', university: 'University building', college: 'College building',
    school: 'School', hotel: 'Hotel', train_station: 'Station', transportation: 'Transit building', civic: 'Civic building',
    public: 'Public building', government: 'Government building', museum: 'Museum', stadium: 'Stadium',
    industrial: 'Industrial building', warehouse: 'Warehouse', parking: 'Parking garage', hospital: 'Hospital',
  };
  const AMENITY_WORDS = { theatre: 'Theatre', library: 'Library', place_of_worship: 'Place of worship', arts_centre: 'Arts centre', university: 'University building', townhall: 'Town hall', cinema: 'Cinema' };
  // What kind of place an OSM element is: art > bridge > building > spot.
  function osmKind(t) {
    if (t.tourism === 'artwork') return 'art';
    if (t.man_made === 'bridge' || t['bridge:name']) return 'bridge';
    if (t.building) return 'building';
    if (t.leisure || t.place === 'square' || t.amenity === 'fountain' || t.tourism || t.man_made === 'pier') return 'spot';
    return 'building';
  }
  const SPOT_WORDS = { park: 'Park', garden: 'Garden', square: 'Square', fountain: 'Fountain', attraction: 'Attraction', viewpoint: 'Viewpoint', pier: 'Pier' };
  const cap = w => w ? w[0].toUpperCase() + w.slice(1) : w;
  function typeLabel(t) {
    const k = osmKind(t);
    if (k === 'art') return t.artwork_type ? cap(t.artwork_type.replace(/_/g, ' ')) : 'Public art';
    if (k === 'bridge') return t['bridge:movable'] ? cap(t['bridge:movable']) + ' bridge' : t['bridge:structure'] ? cap(t['bridge:structure'].replace(/_/g, ' ')) + ' bridge' : 'Bridge';
    if (k === 'spot') return SPOT_WORDS[t.leisure] || SPOT_WORDS[t.place] || SPOT_WORDS[t.amenity] || SPOT_WORDS[t.tourism] || SPOT_WORDS[t.man_made] || 'Place';
    if (t.tourism === 'museum') return 'Museum';
    if (AMENITY_WORDS[t.amenity]) return AMENITY_WORDS[t.amenity];
    if (+t['building:levels'] >= 40) return 'Skyscraper';
    const v = t.building || 'yes';
    if (TYPE_WORDS[v]) return TYPE_WORDS[v];
    const w = v.replace(/_/g, ' ');
    return w[0].toUpperCase() + w.slice(1) + (/building$/.test(w) ? '' : ' building');
  }
  const STYLE_RULES = [
    ['Brutalist', /brutal/], ['Deconstructivist', /deconstruct/], ['Postmodern', /post.?modern/],
    ['High-tech', /high.?tech|structural.expressionism|late.modern/], ['Art Deco', /art.?deco|streamline/],
    ['Contemporary', /contemporary|neo.?futur|parametric|blob|sustainable|minimal/],
    ['Modernist', /modern|international|bauhaus|functional|expressionis|mid.?century|organic|prairie|chicago.school|constructiv|googie/],
    ['Historic', /./],
  ];
  function styleFrom(text, year) {
    const s = String(text || '').toLowerCase();
    if (s) for (const [name, rx] of STYLE_RULES) if (rx.test(s)) return name;
    if (!year) return 'Modernist';
    return year < 1920 ? 'Historic' : year < 1990 ? 'Modernist' : 'Contemporary';
  }
  const yearFrom = s => { const m = /(\d{4})/.exec(s || ''); return m ? +m[1] : ''; };
  const addrOf = t => [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
  const sameName = (a, b) => {
    const n = x => String(x).toLowerCase().replace(/\(.*?\)|\bthe\b|\bbuilding\b/g, '').replace(/[^a-z0-9]+/g, '');
    const x = n(a), y = n(b);
    return !!x && !!y && (x.includes(y) || y.includes(x));
  };

  function candidate(osm, tags, clat, clng, plat, plng) {
    const year = yearFrom(tags.start_date || tags['building:start_date'] || tags['construction:date']);
    return {
      osm, tags, lat: clat, lng: clng, year, kind: osmKind(tags),
      d: Math.round(km({ lat: plat, lng: plng }, { lat: clat, lng: clng }) * 1000),
      name: tags.name || tags['bridge:name'] || '', addr: addrOf(tags), typ: typeLabel(tags),
      style: styleFrom(tags['building:architecture'] || tags.architecture, year),
      wiki: !!(tags.wikidata || tags.wikipedia),
    };
  }

  async function lookupPin(key, lat, lng) {
    const L0 = lookups[key] = { status: 'loading', results: [] };
    try {
      const cached = JSON.parse(localStorage.getItem('ts.osm.' + key));
      if (cached) { Object.assign(L0, cached, { status: 'done' }); refreshPin(key); return; }
    } catch (e) { /* no cache */ }
    const [op, nm] = await Promise.allSettled([overpass(lat, lng), nominatim(lat, lng)]);
    const nmv = nm.status === 'fulfilled' ? nm.value : null;
    if (nmv && nmv.address) {
      const a = nmv.address;
      L0.address = [a.house_number, a.road].filter(Boolean).join(' ');
      L0.city = a.city || a.town || a.village || a.suburb || '';
      L0.country = a.country || '';
    }
    if (op.status === 'fulfilled') {
      const seen = new Set();
      L0.results = op.value
        .filter(e => e.tags && (e.center || e.lat != null))
        .map(e => candidate(e.type + '/' + e.id, e.tags, e.center ? e.center.lat : e.lat, e.center ? e.center.lon : e.lon, lat, lng))
        .filter(c => !seen.has(c.osm) && seen.add(c.osm))
        // buildings at the pin first, named before unnamed, then by distance
        .sort((x, y) => (x.d > 30) - (y.d > 30) || (!!y.name - !!x.name) || x.d - y.d)
        .slice(0, 6);
    } else if (nmv && nmv.osm_type) {
      const tags = Object.assign({}, nmv.extratags || {}, { building: nmv.type }, nmv.name ? { name: nmv.name } : {});
      L0.results = [candidate(nmv.osm_type + '/' + nmv.osm_id, tags, +nmv.lat, +nmv.lon, lat, lng)];
      L0.error = 'OpenStreetMap’s building data was slow, so this is the nearest address instead.';
    } else {
      L0.error = 'Couldn’t reach OpenStreetMap. You can still name it yourself.';
    }
    L0.status = 'done';
    if (!L0.error) {
      try { localStorage.setItem('ts.osm.' + key, JSON.stringify({ results: L0.results, address: L0.address, city: L0.city, country: L0.country })); } catch (e) { /* storage full */ }
    }
    refreshPin(key);
  }

  function pinKey(lat, lng) { return lat.toFixed(4) + ',' + lng.toFixed(4); }
  function currentPin() {
    const m = /^\/pin\/(-?[\d.]+),(-?[\d.]+)/.exec(currentPath());
    return m ? { lat: +m[1], lng: +m[2] } : null;
  }

  function osmResultsHTML(key) {
    const L0 = lookups[key];
    if (!L0 || L0.status === 'loading') return '<div class="empty">Looking up this spot on OpenStreetMap…</div>';
    let html = L0.error ? `<div class="small muted">${esc(L0.error)}</div>` : '';
    if (!L0.results.length) return html + '<div class="empty">No mapped building here. Name it yourself below.</div>';
    html += L0.results.map((r, i) => `
      <button class="row" data-act="pickosm" data-key="${key}" data-i="${i}">
        <div class="ph" style="width:38px;height:38px;${hatch(STYLES[r.style])}"></div>
        <div class="grow"><div class="ellipsis">${r.name ? esc(r.name) : `<span class="muted">${esc(r.addr || 'Unnamed building')}</span>`}</div>
          <div class="sub ellipsis">${esc([r.typ, r.name ? r.addr : '', r.year].filter(Boolean).join(' · '))}</div></div>
        ${r.wiki ? '<span class="chip" style="font-size:10px;padding:2px 8px">Wikipedia</span>' : ''}
        <span class="small muted">${r.d} m</span>
      </button>`).join('');
    return html;
  }
  function refreshPin(key) {
    const p = currentPin();
    if (!p || pinKey(p.lat, p.lng) !== key) return;
    const el = document.getElementById('osm-results');
    if (el) el.innerHTML = osmResultsHTML(key);
    const nm = document.getElementById('nb-name');
    const L0 = lookups[key];
    if (nm && L0 && L0.address) nm.placeholder = L0.address;
  }

  function viewPin(lat, lng) {
    const key = pinKey(lat, lng);
    const P = { lat, lng };
    const near = BUILDINGS.map(b => ({ b, d: km(P, b) })).filter(x => x.d < 0.12).sort((x, y) => x.d - y.d).slice(0, 4);
    const nearRows = near.map(x => `<button class="row" data-go="#/log/${x.b.id}">
        ${ph(x.b, { w: 120, style: 'width:38px;height:38px', go: false })}
        <div class="grow"><div class="ellipsis">${esc(x.b.name)}</div><div class="sub ellipsis">${esc(byLine(x.b))}</div></div>
        <span class="small muted">${Math.round(x.d * 1000)} m</span></button>`).join('');
    const pills = Object.entries(STYLES).map(([s, c]) =>
      `<button class="pill ${nameStyle === s ? 'on' : ''}" data-act="pickstyle" data-k="${s}"><span class="dot" style="background:${c}"></span> ${s}</button>`).join('');
    return sheet('What’s here?', 1, 2,
      `<button class="btn-sq thin" data-act="closelog" aria-label="Close">${icon('x')}</button>`,
      `<div id="pinmap" class="pin-map"></div>
       <div class="caps">Pin · ${lat.toFixed(5)}, ${lng.toFixed(5)}</div>
       ${near.length ? `<div class="stack-6"><div class="caps">Already on throwShade</div>${nearRows}</div>` : ''}
       <div class="stack-6"><div class="caps">From OpenStreetMap</div><div id="osm-results" class="stack-6">${osmResultsHTML(key)}</div></div>
       <button class="btn dashed" style="height:52px" data-act="nameit">${icon('edit', 'sm')}Name it yourself</button>
       <div id="nameit" class="stack" hidden>
         <div class="seg">${Object.entries(KINDS).map(([k, l]) => `<button class="${nameKind === k ? 'on' : ''}" data-act="pickkind" data-k="${k}">${l}</button>`).join('')}</div>
         <div class="field"><label for="nb-name">Name</label><input id="nb-name" class="input" autocomplete="off" placeholder="${esc((lookups[key] && lookups[key].address) || 'e.g. The corner pavilion')}"></div>
         <div class="row-flex">
           <div class="field grow"><label for="nb-arch">Architect or artist <span class="muted" style="font-weight:400">(optional)</span></label><input id="nb-arch" class="input" autocomplete="off"></div>
           <div class="field" style="width:104px"><label for="nb-year">Year</label><input id="nb-year" class="input" inputmode="numeric" maxlength="4" autocomplete="off"></div>
         </div>
         <div class="field"><div class="label">Style</div><div class="chips">${pills}</div></div>
         <button class="btn-primary" data-act="savenamed">Add and rate it</button>
       </div>`);
  }
  function initRadioMap() {
    const seed = BY_ID[radioSeedId];
    const queue = radioQueue(radioSeedId);
    const b = queue[radioIdx];
    if (!window.L || !seed || !b || !document.getElementById('radiomap')) return;
    radioMap = window.L.map('radiomap', { zoomControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false,
      touchZoom: false, boxZoom: false, keyboard: false, attributionControl: false });
    window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(radioMap);
    window.L.marker([seed.lat, seed.lng], { icon: window.L.divIcon({ className: '', html: '<div class="pin me"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }), interactive: false }).addTo(radioMap);
    window.L.marker([b.lat, b.lng], { icon: window.L.divIcon({ className: '', html: '<div class="drop"></div>', iconSize: [22, 30], iconAnchor: [11, 30] }), interactive: false }).addTo(radioMap);
    radioMap.fitBounds([[seed.lat, seed.lng], [b.lat, b.lng]], { padding: [28, 28], maxZoom: 15 });
    setTimeout(() => radioMap && radioMap.invalidateSize(), 0);
  }

  function initPin(lat, lng) {
    const key = pinKey(lat, lng);
    if (!lookups[key] || (lookups[key].status === 'done' && lookups[key].error)) lookupPin(key, lat, lng);
    if (!window.L || !document.getElementById('pinmap')) return;
    pinMap = window.L.map('pinmap', { zoomControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false,
      touchZoom: false, boxZoom: false, keyboard: false, attributionControl: false }).setView([lat, lng], 18);
    window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(pinMap);
    window.L.marker([lat, lng], { icon: window.L.divIcon({ className: '', html: '<div class="drop"></div>', iconSize: [22, 30], iconAnchor: [11, 30] }), interactive: false }).addTo(pinMap);
    setTimeout(() => pinMap && pinMap.invalidateSize(), 0);
  }

  function addPlace(b) {
    state.places.push(b);
    registerBuilding(b);
    save();
    sync.createPlace(b);
    mapSel = b.id; mapFocus = true;
    go('#/log/' + b.id);
  }

  // Pull photo, intro and credit from Wikidata / Wikipedia / Commons when OSM links the building.
  async function enrichFromWiki(b) {
    b.enriching = true;
    try {
      let title = b.wikiTag && /^en:/.test(b.wikiTag) ? b.wikiTag.slice(3) : null;
      if (b.qid) {
        const d = await fetchJSON('https://www.wikidata.org/w/api.php?' + qs({ action: 'wbgetentities', ids: b.qid, props: 'sitelinks|claims', sitefilter: 'enwiki', format: 'json', origin: '*' }));
        const e = d.entities && d.entities[b.qid];
        // OSM sometimes tags a building with its occupant company's item. Buildings have coordinates; companies don't.
        if (e && !(e.claims && e.claims.P625)) throw new Error('Wikidata item is not a place');
        if (e) {
          if (!title && e.sitelinks && e.sitelinks.enwiki) title = e.sitelinks.enwiki.title;
          const claim = p => { const c = e.claims && e.claims[p] && e.claims[p][0]; return c && c.mainsnak.datavalue && c.mainsnak.datavalue.value; };
          const img = claim('P18');
          if (img && !b.image) b.image = img;
          const t = claim('P1619') || claim('P571');
          if (t && !b.year) { const y = parseInt(String(t.time).slice(1, 5), 10); if (y) b.year = y; }
        }
      }
      if (title) {
        const d = await fetchJSON('https://en.wikipedia.org/w/api.php?' + qs({ action: 'query', format: 'json', origin: '*', redirects: 1, prop: 'pageimages|extracts', piprop: 'name', exintro: 1, explaintext: 1, exsentences: 2, titles: title }));
        const page = Object.values((d.query && d.query.pages) || {})[0];
        if (page && page.missing === undefined) {
          if (page.extract) b.blurb = page.extract.replace(/\s+/g, ' ').slice(0, 420);
          if (!b.image && page.pageimage) b.image = page.pageimage;
          b.wiki = 'https://en.wikipedia.org/wiki/' + encodeURIComponent(page.title.replace(/ /g, '_'));
        }
      }
      if (b.image && !b.credit) {
        const d = await fetchJSON('https://commons.wikimedia.org/w/api.php?' + qs({ action: 'query', format: 'json', origin: '*', prop: 'imageinfo', iiprop: 'extmetadata', iiextmetadatafilter: 'Artist|LicenseShortName', titles: 'File:' + b.image }));
        const page = Object.values((d.query && d.query.pages) || {})[0];
        const m = page && page.imageinfo && page.imageinfo[0].extmetadata;
        if (m) {
          const artist = m.Artist ? new DOMParser().parseFromString(m.Artist.value, 'text/html').body.textContent.replace(/\s+/g, ' ').trim() : '';
          b.credit = { artist: artist.slice(0, 80) || 'Unknown', license: m.LicenseShortName ? m.LicenseShortName.value : '', page: 'https://commons.wikimedia.org/wiki/File:' + encodeURIComponent(b.image.replace(/ /g, '_')) };
        }
      }
    } catch (e) { /* offline or rate-limited: the building still works without Wikipedia data */ }
    b.enriching = false;
    save();
    if (currentPath() === '/b/' + b.id) render();
  }


  // ---------- Photo resize ----------
  function resizeImage(file, maxSide, cb) {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        cb(c.toDataURL('image/jpeg', 0.72));
      };
      img.onerror = () => cb(null);
      img.src = reader.result;
    };
    reader.onerror = () => cb(null);
    reader.readAsDataURL(file);
  }

  // ---------- Photo viewer ----------
  let viewer = null;
  function openViewer(list, i) {
    closeViewer();
    viewer = { list, i };
    const el = document.createElement('div');
    el.className = 'lightbox';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Photo viewer');
    root.appendChild(el);
    let x0 = null;
    el.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
    el.addEventListener('touchend', e => {
      if (x0 === null) return;
      const dx = e.changedTouches[0].clientX - x0; x0 = null;
      if (Math.abs(dx) > 40) stepViewer(dx < 0 ? 1 : -1);
    });
    drawViewer();
  }
  function drawViewer() {
    const el = root.querySelector('.lightbox');
    if (!el || !viewer) return;
    const { list, i } = viewer, url = list[i];
    el.innerHTML = `
      <div class="lb-top"><span class="lb-count">${list.length > 1 ? `${i + 1} / ${list.length}` : ''}</span>
        <button class="btn-sq lb-close" data-act="lbclose" aria-label="Close">${icon('x')}</button></div>
      <div class="lb-stage" data-act="lbclose"><img src="${url}" alt="Photo ${i + 1} of ${list.length}"></div>
      ${list.length > 1 ? `<button class="btn-sq lb-nav prev" data-act="lbprev" aria-label="Previous photo">${icon('back')}</button>
        <button class="btn-sq lb-nav next" data-act="lbnext" aria-label="Next photo">${icon('chevron')}</button>` : ''}`;
  }
  function stepViewer(d) {
    if (!viewer) return;
    viewer.i = (viewer.i + d + viewer.list.length) % viewer.list.length;
    drawViewer();
  }
  function closeViewer() {
    const el = root.querySelector('.lightbox'); if (el) el.remove();
    viewer = null;
  }
  document.addEventListener('keydown', e => {
    if (!viewer) return;
    if (e.key === 'Escape') closeViewer();
    if (e.key === 'ArrowRight') stepViewer(1);
    if (e.key === 'ArrowLeft') stepViewer(-1);
  });

  // ---------- Confetti ----------
  function celebrate() {
    const old = root.querySelector('.confetti'); if (old) old.remove();
    const host = document.createElement('div');
    host.className = 'confetti';
    const colors = Object.values(STYLES);
    for (let i = 0; i < 16; i++) {
      const bit = document.createElement('span');
      bit.style.setProperty('--dx', (Math.random() * 220 - 110) + 'px');
      bit.style.setProperty('--dy', (Math.random() * -180 - 30) + 'px');
      bit.style.setProperty('--rot', (Math.random() * 360) + 'deg');
      bit.style.background = colors[i % colors.length];
      bit.style.left = (35 + Math.random() * 30) + '%';
      bit.style.animationDelay = (Math.random() * 0.1) + 's';
      host.appendChild(bit);
    }
    root.appendChild(host);
    setTimeout(() => host.remove(), 950);
  }

  // ---------- Toast ----------
  let toastTimer;
  function toast(msg) {
    const old = root.querySelector('.toast'); if (old) old.remove();
    const t = document.createElement('div');
    t.className = 'toast'; t.textContent = msg; t.setAttribute('role', 'status');
    root.appendChild(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      t.classList.add('out');
      setTimeout(() => t.remove(), 220);
    }, 2200);
  }

  // ---------- Router ----------
  function currentPath() { return location.hash.slice(1) || '/feed'; }
  function go(h) { if (location.hash === h) render(); else location.hash = h; }
  function back() {
    const cur = currentPath();
    for (let i = trail.length - 1; i >= 0; i--) {
      const p = trail[i];
      if (p !== cur && !p.startsWith('/log') && !p.startsWith('/pin') && !p.startsWith('/editprofile') && !p.startsWith('/save') && !p.startsWith('/newlist') && !/\/invite$/.test(p) && !p.startsWith('/signin')) { trail.length = i; go('#' + p); return; }
    }
    go('#/feed');
  }

  let lastRenderPath = null;
  function render() {
    const path = currentPath();
    // In-place UI toggles (expand a widget, switch a tab, tap a like) re-render the same
    // route; without this the innerHTML swap below resets scroll to the top every time.
    const samePath = path === lastRenderPath;
    lastRenderPath = path;
    const prevScreen = samePath && root.querySelector('.screen');
    const prevScrollTop = prevScreen ? prevScreen.scrollTop : 0;
    const [p, qs] = path.split('?');
    const seg = p.split('/').filter(Boolean);
    if (!state.me || !me() || !authToken) {
      if (seg[0] !== 'signin') { location.replace('#/signin'); return; }
    }
    if (seg[0] === 'b' && (trail[trail.length - 1] || '').startsWith('/find') && findTab === 'arch' && findQ.trim().length >= 2) {
      const q = findQ.trim();
      state.recentSearches = [q].concat((state.recentSearches || []).filter(r => r.toLowerCase() !== q.toLowerCase())).slice(0, 8);
      save();
    }
    if (trail[trail.length - 1] !== path) trail.push(path);
    if (trail.length > 50) trail.splice(0, trail.length - 50);
    if (seg[0] !== 'me' && seg[0] !== 'u') resetArmed = false;
    if (seg[0] !== 'log') { draft = null; delArmed = false; }
    if (seg[0] !== 'save' && seg[0] !== 'newlist') { inviteSel = new Set(); newListPublic = false; }
    clearTimeout(wrapTimer);
    clearTimeout(storyTimer);
    clearTimeout(recapTimer);
    if (seg[0] !== 'story') storyUid = null;
    if (seg[0] !== 'scan') stopScan();
    if (seg[0] !== 'wrapped') {
      wrapUid = null;
      if (wrapShare) { URL.revokeObjectURL(wrapShare.url); wrapShare = null; }
    }

    destroyMap();
    galleries = [];
    let html, after;
    try {
    switch (seg[0]) {
      case 'signin': html = viewSignin(); break;
      case 'feed': html = viewHome('feed'); break;
      case 'map': html = viewHome('map'); if (mapMode !== 'list') after = initMap; break;
      case 'find': html = viewFind(); break;
      case 'lists': html = viewLists(['recs', 'guides'].includes(seg[1]) ? seg[1] : 'mine'); break;
      case 'list': html = seg[1] === 'want' ? viewWantList() : seg[1] === 'been' ? viewBeenList() : seg[2] === 'invite' ? viewInvite(seg[1]) : viewList(seg[1]); break;
      case 'save': html = viewSaveTo(seg[1]); break;
      case 'newlist': html = viewNewList(); break;
      case 'guide': html = viewGuide(seg[1], decodeURIComponent(seg.slice(2).join('/') || '')); break;
      case 'trending': html = viewTrending(); break;
      case 'leaderboard': html = viewLeaderboard(); break;
      case 'compare': html = viewCompare(seg[1]); break;
      case 'comments': html = viewComments(seg[1]); break;
      case 'discover-lists': html = viewDiscoverLists(); break;
      case 'crawl': html = viewCrawl(seg[1]); after = () => initWalkMap(crawlOrder(crawlItems(seg[1]))); break;
      case 'activity':
        html = viewActivity(); markActivitySeen(state.me); save(); break;
      case 'radio': html = viewRadio(seg[1]); after = initRadioMap; break;
      case 'b': html = viewBuilding(seg[1]); break;
      case 'me':
        if (state.newAchievement) { state.newAchievement = false; save(); }
        html = viewProfile(state.me); after = () => initBeenMap(state.me); break;
      case 'u': html = viewProfile(seg[1]); after = () => initBeenMap(seg[1]); break;
      case 'followers': html = viewFollowList(seg[1], 'followers'); break;
      case 'following': html = viewFollowList(seg[1], 'following'); break;
      case 'editprofile': html = viewEditProfile(); break;
      case 'wrapped': html = viewWrapped(seg[1] || state.me); after = startWrap; break;
      case 'story': html = viewStory(seg[1]); after = startStory; break;
      case 'newstory': html = viewNewStory(); break;
      case 'scan': html = viewScan(); after = startScan; break;
      case 'daily': html = viewDaily(); break;
      case 'welcome': html = viewWelcome(); break;
      case 'settings': html = viewSettings(); break;
      case 'badges': html = viewBadges(seg[1] || state.me); break;
      case 'recap': html = viewRecap(seg[1]); after = startRecap; break;
      case 'bingo': html = viewBingo(seg[1] ? decodeURIComponent(seg[1]) : null); break;
      case 'challenges': html = viewChallenges(); break;
      case 'architect': html = viewArchitect(decodeURIComponent(seg.slice(1).join('/'))); break;
      case 'log': html = seg[1] ? viewLogRate(seg[1]) : viewLogPick(); break;
      case 'pin': {
        const m = /^(-?[\d.]+),(-?[\d.]+)$/.exec(seg[1] || '');
        if (m) { html = viewPin(+m[1], +m[2]); after = () => initPin(+m[1], +m[2]); } else html = viewNotFound();
        break;
      }
      default: html = viewNotFound();
    }
    } catch (err) {
      // A page that fails to draw shows what went wrong instead of a blank screen.
      console.error('[throwShade] page failed:', err);
      after = null;
      html = `<div class="screen with-nav"><div class="pad stack" style="padding-top:60px;text-align:center">
        <b style="font-size:18px">This page hit a snag</b>
        <div class="small muted" style="word-break:break-word">${esc(String(err && err.message || err))}</div>
        <button class="btn on" style="height:46px" data-go="#/feed">Back to Home</button></div></div>${state.me ? nav('') : ''}`;
    }
    root.innerHTML = html;
    if (after) { try { after(); } catch (err) { console.error('[throwShade] page setup failed:', err); } }
    if (samePath) {
      const newScreen = root.querySelector('.screen');
      if (newScreen) {
        newScreen.scrollTop = prevScrollTop;
        newScreen.classList.add('no-enter');
      }
    }

    if (state.me && !locAsked && ['map', 'find', 'log'].includes(seg[0])) {
      locAsked = true;
      requestLocation(ok => { if (ok && ['map', 'find', 'log'].includes(currentPath().split('/')[1]) && !currentPath().startsWith('/log/')) render(); });
    }
  }

  // ---------- Actions ----------
  const actions = {
    tournext() { tourIdx++; Sound.tap(); render(); },
    tourdone() { go('#/feed'); },
    signinmode(d) { signinMode = d.k; render(); },
    async signup() {
      const name = document.getElementById('su-name').value.trim();
      const handle = document.getElementById('su-handle').value.trim().toLowerCase().replace(/^@/, '');
      const password = document.getElementById('su-pass').value;
      if (!name) return toast('Add a display name');
      if (!/^[a-z0-9._]{2,20}$/.test(handle)) return toast('Handle: 2–20 letters, numbers, dots or underscores');
      if (password.length < 8) return toast('Password: at least 8 characters');
      let res;
      try { res = await authCall('/auth/signup', { id: 'u-' + Date.now().toString(36), handle, name, password }); }
      catch (e) { return toast(e.message === 'Failed to fetch' ? 'Can\u2019t reach the server \u2014 try again' : e.message); }
      setToken(res.token);
      const id = res.user.id;
      const newUser = Object.assign({}, res.user, pickedPhoto ? { photo: pickedPhoto } : {});
      state.users = state.users.filter(u => u.id !== id).concat(newUser);
      pickedPhoto = undefined;
      // New accounts start following nobody; the empty feed points them to Find people.
      state.me = id; save();
      Sound.success();
      tourIdx = 0; go('#/welcome');
      setTimeout(() => { celebrate(); toast('Welcome, @' + res.user.handle); }, 30);
    },
    async dologin() {
      const handle = document.getElementById('li-handle').value.trim().toLowerCase().replace(/^@/, '');
      const password = document.getElementById('li-pass').value;
      if (!handle || !password) return toast('Enter your handle and password');
      let res;
      try { res = await authCall('/auth/login', { handle, password }); }
      catch (e) { return toast(e.message === 'Failed to fetch' ? 'Can\u2019t reach the server \u2014 try again' : e.message); }
      setToken(res.token);
      const local = user(res.user.id);
      if (local) Object.assign(local, res.user); else state.users.push(res.user);
      state.me = res.user.id; save();
      Sound.success(); go('#/feed'); toast('Signed in as @' + res.user.handle);
      pullFromBackend();
    },
    theme() {
      const t = currentTheme() === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(THEME_KEY, t); } catch (e) { /* storage blocked: still switch for this visit */ }
      applyTheme(t); render();
    },
    switch() {
      if (authToken) apiFetch('/auth/logout', { method: 'POST' });
      setToken(null); state.me = null; signinMode = 'login'; save(); go('#/signin');
    },
    reset() {
      if (!resetArmed) { resetArmed = true; render(); return; }
      resetArmed = false;
      try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
      state = seed(); save();
      try { Object.keys(localStorage).filter(k => k.startsWith('ts.osm.')).forEach(k => localStorage.removeItem(k)); } catch (e) { /* ignore */ }
      location.hash = '#/signin'; location.reload();
    },
    back,
    want(d) {
      const i = state.want.findIndex(w => w.userId === state.me && w.buildingId === d.id);
      Sound.tap();
      if (i >= 0) { state.want.splice(i, 1); toast('Removed from Want to Visit'); sync.unwant(state.me, d.id); }
      else { state.want.push({ userId: state.me, buildingId: d.id, createdAt: Date.now() }); toast('Saved to Want to Visit'); sync.want(state.me, d.id); }
      save(); render();
    },
    togglewant(d, el) {
      const i = state.want.findIndex(w => w.userId === state.me && w.buildingId === d.id);
      if (i >= 0) { state.want.splice(i, 1); sync.unwant(state.me, d.id); }
      else { state.want.push({ userId: state.me, buildingId: d.id, createdAt: Date.now() }); sync.want(state.me, d.id); }
      el.classList.toggle('on', i < 0);
      Sound.tap(); save();
    },
    togglelist(d, el) {
      const l = state.lists.find(x => x.id === d.list); if (!l) return;
      const i = l.items.findIndex(it => it.buildingId === d.id);
      if (i >= 0) { l.items.splice(i, 1); sync.removeListItem(l.id, d.id); }
      else { l.items.push({ buildingId: d.id, addedBy: state.me, createdAt: Date.now() }); sync.addListItem(l.id, d.id, state.me); }
      el.classList.toggle('on', i < 0);
      Sound.tap(); save();
    },
    newlistform() {
      const f = document.getElementById('newlist');
      f.hidden = !f.hidden;
      if (!f.hidden) { f.scrollIntoView({ behavior: 'smooth', block: 'start' }); document.getElementById('nl-name').focus(); }
    },
    pickinvite(d, el) {
      if (inviteSel.has(d.u)) inviteSel.delete(d.u); else inviteSel.add(d.u);
      el.classList.toggle('on', inviteSel.has(d.u));
    },
    togglepublic() { newListPublic = !newListPublic; render(); },
    createlist(d) {
      const name = document.getElementById('nl-name').value.trim();
      if (!name) return toast('Give the list a name');
      const l = { id: 'l-' + Date.now().toString(36), name, ownerId: state.me, members: [state.me, ...inviteSel], items: [], createdAt: Date.now(), public: newListPublic };
      if (d.bid) l.items.push({ buildingId: d.bid, addedBy: state.me, createdAt: Date.now() });
      state.lists.push(l);
      const n = inviteSel.size;
      inviteSel = new Set(); newListPublic = false;
      save(); Sound.success();
      sync.createList(l);
      if (d.bid) sync.addListItem(l.id, d.bid, state.me);
      if (d.bid) render(); else location.replace('#/list/' + l.id);
      setTimeout(() => toast(`Created “${name}”` + (n ? ` · invited ${n}` : '')), 30);
    },
    invite(d, el) {
      const l = state.lists.find(x => x.id === d.list); if (!l) return;
      const i = l.members.indexOf(d.u);
      if (i >= 0) l.members.splice(i, 1); else l.members.push(d.u);
      el.classList.toggle('on', i < 0);
      Sound.tap(); save();
    },
    noop() {},
    unlist(d) {
      const l = state.lists.find(x => x.id === d.list); if (!l) return;
      l.items = l.items.filter(it => it.buildingId !== d.id);
      save(); render();
      sync.removeListItem(l.id, d.id);
    },
    unwant(d) { state.want = state.want.filter(w => !(w.userId === state.me && w.buildingId === d.id)); save(); render(); sync.unwant(state.me, d.id); },
    follow(d) {
      const i = state.follows.findIndex(f => f[0] === state.me && f[1] === d.id);
      if (i >= 0) { state.follows.splice(i, 1); sync.unfollow(state.me, d.id); }
      else { state.follows.push([state.me, d.id]); logActivity(d.id, 'follow', { fromUid: state.me }); sync.follow(state.me, d.id); }
      save();
      if (currentPath().startsWith('/find')) document.getElementById('results').innerHTML = findResults(); else render();
    },
    recapnext() { recapIdx++; Sound.tap(); render(); },
    recapprev() { recapIdx = Math.max(0, recapIdx - 1); render(); },
    recapclose() { go('#/feed'); },
    recapshare() { calMonth = recapMonth; actions.sharemonth(); },
    toggleprivate() {
      const u = me(); u.private = !u.private; save(); render();
      sync.updateUser(u);
      toast(u.private ? 'Your profile is private' : 'Your profile is public');
    },
    async changepw() {
      const old_password = document.getElementById('pw-old').value, new_password = document.getElementById('pw-new').value;
      if (new_password.length < 8) return toast('New password: at least 8 characters');
      const r = await apiFetch('/auth/password', { method: 'POST', body: JSON.stringify({ old_password, new_password }) });
      if (!r || !r.ok) return toast(r && r.status === 400 ? 'Current password is wrong' : 'Couldn\u2019t update your password');
      setToken((await r.json()).token);
      document.getElementById('pw-old').value = document.getElementById('pw-new').value = '';
      toast('Password updated');
    },
    async deleteaccount() {
      const u = me();
      if (document.getElementById('del-handle').value.trim().toLowerCase().replace(/^@/, '') !== u.handle) return toast('Type your handle exactly to confirm');
      const r = await apiFetch('/auth/delete-account', { method: 'POST', body: JSON.stringify({ password: document.getElementById('del-pass').value }) });
      if (!r || !r.ok) return toast(r && r.status === 400 ? 'Password is wrong' : 'Couldn\u2019t delete your account');
      // Clear this device too, then start fresh.
      setToken(null);
      try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
      location.hash = '#/signin'; location.reload();
    },
    sharelog(d) {
      const v = state.visits.find(x => x.id === d.id), b = v && BY_ID[v.buildingId];
      if (!b) return;
      shareCard('rating', { title: b.name, sub: [b.architect, b.city].filter(Boolean).join(' \u00b7 '), stars: v.stars, note: v.note,
        photo: (v.photos && v.photos[0]) || photoURL(b, 1200), handle: me().handle }, 'throwshade-' + b.id);
    },
    sharemonth() {
      const vs = visitsBy(state.me).filter(v => (v.visitedOn || isoDate(v.createdAt)).startsWith(calMonth) && BY_ID[v.buildingId]);
      const [y, m] = calMonth.split('-').map(Number), label = new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
      shareCard('month', { title: label, sub: `${vs.length} building${vs.length === 1 ? '' : 's'} \u00b7 ${(n => n + (n === 1 ? ' city' : ' cities'))(new Set(vs.map(v => BY_ID[v.buildingId].city).filter(Boolean)).size)}`,
        photos: vs.map(v => (v.photos && v.photos[0]) || photoURL(BY_ID[v.buildingId], 400)), handle: me().handle }, 'throwshade-' + calMonth);
    },
    heart(d) {
      const v = state.visits.find(x => x.id === d.id);
      if (!v || !authToken) return;
      v.hearts = v.hearts || [];
      const on = v.hearts.includes(state.me);
      v.hearts = on ? v.hearts.filter(id => id !== state.me) : v.hearts.concat(state.me);
      save(); if (!on) Sound.tap();
      const btn = document.querySelector(`[data-act="heart"][data-id="${d.id}"]`);
      if (btn) {
        btn.outerHTML = heartBtn(v);
        if (!on) {
          const fresh = document.querySelector(`[data-act="heart"][data-id="${d.id}"]`);
          if (fresh) fresh.classList.add('pop');
        }
      }
      apiFetch(on ? `/hearts?visit_user_id=${encodeURIComponent(v.userId)}&place_id=${encodeURIComponent(v.buildingId)}` : '/hearts',
        on ? { method: 'DELETE' } : { method: 'POST', body: JSON.stringify({ visit_user_id: v.userId, place_id: v.buildingId }) });
    },
    deletecomment(d, el) {
      const v = state.visits.find(x => x.id === d.v);
      if (!v) return;
      if (el.dataset.armed !== '1') { el.dataset.armed = '1'; el.textContent = 'Tap again to delete'; return; }
      v.comments = (v.comments || []).filter(c => c.id !== d.id); save(); render();
      if (!d.id.startsWith('local-')) apiFetch('/comments/' + encodeURIComponent(d.id), { method: 'DELETE' });
      toast('Comment deleted');
    },
    postcomment(d) {
      const el = document.getElementById('comment-in');
      const text = el && el.value.trim();
      if (!text) return;
      const v = state.visits.find(x => x.id === d.id);
      if (!v) return;
      v.comments = v.comments || [];
      const c = { id: 'local-' + Date.now().toString(36), userId: state.me, text, createdAt: Date.now(), pending: true };
      v.comments.push(c);
      save(); Sound.tap(); render();
      sync.postComment(v, text).then(saved => {
        if (!saved) { toast('Comment didn\u2019t send \u2014 only you can see it'); return; }
        Object.assign(c, { id: saved.id, createdAt: tsOf(saved.createdAt), pending: false }); save();
      });
    },
    radioskip() { radioIdx++; render(); },
    sort(d) { listSort = d.k; render(); },
    btab(d) { bTab = d.k; render(); },
    ptab(d) { pTab = d.k; render(); },
    calmonth(d) {
      const [y, m] = calMonth.split('-').map(Number), t = new Date(y, m - 1 + +d.k, 1);
      calMonth = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`; calDay = null; render();
    },
    calday(d) { calDay = calDay === d.k ? null : d.k; render(); },
    // Place type is single-choice ("All" clears it); Been / Want / Friends toggle on and off.
    mfd(d) { mapDraft[d.f] = d.f === 'rating' ? +d.k : d.k; refreshMapSheet(); },
    mfdstyle(d) { if (mapDraft.styles.has(d.k)) mapDraft.styles.delete(d.k); else mapDraft.styles.add(d.k); refreshMapSheet(); },
    mfdstyleclear() { mapDraft.styles.clear(); refreshMapSheet(); },
    mfdreset() { mapDraft = { show: 'all', kind: 'all', styles: new Set(), rating: 0 }; refreshMapSheet(); },
    mfdapply() {
      ({ show: mapFilter, kind: mapKind, rating: mapMinRating } = mapDraft); mapStyles = new Set(mapDraft.styles);
      mapDraft = null; mapFiltersOpen = false; mapSel = null; render();
    },
    mapfilterclose() { mapDraft = null; mapFiltersOpen = false; render(); },
    mapclear(d) {
      if (d.f === 'show') mapFilter = 'all'; else if (d.f === 'kind') mapKind = 'all'; else if (d.f === 'rating') mapMinRating = 0; else mapStyles.delete(d.k);
      mapSel = null; render();
    },
    mapclearall() { mapFilter = 'all'; mapKind = 'all'; mapMinRating = 0; mapStyles = new Set(); mapSel = null; render(); },
    togglefriends() { mapFriends = !mapFriends; if (mapFriends) toast('Faces show where people you follow have been'); render(); },
    toggleheat() { mapHeat = !mapHeat; if (mapHeat) toast('Glow = app visits plus how much people look the place up'); render(); },
    mapmode(d) { mapMode = d.k; render(); },
    beenheat() { beenHeat = !beenHeat; render(); },
    beenfit() {
      const uid = beenUid || state.me;
      fitBeenMap([...new Set(visitsBy(uid).map(v => v.buildingId))].map(id => BY_ID[id]).filter(Boolean));
    },
    mapfilterstoggle() { mapFiltersOpen = !mapFiltersOpen; mapDraft = mapFiltersOpen ? { show: mapFilter, kind: mapKind, styles: new Set(mapStyles), rating: mapMinRating } : null; render(); },
    uselocation() {
      requestLocation((ok, why) => {
        if (ok) return render();
        toast(why === 'denied' ? 'Location is blocked — allow it for this site in your browser settings' : why === 'unsupported' ? 'This browser can’t share your location' : 'Couldn’t find your location — try again');
      });
    },
    locate() {
      requestLocation((ok, why) => {
        if (!ok) {
          toast(why === 'denied' ? 'Location is blocked — allow it for this site in your browser settings' : 'Couldn’t find your location — try again outside or with Wi-Fi on');
          return;
        }
        // Re-render so the "you are here" dot moves too, centred on the new spot.
        mapView = { c: [loc.lat, loc.lng], z: 15 };
        render();
      });
    },
    closelog() { draft = null; back(); },
    tofacts() { const el = document.getElementById('facts'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); },
    findstyle(d) { findStyle = d.k; render(); },
    recentq(d) { findQ = d.k; searchWorld(findQ); render(); },
    clearrecent() { state.recentSearches = []; save(); render(); },
    findtab(d) { findTab = d.k; findQ = ''; render(); },
    findpeople() { findTab = 'users'; findQ = ''; go('#/find'); },
    viewphoto(d) { const list = galleries[+d.g]; if (list) openViewer(list, +d.i); },
    lbclose(d, el, e) { if (e.target.tagName !== 'IMG') closeViewer(); },
    lbprev() { stepViewer(-1); },
    lbnext() { stepViewer(1); },
    wrapnext() { wrapIdx++; Sound.tap(); render(); },
    wrapprev() { wrapIdx = Math.max(0, wrapIdx - 1); render(); },
    wrapreplay() { wrapIdx = 0; render(); },
    wrapclose() { back(); },
    storynext() {
      if (storyIdx < storySlides(storyUid).length - 1) { storyIdx++; render(); return; }
      // End of this person's story: on to the next one with something unwatched, else home.
      const next = storyPeople().find(id => id !== storyUid && storyUnseen(id));
      if (next) go('#/story/' + next); else go('#/feed');
    },
    storyprev() { storyIdx = Math.max(0, storyIdx - 1); render(); },
    storyclose() { go('#/feed'); },
    scanclose() { stopScan(); back(); },
    gameguess(d) {
      const day = gameDay(), rec = gameRec(day), ans = gameAnswer(day);
      if (rec.done || rec.guesses.includes(d.id)) return;
      rec.guesses.push(d.id); gameQ = '';
      if (d.id === ans.id) { rec.done = rec.won = true; Sound.success(); celebrate(); }
      else if (rec.guesses.length >= GAME_TRIES) { rec.done = true; Sound.tap(); }
      else Sound.tap();
      save(); render();
      if (rec.done && authToken) apiFetch('/game', { method: 'POST', body: JSON.stringify({ day, guesses: rec.guesses.length, won: rec.won }) });
      else setTimeout(() => { const el = document.getElementById('game-in'); if (el) el.focus(); }, 0);
    },
    gameshare() {
      const day = gameDay(), rec = gameRec(day), ans = gameAnswer(day);
      const text = `throwShade Daily #${day} ${rec.won ? rec.guesses.length : 'X'}/5\n${rec.guesses.map(id => guessInfo(id, ans).sq).join('')}`;
      if (navigator.share) navigator.share({ text }).catch(() => {});
      else if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast('Result copied'), () => toast(text));
      else toast(text);
    },
    scanpick(d) { if (scan) { scan.lock = d.id; scan.sig = ''; scanUpdate(); } },
    scancompass() {
      // iOS only hands out compass readings after the user taps to allow it.
      DeviceOrientationEvent.requestPermission().then(r => { if (r !== 'granted') toast('Compass not allowed — showing the closest places'); if (scan) { scan.sig = ''; scanUpdate(); } })
        .catch(() => toast('Couldn\u2019t turn on the compass'));
    },
    storycancel() { storyDraft = null; back(); },
    storydelete(d) {
      state.stories = state.stories.filter(st => st.id !== d.id); save();
      if (!d.id.startsWith('local-')) sync.deleteStory(d.id);
      toast('Story deleted');
      if (storySlides(state.me).length) render(); else go('#/feed');
    },
    async storypost() {
      const d = storyDraft;
      if (!d || !d.image) return;
      const local = { id: 'local-' + Date.now().toString(36), userId: state.me, buildingId: d.bid || null, caption: d.caption.trim(), image: d.image, createdAt: Date.now(), pending: true };
      state.stories.push(local); save();
      storyDraft = null; Sound.success(); toast('Added to your story'); go('#/feed');
      const saved = await sync.postStory(local);
      if (!saved) { toast('Story couldn’t upload — only you can see it'); return; }
      // Swap in the server's copy; the photo now loads from the backend, so drop the local data URL.
      Object.assign(local, normStory(saved), { pending: false });
      delete local.image;
      save();
    },
    wrapshare(d) { openWrapShare(d.id); },
    shareclose() { closeWrapShare(); },
    sharedl() { if (wrapDownload()) toast('Image saved'); },
    sharecopy() {
      const w = wrapSummary(wrapUid);
      const text = w.text + ' ' + w.link;
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast('Link copied'), () => toast(text));
      else toast(text);
    },
    shareto(d) {
      const w = wrapSummary(wrapUid);
      const u = encodeURIComponent(w.link), t = encodeURIComponent(w.text);
      if (d.to === 'instagram') {
        // Instagram has no web share link: save the image, then open Instagram to post it.
        if (!wrapDownload()) return;
        toast('Image saved — opening Instagram');
        setTimeout(() => openTarget('https://www.instagram.com/', 'instagram://camera'), 700);
        return;
      }
      const urls = {
        facebook: `https://www.facebook.com/sharer/sharer.php?u=${u}`,
        x: `https://x.com/intent/post?text=${t}&url=${u}`,
        threads: `https://www.threads.com/intent/post?text=${t}%20${u}`,
        whatsapp: `https://wa.me/?text=${t}%20${u}`,
        line: `https://line.me/R/share?text=${t}%20${u}`,
      };
      if (urls[d.to]) openTarget(urls[d.to]);
    },
    sharemore() {
      const w = wrapSummary(wrapUid), file = wrapFile();
      const data = { title: 'throwShade Wrapped', text: w.text, url: w.link };
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) data.files = [file];
      if (navigator.share) navigator.share(data).catch(() => {});
      else actions.sharecopy();
    },
    closeedit() { pickedPhoto = undefined; back(); },
    // Only marks the choice; typed name/handle/bio survive because the screen isn't re-rendered.
    shuffleavatar() { setPicked(randomAvatar(pickedPhoto)); },
    pickavatar(d, el) {
      setPicked(d.src);
      el.classList.add('on');
    },
    saveprofile() {
      const u = me();
      const name = document.getElementById('ep-name').value.trim();
      const handle = document.getElementById('ep-handle').value.trim().toLowerCase().replace(/^@/, '');
      const bio = document.getElementById('ep-bio').value.trim();
      if (!name) return toast('Add a display name');
      if (!/^[a-z0-9._]{2,20}$/.test(handle)) return toast('Handle: 2–20 letters, numbers, dots or underscores');
      if (handle !== u.handle && state.users.some(x => x.handle === handle)) return toast('@' + handle + ' is taken');
      u.name = name; u.handle = handle; u.bio = bio;
      if (pickedPhoto) u.photo = pickedPhoto;
      pickedPhoto = undefined;
      save(); Sound.success();
      sync.updateUser(u);
      back(); toast('Profile updated');
    },
    droppin() {
      setPinMode(!pinMode);
    },
    pinfrommap() { pendingPinMode = true; mapFilter = 'all'; mapKind = 'all'; go('#/map'); },
    pickosm(d) {
      const L0 = lookups[d.key], r = L0 && L0.results[+d.i];
      if (!r) return;
      const existing = BUILDINGS.find(b => b.osm === r.osm) ||
        (r.tags.wikidata && BUILDINGS.find(b => b.qid === r.tags.wikidata)) ||
        (r.name && BUILDINGS.find(b => km(b, r) < 0.08 && sameName(b.name, r.name)));
      if (existing) { toast(existing.name + ' is already on throwShade'); go('#/log/' + existing.id); return; }
      const b = {
        id: 'osm-' + r.osm.replace('/', '-'), kind: r.kind,
        name: r.name || r.addr || (L0.address ? KINDS[r.kind] + ' at ' + L0.address : 'Unnamed ' + KINDS[r.kind].toLowerCase()),
        architect: r.tags.architect || r.tags.artist_name || r.tags.artist || '', year: r.year, typology: r.typ, style: r.style,
        city: r.tags['addr:city'] || L0.city || '', country: L0.country || '',
        lat: +r.lat.toFixed(6), lng: +r.lng.toFixed(6), osm: r.osm, address: r.addr || L0.address || '',
        qid: r.tags.wikidata || undefined, wikiTag: r.tags.wikipedia || undefined,
        source: 'osm', addedBy: state.me, createdAt: Date.now(),
      };
      addPlace(b);
      if (b.qid || b.wikiTag) enrichFromWiki(b);
    },
    nameit() {
      const f = document.getElementById('nameit');
      f.hidden = !f.hidden;
      if (!f.hidden) { f.scrollIntoView({ behavior: 'smooth', block: 'start' }); document.getElementById('nb-name').focus(); }
    },
    pickstyle(d) {
      nameStyle = nameStyle === d.k ? null : d.k;
      document.querySelectorAll('[data-act=pickstyle]').forEach(btn => btn.classList.toggle('on', btn.dataset.k === nameStyle));
    },
    savenamed() {
      const p = currentPin(); if (!p) return;
      const name = document.getElementById('nb-name').value.trim();
      const year = parseInt(document.getElementById('nb-year').value, 10);
      if (!name) return toast('Give it a name');
      const L0 = lookups[pinKey(p.lat, p.lng)] || {};
      addPlace({
        id: 'pin-' + Date.now().toString(36), kind: nameKind, name, architect: document.getElementById('nb-arch').value.trim(),
        year: year > 0 && year <= new Date().getFullYear() + 5 ? year : '', typology: KINDS[nameKind],
        style: nameStyle || styleFrom('', year > 0 ? year : ''), city: L0.city || '', country: L0.country || '',
        lat: +p.lat.toFixed(6), lng: +p.lng.toFixed(6), address: L0.address || '',
        source: 'user', addedBy: state.me, createdAt: Date.now(),
      });
      nameStyle = null; nameKind = 'building';
    },
    pickkind(d) {
      nameKind = d.k;
      document.querySelectorAll('[data-act=pickkind]').forEach(btn => btn.classList.toggle('on', btn.dataset.k === nameKind));
    },
    star(d) {
      Sound.star();
      draft.stars = +d.n;
      document.querySelectorAll('#star-input button').forEach((btn, i) => {
        const on = i < draft.stars;
        btn.classList.toggle('on', on);
        btn.innerHTML = on ? starSVG('currentColor', 'currentColor') : starSVG('none', 'currentColor');
        if (on) { btn.classList.remove('pop'); void btn.offsetWidth; btn.classList.add('pop'); }
      });
      document.getElementById('star-caption').textContent = STAR_WORDS[draft.stars];
    },
    visitexpand(d) { visitExpanded[d.id] = !visitExpanded[d.id]; render(); },
    visitday(d) { visitDaySel[d.id] = +d.i; render(); },
    rmphoto(d) { draft.photos.splice(+d.i, 1); render(); },
    delvisit(d) {
      if (!delArmed) { delArmed = true; render(); return; }
      delArmed = false;
      state.visits = state.visits.filter(v => !(v.userId === state.me && v.buildingId === d.id));
      save();
      sync.deleteVisit(state.me, d.id);
      draft = null;
      trail.push('/b/' + d.id);
      location.replace('#/b/' + d.id);
      setTimeout(() => toast('Critique deleted'), 30);
    },
    aspect(d, el) {
      const i = draft.likes.indexOf(d.k);
      if (i >= 0) draft.likes.splice(i, 1); else draft.likes.push(d.k);
      el.classList.toggle('on', i < 0);
    },
    post() {
      if (!draft || !draft.stars) return toast('Pick a star rating first');
      const b = BY_ID[draft.bid];
      const existing = myVisit(draft.bid);
      const snapshot = JSON.stringify(state);
      const beforeBadges = new Set(badgesFor(state.me).filter(x => x.earned).map(x => x.id));
      const beforeLevel = levelFor(state.me).title;
      const challengesWereDone = new Set(challengesFor(state.me).filter(c => c.done).map(c => c.id));
      const bingoBefore = draft && BY_ID[draft.bid] && BY_ID[draft.bid].city ? bingoLines(bingoCard(BY_ID[draft.bid].city)) : 0;
      const fields = { stars: draft.stars, note: draft.note.trim(), likes: draft.likes.slice(), visitedOn: draft.date, createdAt: Date.now() };
      if (existing) Object.assign(existing, fields, { photos: draft.photos.slice() });
      else state.visits.push(Object.assign({ id: 'v' + Date.now().toString(36), userId: state.me, buildingId: draft.bid, photos: draft.photos.slice() }, fields));
      state.want = state.want.filter(w => !(w.userId === state.me && w.buildingId === draft.bid));
      let msg = `Logged ${b.name} · ${draft.stars}★`;
      if (!save()) {
        // Storage full (photos are big): keep the log, drop the photos.
        state = JSON.parse(snapshot);
        const v = myVisit(draft.bid);
        if (v) Object.assign(v, fields, { photos: [] });
        else state.visits.push(Object.assign({ id: 'v' + Date.now().toString(36), userId: state.me, buildingId: draft.bid, photos: [] }, fields));
        state.want = state.want.filter(w => !(w.userId === state.me && w.buildingId === draft.bid));
        save();
        msg = 'Saved without photos — browser storage is full';
      }
      syncVisit(myVisit(draft.bid));
      Sound.success();
      const bid = draft.bid;
      draft = null;
      bTab = 'critiques';
      trail.push('/b/' + bid);
      location.replace('#/b/' + bid);
      // Newly unlocked badges/level, celebrated one at a time after the log toast clears.
      const newBadges = badgesFor(state.me).filter(x => x.earned && !beforeBadges.has(x.id));
      const afterLevel = levelFor(state.me).title;
      const celebrations = newBadges.map(x => `🏆 Unlocked: ${x.label}`);
      if (afterLevel !== beforeLevel) celebrations.push(`⬆️ Leveled up: ${afterLevel}`);
      challengesFor(state.me).filter(c => c.done && !challengesWereDone.has(c.id)).forEach(c => celebrations.push(`✅ Challenge complete: ${c.label}`));
      const bcity = b && b.city;
      if (bcity && bingoLines(bingoCard(bcity)) > bingoBefore) celebrations.push(`🎉 BINGO in ${bcity}!`);
      if (celebrations.length) { state.newAchievement = true; celebrations.forEach(m => logActivity(state.me, 'achievement', { label: m })); save(); }
      setTimeout(() => { celebrate(); toast(msg); }, 30);
      celebrations.forEach((m, i) => setTimeout(() => { celebrate(); Sound.success(); toast(m); }, 2500 * (i + 1)));
    },
  };

  const inputs = {
    gameq(el) {
      gameQ = el.value;
      // Re-render only the suggestions so the keyboard stays up.
      const box = document.getElementById('game-sugg'), tmp = document.createElement('div');
      tmp.innerHTML = viewDaily();
      const fresh = tmp.querySelector('#game-sugg');
      if (box && fresh) box.innerHTML = fresh.innerHTML;
    },
    storycaption(el) { if (storyDraft) storyDraft.caption = el.value; },
    find(el) { findQ = el.value; searchWorld(findQ.trim()); document.getElementById('results').innerHTML = findResults(); },
    mapq(el) {
      mapQ = el.value; clearTimeout(mapQTimer);
      // The map re-renders with the filtered pins; put the cursor back where it was.
      mapQTimer = setTimeout(() => {
        render();
        const q = document.querySelector('[data-input=mapq]');
        if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
      }, 300);
    },
    logq(el) { document.getElementById('logresults').innerHTML = logResults(el.value); },
    note(el) { draft.note = el.value; document.getElementById('note-count').textContent = el.value.length + ' / 280'; },
    date(el) { draft.date = el.value || isoDate(Date.now()); },
    epbio(el) { document.getElementById('ep-bio-count').textContent = el.value.length + ' / 140'; },
  };

  root.addEventListener('click', e => {
    const t = e.target.closest('[data-act],[data-go]');
    if (!t || !root.contains(t)) return;
    if (t.dataset.act) { e.preventDefault(); e.stopPropagation(); actions[t.dataset.act](t.dataset, t, e); }
    else if (t.dataset.go) { e.preventDefault(); go(t.dataset.go); }
  });
  root.addEventListener('input', e => { const f = e.target.dataset && e.target.dataset.input; if (f && inputs[f]) inputs[f](e.target); });
  root.addEventListener('change', e => {
    const ch = e.target.dataset && e.target.dataset.change;
    if (ch === 'storyplace' && storyDraft) storyDraft.bid = e.target.value;
    if (ch === 'storyphoto' && e.target.files.length && storyDraft) {
      resizeImage(e.target.files[0], 1080, url => { if (!url) toast('Couldn’t read that image'); else if (storyDraft) { storyDraft.image = url; render(); } });
    }
    if (e.target.dataset && e.target.dataset.change === 'photo' && e.target.files.length && draft) {
      const files = Array.from(e.target.files).slice(0, MAX_PHOTOS - draft.photos.length);
      let pending = files.length;
      files.forEach(f => resizeImage(f, 800, url => {
        if (url && draft && draft.photos.length < MAX_PHOTOS) draft.photos.push(url);
        else if (!url) toast('Couldn’t read one of those images');
        if (--pending === 0) render();
      }));
    }
  });
  root.addEventListener('keydown', e => {
    if (e.key === 'Enter' && /^su-/.test(e.target.id)) actions.signup();
    if (e.key === 'Enter' && /^li-/.test(e.target.id)) actions.dologin();
  });

  window.addEventListener('hashchange', render);
  if (!load()) save();
  render();

  // First-ever visit in this browser: try to hydrate from the shared backend
  // (if reachable) instead of staying on the independently-seeded local copy.
  // Renders again only if the backend actually answered with data.
  // Upload a log's not-yet-uploaded photos, swap in their backend URLs (which also frees up browser
  // storage), then save the visit with those paths.
  async function syncVisit(v) {
    if (!v || !authToken) return;
    for (let i = 0; i < (v.photos || []).length; i++) {
      if (!v.photos[i].startsWith('data:')) continue;
      const up = await sync.uploadPhoto(v.buildingId, v.photos[i]);
      if (up) { v.photos[i] = API_BASE + up.path; save(); }
    }
    return sync.upsertVisit(v);
  }

  // Stay in step with friends without visibly refreshing: check every 30s while the app is on screen
  // (and straight away when it comes back), redraw only when the backend's data actually changed, and
  // hold the redraw while someone is typing, on the map, or in a story so nothing jumps under them.
  let lastStateText = '', pendingRender = false;
  const busy = () => {
    const el = document.activeElement, path = currentPath();
    return (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) || /^\/(map|story\/|log\/|newstory|scan)/.test(path);
  };
  function pullFromBackend() {
    if (document.hidden) return;
    apiFetch('/state').then(r => r && r.ok ? r.text() : null).then(text => {
      if (!text || text === lastStateText) return;
      let data;
      try { data = JSON.parse(text); } catch (e) { return; }
      dropDemo(data);
      if (!data.users || !data.users.length) return;
      lastStateText = text;
      if (freshInstall && !state.me) state = buildStateFromBackend(data);
      else mergeStateFromBackend(data);
      attachComments(data);
      attachHearts(data);
      if (data.game) gameResults = data.game;
      save();
      if (busy()) pendingRender = true; else render();
    });
  }
  root.addEventListener('focusout', () => setTimeout(() => { if (pendingRender && !busy()) { pendingRender = false; render(); } }, 0));
  window.addEventListener('hashchange', () => { pendingRender = false; });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pullFromBackend(); });
  pullFromBackend();
  setInterval(pullFromBackend, 30000);
  // Offline support and instant repeat loads (see sw.js). Needs https, or localhost for testing.
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('[throwShade] offline cache unavailable:', err));
  }
  // Photos saved on this device before they synced: upload them once now.
  if (authToken && state.me) state.visits.filter(v => v.userId === state.me && (v.photos || []).some(ph => ph.startsWith('data:'))).forEach(syncVisit);
})();
