// settings.js - Settings and Configs UI
import { 
    refreshApiStatus, clearSongDownloadActivity, renderPlaylistSidebar, 
    applyTheme, showModal, 
    apiStatus, refreshThemeOptions
} from "../main.js";
import { loadPlaylistsFromDisk, getPlaylists } from "../playlists.js";
import { renderProfilePage } from "./profile.js";

const { invoke } = window.__TAURI__.core;

const cacheDirInput = document.getElementById("cache-dir-input");
const downloadDirInput = document.getElementById("download-dir-input");
const spotifyIdInput = document.getElementById("spotify-id-input");
const spotifySecretInput = document.getElementById("spotify-secret-input");
const lastfmApiKeyInput = document.getElementById("lastfm-api-key-input");
const settingsStatus = document.getElementById("settings-status");

export async function loadSettingsUI() {
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

export function setupSettings() {
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
                        
                        if (importedPl.custom_image && !existingPl.custom_image) {
                            existingPl.custom_image = importedPl.custom_image;
                        }
                    } else {
                        // Add a brand new playlist (with cloned/unique IDs to prevent any index clashes)
                        const newPl = {
                            id: importedPl.id === "pl_liked_songs" ? "pl_liked_songs" : generateUniqueId("pl"),
                            name: importedPl.name.trim(),
                            tracks: cloneTracks(importedPl.tracks, 0),
                            custom_image: importedPl.custom_image || null
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
                if (typeof refreshThemeOptions === "function") {
                    refreshThemeOptions();
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

export function setSettingsStatus(msg, kind) {
    settingsStatus.textContent = msg;
    settingsStatus.className = "settings-status";
    if (kind) settingsStatus.classList.add(kind);
}

