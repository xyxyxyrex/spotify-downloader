# SpotDL GUI

SpotDL GUI is a premium, high-performance desktop music streaming and downloading client. It is built as a native graphical user interface wrapper and fork of the excellent command-line utility spotDL (https://github.com/spotDL/spotify-downloader).

This desktop application allows users to search, stream, and download songs locally with high-fidelity album art, metadata tagging, and synchronized lyrics, all packaged into a modern, fluid desktop application.

---

## Technical Stack

* Core Frontend: HTML5, CSS3 (Vanilla), Vanilla JavaScript
* Native Desktop Container: Rust (Tauri framework)
* Backend Utilities: Python 3, yt-dlp, syncedlyrics, spotdl

---

## Core Features

* Desktop Music Player: Full audio stream playback capabilities featuring dynamic seek bars, custom volume controllers, visualizer bars, and integrated system-level background playback controls.
* Gapless Local Caching: Streamed tracks are saved dynamically to a high-speed local cache directory to ensure instant startup on repeat listens.
* Theme Engine: Preloaded dark and light UI themes including Default Dark, Beige Light, Catppuccin Mocha, and Dracula. Includes a custom CSS editor allowing users to inject CSS rules or upload stylesheet configurations.
* Spotify Playlist Import: Visual browser to search, load, and selectively import songs from public Spotify playlists. Built-in concurrency locks prevent duplicate track creations and key spams.
* System Dependency Diagnostics: A built-in health monitor in the Settings dashboard showing the installation status of Python, yt-dlp, spotDL, and syncedlyrics with diagnostic indicators.
* Local Disk Management: Single-click tools to purge and reset cached temporary audio tracks and safe double-confirmation purges to clean your download directories.
* Rate Limit Protection: Ready to use with built-in developer client credentials out-of-the-box. Advanced users can provide custom Spotify Client ID, Client Secret, and Last.fm API Key overrides to bypass rate limits.

---

## Installation & Setup

### For End-Users
Go to the Releases tab of this repository and download the latest compiled Windows installer:
* MSI Setup (Standard Windows Setup)
* NSIS Setup (Standalone EXE Setup Wizard)

Verify that Python 3 and the required dependencies are installed on your machine. You can run the live checkup tool inside the Settings panel to confirm health.

### For Developers (Local Compilation)
To run the project in development mode:

1. Clone the repository:
   ```bash
   git clone https://github.com/your-username/spotify-downloader
   cd spotify-downloader/tauri-gui
   ```

2. Install Node dependencies:
   ```bash
   npm install
   ```

3. Run the Tauri development server:
   ```bash
   npm run tauri dev
   ```

To package a release build for production:
```bash
npm run tauri build
```

---

## Credits & Acknowledgements

This application is built on top of the wonderful spotDL command-line project. We give full credit and thanks to the creators and maintainers of spotDL:
* spotDL Command-Line Utility: https://github.com/spotDL/spotify-downloader

---

## License

This project is licensed under the MIT License.
