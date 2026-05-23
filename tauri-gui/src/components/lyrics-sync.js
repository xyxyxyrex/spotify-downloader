const lyricsState = {
    payload: null,
    mode: "synced",
    loading: false,
    error: null,
};

const MAX_LINE_FALLOFF = 4;

function escapeHtml(text) {
    return String(text ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function getSyncedLines(payload) {
    if (!payload?.synced?.length) return [];
    return [...payload.synced]
        .map((line, index) => ({
            time: Number(line.time) || 0,
            text: String(line.text || "").trim(),
            index,
        }))
        .filter((line) => line.text.length > 0)
        .sort((a, b) => a.time - b.time);
}


function getMode(payload = lyricsState.payload) {
    if (lyricsState.mode === "plain") return "plain";
    return payload?.synced?.length ? "synced" : "plain";
}

function setLyricsMode(mode) {
    if (mode !== "synced" && mode !== "plain") return;
    lyricsState.mode = mode;
    renderLyricsPanels();
}

function setLyricsPayload(payload) {
    lyricsState.payload = payload || null;
    lyricsState.loading = false;
    lyricsState.error = null;
    if (!payload?.synced?.length) {
        lyricsState.mode = "plain";
    } else {
        lyricsState.mode = "synced";
    }
    renderLyricsPanels();
}

function setLyricsLoading(loading) {
    lyricsState.loading = Boolean(loading);
    if (loading) {
        lyricsState.payload = null;
        lyricsState.error = null;
    }
    renderLyricsPanels();
}

function setLyricsError(error) {
    lyricsState.error = error || null;
    lyricsState.loading = false;
    lyricsState.payload = null;
    renderLyricsPanels();
}

function getLyricsPayload() {
    return lyricsState.payload;
}

function buildLyricsHeader(payload, mode) {
    const syncedAvailable = Boolean(payload?.synced?.length);
    const plainAvailable = Boolean(
        payload?.plain && String(payload.plain).trim(),
    );
    const sourceLabel = payload?.source
        ? payload.source.toUpperCase()
        : "LOCAL";
    const syncedActive = mode === "synced";
    const plainActive = mode === "plain";

    // Dynamic descriptive tooltips and pill classes
    const pillText = syncedAvailable ? sourceLabel : `${sourceLabel} (PLAIN ONLY)`;
    const pillClass = syncedAvailable ? "lyrics-source-pill" : "lyrics-source-pill plain-only";
    const pillTitle = syncedAvailable
        ? "Lyrics loaded successfully with time synchronization."
        : "Synced timing not found. Only plain text lyrics are available for this track.";

    return `
        <div class="lyrics-header">
            <div>
                <div class="lyrics-eyebrow">Lyrics</div>
                <div class="lyrics-title">${syncedAvailable ? "Synced Mode" : "Lyrics Mode"}</div>
            </div>
            <div class="lyrics-header-actions">
                <span class="${pillClass}" title="${escapeHtml(pillTitle)}">${escapeHtml(pillText)}</span>
                <div
                    class="lyrics-mode-switch ${syncedActive ? "is-synced" : "is-plain"} ${syncedAvailable ? "has-synced" : "no-synced"}"
                    data-lyrics-mode-switch
                    role="switch"
                    tabindex="0"
                    aria-checked="${syncedActive ? "true" : "false"}"
                    aria-label="Lyrics mode switch"
                    ${syncedAvailable ? "" : 'title="Synced timing not available for this song"'}
                >
                    <button type="button" class="lyrics-mode-switch-hit lyrics-mode-switch-hit-plain" data-lyrics-mode-target="plain" aria-label="Plain lyrics">Plain</button>
                    <div class="lyrics-mode-switch-track" aria-hidden="true">
                        <span class="lyrics-mode-switch-thumb"></span>
                    </div>
                    <button type="button" class="lyrics-mode-switch-hit lyrics-mode-switch-hit-synced ${syncedAvailable ? "" : "is-muted"}" data-lyrics-mode-target="synced" aria-label="Synced lyrics" ${syncedAvailable ? "" : 'title="Synced timing not available for this song"'}>Synced</button>
                </div>
                <button type="button" class="lyrics-fullscreen-btn" data-lyrics-fullscreen-trigger title="Open Fullscreen Lyrics" aria-label="Open Fullscreen Lyrics">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>
                    </svg>
                </button>
            </div>
        </div>
    `;
}

function buildPlainMarkup(payload) {
    const text = String(payload?.plain || "").trim();
    if (!text) {
        return `<div class="lyrics-empty">No lyrics available.</div>`;
    }
    return `<pre class="lyrics-plain">${escapeHtml(text)}</pre>`;
}

function buildSyncedMarkup(payload, rootId) {
    const lines = getSyncedLines(payload);
    if (!lines.length) {
        return buildPlainMarkup(payload);
    }

    return `
        <div class="synced-lyrics-list" data-synced-lyrics-list data-root-id="${escapeHtml(rootId)}">
            ${lines
            .map(
                (line) => `
                        <div class="synced-lyric-line" data-lyrics-time="${line.time}" data-line-index="${line.index}">
                            <span class="synced-lyric-text">${escapeHtml(line.text)}</span>
                        </div>
                    `,
            )
            .join("")}
        </div>
    `;
}

function buildLyricsMarkup(rootId) {
    const payload = lyricsState.payload;
    const mode = getMode(payload);
    if (lyricsState.loading) {
        return `${buildLyricsHeader(null, mode)}<div class="lyrics-empty">Loading lyrics...</div>`;
    }
    if (!payload) {
        const msg = lyricsState.error ? `Lyrics unavailable: ${lyricsState.error}` : "No lyrics available.";
        return `${buildLyricsHeader(null, mode)}<div class="lyrics-empty">${escapeHtml(msg)}</div>`;
    }

    return `${buildLyricsHeader(payload, mode)}<div class="lyrics-body" data-lyrics-body>${mode === "synced" ? buildSyncedMarkup(payload, rootId) : buildPlainMarkup(payload)}</div>`;
}

function renderLyricsPanel(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.dataset.lyricsRoot = containerId;
    container.removeAttribute("data-active-lyrics-index");
    container.innerHTML = buildLyricsMarkup(containerId);

    const switchRoot = container.querySelector("[data-lyrics-mode-switch]");
    if (switchRoot) {
        switchRoot.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();

            const explicitTarget = event.target.closest(
                "[data-lyrics-mode-target]",
            );
            const explicitMode = explicitTarget?.dataset.lyricsModeTarget;
            if (explicitMode === "plain" || explicitMode === "synced") {
                if (explicitMode === "synced" && !lyricsState.payload?.synced?.length) {
                    return;
                }
                setLyricsMode(explicitMode);
                return;
            }

            // Fallback (clicking track, thumb, or keyboard click): robustly toggle mode
            const syncedAvailable = Boolean(lyricsState.payload?.synced?.length);
            const currentMode = getMode();
            const nextMode =
                currentMode === "synced"
                    ? "plain"
                    : syncedAvailable
                        ? "synced"
                        : "plain";
            setLyricsMode(nextMode);
        });

        switchRoot.addEventListener("keydown", (event) => {
            if (event.key === "ArrowLeft") {
                event.preventDefault();
                setLyricsMode("plain");
            } else if (event.key === "ArrowRight") {
                event.preventDefault();
                if (lyricsState.payload?.synced?.length) {
                    setLyricsMode("synced");
                }
            } else if (event.key === " " || event.key === "Enter") {
                event.preventDefault();
                const syncedAvailable = Boolean(lyricsState.payload?.synced?.length);
                const currentMode = getMode();
                const nextMode =
                    currentMode === "synced"
                        ? "plain"
                        : syncedAvailable
                            ? "synced"
                            : "plain";
                setLyricsMode(nextMode);
            }
        });
    }

    const fsBtn = container.querySelector("[data-lyrics-fullscreen-trigger]");
    if (fsBtn) {
        fsBtn.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (typeof window.openPureFullscreenLyrics === "function") {
                window.openPureFullscreenLyrics();
            }
        });
    }

    const syncedList = container.querySelector("[data-synced-lyrics-list]");
    if (syncedList) {
        syncedList.addEventListener("click", (event) => {
            const line = event.target.closest(".synced-lyric-line");
            if (line) {
                const targetTime = Number(line.dataset.lyricsTime);
                if (Number.isFinite(targetTime) && typeof window.seekAudio === "function") {
                    window.seekAudio(targetTime);
                }
            }
        });
    }

    syncLyricsPlayback(lyricsState.currentTime || 0);
}

function renderLyricsPanels() {
    ["detail-lyrics", "fullscreen-lyrics"].forEach((id) => {
        const container = document.getElementById(id);
        if (container) {
            renderLyricsPanel(id);
        }
    });
}

function syncLyricsPlayback(currentTime) {
    lyricsState.currentTime = Number(currentTime) || 0;

    document.querySelectorAll(".synced-lyrics-list").forEach((list) => {
        const lines = [...list.querySelectorAll(".synced-lyric-line")];
        if (!lines.length) return;

        let activeIndex = 0;
        for (let i = 0; i < lines.length; i++) {
            const time = Number(lines[i].dataset.lyricsTime || 0);
            const nextTime =
                i + 1 < lines.length
                    ? Number(lines[i + 1].dataset.lyricsTime || 0)
                    : Infinity;
            if (currentTime >= time && currentTime < nextTime) {
                activeIndex = i;
                break;
            }
            if (currentTime >= time) {
                activeIndex = i;
            }
        }

        const maxDistance = Math.min(lines.length, MAX_LINE_FALLOFF);
        lines.forEach((line, index) => {
            line.classList.toggle("is-active", index === activeIndex);
            const distance = Math.abs(index - activeIndex);
            const falloff = Math.min(distance, maxDistance);
            line.style.setProperty("--line-distance", String(distance));
            line.style.setProperty(
                "--line-opacity",
                String(Math.max(0.18, 1 - falloff * 0.18)),
            );
            line.style.setProperty(
                "--line-blur",
                `${Math.min(falloff * 0.9, 3.4)}px`,
            );
            line.style.setProperty(
                "--line-scale",
                String(Math.max(0.9, 1 - falloff * 0.02)),
            );
        });

        const activeLine = lines[activeIndex];
        if (!activeLine) return;

        const root = list.closest("[data-lyrics-root]");
        const prevActive = root?.dataset.activeLyricsIndex;
        if (prevActive !== String(activeIndex)) {
            const isInitial = prevActive === undefined || prevActive === null || !root.hasAttribute("data-active-lyrics-index");
            root?.setAttribute("data-active-lyrics-index", String(activeIndex));

            // Safely scroll within the container list (.synced-lyrics-list) without triggering native browser scrollIntoView shifting
            const containerHeight = list.clientHeight;
            const lineOffsetTop = activeLine.offsetTop;
            const lineHeight = activeLine.clientHeight;
            const targetScrollTop = lineOffsetTop - (containerHeight / 2) + (lineHeight / 2);

            list.scrollTo({
                top: targetScrollTop,
                behavior: isInitial ? "auto" : "smooth"
            });
        }
    });
}

export {
    getLyricsPayload,
    renderLyricsPanel,
    setLyricsMode,
    setLyricsPayload,
    setLyricsLoading,
    setLyricsError,
    syncLyricsPlayback,
};
