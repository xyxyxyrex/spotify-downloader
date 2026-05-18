"""Resolve Spotify URLs and search terms via spotDL."""

import json
import os
import sys
from pathlib import Path

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


def album_result(album) -> dict:
    return {
        "type": "album",
        "name": album.name,
        "url": album.url,
        "artist": album.artist,
        "cover_url": album.cover_url,
        "tracks": [song_to_dict(s) for s in album.songs],
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
    from spotdl.utils.search import get_simple_songs

    q = query.strip()
    if not q:
        raise ValueError("Empty query")

    # Spotify URL
    if "open.spotify.com" in q or "spotify.link" in q:
        if "playlist" in q:
            pl = Playlist.from_url(q, fetch_songs=True)
            return playlist_result(pl)
        if "album" in q:
            alb = Album.from_url(q, fetch_songs=True)
            return album_result(alb)
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

    # Text: Spotify track search + try playlist name match
    tracks = Song.list_from_search_term(q)
    result = {
        "type": "tracks",
        "tracks": [song_to_dict(s) for s in tracks],
    }

    try:
        pl = Playlist.from_search_term(f"playlist:{q}", fetch_songs=True)
        result["playlist_match"] = playlist_result(pl)
    except Exception:
        pass

    return result


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
