from typing import Optional
from pydantic import BaseModel, Field


class User(BaseModel):
    id: str
    handle: str
    name: str
    bio: Optional[str] = None


class UserCreate(BaseModel):
    id: Optional[str] = None
    handle: str
    name: str
    bio: Optional[str] = None


class UserUpdate(BaseModel):
    handle: Optional[str] = None
    name: Optional[str] = None
    bio: Optional[str] = None
    private: Optional[bool] = None


class Place(BaseModel):
    id: str
    kind: str = "building"
    name: str
    architect: Optional[str] = None
    year: Optional[int] = None
    typology: Optional[str] = None
    style: Optional[str] = None
    city: Optional[str] = None
    country: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    address: Optional[str] = None
    osm: Optional[str] = None
    qid: Optional[str] = None
    image: Optional[str] = None
    credit: Optional[str] = None
    blurb: Optional[str] = None
    wiki: Optional[str] = None
    source: str = "user"
    added_by: Optional[str] = None
    created_at: Optional[str] = None


class PlaceCreate(BaseModel):
    id: Optional[str] = None
    kind: str = "building"
    name: str
    architect: Optional[str] = None
    year: Optional[int] = None
    typology: Optional[str] = None
    style: Optional[str] = None
    city: Optional[str] = None
    country: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    address: Optional[str] = None
    osm: Optional[str] = None
    qid: Optional[str] = None
    image: Optional[str] = None
    wiki: Optional[str] = None
    added_by: Optional[str] = None


class Visit(BaseModel):
    id: str
    user_id: str
    place_id: str
    stars: int
    note: Optional[str] = None
    likes: list[str] = []
    photos: list[str] = []
    visited_on: Optional[str] = None
    created_at: str


class VisitCreate(BaseModel):
    user_id: str
    place_id: str
    stars: int
    note: Optional[str] = None
    likes: list[str] = []
    # Photo paths from POST /photos ("/photos/<id>") or https image URLs; at most 4.
    photos: list[str] = Field(default=[], max_length=4)
    visited_on: Optional[str] = None


class FollowCreate(BaseModel):
    follower_id: str
    followee_id: str


class WantCreate(BaseModel):
    user_id: str
    place_id: str


class ListCreate(BaseModel):
    id: Optional[str] = None
    name: str
    owner_id: str


class ListItemCreate(BaseModel):
    place_id: str
    added_by: str


class StateDump(BaseModel):
    users: list[dict]
    places: list[dict]
    visits: list[dict]
    follows: list[list[str]]
    want: list[dict]
    lists: list[dict]


class StoryCreate(BaseModel):
    user_id: str
    place_id: Optional[str] = None
    # A JPEG data URL, already downscaled by the app; capped so one post can't bloat the database.
    image: str = Field(max_length=1_500_000)
    caption: Optional[str] = Field(default=None, max_length=200)


class SignupBody(BaseModel):
    id: Optional[str] = Field(default=None, pattern=r"^u-[a-z0-9]{4,20}$")
    handle: str = Field(pattern=r"^[a-z0-9._]{2,20}$")
    name: str = Field(min_length=1, max_length=60)
    password: str = Field(min_length=8, max_length=200)


class LoginBody(BaseModel):
    handle: str
    password: str = Field(max_length=200)


class PhotoCreate(BaseModel):
    place_id: str
    image: str = Field(max_length=1_500_000)


class CommentCreate(BaseModel):
    visit_user_id: str
    place_id: str
    text: str = Field(min_length=1, max_length=500)


class GameResult(BaseModel):
    day: int = Field(ge=1, le=100000)
    guesses: int = Field(ge=1, le=5)
    won: bool


class HeartBody(BaseModel):
    visit_user_id: str
    place_id: str


class PasswordChange(BaseModel):
    old_password: str = Field(max_length=200)
    new_password: str = Field(min_length=8, max_length=200)


class AccountDelete(BaseModel):
    password: str = Field(max_length=200)
