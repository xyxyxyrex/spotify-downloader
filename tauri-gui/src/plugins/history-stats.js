// ============================================================================
// --- Spoti-Tauri History Stats Plugin (v0.1.0) ---
// ============================================================================

function launchHistoryStats() {
    window.spotiTauri.getHistory()
        .then(history => {
            const tracks = history.history || [];
            if (tracks.length === 0) {
                alert("No playback history found yet. Play some tracks first!");
                return;
            }

            // Calculate stats
            const totalPlays = tracks.length;
            const playCounts = {};
            const artistCounts = {};
            let totalDurationMs = 0;

            tracks.forEach(t => {
                const title = t.title || "Unknown Title";
                const artist = t.artist || "Unknown Artist";
                const duration = t.duration || 0;

                playCounts[title] = (playCounts[title] || 0) + 1;
                artistCounts[artist] = (artistCounts[artist] || 0) + 1;
                
                // Parse duration string or number
                if (typeof duration === "string" && duration.includes(":")) {
                    const parts = duration.split(":");
                    const sec = parseInt(parts[0], 10) * 60 + parseInt(parts[1] || 0, 10);
                    totalDurationMs += sec * 1000;
                } else if (typeof duration === "number") {
                    totalDurationMs += duration;
                }
            });

            // Find top song
            let topSong = "";
            let maxSongPlays = 0;
            for (const song in playCounts) {
                if (playCounts[song] > maxSongPlays) {
                    maxSongPlays = playCounts[song];
                    topSong = song;
                }
            }

            // Find top artist
            let topArtist = "";
            let maxArtistPlays = 0;
            for (const artist in artistCounts) {
                if (artistCounts[artist] > maxArtistPlays) {
                    maxArtistPlays = artistCounts[artist];
                    topArtist = artist;
                }
            }

            const totalMins = Math.round(totalDurationMs / 60000);

            // Construct and inject stats modal
            let overlay = document.getElementById("history-stats-overlay");
            if (overlay) overlay.remove();

            overlay = document.createElement("div");
            overlay.id = "history-stats-overlay";
            overlay.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100vw;
                height: 100vh;
                background: rgba(0, 0, 0, 0.75);
                backdrop-filter: blur(10px);
                z-index: 100000;
                display: flex;
                align-items: center;
                justify-content: center;
                animation: fadeIn 0.25s ease-out;
            `;

            const card = document.createElement("div");
            card.style.cssText = `
                background: rgba(25, 20, 20, 0.95);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 16px;
                padding: 30px;
                width: 90%;
                max-width: 450px;
                box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6);
                color: #fff;
                font-family: 'Inter', sans-serif;
                position: relative;
            `;

            card.innerHTML = `
                <button id="close-stats" style="
                    position: absolute;
                    top: 15px;
                    right: 15px;
                    background: none;
                    border: none;
                    color: rgba(255, 255, 255, 0.5);
                    font-size: 1.5rem;
                    cursor: pointer;
                    line-height: 1;
                ">&times;</button>
                
                <h2 style="font-size: 1.5rem; font-weight: 800; margin: 0 0 20px 0; color: #1db954; display: flex; align-items: center; gap: 10px;">
                    📊 History Insights
                </h2>
                
                <div style="display: flex; flex-direction: column; gap: 18px;">
                    <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(255, 255, 255, 0.05); padding-bottom: 8px;">
                        <span style="color: var(--fg-muted); font-size: 0.9rem;">Total Tracks Played</span>
                        <span style="font-weight: 700; color: #fff; font-size: 0.9rem;">${totalPlays}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(255, 255, 255, 0.05); padding-bottom: 8px;">
                        <span style="color: var(--fg-muted); font-size: 0.9rem;">Listening Time</span>
                        <span style="font-weight: 700; color: #fff; font-size: 0.9rem;">${totalMins} min</span>
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 4px; border-bottom: 1px solid rgba(255, 255, 255, 0.05); padding-bottom: 8px;">
                        <span style="color: var(--fg-muted); font-size: 0.85rem;">Top Song</span>
                        <span style="font-weight: 700; color: #1db954; font-size: 1.05rem;">${topSong || "N/A"}</span>
                        <span style="font-size: 0.75rem; color: var(--fg-muted);">${maxSongPlays} plays</span>
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 4px;">
                        <span style="color: var(--fg-muted); font-size: 0.85rem;">Top Artist</span>
                        <span style="font-weight: 700; color: #fff; font-size: 1.05rem;">${topArtist || "N/A"}</span>
                        <span style="font-size: 0.75rem; color: var(--fg-muted);">${maxArtistPlays} engagements</span>
                    </div>
                </div>
            `;

            overlay.appendChild(card);
            document.body.appendChild(overlay);

            card.querySelector("#close-stats").addEventListener("click", () => {
                overlay.remove();
            });
        })
        .catch(err => {
            console.error("Failed to run stats plugin:", err);
            alert("Error loading statistics: " + err.message);
        });
}

// Register with host application
if (window.spotiTauri && typeof window.spotiTauri.registerPlugin === "function") {
    window.spotiTauri.registerPlugin({
        id: "history-stats",
        name: "History Insights",
        description: "Analyze your local play count metrics, favorite artists, and aggregate listening duration.",
        icon: "📊",
        lastUpdated: "20-May-2026",
        downloads: 850,
        launch: launchHistoryStats
    });
}
