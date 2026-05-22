import {
    isValidImage,
    pickBestImageUrl,
    mergeImages,
} from "./media.js";

const itunesArtCache = new Map();

/** True when URL is usable (not Last.fm placeholder / generic default). */
export function isUsableCoverUrl(url) {
    if (!isValidImage(url)) return false;
    const u = String(url).toLowerCase();
    return !u.includes("default") && !u.includes("placeholder");
}

export function coverFromMeta(meta) {
    if (!meta) return null;
    return pickBestImageUrl(
        mergeImages(meta.album_images || [], meta.track_images || []),
    );
}

/**
 * Query iTunes Search API for high-res artwork (600×600).
 * @returns {Promise<string|null>}
 */
export async function fetchiTunesCoverArt(artist, title) {
    if (!artist?.trim() || !title?.trim()) return null;
    const cacheKey = `${artist}::${title}`;
    if (itunesArtCache.has(cacheKey)) {
        return itunesArtCache.get(cacheKey);
    }

    let result = null;

    // 1. Try fetching via Tauri Rust backend to bypass browser CORS policy completely
    if (window.__TAURI__?.core?.invoke) {
        try {
            const artUrl = await window.__TAURI__.core.invoke("fetch_itunes_cover_art", { artist, title });
            if (artUrl) {
                const highResUrl = artUrl
                    .replace("100x100bb.jpg", "600x600bb.jpg")
                    .replace("100x100.jpg", "600x600.jpg");
                if (isUsableCoverUrl(highResUrl)) {
                    result = highResUrl;
                }
            }
        } catch (e) {
            console.debug("iTunes artwork fallback via Tauri Rust backend failed:", e);
        }

        // Since we are running within Tauri, we must NOT fall back to direct browser fetch
        // because it will always fail with CORS policy violations and print ugly red console errors.
        itunesArtCache.set(cacheKey, result);
        return result;
    }

    // 2. Fallback to direct frontend fetch ONLY if Tauri environment is not available (e.g. standalone web browser testing)
    try {
        const query = `${artist} ${title}`;
        const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=1`;
        const res = await fetch(url);
        if (res.ok) {
            const data = await res.json();
            const track = data.results?.[0];
            let artUrl = track?.artworkUrl100;
            if (artUrl) {
                artUrl = artUrl
                    .replace("100x100bb.jpg", "600x600bb.jpg")
                    .replace("100x100.jpg", "600x600.jpg");
                if (isUsableCoverUrl(artUrl)) {
                    result = artUrl;
                }
            }
        }
    } catch (e) {
        // Silence noisy warnings/errors in console, using console.debug for low-priority diagnostic log
        console.debug("Direct iTunes artwork fallback failed (expected if CORS blocks it):", e);
    }

    itunesArtCache.set(cacheKey, result);
    return result;
}

/**
 * Resolve best cover URL: existing image → Last.fm meta → iTunes.
 * Mutates song.image when a URL is found.
 */
export async function resolveTrackCoverUrl(song, options = {}) {
    if (!song?.title || !song?.artist) return null;

    const meta = options.meta ?? song.meta;
    let url = song.image;

    if (!isUsableCoverUrl(url)) {
        url = coverFromMeta(meta);
    }
    if (!isUsableCoverUrl(url)) {
        url = await fetchiTunesCoverArt(song.artist, song.title);
    }

    if (isUsableCoverUrl(url)) {
        song.image = url;
        return url;
    }
    return null;
}

/** Ensure embed metadata includes a cover image entry for save_song_with_metadata. */
export function injectCoverIntoMeta(meta, coverUrl) {
    if (!meta || !isUsableCoverUrl(coverUrl)) return meta;
    if (isUsableCoverUrl(coverFromMeta(meta))) return meta;

    if (!Array.isArray(meta.album_images)) {
        meta.album_images = [];
    }
    meta.album_images.unshift({ size: "extralarge", url: coverUrl });
    return meta;
}
