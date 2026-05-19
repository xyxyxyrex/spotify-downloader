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
} from "./playlists.js";

const { invoke } = window.__TAURI__.core;

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
let metadataRequestId = 0;
let downloadedKeys = new Set();
let isBuffering = false;

// Queue System variables
let appQueue = [];
let queueIndex = -1;

// Global flag to prevent buffer racing
let activePlayId = 0;

const views = {
    home: document.getElementById("view-home"),
    search: document.getElementById("view-search"),
    settings: document.getElementById("view-settings"),
    downloads: document.getElementById("view-downloads"),
    playlist: document.getElementById("view-playlist"),
    queue: document.getElementById("view-queue"),
};

const navs = {
    home: document.getElementById("nav-home"),
    search: document.getElementById("nav-search"),
    settings: document.getElementById("nav-settings"),
    downloads: document.getElementById("nav-downloads"),
    queue: document.getElementById("nav-queue"),
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
const detailArtGallery = document.getElementById("detail-art-gallery");
const detailArtThumbs = document.getElementById("detail-art-thumbs");

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
const progressBar = document.getElementById("progress-bar");
const timeCurrent = document.getElementById("time-current");
const timeTotal = document.getElementById("time-total");
const npArt = document.getElementById("np-art");
const npDownloadedBadge = document.getElementById("np-downloaded-badge");
const volumeBar = document.getElementById("volume-bar");
const bufferProgressWrap = document.getElementById("buffer-progress-wrap");
const statusBar = document.getElementById("status-bar");

let selectedSong = null;
let currentCollection = null;

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
    const country = (geoCountry && String(geoCountry).trim()) || "United States";
    const countryEnc = encodeURIComponent(country);
    return [
        {
            id: "top-100-global",
            row: "charts",
            title: "Top 100",
            subtitle: "Global · 100 tracks",
            type: "tracks",
            load: () => fetchChartTracks("chart.gettoptracks", "&limit=100"),
            preview: () => fetchChartTracks("chart.gettoptracks", "&limit=1"),
        },
        {
            id: "top-100-local",
            row: "charts",
            title: "Top 100",
            subtitle: `${country} · 100 tracks`,
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
            row: "tracks",
            title: "Top Tracks",
            subtitle: "Global · 50 tracks",
            type: "tracks",
            load: () => fetchChartTracks("chart.gettoptracks", "&limit=50"),
            preview: () => fetchChartTracks("chart.gettoptracks", "&limit=1"),
        },
        {
            id: "top-tracks-local",
            row: "tracks",
            title: "Top Tracks",
            subtitle: `${country} · 50 tracks`,
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
            id: "top-albums-global",
            row: "albums",
            title: "Top Albums",
            subtitle: "Global Pop · 50 albums",
            type: "albums",
            load: () =>
                fetchChartAlbums("tag.gettopalbums", "&tag=pop&limit=50"),
            preview: () =>
                fetchChartAlbums("tag.gettopalbums", "&tag=pop&limit=1"),
        },
        {
            id: "top-albums-alt",
            row: "albums",
            title: "Top Albums",
            subtitle: "Hip-Hop · 50 albums",
            type: "albums",
            load: () =>
                fetchChartAlbums("tag.gettopalbums", "&tag=hip-hop&limit=50"),
            preview: () =>
                fetchChartAlbums("tag.gettopalbums", "&tag=hip-hop&limit=1"),
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
        item.style.display = "flex";
        item.style.alignItems = "center";
        item.style.justifyContent = "space-between";
        item.style.padding = "10px";
        item.style.background = idx === queueIndex ? "var(--accent-hover)" : "#222";
        item.style.borderRadius = "6px";
        item.style.cursor = "pointer";
        item.draggable = true;

        const info = document.createElement("div");
        info.innerHTML = `<strong style="color: ${idx === queueIndex ? 'var(--primary-color)' : '#fff'}">${escapeHtml(song.title)}</strong><br><span style="font-size: 12px; color: #888;">${escapeHtml(song.artist)}</span>`;
        
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
        item.ondragstart = (e) => { e.dataTransfer.setData("text/plain", idx); item.style.opacity = "0.5"; };
        item.ondragend = () => { item.style.opacity = "1"; };
        item.ondragover = (e) => e.preventDefault();
        item.ondrop = (e) => {
            e.preventDefault();
            const fromIdx = parseInt(e.dataTransfer.getData("text/plain"));
            if (fromIdx !== idx) {
                const moved = appQueue.splice(fromIdx, 1)[0];
                appQueue.splice(idx, 0, moved);
                // Adjust active index
                if (queueIndex === fromIdx) queueIndex = idx;
                else if (queueIndex > fromIdx && queueIndex <= idx) queueIndex--;
                else if (queueIndex < fromIdx && queueIndex >= idx) queueIndex++;
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

function playNextInQueue() {
    if (queueIndex + 1 < appQueue.length) {
        queueIndex++;
        renderQueueUI();
        playSong(appQueue[queueIndex]);
    }
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

function applyDownloadedState(element, song) {
    if (!element) return;
    element.classList.toggle("downloaded", isSongDownloaded(song));
}

async function updateNowPlayingDownloadBadge(song) {
    if (!song) {
        npDownloadedBadge.classList.add("hidden");
        return;
    }
    try {
        const downloaded = await invoke("is_track_downloaded", {
            artist: song.artist,
            title: song.title,
        });
        npDownloadedBadge.classList.toggle("hidden", !downloaded);
        if (downloaded) {
            const key = `${song.artist.trim().toLowerCase()}|${song.title.trim().toLowerCase()}`;
            downloadedKeys.add(key);
        }
    } catch {
        npDownloadedBadge.classList.toggle("hidden", !isSongDownloaded(song));
    }
}

window.addEventListener("DOMContentLoaded", async () => {
    setupTitleBar();
    setupNavigation();
    setupSearch();
    setupContextMenu();
    setupSettings();
    setupDetailSidebar();
    setupHome();
    setupPlayer();
    setupCollectionViewToggle();
    setupPlaylists();

    document.getElementById("btn-clear-queue").addEventListener("click", () => {
        appQueue = [];
        queueIndex = -1;
        renderQueueUI();
    });

    await loadSettingsUI();
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
        if (audioPlayer.duration) {
            progressBar.value =
                (audioPlayer.currentTime / audioPlayer.duration) * 100;
            timeCurrent.textContent = formatTime(audioPlayer.currentTime);
        }
    });

    audioPlayer.addEventListener("loadedmetadata", () => {
        timeTotal.textContent = formatTime(audioPlayer.duration);
    });

    audioPlayer.addEventListener("ended", () => {
        btnPlay.textContent = "▶";
        isPlaying = false;
        playNextInQueue();
    });

    progressBar.addEventListener("input", (e) => {
        if (audioPlayer.duration) {
            audioPlayer.currentTime =
                (e.target.value / 100) * audioPlayer.duration;
        }
    });

    btnPlay.addEventListener("click", () => {
        if (!audioPlayer.src) return;
        if (isPlaying) {
            audioPlayer.pause();
            btnPlay.textContent = "▶";
        } else {
            audioPlayer.play();
            btnPlay.textContent = "❚❚";
        }
        isPlaying = !isPlaying;
    });
}

function setupNavigation() {
    const switchView = (viewName) => {
        Object.values(views).forEach((v) => v.classList.add("hidden"));
        Object.values(navs).forEach((n) => n.classList.remove("active"));
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

    navs.home.addEventListener("click", (e) => {
        e.preventDefault();
        switchView("home");
    });
    navs.search.addEventListener("click", (e) => {
        e.preventDefault();
        switchView("search");
        searchInput.focus();
    });
    navs.settings.addEventListener("click", async (e) => {
        e.preventDefault();
        switchView("settings");
        await refreshApiStatus();
    });
    navs.downloads.addEventListener("click", (e) => {
        e.preventDefault();
        switchView("downloads");
        initDownloadsView();
    });
    navs.queue.addEventListener("click", (e) => {
        e.preventDefault();
        switchView("queue");
        renderQueueUI();
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
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
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
                ctx.fillRect(x, vizCanvas.height - barHeight, barWidth, barHeight);
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

async function renderHomeBrowse() {
    const rows = {
        charts: document.getElementById("home-row-charts"),
        tracks: document.getElementById("home-row-tracks"),
        albums: document.getElementById("home-row-albums"),
    };
    Object.values(rows).forEach((r) => {
        r.innerHTML = "";
    });

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
            const item = items[0];
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
        .catch(() => {});

    return card;
}

async function openCollection(collection) {
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
            await renderAlbumGrid(items, homeCollectionGrid);
        } else {
            currentCollectionSongs = items;
            await renderCollectionContent(items);
            prefetchArtForSongs(items);
            enrichSongsArt(items, homeCollectionGrid);
        }
        statusBar.textContent = `Loaded: ${collection.title}`;
    } catch (err) {
        homeCollectionGrid.innerHTML = `<span class="loading-text">Failed: ${err}</span>`;
    }
}

async function fetchChartTracks(method, extraParams) {
    const raw = await invoke("fetch_lastfm", { method, extraParams });
    const data = JSON.parse(raw);
    if (data.error) throw new Error(data.message || "API Error");
    const tracks = data.tracks?.track;
    const list = Array.isArray(tracks) ? tracks : [tracks];
    return list.map((t) => ({
        title: t.name,
        artist: t.artist?.name || t.artist,
        album: t.album?.["#text"] || t.album?.title || null,
        image: extractImageFromLastFmTrack(t),
        images: parseImagesFromLastFm(t.image),
    }));
}

async function fetchChartAlbums(method, extraParams) {
    const raw = await invoke("fetch_lastfm", { method, extraParams });
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
                const meta = await invoke("fetch_track_metadata", {
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

async function refreshApiStatus() {
    try {
        apiStatus = await invoke("get_api_status");
        if (!apiStatusHint) return;
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
    } catch (err) {
        console.error("Failed to read API status:", err);
    }
}

async function loadSettingsUI() {
    try {
        const [settings, cachePath, downloadPath] = await Promise.all([
            invoke("get_settings"),
            invoke("get_cache_path"),
            invoke("get_download_path"),
        ]);
        cacheDirInput.value = settings.cache_dir || "";
        downloadDirInput.value = settings.download_dir || "";
        spotifyIdInput.value = settings.spotify_client_id || "";
        spotifySecretInput.value = settings.spotify_client_secret || "";
        if (lastfmApiKeyInput) {
            lastfmApiKeyInput.value = settings.lastfm_api_key || "";
        }
        cacheDirInput.placeholder = cachePath;
        downloadDirInput.placeholder = downloadPath;
    } catch (err) {
        console.error("Failed to load settings:", err);
    }
}

function setupSettings() {
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
                await invoke("set_settings", {
                    cacheDir: cacheDirInput.value.trim() || null,
                    downloadDir: downloadDirInput.value.trim() || null,
                    spotifyClientId: spotifyIdInput.value.trim() || null,
                    spotifyClientSecret:
                        spotifySecretInput.value.trim() || null,
                    lastfmApiKey: lastfmApiKeyInput?.value.trim() || null,
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
                    cacheDir: "",
                    downloadDir: "",
                    spotifyClientId: "",
                    spotifyClientSecret: "",
                    lastfmApiKey: "",
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
        image: t.image || null,
        duration: t.duration,
        spotify_url: t.spotify_url,
        popularity: t.popularity,
    };
}

async function runSpotifySearch(query) {
    const raw = await invoke("spotify_search", { query });
    return JSON.parse(raw);
}

function hasSpotifyResults(data) {
    if (!data || data.error) return false;
    if (data.tracks?.length) return true;
    if (data.artists?.length) return true;
    if (data.type === "playlist" || data.type === "album" || data.type === "artist")
        return true;
    return false;
}

async function searchLastFmTracks(query) {
    const raw = await invoke("fetch_lastfm", {
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

function renderSpotifySearchResults(
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
        const header = document.createElement("div");
        header.className = "search-section";
        header.innerHTML = `<h3>> ${escapeHtml(titlePrefix)}Album: ${escapeHtml(data.name)}</h3>`;
        target.appendChild(header);
        const songs = (data.tracks || []).map(mapSpotifyTrack);
        const grid = document.createElement("div");
        grid.className = "song-grid";
        target.appendChild(grid);
        renderSongGrid(songs, grid);
        enrichSongsArt(songs, grid);
        return;
    }

    if (data.type === "artist") {
        const header = document.createElement("div");
        header.className = "search-section";
        header.innerHTML = `
            <h3>> Artist: ${escapeHtml(data.name)}</h3>
            <p class="collection-subtitle">${(data.genres || []).slice(0, 3).join(", ")}</p>
        `;
        target.appendChild(header);

        if (data.tracks && data.tracks.length > 0) {
            const h = document.createElement("div");
            h.className = "search-section";
            h.innerHTML = `<h4 style="margin: 15px 0 10px; color: #fff;">Top Tracks</h4>`;
            target.appendChild(h);
            const list = document.createElement("div");
            list.className = "song-list";
            target.appendChild(list);
            const songList = data.tracks.map(mapSpotifyTrack);
            renderSongList(songList, list);
        }

        if (data.albums && data.albums.length > 0) {
            const h2 = document.createElement("div");
            h2.className = "search-section";
            h2.innerHTML = `<h4 style="margin: 20px 0 10px; border-bottom: 1px solid #333; padding-bottom: 5px; color: #fff;">Albums & Singles</h4>`;
            target.appendChild(h2);
            data.albums.forEach(album => {
                const g = document.createElement("div");
                g.className = "search-section";
                g.innerHTML = `<h5 style="margin: 15px 0 10px; color:#aaa; font-weight: normal;">💿 ${escapeHtml(album.name)}</h5>`;
                target.appendChild(g);
                const albumList = document.createElement("div");
                albumList.className = "song-list";
                target.appendChild(albumList);
                renderSongList((album.tracks || []).map(mapSpotifyTrack), albumList);
            });
        }
        return;
    }

    if (data.artists && data.artists.length > 0) {
        const h = document.createElement("div");
        h.className = "search-section";
        h.innerHTML = `<h3>> Artists</h3>`;
        target.appendChild(h);
        
        const artistGrid = document.createElement("div");
        artistGrid.className = "artist-grid";
        
        data.artists.forEach(artist => {
            const a = document.createElement("div");
            a.className = "artist-card";
            a.innerHTML = `
                <img src="${artist.image || 'assets/default-art.png'}" />
                <div class="artist-info">
                    <strong>${escapeHtml(artist.name)}</strong>
                    <span>${(artist.followers || 0).toLocaleString()} followers</span>
                </div>
            `;
            a.onclick = async () => {
                target.innerHTML = `<div class="search-section" style="padding: 40px; text-align: center; color: var(--text-muted);"><div class="spinner"></div><br><br><h3>> Loading Discography: ${escapeHtml(artist.name)}...</h3></div>`;
                try {
                    const res = await runSpotifySearch(artist.url);
                    renderSpotifySearchResults(res, target, "");
                } catch (err) {
                    target.innerHTML = `<div class="search-section"><h3 style="color:var(--error)">Failed to load artist: ${err.message}</h3></div>`;
                }
            };
            artistGrid.appendChild(a);
        });
        target.appendChild(artistGrid);

        if (!document.getElementById("artist-style")) {
            const style = document.createElement("style");
            style.id = "artist-style";
            style.innerHTML = `
                .artist-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 15px; margin-bottom: 25px; }
                .artist-card { background: #1a1a1a; padding: 12px; border-radius: 8px; cursor: pointer; transition: 0.2s; text-align: center; border: 1px solid #333; }
                .artist-card:hover { background: #2a2a2a; transform: translateY(-3px); border-color: var(--primary-color); }
                .artist-card img { width: 100px; height: 100px; border-radius: 50%; object-fit: cover; margin-bottom: 10px; }
                .artist-info strong { display: block; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #fff; margin-bottom: 4px; }
                .artist-info span { font-size: 12px; color: #aaa; }
            `;
            document.head.appendChild(style);
        }
    }

    const songs = (data.tracks || []).map(mapSpotifyTrack);
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
    }

    if (!songs.length) {
        if (!(data.artists && data.artists.length > 0)) {
            target.innerHTML =
                '<span class="loading-text">No Spotify results found.</span>';
        }
        return;
    }

    const block = document.createElement("div");
    block.className = "search-section";
    block.innerHTML = `<h3>> ${escapeHtml(titlePrefix || "Tracks")}</h3>`;
    const list = document.createElement("div");
    list.className = "song-list";
    block.appendChild(list);
    target.appendChild(block);
    renderSongList(songs, list);
    enrichSongsArt(songs, list);
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
                renderSpotifySearchResults(data);
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
                    renderSpotifySearchResults(
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

function createPlayButton(song, tile) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tile-play-btn";
    btn.title = "Play";
    btn.textContent = "▶";
    btn.addEventListener("click", (e) => {
        e.stopPropagation();
        selectAndPlaySong(song, tile);
    });
    return btn;
}

async function renderSongGrid(songs, container) {
    container.innerHTML = "";
    for (const song of songs) {
        const tile = document.createElement("div");
        tile.className = "song-tile";
        tile.dataset.songKey = songKey(song);
        applyDownloadedState(tile, song);

        const artDiv = document.createElement("div");
        artDiv.className = "tile-art";
        await appendArt(artDiv, song, 300);
        artDiv.appendChild(createPlayButton(song, tile));

        const titleSpan = document.createElement("span");
        titleSpan.className = "tile-title";
        titleSpan.textContent = song.title;

        const artistSpan = document.createElement("span");
        artistSpan.className = "tile-artist";
        artistSpan.textContent = song.artist;

        tile.appendChild(artDiv);
        tile.appendChild(titleSpan);
        tile.appendChild(artistSpan);

        tile.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            selectedSong = song;
            contextMenu.style.left = `${e.pageX}px`;
            contextMenu.style.top = `${e.pageY}px`;
            contextMenu.classList.remove("hidden");
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
        artistSpan.textContent = album.artist;

        tile.appendChild(artDiv);
        tile.appendChild(titleSpan);
        tile.appendChild(artistSpan);

        tile.addEventListener("click", () => openAlbumTracks(album));
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
                const raw = await invoke("fetch_lastfm", {
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

async function openAlbumTracks(album) {
    homeCollectionTitle.textContent = `> ${album.title}`;
    homeCollectionSubtitle.textContent = album.artist;
    homeCollectionGrid.innerHTML =
        '<span class="loading-text">Loading album...</span>';

    try {
        const raw = await invoke("fetch_lastfm", {
            method: "album.getInfo",
            extraParams: `&artist=${encodeURIComponent(album.artist)}&album=${encodeURIComponent(album.title)}`,
        });
        const data = JSON.parse(raw);
        let tracks = data.album?.tracks?.track;
        if (!tracks) {
            homeCollectionGrid.innerHTML =
                '<span class="loading-text">No tracks found.</span>';
            return;
        }
        tracks = Array.isArray(tracks) ? tracks : [tracks];
        const songs = tracks.map((t) => ({
            title: t.name,
            artist: album.artist,
            album: album.title,
            image: extractImageFromLastFmTrack(t) || album.image,
            images: parseImagesFromLastFm(t.image),
        }));
        renderSongGrid(songs, homeCollectionGrid);
        enrichSongsArt(songs, homeCollectionGrid);
    } catch (err) {
        homeCollectionGrid.innerHTML = `<span class="loading-text">Failed: ${err}</span>`;
    }
}

async function renderSongList(songs, container) {
    container.innerHTML = "";
    for (const song of songs) {
        const el = document.createElement("div");
        el.className = "song-item";
        el.dataset.songKey = songKey(song);
        applyDownloadedState(el, song);

        const artDiv = document.createElement("div");
        artDiv.className = "item-art";
        artDiv.style.position = "relative";
        await appendArt(artDiv, song, 80);
        const playBtn = createPlayButton(song, el);
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
        infoDiv.innerHTML = `
      <span class="song-title">${escapeHtml(song.title)}</span>
      <span class="song-artist">${escapeHtml(song.artist)}</span>
    `;

        el.appendChild(artDiv);
        el.appendChild(infoDiv);

        el.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            selectedSong = song;
            contextMenu.style.left = `${e.pageX}px`;
            contextMenu.style.top = `${e.pageY}px`;
            contextMenu.classList.remove("hidden");
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
    highlightSelected(element);
    currentSong = song;
    await showDetailSidebarPreview(song);
    fetchAndShowMetadata(song);
}

async function selectAndPlaySong(song, element) {
    await selectSong(song, element);
    playSong(song);
}

async function showDetailSidebarPreview(song) {
    detailEmpty.classList.add("hidden");
    detailContent.classList.remove("hidden");
    detailTitle.textContent = song.title;
    detailArtist.textContent = song.artist;
    detailAlbum.textContent = song.album || "—";
    detailMeta.innerHTML =
        '<p class="detail-meta-loading">Loading metadata…</p>';
    detailArtGallery.classList.add("hidden");
    detailArtThumbs.innerHTML = "";
    await setDetailArt(song.image, song.title, song.artist);

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

async function fetchAndShowMetadata(song) {
    const requestId = ++metadataRequestId;
    try {
        const meta = await invoke("fetch_track_metadata", {
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
        detailArtist.textContent = meta.artist;
        detailAlbum.textContent = meta.album || "—";
        renderMetadataPanel(meta);
        renderArtGallery(allImages, meta.title);
    } catch (err) {
        if (requestId !== metadataRequestId) return;
        detailMeta.innerHTML = `<p class="detail-meta-error">Could not load metadata: ${escapeHtml(String(err))}</p>`;
        if (song.images?.length) renderArtGallery(song.images, song.title);
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

function renderArtGallery(images, altTitle) {
    if (!images?.length) {
        detailArtGallery.classList.add("hidden");
        return;
    }
    detailArtGallery.classList.remove("hidden");
    detailArtThumbs.innerHTML = "";
    const sorted = [...images].sort((a, b) => {
        const ai = IMAGE_SIZE_ORDER.indexOf(a.size);
        const bi = IMAGE_SIZE_ORDER.indexOf(b.size);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
    sorted.forEach((img, index) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.title = img.size;
        if (index === 0) btn.classList.add("active");
        const thumbImg = document.createElement("img");
        thumbImg.src = img.url;
        thumbImg.alt = `${altTitle} - ${img.size}`;
        thumbImg.loading = "lazy";
        const label = document.createElement("span");
        label.className = "thumb-label";
        label.textContent = img.size;
        btn.appendChild(thumbImg);
        btn.appendChild(label);
        btn.addEventListener("click", () => {
            detailArtThumbs
                .querySelectorAll("button")
                .forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");
            detailArtImg.src = img.url;
            detailArtImg.classList.remove("hidden");
            detailArtCanvas.classList.add("hidden");
            if (currentSong) currentSong.image = img.url;
        });
        detailArtThumbs.appendChild(btn);
    });
}

async function downloadSongWithMetadata(song) {
    setBuffering(true);
    statusBar.textContent = `Downloading ${song.title}...`;
    try {
        let meta = song.meta;
        if (!meta) {
            meta = await invoke("fetch_track_metadata", {
                artist: song.artist,
                track: song.title,
            });
            song.meta = meta;
        }

        const query = `${song.title} ${song.artist}`;
        const streamInfo = await invoke("stream_song", { query });
        const savedPath = await invoke("save_song_with_metadata", {
            cachedPath: streamInfo.file_path,
            metadata: meta,
        });

        await refreshDownloadedKeys();
        document
            .querySelectorAll(`[data-song-key="${CSS.escape(songKey(song))}"]`)
            .forEach((el) => {
                applyDownloadedState(el, song);
            });
        await updateNowPlayingDownloadBadge(song);

        statusBar.textContent = `Saved: ${savedPath}`;
        return savedPath;
    } catch (e) {
        statusBar.textContent = `Error: ${e}`;
        throw e;
    } finally {
        setBuffering(false);
    }
}

function setupContextMenu() {
    document.getElementById("cm-queue").addEventListener("click", () => {
        if (selectedSong) {
            appQueue.push(selectedSong);
            renderQueueUI();
            statusBar.textContent = `Added to Queue: ${selectedSong.title}`;
        }
    });
    document.getElementById("cm-playlist").addEventListener("click", () => {
        if (!selectedSong) return;
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
                    await addTrackToPlaylist(pl.id, selectedSong);
                    renderPlaylistSidebar();
                    statusBar.textContent = `Added to ${pl.name}`;
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
            `<p>Select a playlist for <strong>${escapeHtml(selectedSong.title)}</strong>:</p>
                 <select id="modal-playlist-select">${options}</select>`,
            async () => {
                const select = document.getElementById("modal-playlist-select");
                const plId = select.value;
                const pl = getPlaylist(plId);
                if (plId && pl) {
                    await addTrackToPlaylist(plId, selectedSong);
                    statusBar.textContent = `Added to ${pl.name}`;
                    if (getActivePlaylistId() === plId) openPlaylistView(plId);
                }
            },
            "Add",
        );
    });
    document
        .getElementById("cm-download")
        .addEventListener("click", async () => {
            if (selectedSong) await downloadSongWithMetadata(selectedSong);
        });
    document.getElementById("cm-artist").addEventListener("click", () => {
        if (selectedSong) console.log("Viewing artist:", selectedSong.artist);
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
    document.getElementById("np-artist").textContent = song.artist;
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
}

async function playSong(song) {
    const playId = ++activePlayId;
    setBuffering(true);
    statusBar.textContent = `Buffering: ${song.title}...`;

    try {
        const query = `${song.title} ${song.artist}`;

        // Directly point the HTML5 audio element to our new Axum streaming backend
        const streamUrl = `http://127.0.0.1:8000/stream?q=${encodeURIComponent(query)}`;

        if (playId !== activePlayId) return;

        currentStreamData = { file_path: streamUrl, file_name: song.title };

        if (audioPlayer.src && audioPlayer.src.startsWith("blob:")) {
            URL.revokeObjectURL(audioPlayer.src);
        }

        audioPlayer.src = streamUrl;

        initAudioVisualizer();
        if (audioContext && audioContext.state === "suspended") {
            await audioContext.resume();
        }

        await audioPlayer.play();

        if (playId !== activePlayId) return;

        await setNowPlaying(song);
        updateNowPlayingDownloadBadge(song);

        isPlaying = true;
        btnPlay.textContent = "❚❚";
        statusBar.textContent = `Playing: ${song.title}`;

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
        if (currentCollectionSongs.length)
            await renderCollectionContent(currentCollectionSongs);
    });

    viewModeListBtn.addEventListener("click", async () => {
        collectionViewMode = "list";
        applyMode();
        if (currentCollectionSongs.length)
            await renderCollectionContent(currentCollectionSongs);
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
    getPlaylists().forEach((pl) => {
        const li = document.createElement("li");
        li.className = pl.id === getActivePlaylistId() ? "active" : "";
        const label = document.createElement("span");
        label.textContent = pl.name;

        // Add click listener to the entire list item for better hit area
        li.style.cursor = "pointer";
        li.addEventListener("click", () => openPlaylistView(pl.id));

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

        li.appendChild(label);
        li.appendChild(del);
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

    const tbody = document.getElementById("playlist-tracks-body");
    tbody.innerHTML = "";

    const sorted = [...pl.tracks].sort((a, b) => a.order - b.order);

    for (let i = 0; i < sorted.length; i++) {
        const track = sorted[i];
        const tr = document.createElement("tr");
        tr.draggable = true;
        tr.dataset.trackId = track.id;
        tr.dataset.index = String(i);

        tr.addEventListener("dragstart", (e) => {
            e.dataTransfer.setData("text/plain", String(i));
            tr.classList.add("dragging");
        });
        tr.addEventListener("dragend", () => tr.classList.remove("dragging"));
        tr.addEventListener("dragover", (e) => {
            e.preventDefault();
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

        const artTd = document.createElement("td");
        artTd.className = "col-order";
        artTd.textContent = String(i + 1);

        const titleTd = document.createElement("td");
        titleTd.className = "col-title";
        const artWrap = document.createElement("span");
        artWrap.className = "playlist-track-art";
        const song = trackToSong(track);
        await appendArt(artWrap, song, 40);
        const textWrap = document.createElement("span");
        textWrap.innerHTML = `<span class="playlist-track-title">${escapeHtml(track.title)}</span><br>
      <span class="playlist-track-artist">${escapeHtml(track.artist)}</span>`;
        titleTd.appendChild(artWrap);
        titleTd.appendChild(textWrap);

        const albumTd = document.createElement("td");
        albumTd.className = "col-album";
        albumTd.textContent = track.album || "—";

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
            selectAndPlaySong(song, null);
        });
        actTd.appendChild(playBtn);

        tr.appendChild(artTd);
        tr.appendChild(titleTd);
        tr.appendChild(albumTd);
        tr.appendChild(durTd);
        tr.appendChild(playsTd);
        tr.appendChild(actTd);

        tr.addEventListener("click", () => selectSong(song, tr));
        tbody.appendChild(tr);
    }
}

// Modal helper system
function showModal(title, contentHtml, onConfirm, confirmText = "Confirm") {
    const overlay = document.getElementById("modal-overlay");
    const titleEl = document.getElementById("modal-title");
    const bodyEl = document.getElementById("modal-body");
    const cancelBtn = document.getElementById("modal-cancel-btn");
    const confirmBtn = document.getElementById("modal-confirm-btn");

    titleEl.textContent = title;
    bodyEl.innerHTML = contentHtml;
    confirmBtn.textContent = confirmText;

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

let _allDownloadsCache = {};

async function renderDownloadsList(searchQuery = "") {
    const tbody = document.getElementById("downloads-tracks-body");
    if (!tbody) return;
    tbody.innerHTML = "<tr><td colspan='3'>Loading...</td></tr>";

    try {
        const index = await invoke("get_download_index");
        _allDownloadsCache = index;

        let keys = Object.keys(index);

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
            tbody.innerHTML =
                "<tr><td colspan='3' style='text-align:center;'>No downloads found.</td></tr>";
            return;
        }

        for (const key of keys) {
            const filename = index[key];
            const parts = key.split("|");
            const artist = parts[0] || "Unknown";
            const title = parts[1] || "Unknown";

            const tr = document.createElement("tr");

            // Title & Artist
            const titleTd = document.createElement("td");
            titleTd.className = "col-title";
            titleTd.innerHTML = `<div><span style="font-weight:600;">${escapeHtml(title)}</span><br><span style="color:#aaa; font-size: 0.9em;">${escapeHtml(artist)}</span></div>`;

            // Filename
            const fileTd = document.createElement("td");
            fileTd.className = "col-album";
            fileTd.innerHTML = `<span style="font-family:monospace; color:#888;">${escapeHtml(filename)}</span>`;

            // Action
            const actTd = document.createElement("td");
            actTd.className = "col-actions";
            const delBtn = document.createElement("button");
            delBtn.type = "button";
            delBtn.className = "pl-del-btn";
            delBtn.style.position = "static"; // override absolute positioning if any
            delBtn.textContent = "Remove";
            delBtn.addEventListener("click", async (e) => {
                e.stopPropagation();
                if (confirm(`Delete ${filename}?`)) {
                    try {
                        await invoke("delete_downloaded_song", { key });
                        downloadedTrackKeys.delete(key);
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
        tbody.innerHTML = `<tr><td colspan='3' style='color:red;'>Error loading downloads: ${err}</td></tr>`;
    }
}

document.getElementById("downloads-search")?.addEventListener("input", (e) => {
    renderDownloadsList(e.target.value);
});
