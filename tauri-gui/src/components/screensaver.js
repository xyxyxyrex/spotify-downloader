import {
    getCurrentSong,
    audioPlayer,
    updateShuffleButton,
    updateLoopButton,
    playPreviousTrack,
    playNextTrack,
} from "../main.js";

import { isValidImage, generateThumbnail } from "../utils/media.js";

import { resolveArtUrl } from "../art.js";
import { resolveTrackCoverUrl } from "../utils/cover-art.js";
import { renderLyricsPanel } from "./lyrics-sync.js";

let screensaverInterval = null;
let screensaverCursorTimeout = null;
let ssLyricsVisible = false;
const SCREENSAVER_TIME_FORMAT_KEY = "spotdl_screensaver_time_format";

function getScreensaverTimeFormat() {
    try {
        const saved = localStorage.getItem(SCREENSAVER_TIME_FORMAT_KEY);
        return saved === "12h" ? "12h" : "24h";
    } catch {
        return "24h";
    }
}

function setScreensaverTimeFormat(format) {
    try {
        localStorage.setItem(SCREENSAVER_TIME_FORMAT_KEY, format);
    } catch {
        /* ignore */
    }
}

function toggleScreensaverTimeFormat(event) {
    if (event) event.stopPropagation();
    const nextFormat = getScreensaverTimeFormat() === "24h" ? "12h" : "24h";
    setScreensaverTimeFormat(nextFormat);
    updateScreensaverClock();
}

export function resetScreensaverCursorTimer() {
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

export function startScreensaverClock() {
    updateScreensaverClock();
    if (!screensaverInterval) {
        screensaverInterval = setInterval(updateScreensaverClock, 1000);
    }
}

export function updateScreensaverClock() {
    const clockEl = document.getElementById("screensaver-clock");
    const dateEl = document.getElementById("screensaver-date");
    if (!clockEl) return;
    const now = new Date();
    const timeFormat = getScreensaverTimeFormat();
    const hours24 = now.getHours();
    const hours12 = hours24 % 12 || 12;
    const hourText =
        timeFormat === "12h"
            ? String(hours12)
            : String(hours24).padStart(2, "0");
    const m = String(now.getMinutes()).padStart(2, "0");
    const s = String(now.getSeconds()).padStart(2, "0");
    const suffix =
        timeFormat === "12h" ? ` ${hours24 >= 12 ? "PM" : "AM"}` : "";
    clockEl.textContent = `${hourText}:${m}:${s}${suffix}`;
    clockEl.title = `Click to switch to ${timeFormat === "24h" ? "AM/PM" : "24H"}`;

    if (dateEl) {
        dateEl.textContent = new Intl.DateTimeFormat("en-US", {
            month: "long",
            day: "numeric",
            year: "numeric",
        }).format(now);
    }
}

export function stopScreensaverClock() {
    if (screensaverInterval) {
        clearInterval(screensaverInterval);
        screensaverInterval = null;
    }
}

export async function updateScreensaverUI() {
    const ssOverlay = document.getElementById("fullscreen-screensaver");
    if (!ssOverlay || ssOverlay.classList.contains("hidden")) return;

    const titleEl = document.getElementById("screensaver-title");
    const artistEl = document.getElementById("screensaver-artist");
    const artImg = document.getElementById("screensaver-art");
    const bgEl = document.getElementById("screensaver-bg");
    const wrap = document.getElementById("screensaver-art-wrap");

    // Clean old fallback canvases
    if (wrap) {
        wrap.querySelectorAll("canvas").forEach((c) => c.remove());
    }

    const currentSong = getCurrentSong();
    if (!currentSong) {
        titleEl.textContent = "No Track Playing";
        artistEl.textContent = "";
        artImg.style.opacity = "0";
        bgEl.style.backgroundImage = "none";
        return;
    }

    // Sync volume bar state on update
    const ssVolBar = document.getElementById("ss-volume-bar");
    const volumeBar = document.getElementById("volume-bar");
    if (ssVolBar && volumeBar) {
        ssVolBar.value = volumeBar.value;
    }
    updateShuffleButton();
    updateLoopButton();

    titleEl.textContent = currentSong.title;
    artistEl.textContent = currentSong.artist;

    // Auto dynamic font scaling for extremely long titles
    const maxTitleLen = 18;
    if (currentSong.title.length > maxTitleLen) {
        const dynamicTitleSize = Math.max(
            1.8,
            3.2 - (currentSong.title.length - maxTitleLen) * 0.045,
        );
        titleEl.style.fontSize = `${dynamicTitleSize}rem`;
    } else {
        titleEl.style.fontSize = "3.2rem";
    }

    // Auto dynamic font scaling for extremely long artist names
    const maxArtistLen = 22;
    if (currentSong.artist.length > maxArtistLen) {
        const dynamicArtistSize = Math.max(
            1.2,
            1.8 - (currentSong.artist.length - maxArtistLen) * 0.025,
        );
        artistEl.style.fontSize = `${dynamicArtistSize}rem`;
    } else {
        artistEl.style.fontSize = "1.8rem";
    }

    await resolveTrackCoverUrl(currentSong);

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
        const fallback = generateThumbnail(
            currentSong.title,
            currentSong.artist,
            420,
        );
        artImg.src = "";
        artImg.style.opacity = "0";
        bgEl.style.backgroundImage = "none";
        if (wrap) {
            wrap.appendChild(fallback);
        }
    }

    const lyricsPanel = document.getElementById("fullscreen-lyrics");
    if (lyricsPanel) {
        const isPureLyrics = ssOverlay.classList.contains("pure-lyrics-mode");
        if (ssLyricsVisible || isPureLyrics) {
            lyricsPanel.classList.remove("hidden");
            renderLyricsPanel("fullscreen-lyrics");
        } else {
            lyricsPanel.classList.add("hidden");
        }
    }

    const ssLyricsToggle = document.getElementById("ss-btn-lyrics-toggle");
    if (ssLyricsToggle) {
        ssLyricsToggle.classList.toggle("active", ssLyricsVisible || ssOverlay.classList.contains("pure-lyrics-mode"));
    }
}

export function openPureFullscreenLyrics() {
    const ssOverlay = document.getElementById("fullscreen-screensaver");
    if (!ssOverlay) return;

    ssOverlay.classList.add("pure-lyrics-mode");
    if (ssOverlay.classList.contains("hidden")) {
        ssOverlay.classList.remove("hidden");
        updateScreensaverUI();
        resetScreensaverCursorTimer();

        if (ssOverlay.requestFullscreen) {
            ssOverlay.requestFullscreen().catch((e) => {
                console.warn("Fullscreen request rejected:", e);
            });
        }
    }
}

export function toggleFullscreenScreensaver() {
    const ssOverlay = document.getElementById("fullscreen-screensaver");
    if (!ssOverlay) return;

    ssOverlay.classList.remove("pure-lyrics-mode");
    if (ssOverlay.classList.contains("hidden")) {
        ssOverlay.classList.remove("hidden");
        ssLyricsVisible = false; // Disabled by default in screensaver mode
        startScreensaverClock();
        updateScreensaverUI();
        resetScreensaverCursorTimer();

        if (ssOverlay.requestFullscreen) {
            ssOverlay.requestFullscreen().catch((e) => {
                console.warn("Fullscreen request rejected:", e);
            });
        }
    } else {
        closeFullscreenScreensaver();
    }
}

export function closeFullscreenScreensaver() {
    const ssOverlay = document.getElementById("fullscreen-screensaver");
    if (!ssOverlay) return;

    ssOverlay.classList.add("hidden");
    ssOverlay.classList.remove("pure-lyrics-mode");
    stopScreensaverClock();
    clearTimeout(screensaverCursorTimeout);
    ssOverlay.classList.remove("cursor-hidden");

    const wrap = document.getElementById("screensaver-art-wrap");
    if (wrap) {
        wrap.querySelectorAll("canvas").forEach((c) => c.remove());
    }

    if (document.fullscreenElement) {
        document.exitFullscreen().catch((e) => {
            console.warn("Exit fullscreen rejected:", e);
        });
    }
}

export function initScreensaverEvents() {
    window.openPureFullscreenLyrics = openPureFullscreenLyrics;
    window.closeFullscreenScreensaver = closeFullscreenScreensaver;
    const btnSS = document.getElementById("btn-fullscreen-saver");
    if (btnSS) {
        btnSS.addEventListener("click", toggleFullscreenScreensaver);
    }

    const ssOverlay = document.getElementById("fullscreen-screensaver");
    if (ssOverlay) {
        ssOverlay.addEventListener("click", closeFullscreenScreensaver);
        ssOverlay.addEventListener("mousemove", resetScreensaverCursorTimer);
    }

    const ssContent = document.querySelector(".screensaver-content");
    if (ssContent) {
        ssContent.addEventListener("click", (e) => {
            e.stopPropagation(); // Prevent closing screensaver when interacting with lyrics or album art
        });
    }

    const ssClock = document.getElementById("screensaver-clock");
    if (ssClock) {
        ssClock.addEventListener("click", toggleScreensaverTimeFormat);
        ssClock.addEventListener("mousemove", (e) => e.stopPropagation());
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

    const ssLyricsToggle = document.getElementById("ss-btn-lyrics-toggle");
    if (ssLyricsToggle) {
        ssLyricsToggle.addEventListener("click", (e) => {
            e.stopPropagation();
            const ssOverlay = document.getElementById("fullscreen-screensaver");
            if (ssOverlay && ssOverlay.classList.contains("pure-lyrics-mode")) {
                ssOverlay.classList.remove("pure-lyrics-mode");
                ssLyricsVisible = false;
            } else {
                ssLyricsVisible = !ssLyricsVisible;
            }
            updateScreensaverUI();
        });
    }

    const ssVolBar = document.getElementById("ss-volume-bar");
    const volumeBar = document.getElementById("volume-bar");
    if (ssVolBar) {
        ssVolBar.addEventListener("input", (e) => {
            const val = Number(e.target.value);
            audioPlayer.volume = val / 100;
            if (volumeBar) volumeBar.value = val; // Synchronize with the main volume bar
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
