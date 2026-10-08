"""Facts about each place, shown as small icons on the place page and explained in About.

Usage:  python tools/fetch_facts.py
Writes app/facts.js: window.TS_FACTS = { buildingId: { heritage, awards, pritzker, certs, access } }

  heritage  Wikidata P1435 (heritage designation): National Register, National Historic Landmark, Chicago Landmark, UNESCO …
  awards    Wikidata P166 (award received) on the building
  pritzker  the building's architect(s) who won the Pritzker Prize (Wikidata P166 = Q133160 on the architect), with year
  certs     sustainability certifications found in Wikidata labels (LEED, BREEAM, …); hand-checked ones live in
            app/data.js (TS_CERTS) because the USGBC directory has no API
  access    OpenStreetMap tags on the element carrying the same Wikidata id: wheelchair, fee, opening_hours, website
            (queried inside the demo area's bounding box)
"""
import json
import os
import re
import sys
import time
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch_wikidata import http_json, sparql  # same cache + polite backoff

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WIKI_JS = os.path.join(ROOT, 'app', 'wikidata.js')
OUT_JS = os.path.join(ROOT, 'app', 'facts.js')
BBOX = (41.6, -88.0, 42.1, -87.5)  # Chicago area — matches the Wikidata import
CERT = re.compile(r'LEED|BREEAM|Passive House|Passivhaus|Living Building|Energy Star|WELL (Building|Certified)', re.I)
PRITZKER = 'Q133160'  # Pritzker Architecture Prize


def places():
    src = open(WIKI_JS, encoding='utf-8').read()
    data = json.loads(src[src.index('=') + 1:].rstrip().rstrip(';'))
    out = {sid: e['qid'] for sid, e in data['enrich'].items() if e.get('qid')}
    out.update({b['id']: b['qid'] for b in data['buildings'] if b.get('qid')})
    return out


def wikidata_facts(qids):
    facts = {}
    qids = sorted(set(qids))
    for i in range(0, len(qids), 60):
        values = ' '.join('wd:' + q for q in qids[i:i + 60])
        q = f"""SELECT ?item ?hLabel ?aLabel ?archLabel ?pYear WHERE {{
          VALUES ?item {{ {values} }}
          OPTIONAL {{ ?item wdt:P1435 ?h }}
          OPTIONAL {{ ?item wdt:P166 ?a }}
          OPTIONAL {{ ?item wdt:P84 ?arch . ?arch p:P166 ?st . ?st ps:P166 wd:{PRITZKER} .
                     OPTIONAL {{ ?st pq:P585 ?pd }} BIND(YEAR(?pd) AS ?pYear) }}
          SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
        }}"""
        for r in sparql(q):
            qid = r['item']['value'].rsplit('/', 1)[-1]
            f = facts.setdefault(qid, {'heritage': [], 'awards': [], 'pritzker': []})
            for key, field in (('hLabel', 'heritage'), ('aLabel', 'awards')):
                v = r.get(key, {}).get('value')
                if v and not re.fullmatch(r'Q\d+', v) and v not in f[field]:
                    f[field].append(v)
            arch = r.get('archLabel', {}).get('value')
            if arch and not re.fullmatch(r'Q\d+', arch):
                entry = {'name': arch, 'year': int(r['pYear']['value']) if r.get('pYear') else None}
                if entry not in f['pritzker']:
                    f['pritzker'].append(entry)
        print(f'  wikidata {min(i + 60, len(qids))}/{len(qids)}')
        time.sleep(0.5)
    return facts


def osm_access(qids):
    out = {}
    qids = sorted(set(qids))
    for i in range(0, len(qids), 120):
        chunk = '|'.join(qids[i:i + 120])
        q = f'[out:json][timeout:90];nwr["wikidata"~"^({chunk})$"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});out tags;'
        try:
            data = http_json('https://overpass-api.de/api/interpreter', data=urllib.parse.urlencode({'data': q}).encode())
        except Exception as e:
            print(f'  overpass chunk failed: {e}')
            continue
        for el in data.get('elements', []):
            t = el.get('tags', {})
            a = out.setdefault(t.get('wikidata'), {})
            for k in ('wheelchair', 'fee', 'opening_hours', 'website'):
                if t.get(k) and k not in a:
                    a[k] = t[k]
        print(f'  overpass {min(i + 120, len(qids))}/{len(qids)}')
        time.sleep(2)
    return {q: a for q, a in out.items() if a}


def main():
    ids = places()
    print(f'{len(ids)} places with Wikidata ids')
    wd = wikidata_facts(ids.values())
    access = osm_access(ids.values())
    result = {}
    for bid, q in ids.items():
        f = wd.get(q, {'heritage': [], 'awards': [], 'pritzker': []})
        certs = [x for x in f['heritage'] + f['awards'] if CERT.search(x)]
        entry = {
            'heritage': [x for x in f['heritage'] if x not in certs],
            'awards': [x for x in f['awards'] if x not in certs],
            'pritzker': f['pritzker'],
            'certs': certs,
            'access': access.get(q, {}),
        }
        entry = {k: v for k, v in entry.items() if v}
        if entry:
            result[bid] = entry
    with open(OUT_JS, 'w', encoding='utf-8') as fh:
        fh.write('// Generated by tools/fetch_facts.py — landmark status, awards and Pritzker architects (Wikidata),\n')
        fh.write('// access (OpenStreetMap). Hand-checked certifications live in app/data.js (TS_CERTS).\n')
        fh.write('window.TS_FACTS = ')
        json.dump(result, fh, ensure_ascii=False, separators=(',', ':'))
        fh.write(';\n')
    count = lambda k: sum(1 for v in result.values() if k in v)
    print(f'Wrote {OUT_JS}: {len(result)} places — heritage {count("heritage")}, awards {count("awards")}, '
          f'pritzker {count("pritzker")}, certs {count("certs")}, access {count("access")}')


if __name__ == '__main__':
    main()
