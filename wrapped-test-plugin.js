// Spoti-Tauri Local Plugin Demo: Playback Monitor (v0.2.5)
console.log("Hello from developer plugin!");

// Use Spoti-Tauri SDK to show status bar alert
window.spotiTauri.showStatus("Developer Mode Active: Wrapped Monitor Initialized!");

// Query local database using SDK getHistory method
window.spotiTauri.getHistory().then((history) => {
    console.log("Successfully fetched history logs inside custom plugin:", history);
    
    let playCount = 0;
    if (history) {
        for (const id in history) {
            playCount += (history[id].play_timestamps || []).length;
        }
    }
    
    // Display popup summary alert
    alert(`[Spoti-Tauri Plugin System v0.2.5]\n\nDeveloper sandbox loaded successfully!\nDetected playbacks in database: ${playCount} plays.`);
});
