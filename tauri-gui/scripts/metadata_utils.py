"""Utility functions for cleaning and normalizing track metadata."""

import re


def clean_album_name(album: str, artist: str = "", title: str = "") -> str:
    if not album:
        return ""

    norm_artist = (artist or "").lower().strip()
    norm_title = (title or "").lower().strip()

    # 1. Manual Overrides for specific tracks / album variants
    # Tyler, The Creator - See You Again -> Flower Boy
    if (
        "tyler" in norm_artist
        and "creator" in norm_artist
        and "see you again" in norm_title
    ):
        return "Flower Boy"

    # Porter Robinson - Knock Yourself OUT XD -> SMILE! :D
    if (
        "porter" in norm_artist
        and "robinson" in norm_artist
        and "knock yourself out" in norm_title
    ):
        return "SMILE! :D"

    # 2. General cleaning of album suffixes and variants
    album_cleaned = album

    # Strip Collectors Edition variations outside of parentheses (e.g. "DAMN. COLLECTORS EDITION." -> "DAMN.")
    album_cleaned = re.sub(r"(?i)\s+collectors?\s+edition\.?$", "", album_cleaned)

    # Suffix keywords to look for inside parentheses/brackets/braces
    keywords = [
        "explicit",
        "clean",
        "spotify",
        "deluxe",
        "collectors",
        "collector's",
        "single",
        "bonus",
        "remaster",
        "expanded",
        "special",
        "anniversary",
    ]

    # Individual bracket regexes to avoid cross-matching
    bracket_regexes = [
        r"\(([^)]*)\)",  # Parentheses
        r"\[([^\]]*)\]",  # Square brackets
        r"\{([^}]*)\}",  # Curly braces
    ]

    def check_and_replace(match):
        content = match.group(1).lower()
        if any(kw in content for kw in keywords):
            return ""  # strip the entire bracket
        return match.group(0)  # keep it

    for pattern in bracket_regexes:
        # Run replacement repeatedly to handle nested or consecutive brackets
        for _ in range(3):
            album_cleaned = re.sub(pattern, check_and_replace, album_cleaned)

    # Also strip suffixes attached via hyphens or commas, e.g. " - Single" or ", Deluxe"
    for kw in keywords:
        album_cleaned = re.sub(rf"(?i)\s*-\s*{kw}\b.*$", "", album_cleaned)
        album_cleaned = re.sub(rf"(?i)\s*,\s*{kw}\b.*$", "", album_cleaned)

    # Strip trailing punctuation/whitespace (like dots, hyphens, spaces left behind)
    album_cleaned = re.sub(r"\s*[-\s\.]+$", "", album_cleaned).strip()

    if not album_cleaned:
        return album  # fallback if we cleaned everything out

    return album_cleaned
