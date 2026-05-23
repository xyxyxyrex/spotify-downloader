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

def find_best_match(results, target_title, target_artist, target_duration):
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
            artist_score = len(intersection) / len(target_artist_words)
        else:
            artist_score = 0.5

        # Boost artist score if target artist is mentioned in the result title
        if target_artist_words:
            title_intersection = target_artist_words.intersection(res_title_words)
            title_artist_score = len(title_intersection) / len(target_artist_words)
            artist_score = max(artist_score, title_artist_score)

        # Calculate Duration Score
        res_duration = res.get('duration_seconds', 0)
        
        # Fallback to parsing string duration if seconds are missing
        if not res_duration and res.get('duration'):
            try:
                parts = res.get('duration').split(':')
                if len(parts) == 2:
                    res_duration = int(parts[0]) * 60 + int(parts[1])
                elif len(parts) == 3:
                    res_duration = int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
            except Exception:
                pass

        duration_multiplier = 1.0
        if target_duration > 0 and res_duration > 0:
            diff = abs(res_duration - target_duration)
            if diff > 40:
                duration_multiplier = 0.2
            elif diff > 20:
                duration_multiplier = 0.6
            else:
                duration_multiplier = 1.0
        elif target_duration > 0 and not res_duration:
            duration_multiplier = 0.8

        type_bonus = 0.1 if res_type == 'song' else 0.0
        score = (title_score * 0.45 + artist_score * 0.45 + type_bonus) * duration_multiplier

        res_title_lower = res_title.lower()
        if 'cover' in res_title_lower and 'cover' not in target_title.lower():
            score *= 0.1
        if 'remix' in res_title_lower and 'remix' not in target_title.lower():
            score *= 0.1

        if score > best_score:
            best_score = score
            best_video_id = video_id

    return best_video_id, best_score

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

    best_id = None
    best_score = -1.0

    try:
        yt = YTMusic()
        # 1. Try search with filter="songs" first
        results_songs = yt.search(query, filter="songs", limit=10)
        best_id, best_score = find_best_match(results_songs, target_title, target_artist, target_duration)
        
        # 2. If no high-quality match (score < 0.7) found in songs, try general search
        if best_score < 0.7:
            results_all = yt.search(query, limit=10)
            best_id_all, best_score_all = find_best_match(results_all, target_title, target_artist, target_duration)
            if best_score_all > best_score:
                best_id = best_id_all
                best_score = best_score_all
    except Exception:
        # Silently fail, let Rust fallback to standard ytsearch1
        return

    if best_id and best_score >= 0.3:
        print(best_id)

if __name__ == '__main__':
    main()
