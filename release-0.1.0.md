# SpotDL GUI v0.1.0 Beta

We are releasing the first Beta version of **SpotDL GUI**, a high-performance desktop music streaming and downloading client built with **Tauri** and **Rust**.

SpotDL GUI serves as a graphical desktop interface and fork of the excellent **spotDL** command-line project:

https://github.com/spotDL/spotify-downloader

This release brings the Spotify experience directly to the desktop with fluid animations, integrated media controls, and built-in storage management tools.

---

## Features

### Fluid Audio Visualizer

A live canvas-based audio frequency analyzer integrated into the **Now Playing** dashboard. The visualizer dynamically adapts its colors to match the currently selected theme.

### Multi-Theme Suite

Built-in theme support includes:

- Default Dark
- Beige Light
- Catppuccin Mocha
- Dracula

Also includes a custom stylesheet editor that allows users to:

- Inject custom CSS rules
- Upload external stylesheets
- Fully personalize application appearance

### System Dependency Health Check

A diagnostic utility available in **Settings** that displays the active status of:

- Python 3
- yt-dlp
- spotDL
- syncedlyrics

Includes a manual refresh button for re-checking dependency states.

### Concurrent Import Locks

Playlist imports from public Spotify URLs now include protection against:

- Accidental double-click imports
- Duplicate requests
- Query spam behavior

### Hardcoded Key Fallbacks

Default credentials are securely embedded at compile time for a seamless out-of-the-box experience:

- Spotify Client ID
- Spotify Client Secret
- Last.fm API keys

### Settings Overrides

Dedicated settings fields allow users to provide their own credentials:

- Custom Spotify Client ID / Secret
- Custom Last.fm API key

This can help avoid API rate limitations.

### Safe Storage Cleanup

Storage management options include:

- One-click cached audio cleanup
- Double-confirmation protection before deleting downloaded music

---

## Installation

Download the appropriate installer from the **Assets** section below.

### Windows Installers

- `SpotDL GUI_0.1.0_x64-setup.exe`  
  NSIS standalone setup wizard

- `SpotDL GUI_0.1.0_x64_en-US.msi`  
  Standard Windows MSI installer

---

## Prerequisites

Python 3 must be installed before using SpotDL GUI.

You can verify all required dependencies through the built-in **Health Diagnostic** card inside the **Settings** tab.

Required dependencies include:

- Python 3
- yt-dlp
- spotDL
- syncedlyrics

---

## Notes

This is an early Beta release. Expect continued iteration, UI improvements, performance refinements, and additional functionality in future updates.

Feedback and issue reports are appreciated.