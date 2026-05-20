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
    profile: document.getElementById("view-profile"),
};

const navs = {
    home: document.getElementById("nav-home"),
    search: document.getElementById("nav-search"),
    settings: document.getElementById("nav-settings"),
    downloads: document.getElementById("nav-downloads"),
    profile: document.getElementById("nav-profile-btn"),
};

const searchInput = document.getElementById("search-input");
const searchResultsList = document.getElementById("search-results-list");
const searchProgressBar = document.getElementById("search-progress-bar");
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
const detailLikeBtn = document.getElementById("detail-like-btn");
let detailSidebarSong = null;

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
            preview: () => fetchChartTracks("chart.gettoptracks", "&limit=8"),
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
                    `&country=${countryEnc}&limit=8`,
                ),
        },
        {
            id: "top-tracks-global",
            row: "charts",
            title: "Top tracks · Global",
            subtitle: "Chart · 50 tracks",
            type: "tracks",
            load: () => fetchChartTracks("chart.gettoptracks", "&limit=50"),
            preview: () => fetchChartTracks("chart.gettoptracks", "&limit=8"),
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
                    `&country=${countryEnc}&limit=8`,
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
                fetchChartTracks("tag.gettoptracks", "&tag=hip-hop&limit=8"),
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
                fetchChartTracks("tag.gettoptracks", "&tag=electronic&limit=8"),
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
                fetchChartAlbums("tag.gettopalbums", "&tag=pop&limit=8"),
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
                fetchChartAlbums("tag.gettopalbums", "&tag=hip-hop&limit=8"),
        },
        {
            id: "viral-50-global",
            row: "charts",
            title: "Viral 50 · Global",
            subtitle: "Chart · 50 tracks",
            type: "tracks",
            load: () => fetchChartTracks("chart.gettoptracks", "&limit=50"),
            preview: () => fetchChartTracks("chart.gettoptracks", "&limit=8"),
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
                fetchChartTracks("tag.gettoptracks", "&tag=rock&limit=8"),
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
                fetchChartTracks("tag.gettoptracks", "&tag=pop&limit=8"),
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
                fetchChartTracks("tag.gettoptracks", "&tag=r-n-b&limit=8"),
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
                fetchChartTracks("tag.gettoptracks", "&tag=indie&limit=8"),
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
                fetchChartTracks("tag.gettoptracks", "&tag=metal&limit=8"),
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
                fetchChartTracks("tag.gettoptracks", "&tag=dance&limit=8"),
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
                fetchChartTracks("tag.gettoptracks", "&tag=latino&limit=8"),
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
                fetchChartAlbums("tag.gettopalbums", "&tag=rock&limit=8"),
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
                fetchChartAlbums("tag.gettopalbums", "&tag=electronic&limit=8"),
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
                fetchChartAlbums("tag.gettopalbums", "&tag=indie&limit=8"),
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
                fetchChartAlbums("tag.gettopalbums", "&tag=r-n-b&limit=8"),
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

function generateArtistAvatar(name, size = 150) {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    
    // Hash colors for smooth premium gradient
    const color1 = hashColor(name);
    const color2 = hashColor(name.split("").reverse().join(""));
    
    const grad = ctx.createLinearGradient(0, 0, size, size);
    grad.addColorStop(0, color1);
    grad.addColorStop(1, color2);
    
    // Draw circular background
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    
    // Draw artist initial
    const initial = (name || "?").charAt(0).toUpperCase();
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${size * 0.45}px "Outfit", "Inter", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(initial, size / 2, size / 2);
    
    return canvas.toDataURL("image/png");
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
    const metaCount = document.getElementById("queue-meta-count");
    const metaDuration = document.getElementById("queue-meta-duration");
    
    list.innerHTML = "";

    if (appQueue.length === 0) {
        msg.style.display = "block";
        if (metaCount) metaCount.textContent = "(0 songs)";
        if (metaDuration) metaDuration.style.display = "none";
        return;
    }

    msg.style.display = "none";

    // Calculate metadata
    const totalSongs = appQueue.length;
    if (metaCount) {
        metaCount.textContent = `(${totalSongs} track${totalSongs === 1 ? "" : "s"})`;
    }

    let totalDurationSecs = 0;
    appQueue.forEach((song) => {
        if (song.duration) {
            totalDurationSecs += song.duration;
        }
    });

    if (metaDuration) {
        if (totalDurationSecs > 0) {
            metaDuration.textContent = `${formatDuration(totalDurationSecs)} total duration`;
            metaDuration.style.display = "inline-block";
        } else {
            metaDuration.style.display = "none";
        }
    }

    appQueue.forEach((song, idx) => {
        const item = document.createElement("div");
        item.className = "queue-item";
        if (idx === queueIndex) {
            item.classList.add("active-playing");
        }
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

        // 1. Drag Grip indicator
        const grip = document.createElement("div");
        grip.className = "queue-drag-grip";
        grip.innerHTML = "⋮⋮";
        item.appendChild(grip);

        // 2. Cover Art Wrapper
        const artWrap = document.createElement("div");
        artWrap.className = "queue-item-art-wrap";
        applyArtToElement(artWrap, song, 40, generateThumbnail);
        item.appendChild(artWrap);

        // 3. Info Metadata block
        const info = document.createElement("div");
        info.className = "queue-item-info";
        
        const titleEl = document.createElement("div");
        titleEl.className = "queue-item-title";
        titleEl.textContent = song.title;
        info.appendChild(titleEl);

        const artistEl = document.createElement("div");
        artistEl.className = "queue-item-artist";
        artistEl.appendChild(artistLinkEl(song.artist));
        info.appendChild(artistEl);

        info.onclick = () => {
            queueIndex = idx;
            renderQueueUI();
            playSong(song);
        };
        item.appendChild(info);

        // 4. Right side actions and duration pill
        const rightContainer = document.createElement("div");
        rightContainer.className = "queue-item-right";

        if (song.duration) {
            const durationEl = document.createElement("div");
            durationEl.className = "queue-item-duration";
            durationEl.textContent = formatDuration(song.duration);
            rightContainer.appendChild(durationEl);
        }

        const removeBtn = document.createElement("button");
        removeBtn.className = "queue-item-remove-btn";
        removeBtn.innerHTML = "×";
        removeBtn.title = "Remove from Queue";
        removeBtn.onclick = (e) => {
            e.stopPropagation();
            removeFromQueue(idx);
        };
        rightContainer.appendChild(removeBtn);

        item.appendChild(rightContainer);

        // Drag/Drop hooks
        item.ondragstart = (e) => {
            e.dataTransfer.setData("text/plain", idx);
            item.classList.add("dragging");
        };
        item.ondragend = () => {
            item.classList.remove("dragging");
            document.querySelectorAll(".queue-item").forEach(el => el.classList.remove("drag-over"));
        };
        item.ondragover = (e) => {
            e.preventDefault();
            if (!item.classList.contains("dragging")) {
                item.classList.add("drag-over");
            }
        };
        item.ondragleave = () => {
            item.classList.remove("drag-over");
        };
        item.ondrop = (e) => {
            e.preventDefault();
            item.classList.remove("drag-over");
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

        list.appendChild(item);
    });

    saveQueueState();
    updateQueueRecommendations();
}

function promptSaveQueueAsPlaylist() {
    if (appQueue.length === 0) {
        showModal("Save Queue", "<p>The queue is empty!</p>", () => {}, "OK", false);
        return;
    }
    
    const now = new Date();
    const dateStr = `${now.getMonth() + 1}/${now.getDate()}/${now.getFullYear().toString().slice(-2)}`;
    const defaultName = `Queue Session - ${dateStr}`;
    
    const bodyHtml = `
        <p style="margin-bottom: 12px; color: var(--fg-muted);">Enter a name for the new playlist containing all ${appQueue.length} tracks:</p>
        <input type="text" id="modal-playlist-name-input" value="${defaultName}" style="width: 100%; padding: 10px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg-hover); color: #fff; font-size: 14px; outline: none; box-sizing: border-box;" />
    `;
    
    showModal("Save Queue as Playlist", bodyHtml, () => {
        const inputEl = document.getElementById("modal-playlist-name-input");
        const name = inputEl ? inputEl.value.trim() : "";
        if (!name) {
            showModal(
                "Invalid Name",
                "<p>Playlist name cannot be empty!</p>",
                () => {},
                "OK",
                false
            );
            return;
        }
        
        const pl = createPlaylist(name);
        if (pl) {
            // Add all tracks from the queue to the playlist
            appQueue.forEach(song => {
                addTrackToPlaylist(pl.id, song);
            });
            persistPlaylists();
            renderPlaylistSidebar();
            statusBar.textContent = `Saved queue as playlist "${name}"!`;
        }
    }, "Save", true);
}

let currentRecSeedKey = "";

async function updateQueueRecommendations(force = false) {
    const listEl = document.getElementById("queue-recs-list");
    const loadingEl = document.getElementById("queue-recs-loading");
    const emptyEl = document.getElementById("queue-recs-empty");
    
    if (!listEl) return;
    
    // Determine seed song
    let seedSong = null;
    if (appQueue.length > 0) {
        seedSong = appQueue[queueIndex] || appQueue[0];
    } else {
        // Fallback 1: Try to pick a song from history
        try {
            const historyMap = await invoke("get_history").catch(() => ({}));
            const historyList = Object.values(historyMap);
            if (historyList.length > 0) {
                historyList.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
                const randomRecent = historyList[Math.floor(Math.random() * Math.min(5, historyList.length))];
                if (randomRecent) {
                    seedSong = {
                        title: randomRecent.title || randomRecent.name,
                        artist: randomRecent.artist,
                    };
                }
            }
        } catch (e) {
            console.warn("Failed to get history for seed song:", e);
        }
        
        // Fallback 2: Default popular local/indie/global seed tracks
        if (!seedSong) {
            const defaults = [
                { title: "Fallen", artist: "Lola Amour" },
                { title: "Tara", artist: "IV Of Spades" },
                { title: "Tamis ng Pagkakamali", artist: "IV Of Spades" },
                { title: "Raining In Manila", artist: "Lola Amour" }
            ];
            seedSong = defaults[Math.floor(Math.random() * defaults.length)];
        }
    }
    
    const seedKey = `${seedSong.title.toLowerCase()}|||${seedSong.artist.toLowerCase()}`;
    if (!force && seedKey === currentRecSeedKey && listEl.children.length > 0) {
        // Recommendations already loaded for this seed song
        return;
    }
    
    currentRecSeedKey = seedKey;
    if (emptyEl) emptyEl.style.display = "none";
    if (loadingEl) loadingEl.style.display = "block";
    listEl.innerHTML = "";
    
    try {
        const candidates = await fetchSimilarTracksFromLastFm(seedSong);
        
        // Filter duplicates:
        // 1. Must not be in appQueue (checking title and artist)
        // 2. Must not be a duplicate inside candidates itself
        const queueSet = new Set(appQueue.map(s => `${s.title.toLowerCase()}|||${s.artist.toLowerCase()}`));
        const seenRecs = new Set();
        
        // Shuffle candidates so refreshing rotates them!
        const shuffled = candidates.sort(() => Math.random() - 0.5);
        
        const filtered = shuffled.filter(t => {
            const key = `${t.title.toLowerCase()}|||${t.artist.toLowerCase()}`;
            if (queueSet.has(key)) return false;
            if (seenRecs.has(key)) return false;
            seenRecs.add(key);
            return true;
        }).slice(0, 5); // display top 5 recommendations!
        
        if (loadingEl) loadingEl.style.display = "none";
        
        if (filtered.length === 0) {
            if (emptyEl) {
                emptyEl.style.display = "block";
                emptyEl.textContent = "No new recommendations found.";
            }
            return;
        }
        
        filtered.forEach(recSong => {
            const item = document.createElement("div");
            item.className = "rec-item";
            
            // Cover Wrap
            const artWrap = document.createElement("div");
            artWrap.className = "rec-item-art-wrap";
            applyArtToElement(artWrap, recSong, 32, generateThumbnail);
            item.appendChild(artWrap);
            
            // Asynchronously fetch Spotify metadata to resolve high-res cover art!
            invoke("fetch_track_metadata", { artist: recSong.artist, track: recSong.title })
                .then(meta => {
                    if (meta) {
                        const bestImg = getBestImage(meta);
                        if (bestImg) {
                            recSong.image = bestImg;
                            applyArtToElement(artWrap, recSong, 32, generateThumbnail);
                        }
                        if (meta.duration_secs != null) {
                            recSong.duration = meta.duration_secs;
                        }
                    }
                })
                .catch(err => console.warn("Failed to resolve Spotify meta for rec track:", err));
            
            // Info
            const info = document.createElement("div");
            info.className = "rec-item-info";
            
            const titleEl = document.createElement("div");
            titleEl.className = "rec-item-title";
            titleEl.textContent = recSong.title;
            info.appendChild(titleEl);
            
            const artistEl = document.createElement("div");
            artistEl.className = "rec-item-artist";
            artistEl.textContent = recSong.artist;
            info.appendChild(artistEl);
            
            item.appendChild(info);
            
            // Add Button
            const addBtn = document.createElement("button");
            addBtn.className = "rec-item-add-btn";
            addBtn.innerHTML = "+";
            addBtn.title = "Add to Queue";
            addBtn.onclick = () => {
                // Add to queue
                appQueue.push(recSong);
                renderQueueUI();
                statusBar.textContent = `Added "${recSong.title}" to queue!`;
                // Remove item from recommendation UI visually with a nice animation
                item.style.opacity = "0";
                item.style.transform = "scale(0.8)";
                setTimeout(() => {
                    item.remove();
                    if (listEl.children.length === 0) {
                        updateQueueRecommendations(true);
                    }
                }, 200);
            };
            item.appendChild(addBtn);
            
            listEl.appendChild(item);
        });
        
    } catch (err) {
        console.error("Failed to load queue recommendations:", err);
        if (loadingEl) loadingEl.style.display = "none";
        if (emptyEl) {
            emptyEl.style.display = "block";
            emptyEl.textContent = "Failed to load recommendations.";
        }
    }
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

async function fetchSimilarTracksFromLastFm(endedSong) {
    if (!endedSong) return [];
    try {
        console.log("Fetching similar tracks from Last.fm for:", endedSong.title, endedSong.artist);
        const raw = await cachedInvoke("fetch_lastfm", {
            method: "track.getSimilar",
            extraParams: `&artist=${encodeURIComponent(endedSong.artist)}&track=${encodeURIComponent(endedSong.title)}&limit=15`
        });
        const data = JSON.parse(raw);
        if (data.similartracks && data.similartracks.track) {
            let tracks = data.similartracks.track;
            if (Array.isArray(tracks) && tracks.length > 0) {
                return tracks.map(t => {
                    const images = parseImagesFromLastFm(t.image);
                    const artistName = (typeof t.artist === "object") ? t.artist.name : (t.artist || "");
                    return {
                        title: t.name,
                        artist: artistName,
                        album: null,
                        image: pickBestImageUrl(images) || null,
                        duration: t.duration ? Number(t.duration) : null,
                        spotify_url: null
                    };
                });
            }
        }
    } catch (err) {
        console.warn("Last.fm track.getSimilar failed:", err);
    }
    
    // Fallback to artist.getTopTracks
    try {
        console.log("Last.fm fallback: Fetching top tracks for artist:", endedSong.artist);
        const raw = await cachedInvoke("fetch_lastfm", {
            method: "artist.getTopTracks",
            extraParams: `&artist=${encodeURIComponent(endedSong.artist)}&limit=15`
        });
        const data = JSON.parse(raw);
        if (data.toptracks && data.toptracks.track) {
            let tracks = data.toptracks.track;
            if (Array.isArray(tracks) && tracks.length > 0) {
                return tracks.map(t => {
                    const images = parseImagesFromLastFm(t.image);
                    const artistName = (typeof t.artist === "object") ? t.artist.name : (t.artist || "");
                    return {
                        title: t.name,
                        artist: artistName,
                        album: null,
                        image: pickBestImageUrl(images) || null,
                        duration: t.duration ? Number(t.duration) : null,
                        spotify_url: null
                    };
                });
            }
        }
    } catch (err) {
        console.warn("Last.fm artist.getTopTracks failed:", err);
    }
    
    return [];
}

let currentPrefetchSongKey = null;

async function prefetchAutoplayTrack(endedSong) {
    if (!endedSong) return;
    const songKeyStr = songKey(endedSong);
    if (currentPrefetchSongKey === songKeyStr) return; // Already prefetched for this song
    currentPrefetchSongKey = songKeyStr;

    try {
        console.log("Background prefetching autoplay track for artist:", endedSong.artist);
        
        // 1. Try Last.fm first (incredibly reliable, fast, immune to dynamic library issues)
        let candidates = await fetchSimilarTracksFromLastFm(endedSong);
        
        // 2. If Last.fm returned nothing, fall back to spotDL Search
        if (!candidates || candidates.length === 0) {
            console.log("Last.fm returned 0 tracks. Falling back to spotDL search...");
            let searchResults = null;
            const queries = [
                endedSong.artist,
                `${endedSong.artist} popular`,
                endedSong.title,
                "popular hit songs"
            ];

            for (const q of queries) {
                if (!q) continue;
                try {
                    searchResults = await runSpotifySearch(q);
                    if (searchResults && searchResults.tracks && searchResults.tracks.length > 0) {
                        break;
                    }
                } catch (innerErr) {
                    console.warn(`Autoplay prefetch query "${q}" failed:`, innerErr);
                }
            }

            if (searchResults && searchResults.tracks && searchResults.tracks.length > 0) {
                candidates = searchResults.tracks.map(t => mapSpotifyTrack(t));
            }
        }

        if (candidates && candidates.length > 0) {
            // Filter out the song that just ended to prevent immediate repeat
            let filtered = candidates.filter(t => {
                const titleMatch = t.title.toLowerCase().includes(endedSong.title.toLowerCase()) || 
                                   endedSong.title.toLowerCase().includes(t.title.toLowerCase());
                return !titleMatch;
            });
            
            // If all tracks are filtered out, fallback to all candidates
            if (filtered.length === 0) {
                filtered = candidates;
            }
            
            // Select a random popular track from the top 8 candidates to keep it diverse but high quality
            const subset = filtered.slice(0, 8);
            const chosenTrack = subset[Math.floor(Math.random() * subset.length)];
            
            if (chosenTrack) {
                console.log("Autoplay prefetch selected next track:", chosenTrack.title, "by", chosenTrack.artist);
                
                // If the currently playing song is still the same song (user didn't skip in the meantime)
                if (currentSong && songKey(currentSong) === songKeyStr) {
                    // Check if we still need autoplay (no next song in queue)
                    const isLastInQueue = appQueue.length === 0 || queueIndex === appQueue.length - 1;
                    if (isLastInQueue) {
                        // Dynamically append the autoplayed song to the queue
                        appQueue.push(chosenTrack);
                        renderQueueUI();
                    }
                }
            }
        }
    } catch (err) {
        console.error("Autoplay prefetch failed:", err);
    }
}

async function playSimilarAutoplayTrack(endedSong) {
    if (!endedSong) return;
    try {
        console.log("Queue ended. Fetching autoplay tracks for artist:", endedSong.artist);
        if (statusBar) {
            statusBar.textContent = `Autoplay: Finding next track similar to ${endedSong.title}...`;
        }

        // 1. Try Last.fm first (incredibly reliable, fast, immune to dynamic library issues)
        let candidates = await fetchSimilarTracksFromLastFm(endedSong);
        
        // 2. If Last.fm returned nothing, fall back to spotDL Search
        if (!candidates || candidates.length === 0) {
            console.log("Last.fm returned 0 tracks. Falling back to spotDL search...");
            let searchResults = null;
            const queries = [
                endedSong.artist,
                `${endedSong.artist} popular`,
                endedSong.title,
                "popular hit songs"
            ];

            for (const q of queries) {
                if (!q) continue;
                try {
                    console.log(`Autoplay: Trying search query "${q}"`);
                    searchResults = await runSpotifySearch(q);
                    if (searchResults && searchResults.tracks && searchResults.tracks.length > 0) {
                        console.log(`Autoplay: Successfully fetched tracks using query "${q}"`);
                        break;
                    }
                } catch (innerErr) {
                    console.warn(`Autoplay query "${q}" failed:`, innerErr);
                }
            }

            if (searchResults && searchResults.tracks && searchResults.tracks.length > 0) {
                candidates = searchResults.tracks.map(t => mapSpotifyTrack(t));
            }
        }

        if (candidates && candidates.length > 0) {
            // Filter out the song that just ended to prevent immediate repeat
            let filtered = candidates.filter(t => {
                const titleMatch = t.title.toLowerCase().includes(endedSong.title.toLowerCase()) || 
                                   endedSong.title.toLowerCase().includes(t.title.toLowerCase());
                return !titleMatch;
            });
            
            // If all tracks are filtered out, fallback to all candidates
            if (filtered.length === 0) {
                filtered = candidates;
            }
            
            // Select a random popular track from the top 8 candidates to keep it diverse but high quality
            const subset = filtered.slice(0, 8);
            const chosenTrack = subset[Math.floor(Math.random() * subset.length)];
            
            if (chosenTrack) {
                console.log("Autoplay selected next track:", chosenTrack.title, "by", chosenTrack.artist);
                
                // Dynamically append the autoplayed song to the queue
                appQueue.push(chosenTrack);
                queueIndex = appQueue.length - 1;
                renderQueueUI();
                
                // Play it!
                await playSong(chosenTrack);
                return;
            }
        }
        
        if (statusBar) {
            statusBar.textContent = "Autoplay: No similar tracks found.";
        }
    } catch (err) {
        console.error("Autoplay track recommendation failed:", err);
        if (statusBar) {
            statusBar.textContent = "Autoplay: Failed to load recommendations.";
        }
    }
}

async function playNextTrack() {
    if (loopMode === "one" && currentSong) {
        await playSong(currentSong);
        return;
    }
    if (appQueue.length === 0) {
        if (currentSong) {
            await playSimilarAutoplayTrack(currentSong);
        }
        return;
    }
    const next = getNextQueueIndex();
    if (next < 0) {
        if (currentSong) {
            await playSimilarAutoplayTrack(currentSong);
        }
        return;
    }
    queueIndex = next;
    renderQueueUI();
    await playSong(appQueue[queueIndex]);
}

function onTrackEnded() {
    btnPlay.textContent = "▶";
    isPlaying = false;
    clearDiscordPresence();
    
    // Add to listening history when track ends
    if (currentSong) {
        trackSongPlay(currentSong);
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
    
    const ssShuffle = document.getElementById("ss-btn-shuffle");
    if (ssShuffle) {
        ssShuffle.classList.toggle("active", shuffleOn);
        ssShuffle.title = shuffleOn ? "Shuffle on" : "Shuffle off";
    }
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

    const ssLoop = document.getElementById("ss-btn-loop");
    if (ssLoop) {
        ssLoop.classList.toggle("active", loopMode !== "off");
        ssLoop.title = labels[loopMode];
        if (loopMode === "one") {
            ssLoop.innerHTML = "↻<span style='position:absolute;font-size:8px;top:2px;right:2px;font-weight:bold;color:var(--accent);'>1</span>";
        } else {
            ssLoop.textContent = "↻";
        }
    }
}

function updateDetailLikeButton() {
    if (!detailLikeBtn) return;
    if (!detailSidebarSong) {
        detailLikeBtn.classList.add("hidden");
        return;
    }
    detailLikeBtn.classList.remove("hidden");
    const liked = isSongLiked(detailSidebarSong);
    detailLikeBtn.classList.toggle("liked", liked);
    detailLikeBtn.textContent = liked ? "♥" : "♡";
    detailLikeBtn.title = liked ? "Remove from Liked Songs" : "Save to Liked Songs";
}

function updateLikeButton() {
    if (!npLikeBtn) return;
    const hasTrack = Boolean(currentSong?.title && currentSong?.artist);
    npLikeBtn.disabled = !hasTrack;
    if (!hasTrack) {
        npLikeBtn.classList.remove("liked");
        npLikeBtn.textContent = "♡";
        npLikeBtn.title = "Save to Liked Songs";
        updateDetailLikeButton();
        return;
    }
    const liked = isSongLiked(currentSong);
    npLikeBtn.classList.toggle("liked", liked);
    npLikeBtn.textContent = liked ? "♥" : "♡";
    npLikeBtn.title = liked ? "Remove from Liked Songs" : "Save to Liked Songs";
    updateDetailLikeButton();
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

    detailLikeBtn?.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!detailSidebarSong) return;
        const liked = await toggleLikedSong(detailSidebarSong);
        updateDetailLikeButton();
        updateLikeButton();
        renderPlaylistSidebar();
        statusBar.textContent = liked
            ? `Added to Liked Songs: ${detailSidebarSong.title}`
            : `Removed from Liked Songs: ${detailSidebarSong.title}`;
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
    initCustomDragSystem();
    setupProfilePage();

    document.getElementById("btn-clear-queue").addEventListener("click", () => {
        appQueue = [];
        queueIndex = -1;
        renderQueueUI();
    });

    document.getElementById("btn-save-queue-playlist").addEventListener("click", () => {
        promptSaveQueueAsPlaylist();
    });

    document.getElementById("btn-refresh-queue-recs").addEventListener("click", () => {
        updateQueueRecommendations(true);
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

    // Check for app updates
    checkAppUpdates();
}

async function checkAppUpdates() {
    try {
        if (!window.__TAURI__ || !window.__TAURI__.updater) {
            console.warn("Tauri updater plugin is not available on this platform/build.");
            return;
        }

        const { check } = window.__TAURI__.updater;
        const update = await check();
        if (update) {
            console.log(`Update is available! New version: ${update.version}`);
            const updateBtn = document.getElementById("btn-update-available");
            if (updateBtn) {
                updateBtn.style.display = "flex";
                updateBtn.addEventListener("click", async () => {
                    updateBtn.disabled = true;
                    updateBtn.textContent = "Downloading...";
                    updateBtn.style.animation = "none";
                    updateBtn.style.background = "#ffa500";
                    updateBtn.style.color = "#000";
                    try {
                        let downloaded = 0;
                        let contentLength = 0;
                        await update.downloadAndInstall((event) => {
                            switch (event.event) {
                                case 'Started':
                                    contentLength = event.data.contentLength;
                                    console.log(`Started downloading ${contentLength} bytes`);
                                    break;
                                case 'Progress':
                                    downloaded += event.data.chunkLength;
                                    if (contentLength) {
                                        const percent = Math.round((downloaded / contentLength) * 100);
                                        updateBtn.textContent = `Downloading (${percent}%)`;
                                    }
                                    break;
                                case 'Finished':
                                    console.log('Download finished');
                                    break;
                            }
                        });
                        
                        updateBtn.textContent = "Relaunching...";
                        updateBtn.style.background = "#1db954";
                        updateBtn.style.color = "#fff";
                        
                        if (window.__TAURI__.process && window.__TAURI__.process.relaunch) {
                            await window.__TAURI__.process.relaunch();
                        } else {
                            await invoke("tauri", { cmd: "relaunch" });
                        }
                    } catch (err) {
                        console.error("Failed to install update:", err);
                        updateBtn.disabled = false;
                        updateBtn.textContent = "Update failed (Retry)";
                        updateBtn.style.background = "#d32f2f";
                        updateBtn.style.color = "#fff";
                    }
                });
            }
        }
    } catch (err) {
        console.error("Error during update check:", err);
    }
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
        const val = Number(e.target.value);
        audioPlayer.volume = val / 100;
        const ssVolBar = document.getElementById("ss-volume-bar");
        if (ssVolBar) {
            ssVolBar.value = val;
        }
    });

    let lastSavedSec = -1;
    audioPlayer.addEventListener("timeupdate", () => {
        if (isSeeking || !Number.isFinite(audioPlayer.duration)) return;
        progressBar.value =
            (audioPlayer.currentTime / audioPlayer.duration) * 100;
        timeCurrent.textContent = formatTime(audioPlayer.currentTime);

        const sec = Math.floor(audioPlayer.currentTime);
        if (sec !== lastSavedSec && sec >= 0) {
            lastSavedSec = sec;
            localStorage.setItem("spotdl_gui_last_played_progress", sec.toString());
        }
    });

    audioPlayer.addEventListener("loadedmetadata", () => {
        timeTotal.textContent = formatTime(audioPlayer.duration);
        if (isSeeking && Number.isFinite(audioPlayer.duration)) {
            audioPlayer.currentTime =
                (progressBar.value / 100) * audioPlayer.duration;
        } else if (window.restoreProgressSec != null && Number.isFinite(audioPlayer.duration)) {
            audioPlayer.currentTime = window.restoreProgressSec;
            window.restoreProgressSec = null;
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
        updatePlayingIndicators();
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

let hasTrackedCurrentSongPlay = false;

function trackSongPlay(song) {
    if (!song || hasTrackedCurrentSongPlay) return;
    hasTrackedCurrentSongPlay = true;

    const sanitizedTrack = {
        id: song.id || String(song.title + song.artist).replace(/[^a-zA-Z0-9]/g, ""),
        title: song.title || "Unknown Title",
        artist: song.artist || "Unknown Artist",
        album: song.album || null,
        image: song.image || null,
        duration_secs: song.duration_secs || song.duration || null,
        play_count: song.play_count || 0,
        spotify_url: song.spotify_url || null,
        order: song.order || 0
    };

    invoke("add_to_history", { track: sanitizedTrack })
        .then(() => {
            console.log("Successfully added to history:", sanitizedTrack.title);
            if (views.profile && !views.profile.classList.contains("hidden")) {
                renderProfilePage();
            }
        })
        .catch(err => console.error("Failed to add to history:", err));
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

        refreshDownloadedKeys().catch(console.error);
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
    document.getElementById("nav-profile-btn")?.addEventListener("click", () => {
        switchView("profile");
        renderProfilePage();
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

            let accentColor = "#1db954";
            try {
                accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || "#1db954";
            } catch (e) {}

            const barWidth = 3;
            let x = 0;
            for (let i = 0; i < 15; i++) {
                const barHeight = (dataArray[i] / 255) * vizCanvas.height;
                ctx.fillStyle = accentColor;
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

let activeCustomDrag = null;

function clearActiveDragGhost() {
    if (activeCustomDrag) {
        if (activeCustomDrag.ghostEl) {
            try {
                activeCustomDrag.ghostEl.remove();
            } catch (e) {}
        }
        try {
            activeCustomDrag.element.classList.remove("dragging");
        } catch (e) {}
        activeCustomDrag = null;
    }
    document.querySelectorAll(".drag-ghost").forEach(el => {
        try {
            el.remove();
        } catch (e) {}
    });
    document.querySelectorAll("#playlist-list li").forEach(li => {
        try {
            li.classList.remove("drag-over");
        } catch (e) {}
    });
}

function initCustomDragSystem() {
    window.addEventListener("mousemove", (e) => {
        if (!activeCustomDrag) return;
        
        if (!activeCustomDrag.dragStarted) {
            const dx = e.clientX - activeCustomDrag.startX;
            const dy = e.clientY - activeCustomDrag.startY;
            if (Math.sqrt(dx * dx + dy * dy) > 8) {
                activeCustomDrag.dragStarted = true;
                
                const ghost = document.createElement("div");
                ghost.className = "drag-ghost";
                ghost.style.position = "fixed";
                ghost.style.pointerEvents = "none";
                ghost.style.zIndex = "99999";
                
                const song = activeCustomDrag.song;
                ghost.innerHTML = `
                    <div class="ghost-content" style="
                        display: flex;
                        align-items: center;
                        gap: 10px;
                        background: rgba(30, 30, 30, 0.85);
                        backdrop-filter: blur(10px);
                        -webkit-backdrop-filter: blur(10px);
                        border: 1px solid rgba(255, 255, 255, 0.15);
                        padding: 8px 14px;
                        border-radius: 8px;
                        box-shadow: 0 8px 24px rgba(0,0,0,0.5);
                        color: #ffffff;
                        font-family: inherit;
                        font-size: 13px;
                        transform: translate(-50%, -50%);
                    ">
                        <div class="ghost-art" style="width: 32px; height: 32px; border-radius: 4px; overflow: hidden; background: #333; display: flex; align-items: center; justify-content: center;">
                            ${song.image ? `<img src="${song.image}" style="width: 100%; height: 100%; object-fit: cover;">` : `<span style="font-size:10px;">🎵</span>`}
                        </div>
                        <div style="display: flex; flex-direction: column; max-width: 180px;">
                            <span style="font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(song.title)}</span>
                            <span style="font-size: 11px; opacity: 0.7; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(song.artist)}</span>
                        </div>
                    </div>
                `;
                document.body.appendChild(ghost);
                activeCustomDrag.ghostEl = ghost;
                activeCustomDrag.element.classList.add("dragging");
            }
        }
        
        if (activeCustomDrag.dragStarted && activeCustomDrag.ghostEl) {
            activeCustomDrag.ghostEl.style.left = `${e.clientX}px`;
            activeCustomDrag.ghostEl.style.top = `${e.clientY}px`;
            
            const under = document.elementFromPoint(e.clientX, e.clientY);
            const targetLi = under?.closest("#playlist-list li");
            
            document.querySelectorAll("#playlist-list li").forEach(li => {
                if (li !== targetLi) li.classList.remove("drag-over");
            });
            
            if (targetLi) {
                targetLi.classList.add("drag-over");
            }
        }
    });
    
    window.addEventListener("mouseup", async (e) => {
        if (!activeCustomDrag) return;
        
        const drag = activeCustomDrag;
        activeCustomDrag = null;
        
        if (drag.ghostEl) {
            drag.ghostEl.remove();
        }
        drag.element.classList.remove("dragging");
        
        if (drag.dragStarted) {
            const under = document.elementFromPoint(e.clientX, e.clientY);
            const targetLi = under?.closest("#playlist-list li");
            if (targetLi) {
                targetLi.classList.remove("drag-over");
                
                const playlistId = targetLi.__playlistId;
                if (playlistId) {
                    try {
                        const song = drag.song;
                        await addTrackToPlaylist(playlistId, song);
                        
                        if (isLikedPlaylist(playlistId)) {
                            updateLikeButton();
                            updateDetailLikeButton();
                        }
                        
                        if (getActivePlaylistId() === playlistId) {
                            openPlaylistView(playlistId);
                        }
                        
                        renderPlaylistSidebar();
                        
                        statusBar.textContent = `Added "${song.title}" to playlist "${getPlaylist(playlistId).name}"`;
                    } catch (err) {
                        console.error("Custom drop failed:", err);
                    }
                }
            }
        }
    });

    // Clean up if standard browser dragend or drop is triggered
    window.addEventListener("dragend", clearActiveDragGhost);
    window.addEventListener("drop", clearActiveDragGhost);
}

function makeSongDraggable(element, song) {
    element.setAttribute("draggable", "true");
    element.addEventListener("dragstart", (e) => {
        const payload = {
            song: {
                title: song.title,
                artist: song.artist,
                album: song.album || null,
                image: song.image || null,
                duration: song.duration ?? song.duration_secs ?? null,
                spotify_url: song.spotify_url || null,
                play_count: song.play_count ?? 0,
            }
        };
        e.dataTransfer.setData("text/plain", JSON.stringify(payload));
        e.dataTransfer.effectAllowed = "copy";
        element.classList.add("dragging");
    });
    element.addEventListener("dragend", () => {
        element.classList.remove("dragging");
        clearActiveDragGhost();
    });
    
    element.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        if (e.target.closest("button") || e.target.closest("a")) return;
        
        activeCustomDrag = {
            song: song,
            element: element,
            ghostEl: null,
            dragStarted: false,
            startX: e.clientX,
            startY: e.clientY
        };
    });
}

function makePlaylistDroppable(element, playlistId) {
    element.__playlistId = playlistId;
    element.addEventListener("dragenter", (e) => {
        e.preventDefault();
        element.classList.add("drag-over");
    });
    element.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
    });
    element.addEventListener("dragleave", () => {
        element.classList.remove("drag-over");
    });
    element.addEventListener("drop", async (e) => {
        e.preventDefault();
        element.classList.remove("drag-over");
        try {
            const raw = e.dataTransfer.getData("text/plain");
            if (!raw) return;
            const data = JSON.parse(raw);
            const song = data.song;
            if (!song?.title || !song?.artist) return;
            
            await addTrackToPlaylist(playlistId, song);
            
            if (isLikedPlaylist(playlistId)) {
                updateLikeButton();
                updateDetailLikeButton();
            }
            
            if (getActivePlaylistId() === playlistId) {
                openPlaylistView(playlistId);
            }
            
            renderPlaylistSidebar();
            
            statusBar.textContent = `Added "${song.title}" to playlist "${getPlaylist(playlistId).name}"`;
        } catch (err) {
            console.error("Drop failed:", err);
        }
    });
}

let activeHomeFilter = "all";

function applyActiveHomeFilter() {
    const sections = {
        all: [
            "home-section-playlists",
            "home-section-recent",
            "home-section-charts",
            "home-section-tracks",
            "home-section-albums"
        ],
        playlists: ["home-section-playlists"],
        recent: ["home-section-recent"],
        charts: ["home-section-charts", "home-section-tracks", "home-section-albums"]
    };

    const targetList = sections[activeHomeFilter] || sections.all;

    document.querySelectorAll(".home-section").forEach(sec => {
        if (targetList.includes(sec.id)) {
            sec.classList.remove("hidden");
        } else {
            sec.classList.add("hidden");
        }
    });

    document.querySelectorAll("#home-filter-container .filter-chip").forEach(chip => {
        if (chip.getAttribute("data-filter") === activeHomeFilter) {
            chip.classList.add("active");
        } else {
            chip.classList.remove("active");
        }
    });
}

function setupHomeFilters() {
    document.querySelectorAll("#home-filter-container .filter-chip").forEach(chip => {
        chip.addEventListener("click", () => {
            const filterValue = chip.getAttribute("data-filter");
            activeHomeFilter = filterValue;
            
            const currentView = document.querySelector(".view:not(.hidden)");
            if (currentView?.id !== "view-home") {
                const homeBtn = document.getElementById("nav-home");
                if (homeBtn) {
                    homeBtn.click();
                }
            }
            
            applyActiveHomeFilter();
        });
    });
}

function createRecentlyPlayedCard(song) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "collection-card song-card";
    card.innerHTML = `
        <div class="collection-card-art" data-art></div>
        <div class="collection-card-body">
            <div class="collection-card-title">${escapeHtml(song.title)}</div>
            <div class="collection-card-sub">${escapeHtml(song.artist)}</div>
        </div>
    `;
    const artEl = card.querySelector("[data-art]");
    if (isValidImage(song.image)) {
        resolveArtUrl(song.image).then(url => {
            if (url) {
                artEl.innerHTML = "";
                const img = document.createElement("img");
                img.src = url;
                img.alt = song.title;
                img.loading = "lazy";
                artEl.appendChild(img);
            }
        });
    } else {
        artEl.appendChild(generateThumbnail(song.title, song.artist, 168));
    }
    
    makeSongDraggable(card, song);

    card.addEventListener("click", async () => {
        await playSong(song);
    });

    return card;
}

function setupHome() {
    homeBackBtn.addEventListener("click", showHomeBrowse);
    setupHomeFilters();
    window.addEventListener("recently-played-updated", () => {
        const view = document.getElementById("view-home");
        if (view && !view.classList.contains("hidden")) {
            renderHomeBrowse();
        }
    });
}

function showHomeBrowse() {
    homeBrowse.classList.remove("hidden");
    homeCollection.classList.add("hidden");
    currentCollection = null;
}

async function enrichCollageItems(items) {
    const needs = items.filter(t => t && !isValidImage(t.image)).slice(0, 8);
    await mapPool(needs, 8, async (item) => {
        try {
            let url = item.image;
            if (!isValidImage(url)) {
                if (item.isAlbum) {
                    const meta = await cachedInvoke("fetch_album_metadata", {
                        artist: item.artist,
                        album: item.title,
                    });
                    url = pickBestImageUrl(meta.album_images || []);
                } else {
                    const meta = await cachedInvoke("fetch_track_metadata", {
                        artist: item.artist,
                        track: item.title,
                    });
                    url = pickBestImageUrl(
                        mergeImages(
                            meta.album_images || [],
                            meta.track_images || [],
                        )
                    );
                }
            }
            if (url) {
                item.image = url;
            }
        } catch (e) {
            // ignore
        }
    });
}

async function renderCollageArt(items, artEl, fallbackTitle, fallbackSubtitle, size = 168) {
    artEl.innerHTML = "";
    artEl.style.position = "relative";
    const itemsWithImages = items.filter(t => t && t.image && isValidImage(t.image));
    
    if (itemsWithImages.length >= 4) {
        const grid = document.createElement("div");
        grid.className = "playlist-collage-grid";
        grid.style.display = "grid";
        grid.style.gridTemplateColumns = "repeat(2, 1fr)";
        grid.style.gridTemplateRows = "repeat(2, 1fr)";
        grid.style.gap = "8px";
        grid.style.padding = "6px";
        grid.style.width = "100%";
        grid.style.height = "100%";
        grid.style.overflow = "hidden";
        grid.style.borderRadius = "inherit";
        grid.style.boxSizing = "border-box";
        grid.style.background = "var(--bg-panel)";
        
        const resolves = itemsWithImages.slice(0, 4).map(t => resolveArtUrl(t.image));
        const urls = await Promise.all(resolves);
        
        urls.forEach((url, index) => {
            const cardWrap = document.createElement("div");
            cardWrap.style.width = "100%";
            cardWrap.style.height = "100%";
            cardWrap.style.overflow = "hidden";
            
            const classes = ["playlist-collage-card"];
            if (index === 0) classes.push("playlist-collage-card-tl");
            else if (index === 1) classes.push("playlist-collage-card-tr");
            else if (index === 2) classes.push("playlist-collage-card-bl");
            else if (index === 3) classes.push("playlist-collage-card-br");
            cardWrap.className = classes.join(" ");
            
            const img = document.createElement("img");
            img.src = url || "";
            img.style.width = "100%";
            img.style.height = "100%";
            img.style.objectFit = "cover";
            
            cardWrap.appendChild(img);
            grid.appendChild(cardWrap);
        });
        
        artEl.appendChild(grid);
    } else if (itemsWithImages.length > 0) {
        const first = itemsWithImages[0];
        const url = await resolveArtUrl(first.image);
        if (url) {
            const img = document.createElement("img");
            img.src = url;
            img.alt = fallbackTitle;
            img.loading = "lazy";
            img.style.width = "100%";
            img.style.height = "100%";
            img.style.objectFit = "cover";
            img.style.borderRadius = "inherit";
            artEl.appendChild(img);
        } else {
            artEl.appendChild(generateThumbnail(fallbackTitle, fallbackSubtitle, size));
        }
    } else {
        artEl.appendChild(generateThumbnail(fallbackTitle, fallbackSubtitle, size));
    }
}

async function renderPlaylistArt(pl, artEl, size = 168) {
    await renderCollageArt(pl.tracks, artEl, pl.name, `${pl.tracks.length} tracks`, size);
}

function createPlaylistHomeCard(pl) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "collection-card playlist-home-card";
    const count = pl.tracks.length;
    card.innerHTML = `
    <div class="collection-card-art" data-art></div>
    <div class="collection-card-body">
      <div class="collection-card-title">${escapeHtml(pl.name)}</div>
      <div class="collection-card-sub">${count} track${count === 1 ? "" : "s"}</div>
    </div>
  `;
    const artEl = card.querySelector("[data-art]");
    renderPlaylistArt(pl, artEl, 168);
    card.addEventListener("click", () => openPlaylistView(pl.id));
    return card;
}

async function renderHomeBrowse() {
    const rows = {
        playlists: document.getElementById("home-row-playlists"),
        recent: document.getElementById("home-row-recent"),
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

    const recentRow = rows.recent;
    if (recentRow) {
        const recents = getRecentlyPlayedSongs();
        if (!recents.length) {
            recentRow.innerHTML =
                '<span class="home-playlists-empty">Tracks you play will appear here.</span>';
        } else {
            for (const song of recents) {
                recentRow.appendChild(createRecentlyPlayedCard(song));
            }
        }
    }

    for (const col of homeCollections) {
        const card = createCollectionCard(col);
        rows[col.row]?.appendChild(card);
    }

    applyActiveHomeFilter();
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
            await enrichCollageItems(items);
            await renderCollageArt(items, artEl, collection.title, collection.subtitle, 168);
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
            homeCollectionSubtitle.textContent = `${collection.subtitle} · Fetching more albums...`;
            await renderAlbumGrid(items, homeCollectionGrid);
            
            enrichAlbumsArt(items, homeCollectionGrid).then(() => {
                if (currentCollection === collection) {
                    homeCollectionSubtitle.textContent = collection.subtitle;
                }
            });
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
    
    let generatedCss = "";
    
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
        }\n`;
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
        }\n`;
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
        }\n`;
    } else if (themeName && themeName.startsWith("custom-")) {
        const themeId = themeName.replace("custom-", "");
        let customThemes = [];
        try {
            customThemes = JSON.parse(localStorage.getItem("app-custom-themes") || "[]");
        } catch (e) {}
        const theme = customThemes.find(t => t.id === themeId);
        if (theme) {
            generatedCss = theme.css + "\n";
        }
    }
    
    if (customCssCode) {
        generatedCss += customCssCode;
    }

    style.innerHTML = generatedCss;
}

function refreshThemeOptions() {
    const themeSelect = document.getElementById("theme-select");
    if (!themeSelect) return;
    
    const currentVal = themeSelect.value;
    
    themeSelect.innerHTML = `
        <option value="default">Default Dark</option>
        <option value="light">Light Mode</option>
        <option value="catppuccin-mocha">Catppuccin Mocha</option>
        <option value="dracula">Dracula</option>
    `;
    
    let customThemes = [];
    try {
        customThemes = JSON.parse(localStorage.getItem("app-custom-themes") || "[]");
    } catch (e) {}
    
    customThemes.forEach(theme => {
        const option = document.createElement("option");
        option.value = `custom-${theme.id}`;
        option.textContent = theme.name;
        themeSelect.appendChild(option);
    });
    
    if (currentVal && Array.from(themeSelect.options).some(opt => opt.value === currentVal)) {
        themeSelect.value = currentVal;
    }
}

// Initial theme load
applyTheme(localStorage.getItem("app-theme") || "default", localStorage.getItem("app-custom-css") || "");

function setupSettings() {
    // Theme logic
    const themeSelect = document.getElementById("theme-select");
    const customCssInput = document.getElementById("custom-css-input");
    const btnImportCss = document.getElementById("btn-import-css");
    const cssFileInput = document.getElementById("css-file-input");

    refreshThemeOptions();

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

    const btnCreateTheme = document.getElementById("btn-create-theme");
    btnCreateTheme?.addEventListener("click", () => {
        const computed = getComputedStyle(document.documentElement);
        
        const getVal = (varName, fallback) => {
            let val = computed.getPropertyValue(varName).trim();
            if (!val) return fallback;
            // Ensure 6-digit hex format for input[type=color] compatibility
            if (val.startsWith("#") && val.length === 4) {
                val = "#" + val[1] + val[1] + val[2] + val[2] + val[3] + val[3];
            }
            return val;
        };

        const currentBg = getVal("--bg", "#121212");
        const currentAccent = getVal("--accent", "#1db954");
        const currentPanel = getVal("--bg-panel", "#181818");
        const currentCard = getVal("--bg-card", "#1e1e1e");
        const currentHover = getVal("--bg-hover", "#282828");
        const currentBorder = getVal("--border", "#333333");
        const currentFg = getVal("--fg", "#e0e0e0");
        const currentFgMuted = getVal("--fg-muted", "#a0a0a0");

        const originalCustomCss = customCssInput ? customCssInput.value : "";
        const originalTheme = themeSelect ? themeSelect.value : "default";

        const bodyHtml = `
            <div class="theme-creator-modal" style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px 20px; margin-bottom: 20px;">
                <div style="grid-column: span 2; display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px;">
                    <label style="font-size: 0.85rem; color: var(--fg-muted);">Theme Name</label>
                    <input type="text" id="tc-name" placeholder="E.g. Neon Cyber, Forest Mist..." autocomplete="off" style="width: 100%; padding: 10px 14px; background: var(--bg-hover); border: 1px solid var(--border); color: var(--fg); border-radius: 6px; font-size: 0.9rem; box-sizing: border-box; font-family: monospace;" />
                </div>
                <div style="display: flex; flex-direction: column; gap: 4px;">
                    <label style="font-size: 0.85rem; color: var(--fg-muted);">Background Color</label>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <input type="color" id="tc-bg" value="${currentBg}" style="width: 32px; height: 32px; border: 1px solid var(--border); padding: 0; background: none; cursor: pointer; border-radius: 6px;" />
                        <span id="tc-bg-txt" style="font-size: 0.85rem; font-family: monospace;">${currentBg}</span>
                    </div>
                </div>
                <div style="display: flex; flex-direction: column; gap: 4px;">
                    <label style="font-size: 0.85rem; color: var(--fg-muted);">Accent Color</label>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <input type="color" id="tc-accent" value="${currentAccent}" style="width: 32px; height: 32px; border: 1px solid var(--border); padding: 0; background: none; cursor: pointer; border-radius: 6px;" />
                        <span id="tc-accent-txt" style="font-size: 0.85rem; font-family: monospace;">${currentAccent}</span>
                    </div>
                </div>
                <div style="display: flex; flex-direction: column; gap: 4px;">
                    <label style="font-size: 0.85rem; color: var(--fg-muted);">Panel Background</label>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <input type="color" id="tc-panel" value="${currentPanel}" style="width: 32px; height: 32px; border: 1px solid var(--border); padding: 0; background: none; cursor: pointer; border-radius: 6px;" />
                        <span id="tc-panel-txt" style="font-size: 0.85rem; font-family: monospace;">${currentPanel}</span>
                    </div>
                </div>
                <div style="display: flex; flex-direction: column; gap: 4px;">
                    <label style="font-size: 0.85rem; color: var(--fg-muted);">Card Background</label>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <input type="color" id="tc-card" value="${currentCard}" style="width: 32px; height: 32px; border: 1px solid var(--border); padding: 0; background: none; cursor: pointer; border-radius: 6px;" />
                        <span id="tc-card-txt" style="font-size: 0.85rem; font-family: monospace;">${currentCard}</span>
                    </div>
                </div>
                <div style="display: flex; flex-direction: column; gap: 4px;">
                    <label style="font-size: 0.85rem; color: var(--fg-muted);">Hover Background</label>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <input type="color" id="tc-hover" value="${currentHover}" style="width: 32px; height: 32px; border: 1px solid var(--border); padding: 0; background: none; cursor: pointer; border-radius: 6px;" />
                        <span id="tc-hover-txt" style="font-size: 0.85rem; font-family: monospace;">${currentHover}</span>
                    </div>
                </div>
                <div style="display: flex; flex-direction: column; gap: 4px;">
                    <label style="font-size: 0.85rem; color: var(--fg-muted);">Border Color</label>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <input type="color" id="tc-border" value="${currentBorder}" style="width: 32px; height: 32px; border: 1px solid var(--border); padding: 0; background: none; cursor: pointer; border-radius: 6px;" />
                        <span id="tc-border-txt" style="font-size: 0.85rem; font-family: monospace;">${currentBorder}</span>
                    </div>
                </div>
                <div style="display: flex; flex-direction: column; gap: 4px;">
                    <label style="font-size: 0.85rem; color: var(--fg-muted);">Text (Primary)</label>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <input type="color" id="tc-fg" value="${currentFg}" style="width: 32px; height: 32px; border: 1px solid var(--border); padding: 0; background: none; cursor: pointer; border-radius: 6px;" />
                        <span id="tc-fg-txt" style="font-size: 0.85rem; font-family: monospace;">${currentFg}</span>
                    </div>
                </div>
                <div style="display: flex; flex-direction: column; gap: 4px;">
                    <label style="font-size: 0.85rem; color: var(--fg-muted);">Text (Secondary)</label>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <input type="color" id="tc-fg-muted" value="${currentFgMuted}" style="width: 32px; height: 32px; border: 1px solid var(--border); padding: 0; background: none; cursor: pointer; border-radius: 6px;" />
                        <span id="tc-fg-muted-txt" style="font-size: 0.85rem; font-family: monospace;">${currentFgMuted}</span>
                    </div>
                </div>
            </div>
            <div style="font-size: 0.8rem; color: var(--fg-muted); border-top: 1px solid var(--border); padding-top: 12px; line-height: 1.4; margin-top: 10px;">
                * Color modifications will be applied live so you can preview them instantly!
            </div>
        `;

        showModal(
            "Custom Theme Creator",
            bodyHtml,
            () => {
                const nameInput = document.getElementById("tc-name");
                const name = nameInput ? nameInput.value.trim() : "";
                if (!name) {
                    if (nameInput) {
                        nameInput.style.borderColor = "#ff4444";
                        nameInput.placeholder = "Please enter a theme name!";
                        nameInput.animate([
                            { transform: 'translateX(0px)' },
                            { transform: 'translateX(-4px)' },
                            { transform: 'translateX(4px)' },
                            { transform: 'translateX(-4px)' },
                            { transform: 'translateX(4px)' },
                            { transform: 'translateX(0px)' }
                        ], { duration: 200 });
                    }
                    return false;
                }

                const bg = document.getElementById("tc-bg").value;
                const accent = document.getElementById("tc-accent").value;
                const panel = document.getElementById("tc-panel").value;
                const card = document.getElementById("tc-card").value;
                const hover = document.getElementById("tc-hover").value;
                const border = document.getElementById("tc-border").value;
                const fg = document.getElementById("tc-fg").value;
                const fgMuted = document.getElementById("tc-fg-muted").value;

                const customThemeCss = `:root {
    --bg: ${bg};
    --accent: ${accent};
    --bg-panel: ${panel};
    --bg-card: ${card};
    --bg-hover: ${hover};
    --border: ${border};
    --fg: ${fg};
    --fg-muted: ${fgMuted};
}`;
                // Clear inline style overrides from preview targets!
                const app = document.getElementById("app");
                const titlebar = document.getElementById("custom-titlebar");
                const targets = [app, titlebar].filter(Boolean);
                const ids = ["--bg", "--accent", "--bg-panel", "--bg-card", "--bg-hover", "--border", "--fg", "--fg-muted"];
                
                targets.forEach(el => {
                    ids.forEach(varName => el.style.removeProperty(varName));
                });

                // Generate a safe unique ID for this theme
                const themeId = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "theme-" + Date.now();

                // Retrieve existing custom themes
                let customThemes = [];
                try {
                    customThemes = JSON.parse(localStorage.getItem("app-custom-themes") || "[]");
                } catch (e) {}

                // Remove theme if it already exists with the same ID, or append it
                customThemes = customThemes.filter(t => t.id !== themeId);
                customThemes.push({
                    id: themeId,
                    name: name,
                    css: customThemeCss
                });

                // Save custom themes list
                localStorage.setItem("app-custom-themes", JSON.stringify(customThemes));

                // Update theme select preference
                localStorage.setItem("app-theme", `custom-${themeId}`);

                // Refresh options dropdown and set to new theme
                refreshThemeOptions();
                if (themeSelect) {
                    themeSelect.value = `custom-${themeId}`;
                }

                // Apply the theme immediately
                applyTheme(`custom-${themeId}`, customCssInput ? customCssInput.value : "");

                statusBar.textContent = `Custom theme "${name}" created and applied!`;
            },
            "Save Theme",
            true,
            () => {
                // Revert live preview changes if cancelled
                applyTheme(originalTheme, originalCustomCss);

                // Clear inline style overrides from preview targets!
                const app = document.getElementById("app");
                const titlebar = document.getElementById("custom-titlebar");
                const targets = [app, titlebar].filter(Boolean);
                const ids = ["--bg", "--accent", "--bg-panel", "--bg-card", "--bg-hover", "--border", "--fg", "--fg-muted"];
                
                targets.forEach(el => {
                    ids.forEach(varName => el.style.removeProperty(varName));
                });
            }
        );

        // Live preview dynamic engine!
        const liveUpdate = () => {
            const bg = document.getElementById("tc-bg").value;
            const accent = document.getElementById("tc-accent").value;
            const panel = document.getElementById("tc-panel").value;
            const card = document.getElementById("tc-card").value;
            const hover = document.getElementById("tc-hover").value;
            const border = document.getElementById("tc-border").value;
            const fg = document.getElementById("tc-fg").value;
            const fgMuted = document.getElementById("tc-fg-muted").value;

            document.getElementById("tc-bg-txt").textContent = bg.toUpperCase();
            document.getElementById("tc-accent-txt").textContent = accent.toUpperCase();
            document.getElementById("tc-panel-txt").textContent = panel.toUpperCase();
            document.getElementById("tc-card-txt").textContent = card.toUpperCase();
            document.getElementById("tc-hover-txt").textContent = hover.toUpperCase();
            document.getElementById("tc-border-txt").textContent = border.toUpperCase();
            document.getElementById("tc-fg-txt").textContent = fg.toUpperCase();
            document.getElementById("tc-fg-muted-txt").textContent = fgMuted.toUpperCase();

            // Set custom properties only on main app containers so the modal keeps its theme
            const app = document.getElementById("app");
            const titlebar = document.getElementById("custom-titlebar");
            const targets = [app, titlebar].filter(Boolean);

            targets.forEach(el => {
                el.style.setProperty("--bg", bg);
                el.style.setProperty("--accent", accent);
                el.style.setProperty("--bg-panel", panel);
                el.style.setProperty("--bg-card", card);
                el.style.setProperty("--bg-hover", hover);
                el.style.setProperty("--border", border);
                el.style.setProperty("--fg", fg);
                el.style.setProperty("--fg-muted", fgMuted);
            });
        };

        const ids = ["tc-bg", "tc-accent", "tc-panel", "tc-card", "tc-hover", "tc-border", "tc-fg", "tc-fg-muted"];
        ids.forEach(id => {
            const input = document.getElementById(id);
            input?.addEventListener("input", liveUpdate);
        });
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
            
            // Collect all localStorage data (listening data and configurations)
            const customThemes = localStorage.getItem("app-custom-themes");
            const appTheme = localStorage.getItem("app-theme");
            const appCustomCss = localStorage.getItem("app-custom-css");
            const recentlyPlayed = localStorage.getItem("spotdl_gui_recently_played");
            const userProfileName = localStorage.getItem("user_profile_name");
            const collectionViewMode = localStorage.getItem("collectionViewMode");
            const detailSidebarCollapsed = localStorage.getItem("detailSidebarCollapsed");
            
            const exportData = {
                settings,
                playlists: playlistsData,
                history,
                localStorage: {
                    "app-custom-themes": customThemes ? JSON.parse(customThemes) : null,
                    "app-theme": appTheme,
                    "app-custom-css": appCustomCss,
                    "spotdl_gui_recently_played": recentlyPlayed ? JSON.parse(recentlyPlayed) : null,
                    "user_profile_name": userProfileName,
                    "collectionViewMode": collectionViewMode,
                    "detailSidebarCollapsed": detailSidebarCollapsed
                }
            };
            
            const filename = `spot-dl-config-${new Date().toISOString().slice(0,10)}.json`;
            await invoke("save_file_dialog", { 
                filename, 
                content: JSON.stringify(exportData, null, 2) 
            });
            
            setSettingsStatus("Configs and user data exported successfully.", "ok");
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
                // 1. Load current playlists
                const current = await invoke("load_playlists") || [];
                
                // Track matching helper
                const getTrackKey = (t) => `${String(t.artist || "").trim().toLowerCase()}|${String(t.title || "").trim().toLowerCase()}`;
                const generateUniqueId = (prefix) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
                
                // Helper to deep copy and assign new IDs to imported tracks
                const cloneTracks = (tracks, startOrder) => {
                    return tracks.map((t, idx) => ({
                        ...t,
                        id: generateUniqueId("tr"),
                        order: startOrder + idx
                    }));
                };
                
                for (const importedPl of data.playlists) {
                    if (!importedPl.name || !Array.isArray(importedPl.tracks)) continue;
                    
                    // Find if the playlist already exists by ID or name
                    let existingPl = current.find(p => p.id === importedPl.id || p.name.trim().toLowerCase() === importedPl.name.trim().toLowerCase());
                    
                    if (existingPl) {
                        // Merge tracks
                        const existingKeys = new Set(existingPl.tracks.map(getTrackKey));
                        const newTracksToAppend = importedPl.tracks.filter(t => !existingKeys.has(getTrackKey(t)));
                        
                        if (newTracksToAppend.length > 0) {
                            const startOrder = existingPl.tracks.length;
                            const clonedNew = cloneTracks(newTracksToAppend, startOrder);
                            existingPl.tracks = [...existingPl.tracks, ...clonedNew];
                        }
                    } else {
                        // Add a brand new playlist (with cloned/unique IDs to prevent any index clashes)
                        const newPl = {
                            id: importedPl.id === "pl_liked_songs" ? "pl_liked_songs" : generateUniqueId("pl"),
                            name: importedPl.name.trim(),
                            tracks: cloneTracks(importedPl.tracks, 0)
                        };
                        current.push(newPl);
                    }
                }
                
                await invoke("save_playlists", { playlists: current });
                await loadPlaylistsFromDisk();
                renderPlaylistSidebar();
            }
            
            if (data.history && typeof data.history === 'object' && !Array.isArray(data.history)) {
                await invoke("import_history", { history: data.history }).catch(err => console.error("History import err:", err));
            }

            // Restore localStorage data if present in import file
            if (data.localStorage) {
                const ls = data.localStorage;
                if (ls["app-custom-themes"]) {
                    localStorage.setItem("app-custom-themes", JSON.stringify(ls["app-custom-themes"]));
                }
                if (ls["app-theme"]) {
                    localStorage.setItem("app-theme", ls["app-theme"]);
                }
                if (ls["app-custom-css"]) {
                    localStorage.setItem("app-custom-css", ls["app-custom-css"]);
                }
                if (ls["spotdl_gui_recently_played"]) {
                    localStorage.setItem("spotdl_gui_recently_played", JSON.stringify(ls["spotdl_gui_recently_played"]));
                }
                if (ls["user_profile_name"]) {
                    localStorage.setItem("user_profile_name", ls["user_profile_name"]);
                }
                if (ls["collectionViewMode"]) {
                    localStorage.setItem("collectionViewMode", ls["collectionViewMode"]);
                }
                if (ls["detailSidebarCollapsed"]) {
                    localStorage.setItem("detailSidebarCollapsed", ls["detailSidebarCollapsed"]);
                }

                // Apply restored theme
                if (typeof applyTheme === "function") {
                    const restoredTheme = ls["app-theme"] || "default";
                    const restoredCss = ls["app-custom-css"] || "";
                    applyTheme(restoredTheme, restoredCss);
                }
                if (typeof updateThemeSelectOptions === "function") {
                    updateThemeSelectOptions();
                }
                if (typeof renderProfilePage === "function") {
                    renderProfilePage();
                }
            }
            
            await loadSettingsUI();
            await refreshApiStatus();
            setSettingsStatus("Configs and user data imported successfully.", "ok");
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
    try {
        const raw = await cachedInvoke("spotify_search", { query });
        return JSON.parse(raw);
    } catch (err) {
        console.warn("Spotify search failed or returned error. Falling back to Last.fm Search:", err);
        
        try {
            // Concurrent Last.fm search for tracks, albums, and artists
            const [rawTracks, rawAlbums, rawArtists] = await Promise.all([
                cachedInvoke("fetch_lastfm", {
                    method: "track.search",
                    extraParams: `&track=${encodeURIComponent(query)}&limit=20`
                }).catch(() => "{}"),
                cachedInvoke("fetch_lastfm", {
                    method: "album.search",
                    extraParams: `&album=${encodeURIComponent(query)}&limit=10`
                }).catch(() => "{}"),
                cachedInvoke("fetch_lastfm", {
                    method: "artist.search",
                    extraParams: `&artist=${encodeURIComponent(query)}&limit=10`
                }).catch(() => "{}")
            ]);

            const dataTracks = JSON.parse(rawTracks);
            const dataAlbums = JSON.parse(rawAlbums);
            const dataArtists = JSON.parse(rawArtists);

            const tracks = (dataTracks?.results?.trackmatches?.track || []).map(t => {
                const imgUrl = pickBestImageUrl(parseImagesFromLastFm(t.image));
                return {
                    title: t.name,
                    artist: t.artist,
                    album: null,
                    image: imgUrl || null,
                    duration: null,
                    spotify_url: t.url || null,
                    popularity: 50
                };
            });

            const albums = (dataAlbums?.results?.albummatches?.album || []).map(a => {
                const imgUrl = pickBestImageUrl(parseImagesFromLastFm(a.image));
                return {
                    name: a.name,
                    artist: a.artist,
                    image: imgUrl || null,
                    url: a.url || null
                };
            });

            const seenArtists = new Set();
            const artists = [];
            const rawArtistsList = dataArtists?.results?.artistmatches?.artist || [];
            
            for (const art of rawArtistsList) {
                if (!art.name) continue;
                const cleanName = art.name.trim();
                const lowerName = cleanName.toLowerCase();
                
                // Deduplicate identical names
                if (seenArtists.has(lowerName)) continue;
                
                // Skip noisy featuring/variant names if they are not the exact query
                const hasNoisyChars = cleanName.includes(",") || cleanName.includes(";") || cleanName.includes(".") || cleanName.toLowerCase().includes("feat");
                const isExactQuery = lowerName === query.trim().toLowerCase();
                if (hasNoisyChars && !isExactQuery) continue;
                
                seenArtists.add(lowerName);
                const imgUrl = pickBestImageUrl(parseImagesFromLastFm(art.image));
                
                artists.push({
                    name: cleanName,
                    image: imgUrl || null,
                    url: art.url || null
                });
                
                // Limit to top 4 clean artist matches max for premium UI layout!
                if (artists.length >= 4) break;
            }

            return {
                type: "search_results",
                tracks: tracks,
                albums: albums,
                artists: artists
            };

        } catch (fallbackErr) {
            console.error("Last.fm search fallback also failed:", fallbackErr);
            throw err; // throw original Spotify error if fallback fails
        }
    }
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
        
        let imgUrl = artist.image;
        const isPlaceholder = !imgUrl || 
                              imgUrl.includes("default") || 
                              imgUrl.includes("noimage") || 
                              imgUrl.includes("placeholder") || 
                              imgUrl.includes("star") ||
                              imgUrl === "assets/default-art.png" ||
                              imgUrl === "";
                              
        if (isPlaceholder) {
            imgUrl = generateArtistAvatar(artist.name);
        }

        card.innerHTML = `
            <img src="${imgUrl}" alt="" />
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
    
    // Smart dynamic section ordering based on query intent
    let order = ["tracks", "albums", "artists"];
    const query = (searchInput?.value || "").trim().toLowerCase();
    if (query && data.artists && data.artists.length > 0) {
        const topArtistName = (data.artists[0].name || "").toLowerCase();
        // If the query matches the top artist name (e.g. "Daniel Caesar" contains "daniel" or vice versa)
        if (topArtistName.includes(query) || query.includes(topArtistName)) {
            console.log(`Detected artist search for "${data.artists[0].name}". Prioritizing Artist section.`);
            order = ["artists", "tracks", "albums"];
        }
    }

    // Let backend override if no custom artist prioritisation occurred
    if (data.section_order && order[0] !== "artists") {
        order = data.section_order;
    }

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

        if (searchProgressBar) searchProgressBar.classList.remove("hidden");

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
        } finally {
            if (searchProgressBar) searchProgressBar.classList.add("hidden");
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
        makeSongDraggable(tile, song);
        const selectionKey = getSongSelectionKey(song);
        tile.dataset.songKey = songKey(song);
        tile.dataset.selectionKey = selectionKey;
        tile.__song = song;
        applyDownloadedState(tile, song);
        tile.classList.toggle("selected", isSelectionKeySelected(selectionKey));

        const artDiv = document.createElement("div");
        artDiv.className = "tile-art";
        appendArt(artDiv, song, 300);
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
        tile.addEventListener("dblclick", (e) => {
            if (e.target.closest(".meta-link") || e.target.closest("button") || e.target.closest("a")) return;
            selectAndPlaySong(song, tile, songs);
        });

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
    updatePlayingIndicators();
}

async function renderAlbumGrid(albums, container) {
    container.innerHTML = "";
    for (const album of albums) {
        const tile = document.createElement("div");
        tile.className = "song-tile";

        const artDiv = document.createElement("div");
        artDiv.className = "tile-art";
        appendArt(artDiv, album, 300);

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
        makeSongDraggable(el, song);
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
        el.addEventListener("dblclick", (e) => {
            if (e.target.closest(".meta-link") || e.target.closest("button") || e.target.closest("a")) return;
            selectAndPlaySong(song, el, songs);
        });

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
    updatePlayingIndicators();
}

function highlightSelected(element) {
    document
        .querySelectorAll(".song-tile.selected, .song-item.selected")
        .forEach((el) => {
            el.classList.remove("selected");
        });
    if (element) element.classList.add("selected");
}

function updatePlayingIndicators() {
    document.querySelectorAll(".playing-equalizer").forEach(eq => eq.remove());
    if (!currentSong) return;
    const activeKey = songKey(currentSong);
    const targets = document.querySelectorAll(".song-item, .song-tile, #playlist-tracks-body tr");
    targets.forEach(el => {
        const song = el.__song;
        if (song && songKey(song) === activeKey) {
            el.classList.add("playing");
            el.classList.toggle("active-play", isPlaying);
            
            const titleEl = el.querySelector(".song-title, .tile-title, .playlist-track-title");
            if (titleEl) {
                const eq = document.createElement("div");
                eq.className = "playing-equalizer";
                for (let i = 0; i < 3; i++) {
                    const bar = document.createElement("div");
                    bar.className = "playing-equalizer-bar";
                    eq.appendChild(bar);
                }
                titleEl.insertBefore(eq, titleEl.firstChild);
            }
        } else {
            el.classList.remove("playing");
            el.classList.remove("active-play");
        }
    });
    const ssPlayBtn = document.getElementById("ss-btn-play");
    if (ssPlayBtn) {
        ssPlayBtn.textContent = isPlaying ? "❚❚" : "▶";
    }
}

async function selectSong(song, element) {
    const selectionKey = getSongSelectionKey(song);
    setSingleSongSelection(song, element, selectionKey);
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
    detailSidebarSong = song;
    updateDetailLikeButton();
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

function saveQueueState() {
    try {
        localStorage.setItem("spotdl_gui_queue", JSON.stringify(appQueue || []));
        localStorage.setItem("spotdl_gui_queue_index", queueIndex.toString());
    } catch (e) {
        console.warn("Could not save queue state:", e);
    }
}

function addToRecentlyPlayed(song) {
    if (!song?.title || !song?.artist) return;
    try {
        const raw = localStorage.getItem("spotdl_gui_recently_played") || "[]";
        let list = JSON.parse(raw);
        if (!Array.isArray(list)) list = [];
        
        list = list.filter(item => !(String(item.title).toLowerCase() === String(song.title).toLowerCase() && String(item.artist).toLowerCase() === String(song.artist).toLowerCase()));
        
        const payload = {
            title: song.title,
            artist: song.artist,
            album: song.album || null,
            image: song.image || null,
            spotify_url: song.spotify_url || null,
            duration: song.duration ?? song.duration_secs ?? null,
            play_count: song.play_count ?? 0,
        };
        list.unshift(payload);
        
        if (list.length > 20) {
            list = list.slice(0, 20);
        }
        
        localStorage.setItem("spotdl_gui_recently_played", JSON.stringify(list));
        window.dispatchEvent(new CustomEvent("recently-played-updated"));
    } catch (e) {
        console.warn("Could not save to recently played:", e);
    }
}

function getRecentlyPlayedSongs() {
    try {
        const raw = localStorage.getItem("spotdl_gui_recently_played") || "[]";
        const list = JSON.parse(raw);
        return Array.isArray(list) ? list : [];
    } catch (e) {
        console.warn("Could not load recently played:", e);
        return [];
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

        // Restore queue first
        try {
            const queueRaw = localStorage.getItem("spotdl_gui_queue");
            if (queueRaw) {
                appQueue = JSON.parse(queueRaw) || [];
            }
            const queueIndexRaw = localStorage.getItem("spotdl_gui_queue_index");
            if (queueIndexRaw) {
                queueIndex = parseInt(queueIndexRaw, 10);
            }
            renderQueueUI();
        } catch (e) {
            console.warn("Could not restore queue state:", e);
        }

        currentSong = song;
        await setNowPlaying(song);

        const playId = ++activePlayId;
        try {
            await attachSeekableAudioForSong(song, playId);
            if (playId !== activePlayId) return;
            audioPlayer.pause();
            isPlaying = false;
            btnPlay.textContent = "▶";

            // Restore progress
            const progressRaw = localStorage.getItem("spotdl_gui_last_played_progress");
            if (progressRaw) {
                const progressSec = parseFloat(progressRaw);
                if (progressSec > 0 && Number.isFinite(progressSec)) {
                    window.restoreProgressSec = progressSec;
                    audioPlayer.currentTime = progressSec;
                    timeCurrent.textContent = formatTime(progressSec);
                    if (song.duration) {
                        progressBar.value = (progressSec / song.duration) * 100;
                        timeTotal.textContent = formatTime(song.duration);
                    }
                }
            }

            saveLastPlayedSession(song);
        } catch (err) {
            console.warn("Could not restore cached audio:", err);
        }

        await showDetailSidebarPreview(song);
        fetchAndShowMetadata(song);
        updatePlayingIndicators();
        updateLikeButton();
    } catch (e) {
        console.warn("restoreLastPlayedSession:", e);
    }
}

async function fetchiTunesCoverArt(artist, title) {
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

function updateRecentlyPlayedImage(song, newImageUrl) {
    if (!song?.title || !song?.artist || !newImageUrl) return;
    try {
        const raw = localStorage.getItem("spotdl_gui_recently_played") || "[]";
        let list = JSON.parse(raw);
        if (!Array.isArray(list)) list = [];
        
        let updated = false;
        list = list.map(item => {
            if (String(item.title).toLowerCase() === String(song.title).toLowerCase() && 
                String(item.artist).toLowerCase() === String(song.artist).toLowerCase()) {
                item.image = newImageUrl;
                updated = true;
            }
            return item;
        });
        
        if (updated) {
            localStorage.setItem("spotdl_gui_recently_played", JSON.stringify(list));
            window.dispatchEvent(new CustomEvent("recently-played-updated"));
        }
    } catch (e) {
        console.warn("updateRecentlyPlayedImage failed:", e);
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

        detailTitle.textContent = meta.title;
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
        addToRecentlyPlayed(song);
        
        hasTrackedCurrentSongPlay = false; // Reset play tracking flag for the new song
        trackSongPlay(song); // Track play immediately for absolute real-time feedback!

        isPlaying = true;
        btnPlay.textContent = "❚❚";
        statusBar.textContent = `Playing: ${song.title}`;
        updateDiscordPresence(song, false);

        await showDetailSidebarPreview(song);
        fetchAndShowMetadata(song);
        updatePlayingIndicators();
        updateScreensaverUI();

        // Background prefetch autoplay similar song if we are at the end of the queue
        if (loopMode !== "one") {
            const isLastInQueue = appQueue.length === 0 || queueIndex === appQueue.length - 1;
            if (isLastInQueue) {
                prefetchAutoplayTrack(song).catch(e => console.error("Prefetch err:", e));
            }
        }

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
                    const input = document.getElementById("modal-playlist-name");
                    const name = input.value.trim();
                    if (!name) {
                        input.style.borderColor = "#ff4444";
                        input.placeholder = "Please enter a playlist name!";
                        input.animate([
                            { transform: 'translateX(0px)' },
                            { transform: 'translateX(-4px)' },
                            { transform: 'translateX(4px)' },
                            { transform: 'translateX(-4px)' },
                            { transform: 'translateX(4px)' },
                            { transform: 'translateX(0px)' }
                        ], { duration: 200 });
                        return false;
                    }
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
                true
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
        makePlaylistDroppable(li, pl.id);
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
            del.addEventListener("click", (e) => {
                e.stopPropagation();
                showModal(
                    "Delete Playlist",
                    `<p style="margin-bottom: 0.5rem; font-size: 1.05rem;">Are you sure you want to delete the playlist <strong>${escapeHtml(pl.name)}</strong>?</p>
                     <p style="color: var(--fg-muted); font-size: 0.92rem; line-height: 1.45; margin-bottom: 0;">This action cannot be undone and all tracks inside will be removed from this playlist.</p>`,
                    async () => {
                        await deletePlaylist(pl.id);
                        renderPlaylistSidebar();
                    },
                    "Delete",
                    true
                );
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

    const headerArtEl = document.getElementById("playlist-view-art");
    if (headerArtEl) {
        renderPlaylistArt(pl, headerArtEl, 80);
    }

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
        try {
            const raw = e.dataTransfer.getData("text/plain");
            if (!raw) return;
            const data = JSON.parse(raw);
            const from = Number(data.index);
            if (Number.isNaN(from)) return;
            const targetRow = e.target.closest("tr");
            if (!targetRow) {
                const to = sorted.length - 1;
                if (from !== to) {
                    await reorderPlaylistTracks(playlistId, from, to);
                    openPlaylistView(playlistId);
                }
            }
        } catch (err) {
            console.error("tbody drop failed:", err);
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
            e.dataTransfer.effectAllowed = "copyMove";
            const payload = {
                index: i,
                song: song
            };
            e.dataTransfer.setData("text/plain", JSON.stringify(payload));
            tr.classList.add("dragging");
        });
        tr.addEventListener("mousedown", (e) => {
            if (e.button !== 0) return;
            if (e.target.closest("button") || e.target.closest("a")) return;
            activeCustomDrag = {
                song: song,
                element: tr,
                ghostEl: null,
                dragStarted: false,
                startX: e.clientX,
                startY: e.clientY
            };
        });
        tr.addEventListener("dragend", () => {
            tr.classList.remove("dragging");
            clearActiveDragGhost();
        });
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
            try {
                const raw = e.dataTransfer.getData("text/plain");
                if (!raw) return;
                const data = JSON.parse(raw);
                const from = Number(data.index);
                const to = Number(tr.dataset.index);
                if (!Number.isNaN(from) && from !== to) {
                    await reorderPlaylistTracks(playlistId, from, to);
                    openPlaylistView(playlistId);
                }
            } catch (err) {
                console.error("tr drop failed:", err);
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
        tr.addEventListener("dblclick", (e) => {
            if (e.target.closest(".meta-link") || e.target.closest("button") || e.target.closest("a")) return;
            selectAndPlaySong(song, tr, playlistSongs);
        });

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
    updatePlayingIndicators();
}

// Modal helper system
// Modal helper system
function showModal(title, contentHtml, onConfirm, confirmText = "Confirm", showCancel = true, onCancel = null) {
    const overlay = document.getElementById("modal-overlay");
    const contentContainer = overlay.querySelector(".modal-content");
    const titleEl = document.getElementById("modal-title");
    const bodyEl = document.getElementById("modal-body");
    const cancelBtn = document.getElementById("modal-cancel-btn");
    const confirmBtn = document.getElementById("modal-confirm-btn");

    titleEl.textContent = title;
    bodyEl.innerHTML = contentHtml;
    confirmBtn.textContent = confirmText;
    cancelBtn.style.display = showCancel ? "" : "none";

    if (contentHtml.includes("theme-creator-modal")) {
        contentContainer.style.width = "480px";
        overlay.classList.add("no-blur");

        // Lock CSS variables on the overlay using the active computed styles!
        const computed = getComputedStyle(document.documentElement);
        const vars = ["--bg", "--accent", "--bg-panel", "--bg-card", "--bg-hover", "--border", "--fg", "--fg-muted"];
        vars.forEach(varName => {
            const val = computed.getPropertyValue(varName).trim();
            if (val) {
                overlay.style.setProperty(varName, val);
            }
        });

        // Make modal draggable by its title header!
        titleEl.style.cursor = "move";
        titleEl.style.userSelect = "none";

        let offsetX = 0, offsetY = 0, mouseX = 0, mouseY = 0;

        const dragMouseDown = (e) => {
            e = e || window.event;
            if (e.target.tagName === "BUTTON" || e.target.tagName === "INPUT") return;
            
            e.preventDefault();
            mouseX = e.clientX;
            mouseY = e.clientY;
            document.onmouseup = closeDragElement;
            document.onmousemove = elementDrag;
        };

        const elementDrag = (e) => {
            e = e || window.event;
            e.preventDefault();
            offsetX = mouseX - e.clientX;
            offsetY = mouseY - e.clientY;
            mouseX = e.clientX;
            mouseY = e.clientY;
            
            contentContainer.style.position = "absolute";
            contentContainer.style.top = (contentContainer.offsetTop - offsetY) + "px";
            contentContainer.style.left = (contentContainer.offsetLeft - offsetX) + "px";
            contentContainer.style.margin = "0";
        };

        const closeDragElement = () => {
            document.onmouseup = null;
            document.onmousemove = null;
        };

        titleEl.onmousedown = dragMouseDown;
    } else {
        contentContainer.style.width = "";
        overlay.classList.remove("no-blur");
    }

    const cleanup = (isCancel = false) => {
        overlay.classList.add("hidden");
        overlay.classList.remove("no-blur");
        
        // Remove locked CSS variables
        const vars = ["--bg", "--accent", "--bg-panel", "--bg-card", "--bg-hover", "--border", "--fg", "--fg-muted"];
        vars.forEach(varName => {
            overlay.style.removeProperty(varName);
        });

        cancelBtn.replaceWith(cancelBtn.cloneNode(true));
        confirmBtn.replaceWith(confirmBtn.cloneNode(true));
        contentContainer.style.width = "";
        contentContainer.style.position = "";
        contentContainer.style.top = "";
        contentContainer.style.left = "";
        contentContainer.style.margin = "";
        titleEl.style.cursor = "";
        titleEl.onmousedown = null;
        document.onmouseup = null;
        document.onmousemove = null;
        
        if (isCancel && typeof onCancel === "function") {
            onCancel();
        }
    };

    const handleConfirm = async () => {
        const result = await onConfirm();
        if (result !== false) cleanup(false);
    };

    const handleCancel = () => {
        cleanup(true);
    };

    document
        .getElementById("modal-cancel-btn")
        .addEventListener("click", handleCancel);

    document
        .getElementById("modal-confirm-btn")
        .addEventListener("click", handleConfirm);

    overlay.classList.remove("hidden");

    // Auto-focus any text input inside the modal body after scale entry animation begins
    setTimeout(() => {
        const input = bodyEl.querySelector("input[type='text']");
        if (input) {
            input.focus();
            // Bind Enter key to trigger confirm action
            input.addEventListener("keydown", (e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    handleConfirm();
                }
            });
        }
    }, 50);
}

// Download Management View
async function initDownloadsView() {
    await refreshDownloadedKeys();
    await updateCacheUsage();
    await updateDownloadsUsage();
    await renderDownloadsList();
}

function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

async function updateDownloadsUsage() {
    try {
        const info = await invoke("get_downloads_info");
        const totalSizeStr = formatBytes(info.total_size_bytes);
        const el = document.getElementById("downloads-usage-text");
        if (el) {
            el.textContent = `Total Size: ${totalSizeStr}`;
        }
    } catch (err) {
        console.error("Failed to update downloads usage:", err);
        const el = document.getElementById("downloads-usage-text");
        if (el) {
            el.textContent = `Total Size: Error (${err})`;
        }
    }
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
    .getElementById("btn-open-downloads-dir")
    ?.addEventListener("click", async () => {
        try {
            await invoke("open_downloads_directory");
        } catch (err) {
            statusBar.textContent = `Failed to open directory: ${err}`;
        }
    });

document
    .getElementById("btn-clear-cache")
    ?.addEventListener("click", () => {
        showModal(
            "Clear Cache",
            `<p style="margin-bottom: 0.5rem; font-size: 1.05rem; font-weight: 500;">Are you sure you want to empty the audio and art cache?</p>
             <p style="color: var(--fg-muted); font-size: 0.92rem; line-height: 1.45;">This may force redownloading track streams on repeated streaming.</p>`,
            async () => {
                try {
                    await invoke("clear_cache");
                    await updateCacheUsage();
                    statusBar.textContent = "Cache cleared!";
                } catch (err) {
                    statusBar.textContent = `Clear cache failed: ${err}`;
                }
            },
            "Empty Cache"
        );
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
                    await updateDownloadsUsage();
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
        const info = await invoke("get_downloads_info");
        
        // Re-construct index and build sizesMap
        const index = {};
        const sizesMap = {};
        for (const item of info.items) {
            index[item.key] = item.filename;
            sizesMap[item.key] = item.size_bytes;
        }
        _allDownloadsCache = index;

        // Also update total downloads usage text on render
        const totalSizeStr = formatBytes(info.total_size_bytes);
        const el = document.getElementById("downloads-usage-text");
        if (el) {
            el.textContent = `Total Size: ${totalSizeStr}`;
        }

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
            
            const sizeSpan = document.createElement("span");
            sizeSpan.className = "downloads-filesize";
            sizeSpan.style.display = "block";
            sizeSpan.style.fontSize = "11px";
            sizeSpan.style.color = "var(--fg-muted)";
            sizeSpan.style.marginTop = "2px";
            const sizeBytes = sizesMap[key] || 0;
            sizeSpan.textContent = formatBytes(sizeBytes);
            
            fileTd.appendChild(fileSpan);
            fileTd.appendChild(sizeSpan);

            const actTd = document.createElement("td");
            actTd.className = "col-actions";
            const delBtn = document.createElement("button");
            delBtn.type = "button";
            delBtn.className = "downloads-remove-btn";
            delBtn.textContent = "Remove";
            delBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                showModal(
                    "Delete Downloaded File",
                    `<p style="margin-bottom: 0.5rem; font-size: 1.05rem;">Are you sure you want to permanently delete the file <strong>${escapeHtml(filename)}</strong>?</p>
                     <p style="color: var(--fg-muted); font-size: 0.92rem; line-height: 1.45; margin-bottom: 0;">This will permanently remove the song's audio file from your local disk downloads folder.</p>`,
                    async () => {
                        try {
                            await invoke("delete_downloaded_song", { key });
                            downloadedKeys.delete(key);
                            await refreshDownloadedKeys();
                            await updateDownloadsUsage();
                            await renderDownloadsList(
                                document.getElementById("downloads-search").value,
                            );
                        } catch (err) {
                            showModal(
                                "Error Deleting File",
                                `<p>Failed to delete: ${escapeHtml(String(err))}</p>`,
                                () => {},
                                "Close",
                                false
                            );
                        }
                    },
                    "Delete",
                    true
                );
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
    renderPlaylistSidebar();
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

function loadUserProfile() {
    const name = localStorage.getItem("user_profile_name") || "Explorer";
    
    // Set UI elements
    const btnName = document.getElementById("profile-btn-name");
    const btnAvatar = document.getElementById("profile-btn-avatar");
    const inputName = document.getElementById("profile-name-input");
    const largeAvatar = document.getElementById("profile-avatar-large");
    
    if (btnName) btnName.textContent = name;
    if (btnAvatar) btnAvatar.textContent = name.charAt(0).toUpperCase();
    if (inputName) inputName.value = name;
    if (largeAvatar) largeAvatar.textContent = name.charAt(0).toUpperCase();
}

function saveUserProfileName(newName) {
    const trimmed = newName.trim();
    if (!trimmed) return;
    localStorage.setItem("user_profile_name", trimmed);
    loadUserProfile();
}

function setupProfilePage() {
    loadUserProfile();
    
    const inputName = document.getElementById("profile-name-input");
    const editBtn = document.getElementById("profile-edit-name-btn");
    
    if (inputName) {
        inputName.addEventListener("blur", () => {
            saveUserProfileName(inputName.value);
            inputName.style.borderBottomColor = "transparent";
        });
        inputName.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                inputName.blur();
            }
        });
        inputName.addEventListener("focus", () => {
            inputName.style.borderBottomColor = "var(--accent)";
        });
    }
    
    if (editBtn && inputName) {
        editBtn.addEventListener("click", () => {
            inputName.focus();
        });
    }

    // Set up range tab click listeners
    document.querySelectorAll(".profile-range-tab").forEach(tab => {
        tab.addEventListener("click", () => {
            document.querySelectorAll(".profile-range-tab").forEach(t => t.classList.remove("active"));
            tab.classList.add("active");
            const range = tab.getAttribute("data-range");
            renderProfileStats(range);
        });
    });
}

function renderProfilePage() {
    loadUserProfile();
    renderProfileStats("all");
    
    // Reset active tab to "all"
    document.querySelectorAll(".profile-range-tab").forEach(tab => {
        if (tab.getAttribute("data-range") === "all") {
            tab.classList.add("active");
        } else {
            tab.classList.remove("active");
        }
    });
}

async function renderProfileStats(range = "all") {
    // 1. Fetch play history
    const historyMap = await invoke("get_history").catch(() => ({}));
    const historyList = Object.values(historyMap);
    
    // 2. Determine time threshold in seconds
    const now = Math.floor(Date.now() / 1000);
    let threshold = 0;
    if (range === "today") {
        threshold = now - 24 * 3600;
    } else if (range === "week") {
        threshold = now - 7 * 24 * 3600;
    } else if (range === "month") {
        threshold = now - 30 * 24 * 3600;
    } else if (range === "year") {
        threshold = now - 365 * 24 * 3600;
    }
    
    // 3. Count plays per Track, Artist, Album within threshold
    const trackCounts = [];
    const artistCounts = {};
    const albumCounts = {};
    let totalPlays = 0;
    
    historyList.forEach(item => {
        // Filter play timestamps within threshold
        const validTimestamps = (item.play_timestamps || []).filter(t => t >= threshold);
        const playCount = validTimestamps.length;
        
        if (playCount > 0) {
            totalPlays += playCount;
            // Track play
            trackCounts.push({
                title: item.title,
                artist: item.artist,
                album: item.album || "Unknown Album",
                image: item.image,
                plays: playCount,
                duration: item.duration_secs
            });
            
            // Artist play count accumulator
            const artistKey = String(item.artist || "").trim();
            if (artistKey) {
                artistCounts[artistKey] = (artistCounts[artistKey] || 0) + playCount;
            }
            
            // Album play count accumulator
            const albumName = String(item.album || "").trim();
            if (albumName) {
                const albumKey = `${albumName}|${artistKey}`;
                if (!albumCounts[albumKey]) {
                    albumCounts[albumKey] = {
                        name: albumName,
                        artist: artistKey,
                        image: item.image,
                        plays: 0
                    };
                }
                albumCounts[albumKey].plays += playCount;
            }
        }
    });
    
    // Sort and limit collections
    const topTracks = trackCounts
        .sort((a, b) => b.plays - a.plays)
        .slice(0, 10);
        
    const topArtists = Object.entries(artistCounts)
        .map(([name, plays]) => ({ name, plays }))
        .sort((a, b) => b.plays - a.plays)
        .slice(0, 5);
        
    const topAlbums = Object.values(albumCounts)
        .sort((a, b) => b.plays - a.plays)
        .slice(0, 5);
        
    // 4. Update Overview Dashboard Widgets
    const statPlays = document.getElementById("stat-total-plays");
    const statArtists = document.getElementById("stat-unique-artists");
    const statAlbums = document.getElementById("stat-unique-albums");
    
    if (statPlays) statPlays.textContent = totalPlays.toLocaleString();
    if (statArtists) statArtists.textContent = Object.keys(artistCounts).length.toLocaleString();
    if (statAlbums) statAlbums.textContent = Object.keys(albumCounts).length.toLocaleString();
    
    // 5. Render lists or clean empty placeholders
    renderTopTracksList(topTracks);
    renderTopArtistsList(topArtists);
    renderTopAlbumsList(topAlbums);
}

function renderTopTracksList(tracks) {
    const listEl = document.getElementById("profile-top-tracks-list");
    if (!listEl) return;
    listEl.innerHTML = "";
    
    if (tracks.length === 0) {
        for (let i = 0; i < 5; i++) {
            const slot = document.createElement("div");
            slot.className = "profile-empty-slot";
            slot.textContent = `[ track slot ${i + 1} ]`;
            listEl.appendChild(slot);
        }
        return;
    }
    
    tracks.forEach((t, i) => {
        const item = document.createElement("div");
        item.style.display = "flex";
        item.style.alignItems = "center";
        item.style.gap = "12px";
        item.style.padding = "8px 12px";
        item.style.borderRadius = "6px";
        item.style.background = "rgba(255,255,255,0.02)";
        item.style.border = "1px solid var(--border)";
        item.style.transition = "all 0.2s ease";
        
        // Track number badge
        const badge = document.createElement("div");
        badge.style.width = "22px";
        badge.style.textAlign = "center";
        badge.style.fontSize = "0.85rem";
        badge.style.fontWeight = "bold";
        badge.style.fontFamily = "monospace";
        badge.style.color = i === 0 ? "var(--accent)" : "var(--fg-muted)";
        badge.textContent = String(i + 1).padStart(2, "0");
        
        // Cover Art image
        const imgWrap = document.createElement("div");
        imgWrap.style.width = "36px";
        imgWrap.style.height = "36px";
        imgWrap.style.borderRadius = "4px";
        imgWrap.style.overflow = "hidden";
        imgWrap.style.background = "var(--bg-hover)";
        imgWrap.style.flexShrink = "0";
        imgWrap.style.display = "flex";
        imgWrap.style.alignItems = "center";
        imgWrap.style.justifyContent = "center";
        
        if (t.image) {
            const img = document.createElement("img");
            img.src = t.image;
            img.style.width = "100%";
            img.style.height = "100%";
            img.style.objectFit = "cover";
            imgWrap.appendChild(img);
        } else {
            imgWrap.innerHTML = `<span style="font-family: monospace; font-size: 10px; color: var(--fg-muted);">..</span>`;
        }
        
        // Meta info
        const meta = document.createElement("div");
        meta.style.flex = "1";
        meta.style.minWidth = "0";
        meta.style.display = "flex";
        meta.style.flexDirection = "column";
        
        const titleSpan = document.createElement("span");
        titleSpan.style.fontWeight = "600";
        titleSpan.style.color = "var(--fg-main)";
        titleSpan.style.fontSize = "0.85rem";
        titleSpan.style.whiteSpace = "nowrap";
        titleSpan.style.overflow = "hidden";
        titleSpan.style.textOverflow = "ellipsis";
        titleSpan.style.fontFamily = "monospace";
        titleSpan.textContent = t.title;
        
        const artistSpan = document.createElement("span");
        artistSpan.style.fontSize = "0.75rem";
        artistSpan.style.color = "var(--fg-muted)";
        artistSpan.style.whiteSpace = "nowrap";
        artistSpan.style.overflow = "hidden";
        artistSpan.style.textOverflow = "ellipsis";
        artistSpan.style.fontFamily = "monospace";
        artistSpan.textContent = `${t.artist} - ${t.album}`;
        
        meta.appendChild(titleSpan);
        meta.appendChild(artistSpan);
        
        // Play Count badge
        const playsBadge = document.createElement("div");
        playsBadge.style.fontFamily = "monospace";
        playsBadge.style.fontSize = "0.75rem";
        playsBadge.style.color = "var(--accent)";
        playsBadge.style.background = "rgba(255,255,255,0.03)";
        playsBadge.style.border = "1px solid var(--border)";
        playsBadge.style.padding = "3px 8px";
        playsBadge.style.borderRadius = "4px";
        playsBadge.style.fontWeight = "bold";
        playsBadge.textContent = `${t.plays} plays`;
        
        item.appendChild(badge);
        item.appendChild(imgWrap);
        item.appendChild(meta);
        item.appendChild(playsBadge);
        
        listEl.appendChild(item);
    });
}

function renderTopArtistsList(artists) {
    const listEl = document.getElementById("profile-top-artists-list");
    if (!listEl) return;
    listEl.innerHTML = "";
    
    if (artists.length === 0) {
        for (let i = 0; i < 3; i++) {
            const slot = document.createElement("div");
            slot.className = "profile-empty-slot";
            slot.textContent = `[ artist slot ${i + 1} ]`;
            listEl.appendChild(slot);
        }
        return;
    }
    
    artists.forEach((art, i) => {
        const item = document.createElement("div");
        item.style.display = "flex";
        item.style.alignItems = "center";
        item.style.justifyContent = "space-between";
        item.style.padding = "6px 8px";
        item.style.borderBottom = "1px solid var(--border)";
        
        const nameSpan = document.createElement("span");
        nameSpan.style.fontFamily = "monospace";
        nameSpan.style.fontSize = "0.8rem";
        nameSpan.style.fontWeight = "bold";
        nameSpan.style.color = "var(--fg-main)";
        nameSpan.textContent = `${String(i + 1).padStart(2, "0")}. ${art.name}`;
        
        const playsSpan = document.createElement("span");
        playsSpan.style.fontFamily = "monospace";
        playsSpan.style.fontSize = "0.75rem";
        playsSpan.style.color = "var(--fg-muted)";
        playsSpan.textContent = `${art.plays} plays`;
        
        item.appendChild(nameSpan);
        item.appendChild(playsSpan);
        listEl.appendChild(item);
    });
}

function renderTopAlbumsList(albums) {
    const listEl = document.getElementById("profile-top-albums-list");
    if (!listEl) return;
    listEl.innerHTML = "";
    
    if (albums.length === 0) {
        for (let i = 0; i < 3; i++) {
            const slot = document.createElement("div");
            slot.className = "profile-empty-slot";
            slot.textContent = `[ album slot ${i + 1} ]`;
            listEl.appendChild(slot);
        }
        return;
    }
    
    albums.forEach((alb, i) => {
        const item = document.createElement("div");
        item.style.display = "flex";
        item.style.alignItems = "center";
        item.style.gap = "10px";
        item.style.padding = "6px 8px";
        item.style.borderBottom = "1px solid var(--border)";
        
        const imgWrap = document.createElement("div");
        imgWrap.style.width = "28px";
        imgWrap.style.height = "28px";
        imgWrap.style.borderRadius = "3px";
        imgWrap.style.overflow = "hidden";
        imgWrap.style.flexShrink = "0";
        imgWrap.style.background = "var(--bg-hover)";
        imgWrap.style.display = "flex";
        imgWrap.style.alignItems = "center";
        imgWrap.style.justifyContent = "center";
        
        if (alb.image) {
            const img = document.createElement("img");
            img.src = alb.image;
            img.style.width = "100%";
            img.style.height = "100%";
            img.style.objectFit = "cover";
            imgWrap.appendChild(img);
        } else {
            imgWrap.innerHTML = `<span style="font-family: monospace; font-size: 8px; color: var(--fg-muted);">..</span>`;
        }
        
        const meta = document.createElement("div");
        meta.style.flex = "1";
        meta.style.minWidth = "0";
        meta.style.display = "flex";
        meta.style.flexDirection = "column";
        
        const nameSpan = document.createElement("span");
        nameSpan.style.fontFamily = "monospace";
        nameSpan.style.fontSize = "0.8rem";
        nameSpan.style.fontWeight = "bold";
        nameSpan.style.color = "var(--fg-main)";
        nameSpan.style.whiteSpace = "nowrap";
        nameSpan.style.overflow = "hidden";
        nameSpan.style.textOverflow = "ellipsis";
        nameSpan.textContent = `${String(i + 1).padStart(2, "0")}. ${alb.name}`;
        
        const artistSpan = document.createElement("span");
        artistSpan.style.fontSize = "0.7rem";
        artistSpan.style.color = "var(--fg-muted)";
        artistSpan.style.whiteSpace = "nowrap";
        artistSpan.style.overflow = "hidden";
        artistSpan.style.textOverflow = "ellipsis";
        artistSpan.style.fontFamily = "monospace";
        artistSpan.textContent = alb.artist;
        
        meta.appendChild(nameSpan);
        meta.appendChild(artistSpan);
        
        const playsSpan = document.createElement("span");
        playsSpan.style.fontFamily = "monospace";
        playsSpan.style.fontSize = "0.75rem";
        playsSpan.style.color = "var(--fg-muted)";
        playsSpan.style.flexShrink = "0";
        playsSpan.textContent = `${alb.plays} plays`;
        
        item.appendChild(imgWrap);
        item.appendChild(meta);
        item.appendChild(playsSpan);
        listEl.appendChild(item);
    });
}

/* Now Playing Immersive Screensaver System */
let screensaverInterval = null;
let screensaverCursorTimeout = null;

function resetScreensaverCursorTimer() {
    const ssOverlay = document.getElementById("fullscreen-screensaver");
    if (!ssOverlay) return;
    ssOverlay.classList.remove("cursor-hidden");
    clearTimeout(screensaverCursorTimeout);
    if (!ssOverlay.classList.contains("hidden")) {
        screensaverCursorTimeout = setTimeout(() => {
            ssOverlay.classList.add("cursor-hidden");
        }, 3000);
    }
}

function startScreensaverClock() {
    updateScreensaverClock();
    if (!screensaverInterval) {
        screensaverInterval = setInterval(updateScreensaverClock, 1000);
    }
}

function updateScreensaverClock() {
    const clockEl = document.getElementById("screensaver-clock");
    const dateEl = document.getElementById("screensaver-date");
    if (!clockEl) return;
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    clockEl.textContent = `${h}:${m}:${s}`;
    
    if (dateEl) {
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        const yy = String(now.getFullYear()).slice(-2);
        dateEl.textContent = `${mm}/${dd}/${yy}`;
    }
}

function stopScreensaverClock() {
    if (screensaverInterval) {
        clearInterval(screensaverInterval);
        screensaverInterval = null;
    }
}

async function updateScreensaverUI() {
    const ssOverlay = document.getElementById("fullscreen-screensaver");
    if (!ssOverlay || ssOverlay.classList.contains("hidden")) return;
    
    const titleEl = document.getElementById("screensaver-title");
    const artistEl = document.getElementById("screensaver-artist");
    const artImg = document.getElementById("screensaver-art");
    const bgEl = document.getElementById("screensaver-bg");
    const wrap = document.getElementById("screensaver-art-wrap");
    
    // Clean old fallback canvases
    if (wrap) {
        wrap.querySelectorAll("canvas").forEach(c => c.remove());
    }
    
    if (!currentSong) {
        titleEl.textContent = "No Track Playing";
        artistEl.textContent = "";
        artImg.style.opacity = "0";
        bgEl.style.backgroundImage = "none";
        return;
    }
    
    // Sync volume bar state on update
    const ssVolBar = document.getElementById("ss-volume-bar");
    if (ssVolBar) {
        ssVolBar.value = volumeBar.value;
    }
    updateShuffleButton();
    updateLoopButton();

    titleEl.textContent = currentSong.title;
    artistEl.textContent = currentSong.artist;
    
    // Auto dynamic font scaling for extremely long titles
    const maxTitleLen = 18;
    if (currentSong.title.length > maxTitleLen) {
        const dynamicTitleSize = Math.max(1.8, 3.2 - (currentSong.title.length - maxTitleLen) * 0.045);
        titleEl.style.fontSize = `${dynamicTitleSize}rem`;
    } else {
        titleEl.style.fontSize = "3.2rem";
    }

    // Auto dynamic font scaling for extremely long artist names
    const maxArtistLen = 22;
    if (currentSong.artist.length > maxArtistLen) {
        const dynamicArtistSize = Math.max(1.2, 1.8 - (currentSong.artist.length - maxArtistLen) * 0.025);
        artistEl.style.fontSize = `${dynamicArtistSize}rem`;
    } else {
        artistEl.style.fontSize = "1.8rem";
    }
    
    let artUrl = "";
    if (isValidImage(currentSong.image)) {
        const cached = await resolveArtUrl(currentSong.image);
        if (cached) {
            artUrl = cached;
        }
    }
    
    if (artUrl) {
        artImg.src = artUrl;
        artImg.style.opacity = "1";
        bgEl.style.backgroundImage = `url('${artUrl}')`;
    } else {
        const fallback = generateThumbnail(currentSong.title, currentSong.artist, 420);
        artImg.src = "";
        artImg.style.opacity = "0";
        bgEl.style.backgroundImage = "none";
        if (wrap) {
            wrap.appendChild(fallback);
        }
    }
}

function toggleFullscreenScreensaver() {
    const ssOverlay = document.getElementById("fullscreen-screensaver");
    if (!ssOverlay) return;
    
    if (ssOverlay.classList.contains("hidden")) {
        ssOverlay.classList.remove("hidden");
        startScreensaverClock();
        updateScreensaverUI();
        resetScreensaverCursorTimer();
        
        if (document.documentElement.requestFullscreen) {
            document.documentElement.requestFullscreen().catch(e => {
                console.warn("Fullscreen request rejected:", e);
            });
        }
    } else {
        closeFullscreenScreensaver();
    }
}

function closeFullscreenScreensaver() {
    const ssOverlay = document.getElementById("fullscreen-screensaver");
    if (!ssOverlay) return;
    
    ssOverlay.classList.add("hidden");
    stopScreensaverClock();
    clearTimeout(screensaverCursorTimeout);
    ssOverlay.classList.remove("cursor-hidden");
    
    const wrap = document.getElementById("screensaver-art-wrap");
    if (wrap) {
        wrap.querySelectorAll("canvas").forEach(c => c.remove());
    }
    
    if (document.fullscreenElement) {
        document.exitFullscreen().catch(e => {
            console.warn("Exit fullscreen rejected:", e);
        });
    }
}

function initScreensaverEvents() {
    const btnSS = document.getElementById("btn-fullscreen-saver");
    if (btnSS) {
        btnSS.addEventListener("click", toggleFullscreenScreensaver);
    }
    
    const ssOverlay = document.getElementById("fullscreen-screensaver");
    if (ssOverlay) {
        ssOverlay.addEventListener("click", closeFullscreenScreensaver);
        ssOverlay.addEventListener("mousemove", resetScreensaverCursorTimer);
    }
    
    const ssControls = document.querySelector(".screensaver-controls");
    if (ssControls) {
        ssControls.addEventListener("click", (e) => {
            e.stopPropagation(); // Stops overlay dismissal when clicking control deck
        });
    }
    
    const ssShuffle = document.getElementById("ss-btn-shuffle");
    if (ssShuffle) {
        ssShuffle.addEventListener("click", (e) => {
            e.stopPropagation();
            const btnShuffle = document.getElementById("btn-shuffle");
            if (btnShuffle) btnShuffle.click();
        });
    }

    const ssBtnPrev = document.getElementById("ss-btn-prev");
    if (ssBtnPrev) {
        ssBtnPrev.addEventListener("click", (e) => {
            e.stopPropagation();
            playPreviousTrack();
        });
    }
    
    const ssBtnPlay = document.getElementById("ss-btn-play");
    if (ssBtnPlay) {
        ssBtnPlay.addEventListener("click", (e) => {
            e.stopPropagation();
            const btnPlay = document.getElementById("btn-play");
            if (btnPlay) btnPlay.click();
        });
    }
    
    const ssBtnNext = document.getElementById("ss-btn-next");
    if (ssBtnNext) {
        ssBtnNext.addEventListener("click", (e) => {
            e.stopPropagation();
            playNextTrack();
        });
    }

    const ssLoop = document.getElementById("ss-btn-loop");
    if (ssLoop) {
        ssLoop.addEventListener("click", (e) => {
            e.stopPropagation();
            const btnLoop = document.getElementById("btn-loop");
            if (btnLoop) btnLoop.click();
        });
    }

    const ssVolBar = document.getElementById("ss-volume-bar");
    if (ssVolBar) {
        ssVolBar.addEventListener("input", (e) => {
            const val = Number(e.target.value);
            audioPlayer.volume = val / 100;
            volumeBar.value = val; // Synchronize with the main volume bar
        });
        ssVolBar.addEventListener("click", (e) => {
            e.stopPropagation(); // Avoid exit click trigger
        });
    }
    
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            const ss = document.getElementById("fullscreen-screensaver");
            if (ss && !ss.classList.contains("hidden")) {
                closeFullscreenScreensaver();
            }
        }
    });
    
    document.addEventListener("fullscreenchange", () => {
        if (!document.fullscreenElement) {
            const ss = document.getElementById("fullscreen-screensaver");
            if (ss && !ss.classList.contains("hidden")) {
                closeFullscreenScreensaver();
            }
        }
    });
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initScreensaverEvents);
} else {
    initScreensaverEvents();
}

