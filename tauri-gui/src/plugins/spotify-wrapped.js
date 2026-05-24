// =============================================================
// --- Stats & Fate v2 — GSAP-Powered Immersive Engine ---
// =============================================================

import { TAROT_PROFILES, evaluateUnlockedCards } from "./tarot-profiles.js";

const { invoke } = window.__TAURI__.core;

let wrappedTimer = null;
let wrappedSlideIndex = 0;
let wrappedIsPaused = false;
const SLIDE_DURATION = 12000;
let wrappedTimerStart = 0;
let wrappedTimerElapsed = 0;
let wrappedParticleRAF = null;
let wrappedActiveTL = null; // active GSAP timeline for current slide

// ---- Wrapped Audio Highlight Cache System ----
let wrappedCachedAudio = {
    firstPlay: { url: null, startTime: 0, audio: null },
    topTrack: { url: null, startTime: 0, audio: null }
};

function escapeHtml(text) {
    if (!text) return "";
    return text.toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function getAudioMimeType(fileName) {
    if (!fileName) return "audio/mpeg";
    const ext = fileName.split('.').pop().toLowerCase();
    switch (ext) {
        case "m4a": return "audio/mp4";
        case "webm": return "audio/webm";
        case "ogg":
        case "opus": return "audio/ogg";
        case "wav": return "audio/wav";
        case "flac": return "audio/flac";
        case "mp3":
        default: return "audio/mpeg";
    }
}

function getChorusTimestamp(title, artist, durationSecs) {
    const t = String(title).toLowerCase();
    const a = String(artist).toLowerCase();
    
    // Custom fine-tuned chorus/highlight starting timestamps for mock/demo/famous tracks
    if (t.includes("blinding lights")) return 26;
    if (t.includes("starboy")) return 45;
    if (t.includes("bad habits")) return 36;
    if (t.includes("stay") && a.includes("kid laroi")) return 28;
    if (t.includes("levitating")) return 38;
    if (t.includes("as it was")) return 28;
    if (t.includes("sweater weather")) return 54;
    if (t.includes("stressed out")) return 35;
    
    // Dynamic fallback heuristic: chorus/hook typically hits around 32% mark
    if (durationSecs && durationSecs > 0) {
        return Math.floor(durationSecs * 0.32);
    }
    return 40;
}

async function preloadWrappedSong(song, type) {
    if (!song) return;
    
    // 1. Primary: Try streaming through local Rust yt-dlp / ytmusicapi backend
    try {
        const query = `${song.title} ${song.artist}`;
        const streamInfo = await invoke("stream_song", {
            query,
            title: song.title,
            artist: song.artist,
            durationSecs: song.duration_secs || song.duration,
        });
        if (streamInfo && streamInfo.file_path) {
            const bytes = await invoke("read_audio_file", {
                path: streamInfo.file_path,
            });
            if (bytes) {
                const mimeType = getAudioMimeType(streamInfo.file_name);
                const blob = new Blob([new Uint8Array(bytes)], { type: mimeType });
                const blobUrl = URL.createObjectURL(blob);
                const audio = new Audio(blobUrl);
                audio.crossOrigin = "anonymous";
                const duration = song.duration ?? song.duration_secs ?? 200;
                const startTime = getChorusTimestamp(song.title, song.artist, duration);
                
                wrappedCachedAudio[type] = {
                    url: blobUrl,
                    startTime: startTime,
                    audio: audio
                };
                audio.load();
                console.log(`Pre-cached primary YouTube/ytmusicapi stream for wrapped song (${type}): "${song.title}" starting at ${startTime}s`);
                return;
            }
        }
    } catch (err) {
        console.error(`YouTube/ytmusicapi primary stream failed for wrapped song (${type}):`, err);
    }

    // 2. Fallback: Query iTunes Search API to fetch 30-second preview clip
    if (window.__TAURI__?.core?.invoke) {
        try {
            const previewUrl = await window.__TAURI__.core.invoke("fetch_itunes_preview", {
                artist: song.artist,
                title: song.title,
            });
            if (previewUrl) {
                const audio = new Audio(previewUrl);
                audio.crossOrigin = "anonymous";
                wrappedCachedAudio[type] = {
                    url: previewUrl,
                    startTime: 0, // iTunes previews start right at the chorus
                    audio: audio
                };
                audio.load();
                console.log(`Pre-cached fallback iTunes preview via Tauri Rust backend for wrapped song (${type}): "${song.title}"`);
                return;
            }
        } catch (e) {
            console.debug(`iTunes preview fallback via Tauri Rust backend failed for wrapped song (${type}):`, e);
        }
        return; // In Tauri environment, never do a direct frontend fetch to avoid CORS console noise
    }

    try {
        const itunesQuery = `${song.title} ${song.artist}`;
        const url = `https://itunes.apple.com/search?term=${encodeURIComponent(itunesQuery)}&entity=song&limit=1`;
        const res = await fetch(url);
        if (res.ok) {
            const data = await res.json();
            if (data.results && data.results.length > 0) {
                const track = data.results[0];
                if (track.previewUrl) {
                    const audio = new Audio(track.previewUrl);
                    audio.crossOrigin = "anonymous";
                    wrappedCachedAudio[type] = {
                        url: track.previewUrl,
                        startTime: 0, // iTunes previews start right at the chorus
                        audio: audio
                    };
                    audio.load();
                    console.log(`Pre-cached fallback iTunes preview for wrapped song (${type}): "${song.title}"`);
                    return;
                }
            }
        }
    } catch (e) {
        console.debug(`Direct iTunes preview fallback fetch failed for wrapped song (${type}) (expected if CORS blocks it):`, e);
    }
}

function playWrappedAudio(type) {
    // Pause main application music to avoid overlap
    if (window.spotiTauri && window.spotiTauri.pausePlayback) {
        window.spotiTauri.pausePlayback();
    }
    
    stopWrappedAudio();
    
    const item = wrappedCachedAudio[type];
    if (item && item.audio) {
        const audio = item.audio;
        audio.currentTime = item.startTime;
        const volumeBar = document.getElementById("volume-bar");
        audio.volume = volumeBar ? Number(volumeBar.value) / 100 : 0.5;
        audio.loop = true;
        
        audio.play().then(() => {
            console.log(`Autoplayed wrapped audio: ${type} at ${item.startTime}s`);
        }).catch(err => {
            console.warn(`Autoplay blocked for wrapped audio:`, err);
        });
    }
}

function stopWrappedAudio() {
    if (wrappedCachedAudio.firstPlay && wrappedCachedAudio.firstPlay.audio) {
        wrappedCachedAudio.firstPlay.audio.pause();
    }
    if (wrappedCachedAudio.topTrack && wrappedCachedAudio.topTrack.audio) {
        wrappedCachedAudio.topTrack.audio.pause();
    }
}

// ---- Ambient Particle System ----
function initWrappedParticles() {
    const canvas = document.getElementById("wrapped-particles");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width * 2;
    canvas.height = rect.height * 2;
    ctx.scale(2, 2);

    const particles = [];
    const PARTICLE_COUNT = 40;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
        particles.push({
            x: Math.random() * rect.width,
            y: Math.random() * rect.height,
            r: Math.random() * 1.5 + 0.3,
            dx: (Math.random() - 0.5) * 0.3,
            dy: (Math.random() - 0.5) * 0.2 - 0.15,
            alpha: Math.random() * 0.4 + 0.1,
        });
    }

    function drawParticles() {
        ctx.clearRect(0, 0, rect.width, rect.height);
        particles.forEach((p) => {
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255,255,255,${p.alpha})`;
            ctx.fill();
            p.x += p.dx;
            p.y += p.dy;
            if (p.x < -5) p.x = rect.width + 5;
            if (p.x > rect.width + 5) p.x = -5;
            if (p.y < -5) p.y = rect.height + 5;
            if (p.y > rect.height + 5) p.y = -5;
        });
        wrappedParticleRAF = requestAnimationFrame(drawParticles);
    }
    drawParticles();
}

function stopWrappedParticles() {
    if (wrappedParticleRAF) {
        cancelAnimationFrame(wrappedParticleRAF);
        wrappedParticleRAF = null;
    }
}

// ---- Mesh Background Gradient Morphing ----
const WRAPPED_GRADIENTS = [
    // Slide 0: Welcome - deep green/teal
    { bg: "radial-gradient(ellipse at 30% 20%, rgba(29,185,84,0.25) 0%, transparent 50%), radial-gradient(ellipse at 70% 80%, rgba(0,188,212,0.2) 0%, transparent 50%)", x: 0, y: 0, scale: 1 },
    // Slide 1: Play count - purple/green pulse
    { bg: "radial-gradient(ellipse at 50% 40%, rgba(155,89,182,0.3) 0%, transparent 50%), radial-gradient(ellipse at 30% 70%, rgba(29,185,84,0.25) 0%, transparent 50%)", x: -10, y: -5, scale: 1.1 },
    // Slide 2: Discovery - orange/warm
    { bg: "radial-gradient(ellipse at 60% 30%, rgba(255,152,0,0.3) 0%, transparent 50%), radial-gradient(ellipse at 30% 80%, rgba(213,16,7,0.15) 0%, transparent 50%)", x: 5, y: -8, scale: 1.05 },
    // Slide 3: Top Track - vibrant green
    { bg: "radial-gradient(ellipse at 40% 35%, rgba(29,185,84,0.35) 0%, transparent 50%), radial-gradient(ellipse at 75% 70%, rgba(0,188,212,0.2) 0%, transparent 50%)", x: -5, y: 5, scale: 1.15 },
    // Slide 4: Top Artists - violet
    { bg: "radial-gradient(ellipse at 35% 40%, rgba(103,58,183,0.3) 0%, transparent 50%), radial-gradient(ellipse at 80% 25%, rgba(233,30,99,0.2) 0%, transparent 50%)", x: 8, y: -3, scale: 1.08 },
    // Slide 5: Genres - cyan
    { bg: "radial-gradient(ellipse at 55% 25%, rgba(0,188,212,0.3) 0%, transparent 50%), radial-gradient(ellipse at 25% 75%, rgba(139,195,74,0.2) 0%, transparent 50%)", x: -8, y: 3, scale: 1.12 },
    // Slide 6: Time - pink/magenta
    { bg: "radial-gradient(ellipse at 40% 30%, rgba(233,30,99,0.3) 0%, transparent 50%), radial-gradient(ellipse at 70% 75%, rgba(255,87,34,0.2) 0%, transparent 50%)", x: 3, y: -6, scale: 1.05 },
    // Slide 7: Personality - green/purple blend
    { bg: "radial-gradient(ellipse at 50% 45%, rgba(29,185,84,0.25) 0%, transparent 50%), radial-gradient(ellipse at 60% 80%, rgba(155,89,182,0.2) 0%, transparent 50%)", x: -3, y: 8, scale: 1.1 },
    // Slide 8: Explorer - lime/teal
    { bg: "radial-gradient(ellipse at 30% 35%, rgba(139,195,74,0.3) 0%, transparent 50%), radial-gradient(ellipse at 75% 60%, rgba(0,188,212,0.2) 0%, transparent 50%)", x: 6, y: -4, scale: 1.08 },
    // Slide 9: Summary - cinematic
    { bg: "radial-gradient(ellipse at 50% 25%, rgba(29,185,84,0.3) 0%, transparent 55%), radial-gradient(ellipse at 50% 80%, rgba(155,89,182,0.2) 0%, transparent 50%)", x: 0, y: 0, scale: 1 },
];

function morphMeshBg(index) {
    const meshBg = document.getElementById("wrapped-mesh-bg");
    if (!meshBg || !window.gsap) return;
    const g = WRAPPED_GRADIENTS[index] || WRAPPED_GRADIENTS[0];
    meshBg.style.background = g.bg;
    gsap.to(meshBg, {
        x: g.x + "%",
        y: g.y + "%",
        scale: g.scale,
        duration: 1.5,
        ease: "power2.inOut",
    });
}

// ---- Slide Content Builders ----
// Each returns an HTML string. GSAP animates elements after insertion.

function buildSlide0(greet) {
    return `<div class="wrapped-slide" style="justify-content:center; text-align:center; align-items:center;">
        <div style="display:flex; flex-direction:column; align-items:center; gap:18px;">
            <div class="w-float-icon icon-svg icon-headphones" style="font-size:3.5rem; background-color: var(--accent);"></div>
            <h1 class="w-heading" style="font-size:2.4rem; background:linear-gradient(135deg,var(--accent),#00bcd4); -webkit-background-clip:text; -webkit-text-fill-color:transparent;">Your Sound,<br>Unlocked.</h1>
            <p class="w-subtext" style="max-width:260px;">${greet}. Let's explore 10 chapters of your listening story.</p>
            <div class="w-hint" style="margin-top:20px;">
                <span>Tap to begin</span>
                <span class="w-hint-arrow">→</span>
            </div>
        </div>
    </div>`;
}

function buildSlide1(totalPlays) {
    return `<div class="wrapped-slide" style="justify-content:center; text-align:center; align-items:center; position:relative;">
        <div class="pulse-ring" style="width:260px; height:260px; top:calc(50% - 130px); left:calc(50% - 130px);"></div>
        <div class="pulse-ring" style="width:200px; height:200px; top:calc(50% - 100px); left:calc(50% - 100px);"></div>
        <div style="display:flex; flex-direction:column; align-items:center; gap:12px; position:relative; z-index:5;">
            <span class="w-label" style="color:#1db954;">Playback Pulse</span>
            <div class="w-big-number" data-target="${totalPlays}">0</div>
            <span class="w-counter-unit">total plays</span>
            <p class="w-subtext" style="margin-top:10px;">Every tap, every loop — cataloged.</p>
        </div>
    </div>`;
}

function buildSlide2(oldestListen, defaultImg) {
    const track = oldestListen ? oldestListen.track : null;
    const img = track ? (track.image || defaultImg) : defaultImg;
    const title = track ? track.title : "Mystery Track";
    const artist = track ? track.artist : "Unknown Artist";
    const dateStr = oldestListen ? new Date(oldestListen.time * 1000).toLocaleDateString(undefined, {month:"long", day:"numeric", year:"numeric"}) : "Day One";
    return `<div class="wrapped-slide" style="justify-content:center; align-items:center; text-align:center;">
        <div style="display:flex; flex-direction:column; align-items:center; gap:14px; width:100%;">
            <span class="w-label" style="color:#ff9800;">First Listen</span>
            <div class="w-art-container" style="width:170px; height:170px; margin:8px 0;">
                <img src="${img}" class="w-art-image" alt="${escapeHtml(title)}" />
                <div class="w-art-glow" style="background:rgba(255,152,0,0.3);"></div>
                <div class="w-badge" style="background:#ff9800; color:#000;">FIRST PLAY</div>
            </div>
            <h3 class="w-heading" style="font-size:1.35rem;">${escapeHtml(title)}</h3>
            <p style="color:#ff9800; font-weight:700; font-size:0.95rem; margin:0; opacity:0;" class="w-artist-name">${escapeHtml(artist)}</p>
            <p class="w-subtext" style="font-size:0.82rem;">${dateStr}</p>
        </div>
    </div>`;
}

function buildSlide3(topTrack, topTrackCount, defaultImg) {
    const img = topTrack ? (topTrack.image || defaultImg) : defaultImg;
    const title = topTrack ? topTrack.title : "No Track";
    const artist = topTrack ? topTrack.artist : "—";
    return `<div class="wrapped-slide" style="justify-content:center; align-items:center; text-align:center;">
        <div style="display:flex; flex-direction:column; align-items:center; gap:12px; width:100%;">
            <span class="w-label" style="color:#1db954;">Your Anthem</span>
            <div class="w-vinyl-container" style="margin:12px 0;">
                <div class="w-vinyl-disc">
                    <img src="${img}" alt="${escapeHtml(title)}" />
                </div>
                <div class="w-vinyl-hole"></div>
            </div>
            <h3 class="w-heading" style="font-size:1.4rem;">${escapeHtml(title)}</h3>
            <p style="color:#1db954; font-weight:700; font-size:0.95rem; margin:0; opacity:0;" class="w-artist-name">${escapeHtml(artist)}</p>
            <div class="w-counter-unit" style="background:rgba(29,185,84,0.1); border:1px solid rgba(29,185,84,0.2); border-radius:20px; padding:5px 14px; font-size:0.82rem;">
                Played ${topTrackCount} times
            </div>
        </div>
    </div>`;
}

function buildSlide4(topArtists) {
    const items = topArtists.length > 0 ? topArtists.map((a, i) => {
        const colors = ["#1db954","#9b59b6","#e74c3c","#3498db","#ff9800"];
        return `<div class="wrapped-rank-item">
            <span class="wrapped-rank-number" style="color:${colors[i]};">#${i + 1}</span>
            <div class="wrapped-rank-info">
                <p class="wrapped-rank-title">${escapeHtml(a[0])}</p>
                <p class="wrapped-rank-subtitle">${i === 0 ? "Your #1 artist" : "Heavy rotation"}</p>
            </div>
            <span class="wrapped-rank-plays">${a[1]} plays</span>
        </div>`;
    }).join("") : `<div class="wrapped-rank-item"><span class="wrapped-rank-number" style="color:#1db954;">#1</span><div class="wrapped-rank-info"><p class="wrapped-rank-title">Start listening!</p><p class="wrapped-rank-subtitle">Play tracks to build your circle</p></div></div>`;
    return `<div class="wrapped-slide" style="justify-content:flex-start; padding-top:70px;">
        <div style="display:flex; flex-direction:column; gap:10px; width:100%;">
            <span class="w-label" style="color:#9b59b6;">Inner Circle</span>
            <h2 class="w-heading" style="margin-bottom:12px;">Artists that defined you.</h2>
            <div class="wrapped-rank-list">${items}</div>
        </div>
    </div>`;
}

function buildSlide5(genres) {
    const bars = genres.map(g => `<div class="w-genre-row">
        <div class="w-genre-label"><span>${g.name}</span><span style="color:${g.color};">${g.percentage}%</span></div>
        <div class="w-genre-bar-track"><div class="w-genre-bar-fill" style="background:${g.color};" data-pct="${g.percentage}"></div></div>
    </div>`).join("");
    return `<div class="wrapped-slide" style="justify-content:center;">
        <div style="display:flex; flex-direction:column; gap:14px; width:100%;">
            <span class="w-label" style="color:#00bcd4;">Sound Spectrum</span>
            <h2 class="w-heading">Your genre footprint.</h2>
            <div style="display:flex; flex-direction:column; gap:16px; margin-top:10px;">${bars}</div>
        </div>
    </div>`;
}

function buildSlide6(hoursListened, minutesListened) {
    return `<div class="wrapped-slide" style="justify-content:center; text-align:center; align-items:center;">
        <div style="display:flex; flex-direction:column; align-items:center; gap:12px;">
            <span class="w-label" style="color:#e91e63;">Time Spent</span>
            <div class="w-big-number" style="font-size:6rem;" data-target="${Math.round(parseFloat(hoursListened))}">0</div>
            <span class="w-counter-unit">hours listened</span>
            <p class="w-subtext" style="margin-top:10px;">That's <strong style="color:#e91e63;">${minutesListened.toLocaleString()} minutes</strong> of pure sonic immersion.</p>
        </div>
    </div>`;
}

function buildSlide7(unlockedCount, unlockedCards) {
    const cardsToShow = unlockedCards.slice(0, 3).map(c => `<span style="background:rgba(110, 94, 172, 0.25); border:1px solid var(--accent); color:var(--accent); font-family:monospace; padding:4px 8px; border-radius:4px; font-size:0.75rem;">${escapeHtml(c.name)}</span>`).join(" ");
    
    return `<div class="wrapped-slide" style="justify-content:center; text-align:center; align-items:center;">
        <div style="display:flex; flex-direction:column; align-items:center; gap:12px; width:100%;">
            <span class="w-label" style="color:var(--accent);">Fate Unlocked</span>
            <h2 class="w-heading" style="margin-bottom:6px; font-size:1.6rem; background:linear-gradient(135deg,var(--accent),#6e5eac); -webkit-background-clip:text; -webkit-text-fill-color:transparent;">Your Tarot Quests</h2>
            <div class="personality-badge" style="width:100%; box-sizing:border-box; border: 2px dashed #4a3e7a; background:rgba(0,0,0,0.2); padding:16px;">
                <div class="icon-svg icon-tarot" style="font-size:2.4rem; margin-bottom:6px; position:relative; z-index:1; animation: wrapped-badge-spin 12s linear infinite; background-color: var(--accent);"></div>
                <div class="personality-title" style="color:#fff; font-size:1.8rem; font-family:monospace;">${unlockedCount} / 22</div>
                <p style="color:#8be9fd; font-size:0.8rem; margin:4px 0 10px 0; font-family:monospace;">Cards Collected</p>
                <div style="display:flex; justify-content:center; gap:6px; flex-wrap:wrap; margin-top:8px;">
                    ${cardsToShow || '<span style="color:#6272a4; font-size:0.8rem;">No cards unlocked yet...</span>'}
                </div>
            </div>
            <p class="w-subtext" style="font-size:0.75rem; max-width:240px; margin-top:4px;">Each card represents a listening quest. View your full collection in the <strong>Fate Book</strong>!</p>
        </div>
    </div>`;
}

function buildSlide8(uniqueTracks, artistCount) {
    return `<div class="wrapped-slide" style="justify-content:center; text-align:center; align-items:center;">
        <div style="display:flex; flex-direction:column; align-items:center; gap:14px;">
            <span class="w-label" style="color:#8bc34a;">The Explorer</span>
            <h2 class="w-heading">Catalog Footprint</h2>
            <div style="display:flex; gap:14px; margin:12px 0;">
                <div class="w-stat-card">
                    <div class="w-stat-value" style="color:#8bc34a;">${uniqueTracks}</div>
                    <div class="w-stat-label">Unique Songs</div>
                </div>
                <div class="w-stat-card">
                    <div class="w-stat-value" style="color:#00bcd4;">${artistCount}</div>
                    <div class="w-stat-label">Artists</div>
                </div>
            </div>
            <p class="w-subtext">A curated archive of melodies and stories.</p>
        </div>
    </div>`;
}

function buildSlide9(topTrack, topArtists, totalPlays, minutesListened, uniqueTracks, unlockedCount, isMockData, defaultImg) {
    const trackTitle = topTrack ? topTrack.title : "—";
    const trackArtist = topTrack ? topTrack.artist : "—";
    const trackImg = topTrack ? (topTrack.image || defaultImg) : defaultImg;
    const topArtistName = topArtists[0] ? topArtists[0][0] : "—";
    return `<div class="wrapped-slide" style="justify-content:flex-start; padding-top:55px;">
        <div style="display:flex; flex-direction:column; gap:12px; width:100%;">
            <h2 class="w-heading" style="text-align:center; font-size:1.3rem;">Your Wrapped Summary</h2>
            <div class="w-summary-grid">
                <div class="w-summary-row">
                    <img src="${trackImg}" style="width:42px; height:42px; border-radius:8px; object-fit:cover; flex-shrink:0;" />
                    <div style="min-width:0; flex:1;">
                        <div class="w-summary-label">Top Track</div>
                        <div class="w-summary-value">${escapeHtml(trackTitle)}</div>
                        <div style="font-size:0.75rem; color:rgba(255,255,255,0.4);">${escapeHtml(trackArtist)}</div>
                    </div>
                </div>
                <div class="w-summary-row">
                    <div style="flex:1;"><div class="w-summary-label">Top Artist</div><div class="w-summary-value">${escapeHtml(topArtistName)}</div></div>
                    <div style="flex:1;"><div class="w-summary-label">Total Plays</div><div class="w-summary-value" style="color:#1db954;">${totalPlays}</div></div>
                </div>
                <div class="w-summary-row">
                    <div style="flex:1;"><div class="w-summary-label">Minutes</div><div class="w-summary-value">${minutesListened.toLocaleString()}</div></div>
                    <div style="flex:1;"><div class="w-summary-label">Unique Tracks</div><div class="w-summary-value" style="color:#00bcd4;">${uniqueTracks}</div></div>
                </div>
                <div class="w-summary-row">
                    <div style="flex:1;">
                        <div class="w-summary-label">Fate Book Collection</div>
                        <div class="w-summary-value" style="font-size:0.88rem; font-family:monospace; color:#ffb86c;">${unlockedCount} / 22 Cards</div>
                    </div>
                </div>
            </div>
            <p style="text-align:center; font-size:0.72rem; color:rgba(255,255,255,0.3); margin:4px 0 0 0; display:flex; align-items:center; gap:4px; justify-content:center;">
                ${isMockData 
                    ? `<span class="icon-svg icon-plugin" style="background-color: var(--err, #ff5555); font-size: 0.75rem; vertical-align: middle;"></span> Simulated profile — listen more!` 
                    : `<span class="icon-svg icon-success" style="background-color: var(--accent); font-size: 0.75rem; vertical-align: middle;"></span> From your local play logs`}
            </p>
            <button type="button" class="w-save-btn" onclick="alert('Wrapped card saved!')"><span class="icon-svg icon-save" style="margin-right: 6px;"></span> Save Wrapped Card</button>
        </div>
    </div>`;
}

// ---- GSAP Timeline Builders per Slide ----

function animateSlide0(slide) {
    const tl = gsap.timeline();
    tl.from(slide.querySelector(".w-float-icon"), { scale: 0, rotation: -180, duration: 0.8, ease: "back.out(1.7)" })
      .to(slide.querySelector(".w-heading"), { opacity: 1, y: 0, duration: 0.7, ease: "power3.out" }, "-=0.3")
      .to(slide.querySelector(".w-subtext"), { opacity: 1, y: 0, duration: 0.6, ease: "power3.out" }, "-=0.35")
      .to(slide.querySelector(".w-hint"), { opacity: 1, duration: 0.5 }, "-=0.2");
    return tl;
}

function animateSlide1(slide) {
    const tl = gsap.timeline();
    const rings = slide.querySelectorAll(".pulse-ring");
    const bigNum = slide.querySelector(".w-big-number");
    const target = parseInt(bigNum?.dataset.target || "0");
    
    tl.to(rings, { opacity: 0.4, scale: 1, duration: 0.8, stagger: 0.2, ease: "power2.out" })
      .to(slide.querySelector(".w-label"), { opacity: 1, y: 0, duration: 0.5, ease: "power3.out" }, "-=0.4")
      .to(bigNum, { opacity: 1, scale: 1, duration: 0.6, ease: "back.out(1.4)" }, "-=0.2");
    
    // Counter animation
    if (bigNum) {
        tl.add(() => {
            gsap.to({ val: 0 }, {
                val: target,
                duration: 1.8,
                ease: "power2.out",
                onUpdate: function() { bigNum.textContent = Math.round(this.targets()[0].val).toLocaleString(); }
            });
        }, "-=0.5");
    }
    
    tl.to(slide.querySelector(".w-counter-unit"), { opacity: 1, y: 0, duration: 0.4, ease: "power2.out" }, "-=1.2")
      .to(slide.querySelector(".w-subtext"), { opacity: 1, y: 0, duration: 0.4 }, "-=0.8");
    
    // Pulse ring continuous animation
    rings.forEach((ring, i) => {
        gsap.to(ring, { scale: 1.08, opacity: 0.15, duration: 2, ease: "sine.inOut", yoyo: true, repeat: -1, delay: i * 0.5 });
    });
    
    return tl;
}

function animateSlide2(slide) {
    const tl = gsap.timeline();
    tl.to(slide.querySelector(".w-label"), { opacity: 1, y: 0, duration: 0.5, ease: "power3.out" })
      .to(slide.querySelector(".w-art-container"), { opacity: 1, scale: 1, duration: 0.7, ease: "back.out(1.5)" }, "-=0.2")
      .to(slide.querySelector(".w-heading"), { opacity: 1, y: 0, duration: 0.5, ease: "power3.out" }, "-=0.3")
      .to(slide.querySelector(".w-artist-name"), { opacity: 1, y: 0, duration: 0.4 }, "-=0.2")
      .to(slide.querySelector(".w-subtext"), { opacity: 1, duration: 0.4 }, "-=0.15");
    return tl;
}

function animateSlide3(slide) {
    const tl = gsap.timeline();
    const disc = slide.querySelector(".w-vinyl-disc");
    tl.to(slide.querySelector(".w-label"), { opacity: 1, y: 0, duration: 0.5, ease: "power3.out" })
      .to(slide.querySelector(".w-vinyl-container"), { opacity: 1, scale: 1, duration: 0.7, ease: "back.out(1.4)" }, "-=0.2");
    // Vinyl spin
    if (disc) {
        gsap.to(disc, { rotation: 360, duration: 6, ease: "none", repeat: -1 });
    }
    tl.to(slide.querySelector(".w-heading"), { opacity: 1, y: 0, duration: 0.5, ease: "power3.out" }, "-=0.3")
      .to(slide.querySelector(".w-artist-name"), { opacity: 1, duration: 0.4 }, "-=0.2")
      .to(slide.querySelector(".w-counter-unit"), { opacity: 1, y: 0, duration: 0.4, ease: "power2.out" }, "-=0.15");
    return tl;
}

function animateSlide4(slide) {
    const tl = gsap.timeline();
    const items = slide.querySelectorAll(".wrapped-rank-item");
    tl.to(slide.querySelector(".w-label"), { opacity: 1, y: 0, duration: 0.5, ease: "power3.out" })
      .to(slide.querySelector(".w-heading"), { opacity: 1, y: 0, duration: 0.5, ease: "power3.out" }, "-=0.25")
      .to(items, { opacity: 1, x: 0, duration: 0.5, stagger: 0.1, ease: "power3.out" }, "-=0.2");
    return tl;
}

function animateSlide5(slide) {
    const tl = gsap.timeline();
    const rows = slide.querySelectorAll(".w-genre-row");
    const fills = slide.querySelectorAll(".w-genre-bar-fill");
    tl.to(slide.querySelector(".w-label"), { opacity: 1, y: 0, duration: 0.5, ease: "power3.out" })
      .to(slide.querySelector(".w-heading"), { opacity: 1, y: 0, duration: 0.5, ease: "power3.out" }, "-=0.25")
      .to(rows, { opacity: 1, y: 0, duration: 0.4, stagger: 0.12, ease: "power2.out" }, "-=0.2");
    // Animate genre bar fills
    fills.forEach((fill, i) => {
        const pct = fill.dataset.pct || "0";
        tl.to(fill, { width: pct + "%", duration: 0.8, ease: "power2.out" }, `-=${0.6 - i * 0.05}`);
    });
    return tl;
}

function animateSlide6(slide) {
    const tl = gsap.timeline();
    const bigNum = slide.querySelector(".w-big-number");
    const target = parseInt(bigNum?.dataset.target || "0");
    tl.to(slide.querySelector(".w-label"), { opacity: 1, y: 0, duration: 0.5, ease: "power3.out" })
      .to(bigNum, { opacity: 1, scale: 1, duration: 0.6, ease: "back.out(1.4)" }, "-=0.2");
    if (bigNum) {
        tl.add(() => {
            gsap.to({ val: 0 }, {
                val: target,
                duration: 1.5,
                ease: "power2.out",
                onUpdate: function() { bigNum.textContent = Math.round(this.targets()[0].val); }
            });
        }, "-=0.5");
    }
    tl.to(slide.querySelector(".w-counter-unit"), { opacity: 1, y: 0, duration: 0.4 }, "-=1.0")
      .to(slide.querySelector(".w-subtext"), { opacity: 1, duration: 0.4 }, "-=0.6");
    return tl;
}

function animateSlide7(slide) {
    const tl = gsap.timeline();
    tl.to(slide.querySelector(".w-label"), { opacity: 1, y: 0, duration: 0.5, ease: "power3.out" })
      .to(slide.querySelector(".w-heading"), { opacity: 1, y: 0, duration: 0.5, ease: "power3.out" }, "-=0.25")
      .to(slide.querySelector(".personality-badge"), { opacity: 1, scale: 1, duration: 0.7, ease: "back.out(1.3)" }, "-=0.2");
    return tl;
}

function animateSlide8(slide) {
    const tl = gsap.timeline();
    const cards = slide.querySelectorAll(".w-stat-card");
    tl.to(slide.querySelector(".w-label"), { opacity: 1, y: 0, duration: 0.5, ease: "power3.out" })
      .to(slide.querySelector(".w-heading"), { opacity: 1, y: 0, duration: 0.5, ease: "power3.out" }, "-=0.25")
      .to(cards, { opacity: 1, y: 0, scale: 1, duration: 0.5, stagger: 0.15, ease: "back.out(1.3)" }, "-=0.2")
      .to(slide.querySelector(".w-subtext"), { opacity: 1, duration: 0.4 }, "-=0.2");
    return tl;
}

function animateSlide9(slide) {
    const tl = gsap.timeline();
    tl.to(slide.querySelector(".w-heading"), { opacity: 1, y: 0, duration: 0.5, ease: "power3.out" })
      .to(slide.querySelector(".w-summary-grid"), { opacity: 1, y: 0, duration: 0.6, ease: "power3.out" }, "-=0.2")
      .to(slide.querySelector(".w-save-btn"), { opacity: 1, y: 0, duration: 0.4 }, "-=0.1");
    return tl;
}

const SLIDE_ANIMATORS = [
    animateSlide0, animateSlide1, animateSlide2, animateSlide3, animateSlide4,
    animateSlide5, animateSlide6, animateSlide7, animateSlide8, animateSlide9,
];

async function checkPlayHistoryAndPrompt() {
    let historyData = null;
    try {
        historyData = await invoke("get_history");
    } catch (e) {
        console.error(e);
    }
    
    let hasHistory = false;
    if (historyData) {
        for (const id in historyData) {
            const item = historyData[id];
            if (item && item.play_timestamps && item.play_timestamps.length > 0) {
                hasHistory = true;
                break;
            }
        }
    }
    
    if (hasHistory) {
        return true;
    }
    
    return new Promise((resolve) => {
        const overlay = document.createElement("div");
        overlay.id = "wrapped-history-prompt";
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(8, 6, 16, 0.85);
            backdrop-filter: blur(15px);
            -webkit-backdrop-filter: blur(15px);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 99999;
            font-family: inherit;
            color: var(--fg, #e0e0e0);
        `;
        
        const card = document.createElement("div");
        card.style.cssText = `
            background: var(--bg-card, #1e1e1e);
            border: 2px solid var(--accent, #1db954);
            border-radius: 16px;
            padding: 30px;
            max-width: 450px;
            width: 90%;
            box-shadow: 0 10px 30px rgba(0,0,0,0.6);
            display: flex;
            flex-direction: column;
            gap: 20px;
            text-align: center;
            box-sizing: border-box;
            position: relative;
        `;
        
        card.innerHTML = `
            <div style="font-size: 3.5rem; margin-bottom: 5px; animation: pulse 2s infinite;">🔮</div>
            <h2 style="margin: 0; color: var(--accent, #1db954); font-size: 1.6rem; text-transform: uppercase; letter-spacing: 1px;">Your Music Fate Awaits</h2>
            <p style="margin: 0; font-size: 0.9rem; line-height: 1.6; color: var(--fg-muted, #a0a0a0);">
                You haven't played any tracks yet! Stats & Fate and the Fate Book analyze your listening history to unlock tarot cards and compile your audio story.
            </p>
            <div style="display: flex; flex-direction: column; gap: 10px; margin-top: 10px;">
                <button id="prompt-btn-listen" style="
                    background: var(--accent, #1db954);
                    color: #000;
                    border: none;
                    border-radius: 8px;
                    padding: 12px;
                    font-size: 0.95rem;
                    font-weight: bold;
                    cursor: pointer;
                    transition: transform 0.2s, background-color 0.2s;
                ">Start Listening</button>
                <button id="prompt-btn-demo" style="
                    background: rgba(255, 255, 255, 0.05);
                    color: var(--fg, #e0e0e0);
                    border: 1px solid rgba(255, 255, 255, 0.15);
                    border-radius: 8px;
                    padding: 12px;
                    font-size: 0.95rem;
                    font-weight: bold;
                    cursor: pointer;
                    transition: transform 0.2s, background-color 0.2s;
                ">Explore with Demo Data</button>
                <button id="prompt-btn-cancel" style="
                    background: transparent;
                    color: var(--fg-muted, #a0a0a0);
                    border: none;
                    cursor: pointer;
                    font-size: 0.85rem;
                    margin-top: 5px;
                ">Cancel</button>
            </div>
        `;
        
        overlay.appendChild(card);
        document.body.appendChild(overlay);
        
        const btnListen = card.querySelector("#prompt-btn-listen");
        const btnDemo = card.querySelector("#prompt-btn-demo");
        const btnCancel = card.querySelector("#prompt-btn-cancel");
        
        btnListen.onmouseover = () => { btnListen.style.transform = "scale(1.03)"; btnListen.style.backgroundColor = "color-mix(in srgb, var(--accent) 85%, white)"; };
        btnListen.onmouseout = () => { btnListen.style.transform = "scale(1.0)"; btnListen.style.backgroundColor = "var(--accent)"; };
        
        btnDemo.onmouseover = () => { btnDemo.style.transform = "scale(1.03)"; btnDemo.style.backgroundColor = "rgba(255, 255, 255, 0.1)"; };
        btnDemo.onmouseout = () => { btnDemo.style.transform = "scale(1.0)"; btnDemo.style.backgroundColor = "rgba(255, 255, 255, 0.05)"; };
        
        btnListen.onclick = () => {
            overlay.remove();
            if (typeof window.switchView === "function") {
                window.switchView("search");
                const searchInput = document.getElementById("search-input");
                if (searchInput) searchInput.focus();
            }
            resolve(false);
        };
        
        btnDemo.onclick = () => {
            overlay.remove();
            resolve(true);
        };
        
        btnCancel.onclick = () => {
            overlay.remove();
            resolve(false);
        };
    });
}

// ---- Main Launch Function ----
async function launchStatsAndFate() {
    const launchWrappedBtn = document.getElementById("btn-launch-wrapped");
    let originalText = "Launch Stats & Fate";
    if (launchWrappedBtn) {
        originalText = launchWrappedBtn.textContent;
        launchWrappedBtn.disabled = true;
        launchWrappedBtn.innerHTML = 'Preparing audio story... <span class="icon-svg icon-headphones" style="background-color: var(--accent); font-size: 0.9rem; margin-left: 4px;"></span>';
        launchWrappedBtn.style.opacity = "0.7";
    }

    // 1. Fetch real playback history
    let historyList = [];
    try {
        const historyData = await invoke("get_history");
        if (historyData) {
            for (const id in historyData) {
                const item = historyData[id];
                if (item && item.play_timestamps && item.play_timestamps.length > 0) {
                    historyList.push(item);
                }
            }
        }
    } catch (e) {
        console.error("Failed to fetch play history for Wrapped:", e);
    }

    // 2. Fallback mock data
    let isMockData = false;
    if (historyList.length === 0) {
        const launchDemo = await checkPlayHistoryAndPrompt();
        if (!launchDemo) {
            if (launchWrappedBtn) {
                launchWrappedBtn.disabled = false;
                launchWrappedBtn.innerHTML = originalText;
                launchWrappedBtn.style.opacity = "1";
            }
            return;
        }
        isMockData = true;
        historyList = [
            { title: "Blinding Lights", artist: "The Weeknd", album: "After Hours", duration_secs: 200, play_timestamps: [1716180000, 1716183600, 1716187200, 1716190800, 1716194400, 1716198000, 1716201600, 1716205200, 1716208800, 1716212400, 1716216000, 1716219600], image: "" },
            { title: "Starboy", artist: "The Weeknd", album: "Starboy", duration_secs: 230, play_timestamps: [1716180000, 1716183600, 1716187200, 1716190800, 1716194400, 1716198000, 1716201600, 1716205200], image: "" },
            { title: "Bad Habits", artist: "Ed Sheeran", album: "=", duration_secs: 231, play_timestamps: [1716180000, 1716183600, 1716187200, 1716190800, 1716194400, 1716198000, 1716201600], image: "" },
            { title: "Stay", artist: "Kid LAROI & Justin Bieber", album: "F*CK LOVE 3", duration_secs: 141, play_timestamps: [1716180000, 1716183600, 1716187200, 1716190800, 1716194400, 1716198000], image: "" },
            { title: "Levitating", artist: "Dua Lipa", album: "Future Nostalgia", duration_secs: 203, play_timestamps: [1716180000, 1716183600, 1716187200, 1716190800, 1716194400], image: "" },
            { title: "As It Was", artist: "Harry Styles", album: "Harry's House", duration_secs: 167, play_timestamps: [1716180000, 1716183600, 1716187200, 1716190800], image: "" },
            { title: "Sweater Weather", artist: "The Neighbourhood", album: "I Love You.", duration_secs: 240, play_timestamps: [1716180000, 1716183600, 1716187200], image: "" },
            { title: "Stressed Out", artist: "Twenty One Pilots", album: "Blurryface", duration_secs: 202, play_timestamps: [1716180000, 1716183600], image: "" },
        ];
    }

    // 3. Calculate metrics
    let totalPlays = 0, uniqueTracks = historyList.length, artistMap = new Map(), playCountsMap = [], oldestListen = null, totalDurationSecs = 0;

    historyList.forEach((track) => {
        const count = track.play_timestamps.length;
        totalPlays += count;
        totalDurationSecs += count * (track.duration_secs || 210);
        artistMap.set(track.artist, (artistMap.get(track.artist) || 0) + count);
        playCountsMap.push({ track, count });
        const earliestTime = Math.min(...track.play_timestamps);
        if (oldestListen === null || earliestTime < oldestListen.time) {
            oldestListen = { track, time: earliestTime };
        }
    });

    playCountsMap.sort((a, b) => b.count - a.count);
    const topTrack = playCountsMap[0]?.track || null;
    const topTrackCount = playCountsMap[0]?.count || 0;
    const sortedArtists = [...artistMap.entries()].sort((a, b) => b[1] - a[1]);
    const topArtists = sortedArtists.slice(0, 5);
    const artistGenres = {
        "the weeknd": ["R&B", "Synth-Pop", "Pop"],
        "taylor swift": ["Pop", "Folk", "Indie"],
        "ed sheeran": ["Pop", "Acoustic", "Singer-Songwriter"],
        "dua lipa": ["Pop", "Dance", "Disco"],
        "harry styles": ["Pop Rock", "Indie Pop"],
        "billie eilish": ["Alt-Pop", "Electronic", "Indie"],
        "fitterkarma": ["Indie/OPM", "Alt-Pop", "Synth-Pop"],
        "yorushika": ["J-Pop", "J-Rock", "Indie Rock"],
        "daniel caesar": ["R&B", "Soul", "Neo-Soul"],
        "kid laroi": ["Pop Rap", "R&B"],
        "justin bieber": ["Pop", "R&B"],
        "the neighbourhood": ["Alt-Rock", "Indie Rock"],
        "twenty one pilots": ["Alt-Rock", "Indie Pop", "Hip-Hop"]
    };

    const genreCounts = {};
    historyList.forEach((track) => {
        const count = track.play_timestamps.length;
        const artistKey = String(track.artist || "").toLowerCase().trim();
        
        let genresForTrack = ["Pop"];
        let found = false;
        for (const [key, val] of Object.entries(artistGenres)) {
            if (artistKey.includes(key) || key.includes(artistKey)) {
                genresForTrack = val;
                found = true;
                break;
            }
        }
        
        if (!found) {
            const hash = artistKey.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
            const fallbackPool = [
                ["Indie", "Acoustic", "Alt-Pop"],
                ["Pop Rock", "Alt-Rock", "Indie Rock"],
                ["R&B", "Soul", "Lo-Fi"],
                ["Electronic", "Dance", "Synth-Pop"],
                ["Soundtrack", "Classical", "Ambient"],
                ["J-Pop", "Anime", "Pop"]
            ];
            genresForTrack = fallbackPool[hash % fallbackPool.length];
        }
        
        genresForTrack.forEach((g) => {
            genreCounts[g] = (genreCounts[g] || 0) + count;
        });
    });

    const totalGenrePlays = Object.values(genreCounts).reduce((a, b) => a + b, 0);
    const sortedGenres = Object.entries(genreCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4);

    const colors = ["#1db954", "#9b59b6", "#e74c3c", "#3498db"];
    const genres = sortedGenres.map(([name, count], idx) => {
        const percentage = totalGenrePlays > 0 ? Math.round((count / totalGenrePlays) * 100) : 25;
        return {
            name,
            percentage,
            color: colors[idx % colors.length]
        };
    });
    const minutesListened = Math.round(totalDurationSecs / 60);
    const hoursListened = (totalDurationSecs / 3600).toFixed(1);

    // Calculate time slots and track duration stats
    let morningPlays = 0, afternoonPlays = 0, eveningPlays = 0, nightPlays = 0;
    let trackDurations = [];

    historyList.forEach((track) => {
        const count = track.play_timestamps.length;
        const dur = track.duration_secs || track.duration || 210;
        for (let i = 0; i < count; i++) {
            trackDurations.push(dur);
        }
        track.play_timestamps.forEach((ts) => {
            const date = new Date(ts * 1000);
            const hr = date.getHours();
            if (hr >= 6 && hr < 12) morningPlays++;
            else if (hr >= 12 && hr < 18) afternoonPlays++;
            else if (hr >= 18 && hr < 24) eveningPlays++;
            else nightPlays++;
        });
    });

    const averageTrackDuration = trackDurations.length > 0 ? (trackDurations.reduce((a,b) => a+b, 0) / trackDurations.length) : 0;
    
    let durationVarianceScore = 0;
    if (trackDurations.length > 1) {
        const variance = trackDurations.reduce((acc, d) => acc + Math.pow(d - averageTrackDuration, 2), 0) / trackDurations.length;
        const stdDev = Math.sqrt(variance);
        durationVarianceScore = Math.min(100, Math.round((stdDev / 120) * 100));
    }

    const oldestTrackId = oldestListen?.track?.id;
    const firstTrackPlayedCount = oldestTrackId ? (historyList.find(t => t.id === oldestTrackId)?.play_timestamps.length || 0) : 0;

    let tasteShiftDetected = false;
    let flatPlays = [];
    historyList.forEach(track => {
        track.play_timestamps.forEach(ts => {
            flatPlays.push({ artist: track.artist, ts });
        });
    });
    if (flatPlays.length >= 8) {
        flatPlays.sort((a, b) => a.ts - b.ts);
        const mid = Math.floor(flatPlays.length / 2);
        const firstHalf = flatPlays.slice(0, mid);
        const secondHalf = flatPlays.slice(mid);

        const firstHalfMap = new Map();
        firstHalf.forEach(p => firstHalfMap.set(p.artist, (firstHalfMap.get(p.artist) || 0) + 1));
        const firstHalfTop = [...firstHalfMap.entries()].sort((a,b) => b[1] - a[1])[0]?.[0];

        const secondHalfMap = new Map();
        secondHalf.forEach(p => secondHalfMap.set(p.artist, (secondHalfMap.get(p.artist) || 0) + 1));
        const secondHalfTop = [...secondHalfMap.entries()].sort((a,b) => b[1] - a[1])[0]?.[0];

        if (firstHalfTop && secondHalfTop && firstHalfTop !== secondHalfTop) {
            tasteShiftDetected = true;
        }
    }

    const stats = {
        totalPlays,
        uniqueTracks,
        uniqueArtists: artistMap.size,
        ratio: uniqueTracks > 0 ? (totalPlays / uniqueTracks) : 0,
        topTrackCount,
        topArtistPlays: topArtists[0] ? topArtists[0][1] : 0,
        secondArtistPlays: topArtists[1] ? topArtists[1][1] : 0,
        hoursListened: parseFloat(hoursListened),
        minutesListened,
        averageTrackDuration,
        morningPlays,
        afternoonPlays,
        eveningPlays,
        nightPlays,
        firstTrackPlayedCount,
        tasteShiftDetected,
        durationVarianceScore
    };

    const { unlockedCards: unlockedCardsData } = evaluateUnlockedCards(stats);
    const unlockedIds = unlockedCardsData.map(c => c.id);

    const hour = new Date().getHours();
    let greet = "Good evening";
    if (hour < 12) greet = "Good morning";
    else if (hour < 18) greet = "Good afternoon";
    const defaultImg = "";

    // 3.5 Pre-cache the audio highlight clips for featured songs (before building UI/overlay)
    const prefetchPromises = [];
    if (oldestListen && oldestListen.track) {
        prefetchPromises.push(preloadWrappedSong(oldestListen.track, "firstPlay"));
    }
    if (topTrack) {
        prefetchPromises.push(preloadWrappedSong(topTrack, "topTrack"));
    }
    try {
        await Promise.all(prefetchPromises);
    } catch (err) {
        console.warn("Error buffering wrapped song highlights:", err);
    }

    // 4. Build all 10 slides
    const slidesContainer = document.getElementById("wrapped-slides");
    if (!slidesContainer) {
        if (launchWrappedBtn) {
            launchWrappedBtn.disabled = false;
            launchWrappedBtn.textContent = originalText;
            launchWrappedBtn.style.opacity = "1";
        }
        return;
    }

    const slidesHTML = [
        buildSlide0(greet),
        buildSlide1(totalPlays),
        buildSlide2(oldestListen, defaultImg),
        buildSlide3(topTrack, topTrackCount, defaultImg),
        buildSlide4(topArtists),
        buildSlide5(genres),
        buildSlide6(hoursListened, minutesListened),
        buildSlide7(unlockedIds.length, unlockedCardsData),
        buildSlide8(uniqueTracks, artistMap.size),
        buildSlide9(topTrack, topArtists, totalPlays, minutesListened, uniqueTracks, unlockedIds.length, isMockData, defaultImg),
    ];
    slidesContainer.innerHTML = slidesHTML.join("");

    // 5. Setup progress indicators
    const indicatorsWrap = document.getElementById("wrapped-story-indicators");
    if (indicatorsWrap) {
        indicatorsWrap.innerHTML = "";
        for (let i = 0; i < 10; i++) {
            const seg = document.createElement("div");
            seg.className = "indicator-segment";
            seg.innerHTML = `<div class="indicator-fill" id="wrapped-ind-fill-${i}"></div>`;
            indicatorsWrap.appendChild(seg);
        }
    }

    // 6. Open overlay with GSAP entrance
    const overlay = document.getElementById("wrapped-overlay");
    const card = overlay?.querySelector(".wrapped-card");
    if (overlay) {
        overlay.classList.remove("hidden");
        gsap.fromTo(overlay, { opacity: 0 }, { opacity: 1, duration: 0.4, ease: "power2.out" });
        if (card) {
            gsap.fromTo(card, { scale: 0.9, y: 30, opacity: 0 }, { scale: 1, y: 0, opacity: 1, duration: 0.6, ease: "back.out(1.4)", delay: 0.1 });
        }
    }

    // 7. Start particles
    initWrappedParticles();

    // 8. Show first slide
    wrappedSlideIndex = 0;
    showWrappedSlide(0);

    if (launchWrappedBtn) {
        launchWrappedBtn.disabled = false;
        launchWrappedBtn.textContent = originalText;
        launchWrappedBtn.style.opacity = "1";
    }
}

// ---- Slide Transition Engine ----

function showWrappedSlide(index) {
    if (index < 0 || index >= 10) return;
    const prevIndex = wrappedSlideIndex;
    wrappedSlideIndex = index;

    // Morph background
    morphMeshBg(index);

    // Play or pause audios based on slide index (autoplay highlights)
    if (index === 2) {
        playWrappedAudio("firstPlay");
    } else if (index === 3 || index === 9) {
        playWrappedAudio("topTrack");
    } else {
        stopWrappedAudio();
    }

    // Kill any active GSAP timeline from previous slide
    if (wrappedActiveTL) {
        wrappedActiveTL.kill();
        wrappedActiveTL = null;
    }

    const slides = document.querySelectorAll(".wrapped-slide");
    
    // Animate out previous slide
    if (slides[prevIndex] && prevIndex !== index) {
        const dir = index > prevIndex ? -1 : 1;
        gsap.to(slides[prevIndex], {
            opacity: 0,
            x: dir * 40,
            scale: 0.95,
            duration: 0.35,
            ease: "power2.in",
            onComplete: () => {
                slides[prevIndex].classList.remove("active");
                gsap.set(slides[prevIndex], { x: 0, scale: 1 });
            }
        });
    }

    // Animate in new slide
    const newSlide = slides[index];
    if (newSlide) {
        newSlide.classList.add("active");
        const dir = index > prevIndex ? 1 : -1;
        gsap.fromTo(newSlide,
            { opacity: 0, x: dir * 50, scale: 0.97 },
            { opacity: 1, x: 0, scale: 1, duration: 0.5, ease: "power3.out", delay: 0.15,
              onComplete: () => {
                  // Run per-slide GSAP animation
                  if (SLIDE_ANIMATORS[index]) {
                      wrappedActiveTL = SLIDE_ANIMATORS[index](newSlide);
                  }
              }
            }
        );
    }

    // Update indicators
    for (let i = 0; i < 10; i++) {
        const seg = document.querySelectorAll(".indicator-segment")[i];
        const fill = document.getElementById(`wrapped-ind-fill-${i}`);
        if (seg && fill) {
            if (i < index) {
                seg.classList.add("completed");
                fill.style.width = "100%";
            } else {
                seg.classList.remove("completed");
                fill.style.width = "0%";
            }
        }
    }

    startWrappedTimer();
}

function startWrappedTimer() {
    if (wrappedTimer) clearInterval(wrappedTimer);
    wrappedTimerStart = Date.now();
    wrappedTimerElapsed = 0;
    wrappedIsPaused = false;

    const fill = document.getElementById(`wrapped-ind-fill-${wrappedSlideIndex}`);

    wrappedTimer = setInterval(() => {
        if (!wrappedIsPaused) {
            wrappedTimerElapsed += 50;
            const pct = Math.min((wrappedTimerElapsed / SLIDE_DURATION) * 100, 100);
            if (fill) fill.style.width = `${pct}%`;
            if (wrappedTimerElapsed >= SLIDE_DURATION) {
                clearInterval(wrappedTimer);
                nextWrappedSlide();
            }
        }
    }, 50);
}

function nextWrappedSlide() {
    if (wrappedSlideIndex < 9) {
        showWrappedSlide(wrappedSlideIndex + 1);
    } else {
        closeWrappedOverlay();
    }
}

function prevWrappedSlide() {
    if (wrappedSlideIndex > 0) {
        showWrappedSlide(wrappedSlideIndex - 1);
    }
}

function pauseWrappedTimer() {
    wrappedIsPaused = true;
}

function resumeWrappedTimer() {
    wrappedIsPaused = false;
    wrappedTimerStart = Date.now() - wrappedTimerElapsed;
}

function closeWrappedOverlay() {
    if (wrappedTimer) clearInterval(wrappedTimer);
    if (wrappedActiveTL) { wrappedActiveTL.kill(); wrappedActiveTL = null; }
    stopWrappedParticles();
    stopWrappedAudio();

    const overlay = document.getElementById("wrapped-overlay");
    const card = overlay?.querySelector(".wrapped-card");
    if (card) {
        gsap.to(card, { scale: 0.9, y: 20, opacity: 0, duration: 0.3, ease: "power2.in" });
    }
    gsap.to(overlay, {
        opacity: 0, duration: 0.35, delay: 0.1, ease: "power2.in",
        onComplete: () => { if (overlay) overlay.classList.add("hidden"); }
    });
}

// ---- Bind Navigation Events ----
async function exportWrappedSlidesToZip() {
    const exportBtn = document.getElementById("wrapped-btn-export");
    if (!exportBtn) return;
    
    const originalText = exportBtn.innerHTML;
    exportBtn.disabled = true;
    exportBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation: spin 1.5s linear infinite;"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Preparing...`;
    
    // Pause timer
    const wasPaused = wrappedIsPaused;
    wrappedIsPaused = true;
    
    try {
        const slides = document.querySelectorAll(".wrapped-slide");
        if (slides.length === 0) throw new Error("No slides found");
        
        if (!window.JSZip) {
            throw new Error("JSZip library is not loaded. Check internet connection.");
        }
        if (!window.html2canvas) {
            throw new Error("html2canvas library is not loaded. Check internet connection.");
        }
        
        const zip = new window.JSZip();
        const originalIndex = wrappedSlideIndex;
        
        // Save original styles
        const originalStyles = Array.from(slides).map(s => ({
            display: s.style.display,
            visibility: s.style.visibility,
            opacity: s.style.opacity,
            transform: s.style.transform
        }));

        for (let i = 0; i < slides.length; i++) {
            exportBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation: spin 1.5s linear infinite;"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Slide ${i + 1}/10`;
            const slide = slides[i];
            
            // Hide all slides
            slides.forEach(s => {
                s.style.display = "none";
                s.style.visibility = "hidden";
                s.style.opacity = "0";
            });
            
            // Show current slide
            slide.style.display = "flex";
            slide.style.visibility = "visible";
            slide.style.opacity = "1";
            slide.style.transform = "none";
            
            // Force animations to finish for the snapshot
            let tempTL = null;
            if (SLIDE_ANIMATORS[i]) {
                try {
                    tempTL = SLIDE_ANIMATORS[i](slide);
                    if (tempTL && typeof tempTL.progress === 'function') {
                        tempTL.progress(1);
                    }
                } catch (tlErr) {
                    console.warn("GSAP settle error:", tlErr);
                }
            }
            
            // Wait a brief frame for DOM updates
            await new Promise(resolve => setTimeout(resolve, 150));
            
            // Capture canvas
            const canvas = await window.html2canvas(slide, {
                backgroundColor: "#08070a",
                scale: 2, // High resolution
                logging: false,
                useCORS: true
            });
            
            // Clean up temporary timeline
            if (tempTL) {
                tempTL.kill();
            }
            
            const dataUrl = canvas.toDataURL("image/png");
            const base64Data = dataUrl.split(',')[1];
            zip.file(`slide-${i + 1}.png`, base64Data, { base64: true });
        }
        
        exportBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation: spin 1.5s linear infinite;"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> ZIP...`;
        const zipContent = await zip.generateAsync({ type: "uint8array" });
        
        // Restore slides to original state
        slides.forEach((s, idx) => {
            s.style.display = originalStyles[idx].display;
            s.style.visibility = originalStyles[idx].visibility;
            s.style.opacity = originalStyles[idx].opacity;
            s.style.transform = originalStyles[idx].transform;
        });
        
        // Restore active slide GSAP timeline & show slide
        showWrappedSlide(originalIndex);
        wrappedIsPaused = wasPaused;
        
        // Invoke Rust to select file path and save
        await invoke("save_zip_file", {
            filename: "wrapped-slides.zip",
            bytes: Array.from(zipContent)
        });
        
        alert("Wrapped slides exported successfully!");
    } catch (err) {
        console.error("Failed to export slides:", err);
        alert(`Failed to export slides to ZIP: ${err.message}`);
    } finally {
        exportBtn.disabled = false;
        exportBtn.innerHTML = originalText;
    }
}

function initWrappedOverlayEvents() {
    const prevTap = document.getElementById("wrapped-prev-tap");
    const nextTap = document.getElementById("wrapped-next-tap");
    const btnPrev = document.getElementById("wrapped-btn-prev");
    const btnNext = document.getElementById("wrapped-btn-next");
    const exportBtn = document.getElementById("wrapped-btn-export");
    const closeBtn = document.getElementById("wrapped-close-btn");
    const shareBtn = document.getElementById("wrapped-btn-share");
    const overlay = document.getElementById("wrapped-overlay");

    const setupPrev = (el) => {
        if (!el) return;
        el.addEventListener("click", (e) => { e.stopPropagation(); prevWrappedSlide(); });
        el.addEventListener("mousedown", pauseWrappedTimer);
        el.addEventListener("mouseup", resumeWrappedTimer);
        el.addEventListener("touchstart", pauseWrappedTimer);
        el.addEventListener("touchend", resumeWrappedTimer);
    };

    const setupNext = (el) => {
        if (!el) return;
        el.addEventListener("click", (e) => { e.stopPropagation(); nextWrappedSlide(); });
        el.addEventListener("mousedown", pauseWrappedTimer);
        el.addEventListener("mouseup", resumeWrappedTimer);
        el.addEventListener("touchstart", pauseWrappedTimer);
        el.addEventListener("touchend", resumeWrappedTimer);
    };

    setupPrev(prevTap);
    setupPrev(btnPrev);
    setupNext(nextTap);
    setupNext(btnNext);

    if (closeBtn) {
        closeBtn.addEventListener("click", (e) => { e.stopPropagation(); closeWrappedOverlay(); });
    }

    if (exportBtn) {
        exportBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            exportWrappedSlidesToZip();
        });
    }

    if (shareBtn) {
        shareBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            const shareText = `🎧 My Spoti-Tauri Stats & Fate is here! ${wrappedSlideIndex + 1}/10 chapters of my listening story unlocked. Check it out!`;
            navigator.clipboard.writeText(shareText).then(() => {
                alert("Stats & Fate summary copied to clipboard!");
            }).catch(err => {
                console.error("Clipboard error:", err);
                alert("Copied: " + shareText);
            });
        });
    }

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            if (overlay && !overlay.classList.contains("hidden")) {
                closeWrappedOverlay();
            }
        }
    });
}

// Initialize when DOM is ready
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initWrappedOverlayEvents);
} else {
    initWrappedOverlayEvents();
}

// Global delegated click listener for Stats & Fate action buttons
document.addEventListener("click", (e) => {
    try {
        const tarotBtn = e.target.closest("#btn-view-tarot-collection");
        if (tarotBtn) {
            e.preventDefault();
            e.stopPropagation();
            console.log("[Fate Book] Click detected on #btn-view-tarot-collection");
            openTarotCollection().catch(err => {
                alert("[Fate Book Click Catch] Error: " + (err.stack || err));
            });
            return;
        }

        const launchBtn = e.target.closest("#btn-launch-wrapped");
        if (launchBtn) {
            e.preventDefault();
            e.stopPropagation();
            console.log("[Stats & Fate] Click detected on #btn-launch-wrapped");
            launchStatsAndFate().catch(err => {
                alert("[Launch Stats & Fate Catch] Error: " + (err.stack || err));
            });
        }
    } catch (err) {
        alert("[Delegated Click Error] " + (err.stack || err));
    }
});

// ---- Tarot Card Collection (Fate Book) Logic ----

async function getTarotStats() {
    let historyList = [];
    try {
        const historyData = await invoke("get_history");
        if (historyData) {
            for (const id in historyData) {
                const item = historyData[id];
                if (item && item.play_timestamps && item.play_timestamps.length > 0) {
                    historyList.push(item);
                }
            }
        }
    } catch (e) {
        console.error("Failed to fetch play history for Tarot:", e);
    }

    // Fallback mock data if empty (just to show cards in empty states)
    if (historyList.length === 0) {
        historyList = [
            { id: "mock1", title: "Blinding Lights", artist: "The Weeknd", album: "After Hours", duration_secs: 200, play_timestamps: [1716180000, 1716183600, 1716187200], image: "" },
            { id: "mock2", title: "Starboy", artist: "The Weeknd", album: "Starboy", duration_secs: 230, play_timestamps: [1716180000], image: "" }
        ];
    }

    // Compute basic metrics
    let totalPlays = 0, uniqueTracks = historyList.length, artistMap = new Map(), playCountsMap = [], oldestListen = null, totalDurationSecs = 0;

    historyList.forEach((track) => {
        const count = track.play_timestamps.length;
        totalPlays += count;
        totalDurationSecs += count * (track.duration_secs || 210);
        artistMap.set(track.artist, (artistMap.get(track.artist) || 0) + count);
        playCountsMap.push({ track, count });
        const earliestTime = Math.min(...track.play_timestamps);
        if (oldestListen === null || earliestTime < oldestListen.time) {
            oldestListen = { track, time: earliestTime };
        }
    });

    playCountsMap.sort((a, b) => b.count - a.count);
    const topTrack = playCountsMap[0]?.track || null;
    const topTrackCount = playCountsMap[0]?.count || 0;
    const sortedArtists = [...artistMap.entries()].sort((a, b) => b[1] - a[1]);
    const topArtists = sortedArtists.slice(0, 5);
    const minutesListened = Math.round(totalDurationSecs / 60);
    const hoursListened = (totalDurationSecs / 3600).toFixed(1);

    // Compute time slots
    let morningPlays = 0, afternoonPlays = 0, eveningPlays = 0, nightPlays = 0;
    let trackDurations = [];

    historyList.forEach((track) => {
        const count = track.play_timestamps.length;
        const dur = track.duration_secs || track.duration || 210;
        for (let i = 0; i < count; i++) {
            trackDurations.push(dur);
        }
        track.play_timestamps.forEach((ts) => {
            const date = new Date(ts * 1000);
            const hour = date.getHours();
            if (hour >= 6 && hour < 12) morningPlays++;
            else if (hour >= 12 && hour < 18) afternoonPlays++;
            else if (hour >= 18 && hour < 24) eveningPlays++;
            else nightPlays++;
        });
    });

    const averageTrackDuration = trackDurations.length > 0 ? (trackDurations.reduce((a,b) => a+b, 0) / trackDurations.length) : 0;
    
    let durationVarianceScore = 0;
    if (trackDurations.length > 1) {
        const variance = trackDurations.reduce((acc, d) => acc + Math.pow(d - averageTrackDuration, 2), 0) / trackDurations.length;
        const stdDev = Math.sqrt(variance);
        durationVarianceScore = Math.min(100, Math.round((stdDev / 120) * 100));
    }

    const oldestTrackId = oldestListen?.track?.id;
    const firstTrackPlayedCount = oldestTrackId ? (historyList.find(t => t.id === oldestTrackId)?.play_timestamps.length || 0) : 0;

    let tasteShiftDetected = false;
    let flatPlays = [];
    historyList.forEach(track => {
        track.play_timestamps.forEach(ts => {
            flatPlays.push({ artist: track.artist, ts });
        });
    });
    if (flatPlays.length >= 8) {
        flatPlays.sort((a, b) => a.ts - b.ts);
        const mid = Math.floor(flatPlays.length / 2);
        const firstHalf = flatPlays.slice(0, mid);
        const secondHalf = flatPlays.slice(mid);

        const firstHalfMap = new Map();
        firstHalf.forEach(p => firstHalfMap.set(p.artist, (firstHalfMap.get(p.artist) || 0) + 1));
        const firstHalfTop = [...firstHalfMap.entries()].sort((a,b) => b[1] - a[1])[0]?.[0];

        const secondHalfMap = new Map();
        secondHalf.forEach(p => secondHalfMap.set(p.artist, (secondHalfMap.get(p.artist) || 0) + 1));
        const secondHalfTop = [...secondHalfMap.entries()].sort((a,b) => b[1] - a[1])[0]?.[0];

        if (firstHalfTop && secondHalfTop && firstHalfTop !== secondHalfTop) {
            tasteShiftDetected = true;
        }
    }

    return {
        totalPlays,
        uniqueTracks,
        uniqueArtists: artistMap.size,
        ratio: uniqueTracks > 0 ? (totalPlays / uniqueTracks) : 0,
        topTrackCount,
        topArtistPlays: topArtists[0] ? topArtists[0][1] : 0,
        secondArtistPlays: topArtists[1] ? topArtists[1][1] : 0,
        hoursListened: parseFloat(hoursListened),
        minutesListened,
        averageTrackDuration,
        morningPlays,
        afternoonPlays,
        eveningPlays,
        nightPlays,
        firstTrackPlayedCount,
        tasteShiftDetected,
        durationVarianceScore
    };
}

async function openTarotCollection() {
    try {
        console.log("[Fate Book] openTarotCollection starting");
        const modal = document.getElementById("tarot-collection-modal");
        if (!modal) {
            alert("[Fate Book Error] Element 'tarot-collection-modal' not found in DOM!");
            return;
        }

        // Check if user has real history
        let historyData = null;
        try {
            historyData = await invoke("get_history");
        } catch (e) {
            console.error(e);
        }
        
        let hasHistory = false;
        if (historyData) {
            for (const id in historyData) {
                const item = historyData[id];
                if (item && item.play_timestamps && item.play_timestamps.length > 0) {
                    hasHistory = true;
                    break;
                }
            }
        }

        if (!hasHistory) {
            const exploreDemo = await checkPlayHistoryAndPrompt();
            if (!exploreDemo) {
                return; // User canceled or chose to listen
            }
        }

        modal.classList.remove("hidden");
        console.log("[Fate Book] Removed hidden class from modal");

        // Fetch stats and evaluate
        const stats = await getTarotStats();
        console.log("[Fate Book] Stats fetched successfully:", stats);

        const { unlockedCards } = evaluateUnlockedCards(stats);
        console.log("[Fate Book] Cards evaluated:", unlockedCards);
        const unlockedIds = unlockedCards.map(c => c.id);

        // Update unlocked count text
        const countSpan = document.getElementById("tarot-unlocked-count");
        if (countSpan) {
            countSpan.textContent = `${unlockedIds.length} / 22`;
        }

        // Render grid
        renderTarotGrid(unlockedIds);
        console.log("[Fate Book] Rendered grid with cards:", unlockedIds);
    } catch (err) {
        alert("[openTarotCollection Error] " + (err.stack || err));
        console.error("[Fate Book Error]", err);
    }
}

function renderTarotGrid(unlockedIds) {
    const gridContainer = document.getElementById("tarot-grid-container");
    if (!gridContainer) return;
    gridContainer.innerHTML = "";

    TAROT_PROFILES.forEach((card) => {
        const isUnlocked = unlockedIds.includes(card.id);
        const cardSlot = document.createElement("div");
        cardSlot.className = "tarot-grid-slot";
        cardSlot.style.cssText = `
            border: 2px solid ${isUnlocked ? "#6e5eac" : "#2a2244"};
            background: ${isUnlocked ? "rgba(110, 94, 172, 0.1)" : "rgba(0, 0, 0, 0.4)"};
            border-radius: 4px;
            padding: 8px;
            text-align: center;
            cursor: pointer;
            transition: transform 0.2s, border-color 0.2s;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 6px;
        `;
        
        // Hover effects
        cardSlot.onmouseover = () => {
            cardSlot.style.transform = "scale(1.05)";
            cardSlot.style.borderColor = isUnlocked ? "#ffb86c" : "#4a3e7a";
        };
        cardSlot.onmouseout = () => {
            cardSlot.style.transform = "scale(1.0)";
            cardSlot.style.borderColor = isUnlocked ? "#6e5eac" : "#2a2244";
        };

        const imageSrc = isUnlocked 
            ? `/assets/tarot/${card.folder}/${card.file}` 
            : `/assets/tarot/_cardBack/_cardBack_5x.png`;

        cardSlot.innerHTML = `
            <img src="${imageSrc}" style="
                width: 100%;
                aspect-ratio: 2/3.5;
                object-fit: cover;
                border: 1px solid ${isUnlocked ? "#4a3e7a" : "#201a35"};
                border-radius: 2px;
                filter: ${isUnlocked ? "none" : "brightness(0.4) sepia(0.6) hue-rotate(250deg)"};
            " />
            <div style="
                font-family: monospace;
                font-size: 0.72rem;
                font-weight: bold;
                color: ${isUnlocked ? "#ffb86c" : "#6272a4"};
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                width: 100%;
            ">
                ${isUnlocked ? card.name : `#${card.id} ???`}
            </div>
        `;

        cardSlot.addEventListener("click", () => {
            showTarotCardDetails(card, isUnlocked);
        });

        gridContainer.appendChild(cardSlot);
    });
}

function showTarotCardDetails(card, isUnlocked) {
    const detailPanel = document.getElementById("tarot-detail-panel");
    if (!detailPanel) return;

    if (!isUnlocked) {
        detailPanel.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: center; gap: 12px; font-family: monospace; height: 100%;">
                <div style="
                    border: 3px solid #ff5555;
                    border-radius: 4px;
                    padding: 4px;
                    background: #201324;
                    width: 130px;
                ">
                    <img src="/assets/tarot/_cardBack/_cardBack_5x.png" style="
                        width: 100%;
                        aspect-ratio: 2/3.5;
                        object-fit: cover;
                        filter: brightness(0.3) sepia(0.8) hue-rotate(300deg);
                    " />
                </div>
                <div style="text-align: center; width: 100%;">
                    <span style="background: #ff5555; color: #fff; font-size: 0.65rem; font-weight: bold; padding: 2px 8px; border-radius: 10px; border: 1px solid #000;">LOCKED QUEST</span>
                    <h3 style="color: #6272a4; margin: 10px 0 4px 0; font-size: 1.1rem; text-transform: uppercase;">Card #${card.id}</h3>
                    <p style="color: #ff5555; font-size: 0.8rem; font-weight: bold; margin: 0 0 10px 0;">"${card.mysticTitle || 'Unknown Fate'}"</p>
                </div>
                
                <div style="border-top: 1px dashed #4a3e7a; padding-top: 12px; width: 100%;">
                    <h4 style="color: #ffb86c; margin: 0 0 6px 0; font-size: 0.85rem; text-transform: uppercase;">QUEST REQUIREMENT</h4>
                    <p style="color: #f8f8f2; font-size: 0.8rem; line-height: 1.4; margin: 0;">${card.questDescription}</p>
                </div>

                <div style="margin-top: auto; border: 1px solid #4a3e7a; background: rgba(0,0,0,0.3); padding: 10px; border-radius: 4px; text-align: center; width: 100%; box-sizing: border-box;">
                    <p style="color: #6272a4; font-size: 0.72rem; margin: 0; line-height: 1.3;">Keep listening to your local audio tracks in Spoti-Tauri to fulfill this destiny card!</p>
                </div>
            </div>
        `;
        return;
    }

    const statsHTML = Object.entries(card.gamingStats).map(([key, val]) => {
        const barColor = key === 'tempo' ? '#ff5555' : key === 'variety' ? '#50fa7b' : key === 'obscurity' ? '#8be9fd' : '#ff79c6';
        return `
            <div style="margin-bottom: 6px;">
                <div style="display: flex; justify-content: space-between; font-size: 0.75rem; color: #f8f8f2; text-transform: uppercase; margin-bottom: 2px;">
                    <span>${key}</span>
                    <span style="color: ${barColor}">${val}</span>
                </div>
                <div style="height: 6px; background: rgba(0, 0, 0, 0.4); border-radius: 3px; overflow: hidden; border: 1px solid #201a35;">
                    <div style="width: ${val}%; height: 100%; background: ${barColor};"></div>
                </div>
            </div>
        `;
    }).join("");

    detailPanel.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 14px; font-family: monospace;">
            <div style="align-self: center; display: flex; flex-direction: column; align-items: center; gap: 8px;">
                <div style="
                    border: 3px solid #ffb86c;
                    border-radius: 4px;
                    padding: 4px;
                    background: #1c183a;
                    width: 120px;
                    box-shadow: 0 0 15px rgba(255, 184, 108, 0.2);
                ">
                    <img src="/assets/tarot/${card.folder}/${card.file}" style="
                        width: 100%;
                        aspect-ratio: 2/3.5;
                        object-fit: cover;
                    " />
                </div>
                <span style="background: #50fa7b; color: #000; font-size: 0.65rem; font-weight: 700; padding: 2px 8px; border-radius: 10px; border: 1px solid #000; text-transform: uppercase;">UNLOCKED</span>
            </div>

            <div style="text-align: center;">
                <h3 style="color: #ffb86c; margin: 0 0 2px 0; font-size: 1.15rem;">${card.name}</h3>
                <p style="color: #8be9fd; font-size: 0.75rem; margin: 0; font-style: italic; text-transform: uppercase;">"${card.mysticTitle}"</p>
            </div>

            <div style="border-top: 1px dashed #4a3e7a; padding-top: 10px;">
                <h4 style="color: #ff79c6; margin: 0 0 8px 0; font-size: 0.8rem; text-transform: uppercase;">Attributes</h4>
                ${statsHTML}
            </div>

            <div style="border-top: 1px dashed #4a3e7a; padding-top: 10px; display: flex; flex-direction: column; gap: 8px;">
                <div>
                    <h4 style="color: #50fa7b; margin: 0 0 2px 0; font-size: 0.8rem; text-transform: uppercase;">▲ Upright Vibe</h4>
                    <p style="color: #f8f8f2; font-size: 0.75rem; line-height: 1.35; margin: 0;">${card.uprightMeaning}</p>
                </div>
                <div>
                    <h4 style="color: #ff5555; margin: 0 0 2px 0; font-size: 0.8rem; text-transform: uppercase;">▼ Reversed Warning</h4>
                    <p style="color: #f8f8f2; font-size: 0.75rem; line-height: 1.35; margin: 0;">${card.reversedMeaning}</p>
                </div>
            </div>

            <div style="border-top: 1px dashed #4a3e7a; padding-top: 10px; background: rgba(0,0,0,0.25); padding: 8px; border-radius: 4px;">
                <h4 style="color: #bd93f9; margin: 0 0 4px 0; font-size: 0.75rem; text-transform: uppercase;">Quest Lore</h4>
                <p style="color: #8be9fd; font-size: 0.72rem; line-height: 1.35; margin: 0;">${card.loreDescription}</p>
            </div>
        </div>
    `;
}

// Tarot Collection Button bindings handled via global delegation
