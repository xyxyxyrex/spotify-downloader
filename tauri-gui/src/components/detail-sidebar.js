import {
    getDetailSidebarSong,
    setDetailSidebarSong,
    updateDetailLikeButton,
    setDetailArtistAlbum,
    setNowPlaying,
    updateRecentlyPlayedImage,
    saveLastPlayedSession,
    appendArt,
    createPlayButton,
    stripHtml,
    escapeHtml,
    cachedInvoke
} from "../main.js";

import {
    updateScreensaverUI
} from "./screensaver.js";

import {
    isValidImage,
    generateThumbnail,
    mergeImages,
    pickBestImageUrl,
    parseImagesFromLastFm,
    songKey
} from "../utils/media.js";

import { resolveArtUrl } from "../art.js";

const { invoke } = window.__TAURI__.core;

let lyricsRequestId = 0;
let metadataRequestId = 0;

export async function showDetailSidebarPreview(song) {
    setDetailSidebarSong(song);
    updateDetailLikeButton();
    
    const detailEmpty = document.getElementById("detail-empty");
    const detailContent = document.getElementById("detail-content");
    const detailTitle = document.getElementById("detail-title");
    const detailMeta = document.getElementById("detail-meta");
    const detailLyricsEl = document.getElementById("detail-lyrics");
    const detailSidebar = document.getElementById("detail-sidebar");
    const detailToggle = document.getElementById("detail-toggle");
    
    if (detailEmpty) detailEmpty.classList.add("hidden");
    if (detailContent) detailContent.classList.remove("hidden");
    if (detailTitle) detailTitle.textContent = song.title;
    
    setDetailArtistAlbum(song.artist, song.album);
    if (detailMeta) {
        detailMeta.innerHTML = '<p class="detail-meta-loading">Loading metadata…</p>';
    }
    if (detailLyricsEl) detailLyricsEl.textContent = "";
    
    await setDetailArt(song.image, song.title, song.artist);
    loadDetailLyrics(song.artist, song.title);

    if (detailSidebar && detailSidebar.classList.contains("collapsed")) {
        detailSidebar.classList.remove("collapsed");
        if (detailToggle) detailToggle.textContent = "›";
        localStorage.setItem("detailSidebarCollapsed", "false");
    }
}

export async function setDetailArt(url, title, artist) {
    const detailArtCanvas = document.getElementById("detail-art-canvas");
    const detailArtImg = document.getElementById("detail-art-img");
    
    if (detailArtCanvas) detailArtCanvas.classList.add("hidden");
    
    if (isValidImage(url)) {
        const cached = await resolveArtUrl(url);
        if (cached) {
            if (detailArtImg) {
                detailArtImg.src = cached;
                detailArtImg.classList.remove("hidden");
                detailArtImg.onerror = () => {
                    detailArtImg.classList.add("hidden");
                    drawDetailCanvas(title, artist);
                };
            }
            return;
        }
    }
    if (detailArtImg) detailArtImg.classList.add("hidden");
    drawDetailCanvas(title, artist);
}

export function drawDetailCanvas(title, artist) {
    const detailArtCanvas = document.getElementById("detail-art-canvas");
    if (!detailArtCanvas) return;
    
    const thumb = generateThumbnail(title, artist, 400);
    detailArtCanvas.width = thumb.width;
    detailArtCanvas.height = thumb.height;
    detailArtCanvas.getContext("2d").drawImage(thumb, 0, 0);
    detailArtCanvas.classList.remove("hidden");
}

export async function loadDetailLyrics(artist, title) {
    const detailLyricsEl = document.getElementById("detail-lyrics");
    if (!detailLyricsEl || !artist || !title) return;
    
    const id = ++lyricsRequestId;
    detailLyricsEl.textContent = "Loading lyrics…";
    try {
        const text = await invoke("fetch_lyrics", { artist, title });
        if (id !== lyricsRequestId) return;
        detailLyricsEl.textContent =
            text && String(text).trim()
                ? String(text).trim()
                : "No lyrics found for this track.";
    } catch (err) {
        if (id !== lyricsRequestId) return;
        detailLyricsEl.textContent = `Lyrics unavailable: ${String(err)}`;
    }
}

export async function fetchiTunesCoverArt(artist, title) {
    try {
        const query = `${artist} ${title}`;
        const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=1`;
        const res = await fetch(url);
        if (!res.ok) return null;
        const data = await res.json();
        if (data.results && data.results.length > 0) {
            const track = data.results[0];
            let artUrl = track.artworkUrl100;
            if (artUrl) {
                artUrl = artUrl.replace("100x100bb.jpg", "600x600bb.jpg")
                               .replace("100x100.jpg", "600x600.jpg");
                return artUrl;
            }
        }
    } catch (e) {
        console.warn("iTunes artwork fallback failed:", e);
    }
    return null;
}

export async function fetchAndShowMetadata(song) {
    const detailTitle = document.getElementById("detail-title");
    const detailMeta = document.getElementById("detail-meta");
    const requestId = ++metadataRequestId;
    try {
        const meta = await cachedInvoke("fetch_track_metadata", {
            artist: song.artist,
            track: song.title,
        });
        if (requestId !== metadataRequestId) return;

        song.album = meta.album || song.album;
        song.meta = meta;
        const allImages = mergeImages(
            meta.album_images || [],
            meta.track_images || [],
        );
        let bestUrl = pickBestImageUrl(allImages) || song.image;

        // If no valid Last.fm image or standard placeholder, fetch iTunes fallback!
        if (!bestUrl || bestUrl.includes("default") || bestUrl.includes("placeholder") || bestUrl.includes("2a96cbd8b46e442fc41c2b86b821562f")) {
            console.log(`No valid Last.fm image for "${song.title}". Querying iTunes fallback...`);
            const itunesArt = await fetchiTunesCoverArt(song.artist, song.title);
            if (itunesArt) {
                bestUrl = itunesArt;
            }
        }

        if (bestUrl) {
            song.image = bestUrl;
            song.images = allImages;
            await setNowPlaying(song);
            await setDetailArt(bestUrl, meta.title, meta.artist);
            updateScreensaverUI();
            
            updateRecentlyPlayedImage(song, bestUrl);
            saveLastPlayedSession(song);
            
            document
                .querySelectorAll(
                    `[data-song-key="${CSS.escape(songKey(song))}"]`,
                )
                .forEach((el) => {
                    const art = el.querySelector(".tile-art, .item-art");
                    if (art) {
                        const playBtn = art.querySelector(".tile-play-btn");
                        art.innerHTML = "";
                        appendArt(art, song, 300);
                        if (playBtn) art.appendChild(playBtn);
                        else if (el.classList.contains("song-tile"))
                            art.appendChild(createPlayButton(song, el));
                    }
                });
        }

        if (detailTitle) detailTitle.textContent = meta.title;
        setDetailArtistAlbum(meta.artist, meta.album || song.album);
        renderMetadataPanel(meta);
        loadDetailLyrics(meta.artist, meta.title);
    } catch (err) {
        if (requestId !== metadataRequestId) return;
        console.warn("fetchAndShowMetadata failed, trying iTunes direct fallback...", err);
        
        const itunesArt = await fetchiTunesCoverArt(song.artist, song.title);
        if (itunesArt) {
            song.image = itunesArt;
            await setNowPlaying(song);
            await setDetailArt(itunesArt, song.title, song.artist);
            updateScreensaverUI();
            
            updateRecentlyPlayedImage(song, itunesArt);
            saveLastPlayedSession(song);
        }
        
        if (detailMeta) {
            detailMeta.innerHTML = `<p class="detail-meta-error">Could not load metadata: ${escapeHtml(String(err))}</p>`;
        }
        loadDetailLyrics(song.artist, song.title);
    }
}

export function formatDuration(seconds) {
    if (seconds == null || seconds === "") return null;
    let n = Number(seconds);
    if (Number.isNaN(n)) return null;
    if (n > 7200) n = Math.floor(n / 1000);
    const m = Math.floor(n / 60);
    const s = Math.floor(n % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
}

export function renderMetadataPanel(meta) {
    const detailMeta = document.getElementById("detail-meta");
    if (!detailMeta) return;
    
    const rows = [];
    const dur = formatDuration(meta.duration_secs);
    if (dur) rows.push(["Duration", dur]);
    if (meta.listeners) rows.push(["Listeners", meta.listeners]);
    if (meta.playcount) rows.push(["Play count", meta.playcount]);
    if (meta.published) rows.push(["Published", meta.published]);
    if (meta.tags?.length) {
        rows.push(["Tags", meta.tags.map((t) => escapeHtml(t)).join(", ")]);
    }
    if (meta.wiki_summary) {
        const summary = stripHtml(meta.wiki_summary).trim();
        if (summary) {
            rows.push([
                "About",
                escapeHtml(
                    summary.length > 400
                        ? `${summary.slice(0, 400)}…`
                        : summary,
                ),
            ]);
        }
    }
    detailMeta.innerHTML = rows.length
        ? `<dl>${rows.map(([l, v]) => `<dt>${escapeHtml(l)}</dt><dd>${v}</dd>`).join("")}</dl>`
        : '<p class="detail-meta-loading">No extra metadata available.</p>';
}
