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
  pl.tracks.push(trackFromSong(song, pl.tracks.length));
  await persistPlaylists();
  return true;
}

export async function addTrackToPlaylist(playlistId, song) {
  const pl = getPlaylist(playlistId);
  if (!pl) return;
  if (isLikedPlaylist(playlistId)) {
    const key = songMatchKey(song);
    if (pl.tracks.some((t) => songMatchKey(t) === key)) return;
  }
  const order = pl.tracks.length;
  pl.tracks.push(trackFromSong(song, order));
  await persistPlaylists();
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
