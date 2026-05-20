import sys
import re
from ytmusicapi import YTMusic

def clean_text(text):
    if not text:
        return set()
    text = text.lower()
    # Remove text in brackets/parentheses like (Official Video), [Official Lyric Video], etc.
    text = re.sub(r'\[[^\]]*\]|\([^)]*\)', '', text)
    # Remove common extra terms
    text = re.sub(r'\b(official|video|audio|lyrics|lyric|hd|hq|live|cover|remix|version|edit)\b', '', text)
    # Extract alphanumeric words
    words = re.findall(r'\b\w+\b', text)
    return set(words)

def main():
    if len(sys.argv) < 2:
        return

    query = sys.argv[1]
    target_title = sys.argv[2] if len(sys.argv) > 2 else ""
    target_artist = sys.argv[3] if len(sys.argv) > 3 else ""
    
    target_duration = 0
    if len(sys.argv) > 4:
        try:
            target_duration = int(float(sys.argv[4]))
        except ValueError:
            pass

    try:
        yt = YTMusic()
        # Fetch top 10 search results
        results = yt.search(query, limit=10)
    except Exception as e:
        # Silently fail, let Rust fallback to standard ytsearch1
        return

    best_video_id = None
    best_score = -1.0

    target_title_words = clean_text(target_title)
    target_artist_words = clean_text(target_artist)

    for res in results:
        res_type = res.get('resultType')
        if res_type not in ('song', 'video'):
            continue

        video_id = res.get('videoId')
        if not video_id:
            continue

        res_title = res.get('title', '')
        res_title_words = clean_text(res_title)
        
        # Calculate Title Overlap Score
        title_score = 0.0
        if target_title_words and res_title_words:
            intersection = target_title_words.intersection(res_title_words)
            union = target_title_words.union(res_title_words)
            title_score = len(intersection) / len(union) if union else 0.0
        else:
            # Fallback if target title is empty
            title_score = 0.5

        # Calculate Artist Overlap Score
        artist_score = 0.0
        res_artists = res.get('artists', [])
        res_artist_names = [a.get('name', '') for a in res_artists]
        res_artist_words = set()
        for name in res_artist_names:
            res_artist_words.update(clean_text(name))
            
        if target_artist_words and res_artist_words:
            intersection = target_artist_words.intersection(res_artist_words)
            # Give high score if target artist is part of result artists
            artist_score = len(intersection) / len(target_artist_words)
        else:
            artist_score = 0.5

        # Calculate Duration Score
        res_duration = res.get('duration_seconds', 0)
        duration_multiplier = 1.0
        if target_duration > 0 and res_duration > 0:
            diff = abs(res_duration - target_duration)
            if diff > 40:
                # Heavy penalty if duration is off by more than 40 seconds
                duration_multiplier = 0.2
            elif diff > 20:
                duration_multiplier = 0.6
            else:
                duration_multiplier = 1.0
        elif target_duration > 0 and not res_duration:
            # Minor penalty if duration is unknown
            duration_multiplier = 0.8

        # Weighted Total Score
        # Songs have a small bias bonus
        type_bonus = 0.1 if res_type == 'song' else 0.0
        
        score = (title_score * 0.45 + artist_score * 0.45 + type_bonus) * duration_multiplier

        # Check if the title explicitly says 'cover' or 'remix' but target didn't ask for it
        res_title_lower = res_title.lower()
        if 'cover' in res_title_lower and 'cover' not in target_title.lower():
            score *= 0.1
        if 'remix' in res_title_lower and 'remix' not in target_title.lower():
            score *= 0.1

        if score > best_score:
            best_score = score
            best_video_id = video_id

    # Output video ID if we found a match above a minimum quality threshold
    if best_video_id and best_score >= 0.3:
        print(best_video_id)

if __name__ == '__main__':
    main()
