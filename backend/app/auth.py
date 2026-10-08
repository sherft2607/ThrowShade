"""Accounts: handle + password, with bearer-token sessions.

Passwords are hashed with scrypt (standard library). Session tokens are random and only their
SHA-256 is stored, so a database leak doesn't hand out live sessions.
"""
import hashlib
import hmac
import secrets

from fastapi import Header, HTTPException

from .db import get_connection

SCRYPT = {"n": 2 ** 14, "r": 8, "p": 1, "dklen": 32}


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, **SCRYPT)
    return f"scrypt${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, salt, digest = stored.split("$")
        check = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), **SCRYPT)
        return hmac.compare_digest(check.hex(), digest)
    except (ValueError, TypeError):
        return False


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def new_session(conn, user_id: str, created_at: str) -> str:
    token = secrets.token_urlsafe(32)
    conn.execute(
        "INSERT INTO sessions (token_hash, user_id, created_at) VALUES (?, ?, ?)",
        (_token_hash(token), user_id, created_at),
    )
    return token


def end_session(conn, token: str) -> None:
    conn.execute("DELETE FROM sessions WHERE token_hash = ?", (_token_hash(token),))


def bearer(authorization: str | None) -> str:
    token = (authorization or "").removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(status_code=401, detail="sign in required")
    return token


def current_user(authorization: str | None = Header(default=None)) -> str:
    """FastAPI dependency: the signed-in user's id, or 401."""
    token = bearer(authorization)
    conn = get_connection()
    try:
        row = conn.execute("SELECT user_id FROM sessions WHERE token_hash = ?", (_token_hash(token),)).fetchone()
    finally:
        conn.close()
    if not row:
        raise HTTPException(status_code=401, detail="session expired, sign in again")
    return row["user_id"]


def optional_user(authorization: str | None) -> str | None:
    """The signed-in user's id if a valid token was sent, else None (never raises)."""
    token = (authorization or "").removeprefix("Bearer ").strip()
    if not token:
        return None
    conn = get_connection()
    try:
        row = conn.execute("SELECT user_id FROM sessions WHERE token_hash = ?", (_token_hash(token),)).fetchone()
    finally:
        conn.close()
    return row["user_id"] if row else None


def require_self(me: str, user_id: str | None) -> None:
    if user_id != me:
        raise HTTPException(status_code=403, detail="you can only change your own account")
