const { invoke } = window.__TAURI__.core;

const blobCache = new Map();
const pending = new Map();

export function isValidImage(url) {
  if (!url) return false;
  return !url.includes('2a96cbd8b46e442fc41c2b86b821562f');
}

export async function resolveArtUrl(url) {
  if (!isValidImage(url)) return null;
  if (blobCache.has(url)) return blobCache.get(url);

  if (pending.has(url)) return pending.get(url);

  const promise = (async () => {
    try {
      const path = await invoke('cache_art_image', { url });
      const bytes = await invoke('read_file_bytes', { path });
      const blob = new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' });
      const blobUrl = URL.createObjectURL(blob);
      blobCache.set(url, blobUrl);
      return blobUrl;
    } catch {
      return null;
    } finally {
      pending.delete(url);
    }
  })();

  pending.set(url, promise);
  return promise;
}

export async function applyArtToElement(parent, song, size, generateThumbnail) {
  parent.innerHTML = '';
  const url = song.image;
  if (isValidImage(url)) {
    const cached = await resolveArtUrl(url);
    if (cached) {
      const img = document.createElement('img');
      img.src = cached;
      img.alt = song.title;
      img.loading = 'lazy';
      img.onerror = () => {
        parent.innerHTML = '';
        parent.appendChild(generateThumbnail(song.title, song.artist, size));
      };
      parent.appendChild(img);
      return;
    }
  }
  parent.appendChild(generateThumbnail(song.title, song.artist, size));
}
