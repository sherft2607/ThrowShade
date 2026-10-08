"""Stand-in photos for the seeded critics' posts: a few photos per building from its Wikimedia Commons category
(Wikidata P373), which holds pictures of the place itself (article images often include portraits of people).

Usage:  python tools/fetch_seed_photos.py
Writes app/seed-photos.js: window.TS_SEED_PHOTOS = { buildingId: [{ url, credit: { artist, license, page } }, …] }
Photos come from Wikimedia Commons with their credit and licence; the app shows the credit under the photos.
"""
import json
import os
import re
import sys
import time
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch_wikidata import http_json  # same cache + polite backoff

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_JS = os.path.join(ROOT, 'app', 'data.js')
WIKI_JS = os.path.join(ROOT, 'app', 'wikidata.js')
OUT_JS = os.path.join(ROOT, 'app', 'seed-photos.js')
PER_BUILDING = 4
PEOPLE = re.compile(r'\b(people|men|women|portraits?|politicians|persons?|actors|musicians|activists|selfies?|members of)\b', re.I)
SKIP = re.compile(r'logo|map|icon|flag|diagram|plan|seal|coat.of.arms|locator|signature|commons-|wiki|symbol|sketch|drawing|section|elevation|portrait|headshot'
                  r'|protest|rally|march|demonstrat|police|riot|parade|funeral|wedding|meeting|conference|president', re.I)
# Words too generic to prove a photo shows this particular place.
GENERIC = {'building', 'buildings', 'tower', 'house', 'center', 'centre', 'museum', 'park', 'bridge', 'chicago', 'york',
           'city', 'street', 'avenue', 'hall', 'church', 'library', 'station', 'plaza', 'square', 'north', 'south', 'east',
           'west', 'the', 'and', 'of', 'art', 'national', 'new', 'state', 'united', 'states'}


def name_tokens(name):
    return [w for w in re.findall(r'[a-z0-9]+', name.lower()) if len(w) >= 4 and w not in GENERIC]


def names_the_place(file_title, tokens):
    """True when the file name mentions the place — portraits and event photos taken there usually don't."""
    t = file_title.lower().replace('_', ' ')
    return any(tok in t for tok in tokens)


def seeded_building_ids():
    src = open(DATA_JS, encoding='utf-8').read()
    return list(dict.fromkeys(re.findall(r"\['u-[a-z]+', '([^']+)', \d, ", src)))


def building_meta():
    src = open(WIKI_JS, encoding='utf-8').read()
    data = json.loads(src[src.index('=') + 1:].rstrip().rstrip(';'))
    qids = {sid: e.get('qid') for sid, e in data['enrich'].items()}
    qids.update({b['id']: b.get('qid') for b in data['buildings']})
    main = {sid: e.get('image') for sid, e in data['enrich'].items()}
    main.update({b['id']: b.get('image') for b in data['buildings']})
    return qids, main


def commons_categories(qids):
    """{qid: 'Category name'} from Wikidata P373, 50 items a request."""
    out = {}
    qids = [q for q in qids if q]
    for i in range(0, len(qids), 50):
        url = 'https://www.wikidata.org/w/api.php?' + urllib.parse.urlencode({
            'action': 'wbgetentities', 'format': 'json', 'props': 'claims', 'ids': '|'.join(qids[i:i + 50])})
        for q, ent in http_json(url).get('entities', {}).items():
            for c in ent.get('claims', {}).get('P373', []):
                v = c.get('mainsnak', {}).get('datavalue', {}).get('value')
                if v:
                    out[q] = v
                    break
    return out


def category_files(cat):
    url = 'https://commons.wikimedia.org/w/api.php?' + urllib.parse.urlencode({
        'action': 'query', 'format': 'json', 'list': 'categorymembers', 'cmtype': 'file', 'cmlimit': 40,
        'cmtitle': 'Category:' + cat})
    files = [m['title'] for m in http_json(url).get('query', {}).get('categorymembers', [])]
    return [t for t in files if re.search(r'\.jpe?g$', t, re.I) and not SKIP.search(t)]


def image_infos(files):
    if not files:
        return []
    url = 'https://commons.wikimedia.org/w/api.php?' + urllib.parse.urlencode({
        'action': 'query', 'format': 'json', 'prop': 'imageinfo', 'iiprop': 'url|size|extmetadata', 'iiurlwidth': 900,
        'iiextmetadatafilter': 'Artist|LicenseShortName|Categories', 'titles': '|'.join(files[:20])})
    out = []
    for page in http_json(url).get('query', {}).get('pages', {}).values():
        info = (page.get('imageinfo') or [{}])[0]
        if not info.get('thumburl') or info.get('width', 0) < 700 or info.get('height', 0) < 450:
            continue
        meta = info.get('extmetadata', {})
        if PEOPLE.search(meta.get('Categories', {}).get('value', '')):
            continue  # a portrait taken at the building, not a photo of it
        artist = re.sub(r'<[^>]+>', '', meta.get('Artist', {}).get('value', ''))
        artist = re.sub(r'\s+', ' ', artist).strip()[:60] or 'Unknown'
        out.append({'url': info['thumburl'], 'credit': {
            'artist': artist, 'license': meta.get('LicenseShortName', {}).get('value', ''),
            'page': info.get('descriptionurl') or 'https://commons.wikimedia.org/wiki/' + urllib.parse.quote(page['title'].replace(' ', '_'))}})
    return out


def main():
    ids = seeded_building_ids()
    qids, main_images = building_meta()
    cats = commons_categories(sorted({qids.get(b) for b in ids if qids.get(b)}))
    result = {}
    for bid in ids:
        cat = cats.get(qids.get(bid))
        if not cat:
            print(f'  {bid}: no Commons category, skipped')
            continue
        tokens = name_tokens(cat)
        files = [f for f in category_files(cat) if not tokens or names_the_place(f, tokens)]
        # Put the building's main photo last so posts show different angles first.
        main_file = main_images.get(bid)
        files.sort(key=lambda f: main_file is not None and f.endswith(main_file))
        photos = image_infos(files)[:PER_BUILDING]
        if photos:
            result[bid] = photos
        print(f'  {bid}: {len(photos)} photos')
        time.sleep(0.3)
    with open(OUT_JS, 'w', encoding='utf-8') as f:
        f.write('// Generated by tools/fetch_seed_photos.py — stand-in photos for the seeded critics\' posts (Wikimedia Commons).\n')
        f.write('window.TS_SEED_PHOTOS = ')
        json.dump(result, f, ensure_ascii=False, separators=(',', ':'))
        f.write(';\n')
    print(f'Wrote {OUT_JS}: {len(result)}/{len(ids)} buildings, {sum(len(v) for v in result.values())} photos')


if __name__ == '__main__':
    main()
