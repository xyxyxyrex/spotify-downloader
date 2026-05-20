# SpotDL GUI v0.2.0 Release Notes

SpotDL GUI v0.2.0 is an update to the Tauri and Rust desktop downloader. This release adds custom themes, player state persistence, filesystem synchronization, automatic directory creation, and multi-format metadata support.

Below is a detailed breakdown of all the changes compared to v0.1.0.

---

## New Features & Enhancements

### Custom Theme Creator & UI Changes
* **Theme Creator:** Added a custom theme editor option to the settings dropdown with color pickers for editable variables.
* **Persistent Custom Themes:** Custom themes can be named, selected from the theme dropdown, and are saved in local storage.
* **Theme Cancellation:** Canceling or discarding custom theme edits preserves the active theme without changes.
* **Theme Modal Updates:** Made the theme creator modal draggable, removed background blur, and applied changes only after clicking "Apply".
* **Font Consistency:** Consistently use monospace fonts for input fields and placeholders across all themes.

### Player State & Queue Persistence
* **Queue Backups:** The track queue and play index are saved to local storage when modified.
* **Position Tracking:** The playback position is saved at one-second intervals.
* **Session Recovery:** When the app restarts, it restores the queue and resumes the last playback position without auto-playing.

### Filesystem Synchronization
* **Missing File Removal:** The backend verifies file existence on load and removes deleted files from the library database.
* **Sync Triggers:** Re-verifies library files when switching views.

### Directory Management
* **Default Paths:** Automatically sets default download and cache directories on startup if none are configured.
* **Directory Creation:** Automatically creates missing target directories when starting a download or caching a stream.

### Metadata Embedding & Window Dragging
* **Multi-Format Metadata:** The metadata embedder (embed_metadata.py) now supports MP3, M4A, MP4, and FLAC files.
* **Graceful Fallbacks:** Failed metadata embedding no longer halts the entire download pipeline.
* **Window Draggability:** Enabled Tauri native window dragging.

### Configuration Export and Import
* **Extended Import/Export:** The configuration backup now includes user settings, playlists, history, custom themes, layout states, and view preferences.

---

## Comparison Summary (v0.1.0 vs v0.2.0)

| Feature | v0.1.0 | v0.2.0 |
| :--- | :--- | :--- |
| **Theme Customization** | Predefined themes + manual CSS overrides | Custom theme creator modal with color pickers and persistent custom themes |
| **Player State Persistence** | Reset on close | Restores play queue, active track, and playback position |
| **Filesystem Sync** | Tracks deleted from disk remained in UI | Automatically checks for deleted files and updates library on view change |
| **Default Paths** | Crashed if download folder not configured | Uses default AppData folders and creates them if missing |
| **Metadata Formats** | MP3 only; crashed on other formats | Supports MP3, M4A/MP4, and FLAC |
| **Import/Export Scope** | Settings, playlists, and history | Adds custom themes, layout states, and profiles |
| **Window Draggability** | Header click only | Native window dragging enabled |

---

## Build Artifacts
* **SpotDL_GUI_0.2.0_x64_en-US.msi** (Windows Standard Installer)
* **SpotDL_GUI_0.2.0_x64-setup.exe** (Windows NSIS Setup Wizard Package)
