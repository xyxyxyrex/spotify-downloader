const { invoke } = window.__TAURI__.core;

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

export async function loadPlaylistsFromDisk() {
  playlists = await invoke('load_playlists');
  return playlists;
}

export async function persistPlaylists() {
  await invoke('save_playlists', { playlists });
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
  const pl = { id: generateId(), name, tracks: [] };
  playlists.push(pl);
  await persistPlaylists();
  return pl;
}

export async function deletePlaylist(id) {
  playlists = playlists.filter((p) => p.id !== id);
  if (activePlaylistId === id) activePlaylistId = null;
  await persistPlaylists();
}

export function getPlaylist(id) {
  return playlists.find((p) => p.id === id);
}

export async function addTrackToPlaylist(playlistId, song) {
  const pl = getPlaylist(playlistId);
  if (!pl) return;
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
