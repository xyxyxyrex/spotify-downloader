// search-browse.js - Search and Browse UI
import { 
    cachedInvoke, escapeHtml, stripHtml, setNowPlaying, 
    updateDetailLikeButton, getDetailSidebarSong, setDetailSidebarSong, 
    appendArt, createPlayButton 
} from "../main.js";
import { showDetailSidebarPreview } from "./detail-sidebar.js";
import { 
    songKey, isValidImage, generateThumbnail, mergeImages, 
    parseImagesFromLastFm, pickBestImageUrl, extractImageFromLastFmTrack 
} from "../utils/media.js";

const { invoke } = window.__TAURI__.core;

export function captureBrowseContext() {
    const view = getActiveMainView();
    browseContext = {
        view,
        homeCollection:
            view === "home" && !homeCollection.classList.contains("hidden")
                ? currentCollection
                : null,
    };
}

export function restoreBrowseContext() {
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

export function showHomeBrowse() {
    homeBrowse.classList.remove("hidden");
    homeCollection.classList.add("hidden");
    currentCollection = null;
}

export async function enrichCollageItems(items) {
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

export async function renderCollageArt(items, artEl, fallbackTitle, fallbackSubtitle, size = 168) {
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

export async function renderHomeBrowse() {
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

export async function runSpotifySearch(query) {
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

export function appendArtistSearchSection(target, artists, heading) {
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

export async function appendAlbumSearchSection(target, albums, heading) {
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

export function appendTrackSearchSection(target, tracks, heading) {
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

export async function renderUnifiedSearchResults(data, target, titlePrefix = "") {
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

export async function searchLastFmTracks(query) {
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

export async function renderSpotifySearchResults(
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

export function setupSearch() {
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

