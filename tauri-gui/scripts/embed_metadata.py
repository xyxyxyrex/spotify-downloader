"""Embed ID3 metadata and album art into an MP3 using mutagen."""

import json
import sys
from pathlib import Path

import requests
from mutagen.id3 import APIC, ID3, TALB, TCON, TIT2, TPE1, COMM
from mutagen.mp3 import MP3


def embed(path: str, meta: dict) -> None:
    audio = MP3(path, ID3=ID3)
    if audio.tags is None:
        audio.add_tags()

    tags = audio.tags
    title = meta.get("title") or ""
    artist = meta.get("artist") or ""
    album = meta.get("album") or ""

    if title:
        tags.delall("TIT2")
        tags.add(TIT2(encoding=3, text=title))
    if artist:
        tags.delall("TPE1")
        tags.add(TPE1(encoding=3, text=artist))
    if album:
        tags.delall("TALB")
        tags.add(TALB(encoding=3, text=album))

    tag_list = meta.get("tags") or []
    if tag_list:
        tags.delall("TCON")
        tags.add(TCON(encoding=3, text=tag_list))

    wiki = meta.get("wiki_summary")
    if wiki:
        tags.delall("COMM")
        tags.add(COMM(encoding=3, lang="eng", desc="desc", text=wiki[:500]))

    cover_url = meta.get("cover_url")
    if not cover_url:
        album_images = meta.get("album_images") or []
        track_images = meta.get("track_images") or []
        for img in album_images + track_images:
            url = img.get("url") if isinstance(img, dict) else None
            if url and "2a96cbd8b46e442fc41c2b86b821562f" not in url:
                cover_url = url
                break

    if cover_url:
        try:
            resp = requests.get(cover_url, timeout=15)
            resp.raise_for_status()
            tags.delall("APIC")
            tags.add(
                APIC(
                    encoding=3,
                    mime="image/jpeg",
                    type=3,
                    desc="Cover",
                    data=resp.content,
                )
            )
        except Exception:
            pass

    tags.save()
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
