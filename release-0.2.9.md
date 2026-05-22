# SpotDL GUI v0.2.9 Changelog

## 🔄 Playback Auto-Healing & Metadata Sync
* **Real-time Metadata Sync**: Programmatically captures exact track metrics and metadata (e.g. true duration, file tags) via audio player hooks as soon as a track begins playing.
* **Database Healing**: Automatically updates missing durations, blank album entries, and placeholder cover art in all local playlists, persisting them via `persistPlaylists()` and refreshing active views instantly.

## 🖼️ High-Sensitivity Sidebar Collages
* **Sidebar 2x2 Collage Normalization**: Added a tailored `.small-collage` class ensuring grid collages under `50px` align flatly with `1px` grid gaps and no transforms or shadows, rendering gorgeous Spotify-like playlist covers directly in the left sidebar.
* **Custom Cover Input Validation**: Implemented strict extension and MIME-type verification for cover art uploads (supporting `.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`), showing a premium error modal with valid formats on failure.

## 📥 Download Management & Duplication Guard
* **Enhanced Queue Controls**: Added standard options to cancel all active playlist downloads at once, along with individual close/cancel buttons (`X`) for localized track cancel actions.
* **Smart Duplication Bypassing**: The downloader now scans local directories prior to queuing playlist items, instantly completing matches that already exist locally without redundant queue bloat.
* **Responsive Downloader Layout**: Bound high-height vertical page stretching by containing download cards within a clean, scrollable interface.

## 🖱️ Premium Drag & Drop UX
* **High-Sensitivity Drop Zones**: Optimized drag-and-drop target bounds to make sidebar playlist folders highly responsive during mouse hovers.
* **Multi-Track Move Indicator**: Displays a clear floating badge next to the cursor showing the exact count of tracks being moved when dragging multiple files.
* **Theme-Consistent Playlists**: Styled the default "Liked Songs" cover art to match the premium theme color (Spotify Green) instead of generic colors.

## ⌨️ Premium Keyboard Navigation & Shortcuts
* **Comprehensive Playback Hotkeys**: Added global system listeners mapping `Space` to Play/Pause, `ArrowUp`/`ArrowDown` to adjust volume (5% steps), `ArrowLeft`/`ArrowRight` to seek backward/forward (10-second jumps), `N`/`P` to skip/previous tracks, and `M` to mute/unmute.
* **Focused Navigation Priority**: Seamlessly overrides default browser behaviors (such as scrolling on Space/Arrows or activating focused items) when Tab-navigated interactive elements are active, while remaining completely transparent when editing text fields or inputs.
