"""Pull building data from Wikidata (+ Commons photo credits, Wikipedia intros) into app/wikidata.js.

Usage:  python tools/fetch_wikidata.py [--global 450] [--local 250] [--radius 12]
        (--global 0 = only the area around --lat/--lng)

No dependencies beyond the standard library. Writes window.TS_WIKIDATA = { enrich, buildings }:
  enrich    — Wikidata fields for the hand-curated buildings in app/data.js, keyed by their id
  buildings — additional buildings, ids "wd-Q…"
Data: Wikidata (CC0). Intros: Wikipedia (CC BY-SA). Photos: Wikimedia Commons (per-file licence, credited).
"""
import argparse
import difflib
import html
import json
import math
import os
import re
import sys
import time
import urllib.parse
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_JS = os.path.join(ROOT, 'app', 'data.js')
OUT_JS = os.path.join(ROOT, 'app', 'wikidata.js')
UA = 'throwShade-hackathon/0.1 (local demo; building data import)'
SPARQL = 'https://query.wikidata.org/sparql'

# Types that have an architect but aren't buildings you "visit" as architecture.
SKIP_TYPES = re.compile(r'\b(statue|sculpture|fountain|painting|ship|vessel|city(?! hall)|capital(?! building)|town(?! hall|house)|village|settlement|'
                        r'neighbou?rhood|district|planned community|garden|cemetery|grave|tomb|video game|film|'
                        r'organization|company|human|park)\b', re.I)
GONE_TYPES = re.compile(r'\b(proposed|destroyed|demolished|unbuilt|former building|cancelled)\b', re.I)
BUILDINGISH = re.compile(r'(building|house|home|tower|skyscraper|church|cathedral|chapel|temple|synagogue|mosque|museum|'
                         r'library|station|terminal|hotel|stadium|arena|venue|theat|cinema|school|college|university|hall|'
                         r'aquarium|planetarium|office|store|market|bridge|pavilion|apartment|residen|block|mansion|villa|'
                         r'palace|castle|lighthouse|hospital|courthouse|capitol|headquarters|centre|center|observatory|'
                         r'gallery|mill|warehouse|garage|club)', re.I)
BAD_PLACES = re.compile(r'(county|township|illinois|united states|state of|province|region)', re.I)
GENERIC_TYPES = {'building', 'structure', 'architectural structure', 'tourist attraction', 'landmark', 'edifice',
                 'building complex', 'architectural ensemble', 'work of art', 'construction', 'artificial physical structure'}

STYLE_RULES = [
    ('Brutalist', r'brutal'),
    ('Deconstructivist', r'deconstruct'),
    ('Postmodern', r'post-?modern'),
    ('High-tech', r'high-tech|structural expressionism|late modern'),
    ('Art Deco', r'art deco|streamline'),
    ('Contemporary', r'contemporary|neo-futur|parametric|blobitecture|sustainable|critical regionalism|minimalis'),
    ('Modernist', r'modern|international style|bauhaus|functionalis|expressionis|mid-century|organic|new objectivity|prairie|chicago school|'
                  r'constructivis|googie|metabolis|rationalis'),
    ('Historic', r'.'),  # any other named style (gothic, beaux-arts, neoclassical, baroque, …)
]


CACHE_DIR = os.path.join(ROOT, 'tools', '.cache')


def http_json(url, data=None, tries=6):
    """GET/POST returning JSON, with an on-disk cache and polite backoff (Wikimedia rate-limits bursts)."""
    import hashlib
    os.makedirs(CACHE_DIR, exist_ok=True)
    key = hashlib.sha1((url + '|' + (data or b'').decode('utf-8', 'replace')).encode('utf-8')).hexdigest()
    path = os.path.join(CACHE_DIR, key + '.json')
    if os.path.exists(path):
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    for i in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers={'User-Agent': UA, 'Accept': 'application/sparql-results+json, application/json'})
            with urllib.request.urlopen(req, timeout=90) as r:
                result = json.loads(r.read().decode('utf-8'))
            with open(path, 'w', encoding='utf-8') as f:
                json.dump(result, f)
            return result
        except urllib.error.HTTPError as e:
            if i == tries - 1:
                raise
            wait = int(e.headers.get('Retry-After') or 0) or 5 * (i + 1)
            print(f'  HTTP {e.code}; waiting {wait}s', file=sys.stderr)
            time.sleep(min(wait, 90))
        except Exception as e:
            if i == tries - 1:
                raise
            print(f'  retry {i + 1} after error: {e}', file=sys.stderr)
            time.sleep(5 * (i + 1))


def sparql(query):
    body = urllib.parse.urlencode({'query': query, 'format': 'json'}).encode()
    return http_json(SPARQL, data=body)['results']['bindings']


def qid(uri):
    return uri.rsplit('/', 1)[-1]


def top_global(n):
    q = f"""SELECT DISTINCT ?item ?sitelinks WHERE {{
      ?item wdt:P84 ?arch; wdt:P625 ?coord; wdt:P18 ?img; wikibase:sitelinks ?sitelinks.
      FILTER(?sitelinks >= 20)
    }} ORDER BY DESC(?sitelinks) LIMIT {n * 2}"""
    return [qid(r['item']['value']) for r in sparql(q)]


def around(lat, lng, radius_km, n):
    q = f"""SELECT DISTINCT ?item ?sitelinks WHERE {{
      SERVICE wikibase:around {{
        ?item wdt:P625 ?coord.
        bd:serviceParam wikibase:center "Point({lng} {lat})"^^geo:wktLiteral; wikibase:radius "{radius_km}".
      }}
      ?item wdt:P84 ?arch; wikibase:sitelinks ?sitelinks.
    }} ORDER BY DESC(?sitelinks) LIMIT {n * 2}"""
    return [qid(r['item']['value']) for r in sparql(q)]


# Non-building kinds pulled around the demo location, by Wikidata class (instance of, or a subclass of, these).
KIND_CLASSES = {
    'bridge': ['Q12280'],                                                 # bridge
    'art': ['Q860861', 'Q179700', 'Q219423', 'Q20437094', 'Q557141'],     # sculpture, statue, mural, installation, public art
    'spot': ['Q22698', 'Q174782', 'Q483453', 'Q863454', 'Q1107656'],      # park, square, fountain, pier, garden
}
KIND_DEFAULT_TYPE = {'building': 'Building', 'bridge': 'Bridge', 'art': 'Public art', 'spot': 'Public space'}
KIND_UNKNOWN_MAKER = {'building': 'Unknown architect', 'bridge': 'Unknown engineer', 'art': 'Unknown artist', 'spot': ''}


def around_kind(lat, lng, radius_km, n, classes, need_image):
    values = ' '.join('wd:' + c for c in classes)
    img = '?item wdt:P18 ?img.' if need_image else ''
    q = f"""SELECT DISTINCT ?item ?sitelinks WHERE {{
      SERVICE wikibase:around {{
        ?item wdt:P625 ?coord.
        bd:serviceParam wikibase:center "Point({lng} {lat})"^^geo:wktLiteral; wikibase:radius "{radius_km}".
      }}
      VALUES ?cls {{ {values} }}
      ?item wdt:P31/wdt:P279* ?cls; wikibase:sitelinks ?sitelinks.
      {img}
    }} ORDER BY DESC(?sitelinks) LIMIT {n}"""
    return [qid(r['item']['value']) for r in sparql(q)]


def details(qids):
    """Fetch the fields we need for a batch of items. Returns {qid: record}."""
    out = {}
    for i in range(0, len(qids), 60):
        batch = qids[i:i + 60]
        values = ' '.join('wd:' + q for q in batch)
        q = f"""SELECT ?item ?itemLabel ?itemDescription ?archLabel ?opened ?inception ?styleLabel ?typeLabel ?coord
                       ?image ?placeLabel ?countryLabel ?article ?sitelinks ?service ?started ?creatorLabel WHERE {{
          VALUES ?item {{ {values} }}
          ?item wdt:P625 ?coord; wikibase:sitelinks ?sitelinks.
          OPTIONAL {{ ?item wdt:P84 ?arch }}
          OPTIONAL {{ ?item wdt:P170 ?creator }}
          OPTIONAL {{ ?item wdt:P1619 ?opened }}
          OPTIONAL {{ ?item wdt:P571 ?inception }}
          OPTIONAL {{ ?item wdt:P729 ?service }}
          OPTIONAL {{ ?item wdt:P580 ?started }}
          OPTIONAL {{ ?item wdt:P149 ?style }}
          OPTIONAL {{ ?item wdt:P31 ?type }}
          OPTIONAL {{ ?item wdt:P18 ?image }}
          OPTIONAL {{ ?item wdt:P131 ?place }}
          OPTIONAL {{ ?item wdt:P17 ?country }}
          OPTIONAL {{ ?article schema:about ?item; schema:isPartOf <https://en.wikipedia.org/> }}
          SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
        }}"""
        for r in sparql(q):
            k = qid(r['item']['value'])
            rec = out.setdefault(k, {'qid': k, 'archs': [], 'styles': [], 'types': [], 'places': [], 'countries': [],
                                     'images': [], 'years': [], 'creators': []})
            v = lambda key: r.get(key, {}).get('value')
            rec['name'] = v('itemLabel')
            rec['desc'] = v('itemDescription')
            rec['sitelinks'] = int(v('sitelinks') or 0)
            rec['wiki'] = v('article') or rec.get('wiki')
            m = re.match(r'Point\(([-\d.eE]+) ([-\d.eE]+)\)', v('coord') or '')
            if m:
                rec['lng'], rec['lat'] = round(float(m.group(1)), 5), round(float(m.group(2)), 5)
            for key, field in (('archLabel', 'archs'), ('creatorLabel', 'creators'), ('styleLabel', 'styles'), ('typeLabel', 'types'),
                               ('placeLabel', 'places'), ('countryLabel', 'countries')):
                val = v(key)
                if val and not re.fullmatch(r'Q\d+', val) and val not in rec[field]:
                    rec[field].append(val)
            if v('image'):
                f = urllib.parse.unquote(v('image').rsplit('/', 1)[-1])
                if f not in rec['images']:
                    rec['images'].append(f)
            for key, pri in (('opened', 0), ('service', 1), ('inception', 2), ('started', 3)):
                d = v(key)
                ym = re.match(r'(-?\d{1,4})-', d or '')
                if ym:
                    rec['years'].append((pri, int(ym.group(1))))
        print(f'  details {min(i + 60, len(qids))}/{len(qids)}')
        time.sleep(0.5)
    return out


def bucket_style(styles, year):
    text = ' '.join(styles).lower()
    if text:
        for name, rx in STYLE_RULES:
            if re.search(rx, text):
                return name
    if year is None:
        return 'Modernist'
    if year < 1920:
        return 'Historic'
    return 'Modernist' if year < 1990 else 'Contemporary'


def pick_type(types, kind='building'):
    if kind != 'building':
        specific = [t for t in types if t.lower() not in GENERIC_TYPES and not re.search(r'organi[sz]ation|company', t, re.I)]
        t = (specific or [KIND_DEFAULT_TYPE[kind]])[0]
        return t[:1].upper() + t[1:]
    specific = [t for t in types if t.lower() not in GENERIC_TYPES and not SKIP_TYPES.search(t)]
    specific.sort(key=lambda t: 0 if BUILDINGISH.search(t) else 1)
    t = (specific or types or ['building'])[0]
    return t[:1].upper() + t[1:]


def shape(rec, kind='building'):
    """Wikidata record -> app place (or None if unusable). kind: building | bridge | art | spot."""
    name = rec.get('name')
    if not name or re.fullmatch(r'Q\d+', name) or 'lat' not in rec:
        return None
    if kind == 'building' and rec['types'] and all(SKIP_TYPES.search(t) for t in rec['types']):
        return None
    if any(GONE_TYPES.search(t) for t in rec['types']):
        return None
    years = sorted(rec['years'])
    year = years[0][1] if years else None
    makers = (rec['archs'] or rec['creators'])[:2]
    return {
        'id': 'wd-' + rec['qid'],
        'kind': kind,
        'name': name,
        'architect': ' · '.join(makers) if makers else KIND_UNKNOWN_MAKER[kind],
        'year': year if year is not None else '',
        'typology': pick_type(rec['types'], kind),
        'style': bucket_style(rec['styles'], year),
        'styleSource': ', '.join(rec['styles'][:3]),
        'city': next((p for p in rec['places'] if not BAD_PLACES.search(p)), ''),
        'country': (rec['countries'] or [''])[0],
        'lat': rec['lat'], 'lng': rec['lng'],
        'qid': rec['qid'],
        'image': (rec['images'] or [None])[0],
        'wiki': rec.get('wiki'),
        'desc': rec.get('desc'),
        'sitelinks': rec.get('sitelinks', 0),
    }


def commons_credits(files):
    """{filename: {artist, license, page}} via the Commons API, 50 files a request."""
    out = {}
    files = [f for f in files if f]
    for i in range(0, len(files), 50):
        batch = files[i:i + 50]
        url = 'https://commons.wikimedia.org/w/api.php?' + urllib.parse.urlencode({
            'action': 'query', 'format': 'json', 'prop': 'imageinfo', 'iiprop': 'extmetadata',
            'iiextmetadatafilter': 'Artist|LicenseShortName', 'titles': '|'.join('File:' + f for f in batch)})
        data = http_json(url)
        norm = {n['to']: n['from'] for n in data.get('query', {}).get('normalized', [])}
        for page in data.get('query', {}).get('pages', {}).values():
            title = page.get('title', '')
            src = norm.get(title, title)
            fname = src[5:] if src.startswith('File:') else src
            meta = (page.get('imageinfo') or [{}])[0].get('extmetadata', {})
            artist = re.sub(r'<[^>]+>', '', html.unescape(meta.get('Artist', {}).get('value', ''))).strip()
            artist = re.sub(r'\s+', ' ', artist)[:80] or 'Unknown'
            out[fname] = {'artist': artist, 'license': meta.get('LicenseShortName', {}).get('value', ''),
                          'page': 'https://commons.wikimedia.org/wiki/File:' + urllib.parse.quote(fname.replace(' ', '_'))}
        print(f'  credits {min(i + 50, len(files))}/{len(files)}')
        time.sleep(0.3)
    return out


def wiki_intros(urls):
    """{article url: 2-sentence plain-text intro} via the Wikipedia API, 20 titles a request."""
    out = {}
    titles = {urllib.parse.unquote(u.rsplit('/wiki/', 1)[-1]).replace('_', ' '): u for u in urls if u}
    names = list(titles)
    for i in range(0, len(names), 20):
        batch = names[i:i + 20]
        url = 'https://en.wikipedia.org/w/api.php?' + urllib.parse.urlencode({
            'action': 'query', 'format': 'json', 'prop': 'extracts', 'exintro': 1, 'explaintext': 1,
            'exsentences': 2, 'exlimit': 20, 'redirects': 1, 'titles': '|'.join(batch)})
        data = http_json(url)
        q = data.get('query', {})
        back = {}
        for n in q.get('normalized', []) + q.get('redirects', []):
            back[n['to']] = back.get(n['from'], n['from'])
        for page in q.get('pages', {}).values():
            t = page.get('title', '')
            src = back.get(t, t)
            text = (page.get('extract') or '').strip()
            if src in titles and text:
                out[titles[src]] = re.sub(r'\s+', ' ', text)[:420]
        print(f'  intros {min(i + 20, len(names))}/{len(names)}')
        time.sleep(0.3)
    return out


# English Wikipedia article for each hand-curated building in app/data.js. Resolved to Wikidata ids in one
# request, which is far more reliable than fuzzy name search. Unresolved ones fall back to name matching.
SEED_ARTICLES = {
    'seagram': 'Seagram Building', 'lever-house': 'Lever House', 'guggenheim-ny': 'Solomon R. Guggenheim Museum',
    'un-secretariat': 'Headquarters of the United Nations', 'ford-foundation': 'Ford Foundation Center for Social Justice',
    'twa': 'TWA Flight Center', 'moma': 'Museum of Modern Art', 'breuer': '945 Madison Avenue',
    'chrysler': 'Chrysler Building', 'empire-state': 'Empire State Building', 'grand-central': 'Grand Central Terminal',
    'flatiron': 'Flatiron Building', 'att-building': '550 Madison Avenue', 'iac': 'IAC Building', '8-spruce': '8 Spruce',
    '41-cooper': '41 Cooper Square', 'whitney': 'Whitney Museum of American Art',
    'oculus': 'World Trade Center Transportation Hub', '56-leonard': '56 Leonard Street', 'via-57': 'Via 57 West',
    'vessel': 'Vessel (structure)', 'new-museum': 'New Museum', 'hearst': 'Hearst Tower (Manhattan)',
    'glass-house': 'Glass House', 'salk': 'Salk Institute for Biological Studies', 'geisel': 'Geisel Library',
    'boston-city-hall': 'Boston City Hall', 'habitat-67': 'Habitat 67', 'kimbell': 'Kimbell Art Museum',
    'farnsworth': 'Farnsworth House', 'fallingwater': 'Fallingwater', 'vanna-venturi': 'Vanna Venturi House',
    'portland-building': 'Portland Building', 'piazza-italia': "Piazza d'Italia (New Orleans)",
    'disney-hall': 'Walt Disney Concert Hall', 'seattle-library': 'Seattle Central Library',
    'barbican': 'Barbican Estate', 'trellick': 'Trellick Tower', 'national-theatre': 'Royal National Theatre',
    'lloyds': "Lloyd's building", 'villa-savoye': 'Villa Savoye',
    'ronchamp': 'Notre-Dame du Haut', 'pompidou': 'Centre Pompidou', 'louvre-pyramid': 'Louvre Pyramid',
    'barcelona-pavilion': 'Barcelona Pavilion', 'sagrada-familia': 'Sagrada Família',
    'guggenheim-bilbao': 'Guggenheim Museum Bilbao', 'jewish-museum': 'Jewish Museum Berlin',
    'vitra-fire': 'Vitra Fire Station', 'bauhaus': 'Bauhaus Dessau', 'staatsgalerie': 'Staatsgalerie Stuttgart',
    'elbphilharmonie': 'Elbphilharmonie', 'therme-vals': 'Therme Vals', 'heydar-aliyev': 'Heydar Aliyev Center',
    'cctv': 'CCTV Headquarters', 'hsbc-hk': 'HSBC Building (Hong Kong)', 'church-of-light': 'Church of the Light',
    'sydney-opera': 'Sydney Opera House',
}


# Seeds whose Wikidata match is ambiguous; keep them as hand-written.
NO_ENRICH = {'unite'}


def wiki_titles_to_qids(titles):
    """{title: qid} via Wikipedia pageprops (follows redirects)."""
    out = {}
    titles = list(titles)
    for i in range(0, len(titles), 50):
        batch = titles[i:i + 50]
        url = 'https://en.wikipedia.org/w/api.php?' + urllib.parse.urlencode({
            'action': 'query', 'format': 'json', 'prop': 'pageprops', 'ppprop': 'wikibase_item', 'redirects': 1,
            'titles': '|'.join(batch)})
        q = http_json(url).get('query', {})
        back = {}
        for n in q.get('normalized', []) + q.get('redirects', []):
            back[n['to']] = back.get(n['from'], n['from'])
        for page in q.get('pages', {}).values():
            item = page.get('pageprops', {}).get('wikibase_item')
            if item:
                t = page.get('title', '')
                out[back.get(t, t)] = item
    return out


def read_seeds():
    src = open(DATA_JS, encoding='utf-8').read()
    seeds = []
    for m in re.finditer(r"\{ id: '([^']+)', name: (['\"])(.+?)\2, .*?lat: (-?[\d.]+), lng: (-?[\d.]+) \}", src):
        seeds.append({'id': m.group(1), 'name': m.group(3).replace("\\'", "'"), 'lat': float(m.group(4)), 'lng': float(m.group(5))})
    return seeds


def km(a, b):
    r = math.radians
    h = math.sin(r(b['lat'] - a['lat']) / 2) ** 2 + math.cos(r(a['lat'])) * math.cos(r(b['lat'])) * math.sin(r(b['lng'] - a['lng']) / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))


def norm_name(s):
    s = s.lower()
    s = re.sub(r'\(.*?\)', ' ', s)
    s = re.sub(r'\b(the|building|museum|of|and)\b', ' ', s)
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()


def similar(a, b):
    a, b = norm_name(a), norm_name(b)
    return bool(a and b) and (a in b or b in a or difflib.SequenceMatcher(None, a, b).ratio() >= 0.6)


def search_qids(name):
    url = 'https://www.wikidata.org/w/api.php?' + urllib.parse.urlencode(
        {'action': 'wbsearchentities', 'search': name, 'language': 'en', 'limit': 5, 'format': 'json'})
    return [r['id'] for r in http_json(url).get('search', [])]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--global', dest='n_global', type=int, default=450)
    ap.add_argument('--local', dest='n_local', type=int, default=250)
    ap.add_argument('--radius', type=float, default=12)
    ap.add_argument('--per-kind', dest='n_kind', type=int, default=80, help='bridges / art / spots to pull around --lat/--lng (0 = none)')
    ap.add_argument('--city', default='', help='fallback city for local buildings with no usable city')
    ap.add_argument('--lat', type=float, default=40.7580, help='centre of the local area (default: Midtown Manhattan)')
    ap.add_argument('--lng', type=float, default=-73.9855)
    args = ap.parse_args()

    seeds, (lat, lng) = read_seeds(), (args.lat, args.lng)
    print(f'{len(seeds)} hand-curated buildings; local centre {lat},{lng}')

    g = []
    if args.n_global > 0:
        print('Querying notable buildings worldwide…')
        g = top_global(args.n_global)
        print(f'  {len(g)} candidates')
    print(f'Querying buildings within {args.radius} km of the demo location…')
    l = around(lat, lng, args.radius, args.n_local)
    print(f'  {len(l)} candidates')

    # Bridges, art and spots. A more specific kind wins over "building" (e.g. a bridge that also has an architect).
    kind_of = {q: 'building' for q in g + l}
    kind_ids = []
    for kind in ('spot', 'art', 'bridge'):
        if args.n_kind <= 0:
            break
        print(f'Querying {kind} within {args.radius} km…')
        ids = around_kind(lat, lng, args.radius, args.n_kind, KIND_CLASSES[kind], need_image=kind != 'bridge')
        print(f'  {len(ids)} candidates')
        for q in ids:
            kind_of[q] = kind
        kind_ids += ids

    recs = details(list(dict.fromkeys(g + l + kind_ids)))
    shaped = {k: s for k, s in ((k, shape(r, kind_of.get(k, 'building'))) for k, r in recs.items()) if s}
    glob = [shaped[q] for q in g if q in shaped][:args.n_global]
    local = [shaped[q] for q in dict.fromkeys(l + kind_ids) if q in shaped]
    local = [b for b in local if b['kind'] != 'building'] + [b for b in local if b['kind'] == 'building'][:args.n_local]
    for b in local:
        if not b['city'] and args.city:
            b['city'] = args.city
    pool = {b['qid']: b for b in glob + local}

    # Pin hand-curated buildings via their Wikipedia article; match the rest by proximity + name, then name search.
    enrich, used, unmatched = {}, set(), []
    title_qids = wiki_titles_to_qids(SEED_ARTICLES.values())
    pinned = {sid: title_qids[t] for sid, t in SEED_ARTICLES.items() if t in title_qids}
    pinned_recs = details(sorted(set(pinned.values())))
    for sid, q in pinned.items():
        rec = pinned_recs.get(q)
        b = shape(rec) if rec else None
        if b:
            enrich[sid] = b
            used.add(q)
    print(f'  pinned {len(enrich)}/{len(seeds)} hand-curated buildings via Wikipedia titles')
    for s in seeds:
        if s['id'] in enrich or s['id'] in NO_ENRICH:
            continue
        hit = max((b for b in pool.values() if km(s, b) < 0.8 and similar(s['name'], b['name'])),
                  key=lambda b: b['sitelinks'], default=None)
        if hit:
            enrich[s['id']] = hit
            used.add(hit['qid'])
        else:
            unmatched.append(s)
    print(f'Searching Wikidata by name for {len(unmatched)} hand-curated buildings…')
    cand_ids = {}
    for s in unmatched:
        try:
            cand_ids[s['id']] = search_qids(s['name'])
        except Exception as e:
            print(f'  search failed for {s["name"]}: {e}')
            cand_ids[s['id']] = []
        time.sleep(1)
    cand_recs = details(sorted({q for ids in cand_ids.values() for q in ids}))
    for s in unmatched:
        options = [x for x in (shape(cand_recs[q]) for q in cand_ids[s['id']] if q in cand_recs)
                   if x and km(s, x) < 3 and similar(s['name'], x['name'])]
        hit = max(options, key=lambda b: (bool(b.get('wiki')), bool(b.get('image')), b['sitelinks']), default=None)
        if hit:
            enrich[s['id']] = hit
            used.add(hit['qid'])
        else:
            print(f'  no Wikidata match for {s["name"]}')

    # Drop pool items that duplicate a hand-curated building, or each other (same name within 300 m).
    extra = []
    for b in pool.values():
        if b['qid'] in used:
            continue
        if any(km(b, s) < 0.3 and similar(b['name'], s['name']) for s in seeds):
            continue
        if any(km(b, e) < 0.3 and similar(b['name'], e['name']) for e in extra):
            continue
        extra.append(b)

    everything = list(enrich.values()) + extra
    print('Fetching photo credits from Commons…')
    credits = commons_credits(sorted({b['image'] for b in everything if b.get('image')}))
    print('Fetching intros from Wikipedia…')
    intros = wiki_intros(sorted({b['wiki'] for b in everything if b.get('wiki')}))

    def finish(b, keep_basics):
        out = {'qid': b['qid'], 'image': b.get('image'), 'credit': credits.get(b.get('image')) if b.get('image') else None,
               'wiki': b.get('wiki'), 'blurb': intros.get(b.get('wiki')) or (b.get('desc') or '').capitalize() or None,
               'styleSource': b.get('styleSource') or None}
        if keep_basics:
            out = {k: b[k] for k in ('id', 'kind', 'name', 'architect', 'year', 'typology', 'style', 'city', 'country', 'lat', 'lng')} | out
        return {k: v for k, v in out.items() if v not in (None, '')}

    payload = {
        'generatedAt': time.strftime('%Y-%m-%d'),
        'source': 'Wikidata (CC0) · Wikipedia intros (CC BY-SA) · Wikimedia Commons photos (see credit per image)',
        'enrich': {sid: finish(b, False) for sid, b in enrich.items()},
        'buildings': [finish(b, True) for b in sorted(extra, key=lambda b: -b['sitelinks'])],
    }
    with open(OUT_JS, 'w', encoding='utf-8') as f:
        f.write('// Generated by tools/fetch_wikidata.py — do not edit by hand; re-run the script instead.\n')
        f.write('window.TS_WIKIDATA = ')
        json.dump(payload, f, ensure_ascii=False, separators=(',', ':'))
        f.write(';\n')
    kinds = {}
    for b in payload['buildings']:
        kinds[b['kind']] = kinds.get(b['kind'], 0) + 1
    print('  by kind:', kinds)
    n_img = sum(1 for b in payload['buildings'] if b.get('image')) + sum(1 for b in payload['enrich'].values() if b.get('image'))
    print(f'Wrote {OUT_JS}: {len(payload["enrich"])}/{len(seeds)} seeds enriched, {len(payload["buildings"])} new buildings, '
          f'{n_img} with photos, {os.path.getsize(OUT_JS) // 1024} KB')


if __name__ == '__main__':
    main()
