// =============================================================
// --- Spotify Wrapped v2 — GSAP-Powered Immersive Engine ---
// =============================================================

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
        console.error(`iTunes preview fallback check failed for wrapped song (${type}):`, e);
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
            <div class="w-float-icon" style="font-size:3.5rem;">🎧</div>
            <h1 class="w-heading" style="font-size:2.4rem; background:linear-gradient(135deg,#1db954,#00bcd4); -webkit-background-clip:text; -webkit-text-fill-color:transparent;">Your Sound,<br>Unlocked.</h1>
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

function buildSlide7(personality, personalityDesc) {
    return `<div class="wrapped-slide" style="justify-content:center; text-align:center; align-items:center;">
        <div style="display:flex; flex-direction:column; align-items:center; gap:10px; width:100%;">
            <span class="w-label" style="color:#00bcd4;">Audio Identity</span>
            <h2 class="w-heading" style="margin-bottom:8px;">Your Listening DNA</h2>
            <div class="personality-badge" style="width:100%; box-sizing:border-box;">
                <div style="font-size:2.2rem; margin-bottom:8px; position:relative; z-index:1;">🎭</div>
                <div class="personality-title" style="color:#fff;">${personality}</div>
                <p class="personality-desc">${personalityDesc}</p>
            </div>
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

function buildSlide9(topTrack, topArtists, totalPlays, minutesListened, uniqueTracks, personality, isMockData, defaultImg) {
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
                        <div class="w-summary-label">Personality</div>
                        <div class="w-summary-value" style="font-size:0.82rem; background:linear-gradient(90deg,#1db954,#00bcd4); -webkit-background-clip:text; -webkit-text-fill-color:transparent;">${personality}</div>
                    </div>
                </div>
            </div>
            <p style="text-align:center; font-size:0.72rem; color:rgba(255,255,255,0.3); margin:4px 0 0 0;">${isMockData ? "⚠️ Simulated profile — listen more!" : "🎉 From your local play logs"}</p>
            <button type="button" class="w-save-btn" onclick="alert('Wrapped card saved!')">💾 Save Wrapped Card</button>
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

// ---- Main Launch Function ----
async function launchSpotifyWrapped() {
    const launchWrappedBtn = document.getElementById("btn-launch-wrapped");
    let originalText = "Launch Wrapped";
    if (launchWrappedBtn) {
        originalText = launchWrappedBtn.textContent;
        launchWrappedBtn.disabled = true;
        launchWrappedBtn.textContent = "Preparing audio story... 🎧";
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
    const genres = [
        { name: "Synth-Pop", percentage: 42, color: "#1db954" },
        { name: "Electronic", percentage: 28, color: "#9b59b6" },
        { name: "Alt-Rock", percentage: 18, color: "#e74c3c" },
        { name: "Indie Pop", percentage: 12, color: "#3498db" },
    ];
    const minutesListened = Math.round(totalDurationSecs / 60);
    const hoursListened = (totalDurationSecs / 3600).toFixed(1);

    let personality = "THE SONIC VOYAGER";
    let personalityDesc = "You love charting new paths, mapping rare songs and sailing through massive soundscapes.";
    if (uniqueTracks > 0 && (totalPlays / uniqueTracks) > 4) {
        personality = "THE DEVOTED LOYALIST";
        personalityDesc = "When you love a track, you loop it into core memory. Your anthems run on repeat day and night.";
    } else if (uniqueTracks > 15) {
        personality = "THE ECLECTIC TASTEMAKER";
        personalityDesc = "A chameleon of sound — blending underground gems with mainstream anthems into the ultimate curated archive.";
    }

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
        buildSlide7(personality, personalityDesc),
        buildSlide8(uniqueTracks, artistMap.size),
        buildSlide9(topTrack, topArtists, totalPlays, minutesListened, uniqueTracks, personality, isMockData, defaultImg),
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
        
        alert("Wrapped slides exported successfully! 🎉");
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
            const shareText = `🎧 My Spoti-Tauri Wrapped is here! ${wrappedSlideIndex + 1}/10 chapters of my listening story unlocked. Check it out!`;
            navigator.clipboard.writeText(shareText).then(() => {
                alert("Wrapped summary copied to clipboard! 🎉");
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

// Bind to launch button and initialize
const launchWrappedBtn = document.getElementById("btn-launch-wrapped");
if (launchWrappedBtn) {
    launchWrappedBtn.addEventListener("click", (e) => {
        e.preventDefault();
        launchSpotifyWrapped();
    });
}

// Initialize when DOM is ready
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initWrappedOverlayEvents);
} else {
    initWrappedOverlayEvents();
}
