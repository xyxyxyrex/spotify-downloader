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
    
    is_non_ascii = bool(re.search(r'[^\x00-\x7F]', title + artist + album))
    
    base_score = max(
        _relevance(query, title),
        _relevance(query, f"{title} {artist}") * 0.92,
        _relevance(query, album) * 0.72,
    )
    
    if is_non_ascii and base_score < 50.0:
        orig_idx = track.get("original_index", 100)
        boost = max(0.0, 85.0 - orig_idx * 5.0)
        return max(base_score, boost)
        
    return base_score


def _score_album(query: str, album: dict) -> float:
    name = album.get("name") or ""
    artist = album.get("artist") or ""
    
    is_non_ascii = bool(re.search(r'[^\x00-\x7F]', name + artist))
    
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
    is_non_ascii = bool(re.search(r'[^\x00-\x7F]', name))
    
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


def _get_direct_spotify_token() -> str:
    import base64
    import urllib.request
    import urllib.parse
    import urllib.error

    client_id = os.environ.get("SPOTIFY_CLIENT_ID", "").strip()
    client_secret = os.environ.get("SPOTIFY_CLIENT_SECRET", "").strip()
    if not client_id or not client_secret:
        raise ValueError("Spotify Client ID and Secret are required to fetch user playlists.")

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


def _fetch_user_playlists_direct(user_id: str) -> dict:
    """Fetch a user's public playlists using client credentials (no user login)."""
    import urllib.request
    import urllib.parse

    access_token = _get_direct_spotify_token()

    # Fetch user playlists
    api_url = f"https://api.spotify.com/v1/users/{urllib.parse.quote(user_id)}/playlists?limit=50"
    api_req = urllib.request.Request(
        api_url,
        headers={"Authorization": f"Bearer {access_token}"},
    )
    with urllib.request.urlopen(api_req) as resp:
        playlists_data = json.loads(resp.read())

    items = playlists_data.get("items", [])
    return {
        "type": "user_playlists",
        "playlists": [
            {
                "id": p["id"],
                "name": p["name"],
                "url": p["external_urls"]["spotify"],
                "image": p["images"][0]["url"] if p.get("images") else "",
                "tracks_total": p["tracks"]["total"] if "tracks" in p else 0,
                "owner": (p["owner"].get("display_name") or p["owner"]["id"]),
            }
            for p in items
            if p and p.get("public") is not False
        ],
    }


def _fetch_playlist_direct(playlist_id: str) -> dict:
    """Fetch playlist metadata and all tracks using direct Spotify Web API."""
    import urllib.request
    import urllib.parse

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
            
            artist_name = t["artists"][0]["name"] if t.get("artists") else "Unknown Artist"
            album_name = t.get("album", {}).get("name", "Unknown Album")
            album_art = ""
            if t.get("album", {}).get("images"):
                album_art = t["album"]["images"][0]["url"]
                
            all_tracks.append({
                "url": t.get("external_urls", {}).get("spotify", f"https://open.spotify.com/track/{t['id']}"),
                "title": t["name"],
                "artist": artist_name,
                "album": album_name,
                "album_art": album_art,
                "duration": t.get("duration_ms", 0) / 1000.0,
            })
            
        next_url = page.get("next")

    return {
        "type": "playlist",
        "url": meta_data.get("external_urls", {}).get("spotify", f"https://open.spotify.com/playlist/{playlist_id}"),
        "name": meta_data["name"],
        "author": meta_data.get("owner", {}).get("display_name") or meta_data.get("owner", {}).get("id") or "",
        "tracks": all_tracks,
    }


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
        # Strip query parameters for clean resolution
        q = q.split("?")[0].strip()
        if "playlist" in q:
            playlist_id = q.split("playlist/")[-1].split("?")[0].split(":")[-1] if "playlist/" in q else q.split(":")[-1]
            return _fetch_playlist_direct(playlist_id)
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
        playlist_id = q.split("playlist:")[-1].strip()
        return _fetch_playlist_direct(playlist_id)
    if q.startswith("album:"):
        alb = Album.from_search_term(q, fetch_songs=True)
        return album_result(alb)

    from spotdl.utils.spotify import SpotifyClient
    spotify = SpotifyClient()

    # User profile fetching for public playlists (direct API, no user auth needed)
    if q.startswith("user:") or "/user/" in q:
        user_id = q.split("user:")[-1].strip() if "user:" in q else q.split("/user/")[-1].split("?")[0].split("/")[0].strip()
        return _fetch_user_playlists_direct(user_id)

    return _search_spotify_catalog(spotify, q)


def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: spotify_query.py <query>"}))
        sys.exit(1)
    try:
        q = sys.argv[1].strip()
        # For user: queries, skip spotDL entirely and use direct API
        if q.startswith("user:") or "/user/" in q:
            user_id = q.split("user:")[-1].strip() if "user:" in q else q.split("/user/")[-1].split("?")[0].split("/")[0].strip()
            out = _fetch_user_playlists_direct(user_id)
        elif ("open.spotify.com" in q or "spotify.link" in q or q.startswith("spotify:")) and "playlist" in q:
            # Playlist URLs use direct Spotify Web API — no spotDL needed
            playlist_id = q.split("?")[0].strip()
            playlist_id = playlist_id.split("playlist/")[-1].split("?")[0].split(":")[-1] if "playlist/" in playlist_id else playlist_id.split(":")[-1]
            out = _fetch_playlist_direct(playlist_id)
        elif q.startswith("playlist:"):
            # playlist:<id> prefix — direct API, no spotDL needed
            playlist_id = q.split("playlist:")[-1].strip()
            out = _fetch_playlist_direct(playlist_id)
        else:
            init_spotify()
            out = resolve_query(q)
        print(json.dumps(out))
    except Exception as exc:
        debug_info = {
            "error": str(exc),
            "__file__": __file__,
            "resolved_ROOT": str(Path(__file__).resolve().parents[2]),
            "sys_path": sys.path,
            "cwd": os.getcwd()
        }
        print(json.dumps({"error": f"{str(exc)} | Debug Info: {json.dumps(debug_info)}"}))
        sys.exit(1)


if __name__ == "__main__":
    main()
