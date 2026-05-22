# SpotDL GUI v0.2.8 Release Notes

SpotDL GUI v0.2.8 delivers major lyrics UI/UX enhancements, custom fullscreen lyrics mode, interactive playback control via lyrics, and enhanced lyric matching precision.

## New Features & Enhancements

- **Interactive Lyrics Playback (Scrobbling):** Click on any line of synced lyrics to jump the audio playback exactly to that line's timestamp, matching Spotify's native experience.
- **Custom Lyrics Fullscreen Mode:**
  - Added a toggleable fullscreen view dedicated to lyrics (independent of the time screensaver).
  - Designed a premium layout featuring a blurred, darkened background using the active song's cover art.
  - Placed detailed track information (cover art, title, album, artist) beautifully on the left, with styled scrolling lyrics on the right.
- **Improved Scrollbar Design:** Replaced standard scrollbars in the right-hand panel with a minimal, auto-hiding custom scrollbar (only the thumb is visible during scrolling) to reduce visual clutter.
- **Smart Active Line Focusing:** When toggling between plain and synced lyrics or seek-scrobbling halfway through a track, the active line automatically centers and focuses to keep the view aligned with current playback.
- **Visual & Highlighting Polish:**
  - Replaced per-word highlighting with a cleaner line-by-line synced system.
  - Replaced old glassmorphism active line styling with theme-adaptive (e.g. Catppuccin-friendly) broken active border indicators.
  - Corrected light theme styling to fix dark-text-on-dark-background contrast issues.
  - Placed a non-destructive tooltip reminder for tracks that do not have synced lyrics.

## Bug Fixes

- **High-Precision Lyrics Querying:** Solved a critical LRCLIB matching bug. The query system now executes a high-precision exact-match check against the `/api/get` endpoint first, preventing false positives (e.g., fetching a highly collaborative track like *"Forever Always"* instead of *"Always"* by *"Daniel Caesar"*).
- **Playback Seek Fixes:** Resolved an issue where seeking or clicking lyric lines before chunk caching completed would restart the song to `0:00`.
