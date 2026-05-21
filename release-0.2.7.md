# SpotDL GUI v0.2.7 Release Notes

SpotDL GUI v0.2.7 focuses on playback reliability and rate-limit handling.

## Fixes

- Improved audio streaming for uncached tracks by prefetching the next track during playback.
- Increased the audio load timeout from 12 seconds to 90 seconds before the player fails.
- Added rate-limit toast notifications for Last.fm and Spotify so users are prompted to use their own API keys.
