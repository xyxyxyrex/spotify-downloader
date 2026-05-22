// =============================================================
// --- Karaoke Mode v1 ---
// Synced lyrics plus optional stem preparation for sing-along mode.
// =============================================================

const { invoke } = window.__TAURI__.core;

const karaokeState = {
    open: false,
    trackKey: null,
    lyricsPayload: null,
    currentLineIndex: -1,
    stems: null,
    syncTimer: null,
    trackTimer: null,
};

const MAX_LINE_FALLOFF = 4;

function escapeHtml(text) {
    if (text === null || text === undefined) return "";
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function splitLineWords(text) {
    return String(text || "")
        .trim()
        .split(/\s+/)
        .filter(Boolean);
}

function getSongIdentity(song) {
    if (!song) return "";
    const title = song.title || song.name || "Unknown title";
    const artist =
        song.artist || song.artists || song.album_artist || "Unknown artist";
    const duration = song.duration_secs || song.duration || 0;
    return `${title}::${artist}::${duration}`.toLowerCase();
}

function getPlaybackSourcePath(source) {
    if (!source) return "";
    return (
        source.file_path ||
        source.filePath ||
        source.path ||
        source.local_path ||
        source.cache_path ||
        source.cachePath ||
        ""
    );
}

function getCurrentTrack() {
    const song = window.spotiTauri?.getCurrentSong?.();
    const source = window.spotiTauri?.getCurrentPlaybackSource?.();
    return { song, source };
}

function getPlaybackState() {
    return (
        window.spotiTauri?.getPlaybackState?.() || {
            currentTime: 0,
            duration: 0,
            paused: true,
            seeking: false,
        }
    );
}

function getElements() {
    return {
        overlay: document.getElementById("karaoke-overlay"),
        title: document.getElementById("karaoke-title"),
        artist: document.getElementById("karaoke-artist"),
        status: document.getElementById("karaoke-status"),
        lyrics: document.getElementById("karaoke-lyrics"),
        art: document.getElementById("karaoke-art"),
        artWrap: document.getElementById("karaoke-art-wrap"),
        launchBtn: document.getElementById("btn-launch-karaoke"),
        closeBtn: document.getElementById("karaoke-close-btn"),
        separateBtn: document.getElementById("karaoke-btn-separate"),
        mainBtn: document.getElementById("karaoke-btn-main"),
        restartBtn: document.getElementById("karaoke-btn-restart"),
    };
}

function setStatus(message) {
    const { status } = getElements();
    if (status) {
        status.textContent = message;
    }
}

function setSongMeta(song) {
    const { title, artist, art } = getSongMeta(song);
    const { title: titleEl, artist: artistEl, art: artEl } = getElements();

    if (titleEl) titleEl.textContent = title;
    if (artistEl) artistEl.textContent = artist;
    if (artEl) {
        artEl.src = art || "";
        artEl.alt = title;
        artEl.style.display = art ? "block" : "none";
    }
}

function getSongMeta(song) {
    if (!song) {
        return {
            title: "Ready to sing",
            artist: "Launch Karaoke Mode from a track.",
            art: "",
        };
    }

    const title = song.title || song.name || "Unknown title";
    const artist =
        song.artist || song.artists || song.album_artist || "Unknown artist";
    const art =
        song.art ||
        song.cover_art ||
        song.coverArt ||
        song.image ||
        song.album_art ||
        "";
    return { title, artist, art };
}

function renderPlainLyrics(text) {
    const { lyrics } = getElements();
    if (!lyrics) return;

    lyrics.innerHTML = `
        <div class="lyrics-header">
            <div>
                <div class="lyrics-eyebrow">Lyrics</div>
                <div class="lyrics-title">Plain text view</div>
            </div>
            <div class="lyrics-header-actions">
                <span class="lyrics-source-pill">Source: synced payload</span>
            </div>
        </div>
        <pre class="lyrics-plain">${escapeHtml(text || "No lyrics found for this track.")}</pre>
    `;
}

function renderSyncedLyrics(lines) {
    const { lyrics } = getElements();
    if (!lyrics) return;

    const items = (lines || [])
        .map((line, index) => {
            const time = Number(line.time || 0);
            const words = splitLineWords(line.text)
                .map(
                    (word, wordIndex) => `
                        <span
                            class="synced-lyric-word"
                            data-word-index="${wordIndex}"
                        >
                            ${escapeHtml(word)}
                        </span>
                    `,
                )
                .join(" ");
            return `
                <div
                    class="synced-lyric-line"
                    data-index="${index}"
                    data-time="${time}"
                >
                    <span class="synced-lyric-words">${words}</span>
                </div>
            `;
        })
        .join("");

    lyrics.innerHTML = `
        <div class="lyrics-header">
            <div>
                <div class="lyrics-eyebrow">Lyrics</div>
                <div class="lyrics-title">Synced karaoke view</div>
            </div>
            <div class="lyrics-header-actions">
                <span class="lyrics-source-pill">Live timing</span>
            </div>
        </div>
        <div class="synced-lyrics-list" id="karaoke-synced-lines">${items}</div>
    `;
}

function renderLyrics(payload) {
    karaokeState.lyricsPayload = payload || null;
    karaokeState.currentLineIndex = -1;

    if (!payload) {
        renderPlainLyrics("No lyrics found for this track.");
        return;
    }

    const synced = Array.isArray(payload.synced) ? payload.synced : [];
    if (synced.length > 0) {
        renderSyncedLyrics(synced);
    } else {
        renderPlainLyrics(payload.plain || "No lyrics found for this track.");
    }

    syncLineHighlight(true);
}

function syncLineHighlight(force = false) {
    if (!karaokeState.lyricsPayload) return;
    const synced = Array.isArray(karaokeState.lyricsPayload.synced)
        ? karaokeState.lyricsPayload.synced
        : [];
    if (synced.length === 0) return;

    const { currentTime } = getPlaybackState();
    const time = Number(currentTime || 0);

    let activeIndex = -1;
    for (let index = 0; index < synced.length; index += 1) {
        const next = synced[index + 1];
        const current = Number(synced[index].time || 0);
        const nextTime = next ? Number(next.time || Infinity) : Infinity;
        if (time >= current && time < nextTime) {
            activeIndex = index;
            break;
        }
    }

    if (!force && activeIndex === karaokeState.currentLineIndex) {
        return;
    }

    karaokeState.currentLineIndex = activeIndex;
    const lines = document.querySelectorAll(
        "#karaoke-synced-lines .synced-lyric-line",
    );
    const maxDistance = Math.min(lines.length, MAX_LINE_FALLOFF);
    lines.forEach((line, index) => {
        const isActive = index === activeIndex;
        line.classList.toggle("is-active", isActive);
        const distance = Math.abs(index - activeIndex);
        const falloff = Math.min(distance, maxDistance);
        line.style.setProperty("--line-distance", String(distance));
        line.style.setProperty(
            "--line-opacity",
            String(Math.max(0.16, 1 - falloff * 0.2)),
        );
        line.style.setProperty(
            "--line-blur",
            `${Math.min(falloff * 1.1, 4)}px`,
        );
        line.style.setProperty(
            "--line-scale",
            String(Math.max(0.88, 1 - falloff * 0.022)),
        );
        if (isActive) {
            if (force) {
                setTimeout(() => {
                    line.scrollIntoView({ block: "center", behavior: "auto" });
                }, 50);
            } else {
                line.scrollIntoView({ block: "center", behavior: "smooth" });
            }
        }
    });

    const activeLine = lines[activeIndex];
    if (activeLine) {
        const currentLineTime = Number(activeLine.dataset.time || 0);
        const nextLineTime =
            activeIndex + 1 < lines.length
                ? Number(lines[activeIndex + 1].dataset.time || 0)
                : currentLineTime + 2.5;
        const lineDuration = Math.max(nextLineTime - currentLineTime, 1.2);
        const progress = Math.max(
            0,
            Math.min(
                1,
                (Number(getPlaybackState().currentTime || 0) -
                    currentLineTime) /
                    lineDuration,
            ),
        );
        const words = [...activeLine.querySelectorAll(".synced-lyric-word")];
        if (words.length) {
            const activeWordIndex = Math.min(
                words.length - 1,
                Math.floor(progress * words.length),
            );
            words.forEach((word, index) => {
                word.classList.toggle("is-complete", index < activeWordIndex);
                word.classList.toggle(
                    "is-active-word",
                    index === activeWordIndex,
                );
                word.classList.toggle("is-future", index > activeWordIndex);
            });
        }
    }
}

async function loadLyricsForTrack(song) {
    if (!song) {
        renderPlainLyrics("No track is currently playing.");
        return;
    }

    const title = song.title || song.name || "";
    const artist = song.artist || song.artists || song.album_artist || "";
    const durationSecs = song.duration_secs || song.duration || 0;

    setStatus("Fetching synced lyrics...");
    try {
        const payload = await invoke("fetch_lyrics_payload", {
            title,
            artist,
            durationSecs,
        });
        renderLyrics(payload);
        setStatus(
            payload?.source
                ? `Lyrics ready from ${payload.source}.`
                : "Lyrics ready.",
        );
    } catch (error) {
        console.warn("Karaoke lyrics fetch failed:", error);
        renderPlainLyrics("Lyrics could not be loaded for this track.");
        setStatus("Lyrics unavailable right now.");
    }
}

async function prepareStems(song, source) {
    if (!song) {
        setStatus("Start playback before preparing karaoke stems.");
        return;
    }

    const title = song.title || song.name || "";
    const artist = song.artist || song.artists || song.album_artist || "";
    const durationSecs = song.duration_secs || song.duration || 0;
    const cachePath = getPlaybackSourcePath(source);

    setStatus("Preparing vocal separation... this can take a moment.");
    try {
        const result = await invoke("prepare_karaoke_stems", {
            query: `${title} ${artist}`.trim(),
            title,
            artist,
            durationSecs,
            cachePath,
        });
        karaokeState.stems = result;
        if (result?.instrumental_path) {
            setStatus(
                `Karaoke stems ready with ${result.model || "a local model"}.`,
            );
        } else {
            setStatus("Karaoke stems prepared.");
        }
    } catch (error) {
        console.warn("Karaoke stem preparation failed:", error);
        setStatus("Vocal separation is not available on this system.");
    }
}

async function refreshTrack() {
    const { song, source } = getCurrentTrack();
    const nextTrackKey = getSongIdentity(song) || getPlaybackSourcePath(source);

    if (!nextTrackKey) {
        if (karaokeState.open) {
            setStatus("Waiting for a track...");
        }
        return;
    }

    if (nextTrackKey === karaokeState.trackKey && karaokeState.lyricsPayload) {
        syncLineHighlight(true);
        return;
    }

    karaokeState.trackKey = nextTrackKey;
    karaokeState.stems = null;
    setSongMeta(song);
    await loadLyricsForTrack(song);
}

function openOverlay() {
    const { overlay } = getElements();
    if (!overlay) return;
    overlay.classList.remove("hidden");
    karaokeState.open = true;
    refreshTrack();
}

function closeOverlay() {
    const { overlay } = getElements();
    if (!overlay) return;
    overlay.classList.add("hidden");
    karaokeState.open = false;
}

function restartLyrics() {
    karaokeState.currentLineIndex = -1;
    syncLineHighlight(true);
}

function bindControls() {
    const { launchBtn, closeBtn, separateBtn, mainBtn, restartBtn, lyrics } =
        getElements();

    if (launchBtn) {
        launchBtn.addEventListener("click", openOverlay);
    }
    if (closeBtn) {
        closeBtn.addEventListener("click", closeOverlay);
    }
    if (separateBtn) {
        separateBtn.addEventListener("click", () => {
            const { song, source } = getCurrentTrack();
            void prepareStems(song, source);
        });
    }
    if (mainBtn) {
        mainBtn.addEventListener("click", () => {
            setStatus("Using the main playback mix.");
            restartLyrics();
        });
    }
    if (restartBtn) {
        restartBtn.addEventListener("click", restartLyrics);
    }
    if (lyrics) {
        lyrics.addEventListener("click", (event) => {
            const line = event.target.closest(".synced-lyric-line");
            if (line) {
                const targetTime = Number(line.dataset.time);
                if (Number.isFinite(targetTime) && typeof window.seekAudio === "function") {
                    window.seekAudio(targetTime);
                }
            }
        });
    }
}

function startTimers() {
    if (karaokeState.syncTimer) {
        clearInterval(karaokeState.syncTimer);
    }
    karaokeState.syncTimer = setInterval(() => {
        if (karaokeState.open) {
            syncLineHighlight();
        }
    }, 250);

    if (karaokeState.trackTimer) {
        clearInterval(karaokeState.trackTimer);
    }
    karaokeState.trackTimer = setInterval(() => {
        if (karaokeState.open) {
            void refreshTrack();
        }
    }, 1500);
}

function initKaraokeMode() {
    bindControls();
    startTimers();

    const { song } = getCurrentTrack();
    if (song) {
        setSongMeta(song);
    }

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && karaokeState.open) {
            closeOverlay();
        }
    });
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initKaraokeMode);
} else {
    initKaraokeMode();
}
