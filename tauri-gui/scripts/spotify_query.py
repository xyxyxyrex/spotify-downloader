"""Resolve Spotify URLs and search terms via spotDL."""

import json
import os
import re
import sys
from html.parser import HTMLParser
from pathlib import Path
from typing import Optional

# Allow importing spotdl from repo root when not installed
ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Add scripts directory for metadata_utils
sys.path.insert(0, str(Path(__file__).parent.resolve()))
import metadata_utils


def _spotdl_path() -> Path:
    """Match spotDL's config path without importing its heavyweight package root."""
    if sys.platform.startswith("linux"):
        xdg_path = Path.home() / ".config" / "spotdl"
        legacy_path = Path.home() / ".spotdl"
        if xdg_path.exists() or not legacy_path.exists():
            xdg_path.mkdir(parents=True, exist_ok=True)
            return xdg_path
        return legacy_path

    path = Path.home() / ".spotdl"
    path.mkdir(parents=True, exist_ok=True)
    return path


def song_to_dict(song) -> dict:
    cleaned_album = metadata_utils.clean_album_name(
        song.album_name or "", song.artist or "", song.name or ""
    )
    return {
        "title": song.name,
        "artist": song.artist,
        "artists": song.artists,
        "album": cleaned_album,
        "image": song.cover_url,
        "duration": song.duration,
        "spotify_url": song.url,
        "popularity": song.popularity,
        "track_number": song.track_number,
        "list_name": song.list_name,
        "list_position": song.list_position,
    }


def playlist_result(playlist) -> dict:
    return {
        "type": "playlist",
        "name": playlist.name,
        "url": playlist.url,
        "description": playlist.description,
        "author": playlist.author_name,
        "cover_url": playlist.cover_url,
        "tracks": [song_to_dict(s) for s in playlist.songs],
    }


def _artist_name(artist_field) -> str:
    if isinstance(artist_field, dict):
        return artist_field.get("name", "")
    return str(artist_field or "")


def _cover_from_album(album) -> Optional[str]:
    if getattr(album, "cover_url", None):
        return album.cover_url
    for song in getattr(album, "songs", None) or []:
        if getattr(song, "cover_url", None):
            return song.cover_url
    return None


def album_summary_from_url(url: str) -> dict:
    """Lightweight album metadata for artist discography grids."""
    from spotdl.utils.spotify import SpotifyClient

    client = SpotifyClient()
    meta = client.album(url)
    if not meta:
        raise ValueError(f"Could not load album: {url}")

    images = meta.get("images") or []
    cover = None
    if images:
        cover = max(
            images,
            key=lambda i: i.get("width", 0) * i.get("height", 0),
        )["url"]

    artist_name = meta["artists"][0]["name"] if meta.get("artists") else ""
    cleaned_name = metadata_utils.clean_album_name(meta["name"], artist_name)

    return {
        "type": "album",
        "name": cleaned_name,
        "url": url,
        "artist": artist_name,
        "cover_url": cover,
        "tracks": [],
    }


def album_result(album) -> dict:
    if isinstance(album, str):
        return album_summary_from_url(album)

    artist_name = _artist_name(album.artist)
    cleaned_name = metadata_utils.clean_album_name(album.name, artist_name)

    return {
        "type": "album",
        "name": cleaned_name,
        "url": album.url,
        "artist": artist_name,
        "cover_url": _cover_from_album(album),
        "tracks": [song_to_dict(s) for s in album.songs],
    }


def artist_result(artist) -> dict:
    # spotDL stores artist.albums as Spotify album URLs (strings), not Album objects.
    albums_out = []
    for entry in getattr(artist, "albums", None) or []:
        try:
            if isinstance(entry, str):
                albums_out.append(album_summary_from_url(entry))
            else:
                albums_out.append(album_result(entry))
        except Exception:
            continue

    tracks = list(getattr(artist, "songs", None) or [])
    tracks.sort(key=lambda s: getattr(s, "popularity", None) or 0, reverse=True)
    top_tracks = tracks[:12]

    return {
        "type": "artist",
        "name": artist.name,
        "url": artist.url,
        "genres": getattr(artist, "genres", []),
        "albums": albums_out,
        "tracks": [song_to_dict(s) for s in top_tracks],
    }


def _normalize(text: str) -> str:
    text = (text or "").lower()
    text = re.sub(r"[^\w\s]", " ", text)
    return " ".join(text.split())


def _relevance(query: str, candidate: str) -> float:
    q = _normalize(query)
    c = _normalize(candidate)
    if not q or not c:
        return 0.0
    if c == q:
        return 100.0
    if c.startswith(q) or (
        q.startswith(c) and (len(q) == len(c) or q[len(c)].isspace())
    ):
        return 88.0
    if q in c:
        return 72.0
    q_parts = q.split()
    if len(q_parts) > 1 and all(part in c for part in q_parts):
        return 58.0
    c_words = set(c.split())
    overlap = sum(1 for part in q_parts if part in c_words or part in c)
    if q_parts:
        return 25.0 + (overlap / len(q_parts)) * 35.0
    return 0.0


def _score_track(query: str, track: dict) -> float:
    title = track.get("title") or track.get("name") or ""
    artist = track.get("artist") or ""
    album = track.get("album") or ""

    is_non_ascii = bool(re.search(r"[^\x00-\x7F]", title + artist + album))

    base_score = max(
        _relevance(query, title),
        _relevance(query, f"{title} {artist}") * 0.92,
        _relevance(query, album) * 0.72,
    )

    # Raw string matching boost for special characters (like $$$, symbols, etc.)
    raw_query = query.lower().strip()
    raw_title = title.lower().strip()
    raw_artist = artist.lower().strip()

    # Remove common feat/with suffixes from candidate title for cleaner comparison
    clean_title = raw_title.split(" - ")[0].split(" (")[0].split(" [")[0].strip()

    if clean_title and raw_artist:
        # Check if both clean title and artist are present in the query
        if clean_title in raw_query and raw_artist in raw_query:
            base_score = max(base_score, 95.0)
        # Check if the query itself is present in the title + artist
        elif raw_query in f"{clean_title} {raw_artist}":
            base_score = max(base_score, 93.0)

    if is_non_ascii and base_score < 50.0:
        orig_idx = track.get("original_index", 100)
        boost = max(0.0, 85.0 - orig_idx * 5.0)
        return max(base_score, boost)

    return base_score


def _score_album(query: str, album: dict) -> float:
    name = album.get("name") or ""
    artist = album.get("artist") or ""

    is_non_ascii = bool(re.search(r"[^\x00-\x7F]", name + artist))

    base_score = max(
        _relevance(query, name),
        _relevance(query, f"{name} {artist}") * 0.9,
    )

    if is_non_ascii and base_score < 50.0:
        orig_idx = album.get("original_index", 100)
        boost = max(0.0, 85.0 - orig_idx * 5.0)
        return max(base_score, boost)

    return base_score


def _score_artist(query: str, artist: dict) -> float:
    name = artist.get("name") or ""
    is_non_ascii = bool(re.search(r"[^\x00-\x7F]", name))

    base_score = _relevance(query, name)

    if is_non_ascii and base_score < 50.0:
        orig_idx = artist.get("original_index", 100)
        boost = max(0.0, 85.0 - orig_idx * 5.0)
        return max(base_score, boost)

    return base_score


def _pick_primary_section(
    query: str,
    tracks: list,
    albums: list,
    artists: list,
) -> str:
    norm_query = query.strip().lower()
    # Prioritize albums section if an exact case-insensitive name match is found
    if any((a.get("name") or "").strip().lower() == norm_query for a in albums):
        return "albums"

    top_t = tracks[0]["match_score"] if tracks else 0.0
    top_a = albums[0]["match_score"] if albums else 0.0
    top_ar = artists[0]["match_score"] if artists else 0.0
    q_words = _normalize(query).split()

    if top_ar >= 88 and top_ar >= top_t + 4 and top_ar >= top_a + 4:
        return "artists"
    if top_a >= 72 and top_a >= top_t - 2 and top_a >= top_ar - 2:
        return "albums"
    if top_t >= top_a and top_t >= top_ar:
        return "tracks"
    if top_ar >= top_a and top_ar >= top_t:
        return "artists"
    if top_a >= top_t:
        return "albums"
    return "tracks"


def resolve_track_numbers(spotify, tracks: list) -> None:
    album_cache = {}
    for track in tracks[:5]:
        track_id = track.get("id") or track.get("track_id")
        album_id = track.get("album_id")

        if not album_id or not track_id:
            continue

        if album_id not in album_cache:
            try:
                res = spotify.album_tracks(album_id)
                items = res.get("tracks", []) or res.get("items", [])
                album_cache[album_id] = {
                    t.get("id"): t.get("track_number") for t in items if t.get("id")
                }
            except Exception:
                album_cache[album_id] = {}

        if track_id in album_cache[album_id]:
            track["track_number"] = album_cache[album_id][track_id]


def _finalize_search_results(
    spotify,
    query: str,
    tracks: list,
    albums: list,
    artists: list,
) -> dict:
    for i, track in enumerate(tracks):
        track["original_index"] = i
    for i, album in enumerate(albums):
        album["original_index"] = i
    for i, artist in enumerate(artists):
        artist["original_index"] = i

    for track in tracks:
        track["match_score"] = _score_track(query, track)
    for album in albums:
        album["match_score"] = _score_album(query, album)
    for artist in artists:
        artist["match_score"] = _score_artist(query, artist)

    tracks.sort(key=lambda x: x["match_score"], reverse=True)
    resolve_track_numbers(spotify, tracks)

    albums.sort(key=lambda x: x["match_score"], reverse=True)
    artists.sort(key=lambda x: x["match_score"], reverse=True)

    primary = _pick_primary_section(query, tracks, albums, artists)
    section_order = [primary] + [
        s for s in ("tracks", "albums", "artists") if s != primary
    ]

    for items in (tracks, albums, artists):
        for item in items:
            item.pop("match_score", None)
            item.pop("original_index", None)

    return {
        "type": "search_results",
        "tracks": tracks[:25],
        "albums": albums[:10],
        "artists": artists[:10],
        "section_order": section_order,
        "primary_section": primary,
    }


def raw_track_to_dict(item: dict) -> dict:
    artists_list = [a["name"] for a in item.get("artists", [])]
    main_artist = artists_list[0] if artists_list else ""

    # cover URL
    images = item.get("album", {}).get("images") or []
    cover_url = ""
    if images:
        best_img = max(images, key=lambda i: i.get("width", 0) * i.get("height", 0))
        cover_url = best_img.get("url") or ""

    duration_s = (item.get("duration_ms") or 0) / 1000.0
    spotify_url = (
        item.get("external_urls", {}).get("spotify")
        or f"https://open.spotify.com/track/{item.get('id')}"
    )

    album_name = item.get("album", {}).get("name") or ""
    cleaned_album = metadata_utils.clean_album_name(
        album_name, main_artist, item.get("name") or ""
    )

    return {
        "title": item.get("name") or "",
        "artist": main_artist,
        "artists": artists_list,
        "album": cleaned_album,
        "image": cover_url,
        "duration": duration_s,
        "spotify_url": spotify_url,
        "popularity": item.get("popularity"),
        "track_number": item.get("track_number"),
        "list_name": None,
        "list_position": None,
        "id": item.get("id"),
        "album_id": item.get("album", {}).get("id"),
    }


def _search_spotify_catalog(spotify, query: str) -> dict:
    """Tracks, albums, and artists for a free-text query."""

    tracks: list = []
    raw_tracks: list = []
    try:
        track_res = spotify.search(query, type="track", limit=15)
        raw_tracks = (track_res or {}).get("tracks", {}).get("items", [])
        tracks = [raw_track_to_dict(t) for t in raw_tracks]
    except Exception as e:
        print(f"Warning: Track search failed ({e}).", file=sys.stderr)

    albums: list = []
    artists: list = []

    try:
        album_res = spotify.search(query, type="album", limit=10)
        for item in (album_res or {}).get("albums", {}).get("items", []):
            albums.append(
                {
                    "name": item["name"],
                    "artist": item["artists"][0]["name"] if item.get("artists") else "",
                    "url": item["external_urls"]["spotify"],
                    "id": item["id"],
                    "image": item["images"][0]["url"] if item.get("images") else "",
                    "release_date": item.get("release_date") or "",
                }
            )
    except Exception:
        pass

    try:
        artist_res = spotify.search(query, type="artist", limit=10)
        for item in (artist_res or {}).get("artists", {}).get("items", []):
            artists.append(
                {
                    "name": item["name"],
                    "url": item["external_urls"]["spotify"],
                    "id": item["id"],
                    "image": item["images"][0]["url"] if item.get("images") else "",
                    "followers": (
                        item["followers"]["total"] if "followers" in item else 0
                    ),
                }
            )
    except Exception:
        pass

    # Extract albums and artists from raw track search results as a robust fallback/merge
    seen_albums = {alb["id"] for alb in albums if alb.get("id")}
    for item in raw_tracks:
        album_data = item.get("album")
        if not album_data or not album_data.get("id"):
            continue
        alb_id = album_data["id"]
        if alb_id in seen_albums:
            continue
        seen_albums.add(alb_id)

        alb_artists = album_data.get("artists") or []
        alb_artist = (
            alb_artists[0]["name"]
            if alb_artists
            else (item.get("artists", [{}])[0].get("name") or "")
        )

        images = album_data.get("images") or []
        cover_url = ""
        if images:
            best_img = max(images, key=lambda i: i.get("width", 0) * i.get("height", 0))
            cover_url = best_img.get("url") or ""

        albums.append(
            {
                "name": album_data.get("name") or "",
                "artist": alb_artist,
                "url": album_data.get("external_urls", {}).get("spotify")
                or f"https://open.spotify.com/album/{alb_id}",
                "id": alb_id,
                "image": cover_url,
                "release_date": album_data.get("release_date") or "",
            }
        )

    seen_artists = {art["id"] for art in artists if art.get("id")}
    for item in raw_tracks:
        for artist_data in item.get("artists") or []:
            art_id = artist_data.get("id")
            if not art_id or art_id in seen_artists:
                continue
            seen_artists.add(art_id)

            artists.append(
                {
                    "name": artist_data["name"],
                    "url": artist_data.get("external_urls", {}).get("spotify")
                    or f"https://open.spotify.com/artist/{art_id}",
                    "id": art_id,
                    "image": "",
                    "followers": 0,
                }
            )

    return _finalize_search_results(spotify, query, tracks, albums, artists)


def _get_direct_spotify_token() -> str:
    import base64
    import urllib.error
    import urllib.parse
    import urllib.request

    client_id = os.environ.get("SPOTIFY_CLIENT_ID", "").strip()
    client_secret = os.environ.get("SPOTIFY_CLIENT_SECRET", "").strip()
    if not client_id or not client_secret:
        raise ValueError(
            "Spotify Client ID and Secret are required to fetch user playlists."
        )

    auth_str = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
    token_req = urllib.request.Request(
        "https://accounts.spotify.com/api/token",
        data=urllib.parse.urlencode({"grant_type": "client_credentials"}).encode(),
        headers={
            "Authorization": f"Basic {auth_str}",
            "Content-Type": "application/x-www-form-urlencoded",
        },
    )
    with urllib.request.urlopen(token_req) as resp:
        token_data = json.loads(resp.read())
    return token_data["access_token"]


class _SpotifyProfileParser(HTMLParser):
    """Extract the public playlist cards rendered on a Spotify profile page."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.page_title = ""
        self.playlists: list[dict] = []
        self._in_title = False
        self._title_complete = False
        self._playlist_id: Optional[str] = None
        self._playlist_image = ""
        self._playlist_text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, Optional[str]]]) -> None:
        attributes = dict(attrs)
        if tag == "title" and not self._title_complete:
            self._in_title = True
            return

        if tag == "a" and self._playlist_id is None:
            href = attributes.get("href") or ""
            match = re.fullmatch(r"/playlist/([A-Za-z0-9]+)", href)
            if match:
                self._playlist_id = match.group(1)
                self._playlist_image = ""
                self._playlist_text = []
            return

        if tag == "img" and self._playlist_id and not self._playlist_image:
            self._playlist_image = attributes.get("src") or ""

    def handle_data(self, data: str) -> None:
        text = " ".join(data.split())
        if not text:
            return
        if self._in_title:
            self.page_title += text
        if self._playlist_id:
            self._playlist_text.append(text)

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False
            self._title_complete = True
            return
        if tag != "a" or not self._playlist_id:
            return

        name = self._playlist_text[0] if self._playlist_text else "Untitled playlist"
        self.playlists.append(
            {
                "id": self._playlist_id,
                "name": name,
                "url": f"https://open.spotify.com/playlist/{self._playlist_id}",
                "image": self._playlist_image,
                # Spotify's public profile page no longer exposes track totals.
                "tracks_total": None,
            }
        )
        self._playlist_id = None
        self._playlist_image = ""
        self._playlist_text = []


def _fetch_user_playlists_web(user_id: str) -> dict:
    """Fetch public playlists from the profile page.

    Spotify removed GET /users/{id}/playlists in February 2026. The public
    profile page remains available without user OAuth and renders the public
    playlist cards in its HTML.
    """
    import urllib.error
    import urllib.parse
    import urllib.request

    normalized_user_id = user_id.strip()
    if not normalized_user_id or not re.fullmatch(
        r"[A-Za-z0-9._-]+", normalized_user_id
    ):
        raise ValueError("Enter a valid Spotify profile URL or username.")

    profile_url = (
        "https://open.spotify.com/user/"
        f"{urllib.parse.quote(normalized_user_id, safe='')}"
    )
    request = urllib.request.Request(
        profile_url,
        headers={
            "Accept": "text/html,application/xhtml+xml",
            "Accept-Language": "en-US,en;q=0.9",
            # A minimal browser UA requests Spotify's server-rendered profile.
            # A full desktop Chrome UA currently returns only the Web Player shell.
            "User-Agent": "Mozilla/5.0",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            html = response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            raise ValueError(
                "Spotify user profile not found. Check the profile URL and try again."
            ) from exc
        raise ValueError(f"Spotify profile request failed (HTTP {exc.code}).") from exc
    except urllib.error.URLError as exc:
        reason = getattr(exc, "reason", exc)
        raise ValueError(f"Could not connect to Spotify: {reason}") from exc

    parser = _SpotifyProfileParser()
    parser.feed(html)

    owner = re.sub(r"\s+on Spotify\s*$", "", parser.page_title).strip()
    if not owner:
        owner = normalized_user_id

    seen: set[str] = set()
    playlists = []
    for playlist in parser.playlists:
        if playlist["id"] in seen:
            continue
        seen.add(playlist["id"])
        playlist["owner"] = owner
        playlists.append(playlist)

    return {"type": "user_playlists", "playlists": playlists}


def _fetch_playlist_direct(playlist_id: str) -> dict:
    """Fetch playlist metadata and all tracks using direct Spotify Web API."""
    import urllib.parse
    import urllib.request

    access_token = _get_direct_spotify_token()

    # Fetch playlist metadata
    meta_url = f"https://api.spotify.com/v1/playlists/{urllib.parse.quote(playlist_id)}"
    meta_req = urllib.request.Request(
        meta_url,
        headers={"Authorization": f"Bearer {access_token}"},
    )
    with urllib.request.urlopen(meta_req) as resp:
        meta_data = json.loads(resp.read())

    # Paginate through tracks
    all_tracks = []
    next_url = meta_data["tracks"]["href"]

    while next_url and len(all_tracks) < 1500:  # Safety limit
        req = urllib.request.Request(
            next_url, headers={"Authorization": f"Bearer {access_token}"}
        )
        with urllib.request.urlopen(req) as resp:
            page = json.loads(resp.read())

        for item in page.get("items", []):
            t = item.get("track")
            if not t or not t.get("id"):
                continue

            artist_name = (
                t["artists"][0]["name"] if t.get("artists") else "Unknown Artist"
            )
            album_name = t.get("album", {}).get("name", "Unknown Album")
            album_art = ""
            if t.get("album", {}).get("images"):
                album_art = t["album"]["images"][0]["url"]

            all_tracks.append(
                {
                    "url": t.get("external_urls", {}).get(
                        "spotify", f"https://open.spotify.com/track/{t['id']}"
                    ),
                    "title": t["name"],
                    "artist": artist_name,
                    "album": album_name,
                    "album_art": album_art,
                    "duration": t.get("duration_ms", 0) / 1000.0,
                }
            )

        next_url = page.get("next")

    return {
        "type": "playlist",
        "url": meta_data.get("external_urls", {}).get(
            "spotify", f"https://open.spotify.com/playlist/{playlist_id}"
        ),
        "name": meta_data["name"],
        "author": meta_data.get("owner", {}).get("display_name")
        or meta_data.get("owner", {}).get("id")
        or "",
        "tracks": all_tracks,
    }


def check_credentials_cached() -> bool:
    """Return True if credentials are known to be broken (403)."""
    import time

    status_file = _spotdl_path() / ".spotify_api_status"
    if status_file.exists():
        try:
            with open(status_file, "r") as f:
                data = json.load(f)
            if data.get("status") == "broken":
                # Only trust it if it's less than 6 hours old (in case user upgraded/fixed)
                if time.time() - data.get("timestamp", 0) < 21600:
                    return True
        except Exception:
            pass
    return False


def mark_credentials_broken() -> None:
    import time

    spotdl_path = _spotdl_path()
    status_file = spotdl_path / ".spotify_api_status"
    try:
        spotdl_path.mkdir(parents=True, exist_ok=True)
        with open(status_file, "w") as f:
            json.dump({"status": "broken", "timestamp": time.time()}, f)
    except Exception:
        pass


def fallback_to_free(e: Exception) -> None:
    from spotdl.utils.spotify import SpotifyClient

    print(
        f"Warning: Spotify API call failed ({e}). Falling back to SpotipyFree.",
        file=sys.stderr,
    )
    err_msg = str(e).lower()
    if (
        "403" in err_msg
        or "forbidden" in err_msg
        or "subscription" in err_msg
        or "premium" in err_msg
    ):
        mark_credentials_broken()

    SpotifyClient._instance = None
    SpotifyClient.init(
        "", "", user_auth=False, use_cache_file=False, use_official_api=False
    )


def init_spotify() -> None:
    from spotdl.utils.spotify import SpotifyClient

    # Force use of SpotipyFree (completely free and out-of-the-box, no credentials needed)
    SpotifyClient.init(
        "", "", user_auth=False, use_cache_file=False, use_official_api=False
    )


def resolve_clean_track_metadata(spotify, artist_name: str, track_name: str) -> dict:
    search_query = f'track:"{track_name}" artist:"{artist_name}"'
    try:
        res = spotify.search(search_query, type="track", limit=15)
        items = (res or {}).get("tracks", {}).get("items", [])
    except Exception as e:
        print(f"Spotify search failed: {e}", file=sys.stderr)
        items = []

    best_item = None
    if items:
        # First check if any item is on a studio album
        for item in items:
            album_data = item.get("album") or {}
            if album_data.get("album_type") == "album":
                s_name = item.get("name") or ""
                s_artists = item.get("artists") or []
                s_artist = s_artists[0].get("name") if s_artists else ""
                if (
                    s_name.lower().strip() == track_name.lower().strip()
                    and s_artist.lower().strip() == artist_name.lower().strip()
                ):
                    best_item = item
                    break
        if not best_item:
            best_item = items[0]

    if best_item:
        album_data = best_item.get("album") or {}
        album_name = album_data.get("name") or ""
        images = album_data.get("images") or []
        cover_url = images[0].get("url") if images else ""
        cleaned_album = metadata_utils.clean_album_name(
            album_name, artist_name, track_name
        )

        artists_list = [a["name"] for a in best_item.get("artists", [])]

        return {
            "type": "track_metadata",
            "title": best_item.get("name") or track_name,
            "artist": artist_name,
            "artists": artists_list,
            "album": cleaned_album,
            "cover_url": cover_url,
            "tags": [],
            "wiki_summary": None,
            "album_images": [{"size": "large", "url": cover_url}],
            "track_images": [{"size": "large", "url": cover_url}],
            "track_number": best_item.get("track_number"),
            "track_total": album_data.get("total_tracks"),
        }
    else:
        cleaned_album = metadata_utils.clean_album_name(
            track_name, artist_name, track_name
        )
        return {
            "type": "track_metadata",
            "title": track_name,
            "artist": artist_name,
            "artists": [artist_name],
            "album": cleaned_album,
            "cover_url": "",
            "tags": [],
            "wiki_summary": None,
            "album_images": [],
            "track_images": [],
            "track_number": None,
            "track_total": None,
        }


def resolve_query(query: str) -> dict:
    from spotdl.utils.spotify import SpotifyClient

    spotify = SpotifyClient()

    from spotdl.types.album import Album
    from spotdl.types.artist import Artist
    from spotdl.types.playlist import Playlist
    from spotdl.types.song import Song
    from spotdl.utils.search import get_simple_songs

    q = query.strip()
    if not q:
        raise ValueError("Empty query")

    if q.startswith("resolve_clean:"):
        parts = q.split("resolve_clean:", 1)[1].split("|", 1)
        artist_name = parts[0].strip()
        track_name = parts[1].strip()
        return resolve_clean_track_metadata(spotify, artist_name, track_name)

    # Spotify URL
    if "open.spotify.com" in q or "spotify.link" in q or q.startswith("spotify:"):
        # Strip query parameters for clean resolution
        q = q.split("?")[0].strip()
        if "playlist" in q:
            playlist_id = (
                q.split("playlist/")[-1].split("?")[0].split(":")[-1]
                if "playlist/" in q
                else q.split(":")[-1]
            )
            from spotdl.utils.spotify import SpotifyClient

            if SpotifyClient.is_using_official_api() and not check_credentials_cached():
                try:
                    return _fetch_playlist_direct(playlist_id)
                except Exception as e:
                    fallback_to_free(e)
            else:
                if SpotifyClient.is_using_official_api():
                    SpotifyClient._instance = None
                    SpotifyClient.init(
                        "",
                        "",
                        user_auth=False,
                        use_cache_file=False,
                        use_official_api=False,
                    )
            playlist = Playlist.from_url(query, fetch_songs=False)
            return playlist_result(playlist)
        if "album" in q:
            alb = Album.from_url(q, fetch_songs=False)
            return album_result(alb)
        if "artist" in q:
            artist = Artist.from_url(q)
            return artist_result(artist)
        if "track" in q:
            song = Song.from_url(q)
            return {"type": "tracks", "tracks": [song_to_dict(song)]}
        songs = get_simple_songs([q], use_ytm_data=False)
        return {
            "type": "tracks",
            "tracks": [song_to_dict(s) for s in songs],
        }

    # spotDL search prefixes
    if q.startswith("playlist:"):
        playlist_id = q.split("playlist:")[-1].strip()
        from spotdl.utils.spotify import SpotifyClient

        if SpotifyClient.is_using_official_api() and not check_credentials_cached():
            try:
                return _fetch_playlist_direct(playlist_id)
            except Exception as e:
                fallback_to_free(e)
        else:
            if SpotifyClient.is_using_official_api():
                SpotifyClient._instance = None
                SpotifyClient.init(
                    "",
                    "",
                    user_auth=False,
                    use_cache_file=False,
                    use_official_api=False,
                )
        playlist = Playlist.from_url(
            f"https://open.spotify.com/playlist/{playlist_id}", fetch_songs=False
        )
        return playlist_result(playlist)
    if q.startswith("album:"):
        from spotdl.utils.spotify import SpotifyClient

        if SpotifyClient.is_using_official_api() and not check_credentials_cached():
            try:
                alb = Album.from_search_term(q, fetch_songs=False)
                return album_result(alb)
            except Exception as e:
                fallback_to_free(e)

        # Fallback for SpotipyFree: search tracks, find matching album, and load it by ID/URL
        album_query = q.split("album:", 1)[1].strip()
        album_name = album_query
        artist_name = None
        if "artist:" in album_query:
            parts = album_query.split("artist:", 1)
            album_name = parts[0].strip()
            artist_name = parts[1].strip()

        spotify = SpotifyClient()
        try:
            res = spotify.search(album_query, type="track", limit=15)
            items = (res or {}).get("tracks", {}).get("items", [])
            album_id = None
            # Look for exact matching album name (and optionally artist name)
            for t in items:
                t_alb = t.get("album", {})
                t_alb_name = t_alb.get("name", "").strip().lower()
                if t_alb_name == album_name.lower():
                    if artist_name:
                        t_artists = [
                            a.get("name", "").strip().lower()
                            for a in t.get("artists", [])
                        ]
                        t_alb_artists = [
                            a.get("name", "").strip().lower()
                            for a in t_alb.get("artists", [])
                        ]
                        if (
                            artist_name.lower() in t_artists
                            or artist_name.lower() in t_alb_artists
                        ):
                            album_id = t_alb.get("id")
                            break
                    else:
                        album_id = t_alb.get("id")
                        break
            # Fallback to first matching track's album if no exact match found
            if not album_id and items:
                album_id = items[0].get("album", {}).get("id")

            if album_id:
                alb = Album.from_url(
                    f"https://open.spotify.com/album/{album_id}", fetch_songs=False
                )
                return album_result(alb)
            else:
                raise ValueError(
                    f"Could not find any tracks matching album name '{album_name}' to resolve its ID."
                )
        except Exception as e:
            print(
                f"Warning: Falling back to spotDL native album search due to error: {e}",
                file=sys.stderr,
            )
            alb = Album.from_search_term(q, fetch_songs=False)
            return album_result(alb)

    from spotdl.utils.spotify import SpotifyClient

    spotify = SpotifyClient()

    # User profile fetching for public playlists (direct API, no user auth needed)
    if q.startswith("user:") or "/user/" in q:
        user_id = (
            q.split("user:")[-1].strip()
            if "user:" in q
            else q.split("/user/")[-1].split("?")[0].split("/")[0].strip()
        )
        return _fetch_user_playlists_web(user_id)

    return _search_spotify_catalog(spotify, q)


def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: spotify_query.py <query>"}))
        sys.exit(1)
    try:
        q = sys.argv[1].strip()
        if q == "__package_self_test__":
            import yt_dlp  # noqa: F401

            from spotdl.utils.spotify import SpotifyClient  # noqa: F401

            print(json.dumps({"ok": True}))
            return

        # Profile imports deliberately avoid spotDL. Spotify removed the public
        # user-playlists Web API endpoint, so parse the public profile page.
        if q.startswith("user:") or "/user/" in q:
            user_id = (
                q.split("user:")[-1].strip()
                if "user:" in q
                else q.split("/user/")[-1].split("?")[0].split("/")[0].strip()
            )
            out = _fetch_user_playlists_web(user_id)
        elif (
            "open.spotify.com" in q or "spotify.link" in q or q.startswith("spotify:")
        ) and "playlist" in q:
            # Playlist URLs use direct Spotify Web API — no spotDL needed
            playlist_id = q.split("?")[0].strip()
            playlist_id = (
                playlist_id.split("playlist/")[-1].split("?")[0].split(":")[-1]
                if "playlist/" in playlist_id
                else playlist_id.split(":")[-1]
            )
            if check_credentials_cached():
                init_spotify()
                from spotdl.types.playlist import Playlist

                playlist = Playlist.from_url(q, fetch_songs=False)
                out = playlist_result(playlist)
            else:
                try:
                    out = _fetch_playlist_direct(playlist_id)
                except Exception as e:
                    print(
                        f"Warning: Direct playlist fetch failed ({e}). Falling back to SpotipyFree.",
                        file=sys.stderr,
                    )
                    init_spotify()
                    from spotdl.utils.spotify import SpotifyClient

                    if SpotifyClient.is_using_official_api():
                        fallback_to_free(e)
                    from spotdl.types.playlist import Playlist

                    playlist = Playlist.from_url(q, fetch_songs=False)
                    out = playlist_result(playlist)
        elif q.startswith("playlist:"):
            # playlist:<id> prefix — direct API, no spotDL needed
            playlist_id = q.split("playlist:")[-1].strip()
            if check_credentials_cached():
                init_spotify()
                from spotdl.types.playlist import Playlist

                playlist = Playlist.from_url(
                    f"https://open.spotify.com/playlist/{playlist_id}",
                    fetch_songs=False,
                )
                out = playlist_result(playlist)
            else:
                try:
                    out = _fetch_playlist_direct(playlist_id)
                except Exception as e:
                    print(
                        f"Warning: Direct playlist fetch failed ({e}). Falling back to SpotipyFree.",
                        file=sys.stderr,
                    )
                    init_spotify()
                    from spotdl.utils.spotify import SpotifyClient

                    if SpotifyClient.is_using_official_api():
                        fallback_to_free(e)
                    from spotdl.types.playlist import Playlist

                    playlist = Playlist.from_url(
                        f"https://open.spotify.com/playlist/{playlist_id}",
                        fetch_songs=False,
                    )
                    out = playlist_result(playlist)
        else:
            init_spotify()
            try:
                out = resolve_query(q)
            except Exception as e:
                from spotdl.utils.spotify import SpotifyClient

                if SpotifyClient.is_using_official_api():
                    fallback_to_free(e)
                    out = resolve_query(q)
                else:
                    raise e
        print(json.dumps(out))
    except Exception as exc:
        error_message = str(exc)
        if os.environ.get("SPOTDL_GUI_DEBUG") == "1":
            debug_info = {
                "error": error_message,
                "__file__": __file__,
                "resolved_ROOT": str(Path(__file__).resolve().parents[2]),
                "sys_path": sys.path,
                "cwd": os.getcwd(),
            }
            error_message = f"{error_message} | Debug Info: {json.dumps(debug_info)}"
        print(json.dumps({"error": error_message}))
        sys.exit(1)


if __name__ == "__main__":
    main()
