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
    cachedInvoke,
    updateScreensaverUI,
} from "../main.js";


import {
    isValidImage,
    generateThumbnail,
    mergeImages,
    songKey,
} from "../utils/media.js";

import { resolveArtUrl } from "../art.js";
import { resolveTrackCoverUrl } from "../utils/cover-art.js";
import { renderLyricsPanel, setLyricsPayload } from "./lyrics-sync.js";

const { invoke } = window.__TAURI__.core;

let lyricsRequestId = 0;
let metadataRequestId = 0;

function getMetadataSkeletonHTML() {
    return `
        <dl class="skeleton-meta-list skeleton-pulse-wrap">
            <dt><span class="skeleton-shimmer" style="width: 35%; height: 8px;"></span></dt>
            <dd><span class="skeleton-shimmer" style="width: 60%; height: 12px;"></span></dd>
            <dt><span class="skeleton-shimmer" style="width: 50%; height: 8px;"></span></dt>
            <dd><span class="skeleton-shimmer" style="width: 80%; height: 12px;"></span></dd>
            <dt><span class="skeleton-shimmer" style="width: 30%; height: 8px;"></span></dt>
            <dd><span class="skeleton-shimmer" style="width: 45%; height: 12px;"></span></dd>
        </dl>
    `;
}

function getLyricsSkeletonHTML() {
    return `
        <div class="skeleton-lyrics-container skeleton-pulse-wrap">
            <div class="skeleton-lyrics-line skeleton-shimmer" style="width: 85%;"></div>
            <div class="skeleton-lyrics-line skeleton-shimmer" style="width: 70%;"></div>
            <div class="skeleton-lyrics-line skeleton-shimmer" style="width: 90%;"></div>
            <div class="skeleton-lyrics-line skeleton-shimmer" style="width: 60%;"></div>
            <div class="skeleton-lyrics-line skeleton-shimmer" style="width: 75%;"></div>
        </div>
    `;
}

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
        detailMeta.innerHTML = getMetadataSkeletonHTML();
    }
    if (detailLyricsEl) detailLyricsEl.innerHTML = getLyricsSkeletonHTML();

    await resolveTrackCoverUrl(song);
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
    const detailArtImg = document.getElementById("detail-art");

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
    detailLyricsEl.innerHTML = getLyricsSkeletonHTML();

    const id = ++lyricsRequestId;
    try {
        const payload = await invoke("fetch_lyrics_payload", {
            artist,
            title,
        });
        if (id !== lyricsRequestId) return;
        setLyricsPayload(payload);
        renderLyricsPanel("detail-lyrics");
    } catch (err) {
        if (id !== lyricsRequestId) return;
        detailLyricsEl.innerHTML = `<div class="lyrics-empty">Lyrics unavailable: ${String(err)}</div>`;
    }
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
        const bestUrl = await resolveTrackCoverUrl(song, { meta });

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
        console.warn(
            "fetchAndShowMetadata failed, trying iTunes fallback...",
            err,
        );

        const fallbackUrl = await resolveTrackCoverUrl(song);
        if (fallbackUrl) {
            await setNowPlaying(song);
            await setDetailArt(fallbackUrl, song.title, song.artist);
            updateScreensaverUI();
            updateRecentlyPlayedImage(song, fallbackUrl);
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
