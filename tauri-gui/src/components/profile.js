const { invoke } = window.__TAURI__.core;

export function loadUserProfile() {
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

export function saveUserProfileName(newName) {
    const trimmed = newName.trim();
    if (!trimmed) return;
    localStorage.setItem("user_profile_name", trimmed);
    loadUserProfile();
}

export function setupProfilePage() {
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

export function renderProfilePage() {
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

export async function renderProfileStats(range = "all") {
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

export function renderTopTracksList(tracks) {
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

export function renderTopArtistsList(artists) {
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

export function renderTopAlbumsList(albums) {
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
