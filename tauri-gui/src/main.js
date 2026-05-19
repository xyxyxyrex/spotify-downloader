import {
    isValidImage as artIsValid,
    resolveArtUrl,
    applyArtToElement,
} from "./art.js";
import {
    loadPlaylistsFromDisk,
    persistPlaylists,
    createPlaylist,
    deletePlaylist,
    getPlaylist,
    addTrackToPlaylist,
    reorderPlaylistTracks,
    removePlaylistTrack,
    incrementPlayCount,
    playlistTotalDuration,
    trackToSong,
    getPlaylists,
    setActivePlaylistId,
    getActivePlaylistId,
    LIKED_SONGS_ID,
    isLikedPlaylist,
    isSongLiked,
    toggleLikedSong,
    getBestImage,
} from "./playlists.js";

const { invoke } = window.__TAURI__.core;

// Memory Cache
const memCache = new Map();
async function cachedInvoke(command, args = {}) {
    if (
        [
            "fetch_lastfm",
            "spotify_search",
            "fetch_track_metadata",
            "fetch_lyrics",
        ].includes(command)
    ) {
        const key = `${command}:${JSON.stringify(args)}`;
        if (memCache.has(key)) return memCache.get(key);
        const res = await invoke(command, args);
        memCache.set(key, res);
        return res;
    }
    return invoke(command, args);
}

const LASTFM_PLACEHOLDER = "2a96cbd8b46e442fc41c2b86b821562f";
const IMAGE_SIZE_ORDER = ["mega", "extralarge", "large", "medium", "small"];

const audioPlayer = new Audio();
// Allow Web Audio API processing for visualizer
audioPlayer.crossOrigin = "anonymous";
let audioContext = null;
let analyser = null;
let dataArray = null;
let visualizerInitialized = false;

let currentStreamData = null;
let isPlaying = false;
let currentSong = null;

// Discord Rich Presence helper
function updateDiscordPresence(song, paused = false) {
    if (!song) return;
    invoke("discord_update_presence", {
        payload: {
            title: song.title || "",
            artist: song.artist || "",
            album: song.album || null,
            imageUrl: song.image || null,
            paused,
        },
    }).catch(() => {});
}
function clearDiscordPresence() {
    invoke("discord_clear_presence").catch(() => {});
}
let metadataRequestId = 0;
let lyricsRequestId = 0;

const LAST_SESSION_KEY = "spotdl_gui_last_played";
let downloadedKeys = new Set();
let isBuffering = false;

// Queue System variables
let appQueue = [];
let queueIndex = -1;
let shuffleOn = false;
/** @type {'off' | 'all' | 'one'} */
let loopMode = "off";
let isSeeking = false;
/** Tracks shown on the album entity page (for next/prev). */
let albumViewSongs = [];

// Global flag to prevent buffer racing
let activePlayId = 0;

const views = {
    home: document.getElementById("view-home"),
    search: document.getElementById("view-search"),
    settings: document.getElementById("view-settings"),
    downloads: document.getElementById("view-downloads"),
    playlist: document.getElementById("view-playlist"),
    queue: document.getElementById("view-queue"),
    artist: document.getElementById("view-artist"),
    album: document.getElementById("view-album"),
};

const navs = {
    home: document.getElementById("nav-home"),
    search: document.getElementById("nav-search"),
    settings: document.getElementById("nav-settings"),
    downloads: document.getElementById("nav-downloads"),
};

const searchInput = document.getElementById("search-input");
const searchResultsList = document.getElementById("search-results-list");
const contextMenu = document.getElementById("context-menu");

const homeBrowse = document.getElementById("home-browse");
const homeCollection = document.getElementById("home-collection");
const homeCollectionTitle = document.getElementById("home-collection-title");
const homeCollectionSubtitle = document.getElementById(
    "home-collection-subtitle",
);
const homeCollectionGrid = document.getElementById("home-collection-grid");
const homeBackBtn = document.getElementById("home-back-btn");

const detailSidebar = document.getElementById("detail-sidebar");
const detailResizer = document.getElementById("detail-resizer");
const detailToggle = document.getElementById("detail-sidebar-toggle");
const detailEmpty = document.getElementById("detail-empty");
const detailContent = document.getElementById("detail-content");
const detailArtImg = document.getElementById("detail-art");
const detailArtCanvas = document.getElementById("detail-art-canvas");
const detailTitle = document.getElementById("detail-title");
const detailArtist = document.getElementById("detail-artist");
const detailAlbum = document.getElementById("detail-album");
const detailMeta = document.getElementById("detail-meta");
const detailLyricsEl = document.getElementById("detail-lyrics");

const cacheDirInput = document.getElementById("cache-dir-input");
const downloadDirInput = document.getElementById("download-dir-input");
const spotifyIdInput = document.getElementById("spotify-id-input");
const spotifySecretInput = document.getElementById("spotify-secret-input");
const lastfmApiKeyInput = document.getElementById("lastfm-api-key-input");
const apiStatusHint = document.getElementById("api-status-hint");
const settingsStatus = document.getElementById("settings-status");

let apiStatus = { spotify_configured: false, lastfm_configured: false };
const playlistListEl = document.getElementById("playlist-list");
const viewModeGridBtn = document.getElementById("view-mode-grid");
const viewModeListBtn = document.getElementById("view-mode-list");

const btnPlay = document.getElementById("btn-play");
const btnPrev = document.getElementById("btn-prev");
const btnNext = document.getElementById("btn-next");
const btnShuffle = document.getElementById("btn-shuffle");
const btnLoop = document.getElementById("btn-loop");
const npLikeBtn = document.getElementById("np-like-btn");
const nowPlayingEl = document.getElementById("now-playing");
const progressBar = document.getElementById("progress-bar");
const timeCurrent = document.getElementById("time-current");
const timeTotal = document.getElementById("time-total");
const npArt = document.getElementById("np-art");
const npDownloadedBadge = document.getElementById("np-downloaded-badge");
const volumeBar = document.getElementById("volume-bar");
const bufferProgressWrap = document.getElementById("buffer-progress-wrap");
const statusBar = document.getElementById("status-bar");

let selectedSong = null;
let selectedItems = []; // [{ key, song }]
let selectedGroup = null; // { type: 'album' | 'playlist', name: string, fetchTracks: () => Promise<Song[]> }
let currentCollection = null;
let currentCollectionSongs = [];
let downloadsSearchQuery = "";
const downloadActivity = new Map(); // key -> { song, stage, startedAt }
let collectionViewMode =
    localStorage.getItem("collectionViewMode") === "list" ? "list" : "grid";
/** Where to return when leaving artist/album pages. */
let browseContext = { view: "home", homeCollection: null };

const PALETTE = [
    "#e74c3c",
    "#e67e22",
    "#f1c40f",
    "#2ecc71",
    "#1abc9c",
    "#3498db",
    "#9b59b6",
    "#e91e63",
    "#00bcd4",
    "#ff5722",
    "#795548",
    "#607d8b",
    "#8bc34a",
    "#673ab7",
    "#ff9800",
];

function buildHomeCollections(geoCountry) {
    const country =
        (geoCountry && String(geoCountry).trim()) || "United States";
    const countryEnc = encodeURIComponent(country);
    /** Each entry is a browse *group* (opens to tracks or albums). */
    return [
        {
            id: "top-100-global",
            row: "charts",
            title: "Top 100 · Global",
            subtitle: "Worldwide chart · 100 tracks",
            type: "tracks",
            load: () => fetchChartTracks("chart.gettoptracks", "&limit=100"),
            preview: () => fetchChartTracks("chart.gettoptracks", "&limit=1"),
        },
        {
            id: "top-100-local",
            row: "charts",
            title: `Top 100 · ${country}`,
            subtitle: "Regional chart · 100 tracks",
            type: "tracks",
            load: () =>
                fetchChartTracks(
                    "geo.gettoptracks",
                    `&country=${countryEnc}&limit=100`,
                ),
            preview: () =>
                fetchChartTracks(
                    "geo.gettoptracks",
                    `&country=${countryEnc}&limit=1`,
                ),
        },
        {
            id: "top-tracks-global",
            row: "charts",
            title: "Top tracks · Global",
            subtitle: "Chart · 50 tracks",
            type: "tracks",
            load: () => fetchChartTracks("chart.gettoptracks", "&limit=50"),
            preview: () => fetchChartTracks("chart.gettoptracks", "&limit=1"),
        },
        {
            id: "top-tracks-local",
            row: "charts",
            title: `Top tracks · ${country}`,
            subtitle: "Regional · 50 tracks",
            type: "tracks",
            load: () =>
                fetchChartTracks(
                    "geo.gettoptracks",
                    `&country=${countryEnc}&limit=50`,
                ),
            preview: () =>
                fetchChartTracks(
                    "geo.gettoptracks",
                    `&country=${countryEnc}&limit=1`,
                ),
        },
        {
            id: "top-hiphop-tracks",
            row: "tracks",
            title: "Top Hip Hop tracks",
            subtitle: "Tag chart · 50 tracks",
            type: "tracks",
            load: () =>
                fetchChartTracks("tag.gettoptracks", "&tag=hip-hop&limit=50"),
            preview: () =>
                fetchChartTracks("tag.gettoptracks", "&tag=hip-hop&limit=1"),
        },
        {
            id: "top-electronic-tracks",
            row: "tracks",
            title: "Top Electronic tracks",
            subtitle: "Tag chart · 50 tracks",
            type: "tracks",
            load: () =>
                fetchChartTracks(
                    "tag.gettoptracks",
                    "&tag=electronic&limit=50",
                ),
            preview: () =>
                fetchChartTracks("tag.gettoptracks", "&tag=electronic&limit=1"),
        },
        {
            id: "top-albums-pop",
            row: "albums",
            title: "Top albums · Pop",
            subtitle: "Tag chart · 50 albums",
            type: "albums",
            load: () =>
                fetchChartAlbums("tag.gettopalbums", "&tag=pop&limit=50"),
            preview: () =>
                fetchChartAlbums("tag.gettopalbums", "&tag=pop&limit=1"),
        },
        {
            id: "top-albums-hiphop",
            row: "albums",
            title: "Top albums · Hip hop",
            subtitle: "Tag chart · 50 albums",
            type: "albums",
            load: () =>
                fetchChartAlbums("tag.gettopalbums", "&tag=hip-hop&limit=50"),
            preview: () =>
                fetchChartAlbums("tag.gettopalbums", "&tag=hip-hop&limit=1"),
        },
        {
            id: "viral-50-global",
            row: "charts",
            title: "Viral 50 · Global",
            subtitle: "Chart · 50 tracks",
            type: "tracks",
            load: () => fetchChartTracks("chart.gettoptracks", "&limit=50"),
            preview: () => fetchChartTracks("chart.gettoptracks", "&limit=1"),
        },
        {
            id: "top-rock-tracks",
            row: "tracks",
            title: "Top Rock tracks",
            subtitle: "Tag chart · 50 tracks",
            type: "tracks",
            load: () =>
                fetchChartTracks("tag.gettoptracks", "&tag=rock&limit=50"),
            preview: () =>
                fetchChartTracks("tag.gettoptracks", "&tag=rock&limit=1"),
        },
        {
            id: "top-pop-tracks",
            row: "tracks",
            title: "Top Pop tracks",
            subtitle: "Tag chart · 50 tracks",
            type: "tracks",
            load: () =>
                fetchChartTracks("tag.gettoptracks", "&tag=pop&limit=50"),
            preview: () =>
                fetchChartTracks("tag.gettoptracks", "&tag=pop&limit=1"),
        },
        {
            id: "top-rnb-tracks",
            row: "tracks",
            title: "Top R&B tracks",
            subtitle: "Tag chart · 50 tracks",
            type: "tracks",
            load: () =>
                fetchChartTracks("tag.gettoptracks", "&tag=r-n-b&limit=50"),
            preview: () =>
                fetchChartTracks("tag.gettoptracks", "&tag=r-n-b&limit=1"),
        },
        {
            id: "top-indie-tracks",
            row: "tracks",
            title: "Top Indie tracks",
            subtitle: "Tag chart · 50 tracks",
            type: "tracks",
            load: () =>
                fetchChartTracks("tag.gettoptracks", "&tag=indie&limit=50"),
            preview: () =>
                fetchChartTracks("tag.gettoptracks", "&tag=indie&limit=1"),
        },
        {
            id: "top-metal-tracks",
            row: "tracks",
            title: "Top Metal tracks",
            subtitle: "Tag chart · 50 tracks",
            type: "tracks",
            load: () =>
                fetchChartTracks("tag.gettoptracks", "&tag=metal&limit=50"),
            preview: () =>
                fetchChartTracks("tag.gettoptracks", "&tag=metal&limit=1"),
        },
        {
            id: "top-dance-tracks",
            row: "tracks",
            title: "Top Dance tracks",
            subtitle: "Tag chart · 50 tracks",
            type: "tracks",
            load: () =>
                fetchChartTracks("tag.gettoptracks", "&tag=dance&limit=50"),
            preview: () =>
                fetchChartTracks("tag.gettoptracks", "&tag=dance&limit=1"),
        },
        {
            id: "top-latin-tracks",
            row: "tracks",
            title: "Top Latin tracks",
            subtitle: "Tag chart · 50 tracks",
            type: "tracks",
            load: () =>
                fetchChartTracks("tag.gettoptracks", "&tag=latino&limit=50"),
            preview: () =>
                fetchChartTracks("tag.gettoptracks", "&tag=latino&limit=1"),
        },
        {
            id: "top-albums-rock",
            row: "albums",
            title: "Top albums · Rock",
            subtitle: "Tag chart · 50 albums",
            type: "albums",
            load: () =>
                fetchChartAlbums("tag.gettopalbums", "&tag=rock&limit=50"),
            preview: () =>
                fetchChartAlbums("tag.gettopalbums", "&tag=rock&limit=1"),
        },
        {
            id: "top-albums-electronic",
            row: "albums",
            title: "Top albums · Electronic",
            subtitle: "Tag chart · 50 albums",
            type: "albums",
            load: () =>
                fetchChartAlbums(
                    "tag.gettopalbums",
                    "&tag=electronic&limit=50",
                ),
            preview: () =>
                fetchChartAlbums("tag.gettopalbums", "&tag=electronic&limit=1"),
        },
        {
            id: "top-albums-indie",
            row: "albums",
            title: "Top albums · Indie",
            subtitle: "Tag chart · 50 albums",
            type: "albums",
            load: () =>
                fetchChartAlbums("tag.gettopalbums", "&tag=indie&limit=50"),
            preview: () =>
                fetchChartAlbums("tag.gettopalbums", "&tag=indie&limit=1"),
        },
        {
            id: "top-albums-rnb",
            row: "albums",
            title: "Top albums · R&B",
            subtitle: "Tag chart · 50 albums",
            type: "albums",
            load: () =>
                fetchChartAlbums("tag.gettopalbums", "&tag=r-n-b&limit=50"),
            preview: () =>
                fetchChartAlbums("tag.gettopalbums", "&tag=r-n-b&limit=1"),
        },
    ];
}

/** Filled after geo lookup (see DOMContentLoaded). */
let homeCollections = buildHomeCollections("United States");

function songKey(song) {
    return `${song.artist}::${song.title}`;
}

function hashColor(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return PALETTE[Math.abs(hash) % PALETTE.length];
}

function generateThumbnail(title, artist, size) {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    const color1 = hashColor(title + artist);
    const color2 = hashColor(artist + title);
    const grad = ctx.createLinearGradient(0, 0, size, size);
    grad.addColorStop(0, color1);
    grad.addColorStop(1, color2);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.font = `bold ${size * 0.3}px serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("♫", size / 2, size * 0.35);
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${Math.max(10, size * 0.09)}px Consolas, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const maxWidth = size * 0.85;
    const words = title.split(" ");
    const lines = [];
    let currentLine = "";
    for (const word of words) {
        const test = currentLine ? `${currentLine} ${word}` : word;
        if (ctx.measureText(test).width > maxWidth && currentLine) {
            lines.push(currentLine);
            currentLine = word;
        } else {
            currentLine = test;
        }
        if (lines.length >= 2) break;
    }
    if (currentLine && lines.length < 3) lines.push(currentLine);
    const lineHeight = size * 0.12;
    const startY = size * 0.58;
    lines.forEach((line, i) => {
        ctx.fillText(line, size / 2, startY + i * lineHeight);
    });
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = `${Math.max(8, size * 0.07)}px Consolas, monospace`;
    const artistY = startY + lines.length * lineHeight + size * 0.06;
    const artistText =
        artist.length > 20 ? `${artist.substring(0, 18)}…` : artist;
    ctx.fillText(artistText, size / 2, artistY);
    return canvas;
}

function isValidImage(url) {
    return artIsValid(url);
}

function pickBestImageUrl(images) {
    if (!images?.length) return null;
    for (const size of IMAGE_SIZE_ORDER) {
        const found = images.find((img) => img.size === size);
        if (found?.url && isValidImage(found.url)) return found.url;
    }
    return images.find((img) => isValidImage(img.url))?.url ?? null;
}

function parseImagesFromLastFm(imageArray) {
    if (!Array.isArray(imageArray)) return [];
    return imageArray
        .map((img) => ({
            size: img.size || "unknown",
            url: img["#text"] || "",
        }))
        .filter((img) => isValidImage(img.url));
}

function mergeImages(...lists) {
    const seen = new Set();
    const out = [];
    for (const list of lists) {
        for (const img of list) {
            if (!seen.has(img.url)) {
                seen.add(img.url);
                out.push(img);
            }
        }
    }
    return out;
}

function pickAnyValidFromRaw(imageArray) {
    if (!Array.isArray(imageArray)) return null;
    for (let i = imageArray.length - 1; i >= 0; i--) {
        const url = imageArray[i]["#text"];
        if (isValidImage(url)) return url;
    }
    return null;
}

function extractImageFromLastFmTrack(track) {
    const images = mergeImages(
        parseImagesFromLastFm(track.image),
        track.album?.image ? parseImagesFromLastFm(track.album.image) : [],
    );
    return pickBestImageUrl(images) || pickAnyValidFromRaw(track.image);
}

function extractImageFromLastFmAlbum(album) {
    const images = parseImagesFromLastFm(album.image);
    return pickBestImageUrl(images) || pickAnyValidFromRaw(album.image);
}

function normalizeDurationSecs(raw) {
    if (raw == null || raw === "") return null;
    let n = Number(raw);
    if (Number.isNaN(n)) return null;
    if (n > 7200) n = Math.floor(n / 1000);
    return n;
}

// --- Queue Logic ---
function renderQueueUI() {
    const list = document.getElementById("queue-list");
    const msg = document.getElementById("queue-empty-msg");
    list.innerHTML = "";

    if (appQueue.length === 0) {
        msg.style.display = "block";
        return;
    }

    msg.style.display = "none";

    appQueue.forEach((song, idx) => {
        const item = document.createElement("div");
        item.className = "song-item";
        item.style.display = "flex";
        item.style.alignItems = "center";
        item.style.justifyContent = "space-between";
        item.style.padding = "10px";
        item.style.background =
            idx === queueIndex ? "var(--accent-hover)" : "#222";
        item.style.borderRadius = "6px";
        item.style.cursor = "pointer";
        item.draggable = true;

        applyDownloadedState(item, song);

        item.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            e.stopPropagation();
            selectedSong = song;
            selectedGroup = null;
            refreshContextMenuForSong(song);
            showContextMenuAt(e.clientX, e.clientY);
        });

        const info = document.createElement("div");
        const titleStrong = document.createElement("strong");
        titleStrong.style.color =
            idx === queueIndex ? "var(--primary-color)" : "#fff";
        titleStrong.textContent = song.title;
        const artistWrap = document.createElement("span");
        artistWrap.style.fontSize = "12px";
        artistWrap.style.color = "#888";
        artistWrap.appendChild(artistLinkEl(song.artist));
        info.appendChild(titleStrong);
        info.appendChild(document.createElement("br"));
        info.appendChild(artistWrap);

        info.onclick = () => {
            queueIndex = idx;
            renderQueueUI();
            playSong(song);
        };

        const removeBtn = document.createElement("button");
        removeBtn.innerHTML = "×";
        removeBtn.style.background = "transparent";
        removeBtn.style.border = "none";
        removeBtn.style.color = "#aaa";
        removeBtn.style.cursor = "pointer";
        removeBtn.style.fontSize = "18px";
        removeBtn.onclick = (e) => {
            e.stopPropagation();
            removeFromQueue(idx);
        };

        // Drag/Drop hooks
        item.ondragstart = (e) => {
            e.dataTransfer.setData("text/plain", idx);
            item.style.opacity = "0.5";
        };
        item.ondragend = () => {
            item.style.opacity = "1";
        };
        item.ondragover = (e) => e.preventDefault();
        item.ondrop = (e) => {
            e.preventDefault();
            const fromIdx = parseInt(e.dataTransfer.getData("text/plain"));
            if (fromIdx !== idx) {
                const moved = appQueue.splice(fromIdx, 1)[0];
                appQueue.splice(idx, 0, moved);
                // Adjust active index
                if (queueIndex === fromIdx) queueIndex = idx;
                else if (queueIndex > fromIdx && queueIndex <= idx)
                    queueIndex--;
                else if (queueIndex < fromIdx && queueIndex >= idx)
                    queueIndex++;
                renderQueueUI();
            }
        };

        item.appendChild(info);
        item.appendChild(removeBtn);
        list.appendChild(item);
    });
}

function removeFromQueue(idx) {
    appQueue.splice(idx, 1);
    if (queueIndex === idx) {
        queueIndex--; // Reset to previous so next song plays correctly
        setTimeout(playNextInQueue, 300);
    } else if (queueIndex > idx) {
        queueIndex--;
    }
    renderQueueUI();
}

function syncQueueIndexForSong(song) {
    if (!song) return;
    const idx = appQueue.findIndex((s) => songKey(s) === songKey(song));
    if (idx >= 0) queueIndex = idx;
}

function cloneSongForQueue(song) {
    return {
        title: song.title,
        artist: song.artist,
        album: song.album ?? null,
        image: song.image ?? null,
        duration: song.duration ?? song.duration_secs ?? null,
        spotify_url: song.spotify_url ?? null,
        playlist_track_id: song.playlist_track_id ?? null,
    };
}

/** Set the list used for next/previous and mirror it in the queue panel. */
function setPlaybackQueue(songs, startSong) {
    appQueue = (songs || []).map(cloneSongForQueue);
    if (!appQueue.length) {
        queueIndex = -1;
        renderQueueUI();
        return;
    }
    if (startSong) {
        const idx = appQueue.findIndex(
            (s) => songKey(s) === songKey(startSong),
        );
        queueIndex = idx >= 0 ? idx : 0;
    } else {
        queueIndex = 0;
    }
    renderQueueUI();
}

function resolvePlaybackQueueForSong(song, explicitQueue) {
    if (explicitQueue?.length) return explicitQueue;
    if (
        currentCollectionSongs?.length &&
        !homeCollection.classList.contains("hidden")
    ) {
        return currentCollectionSongs;
    }
    if (
        albumViewSongs?.length &&
        views.album &&
        !views.album.classList.contains("hidden")
    ) {
        return albumViewSongs;
    }
    const plId = getActivePlaylistId();
    if (
        plId &&
        views.playlist &&
        !views.playlist.classList.contains("hidden")
    ) {
        const pl = getPlaylist(plId);
        if (pl?.tracks?.length) {
            return [...pl.tracks]
                .sort((a, b) => a.order - b.order)
                .map(trackToSong);
        }
    }
    return null;
}

function getNextQueueIndex() {
    if (appQueue.length === 0) return -1;
    if (appQueue.length === 1) return 0;
    if (shuffleOn) {
        let next;
        let attempts = 0;
        do {
            next = Math.floor(Math.random() * appQueue.length);
            attempts++;
        } while (next === queueIndex && attempts < 12);
        return next;
    }
    if (queueIndex + 1 < appQueue.length) return queueIndex + 1;
    if (loopMode === "all") return 0;
    return -1;
}

function getPrevQueueIndex() {
    if (appQueue.length === 0) return -1;
    if (appQueue.length === 1) return 0;
    if (shuffleOn) {
        let prev;
        let attempts = 0;
        do {
            prev = Math.floor(Math.random() * appQueue.length);
            attempts++;
        } while (prev === queueIndex && attempts < 12);
        return prev;
    }
    if (queueIndex > 0) return queueIndex - 1;
    if (loopMode === "all") return appQueue.length - 1;
    return -1;
}

function playPreviousTrack() {
    if (appQueue.length === 0) return;
    const prev = getPrevQueueIndex();
    if (prev < 0) return;
    queueIndex = prev;
    renderQueueUI();
    playSong(appQueue[queueIndex]);
}

function playNextTrack() {
    if (loopMode === "one" && currentSong) {
        playSong(currentSong);
        return;
    }
    if (appQueue.length === 0) return;
    const next = getNextQueueIndex();
    if (next < 0) return;
    queueIndex = next;
    renderQueueUI();
    playSong(appQueue[queueIndex]);
}

function onTrackEnded() {
    btnPlay.textContent = "▶";
    isPlaying = false;
    clearDiscordPresence();
    
    // Add to listening history when track ends
    if (currentSong) {
        invoke("add_to_history", { track: currentSong }).catch(err => console.error("Failed to add to history:", err));
    }
    
    if (loopMode === "one" && currentSong) {
        playSong(currentSong);
        return;
    }
    playNextTrack();
}

function updateShuffleButton() {
    if (!btnShuffle) return;
    btnShuffle.classList.toggle("active", shuffleOn);
    btnShuffle.setAttribute("aria-pressed", String(shuffleOn));
    btnShuffle.title = shuffleOn ? "Shuffle on" : "Shuffle off";
}

function updateLoopButton() {
    if (!btnLoop) return;
    btnLoop.classList.toggle("active", loopMode !== "off");
    btnLoop.setAttribute("aria-pressed", String(loopMode !== "off"));
    btnLoop.dataset.loopMode = loopMode;
    const labels = {
        off: "Repeat off",
        all: "Repeat all",
        one: "Repeat one",
    };
    btnLoop.title = labels[loopMode];
    btnLoop.textContent = "↻";
}

function updateLikeButton() {
    if (!npLikeBtn) return;
    const hasTrack = Boolean(currentSong?.title && currentSong?.artist);
    npLikeBtn.disabled = !hasTrack;
    if (!hasTrack) {
        npLikeBtn.classList.remove("liked");
        npLikeBtn.textContent = "♡";
        npLikeBtn.title = "Save to Liked Songs";
        return;
    }
    const liked = isSongLiked(currentSong);
    npLikeBtn.classList.toggle("liked", liked);
    npLikeBtn.textContent = liked ? "♥" : "♡";
    npLikeBtn.title = liked ? "Remove from Liked Songs" : "Save to Liked Songs";
}

function refreshContextMenuForSong(song) {
    const likedItem = document.getElementById("cm-liked");
    const removeFromPlaylistItem = document.getElementById(
        "cm-remove-from-playlist",
    );
    if (likedItem && song) {
        likedItem.textContent = isSongLiked(song)
            ? "Remove from Liked Songs"
            : "Add to Liked Songs";
    }
    const activePlaylistId = getActivePlaylistId();
    const inActivePlaylist = Boolean(
        activePlaylistId &&
        (selectedItems.length
            ? selectedItems.some((item) => item.song?.playlist_track_id)
            : song?.playlist_track_id),
    );
    removeFromPlaylistItem?.classList.toggle("hidden", !inActivePlaylist);
    document.getElementById("cm-download-group").classList.add("hidden");
    document.getElementById("cm-download").classList.remove("hidden");
    document.getElementById("cm-queue").classList.remove("hidden");
    document.getElementById("cm-liked")?.classList.remove("hidden");
    document.getElementById("cm-playlist").classList.remove("hidden");
    document.getElementById("cm-artist").classList.remove("hidden");
}

function refreshContextMenuForGroup(group) {
    const dlGroup = document.getElementById("cm-download-group");
    dlGroup.textContent = `Download ${group.type === "album" ? "Album" : "Playlist"}`;
    dlGroup.classList.remove("hidden");
    document.getElementById("cm-download").classList.add("hidden");
    document.getElementById("cm-queue").classList.add("hidden");
    document.getElementById("cm-liked")?.classList.add("hidden");
    document.getElementById("cm-playlist").classList.add("hidden");
    document.getElementById("cm-artist").classList.add("hidden");
}

function getSongSelectionKey(song) {
    return song?.playlist_track_id
        ? `playlist-track:${song.playlist_track_id}`
        : `song:${songKey(song)}`;
}

function getSelectedSongs() {
    if (selectedItems.length) {
        return selectedItems.map((item) => item.song);
    }
    return selectedSong ? [selectedSong] : [];
}

function getUniqueSelectedSongs() {
    const seen = new Set();
    return getSelectedSongs().filter((song) => {
        const key = getSongSelectionKey(song);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function isSelectionKeySelected(selectionKey) {
    return selectedItems.some((item) => item.key === selectionKey);
}

function syncSelectedSongClasses() {
    document.querySelectorAll("[data-selection-key]").forEach((el) => {
        el.classList.toggle(
            "selected",
            isSelectionKeySelected(el.dataset.selectionKey),
        );
    });
}

let lastSelectedElement = null;

function setSelectedItems(items, primarySong = null) {
    selectedItems = items;
    selectedSong = primarySong ?? items[0]?.song ?? null;
    selectedGroup = null;
    syncSelectedSongClasses();
}

function setSingleSongSelection(song, element, selectionKey) {
    setSelectedItems([{ key: selectionKey, song }], song);
    if (element) element.classList.add("selected");
    lastSelectedElement = element;
}

function toggleSongSelection(song, element, selectionKey) {
    const idx = selectedItems.findIndex((item) => item.key === selectionKey);
    if (idx >= 0) {
        selectedItems.splice(idx, 1);
        element?.classList.remove("selected");
    } else {
        selectedItems.push({ key: selectionKey, song });
        element?.classList.add("selected");
        lastSelectedElement = element;
    }
    selectedSong = song;
    selectedGroup = null;
}

function handleSongClick(e, song, element, selectionKey) {
    if (e.target.closest(".meta-link")) return;
    
    if (e.shiftKey && lastSelectedElement && lastSelectedElement.parentNode === element.parentNode) {
        const parent = element.parentNode;
        const children = Array.from(parent.children).filter(c => c.__song);
        const idx1 = children.indexOf(lastSelectedElement);
        const idx2 = children.indexOf(element);
        
        if (idx1 >= 0 && idx2 >= 0) {
            const min = Math.min(idx1, idx2);
            const max = Math.max(idx1, idx2);
            const items = [];
            for (let i = min; i <= max; i++) {
                const child = children[i];
                if (child.__song) {
                    items.push({ key: getSongSelectionKey(child.__song), song: child.__song });
                }
            }
            setSelectedItems(items, song);
            return;
        }
    }

    if (e.ctrlKey || e.metaKey) {
        toggleSongSelection(song, element, selectionKey);
        return;
    }
    selectSong(song, element);
}

/** Keep context menu fully visible (e.g. when opened from the player bar). */
function showContextMenuAt(clientX, clientY) {
    if (!contextMenu) return;
    contextMenu.classList.remove("hidden");
    const pad = 8;
    const w = contextMenu.offsetWidth;
    const h = contextMenu.offsetHeight;
    let x = clientX;
    let y = clientY;
    if (x + w > window.innerWidth - pad) {
        x = Math.max(pad, window.innerWidth - w - pad);
    }
    if (y + h > window.innerHeight - pad) {
        y = Math.max(pad, window.innerHeight - h - pad);
    }
    if (x < pad) x = pad;
    if (y < pad) y = pad;
    contextMenu.style.left = `${x}px`;
    contextMenu.style.top = `${y}px`;
}

function setupNowPlayingContext() {
    if (!nowPlayingEl) return;
    nowPlayingEl.addEventListener("contextmenu", (e) => {
        if (!currentSong) return;
        e.preventDefault();
        selectedSong = currentSong;
        refreshContextMenuForSong(selectedSong);
        showContextMenuAt(e.clientX, e.clientY);
    });
}

function setupLikeButton() {
    npLikeBtn?.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!currentSong) return;
        const liked = await toggleLikedSong(currentSong);
        updateLikeButton();
        renderPlaylistSidebar();
        statusBar.textContent = liked
            ? `Added to Liked Songs: ${currentSong.title}`
            : `Removed from Liked Songs: ${currentSong.title}`;
        if (getActivePlaylistId() === LIKED_SONGS_ID) {
            openPlaylistView(LIKED_SONGS_ID);
        }
    });
}

function formatDuration(seconds) {
    const n = normalizeDurationSecs(seconds);
    if (!n) return null;
    const m = Math.floor(n / 60);
    const s = Math.floor(n % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
}

function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

function artistLinkEl(name, extra = {}) {
    if (!name || name === "—") {
        return document.createTextNode("—");
    }
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "meta-link meta-link-artist";
    btn.dataset.artist = name;
    if (extra.spotifyUrl) btn.dataset.spotifyUrl = extra.spotifyUrl;
    btn.textContent = name;
    return btn;
}

function albumLinkEl(title, artist, extra = {}) {
    if (!title || title === "—") {
        return document.createTextNode("—");
    }
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "meta-link meta-link-album";
    btn.dataset.album = title;
    btn.dataset.artist = artist || "";
    if (extra.spotifyUrl) btn.dataset.spotifyUrl = extra.spotifyUrl;
    btn.textContent = title;
    return btn;
}

function setDetailArtistAlbum(artist, album) {
    detailArtist.replaceChildren(
        artist ? artistLinkEl(artist) : document.createTextNode("—"),
    );
    detailAlbum.replaceChildren(
        album ? albumLinkEl(album, artist) : document.createTextNode("—"),
    );
}

function getActiveMainView() {
    for (const [key, el] of Object.entries(views)) {
        if (el && !el.classList.contains("hidden")) return key;
    }
    return "home";
}

function captureBrowseContext() {
    const view = getActiveMainView();
    browseContext = {
        view,
        homeCollection:
            view === "home" && !homeCollection.classList.contains("hidden")
                ? currentCollection
                : null,
    };
}

function showEntityView(entityKey) {
    Object.values(views).forEach((v) => v?.classList.add("hidden"));
    Object.values(navs).forEach((n) => n?.classList.remove("active"));
    views[entityKey]?.classList.remove("hidden");
}

function restoreBrowseContext() {
    const ctx = browseContext;
    if (ctx.view === "home") {
        window.switchView("home");
        if (ctx.homeCollection) {
            openCollection(ctx.homeCollection, { skipContext: true });
        } else {
            showHomeBrowse();
        }
        return;
    }
    window.switchView(ctx.view);
}

function setupEntityPages() {
    document
        .getElementById("artist-back-btn")
        ?.addEventListener("click", () => {
            restoreBrowseContext();
        });
    document.getElementById("album-back-btn")?.addEventListener("click", () => {
        restoreBrowseContext();
    });

    document.addEventListener("click", (e) => {
        const artistEl = e.target.closest(".meta-link-artist");
        if (artistEl?.dataset.artist) {
            e.preventDefault();
            e.stopPropagation();
            openArtistPage(artistEl.dataset.artist, {
                spotifyUrl: artistEl.dataset.spotifyUrl || undefined,
            });
            return;
        }
        const albumEl = e.target.closest(".meta-link-album");
        if (albumEl?.dataset.album) {
            e.preventDefault();
            e.stopPropagation();
            openAlbumPage(albumEl.dataset.album, albumEl.dataset.artist, {
                spotifyUrl: albumEl.dataset.spotifyUrl || undefined,
            });
        }
    });
}

async function resolveSpotifyArtistUrl(artistName) {
    const data = await runSpotifySearch(artistName);
    const list = data.artists || [];
    const exact = list.find(
        (a) => a.name?.toLowerCase() === artistName.toLowerCase(),
    );
    return (exact || list[0])?.url || null;
}

async function openArtistPage(artistName, opts = {}) {
    const name = String(artistName || "").trim();
    if (!name) return;
    if (!opts.skipContext) captureBrowseContext();
    showEntityView("artist");

    const nameEl = document.getElementById("artist-page-name");
    const metaEl = document.getElementById("artist-page-meta");
    const artEl = document.getElementById("artist-hero-art");
    const tracksEl = document.getElementById("artist-top-tracks");
    const albumsEl = document.getElementById("artist-albums-grid");

    nameEl.textContent = name;
    metaEl.textContent = "Loading…";
    artEl.innerHTML = "";
    tracksEl.innerHTML = '<span class="loading-text">Loading tracks…</span>';
    albumsEl.innerHTML = '<span class="loading-text">Loading albums…</span>';

    try {
        let spotifyUrl = opts.spotifyUrl;
        if (!spotifyUrl && apiStatus.spotify_configured) {
            try {
                spotifyUrl = await resolveSpotifyArtistUrl(name);
            } catch {
                /* Last.fm fallback */
            }
        }
        if (spotifyUrl && apiStatus.spotify_configured) {
            try {
                const data = await runSpotifySearch(spotifyUrl);
                if (data.type === "artist") {
                    await renderArtistPageFromSpotify(data, {
                        artEl,
                        metaEl,
                        tracksEl,
                        albumsEl,
                        name,
                    });
                    statusBar.textContent = `Artist: ${name}`;
                    return;
                }
            } catch (spotifyErr) {
                console.warn(
                    "Spotify artist load failed, trying Last.fm:",
                    spotifyErr,
                );
            }
        }
        await renderArtistPageFromLastFm(name, {
            artEl,
            metaEl,
            tracksEl,
            albumsEl,
        });
        statusBar.textContent = `Artist: ${name}`;
    } catch (err) {
        metaEl.textContent = `Failed to load artist: ${err}`;
        tracksEl.innerHTML = "";
        albumsEl.innerHTML = "";
    }
}

async function renderArtistPageFromSpotify(data, ctx) {
    const genres = (data.genres || []).slice(0, 4).join(" · ");
    const albumCount = data.albums?.length || 0;
    ctx.metaEl.textContent = [genres, albumCount ? `${albumCount} albums` : ""]
        .filter(Boolean)
        .join(" · ");

    const heroImage =
        data.albums?.[0]?.cover_url || data.tracks?.[0]?.image || null;
    ctx.artEl.innerHTML = "";
    if (heroImage && isValidImage(heroImage)) {
        const img = document.createElement("img");
        img.src = heroImage;
        img.alt = ctx.name;
        ctx.artEl.appendChild(img);
    } else {
        ctx.artEl.appendChild(generateThumbnail(ctx.name, "Artist", 168));
    }

    const topTracks = (data.tracks || []).map(mapSpotifyTrack);
    ctx.tracksEl.innerHTML = "";
    if (topTracks.length) {
        await renderSongList(topTracks, ctx.tracksEl);
        enrichSongsArt(topTracks, ctx.tracksEl);
    } else {
        ctx.tracksEl.innerHTML =
            '<span class="loading-text">No top tracks found.</span>';
    }

    const albums = (data.albums || []).map((a) => ({
        title: a.name,
        artist: data.name,
        image: a.cover_url || null,
        spotify_url: a.url,
        isAlbum: true,
    }));
    ctx.albumsEl.innerHTML = "";
    if (albums.length) {
        await renderAlbumGrid(albums, ctx.albumsEl);
    } else {
        ctx.albumsEl.innerHTML =
            '<span class="loading-text">No albums found.</span>';
    }
}

async function renderArtistPageFromLastFm(name, ctx) {
    const enc = encodeURIComponent(name);
    const [infoRaw, tracksRaw, albumsRaw] = await Promise.all([
        cachedInvoke("fetch_lastfm", {
            method: "artist.getInfo",
            extraParams: `&artist=${enc}`,
        }),
        cachedInvoke("fetch_lastfm", {
            method: "artist.getTopTracks",
            extraParams: `&artist=${enc}&limit=12`,
        }),
        cachedInvoke("fetch_lastfm", {
            method: "artist.getTopAlbums",
            extraParams: `&artist=${enc}&limit=50`,
        }),
    ]);

    const info = JSON.parse(infoRaw);
    if (info.error) throw new Error(info.message || "Last.fm error");
    const artistInfo = info.artist || {};

    const tags = (artistInfo.tags?.tag || [])
        .map((t) => (typeof t === "string" ? t : t.name))
        .filter(Boolean)
        .slice(0, 4);
    const listeners = artistInfo.stats?.listeners;
    ctx.metaEl.textContent = [
        tags.join(" · "),
        listeners ? `${Number(listeners).toLocaleString()} listeners` : "",
    ]
        .filter(Boolean)
        .join(" · ");

    const imageUrl =
        pickBestImageUrl(parseImagesFromLastFm(artistInfo.image)) ||
        pickAnyValidFromRaw(artistInfo.image);
    ctx.artEl.innerHTML = "";
    if (imageUrl) {
        const cached = await resolveArtUrl(imageUrl);
        const img = document.createElement("img");
        img.src = cached || imageUrl;
        img.alt = name;
        ctx.artEl.appendChild(img);
    } else {
        ctx.artEl.appendChild(generateThumbnail(name, "Artist", 168));
    }

    const tracksData = JSON.parse(tracksRaw);
    if (tracksData.error)
        throw new Error(tracksData.message || "Last.fm error");
    const trackItems = tracksData.toptracks?.track;
    const trackList = trackItems
        ? Array.isArray(trackItems)
            ? trackItems
            : [trackItems]
        : [];
    const tracks = trackList.filter(Boolean).map((t) => ({
        title: t.name,
        artist: t.artist?.name || name,
        album: t.album?.["#text"] || t.album?.title || null,
        image: extractImageFromLastFmTrack(t),
        images: parseImagesFromLastFm(t.image),
    }));
    ctx.tracksEl.innerHTML = "";
    if (tracks.length) {
        await renderSongList(tracks, ctx.tracksEl);
        enrichSongsArt(tracks, ctx.tracksEl);
    } else {
        ctx.tracksEl.innerHTML =
            '<span class="loading-text">No top tracks found.</span>';
    }

    const albumsData = JSON.parse(albumsRaw);
    if (albumsData.error)
        throw new Error(albumsData.message || "Last.fm error");
    const albumItems = albumsData.topalbums?.album;
    const albumList = albumItems
        ? Array.isArray(albumItems)
            ? albumItems
            : [albumItems]
        : [];
    const albums = albumList.map((a) => ({
        title: a.name,
        artist: name,
        image: extractImageFromLastFmAlbum(a),
        isAlbum: true,
    }));

    ctx.albumsEl.innerHTML = "";
    if (albums.length) {
        await renderAlbumGrid(albums, ctx.albumsEl);
    } else {
        ctx.albumsEl.innerHTML =
            '<span class="loading-text">No albums found.</span>';
    }
}

async function openAlbumPage(albumTitle, artistName, opts = {}) {
    const title = String(albumTitle || "").trim();
    const artist = String(artistName || "").trim();
    if (!title) return;
    if (!opts.skipContext) captureBrowseContext();
    showEntityView("album");

    const titleEl = document.getElementById("album-page-title");
    const artistEl = document.getElementById("album-page-artist");
    const metaEl = document.getElementById("album-page-meta");
    const artEl = document.getElementById("album-hero-art");
    const tracksEl = document.getElementById("album-tracks-container");
    const heroEl = document.querySelector(".album-hero");

    titleEl.textContent = title;
    artistEl.replaceChildren(
        artist ? artistLinkEl(artist) : document.createTextNode("—"),
    );
    metaEl.textContent = "Loading…";
    artEl.innerHTML = "";
    tracksEl.innerHTML = '<span class="loading-text">Loading tracks…</span>';
    selectedGroup = null;

    const bindAlbumGroupMenu = () => {
        const group = {
            type: "album",
            name: title,
            fetchTracks: async () => albumViewSongs.slice(),
        };
        selectedGroup = group;
        refreshContextMenuForGroup(group);
    };

    if (heroEl) {
        heroEl.oncontextmenu = (e) => {
            e.preventDefault();
            e.stopPropagation();
            bindAlbumGroupMenu();
            showContextMenuAt(e.clientX, e.clientY);
        };
    }

    try {
        if (opts.spotifyUrl && apiStatus.spotify_configured) {
            const data = await runSpotifySearch(opts.spotifyUrl);
            if (data.type === "album") {
                await renderAlbumPageFromSpotify(data, {
                    titleEl,
                    artistEl,
                    metaEl,
                    artEl,
                    tracksEl,
                    artist,
                });
                statusBar.textContent = `Album: ${title}`;
                return;
            }
        }
        await renderAlbumPageFromLastFm(title, artist, {
            titleEl,
            artistEl,
            metaEl,
            artEl,
            tracksEl,
        });
        statusBar.textContent = `Album: ${title}`;
    } catch (err) {
        metaEl.textContent = `Failed to load album: ${err}`;
        tracksEl.innerHTML = "";
    }
}

async function renderAlbumPageFromSpotify(data, ctx) {
    ctx.metaEl.textContent = `${(data.tracks || []).length} tracks`;
    ctx.artistEl.replaceChildren(
        data.artist ? artistLinkEl(data.artist) : document.createTextNode("—"),
    );

    const cover = data.cover_url || data.tracks?.[0]?.image;
    ctx.artEl.innerHTML = "";
    if (cover && isValidImage(cover)) {
        const cached = await resolveArtUrl(cover);
        const img = document.createElement("img");
        img.src = cached || cover;
        img.alt = data.name;
        ctx.artEl.appendChild(img);
    } else {
        ctx.artEl.appendChild(
            generateThumbnail(data.name, data.artist || "", 168),
        );
    }

    const songs = (data.tracks || []).map(mapSpotifyTrack);
    albumViewSongs = songs;
    ctx.tracksEl.innerHTML = "";
    if (songs.length) {
        await renderSongGrid(songs, ctx.tracksEl);
        enrichSongsArt(songs, ctx.tracksEl);
    } else {
        albumViewSongs = [];
        ctx.tracksEl.innerHTML =
            '<span class="loading-text">No tracks found.</span>';
    }
}

async function renderAlbumPageFromLastFm(title, artist, ctx) {
    const raw = await cachedInvoke("fetch_lastfm", {
        method: "album.getInfo",
        extraParams: `&artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(title)}`,
    });
    const data = JSON.parse(raw);
    if (data.error) throw new Error(data.message || "Last.fm error");

    const album = data.album || {};
    const playcount = album.playcount;
    ctx.metaEl.textContent = [
        album.wiki?.published
            ? `Released ${album.wiki.published.split(",")[0]}`
            : "",
        playcount ? `${Number(playcount).toLocaleString()} plays` : "",
    ]
        .filter(Boolean)
        .join(" · ");

    const imageUrl =
        pickBestImageUrl(parseImagesFromLastFm(album.image)) ||
        pickAnyValidFromRaw(album.image);
    ctx.artEl.innerHTML = "";
    if (imageUrl) {
        const cached = await resolveArtUrl(imageUrl);
        const img = document.createElement("img");
        img.src = cached || imageUrl;
        img.alt = title;
        ctx.artEl.appendChild(img);
    } else {
        ctx.artEl.appendChild(generateThumbnail(title, artist, 168));
    }

    let tracks = album.tracks?.track;
    if (!tracks) {
        ctx.tracksEl.innerHTML =
            '<span class="loading-text">No tracks found.</span>';
        return;
    }
    tracks = Array.isArray(tracks) ? tracks : [tracks];
    const songs = tracks.map((t) => ({
        title: t.name,
        artist,
        album: title,
        image: extractImageFromLastFmTrack(t) || imageUrl,
        images: parseImagesFromLastFm(t.image),
    }));
    albumViewSongs = songs;
    ctx.tracksEl.innerHTML = "";
    await renderSongGrid(songs, ctx.tracksEl);
    enrichSongsArt(songs, ctx.tracksEl);
}

function stripHtml(html) {
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || "";
}

async function mapPool(items, limit, fn) {
    let index = 0;
    async function worker() {
        while (index < items.length) {
            const i = index++;
            await fn(items[i], i);
        }
    }
    const workers = Array.from(
        { length: Math.min(limit, items.length || 1) },
        worker,
    );
    await Promise.all(workers);
}

function setBuffering(active) {
    isBuffering = active;
    bufferProgressWrap.classList.toggle("hidden", !active);
}

async function refreshDownloadedKeys() {
    try {
        const keys = await invoke("get_downloaded_keys");
        downloadedKeys = new Set(keys);
    } catch {
        downloadedKeys = new Set();
    }
}

function isSongDownloaded(song) {
    const key = `${song.artist.trim().toLowerCase()}|${song.title.trim().toLowerCase()}`;
    return downloadedKeys.has(key);
}

function isSongDownloading(song) {
    const key = `${song.artist.trim().toLowerCase()}|${song.title.trim().toLowerCase()}`;
    return downloadActivity.has(key);
}

function applyDownloadedState(element, song) {
    if (!element) return;
    const downloaded = isSongDownloaded(song);
    const downloading = isSongDownloading(song) && !downloaded;
    element.classList.toggle("downloaded", downloaded);
    element.classList.toggle("downloading", downloading);
}

function applySongDownloadStateToAllInstances(song) {
    document
        .querySelectorAll(`[data-song-key="${CSS.escape(songKey(song))}"]`)
        .forEach((el) => {
            applyDownloadedState(el, song);
        });
    if (currentSong && songKey(currentSong) === songKey(song)) {
        updateNowPlayingDownloadBadge(song);
    }
}

function renderDownloadsActivity() {
    const card = document.getElementById("downloads-active-card");
    const list = document.getElementById("downloads-active-list");
    const subtitle = document.getElementById("downloads-active-subtitle");
    const pill = document.getElementById("downloads-active-pill");
    if (!card || !list || !subtitle || !pill) return;

    const entries = [...downloadActivity.values()];
    pill.textContent = String(entries.length);

    if (!entries.length) {
        card.classList.add("hidden");
        subtitle.textContent = "No active downloads";
        list.innerHTML = "";
        return;
    }

    card.classList.remove("hidden");
    const queuedCount = entries.filter(
        (entry) => entry.stage === "Queued",
    ).length;
    const activeCount = entries.length - queuedCount;
    subtitle.textContent =
        queuedCount > 0 && activeCount > 0
            ? `${activeCount} active, ${queuedCount} queued`
            : queuedCount > 0
              ? `${queuedCount} queued`
              : entries.length === 1
                ? "1 track in progress"
                : `${entries.length} tracks in progress`;
    list.innerHTML = "";

    entries
        .sort((a, b) => a.startedAt - b.startedAt)
        .forEach((entry, index) => {
            const item = document.createElement("div");
            item.className = `downloads-active-item ${entry.stage === "Queued" ? "is-queued" : "is-active"}`;
            item.style.setProperty("--delay", `${index * 0.08}s`);

            const meta = document.createElement("div");
            meta.className = "downloads-active-meta";

            const title = document.createElement("strong");
            title.className = "downloads-active-title";
            title.textContent = entry.song.title;

            const artist = document.createElement("span");
            artist.className = "downloads-active-artist";
            artist.textContent = entry.song.artist;

            meta.appendChild(title);
            meta.appendChild(artist);

            const stage = document.createElement("span");
            stage.className = "downloads-active-stage";
            stage.textContent = entry.stage || "Downloading";

            const bar = document.createElement("div");
            bar.className = "downloads-active-bar";
            const fill = document.createElement("div");
            fill.className = "downloads-active-bar-fill";
            bar.appendChild(fill);

            item.appendChild(meta);
            item.appendChild(stage);
            item.appendChild(bar);
            list.appendChild(item);
        });
}

function setSongDownloadActivity(song, stage) {
    if (!song?.title || !song?.artist) return;
    const key = `${song.artist.trim().toLowerCase()}|${song.title.trim().toLowerCase()}`;
    downloadActivity.set(key, {
        song,
        stage,
        startedAt: downloadActivity.get(key)?.startedAt || Date.now(),
    });
    applySongDownloadStateToAllInstances(song);
    renderDownloadsActivity();
}

function clearSongDownloadActivity(song) {
    if (!song?.title || !song?.artist) return;
    const key = `${song.artist.trim().toLowerCase()}|${song.title.trim().toLowerCase()}`;
    downloadActivity.delete(key);
    applySongDownloadStateToAllInstances(song);
    renderDownloadsActivity();
}

function uniqueSongsByDownloadKey(songs) {
    const seen = new Set();
    const unique = [];
    for (const song of songs || []) {
        if (!song?.title || !song?.artist) continue;
        const key = `${song.artist.trim().toLowerCase()}|${song.title.trim().toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(song);
    }
    return unique;
}

async function downloadSongsWithConcurrency(songs, maxConcurrent = 2) {
    const queue = uniqueSongsByDownloadKey(songs);
    if (!queue.length) return;

    queue.forEach((song) => setSongDownloadActivity(song, "Queued"));
    statusBar.textContent =
        queue.length === 1
            ? `Downloading ${queue[0].title}...`
            : `Downloading ${queue.length} tracks with ${Math.min(maxConcurrent, queue.length)} concurrent downloads...`;
    renderDownloadsActivity();

    let nextIndex = 0;
    const workerCount = Math.min(maxConcurrent, queue.length);

    const workers = Array.from({ length: workerCount }, async () => {
        while (nextIndex < queue.length) {
            const currentIndex = nextIndex;
            nextIndex += 1;
            const song = queue[currentIndex];
            try {
                await downloadSongWithMetadata(song);
            } catch (err) {
                console.error("Failed downloading track", song, err);
            }
        }
    });

    await Promise.all(workers);
}

async function updateNowPlayingDownloadBadge(song) {
    if (!song) {
        npDownloadedBadge.classList.add("hidden");
        npDownloadedBadge.classList.remove("downloading");
        return;
    }
    const downloading = isSongDownloading(song);
    try {
        const downloaded = await invoke("is_track_downloaded", {
            artist: song.artist,
            title: song.title,
        });
        npDownloadedBadge.classList.toggle(
            "hidden",
            !(downloaded || downloading),
        );
        npDownloadedBadge.classList.toggle(
            "downloading",
            downloading && !downloaded,
        );
        if (downloaded) {
            const key = `${song.artist.trim().toLowerCase()}|${song.title.trim().toLowerCase()}`;
            downloadedKeys.add(key);
        }
    } catch {
        const downloaded = isSongDownloaded(song);
        npDownloadedBadge.classList.toggle(
            "hidden",
            !(downloaded || downloading),
        );
        npDownloadedBadge.classList.toggle(
            "downloading",
            downloading && !downloaded,
        );
    }
}

window.addEventListener("DOMContentLoaded", async () => {
    document.addEventListener(
        "contextmenu",
        (e) => {
            e.preventDefault();
        },
        true,
    );

    setupTitleBar();
    setupNavigation();
    setupSearch();
    setupContextMenu();
    setupSettings();
    setupDetailSidebar();
    setupHome();
    setupEntityPages();
    setupPlayer();
    setupNowPlayingContext();
    setupLikeButton();
    setupCollectionViewToggle();
    setupPlaylists();

    document.getElementById("btn-clear-queue").addEventListener("click", () => {
        appQueue = [];
        queueIndex = -1;
        renderQueueUI();
    });

    await loadSettingsUI();
    checkDependencies();
    await refreshApiStatus();
    await refreshDownloadedKeys();
    await loadPlaylistsFromDisk();
    renderPlaylistSidebar();

    try {
        const country = await invoke("get_geo_country");
        if (country && typeof country === "string") {
            homeCollections = buildHomeCollections(country);
        }
    } catch (err) {
        console.warn("Geo country lookup failed:", err);
    }
    await renderHomeBrowse();
    await restoreLastPlayedSession();

    window.addEventListener("beforeunload", () => {
        if (currentSong) saveLastPlayedSession(currentSong);
    });
});

function setupTitleBar() {
    const minBtn = document.getElementById("titlebar-min");
    const maxBtn = document.getElementById("titlebar-max");
    const closeBtn = document.getElementById("titlebar-close");
    minBtn?.addEventListener("click", async (e) => {
        e.preventDefault();
        try {
            await invoke("window_minimize");
        } catch (err) {
            console.error(err);
        }
    });
    maxBtn?.addEventListener("click", async (e) => {
        e.preventDefault();
        try {
            await invoke("window_toggle_maximize");
        } catch (err) {
            console.error(err);
        }
    });
    closeBtn?.addEventListener("click", async (e) => {
        e.preventDefault();
        try {
            await invoke("window_close");
        } catch (err) {
            console.error(err);
        }
    });
}

function setupPlayer() {
    audioPlayer.volume = Number(volumeBar.value) / 100;

    const playerQueueBtn = document.getElementById("player-queue-btn");
    playerQueueBtn?.addEventListener("click", (e) => {
        e.preventDefault();
        if (window.switchView) window.switchView("queue");
        renderQueueUI();
    });

    volumeBar.addEventListener("input", (e) => {
        audioPlayer.volume = Number(e.target.value) / 100;
    });

    audioPlayer.addEventListener("timeupdate", () => {
        if (isSeeking || !Number.isFinite(audioPlayer.duration)) return;
        progressBar.value =
            (audioPlayer.currentTime / audioPlayer.duration) * 100;
        timeCurrent.textContent = formatTime(audioPlayer.currentTime);
    });

    audioPlayer.addEventListener("loadedmetadata", () => {
        timeTotal.textContent = formatTime(audioPlayer.duration);
        if (isSeeking && Number.isFinite(audioPlayer.duration)) {
            audioPlayer.currentTime =
                (progressBar.value / 100) * audioPlayer.duration;
        }
    });

    audioPlayer.addEventListener("ended", onTrackEnded);

    const applySeekFromBar = () => {
        if (
            !Number.isFinite(audioPlayer.duration) ||
            audioPlayer.duration <= 0
        ) {
            return;
        }
        const t = (progressBar.value / 100) * audioPlayer.duration;
        audioPlayer.currentTime = t;
        timeCurrent.textContent = formatTime(t);
    };

    progressBar.addEventListener("pointerdown", () => {
        isSeeking = true;
    });
    progressBar.addEventListener("pointerup", () => {
        applySeekFromBar();
        isSeeking = false;
    });
    progressBar.addEventListener("change", () => {
        applySeekFromBar();
        isSeeking = false;
    });
    progressBar.addEventListener("input", () => {
        if (!isSeeking) return;
        if (Number.isFinite(audioPlayer.duration) && audioPlayer.duration > 0) {
            const t = (progressBar.value / 100) * audioPlayer.duration;
            audioPlayer.currentTime = t;
            timeCurrent.textContent = formatTime(t);
        }
    });

    btnPlay.addEventListener("click", () => {
        if (!audioPlayer.src) return;
        if (isPlaying) {
            audioPlayer.pause();
            btnPlay.textContent = "▶";
            updateDiscordPresence(currentSong, true);
        } else {
            audioPlayer.play();
            btnPlay.textContent = "❚❚";
            updateDiscordPresence(currentSong, false);
        }
        isPlaying = !isPlaying;
    });

    btnPrev?.addEventListener("click", () => playPreviousTrack());
    btnNext?.addEventListener("click", () => playNextTrack());

    btnShuffle?.addEventListener("click", () => {
        shuffleOn = !shuffleOn;
        updateShuffleButton();
    });

    btnLoop?.addEventListener("click", () => {
        loopMode =
            loopMode === "off" ? "all" : loopMode === "all" ? "one" : "off";
        updateLoopButton();
    });

    updateShuffleButton();
    updateLoopButton();
}

function setupNavigation() {
    const switchView = (viewName) => {
        Object.values(views).forEach((v) => v.classList.add("hidden"));
        Object.values(navs).forEach((n) => n?.classList.remove("active"));
        if (views[viewName]) views[viewName].classList.remove("hidden");
        if (navs[viewName]) navs[viewName].classList.add("active");

        // Clear active playlist state when navigating away so it can be re-accessed properly
        if (viewName !== "playlist") {
            setActivePlaylistId(null);
            renderPlaylistSidebar();
        }

        if (viewName === "home") showHomeBrowse();

        const playerQueueBtn = document.getElementById("player-queue-btn");
        if (playerQueueBtn) {
            playerQueueBtn.classList.toggle("active", viewName === "queue");
        }
    };
    window.switchView = switchView;

    navs.home.addEventListener("click", async (e) => {
        e.preventDefault();
        switchView("home");
        await renderHomeBrowse();
    });
    navs.search.addEventListener("click", (e) => {
        e.preventDefault();
        switchView("search");
        searchInput.focus();
    });
    navs.settings?.addEventListener("click", async () => {
        switchView("settings");
        await refreshApiStatus();
    });
    navs.downloads?.addEventListener("click", () => {
        switchView("downloads");
        initDownloadsView();
    });
}

function initAudioVisualizer() {
    if (visualizerInitialized) return;

    const npContainer = document.querySelector(".now-playing");
    if (!npContainer || document.getElementById("audio-visualizer")) return;

    const vizCanvas = document.createElement("canvas");
    vizCanvas.id = "audio-visualizer";
    vizCanvas.width = 60;
    vizCanvas.height = 30;
    vizCanvas.style.marginLeft = "15px";
    vizCanvas.style.pointerEvents = "none";

    npContainer.appendChild(vizCanvas);

    try {
        if (!audioContext) {
            audioContext = new (
                window.AudioContext || window.webkitAudioContext
            )();
            analyser = audioContext.createAnalyser();
            const source = audioContext.createMediaElementSource(audioPlayer);
            source.connect(analyser);
            analyser.connect(audioContext.destination);
            analyser.fftSize = 64;
        }

        const ctx = vizCanvas.getContext("2d");

        function draw() {
            requestAnimationFrame(draw);
            if (!isPlaying || !analyser) {
                ctx.clearRect(0, 0, vizCanvas.width, vizCanvas.height);
                return;
            }

            const bufferLength = analyser.frequencyBinCount;
            if (!dataArray || dataArray.length !== bufferLength) {
                dataArray = new Uint8Array(bufferLength);
            }

            analyser.getByteFrequencyData(dataArray);
            ctx.clearRect(0, 0, vizCanvas.width, vizCanvas.height);

            const barWidth = 3;
            let x = 0;
            for (let i = 0; i < 15; i++) {
                const barHeight = (dataArray[i] / 255) * vizCanvas.height;
                ctx.fillStyle = "#0f0";
                ctx.fillRect(
                    x,
                    vizCanvas.height - barHeight,
                    barWidth,
                    barHeight,
                );
                x += barWidth + 1;
            }
        }

        draw();
        visualizerInitialized = true;
    } catch (err) {
        console.warn("Audio visualizer unavailable:", err);
        vizCanvas.remove();
    }
}

function setupHome() {
    homeBackBtn.addEventListener("click", showHomeBrowse);
}

function showHomeBrowse() {
    homeBrowse.classList.remove("hidden");
    homeCollection.classList.add("hidden");
    currentCollection = null;
}

function createPlaylistHomeCard(pl) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "collection-card playlist-home-card";
    const count = pl.tracks.length;
    const first = pl.tracks[0];
    card.innerHTML = `
    <div class="collection-card-art" data-art></div>
    <div class="collection-card-body">
      <div class="collection-card-title">${escapeHtml(pl.name)}</div>
      <div class="collection-card-sub">${count} track${count === 1 ? "" : "s"}</div>
    </div>
  `;
    const artEl = card.querySelector("[data-art]");
    if (first?.image && isValidImage(first.image)) {
        resolveArtUrl(first.image).then((url) => {
            if (url) {
                artEl.innerHTML = "";
                const img = document.createElement("img");
                img.src = url;
                img.alt = pl.name;
                img.loading = "lazy";
                artEl.appendChild(img);
            }
        });
    } else {
        artEl.appendChild(generateThumbnail(pl.name, `${count} tracks`, 168));
    }
    card.addEventListener("click", () => openPlaylistView(pl.id));
    return card;
}

async function renderHomeBrowse() {
    const rows = {
        playlists: document.getElementById("home-row-playlists"),
        charts: document.getElementById("home-row-charts"),
        tracks: document.getElementById("home-row-tracks"),
        albums: document.getElementById("home-row-albums"),
    };
    Object.values(rows).forEach((r) => {
        if (r) r.innerHTML = "";
    });

    const plRow = rows.playlists;
    if (plRow) {
        const pls = getPlaylists();
        if (!pls.length) {
            plRow.innerHTML =
                '<span class="home-playlists-empty">Create a playlist in the sidebar to see it here.</span>';
        } else {
            for (const pl of pls) {
                plRow.appendChild(createPlaylistHomeCard(pl));
            }
        }
    }

    for (const col of homeCollections) {
        const card = createCollectionCard(col);
        rows[col.row]?.appendChild(card);
    }
}

function createCollectionCard(collection) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "collection-card";
    card.innerHTML = `
    <div class="collection-card-art" data-art></div>
    <div class="collection-card-body">
      <div class="collection-card-title">${escapeHtml(collection.title)}</div>
      <div class="collection-card-sub">${escapeHtml(collection.subtitle)}</div>
    </div>
  `;
    const artEl = card.querySelector("[data-art]");
    artEl.appendChild(
        generateThumbnail(collection.title, collection.subtitle, 168),
    );

    card.addEventListener("click", () => openCollection(collection));

    collection
        .preview()
        .then(async (items) => {
            if (!items?.length) return;
            const item =
                items.find((it) => isValidImage(it?.image)) ||
                items.find((it) => it?.title) ||
                items[0];
            if (!item?.image || !isValidImage(item.image)) return;
            const cached = await resolveArtUrl(item.image);
            if (cached) {
                artEl.innerHTML = "";
                const img = document.createElement("img");
                img.src = cached;
                img.alt = collection.title;
                img.loading = "lazy";
                artEl.appendChild(img);
            }
        })
        .catch((err) => {
            console.warn(`Home preview failed (${collection.id}):`, err);
        });

    return card;
}

async function openCollection(collection, opts = {}) {
    currentCollection = collection;
    homeBrowse.classList.add("hidden");
    homeCollection.classList.remove("hidden");
    homeCollectionTitle.textContent = `> ${collection.title}`;
    homeCollectionSubtitle.textContent = collection.subtitle;
    homeCollectionGrid.innerHTML =
        '<span class="loading-text">Loading...</span>';

    try {
        const items = await collection.load();
        if (collection.type === "albums") {
            currentCollectionSongs = [];
            await renderAlbumGrid(items, homeCollectionGrid);
        } else {
            currentCollectionSongs = items;
            await renderCollectionContent(items);
            prefetchArtForSongs(items);
            enrichSongsArt(items, homeCollectionGrid);
        }
        statusBar.textContent = `Loaded: ${collection.title}`;
    } catch (err) {
        currentCollectionSongs = [];
        homeCollectionGrid.innerHTML = `<span class="loading-text">Failed: ${err}</span>`;
    }
}

async function fetchLastfmTrackRows(method, extraParams) {
    const raw = await cachedInvoke("fetch_lastfm", {
        method,
        extraParams,
    });
    const data = JSON.parse(raw);
    if (data.error) {
        throw new Error(
            `${data.message || "Last.fm error"} (code ${data.error})`,
        );
    }
    const trackBlock = data.tracks ?? data.toptracks;
    const tracks = trackBlock?.track;
    if (tracks == null) {
        throw new Error("No tracks in Last.fm response");
    }
    const list = Array.isArray(tracks) ? tracks : [tracks];
    return list.filter(Boolean).map((t) => ({
        title: t.name,
        artist: t.artist?.name || t.artist,
        album: t.album?.["#text"] || t.album?.title || null,
        image: extractImageFromLastFmTrack(t),
        images: parseImagesFromLastFm(t.image),
    }));
}

async function fetchChartTracks(method, extraParams) {
    try {
        return await fetchLastfmTrackRows(method, extraParams);
    } catch (err) {
        if (method === "chart.gettoptracks") {
            const limitMatch = extraParams.match(/limit=(\d+)/);
            const limit = limitMatch ? limitMatch[1] : "50";
            const fallbacks = ["pop", "rock", "hip-hop", "electronic"];
            for (const tag of fallbacks) {
                try {
                    return await fetchLastfmTrackRows(
                        "tag.gettoptracks",
                        `&tag=${encodeURIComponent(tag)}&limit=${limit}`,
                    );
                } catch {
                    /* try next tag */
                }
            }
        }
        throw err;
    }
}

async function fetchChartAlbums(method, extraParams) {
    const raw = await cachedInvoke("fetch_lastfm", {
        method,
        extraParams,
    });
    const data = JSON.parse(raw);
    if (data.error) throw new Error(data.message || "API Error");
    const albums = data.albums?.album;
    const list = Array.isArray(albums) ? albums : [albums];
    return list.map((a) => ({
        title: a.name,
        artist: a.artist?.name || a.artist,
        image: extractImageFromLastFmAlbum(a),
        isAlbum: true,
    }));
}

async function prefetchArtForSongs(songs) {
    const withArt = songs.filter((s) => isValidImage(s.image));
    await mapPool(withArt, 8, async (song) => {
        await resolveArtUrl(song.image);
    });
}

async function enrichSongsArt(songs, container) {
    const needs = songs.filter((s) => !isValidImage(s.image));
    await mapPool(needs, 5, async (song) => {
        try {
            let url = song.image;
            if (!isValidImage(url)) {
                const meta = await cachedInvoke("fetch_track_metadata", {
                    artist: song.artist,
                    track: song.title,
                });
                url = pickBestImageUrl(
                    mergeImages(
                        meta.album_images || [],
                        meta.track_images || [],
                    ),
                );
                song.album = meta.album || song.album;
            }
            if (url) {
                song.image = url;
                await resolveArtUrl(url);
                await updateTileArt(container, song);
            }
        } catch {
            /* skip */
        }
    });
}

async function updateTileArt(container, song) {
    const key = songKey(song);
    const arts = container.querySelectorAll(
        `[data-song-key="${CSS.escape(key)}"] .tile-art, [data-song-key="${CSS.escape(key)}"] .item-art`,
    );
    for (const artDiv of arts) {
        const playBtn = artDiv.querySelector(".tile-play-btn");
        artDiv.innerHTML = "";
        const size = artDiv.classList.contains("item-art") ? 80 : 300;
        await appendArt(artDiv, song, size);
        if (playBtn) artDiv.appendChild(playBtn);
    }
}

function updateHomeLastfmHint() {
    const el = document.getElementById("home-lastfm-hint");
    if (!el) return;
    if (apiStatus?.lastfm_configured) {
        el.classList.add("hidden");
        el.textContent = "";
        return;
    }
    el.classList.remove("hidden");
    el.textContent =
        "Home browse groups (Top 100, charts, tag picks) use Last.fm. Add a Last.fm API key in Settings. Spotify Client ID and Secret are for playlists and Spotify URLs only — they do not load these groups.";
}

async function refreshApiStatus() {
    try {
        apiStatus = await invoke("get_api_status");
        if (apiStatusHint) {
            if (apiStatus.spotify_configured && apiStatus.lastfm_configured) {
                apiStatusHint.textContent =
                    "Spotify and Last.fm are configured.";
            } else if (apiStatus.spotify_configured) {
                apiStatusHint.textContent =
                    "Spotify configured. Add a Last.fm key for charts and search fallback.";
            } else if (apiStatus.lastfm_configured) {
                apiStatusHint.textContent =
                    "Last.fm configured (charts & search). Add Spotify ID/Secret for playlists and Spotify URLs.";
            } else {
                apiStatusHint.textContent =
                    "Add a Last.fm API key and/or Spotify credentials to load music.";
            }
        }
        updateHomeLastfmHint();
    } catch (err) {
        console.error("Failed to read API status:", err);
    }
}

async function loadSettingsUI() {
    try {
        // Refresh API status first to check if embedded keys or set keys are active
        await refreshApiStatus();

        const [settings, cachePath, downloadPath] = await Promise.all([
            invoke("get_settings"),
            invoke("get_cache_path"),
            invoke("get_download_path"),
        ]);
        const cdir = settings.cacheDir ?? settings.cache_dir;
        const ddir = settings.downloadDir ?? settings.download_dir;
        const sid = settings.spotifyClientId ?? settings.spotify_client_id;
        const ssec =
            settings.spotifyClientSecret ?? settings.spotify_client_secret;
        const lfm = settings.lastfmApiKey ?? settings.lastfm_api_key;

        cacheDirInput.value = cdir || "";
        downloadDirInput.value = ddir || "";
        spotifyIdInput.value = sid || "";
        spotifySecretInput.value = ssec || "";
        if (lastfmApiKeyInput) {
            lastfmApiKeyInput.value = lfm || "";
        }
        cacheDirInput.placeholder = cachePath;
        downloadDirInput.placeholder = downloadPath;

        // Set elegant placeholders indicating compile-time embedded credentials
        if (apiStatus?.spotify_configured) {
            spotifyIdInput.placeholder = "Embedded default key active (Optional)";
            spotifySecretInput.placeholder = "Embedded default secret active (Optional)";
        } else {
            spotifyIdInput.placeholder = "From Spotify Developer Dashboard";
            spotifySecretInput.placeholder = "Keep secret — stored locally";
        }

        if (lastfmApiKeyInput) {
            if (apiStatus?.lastfm_configured) {
                lastfmApiKeyInput.placeholder = "Embedded default API key active (Optional)";
            } else {
                lastfmApiKeyInput.placeholder = "Or LASTFM_API_KEY in .env";
            }
        }
    } catch (err) {
        console.error("Failed to load settings:", err);
    }
}

async function checkDependencies() {
    const pythonText = document.getElementById("dep-status-python-text");
    const pythonIcon = document.getElementById("dep-status-python-icon");
    const ytdlpText = document.getElementById("dep-status-ytdlp-text");
    const ytdlpIcon = document.getElementById("dep-status-ytdlp-icon");
    const spotdlText = document.getElementById("dep-status-spotdl-text");
    const spotdlIcon = document.getElementById("dep-status-spotdl-icon");
    const lyricsText = document.getElementById("dep-status-lyrics-text");
    const lyricsIcon = document.getElementById("dep-status-lyrics-icon");
    const tipText = document.getElementById("dependency-tip");

    if (!pythonText) return;

    // Reset UI to checking state
    pythonText.textContent = "Checking...";
    pythonIcon.style.background = "#f1c40f";
    pythonIcon.style.boxShadow = "0 0 8px #f1c40f";
    
    ytdlpText.textContent = "Checking...";
    ytdlpIcon.style.background = "#f1c40f";
    ytdlpIcon.style.boxShadow = "0 0 8px #f1c40f";
    
    spotdlText.textContent = "Checking...";
    spotdlIcon.style.background = "#f1c40f";
    spotdlIcon.style.boxShadow = "0 0 8px #f1c40f";
    
    lyricsText.textContent = "Checking...";
    lyricsIcon.style.background = "#f1c40f";
    lyricsIcon.style.boxShadow = "0 0 8px #f1c40f";

    try {
        const res = await invoke("check_system_dependencies");
        
        // 1. Python 3
        if (res.python) {
            pythonText.textContent = res.python_version || "Found";
            pythonIcon.style.background = "var(--accent)";
            pythonIcon.style.boxShadow = "0 0 8px var(--accent)";
        } else {
            pythonText.textContent = "Not Found";
            pythonIcon.style.background = "var(--err, #ff5555)";
            pythonIcon.style.boxShadow = "0 0 8px var(--err, #ff5555)";
        }

        // 2. yt-dlp
        if (res.yt_dlp) {
            ytdlpText.textContent = "Available";
            ytdlpIcon.style.background = "var(--accent)";
            ytdlpIcon.style.boxShadow = "0 0 8px var(--accent)";
        } else {
            ytdlpText.textContent = "Missing";
            ytdlpIcon.style.background = "var(--err, #ff5555)";
            ytdlpIcon.style.boxShadow = "0 0 8px var(--err, #ff5555)";
        }

        // 3. spotdl
        if (res.spotdl) {
            spotdlText.textContent = "Available";
            spotdlIcon.style.background = "var(--accent)";
            spotdlIcon.style.boxShadow = "0 0 8px var(--accent)";
        } else {
            spotdlText.textContent = "Missing";
            spotdlIcon.style.background = "var(--err, #ff5555)";
            spotdlIcon.style.boxShadow = "0 0 8px var(--err, #ff5555)";
        }

        // 4. syncedlyrics
        if (res.syncedlyrics) {
            lyricsText.textContent = "Available";
            lyricsIcon.style.background = "var(--accent)";
            lyricsIcon.style.boxShadow = "0 0 8px var(--accent)";
        } else {
            lyricsText.textContent = "Missing";
            lyricsIcon.style.background = "var(--err, #ff5555)";
            lyricsIcon.style.boxShadow = "0 0 8px var(--err, #ff5555)";
        }

        // Write tip
        let missing = [];
        if (!res.python) missing.push("Python 3");
        if (!res.yt_dlp) missing.push("yt-dlp");
        if (!res.spotdl) missing.push("spotDL");
        if (!res.syncedlyrics) missing.push("syncedlyrics");

        if (missing.length > 0) {
            tipText.innerHTML = `⚠️ Missing dependencies: <code style="background: var(--bg-hover); padding: 2px 6px; border-radius: 4px; color: var(--err); font-size: 0.8rem;">${missing.join(", ")}</code>. Run: <code style="background: var(--bg-hover); padding: 2px 6px; border-radius: 4px; color: var(--fg); font-family: monospace; font-size: 0.8rem;">pip install spotdl yt-dlp syncedlyrics</code>`;
        } else {
            tipText.innerHTML = `✨ All dependencies are successfully installed and active!`;
        }

    } catch (err) {
        console.error("Dependency check failed:", err);
    }
}

document.getElementById("btn-recheck-dependencies")?.addEventListener("click", checkDependencies);

function applyTheme(themeName, customCssCode) {
    let style = document.getElementById("custom-theme-style");
    if (!style) {
        style = document.createElement("style");
        style.id = "custom-theme-style";
        document.head.appendChild(style);
    }
    
    let generatedCss = customCssCode || "";
    
    // Built-in themes overrides
    if (themeName === "light") {
        generatedCss = `:root {
            --bg: #f5f2eb;
            --bg-panel: #ebe7de;
            --bg-hover: #dfdcd3;
            --bg-card: #ece9df;
            --fg: #3d3b37;
            --fg-muted: #757065;
            --border: #d4d0c5;
            --accent: #cd6848;
            --font-family: 'Segoe UI', system-ui, sans-serif;
        }\n` + generatedCss;
    } else if (themeName === "catppuccin-mocha") {
        generatedCss = `:root {
            --bg: #1e1e2e;
            --bg-panel: #11111b;
            --bg-hover: #313244;
            --bg-card: #181825;
            --fg: #cdd6f4;
            --fg-muted: #a6adc8;
            --border: #313244;
            --accent: #cba6f7;
            --font-family: 'JetBrains Mono', 'Fira Code', monospace;
        }\n` + generatedCss;
    } else if (themeName === "dracula") {
        generatedCss = `:root {
            --bg: #282a36;
            --bg-panel: #21222c;
            --bg-hover: #44475a;
            --bg-card: #282a36;
            --fg: #f8f8f2;
            --fg-muted: #bfbfbf;
            --border: #44475a;
            --accent: #ff79c6;
            --font-family: 'Fira Code', monospace;
        }\n` + generatedCss;
    }

    style.innerHTML = generatedCss;
}

// Initial theme load
applyTheme(localStorage.getItem("app-theme") || "default", localStorage.getItem("app-custom-css") || "");

function setupSettings() {
    // Theme logic
    const themeSelect = document.getElementById("theme-select");
    const customCssInput = document.getElementById("custom-css-input");
    const btnImportCss = document.getElementById("btn-import-css");
    const cssFileInput = document.getElementById("css-file-input");

    if (themeSelect) themeSelect.value = localStorage.getItem("app-theme") || "default";
    if (customCssInput) customCssInput.value = localStorage.getItem("app-custom-css") || "";

    themeSelect?.addEventListener("change", () => {
        applyTheme(themeSelect.value, customCssInput.value);
    });

    customCssInput?.addEventListener("input", () => {
        applyTheme(themeSelect.value, customCssInput.value);
    });

    btnImportCss?.addEventListener("click", () => cssFileInput?.click());

    cssFileInput?.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            if (customCssInput) {
                customCssInput.value = ev.target.result;
                applyTheme(themeSelect.value, customCssInput.value);
            }
        };
        reader.readAsText(file);
    });

    document.querySelectorAll(".btn-browse").forEach((btn) => {
        btn.addEventListener("click", async () => {
            const targetId = btn.dataset.target;
            const title = btn.dataset.title || "Select folder";
            const input = document.getElementById(targetId);
            try {
                const picked = await invoke("pick_folder", { title });
                if (picked) input.value = picked;
            } catch (err) {
                setSettingsStatus(`Browse failed: ${err}`, "err");
            }
        });
    });

    document
        .getElementById("btn-save-settings")
        .addEventListener("click", async () => {
            try {
                // Save theme preferences
                if (themeSelect) localStorage.setItem("app-theme", themeSelect.value);
                if (customCssInput) localStorage.setItem("app-custom-css", customCssInput.value);

                await invoke("set_settings", {
                    input: {
                        cacheDir: cacheDirInput.value.trim() || null,
                        downloadDir: downloadDirInput.value.trim() || null,
                        spotifyClientId: spotifyIdInput.value.trim() || null,
                        spotifyClientSecret:
                            spotifySecretInput.value.trim() || null,
                        lastfmApiKey: lastfmApiKeyInput?.value.trim() || null,
                    },
                });
                await loadSettingsUI();
                await refreshApiStatus();
                setSettingsStatus("Settings saved.", "ok");
            } catch (err) {
                setSettingsStatus(`Save failed: ${err}`, "err");
            }
        });

    document
        .getElementById("btn-reset-settings")
        .addEventListener("click", async () => {
            try {
                await invoke("set_settings", {
                    input: {
                        cacheDir: "",
                        downloadDir: "",
                        spotifyClientId: "",
                        spotifyClientSecret: "",
                        lastfmApiKey: "",
                    },
                });
                cacheDirInput.value = "";
                downloadDirInput.value = "";
                spotifyIdInput.value = "";
                spotifySecretInput.value = "";
                if (lastfmApiKeyInput) lastfmApiKeyInput.value = "";
                await loadSettingsUI();
                await refreshApiStatus();
                setSettingsStatus("Reset to default locations.", "ok");
            } catch (err) {
                setSettingsStatus(`Reset failed: ${err}`, "err");
            }
        });

    document.getElementById("btn-export-settings").addEventListener("click", async () => {
        try {
            const settings = await invoke("get_settings");
            const playlistsData = getPlaylists();
            const history = await invoke("get_history").catch(() => ({}));
            
            const exportData = {
                settings,
                playlists: playlistsData,
                history
            };
            
            const filename = `spot-dl-config-${new Date().toISOString().slice(0,10)}.json`;
            await invoke("save_file_dialog", { 
                filename, 
                content: JSON.stringify(exportData, null, 2) 
            });
            
            setSettingsStatus("Configs exported successfully.", "ok");
        } catch (err) {
            setSettingsStatus(`Export failed: ${err}`, "err");
        }
    });

    document.getElementById("btn-import-settings").addEventListener("click", async () => {
        try {
            const content = await invoke("pick_json_file");
            if (!content) return; // user cancelled

            const data = JSON.parse(content);
            if (data.settings) {
                await invoke("set_settings", {
                    input: {
                        cacheDir: data.settings.cacheDir ?? data.settings.cache_dir ?? null,
                        downloadDir: data.settings.downloadDir ?? data.settings.download_dir ?? null,
                        spotifyClientId: data.settings.spotifyClientId ?? data.settings.spotify_client_id ?? null,
                        spotifyClientSecret: data.settings.spotifyClientSecret ?? data.settings.spotify_client_secret ?? null,
                        lastfmApiKey: data.settings.lastfmApiKey ?? data.settings.lastfm_api_key ?? null,
                    }
                });
            }
            
            if (data.playlists && Array.isArray(data.playlists)) {
                await invoke("save_playlists", { playlists: data.playlists });
                await loadPlaylistsFromDisk();
                renderPlaylists();
            }
            
            if (data.history && typeof data.history === 'object' && !Array.isArray(data.history)) {
                await invoke("import_history", { history: data.history }).catch(err => console.error("History import err:", err));
            }
            
            await loadSettingsUI();
            await refreshApiStatus();
            setSettingsStatus("Configs imported successfully.", "ok");
        } catch (err) {
            setSettingsStatus(`Import failed: ${err}`, "err");
        }
    });
}

function setSettingsStatus(msg, kind) {
    settingsStatus.textContent = msg;
    settingsStatus.className = "settings-status";
    if (kind) settingsStatus.classList.add(kind);
}

function setupDetailSidebar() {
    const storedWidth = localStorage.getItem("detailSidebarWidth");
    if (storedWidth) {
        document.documentElement.style.setProperty(
            "--detail-width",
            `${storedWidth}px`,
        );
    }
    const storedCollapsed =
        localStorage.getItem("detailSidebarCollapsed") === "true";
    if (storedCollapsed) {
        detailSidebar.classList.add("collapsed");
        detailToggle.textContent = "‹";
    }

    detailToggle.addEventListener("click", () => {
        detailSidebar.classList.toggle("collapsed");
        const collapsed = detailSidebar.classList.contains("collapsed");
        detailToggle.textContent = collapsed ? "‹" : "›";
        localStorage.setItem("detailSidebarCollapsed", String(collapsed));
    });

    let resizing = false;
    let startX = 0;
    let startWidth = 0;

    detailResizer.addEventListener("mousedown", (e) => {
        if (detailSidebar.classList.contains("collapsed")) return;
        resizing = true;
        startX = e.clientX;
        startWidth = detailSidebar.getBoundingClientRect().width;
        detailResizer.classList.add("resizing");
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
        e.preventDefault();
    });

    document.addEventListener("mousemove", (e) => {
        if (!resizing) return;
        const delta = startX - e.clientX;
        const newWidth = Math.min(480, Math.max(200, startWidth + delta));
        document.documentElement.style.setProperty(
            "--detail-width",
            `${newWidth}px`,
        );
    });

    document.addEventListener("mouseup", () => {
        if (!resizing) return;
        resizing = false;
        detailResizer.classList.remove("resizing");
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        localStorage.setItem(
            "detailSidebarWidth",
            String(Math.round(detailSidebar.getBoundingClientRect().width)),
        );
    });

    document.addEventListener("click", () =>
        contextMenu.classList.add("hidden"),
    );
}

function isSpotifyQuery(query) {
    return (
        query.includes("open.spotify.com") ||
        query.includes("spotify.link") ||
        query.startsWith("playlist:") ||
        query.startsWith("album:")
    );
}

function mapSpotifyTrack(t) {
    return {
        title: t.title,
        artist: t.artist,
        album: t.album || null,
        image: t.image || t.album_art || t.cover_url || null,
        duration: t.duration ? Math.floor(t.duration) : null,
        spotify_url: t.spotify_url || t.url || null,
        popularity: t.popularity,
    };
}

async function runSpotifySearch(query) {
    const raw = await cachedInvoke("spotify_search", { query });
    return JSON.parse(raw);
}

function hasSpotifyResults(data) {
    if (!data || data.error) return false;
    if (data.tracks?.length) return true;
    if (data.artists?.length) return true;
    if (data.albums?.length) return true;
    if (
        data.type === "playlist" ||
        data.type === "album" ||
        data.type === "artist"
    )
        return true;
    return false;
}

function mapSpotifyAlbum(a) {
    return {
        title: a.name,
        artist: a.artist || "",
        image: a.image || a.cover_url || null,
        spotify_url: a.url,
    };
}

function appendArtistSearchSection(target, artists, heading) {
    if (!artists?.length) return;
    const h = document.createElement("div");
    h.className = "search-section";
    h.innerHTML = `<h3>> ${escapeHtml(heading)}</h3>`;
    target.appendChild(h);

    const artistGrid = document.createElement("div");
    artistGrid.className = "artist-grid";
    for (const artist of artists) {
        const card = document.createElement("div");
        card.className = "artist-card";
        card.innerHTML = `
            <img src="${artist.image || "assets/default-art.png"}" alt="" />
            <div class="artist-info">
                <strong>${escapeHtml(artist.name)}</strong>
                <span>${(artist.followers || 0).toLocaleString()} followers</span>
            </div>
        `;
        card.onclick = () => {
            openArtistPage(artist.name, { spotifyUrl: artist.url });
        };
        artistGrid.appendChild(card);
    }
    target.appendChild(artistGrid);
}

async function appendAlbumSearchSection(target, albums, heading) {
    if (!albums?.length) return;
    const h = document.createElement("div");
    h.className = "search-section";
    h.innerHTML = `<h3>> ${escapeHtml(heading)}</h3>`;
    target.appendChild(h);

    const grid = document.createElement("div");
    grid.className = "song-grid";
    target.appendChild(grid);
    const mapped = albums.map(mapSpotifyAlbum);
    await renderAlbumGrid(mapped, grid);
}

function appendTrackSearchSection(target, tracks, heading) {
    if (!tracks?.length) return;
    const block = document.createElement("div");
    block.className = "search-section";
    block.innerHTML = `<h3>> ${escapeHtml(heading)}</h3>`;
    const list = document.createElement("div");
    list.className = "song-list";
    block.appendChild(list);
    target.appendChild(block);
    const songs = tracks.map(mapSpotifyTrack);
    renderSongList(songs, list);
    enrichSongsArt(songs, list);
}

async function renderUnifiedSearchResults(data, target, titlePrefix = "") {
    const prefix = titlePrefix ? `${titlePrefix} · ` : "";
    const order = data.section_order || ["tracks", "albums", "artists"];
    const labels = {
        tracks: `${prefix}Tracks`,
        albums: `${prefix}Albums`,
        artists: `${prefix}Artists`,
    };

    let any = false;
    for (const section of order) {
        if (section === "tracks" && data.tracks?.length) {
            appendTrackSearchSection(target, data.tracks, labels.tracks);
            any = true;
        } else if (section === "albums" && data.albums?.length) {
            await appendAlbumSearchSection(target, data.albums, labels.albums);
            any = true;
        } else if (section === "artists" && data.artists?.length) {
            appendArtistSearchSection(target, data.artists, labels.artists);
            any = true;
        }
    }

    if (!any) {
        target.innerHTML =
            '<span class="loading-text">No Spotify results found.</span>';
    }
}

async function searchLastFmTracks(query) {
    const raw = await cachedInvoke("fetch_lastfm", {
        method: "track.search",
        extraParams: `&track=${encodeURIComponent(query)}&limit=20`,
    });
    const lastData = JSON.parse(raw);
    if (lastData.error) {
        throw new Error(lastData.message || String(lastData.error));
    }
    const tracks = lastData.results?.trackmatches?.track;
    if (!tracks) return [];
    const list = Array.isArray(tracks) ? tracks : [tracks];
    return list.map((t) => ({
        title: t.name,
        artist: t.artist,
        album: null,
        image: extractImageFromLastFmTrack(t),
        images: parseImagesFromLastFm(t.image),
    }));
}

async function renderSpotifySearchResults(
    data,
    container = searchResultsList,
    titlePrefix = "",
) {
    const target = container || searchResultsList;
    if (container === searchResultsList) target.innerHTML = "";

    if (data.type === "playlist") {
        const header = document.createElement("div");
        header.className = "search-section";
        header.innerHTML = `
      <h3>> ${escapeHtml(titlePrefix)}Playlist: ${escapeHtml(data.name)}</h3>
    <p class="collection-subtitle">${escapeHtml(data.author || "")} · ${data.tracks?.length || 0} tracks</p>
    `;
        target.appendChild(header);
        const songs = (data.tracks || []).map(mapSpotifyTrack);
        const grid = document.createElement("div");
        grid.className = "song-grid";
        target.appendChild(grid);
        renderSongGrid(songs, grid);
        enrichSongsArt(songs, grid);
        return;
    }

    if (data.type === "album") {
        openAlbumPage(data.name, data.artist, { spotifyUrl: data.url });
        return;
    }

    if (data.type === "artist") {
        openArtistPage(data.name, { spotifyUrl: data.url });
        return;
    }

    if (data.type === "search_results") {
        await renderUnifiedSearchResults(data, target, titlePrefix);
        return;
    }

    if (data.type === "tracks" && data.tracks?.length) {
        appendTrackSearchSection(
            target,
            data.tracks,
            titlePrefix ? `${titlePrefix} · Tracks` : "Tracks",
        );
        return;
    }

    if (data.playlist_match) {
        const pl = data.playlist_match;
        const h = document.createElement("div");
        h.className = "search-section";
        h.innerHTML = `<h3>> Playlist match: ${escapeHtml(pl.name)}</h3>`;
        target.appendChild(h);
        const g = document.createElement("div");
        g.className = "song-grid";
        target.appendChild(g);
        renderSongGrid((pl.tracks || []).map(mapSpotifyTrack), g);
        return;
    }

    target.innerHTML =
        '<span class="loading-text">No Spotify results found.</span>';
}

function setupSearch() {
    searchInput.addEventListener("keydown", async (e) => {
        if (e.key !== "Enter") return;
        const query = searchInput.value.trim();
        if (!query) return;

        await refreshApiStatus();
        navs.search.click();
        searchResultsList.innerHTML =
            '<span class="loading-text">Searching...</span>';

        try {
            if (isSpotifyQuery(query)) {
                if (!apiStatus.spotify_configured) {
                    throw new Error(
                        "Spotify is not configured. Add Client ID and Secret in Settings.",
                    );
                }
                const data = await runSpotifySearch(query);
                if (data.error) throw new Error(data.error);
                await renderSpotifySearchResults(data);
                return;
            }

            if (!apiStatus.spotify_configured && !apiStatus.lastfm_configured) {
                throw new Error(
                    "No music API configured. Add Last.fm and/or Spotify credentials in Settings.",
                );
            }

            const sections = [];

            if (apiStatus.spotify_configured) {
                try {
                    const spotData = await runSpotifySearch(query);
                    if (hasSpotifyResults(spotData)) {
                        sections.push({ label: "Spotify", data: spotData });
                    }
                } catch (spotErr) {
                    console.warn("Spotify search failed:", spotErr);
                }
            }

            if (apiStatus.lastfm_configured) {
                try {
                    const lastSongs = await searchLastFmTracks(query);
                    if (lastSongs.length) {
                        sections.push({ label: "Last.fm", songs: lastSongs });
                    }
                } catch (lastErr) {
                    if (!sections.length) throw lastErr;
                    console.warn("Last.fm search failed:", lastErr);
                }
            }

            if (!sections.length) {
                searchResultsList.innerHTML =
                    '<span class="loading-text">No results found.</span>';
                return;
            }

            searchResultsList.innerHTML = "";
            for (const section of sections) {
                if (section.data) {
                    const block = document.createElement("div");
                    block.className = "search-section";
                    searchResultsList.appendChild(block);
                    await renderSpotifySearchResults(
                        section.data,
                        block,
                        section.label,
                    );
                } else if (section.songs?.length) {
                    const block = document.createElement("div");
                    block.className = "search-section";
                    block.innerHTML = `<h3>> ${escapeHtml(section.label)}</h3>`;
                    const list = document.createElement("div");
                    list.className = "song-list";
                    block.appendChild(list);
                    searchResultsList.appendChild(block);
                    renderSongList(section.songs, list);
                    enrichSongsArt(section.songs, list);
                }
            }
        } catch (err) {
            searchResultsList.innerHTML = `<span class="loading-text">Error: ${escapeHtml(String(err))}</span>`;
        }
    });
}

async function appendArt(parent, song, size) {
    await applyArtToElement(parent, song, size, generateThumbnail);
}

function createPlayButton(song, tile, queueSongs) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tile-play-btn";
    btn.title = "Play";
    btn.textContent = "▶";
    btn.addEventListener("click", (e) => {
        e.stopPropagation();
        selectAndPlaySong(song, tile, queueSongs);
    });
    return btn;
}

async function renderSongGrid(songs, container) {
    container.innerHTML = "";
    for (const song of songs) {
        const tile = document.createElement("div");
        tile.className = "song-tile";
        const selectionKey = getSongSelectionKey(song);
        tile.dataset.songKey = songKey(song);
        tile.dataset.selectionKey = selectionKey;
        tile.__song = song;
        applyDownloadedState(tile, song);
        tile.classList.toggle("selected", isSelectionKeySelected(selectionKey));

        const artDiv = document.createElement("div");
        artDiv.className = "tile-art";
        await appendArt(artDiv, song, 300);
        artDiv.appendChild(createPlayButton(song, tile, songs));

        const titleSpan = document.createElement("span");
        titleSpan.className = "tile-title";
        titleSpan.textContent = song.title;

        const artistSpan = document.createElement("span");
        artistSpan.className = "tile-artist";
        artistSpan.appendChild(artistLinkEl(song.artist));

        tile.appendChild(artDiv);
        tile.appendChild(titleSpan);
        tile.appendChild(artistSpan);

        if (song.album) {
            const albumSpan = document.createElement("span");
            albumSpan.className = "tile-album";
            albumSpan.appendChild(albumLinkEl(song.album, song.artist));
            tile.appendChild(albumSpan);
        }

        tile.addEventListener("click", (e) => handleSongClick(e, song, tile, selectionKey));

        tile.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!isSelectionKeySelected(selectionKey)) {
                setSingleSongSelection(song, tile, selectionKey);
            } else {
                selectedSong = song;
            }
            selectedGroup = null;
            refreshContextMenuForSong(song);
            showContextMenuAt(e.clientX, e.clientY);
        });

        container.appendChild(tile);
    }
}

async function renderAlbumGrid(albums, container) {
    container.innerHTML = "";
    for (const album of albums) {
        const tile = document.createElement("div");
        tile.className = "song-tile";

        const artDiv = document.createElement("div");
        artDiv.className = "tile-art";
        await appendArt(artDiv, album, 300);

        const titleSpan = document.createElement("span");
        titleSpan.className = "tile-title";
        titleSpan.textContent = album.title;

        const artistSpan = document.createElement("span");
        artistSpan.className = "tile-artist";
        artistSpan.appendChild(artistLinkEl(album.artist));

        tile.appendChild(artDiv);
        tile.appendChild(titleSpan);
        tile.appendChild(artistSpan);

        tile.addEventListener("click", (e) => {
            if (e.target.closest(".meta-link")) return;
            openAlbumPage(album.title, album.artist, {
                spotifyUrl: album.spotify_url,
            });
        });

        tile.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            selectedGroup = {
                type: "album",
                name: album.title,
                fetchTracks: async () => {
                    const data = await cachedInvoke("spotify_search", {
                        query: `album:${album.title}`,
                    });
                    const res = JSON.parse(data);
                    if (res && res.type === "album" && res.tracks) {
                        return res.tracks.map(mapSpotifyTrack);
                    }
                    return [];
                },
            };
            refreshContextMenuForGroup(selectedGroup);
            showContextMenuAt(e.clientX, e.clientY);
        });

        container.appendChild(tile);
    }
    enrichAlbumsArt(albums, container);
}

async function enrichAlbumsArt(albums, container) {
    await mapPool(
        albums.filter((a) => !isValidImage(a.image)),
        5,
        async (album) => {
            try {
                const raw = await cachedInvoke("fetch_lastfm", {
                    method: "album.getInfo",
                    extraParams: `&artist=${encodeURIComponent(album.artist)}&album=${encodeURIComponent(album.title)}`,
                });
                const data = JSON.parse(raw);
                const images = parseImagesFromLastFm(data.album?.image);
                const url = pickBestImageUrl(images);
                if (url) {
                    album.image = url;
                    container.querySelectorAll(".song-tile").forEach((tile) => {
                        if (
                            tile.querySelector(".tile-title")?.textContent ===
                            album.title
                        ) {
                            const art = tile.querySelector(".tile-art");
                            if (art) {
                                art.innerHTML = "";
                                appendArt(art, album, 300);
                            }
                        }
                    });
                }
            } catch {
                /* skip */
            }
        },
    );
}

async function renderSongList(songs, container) {
    container.innerHTML = "";
    for (const song of songs) {
        const el = document.createElement("div");
        el.className = "song-item";
        const selectionKey = getSongSelectionKey(song);
        el.dataset.songKey = songKey(song);
        el.dataset.selectionKey = selectionKey;
        el.__song = song;
        applyDownloadedState(el, song);
        el.classList.toggle("selected", isSelectionKeySelected(selectionKey));

        const artDiv = document.createElement("div");
        artDiv.className = "item-art";
        artDiv.style.position = "relative";
        await appendArt(artDiv, song, 80);
        const playBtn = createPlayButton(song, el, songs);
        // Style adjustments for the play button in list view
        playBtn.style.right = "4px";
        playBtn.style.bottom = "4px";
        playBtn.style.width = "24px";
        playBtn.style.height = "24px";
        playBtn.style.transform = "none";
        playBtn.style.opacity = "1"; // Maybe always visible or test on hover
        // Wait, playBtn has a class which makes it hidden unless .song-tile:hover or .song-item:hover.
        // Let's add hover rule in styles via CSS later, or just simple inline.
        artDiv.appendChild(playBtn);

        const infoDiv = document.createElement("div");
        infoDiv.className = "song-info";
        const titleSpan = document.createElement("span");
        titleSpan.className = "song-title";
        titleSpan.textContent = song.title;
        const artistSpan = document.createElement("span");
        artistSpan.className = "song-artist";
        artistSpan.appendChild(artistLinkEl(song.artist));
        infoDiv.appendChild(titleSpan);
        infoDiv.appendChild(artistSpan);
        if (song.album) {
            const albumSpan = document.createElement("span");
            albumSpan.className = "song-album";
            albumSpan.appendChild(albumLinkEl(song.album, song.artist));
            infoDiv.appendChild(albumSpan);
        }

        el.appendChild(artDiv);
        el.appendChild(infoDiv);

        el.addEventListener("click", (e) => handleSongClick(e, song, el, selectionKey));

        el.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!isSelectionKeySelected(selectionKey)) {
                setSingleSongSelection(song, el, selectionKey);
            } else {
                selectedSong = song;
            }
            selectedGroup = null;
            refreshContextMenuForSong(song);
            showContextMenuAt(e.clientX, e.clientY);
        });

        container.appendChild(el);
    }
}

function highlightSelected(element) {
    document
        .querySelectorAll(".song-tile.selected, .song-item.selected")
        .forEach((el) => {
            el.classList.remove("selected");
        });
    if (element) element.classList.add("selected");
}

async function selectSong(song, element) {
    const selectionKey = getSongSelectionKey(song);
    setSingleSongSelection(song, element, selectionKey);
    currentSong = song;
    await showDetailSidebarPreview(song);
    fetchAndShowMetadata(song);
}

async function selectAndPlaySong(song, element, queueSongs = null) {
    await selectSong(song, element);
    const list = resolvePlaybackQueueForSong(song, queueSongs);
    if (list?.length) {
        setPlaybackQueue(list, song);
    } else if (!appQueue.length) {
        setPlaybackQueue([song], song);
    } else {
        syncQueueIndexForSong(song);
    }
    await playSong(song);
}

async function showDetailSidebarPreview(song) {
    detailEmpty.classList.add("hidden");
    detailContent.classList.remove("hidden");
    detailTitle.textContent = song.title;
    setDetailArtistAlbum(song.artist, song.album);
    detailMeta.innerHTML =
        '<p class="detail-meta-loading">Loading metadata…</p>';
    if (detailLyricsEl) detailLyricsEl.textContent = "";
    await setDetailArt(song.image, song.title, song.artist);
    loadDetailLyrics(song.artist, song.title);

    if (detailSidebar.classList.contains("collapsed")) {
        detailSidebar.classList.remove("collapsed");
        detailToggle.textContent = "›";
        localStorage.setItem("detailSidebarCollapsed", "false");
    }
}

async function setDetailArt(url, title, artist) {
    detailArtCanvas.classList.add("hidden");
    if (isValidImage(url)) {
        const cached = await resolveArtUrl(url);
        if (cached) {
            detailArtImg.src = cached;
            detailArtImg.classList.remove("hidden");
            detailArtImg.onerror = () => {
                detailArtImg.classList.add("hidden");
                drawDetailCanvas(title, artist);
            };
            return;
        }
    }
    detailArtImg.classList.add("hidden");
    drawDetailCanvas(title, artist);
}

function drawDetailCanvas(title, artist) {
    const thumb = generateThumbnail(title, artist, 400);
    detailArtCanvas.width = thumb.width;
    detailArtCanvas.height = thumb.height;
    detailArtCanvas.getContext("2d").drawImage(thumb, 0, 0);
    detailArtCanvas.classList.remove("hidden");
}

async function loadDetailLyrics(artist, title) {
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

function saveLastPlayedSession(song) {
    if (!song?.title || !song?.artist) return;
    try {
        const cachePath =
            song.cache_path ||
            (currentStreamData?.file_path &&
            !String(currentStreamData.file_path).startsWith("http")
                ? currentStreamData.file_path
                : null);
        const payload = {
            title: song.title,
            artist: song.artist,
            album: song.album || null,
            image: song.image || null,
            spotify_url: song.spotify_url || null,
            cache_path: cachePath,
        };
        localStorage.setItem(LAST_SESSION_KEY, JSON.stringify(payload));
    } catch (e) {
        console.warn("Could not persist last session:", e);
    }
}

/** Load seekable audio from cache (stream_song reuses existing cache file when present). */
async function attachSeekableAudioForSong(song, playId) {
    const query = `${song.title} ${song.artist}`;
    const streamInfo = await invoke("stream_song", { query });

    if (playId != null && playId !== activePlayId) return null;

    if (audioPlayer.src && audioPlayer.src.startsWith("blob:")) {
        URL.revokeObjectURL(audioPlayer.src);
    }

    const bytes = await invoke("read_audio_file", {
        path: streamInfo.file_path,
    });

    if (playId != null && playId !== activePlayId) return null;

    const blob = new Blob([new Uint8Array(bytes)], { type: "audio/mpeg" });
    audioPlayer.src = URL.createObjectURL(blob);

    currentStreamData = {
        file_path: streamInfo.file_path,
        file_name: streamInfo.file_name,
    };
    song.cache_path = streamInfo.file_path;

    return streamInfo;
}

async function restoreLastPlayedSession() {
    try {
        const raw = localStorage.getItem(LAST_SESSION_KEY);
        if (!raw) return;
        const song = JSON.parse(raw);
        if (!song?.title || !song?.artist) return;
        currentSong = song;
        await setNowPlaying(song);

        const playId = ++activePlayId;
        try {
            await attachSeekableAudioForSong(song, playId);
            if (playId !== activePlayId) return;
            audioPlayer.pause();
            isPlaying = false;
            btnPlay.textContent = "▶";
            saveLastPlayedSession(song);
        } catch (err) {
            console.warn("Could not restore cached audio:", err);
        }

        await showDetailSidebarPreview(song);
        fetchAndShowMetadata(song);
        updateLikeButton();
    } catch (e) {
        console.warn("restoreLastPlayedSession:", e);
    }
}

async function fetchAndShowMetadata(song) {
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
        const bestUrl = pickBestImageUrl(allImages) || song.image;
        if (bestUrl) {
            song.image = bestUrl;
            song.images = allImages;
            await setNowPlaying(song);
            await setDetailArt(bestUrl, meta.title, meta.artist);
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

        detailTitle.textContent = meta.title;
        setDetailArtistAlbum(meta.artist, meta.album || song.album);
        renderMetadataPanel(meta);
        loadDetailLyrics(meta.artist, meta.title);
    } catch (err) {
        if (requestId !== metadataRequestId) return;
        detailMeta.innerHTML = `<p class="detail-meta-error">Could not load metadata: ${escapeHtml(String(err))}</p>`;
        loadDetailLyrics(song.artist, song.title);
    }
}

function renderMetadataPanel(meta) {
    const rows = [];
    const dur = formatDuration(meta.duration_secs);
    if (dur) rows.push(["Duration", dur]);
    if (meta.listeners) rows.push(["Listeners", meta.listeners]);
    if (meta.playcount) rows.push(["Play count", meta.playcount]);
    if (meta.published) rows.push(["Published", meta.published]);
    if (meta.url) {
        rows.push([
            "Last.fm",
            `<a href="${escapeHtml(meta.url)}" target="_blank" rel="noopener">Open track</a>`,
        ]);
    }
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

async function downloadSongWithMetadata(song) {
    setBuffering(true);
    statusBar.textContent = `Downloading ${song.title}...`;
    setSongDownloadActivity(song, "Fetching metadata");
    try {
        let meta = song.meta;
        if (!meta) {
            meta = await cachedInvoke("fetch_track_metadata", {
                artist: song.artist,
                track: song.title,
            });
            song.meta = meta;
        }

        setSongDownloadActivity(song, "Downloading audio");
        const query = `${song.title} ${song.artist}`;
        const streamInfo = await invoke("stream_song", { query });
        setSongDownloadActivity(song, "Saving file");
        const savedPath = await invoke("save_song_with_metadata", {
            cachedPath: streamInfo.file_path,
            metadata: meta,
        });

        await refreshDownloadedKeys();
        applySongDownloadStateToAllInstances(song);
        await updateNowPlayingDownloadBadge(song);
        if (views.downloads && !views.downloads.classList.contains("hidden")) {
            await renderDownloadsList(downloadsSearchQuery);
        }

        statusBar.textContent = `Saved: ${savedPath}`;
        return savedPath;
    } catch (e) {
        statusBar.textContent = `Error: ${e}`;
        showModal(
            "Download Failed",
            `<p style="margin-bottom: 0.8rem; font-size: 1.05rem;">Could not download <strong>${escapeHtml(song.title)}</strong> by <strong>${escapeHtml(song.artist)}</strong>.</p>
             <p style="color: var(--fg-muted); font-size: 0.92rem; line-height: 1.45; margin-bottom: 0.5rem;">
                This error typically occurs when the song/audio source <strong>cannot be found on YouTube</strong>, or when the video is blocked/restricted.
             </p>
             <p style="color: var(--fg-muted); font-size: 0.92rem; line-height: 1.45;">
                Please verify the track details or check your internet connection and try again.
             </p>`,
            () => {},
            "Close",
            false // Hide the cancel button since it's just an alert
        );
        throw e;
    } finally {
        clearSongDownloadActivity(song);
        setBuffering(false);
    }
}

function setupContextMenu() {
    document.getElementById("cm-queue").addEventListener("click", () => {
        const songs = getUniqueSelectedSongs();
        if (songs.length) {
            appQueue.push(...songs);
            renderQueueUI();
            statusBar.textContent =
                songs.length === 1
                    ? `Added to Queue: ${songs[0].title}`
                    : `Added ${songs.length} tracks to Queue`;
        }
    });
    document.getElementById("cm-liked")?.addEventListener("click", async () => {
        const songs = getUniqueSelectedSongs();
        if (!songs.length) return;
        let likedCount = 0;
        for (const song of songs) {
            const liked = await toggleLikedSong(song);
            if (liked) likedCount++;
            if (currentSong && songKey(currentSong) === songKey(song)) {
                updateLikeButton();
            }
        }
        renderPlaylistSidebar();
        statusBar.textContent =
            songs.length === 1
                ? isSongLiked(songs[0])
                    ? `Added to Liked Songs: ${songs[0].title}`
                    : `Removed from Liked Songs: ${songs[0].title}`
                : `Toggled Liked Songs for ${songs.length} tracks`;
    });
    document.getElementById("cm-playlist").addEventListener("click", () => {
        const songs = getUniqueSelectedSongs();
        if (!songs.length) return;
        const pls = getPlaylists();

        if (!pls.length) {
            showModal(
                "Create Playlist",
                `<p>No playlists exist yet.</p><input type="text" id="modal-playlist-name" placeholder="New playlist name..." autocomplete="off">`,
                async () => {
                    const name = document
                        .getElementById("modal-playlist-name")
                        .value.trim();
                    if (!name) return false;
                    const pl = await createPlaylist(name);
                    for (const song of songs) {
                        await addTrackToPlaylist(pl.id, song);
                    }
                    renderPlaylistSidebar();
                    statusBar.textContent =
                        songs.length === 1
                            ? `Added to ${pl.name}`
                            : `Added ${songs.length} tracks to ${pl.name}`;
                },
                "Create & Add",
            );
            setTimeout(
                () => document.getElementById("modal-playlist-name")?.focus(),
                50,
            );
            return;
        }

        const options = pls
            .map(
                (p) =>
                    `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`,
            )
            .join("");
        showModal(
            "Add to Playlist",
            `<p>Select a playlist for <strong>${escapeHtml(songs[0].title)}${songs.length > 1 ? ` + ${songs.length - 1} more` : ""}</strong>:</p>
                 <select id="modal-playlist-select">${options}</select>`,
            async () => {
                const select = document.getElementById("modal-playlist-select");
                const plId = select.value;
                const pl = getPlaylist(plId);
                if (plId && pl) {
                    for (const song of songs) {
                        await addTrackToPlaylist(plId, song);
                    }
                    statusBar.textContent =
                        songs.length === 1
                            ? `Added to ${pl.name}`
                            : `Added ${songs.length} tracks to ${pl.name}`;
                    if (getActivePlaylistId() === plId) openPlaylistView(plId);
                }
            },
            "Add",
        );
    });
    document
        .getElementById("cm-remove-from-playlist")
        .addEventListener("click", async () => {
            const plId = getActivePlaylistId();
            const items = selectedItems.filter(
                (item) => item.song?.playlist_track_id,
            );
            if (!plId || !items.length) return;
            for (const item of items) {
                await removePlaylistTrack(plId, item.song.playlist_track_id);
            }
            renderPlaylistSidebar();
            statusBar.textContent =
                items.length === 1
                    ? `Removed from playlist: ${items[0].song.title}`
                    : `Removed ${items.length} tracks from playlist`;
            if (
                views.playlist &&
                !views.playlist.classList.contains("hidden")
            ) {
                openPlaylistView(plId);
            }
        });
    document
        .getElementById("cm-download")
        .addEventListener("click", async () => {
            const songs = getUniqueSelectedSongs();
            if (!songs.length) return;
            if (songs.length === 1) {
                await downloadSongWithMetadata(songs[0]);
                return;
            }
            await downloadSongsWithConcurrency(songs, 2);
        });
    document
        .getElementById("cm-download-group")
        .addEventListener("click", async () => {
            if (selectedGroup) {
                statusBar.textContent = `Fetching tracks for ${selectedGroup.name}...`;
                try {
                    const tracks = await selectedGroup.fetchTracks();
                    await downloadSongsWithConcurrency(tracks, 2);
                    statusBar.textContent = `Downloaded ${tracks.length} tracks from ${selectedGroup.name}`;
                } catch (e) {
                    statusBar.textContent = `Error fetching group tracks: ${e}`;
                }
            }
        });
    document.getElementById("cm-artist").addEventListener("click", () => {
        if (selectedSong?.artist) {
            openArtistPage(selectedSong.artist);
        }
    });
}

function formatTime(seconds) {
    if (Number.isNaN(seconds)) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
}

async function setNowPlaying(song) {
    document.getElementById("np-title").textContent = song.title;
    const npArtistEl = document.getElementById("np-artist");
    npArtistEl.replaceChildren(artistLinkEl(song.artist));
    npArt.innerHTML = "";
    if (isValidImage(song.image)) {
        const cached = await resolveArtUrl(song.image);
        if (cached) {
            const img = document.createElement("img");
            img.src = cached;
            npArt.appendChild(img);
        } else {
            npArt.appendChild(generateThumbnail(song.title, song.artist, 50));
        }
    } else {
        npArt.appendChild(generateThumbnail(song.title, song.artist, 50));
    }
    updateNowPlayingDownloadBadge(song);
    updateLikeButton();
}

async function playSong(song) {
    currentSong = song;
    syncQueueIndexForSong(song);
    const playId = ++activePlayId;
    setBuffering(true);
    statusBar.textContent = `Buffering: ${song.title}...`;

    try {
        const streamInfo = await attachSeekableAudioForSong(song, playId);
        if (playId !== activePlayId || !streamInfo) return;

        initAudioVisualizer();
        if (audioContext && audioContext.state === "suspended") {
            await audioContext.resume();
        }

        await audioPlayer.play();

        if (playId !== activePlayId) return;

        await setNowPlaying(song);
        updateNowPlayingDownloadBadge(song);
        saveLastPlayedSession(song);

        isPlaying = true;
        btnPlay.textContent = "❚❚";
        statusBar.textContent = `Playing: ${song.title}`;
        updateDiscordPresence(song, false);

        const plId = getActivePlaylistId();
        if (plId && song.playlist_track_id) {
            await incrementPlayCount(plId, song.playlist_track_id);
            if (
                views.playlist &&
                !views.playlist.classList.contains("hidden")
            ) {
                openPlaylistView(plId);
            }
        }
    } catch (err) {
        if (playId !== activePlayId) return;
        console.error(err);
        statusBar.textContent = `Playback error: ${err}`;
    } finally {
        if (playId === activePlayId) {
            setBuffering(false);
        }
    }
}

function setupCollectionViewToggle() {
    const applyMode = () => {
        homeCollectionGrid.classList.toggle(
            "song-list-view",
            collectionViewMode === "list",
        );
        homeCollectionGrid.classList.toggle(
            "song-grid",
            collectionViewMode === "grid",
        );
        viewModeGridBtn.classList.toggle(
            "active",
            collectionViewMode === "grid",
        );
        viewModeListBtn.classList.toggle(
            "active",
            collectionViewMode === "list",
        );
        localStorage.setItem("collectionViewMode", collectionViewMode);
    };

    viewModeGridBtn.addEventListener("click", async () => {
        collectionViewMode = "grid";
        applyMode();
        if (currentCollectionSongs.length > 0) {
            await renderCollectionContent(currentCollectionSongs);
        }
    });

    viewModeListBtn.addEventListener("click", async () => {
        collectionViewMode = "list";
        applyMode();
        if (currentCollectionSongs.length > 0) {
            await renderCollectionContent(currentCollectionSongs);
        }
    });

    applyMode();
}

async function renderCollectionContent(songs) {
    if (collectionViewMode === "list") {
        await renderSongList(songs, homeCollectionGrid);
    } else {
        await renderSongGrid(songs, homeCollectionGrid);
    }
}

function setupPlaylists() {
    document
        .getElementById("new-playlist-btn")
        .addEventListener("click", () => {
            showModal(
                "Create Playlist",
                `<input type="text" id="modal-playlist-name" placeholder="Playlist name..." autocomplete="off">`,
                async () => {
                    const input = document.getElementById(
                        "modal-playlist-name",
                    );
                    const name = input.value.trim();
                    if (!name) return false;
                    await createPlaylist(name);
                    renderPlaylistSidebar();
                    if (
                        views.home &&
                        !views.home.classList.contains("hidden")
                    ) {
                        await renderHomeBrowse();
                    }
                },
                "Create",
            );
            // Quick focus when modal loads
            setTimeout(
                () => document.getElementById("modal-playlist-name")?.focus(),
                50,
            );
        });

    document
        .getElementById("playlist-back-btn")
        .addEventListener("click", () => {
            window.switchView("home");
        });
}

function renderPlaylistSidebar() {
    playlistListEl.innerHTML = "";
    const sorted = [...getPlaylists()].sort((a, b) => {
        if (isLikedPlaylist(a.id)) return -1;
        if (isLikedPlaylist(b.id)) return 1;
        return 0;
    });
    sorted.forEach((pl) => {
        const li = document.createElement("li");
        const classes = [pl.id === getActivePlaylistId() ? "active" : ""];
        if (isLikedPlaylist(pl.id)) classes.push("pl-liked");
        li.className = classes.filter(Boolean).join(" ");
        const label = document.createElement("span");
        label.className = "pl-label";
        label.textContent = pl.name;

        li.style.cursor = "pointer";
        li.addEventListener("click", () => openPlaylistView(pl.id));
        li.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            selectedGroup = {
                type: "playlist",
                name: pl.name,
                fetchTracks: async () => pl.tracks.map(trackToSong),
            };
            refreshContextMenuForGroup(selectedGroup);
            showContextMenuAt(e.clientX, e.clientY);
        });

        li.appendChild(label);
        if (!isLikedPlaylist(pl.id)) {
            const del = document.createElement("button");
            del.type = "button";
            del.className = "pl-del-btn";
            del.textContent = "×";
            del.title = "Delete playlist";
            del.addEventListener("click", async (e) => {
                e.stopPropagation();
                if (confirm(`Delete playlist "${pl.name}"?`)) {
                    await deletePlaylist(pl.id);
                    renderPlaylistSidebar();
                }
            });
            li.appendChild(del);
        }
        playlistListEl.appendChild(li);
    });
}

async function openPlaylistView(playlistId) {
    const pl = getPlaylist(playlistId);
    if (!pl) return;
    setActivePlaylistId(playlistId);
    renderPlaylistSidebar();

    Object.values(views).forEach((v) => v.classList.add("hidden"));
    views.playlist.classList.remove("hidden");

    const totalSecs = playlistTotalDuration(pl);
    document.getElementById("playlist-view-title").textContent = `> ${pl.name}`;
    document.getElementById("playlist-view-meta").textContent =
        `${pl.tracks.length} tracks · ${formatDuration(totalSecs) || "0:00"} total`;

    const playlistHeaderEl = document.querySelector(".playlist-view-header");
    if (playlistHeaderEl) {
        playlistHeaderEl.oncontextmenu = (e) => {
            e.preventDefault();
            e.stopPropagation();
            selectedGroup = {
                type: "playlist",
                name: pl.name,
                fetchTracks: async () =>
                    [...getPlaylist(playlistId).tracks]
                        .sort((a, b) => a.order - b.order)
                        .map(trackToSong),
            };
            refreshContextMenuForGroup(selectedGroup);
            showContextMenuAt(e.clientX, e.clientY);
        };
    }

    const rescanBtn = document.getElementById("playlist-rescan-btn");
    rescanBtn.onclick = async () => {
        rescanBtn.disabled = true;
        rescanBtn.textContent = "Scanning...";
        const missing = pl.tracks.filter(
            (t) => !t.image || t.image.includes("2a96cbd8b46e442fc41c2b86b821562f") || !t.duration_secs
        );
        let updated = 0;
        for (const track of missing) {
            try {
                const meta = await cachedInvoke("fetch_track_metadata", {
                    artist: track.artist,
                    track: track.title,
                });
                if (!meta) continue;
                let changed = false;
                if (meta.duration_secs != null && !track.duration_secs) {
                    track.duration_secs = meta.duration_secs;
                    changed = true;
                }
                if (meta.album && !track.album) {
                    track.album = meta.album;
                    changed = true;
                }
                const bestImg = getBestImage(meta);
                if (bestImg && (!track.image || track.image.includes("2a96cbd8b46e442fc41c2b86b821562f"))) {
                    track.image = bestImg;
                    changed = true;
                }
                if (changed) updated++;
            } catch (e) {
                console.error(`Rescan failed for ${track.title}:`, e);
            }
        }
        if (updated > 0) {
            await persistPlaylists();
        }
        rescanBtn.disabled = false;
        rescanBtn.textContent = `Rescan metadata`;
        openPlaylistView(playlistId);
    };

    const tbody = document.getElementById("playlist-tracks-body");
    tbody.innerHTML = "";
    tbody.ondragover = (e) => {
        e.preventDefault();
    };
    tbody.ondrop = async (e) => {
        const from = Number(e.dataTransfer.getData("text/plain"));
        if (Number.isNaN(from)) return;
        const targetRow = e.target.closest("tr");
        if (!targetRow) {
            const to = sorted.length - 1;
            if (from !== to) {
                await reorderPlaylistTracks(playlistId, from, to);
                openPlaylistView(playlistId);
            }
        }
    };

    const sorted = [...pl.tracks].sort((a, b) => a.order - b.order);
    const playlistSongs = sorted.map(trackToSong);

    for (let i = 0; i < sorted.length; i++) {
        const track = sorted[i];
        const tr = document.createElement("tr");
        tr.draggable = true;
        tr.dataset.trackId = track.id;
        tr.dataset.index = String(i);
        const song = trackToSong(track);
        const selectionKey = getSongSelectionKey(song);
        tr.dataset.selectionKey = selectionKey;
        tr.__song = song;
        tr.classList.toggle("selected", isSelectionKeySelected(selectionKey));

        tr.addEventListener("dragstart", (e) => {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", String(i));
            tr.classList.add("dragging");
        });
        tr.addEventListener("dragend", () => tr.classList.remove("dragging"));
        tr.addEventListener("dragover", (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            tr.classList.add("drag-over");
        });
        tr.addEventListener("dragleave", () =>
            tr.classList.remove("drag-over"),
        );
        tr.addEventListener("drop", async (e) => {
            e.preventDefault();
            tr.classList.remove("drag-over");
            const from = Number(e.dataTransfer.getData("text/plain"));
            const to = Number(tr.dataset.index);
            if (!Number.isNaN(from) && from !== to) {
                await reorderPlaylistTracks(playlistId, from, to);
                openPlaylistView(playlistId);
            }
        });

        tr.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!isSelectionKeySelected(selectionKey)) {
                setSingleSongSelection(song, tr, selectionKey);
            } else {
                selectedSong = song;
            }
            selectedGroup = null;
            refreshContextMenuForSong(song);
            showContextMenuAt(e.clientX, e.clientY);
        });

        tr.addEventListener("click", (e) => handleSongClick(e, song, tr, selectionKey));

        const artTd = document.createElement("td");
        artTd.className = "col-order";
        artTd.textContent = String(i + 1);

        const titleTd = document.createElement("td");
        titleTd.className = "col-title";
        const artWrap = document.createElement("span");
        artWrap.className = "playlist-track-art";
        await appendArt(artWrap, song, 40);
        const textWrap = document.createElement("span");
        const titleLine = document.createElement("span");
        titleLine.className = "playlist-track-title";
        titleLine.textContent = track.title;
        const artistLine = document.createElement("span");
        artistLine.className = "playlist-track-artist";
        artistLine.appendChild(artistLinkEl(track.artist));

        applyDownloadedState(artWrap, song);

        textWrap.appendChild(titleLine);
        textWrap.appendChild(document.createElement("br"));
        textWrap.appendChild(artistLine);
        titleTd.appendChild(artWrap);
        titleTd.appendChild(textWrap);

        const albumTd = document.createElement("td");
        albumTd.className = "col-album";
        albumTd.replaceChildren(
            track.album
                ? albumLinkEl(track.album, track.artist)
                : document.createTextNode("—"),
        );

        const durTd = document.createElement("td");
        durTd.className = "col-duration";
        durTd.textContent = formatDuration(track.duration_secs) || "—";

        const playsTd = document.createElement("td");
        playsTd.className = "col-plays";
        playsTd.textContent = String(track.play_count || 0);

        const actTd = document.createElement("td");
        actTd.className = "col-actions";
        const playBtn = document.createElement("button");
        playBtn.type = "button";
        playBtn.className = "playlist-row-play";
        playBtn.textContent = "▶";
        playBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            selectAndPlaySong(song, tr, playlistSongs);
        });
        actTd.appendChild(playBtn);

        tr.appendChild(artTd);
        tr.appendChild(titleTd);
        tr.appendChild(albumTd);
        tr.appendChild(durTd);
        tr.appendChild(playsTd);
        tr.appendChild(actTd);
        tbody.appendChild(tr);
    }
}

// Modal helper system
function showModal(title, contentHtml, onConfirm, confirmText = "Confirm", showCancel = true) {
    const overlay = document.getElementById("modal-overlay");
    const titleEl = document.getElementById("modal-title");
    const bodyEl = document.getElementById("modal-body");
    const cancelBtn = document.getElementById("modal-cancel-btn");
    const confirmBtn = document.getElementById("modal-confirm-btn");

    titleEl.textContent = title;
    bodyEl.innerHTML = contentHtml;
    confirmBtn.textContent = confirmText;
    cancelBtn.style.display = showCancel ? "" : "none";

    const cleanup = () => {
        overlay.classList.add("hidden");
        cancelBtn.replaceWith(cancelBtn.cloneNode(true));
        confirmBtn.replaceWith(confirmBtn.cloneNode(true));
    };

    document
        .getElementById("modal-cancel-btn")
        .addEventListener("click", cleanup);

    document
        .getElementById("modal-confirm-btn")
        .addEventListener("click", async () => {
            const result = await onConfirm();
            if (result !== false) cleanup();
        });

    overlay.classList.remove("hidden");
}

// Download Management View
async function initDownloadsView() {
    await updateCacheUsage();
    await renderDownloadsList();
}

async function updateCacheUsage() {
    try {
        const sizeBytes = await invoke("get_cache_size");
        const sizeMb = (sizeBytes / (1024 * 1024)).toFixed(2);
        document.getElementById("cache-usage-text").textContent =
            `Current Cache Size: ${sizeMb} MB`;
    } catch (err) {
        document.getElementById("cache-usage-text").textContent =
            `Cache Size: Error (${err})`;
    }
}

document
    .getElementById("btn-clear-cache")
    ?.addEventListener("click", async () => {
        if (
            !confirm(
                "Are you sure you want to empty the audio and art cache? This may force redownloading on repeated streaming.",
            )
        )
            return;
        try {
            await invoke("clear_cache");
            await updateCacheUsage();
            statusBar.textContent = "Cache cleared!";
        } catch (err) {
            statusBar.textContent = `Clear cache failed: ${err}`;
        }
    });

document
    .getElementById("btn-delete-all-downloads")
    ?.addEventListener("click", () => {
        showModal(
            "Delete All Downloads",
            `<p style="margin-bottom: 0.5rem; font-size: 1.05rem; font-weight: 500;">Are you absolutely sure you want to delete all saved music?</p>
             <p style="color: var(--fg-muted); font-size: 0.92rem; line-height: 1.45;">This will permanently delete all downloaded MP3 files from your storage and reset the downloaded library view. This cannot be undone.</p>`,
            async () => {
                try {
                    await invoke("delete_all_downloads");
                    await refreshDownloadedKeys();
                    if (views.downloads && !views.downloads.classList.contains("hidden")) {
                        await renderDownloadsList(downloadsSearchQuery);
                    }
                    statusBar.textContent = "All downloads successfully deleted!";
                } catch (err) {
                    statusBar.textContent = `Failed to delete downloads: ${err}`;
                    showModal("Error", `<p>Could not delete downloads: ${escapeHtml(err)}</p>`, () => {}, "Close", false);
                }
            },
            "Delete Everything"
        );
    });

let _allDownloadsCache = {};

function downloadsTableMessage(tbody, className, message) {
    tbody.innerHTML = "";
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 3;
    td.className = className;
    td.textContent = message;
    tr.appendChild(td);
    tbody.appendChild(tr);
}

async function renderDownloadsList(searchQuery = "") {
    downloadsSearchQuery = searchQuery;
    const tbody = document.getElementById("downloads-tracks-body");
    if (!tbody) return;
    downloadsTableMessage(tbody, "downloads-loading", "Loading…");
    renderDownloadsActivity();

    try {
        const index = await invoke("get_download_index");
        _allDownloadsCache = index;

        let keys = Object.keys(index).sort((a, b) => {
            const ta = (a.split("|")[1] || a).toLowerCase();
            const tb = (b.split("|")[1] || b).toLowerCase();
            return ta.localeCompare(tb);
        });

        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            keys = keys.filter(
                (k) =>
                    k.toLowerCase().includes(q) ||
                    index[k].toLowerCase().includes(q),
            );
        }

        tbody.innerHTML = "";

        if (keys.length === 0) {
            downloadsTableMessage(
                tbody,
                "downloads-empty",
                searchQuery
                    ? "No downloads match your search."
                    : "No saved downloads yet. Right-click a track and choose Download.",
            );
            return;
        }

        for (const key of keys) {
            const filename = index[key];
            const parts = key.split("|");
            const artist = parts[0] || "Unknown";
            const title = parts[1] || "Unknown";

            const tr = document.createElement("tr");

            const titleTd = document.createElement("td");
            titleTd.className = "col-title";
            const titleLine = document.createElement("span");
            titleLine.className = "downloads-track-title";
            titleLine.textContent = title;
            const artistLine = document.createElement("span");
            artistLine.className = "downloads-track-artist";
            artistLine.appendChild(artistLinkEl(artist));
            titleTd.appendChild(titleLine);
            titleTd.appendChild(artistLine);

            const fileTd = document.createElement("td");
            fileTd.className = "col-album";
            const fileSpan = document.createElement("span");
            fileSpan.className = "downloads-filename";
            fileSpan.textContent = filename;
            fileTd.appendChild(fileSpan);

            const actTd = document.createElement("td");
            actTd.className = "col-actions";
            const delBtn = document.createElement("button");
            delBtn.type = "button";
            delBtn.className = "downloads-remove-btn";
            delBtn.textContent = "Remove";
            delBtn.addEventListener("click", async (e) => {
                e.stopPropagation();
                if (confirm(`Delete ${filename}?`)) {
                    try {
                        await invoke("delete_downloaded_song", { key });
                        downloadedKeys.delete(key);
                        await refreshDownloadedKeys();
                        await renderDownloadsList(
                            document.getElementById("downloads-search").value,
                        );
                    } catch (err) {
                        alert(`Failed to delete: ${err}`);
                    }
                }
            });
            actTd.appendChild(delBtn);

            tr.appendChild(titleTd);
            tr.appendChild(fileTd);
            tr.appendChild(actTd);
            tbody.appendChild(tr);
        }
    } catch (err) {
        downloadsTableMessage(
            tbody,
            "downloads-error",
            `Error loading downloads: ${err}`,
        );
    }
    renderDownloadsActivity();
}

document.getElementById("downloads-search")?.addEventListener("input", (e) => {
    renderDownloadsList(e.target.value);
});

document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        if (document.activeElement && (document.activeElement.tagName === "INPUT" || document.activeElement.tagName === "TEXTAREA")) {
            return;
        }
        e.preventDefault();
        
        const activeMain = getActiveMainView();
        let container = null;
        if (activeMain === "home") container = document.getElementById("main-content");
        else container = views[activeMain];
        
        if (!container) return;
        
        const songEls = Array.from(container.querySelectorAll(".song-tile, .song-item, tr[data-selection-key]")).filter(el => el.__song && el.offsetParent !== null);
        
        if (songEls.length > 0) {
            const items = songEls.map(el => ({
                key: getSongSelectionKey(el.__song),
                song: el.__song
            }));
            setSelectedItems(items, items[0].song);
            lastSelectedElement = songEls[songEls.length - 1]; // or songEls[0]
        }
    }
});

window.addEventListener("playlist-updated", (e) => {
    const { playlistId } = e.detail;
    renderPlaylists();
    if (activeView === "playlist" && getActivePlaylistId() === playlistId) {
        openPlaylistView(playlistId);
    }
});


// ── Spotify Import Modal ──────────────────────────────────────────────
setTimeout(() => {
    const importModal = document.getElementById("spotify-import-modal");
    if (!importModal) return;

    let selectedPlaylists = new Map();
    const btnImportSelected = document.getElementById("btn-import-selected");

    function updateImportSelectedBtn() {
        if (!btnImportSelected) return;
        if (selectedPlaylists.size > 0) {
            btnImportSelected.classList.remove("hidden");
            btnImportSelected.disabled = false;
            btnImportSelected.textContent = `Import Selected (${selectedPlaylists.size})`;
        } else {
            btnImportSelected.disabled = true;
            btnImportSelected.textContent = "Import Selected";
        }
    }

    document.getElementById("import-spotify-btn")?.addEventListener("click", () => {
        importModal.style.display = "flex";
        document.getElementById("spotify-import-input").value = "";
        document.getElementById("spotify-import-results").innerHTML = "";
        selectedPlaylists.clear();
        updateImportSelectedBtn();
        btnImportSelected?.classList.add("hidden");
        setTimeout(() => document.getElementById("spotify-import-input").focus(), 50);
    });

    document.getElementById("btn-cancel-import")?.addEventListener("click", () => {
        importModal.style.display = "none";
    });

    document.getElementById("spotify-import-input")?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") document.getElementById("btn-fetch-import")?.click();
    });

    let isFetching = false;
    document.getElementById("btn-fetch-import")?.addEventListener("click", async () => {
        if (isFetching) return;
        const rawInput = document.getElementById("spotify-import-input").value.trim();
        if (!rawInput) return;

        isFetching = true;
        const btnFetch = document.getElementById("btn-fetch-import");
        if (btnFetch) btnFetch.disabled = true;
        const resultsContainer = document.getElementById("spotify-import-results");
        resultsContainer.innerHTML = '<p style="text-align:center;">Fetching public playlists\u2026</p>';
        selectedPlaylists.clear();
        updateImportSelectedBtn();

        try {
            const query = rawInput.includes("open.spotify.com/user/") ? rawInput : `user:${rawInput}`;
            const jsonStr = await invoke("spotify_search", { query });
            const data = JSON.parse(jsonStr);

            if (data.type !== "user_playlists" || !data.playlists || data.playlists.length === 0) {
                resultsContainer.innerHTML = "<p>No public playlists found for this user.</p>";
                return;
            }

            resultsContainer.innerHTML = "";
            data.playlists.forEach(pl => {
                const el = document.createElement("div");
                el.className = "spotify-import-card";
                
                const img = pl.image || "default.png";
                const name = escapeHtml(pl.name);
                const owner = escapeHtml(pl.owner);
                el.innerHTML = `
                    <img src="${img}" style="width:48px;height:48px;object-fit:cover;border-radius:4px;" />
                    <div style="flex:1;text-align:left;">
                        <h4 style="margin:0;font-size:14px;">${name}</h4>
                        <p style="margin:0;font-size:12px;color:var(--fg-muted);">${pl.tracks_total} tracks \u2022 By ${owner}</p>
                    </div>
                `;

                el.addEventListener("click", () => {
                    if (selectedPlaylists.has(pl.id)) {
                        selectedPlaylists.delete(pl.id);
                        el.classList.remove("selected");
                    } else {
                        selectedPlaylists.set(pl.id, pl);
                        el.classList.add("selected");
                    }
                    updateImportSelectedBtn();
                });

                resultsContainer.appendChild(el);
            });
        } catch (err) {
            resultsContainer.innerHTML = `<p style="color:var(--err);">Error: ${err}</p>`;
        } finally {
            isFetching = false;
            if (btnFetch) btnFetch.disabled = false;
        }
    });

    let isImporting = false;
    btnImportSelected?.addEventListener("click", async () => {
        if (isImporting) return;
        if (selectedPlaylists.size === 0) return;
        
        isImporting = true;
        btnImportSelected.disabled = true;
        btnImportSelected.textContent = "Importing...";
        const originalBg = btnImportSelected.style.background;
        
        try {
            for (const pl of selectedPlaylists.values()) {
                btnImportSelected.textContent = `Importing ${escapeHtml(pl.name)}...`;
                
                const jsonStr = await invoke("spotify_search", { query: pl.url });
                const data = JSON.parse(jsonStr);
                
                if (data.type === "playlist" && data.tracks) {
                    // Create local playlist
                    const newPl = await createPlaylist(data.name || pl.name);
                    
                    // Add all tracks sequentially to avoid db locking issues
                    const mappedSongs = data.tracks.map(mapSpotifyTrack);
                    for (const song of mappedSongs) {
                        await addTrackToPlaylist(newPl.id, song);
                    }
                }
            }
            renderPlaylistSidebar();
            importModal.style.display = "none";
        } catch (err) {
            console.error("Failed to import playlists:", err);
            btnImportSelected.textContent = "Error!";
            btnImportSelected.style.background = "var(--err)";
            setTimeout(() => {
                btnImportSelected.style.background = originalBg;
                updateImportSelectedBtn();
            }, 3000);
        } finally {
            isImporting = false;
        }
    });
}, 500);
