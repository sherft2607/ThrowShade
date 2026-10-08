import base64
import json
import uuid
from datetime import datetime, timedelta, timezone

import time

from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from .auth import bearer, current_user, end_session, hash_password, new_session, optional_user, require_self, verify_password
from .db import IntegrityError, get_connection, init_db
from .models import (
    FollowCreate,
    ListCreate,
    CommentCreate,
    GameResult,
    HeartBody,
    AccountDelete,
    ListItemCreate,
    PasswordChange,
    LoginBody,
    SignupBody,
    Place,
    PhotoCreate,
    PlaceCreate,
    StoryCreate,
    User,
    UserUpdate,
    Visit,
    VisitCreate,
    WantCreate,
)

app = FastAPI(title="throwShade API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    init_db()


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def row_to_place(row) -> dict:
    return dict(row)


def row_to_visit(row) -> dict:
    d = dict(row)
    d["likes"] = json.loads(d["likes"]) if d["likes"] else []
    d["photos"] = json.loads(d["photos"]) if d["photos"] else []
    return d


# ---------- users ----------

# ---------- accounts ----------

def _public(row) -> dict:
    return {"id": row["id"], "handle": row["handle"], "name": row["name"], "bio": row["bio"], "private": bool(row["private"])}


@app.post("/auth/signup")
def signup(body: SignupBody):
    conn = get_connection()
    try:
        user_id = body.id or f"u-{uuid.uuid4().hex[:8]}"
        try:
            conn.execute(
                "INSERT INTO users (id, handle, name, bio, password_hash) VALUES (?, ?, ?, ?, ?)",
                (user_id, body.handle, body.name, "", hash_password(body.password)),
            )
        except IntegrityError:
            conn.rollback()
            raise HTTPException(status_code=409, detail="that handle is taken")
        token = new_session(conn, user_id, now())
        conn.commit()
        return {"token": token, "user": {"id": user_id, "handle": body.handle, "name": body.name, "bio": ""}}
    finally:
        conn.close()


# Brute-force guard: too many wrong passwords for one handle (or from one address) in 15 minutes
# pauses logins for it. In memory, which is fine for a single server instance.
FAIL_WINDOW, FAIL_PER_HANDLE, FAIL_PER_IP = 15 * 60, 5, 20
_fails: dict[str, list[float]] = {}


def _recent(key: str) -> list[float]:
    cutoff = time.time() - FAIL_WINDOW
    _fails[key] = [t for t in _fails.get(key, []) if t > cutoff]
    return _fails[key]


def _check_locked(handle: str, ip: str) -> None:
    for key, limit in ((f"h:{handle}", FAIL_PER_HANDLE), (f"ip:{ip}", FAIL_PER_IP)):
        hits = _recent(key)
        if len(hits) >= limit:
            wait = max(1, int((hits[0] + FAIL_WINDOW - time.time()) / 60) + 1)
            raise HTTPException(status_code=429, detail=f"too many tries — wait {wait} min and try again")


def _record_fail(handle: str, ip: str) -> None:
    now_ts = time.time()
    for key in (f"h:{handle}", f"ip:{ip}"):
        _recent(key).append(now_ts)


@app.post("/auth/login")
def login(body: LoginBody, request: Request):
    handle = body.handle.lower().lstrip("@")
    ip = (request.headers.get("x-forwarded-for") or (request.client.host if request.client else "?")).split(",")[0].strip()
    _check_locked(handle, ip)
    conn = get_connection()
    try:
        row = conn.execute("SELECT * FROM users WHERE handle = ?", (handle,)).fetchone()
        if not row:
            _record_fail(handle, ip)
            raise HTTPException(status_code=401, detail="wrong handle or password")
        if row["password_hash"] is None:
            # Accounts made before sign-in existed have no password: the first login sets it.
            if len(body.password) < 8:
                raise HTTPException(status_code=400, detail="pick a password of at least 8 characters")
            conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hash_password(body.password), row["id"]))
        elif not verify_password(body.password, row["password_hash"]):
            _record_fail(handle, ip)
            raise HTTPException(status_code=401, detail="wrong handle or password")
        token = new_session(conn, row["id"], now())
        conn.commit()
        return {"token": token, "user": _public(row)}
    finally:
        conn.close()


@app.post("/auth/logout")
def logout(authorization: str | None = Header(default=None)):
    conn = get_connection()
    try:
        end_session(conn, bearer(authorization))
        conn.commit()
        return {"ok": True}
    finally:
        conn.close()


@app.get("/auth/me")
def whoami(me: str = Depends(current_user)):
    conn = get_connection()
    try:
        return _public(conn.execute("SELECT * FROM users WHERE id = ?", (me,)).fetchone())
    finally:
        conn.close()


@app.post("/auth/password")
def change_password(body: PasswordChange, me: str = Depends(current_user)):
    conn = get_connection()
    try:
        row = conn.execute("SELECT password_hash FROM users WHERE id = ?", (me,)).fetchone()
        if not row or not row["password_hash"] or not verify_password(body.old_password, row["password_hash"]):
            raise HTTPException(status_code=400, detail="current password is wrong")
        conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hash_password(body.new_password), me))
        # Sign out every other device; this one gets a fresh session.
        conn.execute("DELETE FROM sessions WHERE user_id = ?", (me,))
        token = new_session(conn, me, now())
        conn.commit()
        return {"token": token}
    finally:
        conn.close()


@app.post("/auth/delete-account")
def delete_account(body: AccountDelete, me: str = Depends(current_user)):
    conn = get_connection()
    try:
        row = conn.execute("SELECT password_hash FROM users WHERE id = ?", (me,)).fetchone()
        if not row or not row["password_hash"] or not verify_password(body.password, row["password_hash"]):
            raise HTTPException(status_code=400, detail="password is wrong")
        owned = [r["id"] for r in conn.execute("SELECT id FROM lists WHERE owner_id = ?", (me,)).fetchall()]
        for list_id in owned:
            conn.execute("DELETE FROM list_items WHERE list_id = ?", (list_id,))
            conn.execute("DELETE FROM list_members WHERE list_id = ?", (list_id,))
        for sql in (
            "DELETE FROM lists WHERE owner_id = ?", "DELETE FROM list_members WHERE user_id = ?",
            "DELETE FROM visits WHERE user_id = ?", "DELETE FROM want_to_visit WHERE user_id = ?",
            "DELETE FROM follows WHERE follower_id = ? OR followee_id = ?", "DELETE FROM stories WHERE user_id = ?",
            "DELETE FROM photos WHERE user_id = ?", "DELETE FROM comments WHERE user_id = ? OR visit_user_id = ?",
            "DELETE FROM hearts WHERE user_id = ? OR visit_user_id = ?", "DELETE FROM game_results WHERE user_id = ?",
            "UPDATE places SET added_by = NULL WHERE added_by = ?", "DELETE FROM sessions WHERE user_id = ?",
            "DELETE FROM users WHERE id = ?",
        ):
            conn.execute(sql, (me,) * sql.count("?"))
        conn.commit()
        return {"ok": True}
    finally:
        conn.close()


def require_member(list_id: str, me: str) -> None:
    conn = get_connection()
    try:
        row = conn.execute("SELECT 1 FROM list_members WHERE list_id = ? AND user_id = ?", (list_id, me)).fetchone()
    finally:
        conn.close()
    if not row:
        raise HTTPException(status_code=403, detail="you're not on this list")


@app.get("/users/{user_id}", response_model=User)
def get_user(user_id: str):
    conn = get_connection()
    try:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="user not found")
        return dict(row)
    finally:
        conn.close()


@app.put("/users/{user_id}", response_model=User)
def update_user(user_id: str, body: UserUpdate, me: str = Depends(current_user)):
    require_self(me, user_id)
    conn = get_connection()
    try:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="user not found")
        updated = {**_public(row), **body.model_dump(exclude_unset=True)}
        conn.execute(
            "UPDATE users SET handle=?, name=?, bio=?, private=? WHERE id=?",
            (updated["handle"], updated["name"], updated["bio"], bool(updated.get("private")), user_id),
        )
        conn.commit()
        return updated
    finally:
        conn.close()


# ---------- places ----------

@app.get("/places", response_model=list[Place])
def list_places(kind: str | None = None, city: str | None = None):
    conn = get_connection()
    try:
        query = "SELECT * FROM places WHERE 1=1"
        params: list = []
        if kind:
            query += " AND kind = ?"
            params.append(kind)
        if city:
            query += " AND city = ?"
            params.append(city)
        rows = conn.execute(query, params).fetchall()
        return [row_to_place(r) for r in rows]
    finally:
        conn.close()


@app.get("/places/{place_id}", response_model=Place)
def get_place(place_id: str):
    conn = get_connection()
    try:
        row = conn.execute("SELECT * FROM places WHERE id = ?", (place_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="place not found")
        return row_to_place(row)
    finally:
        conn.close()


@app.post("/places", response_model=Place)
def create_place(body: PlaceCreate, me: str = Depends(current_user)):
    body.added_by = me
    conn = get_connection()
    try:
        place_id = body.id or f"pin-{uuid.uuid4().hex[:10]}"
        created = now()
        conn.execute(
            """INSERT INTO places
               (id, kind, name, architect, year, typology, style, city, country,
                lat, lng, address, osm, qid, image, wiki, source, added_by, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'user', ?, ?) ON CONFLICT DO NOTHING""",
            (
                place_id, body.kind, body.name, body.architect, body.year,
                body.typology, body.style, body.city, body.country,
                body.lat, body.lng, body.address, body.osm, body.qid, body.image, body.wiki,
                body.added_by, created,
            ),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM places WHERE id = ?", (place_id,)).fetchone()
        return row_to_place(row)
    finally:
        conn.close()


# ---------- visits ----------

@app.get("/visits", response_model=list[Visit])
def list_visits(user_id: str | None = None, place_id: str | None = None):
    conn = get_connection()
    try:
        query = "SELECT * FROM visits WHERE 1=1"
        params: list = []
        if user_id:
            query += " AND user_id = ?"
            params.append(user_id)
        if place_id:
            query += " AND place_id = ?"
            params.append(place_id)
        query += " ORDER BY created_at DESC"
        rows = conn.execute(query, params).fetchall()
        return [row_to_visit(r) for r in rows]
    finally:
        conn.close()


@app.post("/visits", response_model=Visit)
def upsert_visit(body: VisitCreate, me: str = Depends(current_user)):
    require_self(me, body.user_id)
    conn = get_connection()
    try:
        existing = conn.execute(
            "SELECT id FROM visits WHERE user_id = ? AND place_id = ?",
            (body.user_id, body.place_id),
        ).fetchone()
        created = now()
        likes_json = json.dumps(body.likes)
        if any(not (p.startswith("/photos/") or p.startswith("https://")) or len(p) > 600 for p in body.photos):
            raise HTTPException(status_code=400, detail="photos must be uploaded first")
        photos_json = json.dumps(body.photos)
        # Uploaded photos this log no longer uses are deleted, so edits don't leave orphans behind.
        keep = [p.removeprefix("/photos/") for p in body.photos if p.startswith("/photos/")]
        for row in conn.execute("SELECT id FROM photos WHERE user_id = ? AND place_id = ?", (body.user_id, body.place_id)).fetchall():
            if row["id"] not in keep:
                conn.execute("DELETE FROM photos WHERE id = ?", (row["id"],))
        if existing:
            visit_id = existing["id"]
            conn.execute(
                """UPDATE visits SET stars=?, note=?, likes=?, photos=?,
                   visited_on=?, created_at=? WHERE id=?""",
                (body.stars, body.note, likes_json, photos_json,
                 body.visited_on, created, visit_id),
            )
        else:
            visit_id = f"v-{uuid.uuid4().hex[:10]}"
            conn.execute(
                """INSERT INTO visits
                   (id, user_id, place_id, stars, note, likes, photos, visited_on, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (visit_id, body.user_id, body.place_id, body.stars, body.note,
                 likes_json, photos_json, body.visited_on, created),
            )
        conn.execute(
            "DELETE FROM want_to_visit WHERE user_id = ? AND place_id = ?",
            (body.user_id, body.place_id),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM visits WHERE id = ?", (visit_id,)).fetchone()
        return row_to_visit(row)
    finally:
        conn.close()


# ---------- log photos and comments ----------
# A log's photos are uploaded one by one, then listed on the visit as "/photos/<id>" paths.
# Comments hang off a log by (owner, place), the same key the backend upserts visits on.

@app.post("/photos")
def upload_photo(body: PhotoCreate, me: str = Depends(current_user)):
    if not body.image.startswith("data:image/"):
        raise HTTPException(400, "image must be a data URL")
    photo_id = f"p-{uuid.uuid4().hex[:12]}"
    conn = get_connection()
    try:
        count = conn.execute("SELECT COUNT(*) AS n FROM photos WHERE user_id = ? AND place_id = ?", (me, body.place_id)).fetchone()["n"]
        if count >= 8:
            raise HTTPException(400, "too many photos for one log")
        conn.execute("INSERT INTO photos (id, user_id, place_id, image, created_at) VALUES (?, ?, ?, ?, ?)",
                     (photo_id, me, body.place_id, body.image, now()))
        conn.commit()
        return {"id": photo_id, "path": f"/photos/{photo_id}"}
    finally:
        conn.close()


@app.get("/photos/{photo_id}")
def get_photo(photo_id: str):
    conn = get_connection()
    try:
        row = conn.execute("SELECT image FROM photos WHERE id = ?", (photo_id,)).fetchone()
    finally:
        conn.close()
    if not row:
        raise HTTPException(404, "photo not found")
    header, _, data = row["image"].partition(",")
    return Response(base64.b64decode(data), media_type=header[5:].split(";")[0] or "image/jpeg",
                    headers={"Cache-Control": "public, max-age=31536000, immutable"})


@app.post("/comments")
def add_comment(body: CommentCreate, me: str = Depends(current_user)):
    comment = {"id": f"c-{uuid.uuid4().hex[:12]}", "visitUserId": body.visit_user_id, "buildingId": body.place_id,
               "userId": me, "text": body.text.strip(), "createdAt": now()}
    conn = get_connection()
    try:
        conn.execute(
            "INSERT INTO comments (id, visit_user_id, place_id, user_id, text, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (comment["id"], body.visit_user_id, body.place_id, me, comment["text"], comment["createdAt"]),
        )
        conn.commit()
        return comment
    finally:
        conn.close()


@app.delete("/comments/{comment_id}")
def delete_comment(comment_id: str, me: str = Depends(current_user)):
    conn = get_connection()
    try:
        # The commenter, or the owner of the log it was left on, can remove a comment.
        conn.execute("DELETE FROM comments WHERE id = ? AND (user_id = ? OR visit_user_id = ?)", (comment_id, me, me))
        conn.commit()
        return {"ok": True}
    finally:
        conn.close()


# ---------- hearts on logs ----------

@app.post("/hearts")
def add_heart(body: HeartBody, me: str = Depends(current_user)):
    conn = get_connection()
    try:
        conn.execute(
            "INSERT INTO hearts (visit_user_id, place_id, user_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING",
            (body.visit_user_id, body.place_id, me, now()),
        )
        conn.commit()
        return {"ok": True}
    finally:
        conn.close()


@app.delete("/hearts")
def remove_heart(visit_user_id: str, place_id: str, me: str = Depends(current_user)):
    conn = get_connection()
    try:
        conn.execute("DELETE FROM hearts WHERE visit_user_id = ? AND place_id = ? AND user_id = ?", (visit_user_id, place_id, me))
        conn.commit()
        return {"ok": True}
    finally:
        conn.close()


# ---------- daily game ----------

@app.post("/game")
def post_game(body: GameResult, me: str = Depends(current_user)):
    conn = get_connection()
    try:
        # First result for a day stands: replaying can't improve a score.
        conn.execute(
            "INSERT INTO game_results (user_id, day, guesses, won, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING",
            (me, body.day, body.guesses, body.won, now()),
        )
        conn.commit()
        return {"ok": True}
    finally:
        conn.close()


# ---------- stories ----------
# Photo stories last 24 hours. /state lists them without the image (it's polled often);
# the app loads each photo from /stories/{id}/image, which browsers can cache for good.
STORY_TTL = timedelta(hours=24)


@app.post("/stories")
def create_story(body: StoryCreate, me: str = Depends(current_user)):
    require_self(me, body.user_id)
    if not body.image.startswith("data:image/"):
        raise HTTPException(400, "image must be a data URL")
    story = {"id": f"s-{uuid.uuid4().hex[:12]}", "userId": body.user_id, "buildingId": body.place_id,
             "caption": body.caption, "createdAt": now()}
    conn = get_connection()
    try:
        conn.execute(
            "INSERT INTO stories (id, user_id, place_id, image, caption, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (story["id"], body.user_id, body.place_id, body.image, body.caption, story["createdAt"]),
        )
        # Expired stories are never shown again, so clear them out as new ones arrive.
        conn.execute("DELETE FROM stories WHERE created_at < ?", ((datetime.now(timezone.utc) - STORY_TTL).isoformat(),))
        conn.commit()
        return story
    finally:
        conn.close()


@app.get("/stories/{story_id}/image")
def story_image(story_id: str):
    conn = get_connection()
    try:
        row = conn.execute("SELECT image FROM stories WHERE id = ?", (story_id,)).fetchone()
    finally:
        conn.close()
    if not row:
        raise HTTPException(404, "story not found")
    header, _, data = row["image"].partition(",")
    media = header[5:].split(";")[0] or "image/jpeg"
    return Response(base64.b64decode(data), media_type=media,
                    headers={"Cache-Control": "public, max-age=86400, immutable"})


@app.delete("/stories/{story_id}")
def delete_story(story_id: str, user_id: str, me: str = Depends(current_user)):
    require_self(me, user_id)
    conn = get_connection()
    try:
        conn.execute("DELETE FROM stories WHERE id = ? AND user_id = ?", (story_id, user_id))
        conn.commit()
        return {"ok": True}
    finally:
        conn.close()


@app.delete("/visits/{visit_id}")
def delete_visit(visit_id: str, me: str = Depends(current_user)):
    conn = get_connection()
    try:
        conn.execute("DELETE FROM visits WHERE id = ? AND user_id = ?", (visit_id, me))
        conn.commit()
        return {"ok": True}
    finally:
        conn.close()


@app.delete("/visits")
def delete_visit_by_place(user_id: str, place_id: str, me: str = Depends(current_user)):
    require_self(me, user_id)
    conn = get_connection()
    try:
        conn.execute(
            "DELETE FROM visits WHERE user_id = ? AND place_id = ?",
            (user_id, place_id),
        )
        conn.commit()
        return {"ok": True}
    finally:
        conn.close()


# ---------- feed ----------

@app.get("/feed", response_model=list[Visit])
def feed(user_id: str, limit: int = 50):
    conn = get_connection()
    try:
        rows = conn.execute(
            """SELECT v.* FROM visits v
               WHERE v.user_id IN (
                   SELECT followee_id FROM follows WHERE follower_id = ?
               )
               ORDER BY v.created_at DESC
               LIMIT ?""",
            (user_id, limit),
        ).fetchall()
        return [row_to_visit(r) for r in rows]
    finally:
        conn.close()


# ---------- follows ----------

@app.post("/follows")
def follow(body: FollowCreate, me: str = Depends(current_user)):
    require_self(me, body.follower_id)
    conn = get_connection()
    try:
        conn.execute(
            "INSERT INTO follows (follower_id, followee_id) VALUES (?, ?) ON CONFLICT DO NOTHING",
            (body.follower_id, body.followee_id),
        )
        conn.commit()
        return {"ok": True}
    finally:
        conn.close()


@app.delete("/follows")
def unfollow(follower_id: str, followee_id: str, me: str = Depends(current_user)):
    require_self(me, follower_id)
    conn = get_connection()
    try:
        conn.execute(
            "DELETE FROM follows WHERE follower_id = ? AND followee_id = ?",
            (follower_id, followee_id),
        )
        conn.commit()
        return {"ok": True}
    finally:
        conn.close()


# ---------- want to visit ----------

@app.get("/want")
def list_want(user_id: str):
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT place_id, created_at FROM want_to_visit WHERE user_id = ?",
            (user_id,),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


@app.post("/want")
def add_want(body: WantCreate, me: str = Depends(current_user)):
    require_self(me, body.user_id)
    conn = get_connection()
    try:
        conn.execute(
            "INSERT INTO want_to_visit (user_id, place_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
            (body.user_id, body.place_id, now()),
        )
        conn.commit()
        return {"ok": True}
    finally:
        conn.close()


@app.delete("/want")
def remove_want(user_id: str, place_id: str, me: str = Depends(current_user)):
    require_self(me, user_id)
    conn = get_connection()
    try:
        conn.execute(
            "DELETE FROM want_to_visit WHERE user_id = ? AND place_id = ?",
            (user_id, place_id),
        )
        conn.commit()
        return {"ok": True}
    finally:
        conn.close()


# ---------- lists ----------

@app.get("/lists")
def list_lists(user_id: str):
    conn = get_connection()
    try:
        rows = conn.execute(
            """SELECT DISTINCT l.* FROM lists l
               LEFT JOIN list_members m ON m.list_id = l.id
               WHERE l.owner_id = ? OR m.user_id = ?""",
            (user_id, user_id),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


@app.post("/lists")
def create_list(body: ListCreate, me: str = Depends(current_user)):
    require_self(me, body.owner_id)
    conn = get_connection()
    try:
        list_id = body.id or f"l-{uuid.uuid4().hex[:8]}"
        created = now()
        conn.execute(
            "INSERT INTO lists (id, name, owner_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING",
            (list_id, body.name, body.owner_id, created),
        )
        conn.execute(
            "INSERT INTO list_members (list_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING",
            (list_id, body.owner_id),
        )
        conn.commit()
        return {"id": list_id, "name": body.name, "owner_id": body.owner_id, "created_at": created}
    finally:
        conn.close()


@app.post("/lists/{list_id}/items")
def add_list_item(list_id: str, body: ListItemCreate, me: str = Depends(current_user)):
    require_self(me, body.added_by)
    require_member(list_id, me)
    conn = get_connection()
    try:
        conn.execute(
            "INSERT INTO list_items (list_id, place_id, added_by, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING",
            (list_id, body.place_id, body.added_by, now()),
        )
        conn.commit()
        return {"ok": True}
    finally:
        conn.close()


@app.get("/lists/{list_id}/items")
def get_list_items(list_id: str):
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM list_items WHERE list_id = ?", (list_id,)
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


@app.delete("/lists/{list_id}/items")
def delete_list_item(list_id: str, place_id: str, me: str = Depends(current_user)):
    require_member(list_id, me)
    conn = get_connection()
    try:
        conn.execute(
            "DELETE FROM list_items WHERE list_id = ? AND place_id = ?",
            (list_id, place_id),
        )
        conn.commit()
        return {"ok": True}
    finally:
        conn.close()


# ---------- bulk state (frontend bootstrap) ----------

@app.get("/state")
def get_state(authorization: str | None = Header(default=None)):
    """Full dump shaped to match the frontend's in-memory `state` object
    (see app/app.js), so a fresh browser can hydrate straight from it
    instead of reseeding its own independent copy of app/data.js."""
    conn = get_connection()
    try:
        users = [_public(r) for r in conn.execute("SELECT * FROM users").fetchall()]
        places = []
        for p in conn.execute("SELECT * FROM places").fetchall():
            place = dict(p)
            place["addedBy"] = place.pop("added_by")
            place["createdAt"] = place.pop("created_at")
            places.append(place)
        visits = [
            {
                "id": v["id"], "userId": v["user_id"], "buildingId": v["place_id"],
                "stars": v["stars"], "note": v["note"],
                "likes": json.loads(v["likes"]) if v["likes"] else [],
                "photos": json.loads(v["photos"]) if v["photos"] else [],
                "visitedOn": v["visited_on"], "createdAt": v["created_at"],
            }
            for v in conn.execute("SELECT * FROM visits").fetchall()
        ]
        follows = [
            [f["follower_id"], f["followee_id"]]
            for f in conn.execute("SELECT * FROM follows").fetchall()
        ]
        want = [
            {"userId": w["user_id"], "buildingId": w["place_id"], "createdAt": w["created_at"]}
            for w in conn.execute("SELECT * FROM want_to_visit").fetchall()
        ]
        lists = []
        for l in conn.execute("SELECT * FROM lists").fetchall():
            members = [
                m["user_id"] for m in conn.execute(
                    "SELECT user_id FROM list_members WHERE list_id = ?", (l["id"],)
                ).fetchall()
            ]
            items = [
                {"buildingId": it["place_id"], "addedBy": it["added_by"], "createdAt": it["created_at"]}
                for it in conn.execute(
                    "SELECT * FROM list_items WHERE list_id = ?", (l["id"],)
                ).fetchall()
            ]
            lists.append({
                "id": l["id"], "name": l["name"], "ownerId": l["owner_id"],
                "members": members, "items": items, "createdAt": l["created_at"],
            })
        since = (datetime.now(timezone.utc) - STORY_TTL).isoformat()
        stories = [
            {"id": s["id"], "userId": s["user_id"], "buildingId": s["place_id"],
             "caption": s["caption"], "createdAt": s["created_at"]}
            for s in conn.execute(
                "SELECT id, user_id, place_id, caption, created_at FROM stories WHERE created_at >= ? ORDER BY created_at",
                (since,),
            ).fetchall()
        ]
        out = {
            "users": users, "places": places, "visits": visits,
            "follows": follows, "want": want, "lists": lists, "stories": stories,
            "hearts": [
                {"visitUserId": h["visit_user_id"], "buildingId": h["place_id"], "userId": h["user_id"], "createdAt": h["created_at"]}
                for h in conn.execute("SELECT * FROM hearts").fetchall()
            ],
            "game": [
                {"userId": g["user_id"], "day": g["day"], "guesses": g["guesses"], "won": bool(g["won"])}
                for g in conn.execute("SELECT * FROM game_results ORDER BY day DESC LIMIT 2000").fetchall()
            ],
            "comments": [
                {"id": c["id"], "visitUserId": c["visit_user_id"], "buildingId": c["place_id"],
                 "userId": c["user_id"], "text": c["text"], "createdAt": c["created_at"]}
                for c in conn.execute("SELECT * FROM comments ORDER BY created_at").fetchall()
            ],
        }
        # Private accounts: only they and their followers see their logs, lists and activity.
        me = optional_user(authorization)
        allowed = {f[1] for f in follows if f[0] == me}
        hidden = {u["id"] for u in users if u["private"] and u["id"] != me and u["id"] not in allowed}
        if hidden:
            out["visits"] = [v for v in out["visits"] if v["userId"] not in hidden]
            out["want"] = [w for w in out["want"] if w["userId"] not in hidden]
            out["stories"] = [x for x in out["stories"] if x["userId"] not in hidden]
            out["game"] = [g for g in out["game"] if g["userId"] not in hidden]
            out["comments"] = [c for c in out["comments"] if c["visitUserId"] not in hidden]
            out["hearts"] = [h for h in out["hearts"] if h["visitUserId"] not in hidden]
            out["lists"] = [l for l in out["lists"] if l["ownerId"] not in hidden or me in l["members"]]
        return out
    finally:
        conn.close()
