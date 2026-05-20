import { isValidImage as artIsValid } from "../art.js";

export const IMAGE_SIZE_ORDER = ["mega", "extralarge", "large", "medium", "small"];

export const PALETTE = [
    "#e74c3c",
    "#e67e22",
    "#f1c40f",
    "#2ecc71",
    "#1abc9c",
    "#3498db",
    "#9b59b6",
    "#e91e63",
    "#00bcd4",
    "#ff5722",
    "#795548",
];

export function songKey(song) {
    return `${song.artist}::${song.title}`;
}

export function hashColor(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return PALETTE[Math.abs(hash) % PALETTE.length];
}

export function generateThumbnail(title, artist, size) {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    const color1 = hashColor(title + artist);
    const color2 = hashColor(artist + title);
    const grad = ctx.createLinearGradient(0, 0, size, size);
    grad.addColorStop(0, color1);
    grad.addColorStop(1, color2);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.font = `bold ${size * 0.3}px serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("♫", size / 2, size * 0.35);
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${Math.max(10, size * 0.09)}px Consolas, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const maxWidth = size * 0.85;
    const words = title.split(" ");
    const lines = [];
    let currentLine = "";
    for (const word of words) {
        const test = currentLine ? `${currentLine} ${word}` : word;
        if (ctx.measureText(test).width > maxWidth && currentLine) {
            lines.push(currentLine);
            currentLine = word;
        } else {
            currentLine = test;
        }
        if (lines.length >= 2) break;
    }
    if (currentLine && lines.length < 3) lines.push(currentLine);
    const lineHeight = size * 0.12;
    const startY = size * 0.58;
    lines.forEach((line, i) => {
        ctx.fillText(line, size / 2, startY + i * lineHeight);
    });
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = `${Math.max(8, size * 0.07)}px Consolas, monospace`;
    const artistY = startY + lines.length * lineHeight + size * 0.06;
    const artistText =
        artist.length > 20 ? `${artist.substring(0, 18)}…` : artist;
    ctx.fillText(artistText, size / 2, artistY);
    return canvas;
}

export function generateArtistAvatar(name, size = 150) {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");

    // Hash colors for smooth premium gradient
    const color1 = hashColor(name);
    const color2 = hashColor(name.split("").reverse().join(""));

    const grad = ctx.createLinearGradient(0, 0, size, size);
    grad.addColorStop(0, color1);
    grad.addColorStop(1, color2);

    // Draw circular background
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    // Draw artist initial
    const initial = (name || "?").charAt(0).toUpperCase();
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${size * 0.45}px "Outfit", "Inter", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(initial, size / 2, size / 2);

    return canvas.toDataURL("image/png");
}

export function isValidImage(url) {
    return artIsValid(url);
}

export function pickBestImageUrl(images) {
    if (!images?.length) return null;
    for (const size of IMAGE_SIZE_ORDER) {
        const found = images.find((img) => img.size === size);
        if (found?.url && isValidImage(found.url)) return found.url;
    }
    return images.find((img) => isValidImage(img.url))?.url ?? null;
}

export function parseImagesFromLastFm(imageArray) {
    if (!Array.isArray(imageArray)) return [];
    return imageArray
        .map((img) => ({
            size: img.size || "unknown",
            url: img["#text"] || "",
        }))
        .filter((img) => isValidImage(img.url));
}

export function mergeImages(...lists) {
    const seen = new Set();
    const out = [];
    for (const list of lists) {
        for (const img of list) {
            if (!seen.has(img.url)) {
                seen.add(img.url);
                out.push(img);
            }
        }
    }
    return out;
}

export function pickAnyValidFromRaw(imageArray) {
    if (!Array.isArray(imageArray)) return null;
    for (let i = imageArray.length - 1; i >= 0; i--) {
        const url = imageArray[i]["#text"];
        if (isValidImage(url)) return url;
    }
    return null;
}

export function extractImageFromLastFmTrack(track) {
    const images = mergeImages(
        parseImagesFromLastFm(track.image),
        track.album?.image ? parseImagesFromLastFm(track.album.image) : [],
    );
    return pickBestImageUrl(images) || pickAnyValidFromRaw(track.image);
}

export function extractImageFromLastFmAlbum(album) {
    const images = parseImagesFromLastFm(album.image);
    return pickBestImageUrl(images) || pickAnyValidFromRaw(album.image);
}

export function normalizeDurationSecs(raw) {
    if (raw == null || raw === "") return null;
    let n = Number(raw);
    if (Number.isNaN(n)) return null;
    if (n > 7200) n = Math.floor(n / 1000);
    return n;
}

export function formatDuration(seconds) {
    const n = normalizeDurationSecs(seconds);
    if (!n) return null;
    const m = Math.floor(n / 60);
    const s = Math.floor(n % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
}

