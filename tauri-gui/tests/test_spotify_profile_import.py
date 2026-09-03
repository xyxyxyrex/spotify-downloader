"""Tests for the dependency-free Spotify profile importer."""

import importlib.util
from pathlib import Path
from unittest.mock import patch


SCRIPT_PATH = Path(__file__).parents[1] / "scripts" / "spotify_query.py"
SPEC = importlib.util.spec_from_file_location("spotify_query", SCRIPT_PATH)
spotify_query = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(spotify_query)


PROFILE_HTML = b"""
<!doctype html>
<html>
  <head><title>Example User on Spotify</title></head>
  <body>
    <h2>Public Playlists</h2>
    <a href="/playlist/abc123">
      <img src="https://i.scdn.co/example.jpg" />
      <span>Road &amp; Rail</span><span>12 likes</span>
    </a>
    <a href="/playlist/def456"><span>Quiet Hours</span></a>
  </body>
</html>
"""


class _Response:
    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def read(self):
        return PROFILE_HTML


def test_profile_parser_extracts_public_playlists():
    parser = spotify_query._SpotifyProfileParser()
    parser.feed(PROFILE_HTML.decode())

    assert parser.page_title == "Example User on Spotify"
    assert parser.playlists == [
        {
            "id": "abc123",
            "name": "Road & Rail",
            "url": "https://open.spotify.com/playlist/abc123",
            "image": "https://i.scdn.co/example.jpg",
            "tracks_total": None,
        },
        {
            "id": "def456",
            "name": "Quiet Hours",
            "url": "https://open.spotify.com/playlist/def456",
            "image": "",
            "tracks_total": None,
        },
    ]


def test_profile_fetch_does_not_import_spotdl():
    with patch("urllib.request.urlopen", return_value=_Response()):
        result = spotify_query._fetch_user_playlists_web("example-user")

    assert result["type"] == "user_playlists"
    assert [item["owner"] for item in result["playlists"]] == [
        "Example User",
        "Example User",
    ]


def test_profile_fetch_rejects_invalid_user_id():
    try:
        spotify_query._fetch_user_playlists_web("https://not-a-user-id")
    except ValueError as exc:
        assert str(exc) == "Enter a valid Spotify profile URL or username."
    else:
        raise AssertionError("invalid user ID should fail before making a request")
