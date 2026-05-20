# SpotDL GUI

A native, zero-dependency desktop music manager, searcher, downloader, and stream transcoder. This application is a custom graphical frontend (GUI) fork of the spotDL engine, designed to provide a rich, visually stunning, and highly intuitive desktop experience for discovering, playing, and archiving music offline.

This repository is built as a custom GUI wrapper around the core downloader engine of the official spotDL project. All download capabilities, audio query resolution, and post-download stream processing credit go to the original spotDL team:
https://github.com/spotDL/spotify-downloader

---

## Key Features

- **Zero-Dependency Runtime Configuration**: All necessary backend binaries (spotDL, yt-dlp, Python standalone search engines, metadata embedders, and Gyan.dev FFmpeg and FFprobe builds) are automatically compiled, bundled, and delivered directly inside the installation packages (MSI and NSIS EXE). Users require no external path setup, system installations, or packaging commands.
- **Unified Music Search**: Search across multiple services, including Spotify and Last.fm, using local query refinement APIs. Filters are automatically applied to clean searches by extracting track name, artist, and album tags.
- **Synchronized Lyrics**: Retrieves, parses, and formats local lyric sync structures, allowing real-time scrolling and scrolling interaction in the detail sidebar.
- **Audio Visualizer**: Includes a canvas-based dynamic audio visualizer integrated into the player, adjusting dynamically to match the active accent coloring of the application theme.
- **Offline Playlist & Library Management**: Offers local playlist building, library syncing, and a dedicated offline "Liked Songs" view with direct database caching.
- **Interactive Metadata Detail Panel**: A dedicated right-sidebar containing dynamic canvas-generated track art thumbnails, comprehensive release metadata, and lyric synchronization controls, featuring an integrated Heart toggle to quickly add/remove items to/from Liked Songs.
- **Search Progress Indicator**: Dynamic CSS-driven looping progress bar embedded in the header that accurately reveals API requests and search process states in real-time.
- **Seamless System Background Run**: All backend spawner processes run completely headless with custom process attributes (CREATE_NO_WINDOW), eliminating command prompt popups on Windows entirely during search, streaming, lyrics retrieval, and metadata injection.

---

## Tech Stack

### Frontend Core
- **HTML5**: Structured semantic interface layouts.
- **Vanilla CSS**: Curated, HSL-tailored premium dark mode theme with glassmorphism visual elements, smooth custom transitions, and dynamic accent colors matching active album art presets.
- **JavaScript (ES Modules)**: Modular state-driven presentation layer, visualizer canvas renders, and playlist management services.

### App Shell & System Access
- **Tauri v2**: Next-generation Rust desktop application framework providing lightweight native OS webview containers, safe IPC routing, and secure system commands.
- **Rust**: High-performance system backend handling parallel thread spawner utilities, command environments, and local filesystem configurations.
- **Tokio**: Industrial-grade asynchronous runtime in Rust for stream piping, Axum server execution, and child process execution.

### Backend & Audio Processing
- **spotDL**: Python-based downloader engine for track matching, audio retrieval, and playlist indexing.
- **yt-dlp**: Media stream extractor and audio transcoder handler.
- **FFmpeg & FFprobe**: Gyan.dev Essentials build compiled locally to handle stream encoding, file formatting, and format validation.
- **Custom PyInstaller Binaries**: Optimized Python query search helpers (`spotify_query.exe`) and tag embedders (`embed_metadata.exe`) compiled to stand alone without requiring host Python installations.

---

## Getting Started

### Development
1. Ensure you have Rust and Node.js installed on your Windows development machine.
2. Install frontend dependencies:
   ```bash
   npm install
   ```
3. Run the development server with hot reload:
   ```bash
   npm run tauri dev
   ```

### Production Build
To bundle the frontend resources, compile custom PyInstaller helpers, retrieve local Gyan.dev FFmpeg builds, and package the final installer (.msi and .exe):
```bash
npm run tauri build
```

The completed, fully self-contained installers will be output in:
`tauri-gui/src-tauri/target/release/bundle/`

---

## License & Credits

This application is a custom fork and GUI implementation.
- Core Downloader Engine: [spotDL/spotify-downloader](https://github.com/spotDL/spotify-downloader)
- Stream Transcoder: [yt-dlp/yt-dlp](https://github.com/yt-dlp/yt-dlp)
- Audio Encoder: [FFmpeg](https://ffmpeg.org/)
