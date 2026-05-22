"""Embed ID3 metadata and album art into an MP3, M4A, or FLAC file using mutagen."""

import json
import sys
from pathlib import Path

import urllib.parse

import requests
import mutagen
from mutagen.id3 import APIC, TALB, TCON, TIT2, TPE1, COMM
from mutagen.mp3 import MP3
from mutagen.mp4 import MP4, MP4Cover

LASTFM_PLACEHOLDER = "2a96cbd8b46e442fc41c2b86b821562f"


def is_usable_cover_url(url: str | None) -> bool:
    if not url:
        return False
    u = url.lower()
    if LASTFM_PLACEHOLDER in u or "default" in u or "placeholder" in u:
        return False
    return True


def fetch_itunes_cover(artist: str, title: str) -> str | None:
    if not artist.strip() or not title.strip():
        return None
    query = urllib.parse.quote(f"{artist} {title}")
    url = f"https://itunes.apple.com/search?term={query}&entity=song&limit=1"
    try:
        resp = requests.get(url, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        results = data.get("results") or []
        if not results:
            return None
        art = results[0].get("artworkUrl100")
        if not art:
            return None
        art = art.replace("100x100bb.jpg", "600x600bb.jpg").replace(
            "100x100.jpg", "600x600.jpg"
        )
        return art if is_usable_cover_url(art) else None
    except Exception as e:
        print(f"Warning: iTunes cover lookup failed: {e}", file=sys.stderr)
        return None


def embed(path: str, meta: dict) -> None:
    path = str(Path(path).resolve())
    audio = mutagen.File(path)
    if audio is None:
        raise ValueError(f"Could not open audio file at {path} with mutagen.")

    title = meta.get("title") or ""
    artist = meta.get("artist") or ""
    album = meta.get("album") or ""
    tag_list = meta.get("tags") or []
    wiki = meta.get("wiki_summary")

    cover_url = meta.get("cover_url")
    if not is_usable_cover_url(cover_url):
        album_images = meta.get("album_images") or []
        track_images = meta.get("track_images") or []
        for img in album_images + track_images:
            url = img.get("url") if isinstance(img, dict) else None
            if is_usable_cover_url(url):
                cover_url = url
                break

    if not is_usable_cover_url(cover_url):
        cover_url = fetch_itunes_cover(artist, title)

    cover_data = None
    if cover_url and is_usable_cover_url(cover_url):
        try:
            resp = requests.get(cover_url, timeout=15)
            resp.raise_for_status()
            cover_data = resp.content
        except Exception as e:
            print(f"Warning: Failed to fetch cover art from {cover_url}: {e}", file=sys.stderr)

    class_name = audio.__class__.__name__

    if class_name == "MP3":
        if audio.tags is None:
            audio.add_tags()
        tags = audio.tags

        if title:
            tags.delall("TIT2")
            tags.add(TIT2(encoding=3, text=title))
        if artist:
            tags.delall("TPE1")
            tags.add(TPE1(encoding=3, text=artist))
        if album:
            tags.delall("TALB")
            tags.add(TALB(encoding=3, text=album))
        if tag_list:
            tags.delall("TCON")
            tags.add(TCON(encoding=3, text=tag_list))
        if wiki:
            tags.delall("COMM")
            tags.add(COMM(encoding=3, lang="eng", desc="desc", text=wiki[:500]))
        if cover_data:
            tags.delall("APIC")
            mime = "image/png" if "png" in cover_url.lower() else "image/jpeg"
            tags.add(
                APIC(
                    encoding=3,
                    mime=mime,
                    type=3,
                    desc="Cover",
                    data=cover_data,
                )
            )

    elif class_name == "MP4":
        if title:
            audio["\xa9nam"] = [title]
        if artist:
            audio["\xa9ART"] = [artist]
        if album:
            audio["\xa9alb"] = [album]
        if tag_list:
            genre_str = ", ".join(tag_list) if isinstance(tag_list, list) else tag_list
            audio["\xa9gen"] = [genre_str]
        if wiki:
            audio["\xa9cmt"] = [wiki[:500]]
        if cover_data:
            img_format = MP4Cover.FORMAT_PNG if "png" in cover_url.lower() else MP4Cover.FORMAT_JPEG
            audio["covr"] = [MP4Cover(cover_data, imageformat=img_format)]

    elif class_name == "FLAC":
        if title:
            audio["title"] = [title]
        if artist:
            audio["artist"] = [artist]
        if album:
            audio["album"] = [album]
        if tag_list:
            genre_str = ", ".join(tag_list) if isinstance(tag_list, list) else tag_list
            audio["genre"] = [genre_str]
        if wiki:
            audio["comment"] = [wiki[:500]]
        if cover_data:
            from mutagen.picture import Picture
            pic = Picture()
            pic.data = cover_data
            pic.type = 3
            pic.mime = "image/png" if "png" in cover_url.lower() else "image/jpeg"
            audio.clear_pictures()
            audio.add_picture(pic)

    else:
        try:
            audio["title"] = [title]
            audio["artist"] = [artist]
            audio["album"] = [album]
        except Exception as e:
            print(f"Warning: Could not set metadata for unsupported format {class_name}: {e}", file=sys.stderr)

    audio.save()


def main() -> None:
    if len(sys.argv) < 3:
        print("Usage: embed_metadata.py <audio_path> <metadata_json>", file=sys.stderr)
        sys.exit(1)
    path = Path(sys.argv[1])
    meta = json.loads(sys.argv[2])
    if not path.is_file():
        print(f"File not found: {path}", file=sys.stderr)
        sys.exit(1)
    embed(str(path), meta)
    print("ok")


if __name__ == "__main__":
    main()
