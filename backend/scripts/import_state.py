"""Copy a GET /state dump into the database DATABASE_URL points at.

Used to carry data over when moving hosts (e.g. the old SQLite-on-Render
deploy to Postgres). Existing rows are left alone, so it's safe to re-run.

Run from backend/:
    curl -o state.json https://throwshade.onrender.com/state
    DATABASE_URL=postgresql://... python scripts/import_state.py state.json
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.db import get_connection, init_db  # noqa: E402


def main(path: str) -> None:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    init_db()
    conn = get_connection()
    try:
        for u in data["users"]:
            conn.execute(
                "INSERT INTO users (id, handle, name, bio) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING",
                (u["id"], u["handle"], u["name"], u.get("bio")),
            )
        for p in data["places"]:
            conn.execute(
                """INSERT INTO places
                   (id, kind, name, architect, year, typology, style, city, country,
                    lat, lng, address, osm, qid, image, credit, blurb, wiki, source, added_by, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING""",
                (
                    p["id"], p.get("kind") or "building", p["name"], p.get("architect"), p.get("year"),
                    p.get("typology"), p.get("style"), p.get("city"), p.get("country"),
                    p.get("lat"), p.get("lng"), p.get("address"), p.get("osm"), p.get("qid"),
                    p.get("image"), p.get("credit"), p.get("blurb"), p.get("wiki"),
                    p.get("source") or "user", p.get("addedBy"), p.get("createdAt"),
                ),
            )
        for v in data["visits"]:
            conn.execute(
                """INSERT INTO visits
                   (id, user_id, place_id, stars, note, likes, photos, visited_on, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING""",
                (
                    v["id"], v["userId"], v["buildingId"], v["stars"], v.get("note"),
                    json.dumps(v.get("likes") or []), json.dumps(v.get("photos") or []),
                    v.get("visitedOn"), v["createdAt"],
                ),
            )
        for follower, followee in data["follows"]:
            conn.execute(
                "INSERT INTO follows (follower_id, followee_id) VALUES (?, ?) ON CONFLICT DO NOTHING",
                (follower, followee),
            )
        for w in data["want"]:
            conn.execute(
                "INSERT INTO want_to_visit (user_id, place_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
                (w["userId"], w["buildingId"], w.get("createdAt")),
            )
        for l in data["lists"]:
            conn.execute(
                "INSERT INTO lists (id, name, owner_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING",
                (l["id"], l["name"], l["ownerId"], l.get("createdAt")),
            )
            for member in l.get("members", []):
                conn.execute(
                    "INSERT INTO list_members (list_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING",
                    (l["id"], member),
                )
            for it in l.get("items", []):
                conn.execute(
                    "INSERT INTO list_items (list_id, place_id, added_by, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING",
                    (l["id"], it["buildingId"], it.get("addedBy"), it.get("createdAt")),
                )
        conn.commit()
        counts = {
            table: conn.execute(f"SELECT COUNT(*) AS c FROM {table}").fetchone()["c"]
            for table in ["users", "places", "visits", "follows", "want_to_visit", "lists", "list_items"]
        }
        print("Database now has:", counts)
    finally:
        conn.close()


if __name__ == "__main__":
    main(sys.argv[1])
