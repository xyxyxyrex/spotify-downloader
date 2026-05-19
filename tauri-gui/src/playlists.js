const { invoke } = window.__TAURI__.core;

/** Built-in playlist id — cannot be deleted. */
export const LIKED_SONGS_ID = "pl_liked_songs";

let playlists = [];
let activePlaylistId = null;

export function getPlaylists() {
  return playlists;
}

export function getActivePlaylistId() {
  return activePlaylistId;
}

export function setActivePlaylistId(id) {
  activePlaylistId = id;
}

export function isLikedPlaylist(id) {
  return id === LIKED_SONGS_ID;
}

export function songMatchKey(song) {
  return `${String(song.artist || "").trim().toLowerCase()}|${String(song.title || "").trim().toLowerCase()}`;
}

export async function ensureLikedSongsPlaylist() {
  let pl = playlists.find((p) => p.id === LIKED_SONGS_ID);
  if (!pl) {
    pl = { id: LIKED_SONGS_ID, name: "Liked Songs", tracks: [] };
    playlists.unshift(pl);
    await persistPlaylists();
  } else if (pl.name !== "Liked Songs") {
    pl.name = "Liked Songs";
    await persistPlaylists();
  }
  return pl;
}

export async function loadPlaylistsFromDisk() {
  playlists = await invoke("load_playlists");
  await ensureLikedSongsPlaylist();
  return playlists;
}

export async function persistPlaylists() {
  await invoke("save_playlists", { playlists });
}

export function generateId() {
  return `pl_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function getBestImage(meta) {
  const allImages = [...(meta.album_images || []), ...(meta.track_images || [])];
  for (let i = allImages.length - 1; i >= 0; i--) {
    const url = allImages[i]?.url;
    if (url && !url.includes("2a96cbd8b46e442fc41c2b86b821562f")) {
      return url;
    }
  }
  return null;
}

export function trackFromSong(song, order) {
  return {
    id: `tr_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    title: song.title,
    artist: song.artist,
    album: song.album || null,
    image: song.image || null,
    duration_secs: song.duration ?? song.duration_secs ?? null,
    play_count: song.play_count ?? 0,
    spotify_url: song.spotify_url || null,
    order,
  };
}

export async function createPlaylist(name) {
  const trimmed = name.trim();
  if (!trimmed || trimmed.toLowerCase() === "liked songs") {
    throw new Error("That name is reserved.");
  }
  const pl = { id: generateId(), name: trimmed, tracks: [] };
  playlists.push(pl);
  await persistPlaylists();
  return pl;
}

export async function deletePlaylist(id) {
  if (isLikedPlaylist(id)) return;
  playlists = playlists.filter((p) => p.id !== id);
  if (activePlaylistId === id) activePlaylistId = null;
  await persistPlaylists();
}

export function getPlaylist(id) {
  return playlists.find((p) => p.id === id);
}

export function isSongLiked(song) {
  if (!song?.title || !song?.artist) return false;
  const pl = getPlaylist(LIKED_SONGS_ID);
  if (!pl) return false;
  const key = songMatchKey(song);
  return pl.tracks.some((t) => songMatchKey(t) === key);
}

export async function toggleLikedSong(song) {
  if (!song?.title || !song?.artist) return false;
  await ensureLikedSongsPlaylist();
  const pl = getPlaylist(LIKED_SONGS_ID);
  const key = songMatchKey(song);
  const idx = pl.tracks.findIndex((t) => songMatchKey(t) === key);
  if (idx >= 0) {
    pl.tracks.splice(idx, 1);
    pl.tracks.forEach((t, i) => {
      t.order = i;
    });
    await persistPlaylists();
    return false;
  }
  
  const track = trackFromSong(song, pl.tracks.length);
  pl.tracks.push(track);
  await persistPlaylists();

  if (song.duration == null && song.duration_secs == null) {
    invoke("fetch_track_metadata", { artist: song.artist, track: song.title })
      .then(async (meta) => {
        if (meta) {
          if (meta.duration_secs != null) track.duration_secs = meta.duration_secs;
          if (meta.album) track.album = track.album || meta.album;
          const bestImg = getBestImage(meta);
          if (bestImg) track.image = bestImg;
          await persistPlaylists();
          window.dispatchEvent(new CustomEvent("playlist-updated", { detail: { playlistId: LIKED_SONGS_ID } }));
        }
      })
      .catch((e) => {
        console.error("Failed to fetch track metadata for liked songs:", e);
      });
  }

  return true;
}

export async function addTrackToPlaylist(playlistId, song) {
  const pl = getPlaylist(playlistId);
  if (!pl) return;
  
  const key = songMatchKey(song);
  if (pl.tracks.some((t) => songMatchKey(t) === key)) return;

  const track = trackFromSong(song, pl.tracks.length);
  pl.tracks.push(track);
  await persistPlaylists();

  if (song.duration == null && song.duration_secs == null) {
    invoke("fetch_track_metadata", { artist: song.artist, track: song.title })
      .then(async (meta) => {
        if (meta) {
          if (meta.duration_secs != null) track.duration_secs = meta.duration_secs;
          if (meta.album) track.album = track.album || meta.album;
          const bestImg = getBestImage(meta);
          if (bestImg) track.image = bestImg;
          await persistPlaylists();
          window.dispatchEvent(new CustomEvent("playlist-updated", { detail: { playlistId } }));
        }
      })
      .catch((e) => {
        console.error("Failed to fetch track metadata for playlist:", e);
      });
  }
}

export async function reorderPlaylistTracks(playlistId, fromIndex, toIndex) {
  const pl = getPlaylist(playlistId);
  if (!pl || fromIndex === toIndex) return;
  const [item] = pl.tracks.splice(fromIndex, 1);
  pl.tracks.splice(toIndex, 0, item);
  pl.tracks.forEach((t, i) => {
    t.order = i;
  });
  await persistPlaylists();
}

export async function removePlaylistTrack(playlistId, trackId) {
  const pl = getPlaylist(playlistId);
  if (!pl) return;
  pl.tracks = pl.tracks.filter((t) => t.id !== trackId);
  pl.tracks.forEach((t, i) => {
    t.order = i;
  });
  await persistPlaylists();
}

export async function incrementPlayCount(playlistId, trackId) {
  const pl = getPlaylist(playlistId);
  if (!pl) return;
  const tr = pl.tracks.find((t) => t.id === trackId);
  if (tr) {
    tr.play_count = (tr.play_count || 0) + 1;
    await persistPlaylists();
  }
}

export function playlistTotalDuration(pl) {
  return pl.tracks.reduce((sum, t) => sum + (t.duration_secs || 0), 0);
}

export function trackToSong(track) {
  return {
    title: track.title,
    artist: track.artist,
    album: track.album,
    image: track.image,
    duration: track.duration_secs,
    spotify_url: track.spotify_url,
    play_count: track.play_count,
    playlist_track_id: track.id,
  };
}
