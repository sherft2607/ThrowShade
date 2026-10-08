"""Remove the old demo critics from the database DATABASE_URL points at.

Earlier builds seeded fictional critics (noor.h, shandon.h, felix.m, lena.o, plus
mara.k, theo.b, priya.s and jonah.w on some devices) with logs, follows and two
demo lists. This deletes those accounts and everything that belongs to them.
Real people's accounts, logs and follows between real people are left alone;
only their follows to or from a demo critic go.

Every run first writes a full JSON backup of every table next to this script.
Without --apply it only reports what it would delete.

Run from backend/:
    DATABASE_URL=postgresql://... python scripts/remove_demo_data.py            # dry run
    DATABASE_URL=postgresql://... python scripts/remove_demo_data.py --apply    # delete
"""
import base64
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.db import get_connection  # noqa: E402

DEMO_USERS = ["u-mara", "u-theo", "u-priya", "u-jonah", "u-noor", "u-shandon", "u-felix", "u-lena"]
DEMO_LISTS = ["l-mies", "l-bridges"]
TABLES = [
    "users", "places", "visits", "follows", "want_to_visit", "lists", "list_members", "list_items",
    "sessions", "photos", "comments", "game_results", "hearts", "stories",
]


def _json_default(value):
    if isinstance(value, (bytes, bytearray, memoryview)):
        return base64.b64encode(bytes(value)).decode("ascii")
    return str(value)


def backup(conn) -> Path:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    path = Path(__file__).resolve().parent / f"backup-before-demo-removal-{stamp}.json"
    dump = {t: [dict(r) for r in conn.execute(f"SELECT * FROM {t}").fetchall()] for t in TABLES}
    path.write_text(json.dumps(dump, default=_json_default), encoding="utf-8")
    return path


def main(apply: bool) -> None:
    conn = get_connection()
    try:
        print(f"Backup written to {backup(conn)}")
        users = DEMO_USERS
        lists = sorted(set(DEMO_LISTS) | {
            r["id"] for r in conn.execute("SELECT id FROM lists WHERE owner_id = ANY(?)", (users,)).fetchall()
        })
        # (label, DELETE statement, params). Children before parents.
        steps = [
            ("list items on demo lists", "DELETE FROM list_items WHERE list_id = ANY(?)", (lists,)),
            ("list memberships", "DELETE FROM list_members WHERE list_id = ANY(?) OR user_id = ANY(?)", (lists, users)),
            ("demo lists", "DELETE FROM lists WHERE id = ANY(?)", (lists,)),
            ("follows to or from demo critics", "DELETE FROM follows WHERE follower_id = ANY(?) OR followee_id = ANY(?)", (users, users)),
            ("hearts", "DELETE FROM hearts WHERE user_id = ANY(?) OR visit_user_id = ANY(?)", (users, users)),
            ("comments", "DELETE FROM comments WHERE user_id = ANY(?) OR visit_user_id = ANY(?)", (users, users)),
            ("logs", "DELETE FROM visits WHERE user_id = ANY(?)", (users,)),
            ("want-to-visit", "DELETE FROM want_to_visit WHERE user_id = ANY(?)", (users,)),
            ("photos", "DELETE FROM photos WHERE user_id = ANY(?)", (users,)),
            ("stories", "DELETE FROM stories WHERE user_id = ANY(?)", (users,)),
            ("game results", "DELETE FROM game_results WHERE user_id = ANY(?)", (users,)),
            ("sessions", "DELETE FROM sessions WHERE user_id = ANY(?)", (users,)),
            ("demo accounts", "DELETE FROM users WHERE id = ANY(?)", (users,)),
        ]
        for label, sql, params in steps:
            count = conn.execute(sql, params).rowcount
            print(f"{'Deleted' if apply else 'Would delete'} {count:>5}  {label}")
        if apply:
            conn.commit()
            print("Done.")
        else:
            conn.rollback()
            print("Dry run: nothing was deleted. Re-run with --apply to delete.")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main(apply="--apply" in sys.argv[1:])
