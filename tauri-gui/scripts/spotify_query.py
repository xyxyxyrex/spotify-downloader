"""Resolve Spotify URLs and search terms via spotDL."""

import json
import os
import re
import sys
from pathlib import Path
from typing import Optional

# Allow importing spotdl from repo root when not installed
ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def song_to_dict(song) -> dict:
    return {
        "title": song.name,
        "artist": song.artist,
        "artists": song.artists,
        "album": song.album_name,
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

    return {
        "type": "album",
        "name": meta["name"],
        "url": url,
        "artist": meta["artists"][0]["name"] if meta.get("artists") else "",
        "cover_url": cover,
        "tracks": [],
    }


def album_result(album) -> dict:
    if isinstance(album, str):
        return album_summary_from_url(album)

    return {
        "type": "album",
        "name": album.name,
        "url": album.url,
        "artist": _artist_name(album.artist),
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
    if c.startswith(q) or q.startswith(c):
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
    return max(
        _relevance(query, title),
        _relevance(query, f"{title} {artist}") * 0.92,
        _relevance(query, album) * 0.72,
    )


def _score_album(query: str, album: dict) -> float:
    name = album.get("name") or ""
    artist = album.get("artist") or ""
    return max(
        _relevance(query, name),
        _relevance(query, f"{name} {artist}") * 0.9,
    )


def _score_artist(query: str, artist: dict) -> float:
    return _relevance(query, artist.get("name") or "")


def _pick_primary_section(
    query: str,
    tracks: list,
    albums: list,
    artists: list,
) -> str:
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


def _finalize_search_results(
    query: str,
    tracks: list,
    albums: list,
    artists: list,
) -> dict:
    for track in tracks:
        track["match_score"] = _score_track(query, track)
    for album in albums:
        album["match_score"] = _score_album(query, album)
    for artist in artists:
        artist["match_score"] = _score_artist(query, artist)

    tracks.sort(key=lambda x: x["match_score"], reverse=True)
    albums.sort(key=lambda x: x["match_score"], reverse=True)
    artists.sort(key=lambda x: x["match_score"], reverse=True)

    primary = _pick_primary_section(query, tracks, albums, artists)
    section_order = [primary] + [
        s for s in ("tracks", "albums", "artists") if s != primary
    ]

    for items in (tracks, albums, artists):
        for item in items:
            item.pop("match_score", None)

    return {
        "type": "search_results",
        "tracks": tracks[:25],
        "albums": albums[:10],
        "artists": artists[:10],
        "section_order": section_order,
        "primary_section": primary,
    }


def _search_spotify_catalog(spotify, query: str) -> dict:
    """Tracks, albums, and artists for a free-text query."""
    from spotdl.types.song import Song

    tracks = [song_to_dict(s) for s in Song.list_from_search_term(query)]

    albums: list = []
    artists: list = []

    try:
        album_res = spotify.search(query, type="album", limit=10)
        for item in (album_res or {}).get("albums", {}).get("items", []):
            albums.append(
                {
                    "name": item["name"],
                    "artist": item["artists"][0]["name"]
                    if item.get("artists")
                    else "",
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
                    "followers": item["followers"]["total"]
                    if "followers" in item
                    else 0,
                }
            )
    except Exception:
        pass

    return _finalize_search_results(query, tracks, albums, artists)


def init_spotify() -> None:
    from spotdl.utils.spotify import SpotifyClient

    client_id = os.environ.get("SPOTIFY_CLIENT_ID", "").strip()
    client_secret = os.environ.get("SPOTIFY_CLIENT_SECRET", "").strip()
    
    # We can allow FreeSpotify if no credentials are provided (spotdl native behavior)
    use_official = bool(client_id and client_secret)
    
    SpotifyClient.init(
        client_id, 
        client_secret, 
        user_auth=False, 
        use_cache_file=True,
        use_official_api=use_official
    )


def resolve_query(query: str) -> dict:
    from spotdl.types.album import Album
    from spotdl.types.playlist import Playlist
    from spotdl.types.song import Song
    from spotdl.types.artist import Artist
    from spotdl.utils.search import get_simple_songs

    q = query.strip()
    if not q:
        raise ValueError("Empty query")

    # Spotify URL
    if "open.spotify.com" in q or "spotify.link" in q or q.startswith("spotify:"):
        if "playlist" in q:
            pl = Playlist.from_url(q, fetch_songs=True)
            return playlist_result(pl)
        if "album" in q:
            alb = Album.from_url(q, fetch_songs=True)
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
        pl = Playlist.from_search_term(q, fetch_songs=True)
        return playlist_result(pl)
    if q.startswith("album:"):
        alb = Album.from_search_term(q, fetch_songs=True)
        return album_result(alb)

    from spotdl.utils.spotify import SpotifyClient

    spotify = SpotifyClient()
    return _search_spotify_catalog(spotify, q)


def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: spotify_query.py <query>"}))
        sys.exit(1)
    try:
        init_spotify()
        out = resolve_query(sys.argv[1])
        print(json.dumps(out))
    except Exception as exc:
        print(json.dumps({"error": str(exc)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
