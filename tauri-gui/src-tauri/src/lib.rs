use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;
use dotenvy::dotenv;
use std::env;
use tauri::{Manager, State};
use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const LASTFM_PLACEHOLDER: &str = "2a96cbd8b46e442fc41c2b86b821562f";

#[derive(Serialize, Deserialize)]
pub struct SongResult {
    title: String,
    lyrics: String,
}

#[derive(Serialize, Deserialize)]
struct LyricLine {
    time: f64,
    text: String,
}

#[derive(Serialize, Deserialize)]
struct LyricsPayload {
    source: String,
    plain: String,
    synced: Vec<LyricLine>,
}

#[derive(Serialize, Deserialize)]
pub struct StreamResult {
    file_path: String,
    file_name: String,
}

/// Payload from the settings UI (`invoke` passes a single JSON object).
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct SetSettingsPayload {
    #[serde(alias = "cache_dir")]
    cache_dir: Option<String>,
    #[serde(alias = "download_dir")]
    download_dir: Option<String>,
    #[serde(alias = "spotify_client_id")]
    spotify_client_id: Option<String>,
    #[serde(alias = "spotify_client_secret")]
    spotify_client_secret: Option<String>,
    #[serde(alias = "lastfm_api_key")]
    lastfm_api_key: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct AppSettings {
    #[serde(default, alias = "cacheDir")]
    pub cache_dir: Option<String>,
    #[serde(default, alias = "downloadDir")]
    pub download_dir: Option<String>,
    #[serde(default, alias = "spotifyClientId")]
    pub spotify_client_id: Option<String>,
    #[serde(default, alias = "spotifyClientSecret")]
    pub spotify_client_secret: Option<String>,
    #[serde(default, alias = "lastfmApiKey")]
    pub lastfm_api_key: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct ApiStatus {
    pub spotify_configured: bool,
    pub lastfm_configured: bool,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct PlaylistTrack {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    pub image: Option<String>,
    pub duration_secs: Option<u64>,
    pub play_count: u32,
    pub spotify_url: Option<String>,
    pub order: u32,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct UserPlaylist {
    pub id: String,
    pub name: String,
    pub tracks: Vec<PlaylistTrack>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ArtImage {
    pub size: String,
    pub url: String,
}

#[derive(Serialize, Deserialize)]
pub struct TrackMetadata {
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    pub duration_secs: Option<u64>,
    pub listeners: Option<String>,
    pub playcount: Option<String>,
    pub url: Option<String>,
    pub published: Option<String>,
    pub tags: Vec<String>,
    pub wiki_summary: Option<String>,
    pub track_images: Vec<ArtImage>,
    pub album_images: Vec<ArtImage>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct TrackHistory {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    pub image: Option<String>,
    pub duration_secs: Option<u64>,
    pub play_timestamps: Vec<u64>,
}

pub struct AppState {
    pub settings: Mutex<AppSettings>,
    pub discord_rpc: Mutex<Option<DiscordIpcClient>>,
}

use std::sync::OnceLock;
static APP_HANDLE: OnceLock<tauri::AppHandle> = OnceLock::new();

// ---------- Helpers ----------

fn get_bundled_bin_dir() -> Option<PathBuf> {
    let handle = APP_HANDLE.get()?;
    
    // Candidate 1: Standard flattened resource path
    if let Ok(p) = handle.path().resolve("bin", tauri::path::BaseDirectory::Resource) {
        if p.is_dir() {
            return Some(p);
        }
    }
    
    // Candidate 2: _up_/bin/ mapped resource path
    if let Ok(p) = handle.path().resolve("_up_/bin", tauri::path::BaseDirectory::Resource) {
        if p.is_dir() {
            return Some(p);
        }
    }
    
    // Candidate 3: In development
    if let Ok(manifest) = std::env::var("CARGO_MANIFEST_DIR") {
        let p = PathBuf::from(manifest).join("../bin");
        if p.is_dir() {
            return Some(p);
        }
    }

    None
}

fn get_bundled_bin_path(name: &str) -> Option<PathBuf> {
    let handle = APP_HANDLE.get()?;
    let filename = if cfg!(windows) {
        format!("{}.exe", name)
    } else {
        name.to_string()
    };
    
    // Candidate 1: Standard flattened resource path
    if let Ok(p) = handle.path().resolve(format!("bin/{}", filename), tauri::path::BaseDirectory::Resource) {
        if p.is_file() {
            return Some(p);
        }
    }
    
    // Candidate 2: _up_/bin/ mapped resource path
    if let Ok(p) = handle.path().resolve(format!("_up_/bin/{}", filename), tauri::path::BaseDirectory::Resource) {
        if p.is_file() {
            return Some(p);
        }
    }
    
    // Candidate 3: In development
    if let Ok(manifest) = std::env::var("CARGO_MANIFEST_DIR") {
        let p = PathBuf::from(manifest).join("../bin").join(&filename);
        if p.is_file() {
            return Some(p);
        }
    }

    None
}

fn configure_command_env(cmd: &mut std::process::Command) {
    if let Some(bin_dir) = get_bundled_bin_dir() {
        let current_path = std::env::var("PATH").unwrap_or_default();
        #[cfg(windows)]
        let separator = ";";
        #[cfg(not(windows))]
        let separator = ":";
        let new_path = format!("{}{}{}", bin_dir.to_str().unwrap(), separator, current_path);
        cmd.env("PATH", new_path);
    }
    #[cfg(windows)]
    {
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
}

fn configure_tokio_command_env(cmd: &mut tokio::process::Command) {
    if let Some(bin_dir) = get_bundled_bin_dir() {
        let current_path = std::env::var("PATH").unwrap_or_default();
        #[cfg(windows)]
        let separator = ";";
        #[cfg(not(windows))]
        let separator = ":";
        let new_path = format!("{}{}{}", bin_dir.to_str().unwrap(), separator, current_path);
        cmd.env("PATH", new_path);
    }
    #[cfg(windows)]
    {
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
}

fn settings_file() -> PathBuf {
    let mut path = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    path.push("spotdl-gui");
    let _ = std::fs::create_dir_all(&path);
    path.push("settings.json");
    path
}

fn history_file() -> PathBuf {
    let mut path = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    path.push("spotdl-gui");
    let _ = std::fs::create_dir_all(&path);
    path.push("history.json");
    path
}

fn load_history() -> std::collections::HashMap<String, TrackHistory> {
    let path = history_file();
    if !path.exists() {
        return std::collections::HashMap::new();
    }
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_history(history: &std::collections::HashMap<String, TrackHistory>) -> Result<(), String> {
    let path = history_file();
    let data = serde_json::to_string_pretty(history).map_err(|e| format!("Failed to serialize history: {}", e))?;
    std::fs::write(&path, data).map_err(|e| format!("Failed to write history: {}", e))?;
    Ok(())
}

fn default_cache_dir() -> PathBuf {
    let mut path = dirs::cache_dir()
        .or_else(dirs::data_local_dir)
        .or_else(dirs::config_dir)
        .unwrap_or_else(|| PathBuf::from("."));
    path.push("spotdl-gui");
    path.push("cache");
    path
}

fn default_download_dir() -> PathBuf {
    let mut path = dirs::audio_dir()
        .or_else(dirs::download_dir)
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| PathBuf::from("."));
    
    // If it's home_dir, or relative, let's push "Music" to keep it clean.
    if path == PathBuf::from(".") || dirs::home_dir().map(|h| h == path).unwrap_or(false) {
        path.push("Music");
    }
    path.push("SpotDL");
    path
}

fn load_settings_from_disk() -> AppSettings {
    let path = settings_file();
    let mut settings = if !path.exists() {
        AppSettings::default()
    } else {
        std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    };

    let mut modified = false;
    if settings.cache_dir.is_none() || settings.cache_dir.as_ref().map(|s| s.trim().is_empty()).unwrap_or(false) {
        settings.cache_dir = Some(default_cache_dir().to_string_lossy().to_string());
        modified = true;
    }
    if settings.download_dir.is_none() || settings.download_dir.as_ref().map(|s| s.trim().is_empty()).unwrap_or(false) {
        settings.download_dir = Some(default_download_dir().to_string_lossy().to_string());
        modified = true;
    }

    if modified {
        let _ = persist_settings(&settings);
    }

    settings
}

fn non_empty_opt(s: Option<String>) -> Option<String> {
    s.filter(|t| !t.trim().is_empty())
}

/// Prefer in-memory values; fill gaps from disk (covers stale mutex vs `settings.json`).
fn merge_app_settings(mem: AppSettings, disk: AppSettings) -> AppSettings {
    AppSettings {
        cache_dir: non_empty_opt(mem.cache_dir).or(non_empty_opt(disk.cache_dir)),
        download_dir: non_empty_opt(mem.download_dir).or(non_empty_opt(disk.download_dir)),
        spotify_client_id: non_empty_opt(mem.spotify_client_id)
            .or(non_empty_opt(disk.spotify_client_id)),
        spotify_client_secret: non_empty_opt(mem.spotify_client_secret)
            .or(non_empty_opt(disk.spotify_client_secret)),
        lastfm_api_key: non_empty_opt(mem.lastfm_api_key).or(non_empty_opt(disk.lastfm_api_key)),
    }
}

fn effective_settings(state: &AppState) -> AppSettings {
    let mem = state.settings.lock().unwrap().clone();
    let disk = load_settings_from_disk();
    merge_app_settings(mem, disk)
}

fn persist_settings(settings: &AppSettings) -> Result<(), String> {
    let json =
        serde_json::to_string_pretty(settings).map_err(|e| format!("Serialize error: {}", e))?;
    std::fs::write(settings_file(), json).map_err(|e| format!("Write settings: {}", e))
}

fn resolve_cache_dir(settings: &AppSettings) -> PathBuf {
    let cache = settings
        .cache_dir
        .as_ref()
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(default_cache_dir);
    
    if std::fs::create_dir_all(&cache).is_err() {
        let fallback = default_cache_dir();
        let _ = std::fs::create_dir_all(&fallback);
        fallback
    } else {
        cache
    }
}

fn resolve_download_dir(settings: &AppSettings) -> PathBuf {
    let dl = settings
        .download_dir
        .as_ref()
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(default_download_dir);

    if std::fs::create_dir_all(&dl).is_err() {
        let fallback = default_download_dir();
        let _ = std::fs::create_dir_all(&fallback);
        fallback
    } else {
        dl
    }
}

fn check_dir_writable(path: &std::path::Path) -> Result<(), String> {
    if path.exists() && !path.is_dir() {
        return Err(format!(
            "Path is not a folder: {}",
            path.to_string_lossy()
        ));
    }
    std::fs::create_dir_all(path)
        .map_err(|e| format!("Cannot create folder ({}): {}", path.display(), e))?;
    let test_file = path.join(".spotdl_write_test");
    std::fs::write(&test_file, b"ok")
        .map_err(|e| format!("Folder is not writable ({}): {}", path.display(), e))?;
    let _ = std::fs::remove_file(test_file);
    Ok(())
}

fn validate_optional_dir_setting(dir: &Option<String>, label: &str) -> Result<(), String> {
    let Some(raw) = dir.as_ref() else {
        return Ok(());
    };
    if raw.trim().is_empty() {
        return Ok(());
    }
    let path = PathBuf::from(raw.trim());
    check_dir_writable(&path).map_err(|e| format!("{}: {}", label, e))
}

fn parse_download_stem(stem: &str) -> Option<(String, String)> {
    let (artist, title) = stem.split_once(" - ")?;
    let artist = artist.trim();
    let title = title.trim();
    if artist.is_empty() || title.is_empty() {
        return None;
    }
    Some((artist.to_string(), title.to_string()))
}

fn rebuild_download_index_from_disk(settings: &AppSettings) -> Result<usize, String> {
    let download_dir = resolve_download_dir(settings);
    let _ = check_dir_writable(&download_dir)?;
    let mut index = load_download_index(settings);
    let mut added = 0usize;

    let entries = std::fs::read_dir(&download_dir)
        .map_err(|e| format!("Cannot read downloads folder: {}", e))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if !is_audio_file(&path) {
            continue;
        }
        let filename = entry.file_name().to_string_lossy().to_string();
        if filename.starts_with('.') {
            continue;
        }
        if index.values().any(|v| v == &filename) {
            continue;
        }
        let stem = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("");
        let Some((artist, title)) = parse_download_stem(stem) else {
            continue;
        };
        let key = track_key(&artist, &title);
        if index.contains_key(&key) {
            continue;
        }
        index.insert(key, filename);
        added += 1;
    }

    if added > 0 {
        save_download_index(settings, &index)?;
    }
    Ok(added)
}

fn is_audio_file(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|ext| matches!(ext, "mp3" | "m4a" | "ogg" | "opus" | "flac" | "wav" | "webm"))
        .unwrap_or(false)
}

fn load_env() {
    if dotenv().is_err() {
        let _ = dotenvy::from_path("src-tauri/.env");
        let _ = dotenvy::from_path(".env");
    }
}

fn is_valid_image_url(url: &str) -> bool {
    !url.is_empty() && !url.contains(LASTFM_PLACEHOLDER)
}

fn parse_lastfm_images(images: Option<&Value>) -> Vec<ArtImage> {
    let mut out = Vec::new();
    let Some(arr) = images.and_then(|v| v.as_array()) else {
        return out;
    };
    for img in arr {
        let size = img
            .get("size")
            .and_then(|s| s.as_str())
            .unwrap_or("unknown")
            .to_string();
        let url = img
            .get("#text")
            .and_then(|u| u.as_str())
            .unwrap_or("")
            .to_string();
        if is_valid_image_url(&url) {
            out.push(ArtImage { size, url });
        }
    }
    out
}

fn dedupe_images(images: Vec<ArtImage>) -> Vec<ArtImage> {
    let mut seen = HashSet::new();
    images
        .into_iter()
        .filter(|img| seen.insert(img.url.clone()))
        .collect()
}

fn normalize_duration_secs(secs: u64) -> u64 {
    if secs > 7200 {
        secs / 1000
    } else {
        secs
    }
}

fn track_key(artist: &str, title: &str) -> String {
    format!(
        "{}|{}",
        artist.trim().to_lowercase(),
        title.trim().to_lowercase()
    )
}

fn stream_result_from_path(path: &std::path::Path) -> StreamResult {
    StreamResult {
        file_path: path.to_string_lossy().to_string(),
        file_name: path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string(),
    }
}

/// Saved download or stream cache hit — no network fetch.
fn resolve_existing_playback_file(
    settings: &AppSettings,
    query: &str,
    artist: Option<&str>,
    title: Option<&str>,
) -> Option<std::path::PathBuf> {
    if let (Some(artist), Some(title)) = (artist, title) {
        if !artist.trim().is_empty() && !title.trim().is_empty() {
            let key = track_key(artist, title);
            let index = load_download_index(settings);
            if let Some(filename) = index.get(&key) {
                let path = resolve_download_dir(settings).join(filename);
                if path.is_file() {
                    return Some(path);
                }
            }
        }
    }

    let cache_dir = resolve_cache_dir(settings);
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    use std::hash::{Hash, Hasher};
    query.hash(&mut hasher);
    let hash_str = format!("{:x}", hasher.finish());

    if let Ok(entries) = std::fs::read_dir(&cache_dir) {
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            if is_audio_file(&path)
                && path.file_stem().and_then(|s| s.to_str()) == Some(&hash_str)
            {
                return Some(path);
            }
        }
    }
    None
}

fn download_index_path(settings: &AppSettings) -> PathBuf {
    resolve_download_dir(settings).join(".spotdl-gui-library.json")
}

fn load_download_index(settings: &AppSettings) -> HashMap<String, String> {
    let path = download_index_path(settings);
    if !path.exists() {
        return HashMap::new();
    }
    let index: HashMap<String, String> = std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();

    let dl_dir = resolve_download_dir(settings);
    let mut cleaned_index = HashMap::new();
    let mut modified = false;

    for (key, filename) in index {
        if dl_dir.join(&filename).is_file() {
            cleaned_index.insert(key, filename);
        } else {
            modified = true;
        }
    }

    if modified {
        let _ = save_download_index(settings, &cleaned_index);
    }

    cleaned_index
}

fn save_download_index(settings: &AppSettings, index: &HashMap<String, String>) -> Result<(), String> {
    let json =
        serde_json::to_string_pretty(index).map_err(|e| format!("Serialize index: {}", e))?;
    std::fs::write(download_index_path(settings), json)
        .map_err(|e| format!("Write index: {}", e))
}

fn sanitize_filename(name: &str) -> String {
    let invalid = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];
    let mut out: String = name
        .chars()
        .map(|c| if invalid.contains(&c) { '_' } else { c })
        .collect();
    if out.len() > 180 {
        out.truncate(180);
    }
    out.trim().to_string()
}

fn resolve_spotify_script() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(manifest) = env::var("CARGO_MANIFEST_DIR") {
        candidates.push(PathBuf::from(manifest).join("../scripts/spotify_query.py"));
    }
    candidates.push(PathBuf::from("scripts/spotify_query.py"));
    candidates.push(PathBuf::from("tauri-gui/scripts/spotify_query.py"));
    candidates.into_iter().find(|p| p.is_file())
}

fn spotify_env_from_settings(settings: &AppSettings) -> HashMap<String, String> {
    load_env();
    let mut map = HashMap::new();
    let id = settings
        .spotify_client_id
        .clone()
        .filter(|s| !s.is_empty())
        .or_else(|| env::var("SPOTIFY_CLIENT_ID").ok())
        .or_else(|| option_env!("SPOTIFY_CLIENT_ID").map(|s| s.to_string()))
        .or_else(|| Some("83050cebbb5c42c7afbf488c7e3b777b".to_string()))
        .filter(|s| !s.is_empty());
    let secret = settings
        .spotify_client_secret
        .clone()
        .filter(|s| !s.is_empty())
        .or_else(|| env::var("SPOTIFY_CLIENT_SECRET").ok())
        .or_else(|| option_env!("SPOTIFY_CLIENT_SECRET").map(|s| s.to_string()))
        .or_else(|| Some("998a328838b84e85b66e95143ed9a974".to_string()))
        .filter(|s| !s.is_empty());
    if let Some(v) = id {
        map.insert("SPOTIFY_CLIENT_ID".to_string(), v);
    }
    if let Some(v) = secret {
        map.insert("SPOTIFY_CLIENT_SECRET".to_string(), v);
    }
    if let Ok(manifest) = env::var("CARGO_MANIFEST_DIR") {
        let repo_root = PathBuf::from(manifest).join("..").join("..").join("..");
        if repo_root.exists() {
            map.insert(
                "PYTHONPATH".to_string(),
                repo_root.to_string_lossy().to_string(),
            );
        }
    }
    map
}

fn art_cache_dir(settings: &AppSettings) -> PathBuf {
    let mut dir = resolve_cache_dir(settings);
    dir.push("art-cache");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

fn hash_url(url: &str) -> String {
    let mut hasher = DefaultHasher::new();
    url.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn playlists_file() -> PathBuf {
    let mut path = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    path.push("spotdl-gui");
    let _ = std::fs::create_dir_all(&path);
    path.push("playlists.json");
    path
}

fn resolve_embed_script() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(manifest) = env::var("CARGO_MANIFEST_DIR") {
        candidates.push(PathBuf::from(manifest).join("../scripts/embed_metadata.py"));
    }
    candidates.push(PathBuf::from("scripts/embed_metadata.py"));
    candidates.push(PathBuf::from("tauri-gui/scripts/embed_metadata.py"));
    candidates.into_iter().find(|p| p.is_file())
}

fn embed_metadata_file(audio_path: &PathBuf, meta: &TrackMetadata) -> Result<(), String> {
    let cover_url = best_image_url(&meta.album_images)
        .or_else(|| best_image_url(&meta.track_images));

    let payload = serde_json::json!({
        "title": meta.title,
        "artist": meta.artist,
        "album": meta.album,
        "tags": meta.tags,
        "wiki_summary": meta.wiki_summary.as_ref().map(|w| {
            w.split('<').next().unwrap_or(w).chars().take(500).collect::<String>()
        }),
        "cover_url": cover_url,
        "album_images": meta.album_images,
        "track_images": meta.track_images,
    });

    let json_str = serde_json::to_string(&payload).map_err(|e| e.to_string())?;

    let mut cmd = if std::env::var("CARGO_MANIFEST_DIR").is_err() && get_bundled_bin_path("embed_metadata").is_some() {
        let bin_path = get_bundled_bin_path("embed_metadata").unwrap();
        let mut c = Command::new(bin_path);
        c.arg(audio_path).arg(&json_str);
        configure_command_env(&mut c);
        c
    } else {
        let script = resolve_embed_script()
            .ok_or_else(|| "embed_metadata.py not found in scripts/".to_string())?;
        let mut c = Command::new("python");
        c.arg(&script).arg(audio_path).arg(&json_str);
        configure_command_env(&mut c);
        c
    };

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to run embed script: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Metadata embed failed: {}", stderr));
    }
    Ok(())
}

fn best_image_url(images: &[ArtImage]) -> Option<String> {
    const ORDER: &[&str] = &["mega", "extralarge", "large", "medium", "small"];
    for size in ORDER {
        if let Some(img) = images.iter().find(|i| i.size == *size) {
            return Some(img.url.clone());
        }
    }
    images.first().map(|i| i.url.clone())
}

fn resolve_lastfm_api_key(settings: &AppSettings) -> Result<String, String> {
    load_env();
    settings
        .lastfm_api_key
        .as_ref()
        .filter(|s| !s.is_empty())
        .cloned()
        .or_else(|| env::var("LASTFM_API_KEY").ok())
        .or_else(|| option_env!("LASTFM_API_KEY").map(|s| s.to_string()))
        .or_else(|| Some("feb8efb1f28c53e4e93b6eda06176016".to_string()))
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            "Last.fm API key not set. Add it in Settings or src-tauri/.env (LASTFM_API_KEY)."
                .to_string()
        })
}

fn spotify_is_configured(settings: &AppSettings) -> bool {
    load_env();
    let id = settings
        .spotify_client_id
        .as_ref()
        .filter(|s| !s.is_empty())
        .cloned()
        .or_else(|| env::var("SPOTIFY_CLIENT_ID").ok())
        .or_else(|| option_env!("SPOTIFY_CLIENT_ID").map(|s| s.to_string()))
        .or_else(|| Some("83050cebbb5c42c7afbf488c7e3b777b".to_string()))
        .filter(|s| !s.is_empty());
    let secret = settings
        .spotify_client_secret
        .as_ref()
        .filter(|s| !s.is_empty())
        .cloned()
        .or_else(|| env::var("SPOTIFY_CLIENT_SECRET").ok())
        .or_else(|| option_env!("SPOTIFY_CLIENT_SECRET").map(|s| s.to_string()))
        .or_else(|| Some("998a328838b84e85b66e95143ed9a974".to_string()))
        .filter(|s| !s.is_empty());
    id.is_some() && secret.is_some()
}

async fn lastfm_get(api_key: &str, method: &str, extra_params: &str) -> Result<Value, String> {
    let url = format!(
        "https://ws.audioscrobbler.com/2.0/?method={}&api_key={}&format=json{}",
        method, api_key, extra_params
    );
    let response = reqwest::get(&url)
        .await
        .map_err(|e| format!("HTTP request failed: {}", e))?;
    let body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;
    serde_json::from_str(&body).map_err(|e| format!("Invalid JSON from Last.fm: {}", e))
}

fn parse_lrc_timestamp(raw: &str) -> Option<f64> {
    let trimmed = raw.trim();
    let mut parts = trimmed.split(':');
    let minutes = parts.next()?.parse::<f64>().ok()?;
    let seconds_part = parts.next()?;
    let seconds = seconds_part.parse::<f64>().ok()?;
    Some(minutes * 60.0 + seconds)
}

fn parse_synced_lyrics(raw: &str) -> Vec<LyricLine> {
    let mut lines = Vec::new();
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let mut remainder = trimmed;
        let mut times = Vec::new();
        while let Some(start) = remainder.find('[') {
            let after_start = &remainder[start + 1..];
            let Some(end) = after_start.find(']') else {
                break;
            };
            let stamp = &after_start[..end];
            if let Some(time) = parse_lrc_timestamp(stamp) {
                times.push(time);
            }
            remainder = &after_start[end + 1..];
        }

        let text = remainder.trim();
        if times.is_empty() || text.is_empty() {
            continue;
        }

        for time in times {
            lines.push(LyricLine {
                time,
                text: text.to_string(),
            });
        }
    }

    lines.sort_by(|a, b| a.time.partial_cmp(&b.time).unwrap_or(std::cmp::Ordering::Equal));
    lines
}

/// Try LRCLIB (free, no key) when lyrics.ovh has no match.
async fn try_lrclib_lyrics(client: &reqwest::Client, artist: &str, title: &str) -> Option<String> {
    // 1. Try exact match query
    let get_url = format!(
        "https://lrclib.net/api/get?artist_name={}&track_name={}",
        urlencoding::encode(artist),
        urlencoding::encode(title)
    );
    if let Ok(response) = client.get(&get_url).send().await {
        if response.status().is_success() {
            if let Ok(item) = response.json::<Value>().await {
                if let Some(plain) = item.get("plainLyrics").and_then(|v| v.as_str()) {
                    let p = plain.trim();
                    if !p.is_empty() {
                        return Some(p.to_string());
                    }
                }
                if let Some(sync) = item.get("syncedLyrics").and_then(|v| v.as_str()) {
                    let s = sync.trim();
                    if !s.is_empty() {
                        return Some(s.to_string());
                    }
                }
            }
        }
    }

    // 2. Fallback to broad search query
    let q = format!("{} {}", artist, title);
    let url = format!(
        "https://lrclib.net/api/search?q={}",
        urlencoding::encode(&q)
    );
    let response = client.get(&url).send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }
    let arr: Vec<Value> = response.json().await.ok()?;
    for item in arr {
        if let Some(plain) = item.get("plainLyrics").and_then(|v| v.as_str()) {
            let p = plain.trim();
            if !p.is_empty() {
                return Some(p.to_string());
            }
        }
        if let Some(sync) = item.get("syncedLyrics").and_then(|v| v.as_str()) {
            let s = sync.trim();
            if !s.is_empty() {
                return Some(s.to_string());
            }
        }
    }
    None
}

async fn try_lrclib_lyrics_payload(
    client: &reqwest::Client,
    artist: &str,
    title: &str,
) -> Option<LyricsPayload> {
    // 1. Try exact match query
    let get_url = format!(
        "https://lrclib.net/api/get?artist_name={}&track_name={}",
        urlencoding::encode(artist),
        urlencoding::encode(title)
    );
    if let Ok(response) = client.get(&get_url).send().await {
        if response.status().is_success() {
            if let Ok(item) = response.json::<Value>().await {
                let synced_raw = item
                    .get("syncedLyrics")
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .unwrap_or("");
                let synced = parse_synced_lyrics(synced_raw);
                let plain = item
                    .get("plainLyrics")
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(str::to_string)
                    .unwrap_or_default();

                if !synced.is_empty() {
                    return Some(LyricsPayload {
                        source: "lrclib".to_string(),
                        plain: if !plain.is_empty() {
                            plain
                        } else {
                            synced
                                .iter()
                                .map(|line| line.text.clone())
                                .collect::<Vec<_>>()
                                .join("\n")
                        },
                        synced,
                    });
                } else if !plain.is_empty() {
                    return Some(LyricsPayload {
                        source: "lrclib".to_string(),
                        plain,
                        synced: Vec::new(),
                    });
                }
            }
        }
    }

    // 2. Fallback to broad search query
    let q = format!("{} {}", artist, title);
    let url = format!(
        "https://lrclib.net/api/search?q={}",
        urlencoding::encode(&q)
    );
    let response = client.get(&url).send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }
    let arr: Vec<Value> = response.json().await.ok()?;

    // First pass: try to find any item with synced lyrics
    for item in &arr {
        let synced_raw = item
            .get("syncedLyrics")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("");
        let synced = parse_synced_lyrics(synced_raw);
        if !synced.is_empty() {
            let plain = item
                .get("plainLyrics")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
                .unwrap_or_default();
            return Some(LyricsPayload {
                source: "lrclib".to_string(),
                plain: if !plain.is_empty() {
                    plain
                } else {
                    synced
                        .iter()
                        .map(|line| line.text.clone())
                        .collect::<Vec<_>>()
                        .join("\n")
                },
                synced,
            });
        }
    }

    // Second pass: fall back to the first item with plain lyrics
    for item in &arr {
        let plain = item
            .get("plainLyrics")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .unwrap_or_default();
        if !plain.is_empty() {
            return Some(LyricsPayload {
                source: "lrclib".to_string(),
                plain,
                synced: Vec::new(),
            });
        }
    }

    None
}

/// Free lyrics: try api.lyrics.ovh, then LRCLIB (lrclib.net).
#[tauri::command]
async fn fetch_lyrics(artist: String, title: String) -> Result<String, String> {
    let payload = fetch_lyrics_payload(artist, title).await?;
    if !payload.plain.trim().is_empty() {
        return Ok(payload.plain);
    }
    Err("No lyrics found (tried lyrics.ovh and LRCLIB).".to_string())
}

#[tauri::command]
async fn fetch_lyrics_payload(artist: String, title: String) -> Result<LyricsPayload, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(18))
        .user_agent("SpotDL-GUI/1.0 (https://github.com)")
        .build()
        .map_err(|e| e.to_string())?;

    // 1. Try LRCLIB first to get synced lyrics (includes plain lyrics fallback)
    if let Some(payload) = try_lrclib_lyrics_payload(&client, &artist, &title).await {
        return Ok(payload);
    }

    // 2. Fall back to api.lyrics.ovh for plain lyrics
    let a = urlencoding::encode(&artist);
    let t = urlencoding::encode(&title);
    let ovh_url = format!("https://api.lyrics.ovh/v1/{}/{}", a, t);

    if let Ok(response) = client.get(&ovh_url).send().await {
        if response.status().is_success() {
            if let Ok(body) = response.text().await {
                if let Ok(val) = serde_json::from_str::<Value>(&body) {
                    let ovh_err = val
                        .get("error")
                        .and_then(|x| x.as_str())
                        .map(str::trim)
                        .filter(|e| !e.is_empty());
                    if ovh_err.is_none() {
                        if let Some(ly) = val
                            .get("lyrics")
                            .and_then(|v| v.as_str())
                            .map(str::trim)
                            .filter(|s| !s.is_empty())
                        {
                            return Ok(LyricsPayload {
                                source: "lyrics.ovh".to_string(),
                                plain: ly.to_string(),
                                synced: Vec::new(),
                            });
                        }
                    }
                }
            }
        }
    }

    Err("No lyrics found (tried LRCLIB and lyrics.ovh).".to_string())
}

// ---------- Commands ----------

fn fallback_geo_country() -> String {
    "United States".to_string()
}

/// Country name suitable for Last.fm `geo.gettoptracks` `country` parameter (English name).
#[tauri::command]
async fn get_geo_country() -> String {
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(4))
        .user_agent("SpotDL-GUI/1.0 (https://github.com)")
        .build()
    {
        Ok(c) => c,
        Err(_) => return fallback_geo_country(),
    };
    let Ok(resp) = client.get("https://ipapi.co/json/").send().await else {
        return fallback_geo_country();
    };
    if !resp.status().is_success() {
        return fallback_geo_country();
    }
    let Ok(val): Result<Value, _> = resp.json().await else {
        return fallback_geo_country();
    };
    val.get("country_name")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(std::string::ToString::to_string)
        .unwrap_or_else(fallback_geo_country)
}

#[tauri::command]
fn window_minimize(app: tauri::AppHandle) -> Result<(), String> {
    app.get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?
        .minimize()
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn window_toggle_maximize(app: tauri::AppHandle) -> Result<(), String> {
    let w = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    if w.is_maximized().map_err(|e| e.to_string())? {
        w.unmaximize().map_err(|e| e.to_string())
    } else {
        w.maximize().map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn window_close(app: tauri::AppHandle) -> Result<(), String> {
    app.get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?
        .close()
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_api_key() -> String {
    load_env();
    env::var("LASTFM_API_KEY").unwrap_or_else(|_| "YOUR_API_KEY_HERE".to_string())
}

#[tauri::command]
fn get_settings(state: State<AppState>) -> AppSettings {
    effective_settings(&state)
}

#[tauri::command]
fn get_api_status(state: State<AppState>) -> ApiStatus {
    let settings = effective_settings(&state);
    ApiStatus {
        spotify_configured: spotify_is_configured(&settings),
        lastfm_configured: resolve_lastfm_api_key(&settings).is_ok(),
    }
}

#[tauri::command]
fn get_history() -> Result<std::collections::HashMap<String, TrackHistory>, String> {
    Ok(load_history())
}

#[tauri::command]
fn add_to_history(track: PlaylistTrack) -> Result<(), String> {
    let mut history = load_history();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();

    let entry = history.entry(track.id.clone()).or_insert_with(|| TrackHistory {
        id: track.id,
        title: track.title,
        artist: track.artist,
        album: track.album,
        image: track.image,
        duration_secs: track.duration_secs,
        play_timestamps: Vec::new(),
    });

    entry.play_timestamps.push(now);
    save_history(&history)
}

#[tauri::command]
fn clear_history() -> Result<(), String> {
    save_history(&std::collections::HashMap::new())
}

#[tauri::command]
fn import_history(history: std::collections::HashMap<String, TrackHistory>) -> Result<(), String> {
    save_history(&history)
}

#[tauri::command]
fn set_settings(input: SetSettingsPayload, state: State<AppState>) -> Result<AppSettings, String> {
    let mut settings = effective_settings(&state);
    if let Some(dir) = input.cache_dir {
        settings.cache_dir = if dir.trim().is_empty() {
            None
        } else {
            Some(dir)
        };
    }
    if let Some(dir) = input.download_dir {
        settings.download_dir = if dir.trim().is_empty() {
            None
        } else {
            Some(dir)
        };
    }

    validate_optional_dir_setting(&settings.cache_dir, "Cache folder")?;
    validate_optional_dir_setting(&settings.download_dir, "Downloads folder")?;

    if let Some(v) = input.spotify_client_id {
        settings.spotify_client_id = if v.trim().is_empty() { None } else { Some(v) };
    }
    if let Some(v) = input.spotify_client_secret {
        settings.spotify_client_secret = if v.trim().is_empty() { None } else { Some(v) };
    }
    if let Some(v) = input.lastfm_api_key {
        settings.lastfm_api_key = if v.trim().is_empty() { None } else { Some(v) };
    }
    persist_settings(&settings)?;
    let saved = load_settings_from_disk();
    *state.settings.lock().unwrap() = saved.clone();
    Ok(saved)
}

#[tauri::command]
fn pick_folder(title: String) -> Result<Option<String>, String> {
    let folder = rfd::FileDialog::new()
        .set_title(&title)
        .pick_folder();
    Ok(folder.map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
fn save_file_dialog(filename: String, content: String) -> Result<(), String> {
    if let Some(path) = rfd::FileDialog::new()
        .add_filter("JSON Files", &["json"])
        .set_file_name(&filename)
        .save_file()
    {
        std::fs::write(path, content).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn save_zip_file(filename: String, bytes: Vec<u8>) -> Result<(), String> {
    if let Some(path) = rfd::FileDialog::new()
        .add_filter("ZIP Archives", &["zip"])
        .set_file_name(&filename)
        .save_file()
    {
        std::fs::write(path, bytes).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn pick_json_file() -> Result<Option<String>, String> {
    if let Some(path) = rfd::FileDialog::new()
        .add_filter("JSON Files", &["json"])
        .pick_file()
    {
        let content = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
        return Ok(Some(content));
    }
    Ok(None)
}

#[tauri::command]
async fn fetch_track_metadata(
    artist: String,
    track: String,
    state: State<'_, AppState>,
) -> Result<TrackMetadata, String> {
    let merged = effective_settings(&state);
    let api_key = resolve_lastfm_api_key(&merged)?;
    let encoded_artist = urlencoding::encode(&artist);
    let encoded_track = urlencoding::encode(&track);

    let track_data = lastfm_get(
        &api_key,
        "track.getInfo",
        &format!("&artist={}&track={}", encoded_artist, encoded_track),
    )
    .await?;

    if track_data.get("error").is_some() {
        let msg = track_data
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("Unknown Last.fm error");
        return Err(msg.to_string());
    }

    let track_obj = track_data
        .get("track")
        .ok_or_else(|| "No track data in response".to_string())?;

    let title = track_obj
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or(&track)
        .to_string();
    let artist_name = track_obj
        .get("artist")
        .and_then(|a| a.get("name").and_then(|n| n.as_str()).or_else(|| a.as_str()))
        .unwrap_or(&artist)
        .to_string();

    let album_name = track_obj
        .get("album")
        .and_then(|a| a.get("title").and_then(|t| t.as_str()))
        .map(|s| s.to_string());

    let duration_secs = track_obj
        .get("duration")
        .and_then(|d| d.as_str())
        .and_then(|s| s.parse::<u64>().ok())
        .or_else(|| track_obj.get("duration").and_then(|d| d.as_u64()))
        .map(normalize_duration_secs);

    let listeners = track_obj
        .get("listeners")
        .and_then(|v| v.as_str().map(String::from).or_else(|| v.as_u64().map(|n| n.to_string())));
    let playcount = track_obj
        .get("playcount")
        .and_then(|v| v.as_str().map(String::from).or_else(|| v.as_u64().map(|n| n.to_string())));

    let url = track_obj
        .get("url")
        .and_then(|u| u.as_str())
        .map(String::from);

    let tags: Vec<String> = track_obj
        .get("toptags")
        .and_then(|t| t.get("tag"))
        .and_then(|tags| tags.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|tag| tag.get("name").and_then(|n| n.as_str()).map(String::from))
                .collect()
        })
        .unwrap_or_default();

    let wiki_summary = track_obj
        .get("wiki")
        .and_then(|w| w.get("summary").and_then(|s| s.as_str()))
        .map(|s| s.replace("<a href", "\n<a href"));

    let published = track_obj
        .get("album")
        .and_then(|a| a.get("published").and_then(|p| p.as_str()))
        .map(String::from);

    let mut track_images = parse_lastfm_images(track_obj.get("image"));
    if let Some(album_obj) = track_obj.get("album") {
        track_images.extend(parse_lastfm_images(album_obj.get("image")));
    }
    track_images = dedupe_images(track_images);

    let mut album_images = Vec::new();
    if let Some(ref album) = album_name {
        let encoded_album = urlencoding::encode(album);
        if let Ok(album_data) = lastfm_get(
            &api_key,
            "album.getInfo",
            &format!(
                "&artist={}&album={}",
                encoded_artist, encoded_album
            ),
        )
        .await
        {
            if album_data.get("error").is_none() {
                if let Some(album_obj) = album_data.get("album") {
                    album_images = parse_lastfm_images(album_obj.get("image"));
                    album_images = dedupe_images(album_images);
                }
            }
        }
    }

    Ok(TrackMetadata {
        title,
        artist: artist_name,
        album: album_name,
        duration_secs,
        listeners,
        playcount,
        url,
        published,
        tags,
        wiki_summary,
        track_images,
        album_images,
    })
}

/// Proxy HTTP GET requests to Last.fm from Rust.
#[tauri::command]
async fn fetch_lastfm(
    method: String,
    extra_params: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let settings = effective_settings(&state);
    let api_key = resolve_lastfm_api_key(&settings)?;

    let url = format!(
        "https://ws.audioscrobbler.com/2.0/?method={}&api_key={}&format=json{}",
        method, api_key, extra_params
    );

    let response = reqwest::get(&url)
        .await
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    let body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    Ok(body)
}

#[tauri::command]
async fn fetch_itunes_cover_art(artist: String, title: String) -> Result<Option<String>, String> {
    if artist.trim().is_empty() || title.trim().is_empty() {
        return Ok(None);
    }
    let query = format!("{} {}", artist, title);
    let url = format!(
        "https://itunes.apple.com/search?term={}&entity=song&limit=1",
        urlencoding::encode(&query)
    );

    let response = reqwest::get(&url)
        .await
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    if !response.status().is_success() {
        return Ok(None);
    }

    let data: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    let art_url = data
        .get("results")
        .and_then(|r| r.as_array())
        .and_then(|a| a.first())
        .and_then(|track| track.get("artworkUrl100"))
        .and_then(|u| u.as_str())
        .map(|u| u.to_string());

    Ok(art_url)
}

#[tauri::command]
async fn fetch_itunes_preview(artist: String, title: String) -> Result<Option<String>, String> {
    if artist.trim().is_empty() || title.trim().is_empty() {
        return Ok(None);
    }
    let query = format!("{} {}", artist, title);
    let url = format!(
        "https://itunes.apple.com/search?term={}&entity=song&limit=1",
        urlencoding::encode(&query)
    );

    let response = reqwest::get(&url)
        .await
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    if !response.status().is_success() {
        return Ok(None);
    }

    let data: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    let preview_url = data
        .get("results")
        .and_then(|r| r.as_array())
        .and_then(|a| a.first())
        .and_then(|track| track.get("previewUrl"))
        .and_then(|u| u.as_str())
        .map(|u| u.to_string());

    Ok(preview_url)
}

const YTDLP_AUDIO_FORMAT: &str = "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio";

fn ytmusic_script_path() -> PathBuf {
    if let Ok(manifest) = std::env::var("CARGO_MANIFEST_DIR") {
        let p = PathBuf::from(manifest).join("src").join("ytmusic_search.py");
        if p.is_file() {
            return p;
        }
    }
    if let Some(handle) = APP_HANDLE.get() {
        if let Ok(p) = handle.path().resolve(
            "src/ytmusic_search.py",
            tauri::path::BaseDirectory::Resource,
        ) {
            if p.is_file() {
                return p;
            }
        }
    }
    PathBuf::new()
}

/// Resolve a text query to a YouTube URL or ytsearch string (shared by cache + live stream).
fn resolve_youtube_query(
    query: &str,
    title: Option<&str>,
    artist: Option<&str>,
    duration_secs: Option<u64>,
) -> String {
    let q = query.trim();
    if q.starts_with("http://") || q.starts_with("https://") || q.starts_with("spotify:") {
        return q.replace("music.youtube.com", "www.youtube.com");
    }

    let mut resolved = format!("ytsearch1:{} audio", q);
    let script_path = ytmusic_script_path();
    if !script_path.is_file() {
        return resolved;
    }

    let mut py_cmd = Command::new("python");
    py_cmd
        .arg(&script_path)
        .arg(q)
        .arg(title.unwrap_or(""))
        .arg(artist.unwrap_or(""));
    if let Some(dur) = duration_secs {
        py_cmd.arg(dur.to_string());
    }
    configure_command_env(&mut py_cmd);

    if let Ok(output) = py_cmd.output() {
        if output.status.success() {
            let stdout_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if stdout_str.len() == 11
                && stdout_str
                    .chars()
                    .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
            {
                resolved = format!("https://www.youtube.com/watch?v={}", stdout_str);
            }
        }
    }
    resolved
}

fn ytdlp_needs_transcode(stderr: &str) -> bool {
    let s = stderr.to_lowercase();
    s.contains("ffprobe")
        || s.contains("ffmpeg")
        || s.contains("codec")
        || s.contains("postprocess")
        || s.contains("merging")
}

fn run_ytdlp_cache_download(yt_query: &str, out_template: &str) -> Result<(), String> {
    let mut fast_cmd = if let Some(bin_path) = get_bundled_bin_path("yt-dlp") {
        let mut c = Command::new(bin_path);
        c.arg(yt_query);
        configure_command_env(&mut c);
        c
    } else {
        let mut c = Command::new("python");
        c.arg("-m").arg("yt_dlp").arg(yt_query);
        configure_command_env(&mut c);
        c
    };

    if let Some(ffmpeg_path) = get_bundled_bin_path("ffmpeg") {
        if let Some(parent) = ffmpeg_path.parent() {
            fast_cmd.arg("--ffmpeg-location").arg(parent);
        }
    }

    let fast_output = fast_cmd
        .arg("-f")
        .arg(YTDLP_AUDIO_FORMAT)
        .arg("--no-playlist")
        .arg("--no-warnings")
        .arg("--fixup")
        .arg("never")
        .arg("--no-part")
        .arg("--output")
        .arg(out_template)
        .output()
        .map_err(|e| format!("Failed to execute yt-dlp: {}", e))?;

    if fast_output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&fast_output.stderr);
    if !ytdlp_needs_transcode(&stderr) {
        let stdout = String::from_utf8_lossy(&fast_output.stdout);
        return Err(format!("yt-dlp failed:\n{}\n{}", stderr, stdout));
    }

    let mut transcode_cmd = if let Some(bin_path) = get_bundled_bin_path("yt-dlp") {
        let mut c = Command::new(bin_path);
        c.arg(yt_query);
        configure_command_env(&mut c);
        c
    } else {
        let mut c = Command::new("python");
        c.arg("-m").arg("yt_dlp").arg(yt_query);
        configure_command_env(&mut c);
        c
    };

    if let Some(ffmpeg_path) = get_bundled_bin_path("ffmpeg") {
        if let Some(parent) = ffmpeg_path.parent() {
            transcode_cmd.arg("--ffmpeg-location").arg(parent);
        }
    }

    let transcode_output = transcode_cmd
        .arg("-f")
        .arg("bestaudio")
        .arg("-x")
        .arg("--audio-format")
        .arg("m4a")
        .arg("--no-playlist")
        .arg("--no-warnings")
        .arg("--fixup")
        .arg("never")
        .arg("--no-part")
        .arg("--output")
        .arg(out_template)
        .output()
        .map_err(|e| format!("Failed to execute yt-dlp transcode: {}", e))?;

    if transcode_output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&transcode_output.stderr);
    let stdout = String::from_utf8_lossy(&transcode_output.stdout);
    Err(format!("yt-dlp failed:\n{}\n{}", stderr, stdout))
}

/// Download a song to the cache directory for streaming.
#[tauri::command]
async fn stream_song(
    query: String,
    title: Option<String>,
    artist: Option<String>,
    duration_secs: Option<u64>,
    fetch_if_missing: Option<bool>,
    state: State<'_, AppState>,
) -> Result<StreamResult, String> {
    use std::hash::{Hash, Hasher};
    use std::collections::hash_map::DefaultHasher;

    let settings = state.settings.lock().unwrap().clone();
    let cache_dir = resolve_cache_dir(&settings);
    check_dir_writable(&cache_dir).map_err(|e| format!("Cache storage error: {}", e))?;

    if let Some(path) = resolve_existing_playback_file(
        &settings,
        &query,
        artist.as_deref(),
        title.as_deref(),
    ) {
        return Ok(stream_result_from_path(&path));
    }

    if fetch_if_missing == Some(false) {
        return Err("Track not available locally".to_string());
    }

    let mut hasher = DefaultHasher::new();
    query.hash(&mut hasher);
    let hash_str = format!("{:x}", hasher.finish());

    let yt_query = resolve_youtube_query(
        &query,
        title.as_deref(),
        artist.as_deref(),
        duration_secs,
    );

    let out_template = format!("{}/{}.%(ext)s", cache_dir.to_str().unwrap(), hash_str);
    run_ytdlp_cache_download(&yt_query, &out_template)?;

    let files: Vec<_> = std::fs::read_dir(&cache_dir)
        .map_err(|e| format!("Cannot read cache dir: {}", e))?
        .filter_map(|e| e.ok())
        .filter(|e| is_audio_file(&e.path()) && e.path().file_stem().and_then(|s| s.to_str()) == Some(&hash_str))
        .collect();

    let file_path = files
        .first()
        .map(|f| f.path())
        .ok_or_else(|| "No audio file found after download".to_string())?;

    let file_name = file_path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    Ok(StreamResult {
        file_path: file_path.to_string_lossy().to_string(),
        file_name,
    })
}

/// Copy a cached song to the permanent download directory.
#[tauri::command]
async fn save_song(cached_path: String, state: State<'_, AppState>) -> Result<String, String> {
    save_song_internal(cached_path, None, state).await
}

/// Save with embedded metadata and library index entry.
#[tauri::command]
async fn save_song_with_metadata(
    cached_path: String,
    metadata: TrackMetadata,
    state: State<'_, AppState>,
) -> Result<String, String> {
    save_song_internal(cached_path, Some(metadata), state).await
}

async fn save_song_internal(
    cached_path: String,
    metadata: Option<TrackMetadata>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let settings = state.settings.lock().unwrap().clone();
    let src = PathBuf::from(&cached_path);
    if !src.is_file() {
        return Err("Source file not found".to_string());
    }

    let dl_dir = resolve_download_dir(&settings);
    check_dir_writable(&dl_dir).map_err(|e| format!("Download storage error: {}", e))?;
    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("mp3");

    let filename = if let Some(ref meta) = metadata {
        let name = format!(
            "{} - {}.{}",
            sanitize_filename(&meta.artist),
            sanitize_filename(&meta.title),
            ext
        );
        name
    } else {
        src.file_name()
            .ok_or("Invalid file path")?
            .to_string_lossy()
            .to_string()
    };

    let dest = dl_dir.join(&filename);
    std::fs::copy(&src, &dest).map_err(|e| format!("Failed to save: {}", e))?;

    if let Some(meta) = metadata {
        if let Err(e) = embed_metadata_file(&dest, &meta) {
            eprintln!("Warning: Failed to embed metadata to {}: {}", dest.display(), e);
        }
        let key = track_key(&meta.artist, &meta.title);
        let mut index = load_download_index(&settings);
        index.insert(key, filename);
        let _ = save_download_index(&settings, &index);
    }

    Ok(dest.to_string_lossy().to_string())
}

#[tauri::command]
fn is_track_downloaded(artist: String, title: String, state: State<AppState>) -> bool {
    let settings = state.settings.lock().unwrap().clone();
    let key = track_key(&artist, &title);
    let index = load_download_index(&settings);
    if let Some(filename) = index.get(&key) {
        let path = resolve_download_dir(&settings).join(filename);
        return path.is_file();
    }
    false
}

#[tauri::command]
fn get_downloaded_keys(state: State<AppState>) -> Vec<String> {
    let settings = state.settings.lock().unwrap().clone();
    load_download_index(&settings).into_keys().collect()
}
#[tauri::command]
fn get_download_index(state: State<'_, AppState>) -> std::collections::HashMap<String, String> {
    let settings = state.settings.lock().unwrap().clone();
    load_download_index(&settings)
}

#[tauri::command]
fn delete_downloaded_song(key: String, state: State<'_, AppState>) -> Result<(), String> {
    let settings = state.settings.lock().unwrap().clone();
    let mut index = load_download_index(&settings);
    if let Some(filename) = index.remove(&key) {
        let download_dir = resolve_download_dir(&settings);
        let file_path = download_dir.join(&filename);
        if file_path.exists() {
            std::fs::remove_file(file_path).map_err(|e| format!("Failed to delete file: {}", e))?;
        }
        let _ = save_download_index(&settings, &index);
        Ok(())
    } else {
        Err("Song not found in index".to_string())
    }
}

#[tauri::command]
fn delete_all_downloads(state: State<'_, AppState>) -> Result<(), String> {
    let settings = state.settings.lock().unwrap().clone();
    let index = load_download_index(&settings);
    let download_dir = resolve_download_dir(&settings);
    for filename in index.values() {
        let file_path = download_dir.join(filename);
        if file_path.exists() {
            let _ = std::fs::remove_file(file_path);
        }
    }
    let _ = save_download_index(&settings, &std::collections::HashMap::new());
    Ok(())
}

#[derive(Serialize)]
struct DownloadItemInfo {
    key: String,
    filename: String,
    size_bytes: u64,
}

#[derive(Serialize)]
struct DownloadsInfo {
    total_size_bytes: u64,
    items: Vec<DownloadItemInfo>,
}

#[tauri::command]
fn get_downloads_info(state: State<'_, AppState>) -> Result<DownloadsInfo, String> {
    let settings = state.settings.lock().unwrap().clone();
    let _ = rebuild_download_index_from_disk(&settings);
    let index = load_download_index(&settings);
    let download_dir = resolve_download_dir(&settings);
    
    let mut items = Vec::new();
    let mut total_size_bytes = 0;
    
    for (key, filename) in index {
        let path = download_dir.join(&filename);
        let size_bytes = if path.is_file() {
            std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0)
        } else {
            0
        };
        total_size_bytes += size_bytes;
        items.push(DownloadItemInfo {
            key,
            filename,
            size_bytes,
        });
    }
    
    Ok(DownloadsInfo {
        total_size_bytes,
        items,
    })
}

#[tauri::command]
fn open_downloads_directory(state: State<'_, AppState>) -> Result<(), String> {
    let settings = state.settings.lock().unwrap().clone();
    let download_dir = resolve_download_dir(&settings);
    
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&download_dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&download_dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&download_dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    
    Ok(())
}

#[tauri::command]
fn open_cache_directory(state: State<'_, AppState>) -> Result<(), String> {
    let settings = state.settings.lock().unwrap().clone();
    let cache_dir = resolve_cache_dir(&settings);

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&cache_dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&cache_dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&cache_dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[derive(Serialize)]
struct StoragePathsStatus {
    cache_dir: String,
    download_dir: String,
    cache_error: Option<String>,
    download_error: Option<String>,
}

#[tauri::command]
fn get_storage_paths_status(state: State<'_, AppState>) -> Result<StoragePathsStatus, String> {
    let settings = state.settings.lock().unwrap().clone();
    let cache_dir = resolve_cache_dir(&settings);
    let download_dir = resolve_download_dir(&settings);
    let cache_error = check_dir_writable(&cache_dir).err();
    let download_error = check_dir_writable(&download_dir).err();
    Ok(StoragePathsStatus {
        cache_dir: cache_dir.to_string_lossy().to_string(),
        download_dir: download_dir.to_string_lossy().to_string(),
        cache_error,
        download_error,
    })
}

#[tauri::command]
fn rebuild_download_library(state: State<'_, AppState>) -> Result<usize, String> {
    let settings = state.settings.lock().unwrap().clone();
    rebuild_download_index_from_disk(&settings)
}

#[derive(serde::Serialize)]
struct DependencyStatus {
    python: bool,
    yt_dlp: bool,
    syncedlyrics: bool,
    spotdl: bool,
    python_version: String,
}

#[tauri::command]
fn check_system_dependencies() -> DependencyStatus {
    let mut status = DependencyStatus {
        python: false,
        yt_dlp: false,
        syncedlyrics: false,
        spotdl: false,
        python_version: "Not found".to_string(),
    };

    // First check if we have bundled standalone binaries
    let has_bundled_ytdlp = get_bundled_bin_path("yt-dlp").is_some();
    let has_bundled_spotdl = get_bundled_bin_path("spotdl").is_some();
    let has_bundled_spotify_query = get_bundled_bin_path("spotify_query").is_some();
    let has_bundled_embed_metadata = get_bundled_bin_path("embed_metadata").is_some();

    if has_bundled_ytdlp {
        status.yt_dlp = true;
    }
    if has_bundled_spotdl {
        status.spotdl = true;
    }
    if has_bundled_spotify_query && has_bundled_embed_metadata {
        status.python = true;
        status.python_version = "Bundled Standalone Runtime".to_string();
        status.syncedlyrics = true;
    }

    // 1. Check Python and version if not bundled
    if !status.python {
        let mut c = std::process::Command::new("python");
        c.arg("--version");
        configure_command_env(&mut c);
        if let Ok(output) = c.output() {
            if output.status.success() {
                status.python = true;
                let ver_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
                status.python_version = if ver_str.is_empty() {
                    String::from_utf8_lossy(&output.stderr).trim().to_string()
                } else {
                    ver_str
                };
            }
        }
    }

    // 2. Check yt-dlp module if not bundled
    if !status.yt_dlp {
        let mut c = std::process::Command::new("python");
        c.arg("-m").arg("yt_dlp").arg("--version");
        configure_command_env(&mut c);
        if let Ok(output) = c.output() {
            status.yt_dlp = output.status.success();
        }
    }

    // 3. Check syncedlyrics module if not bundled
    if !status.syncedlyrics {
        let mut c = std::process::Command::new("python");
        c.arg("-c").arg("import syncedlyrics");
        configure_command_env(&mut c);
        if let Ok(output) = c.output() {
            status.syncedlyrics = output.status.success();
        }
    }

    // 4. Check spotdl module if not bundled
    if !status.spotdl {
        let local_spotdl = std::path::Path::new("../spotdl").is_dir() || std::path::Path::new("spotdl").is_dir();
        if local_spotdl {
            status.spotdl = true;
        } else {
            let mut c = std::process::Command::new("python");
            c.arg("-c").arg("import spotdl");
            configure_command_env(&mut c);
            if let Ok(output) = c.output() {
                status.spotdl = output.status.success();
            }
        }
    }

    status
}

fn get_dir_size(path: &std::path::Path) -> std::io::Result<u64> {
    let mut size = 0;
    if path.is_dir() {
        for entry in std::fs::read_dir(path)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_dir() {
                size += get_dir_size(&path)?;
            } else {
                size += entry.metadata()?.len();
            }
        }
    }
    Ok(size)
}

#[tauri::command]
fn get_cache_size(state: State<'_, AppState>) -> Result<u64, String> {
    let settings = state.settings.lock().unwrap().clone();
    let cache_dir = resolve_cache_dir(&settings);
    check_dir_writable(&cache_dir)?;
    get_dir_size(&cache_dir).map_err(|e| e.to_string())
}

#[tauri::command]
fn clear_cache(state: State<'_, AppState>) -> Result<(), String> {
    let settings = state.settings.lock().unwrap().clone();
    let cache_dir = resolve_cache_dir(&settings);
    if cache_dir.exists() {
        std::fs::remove_dir_all(&cache_dir).map_err(|e| e.to_string())?;
        std::fs::create_dir_all(&cache_dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}
#[tauri::command]
fn get_cache_path(state: State<AppState>) -> String {
    let settings = state.settings.lock().unwrap().clone();
    resolve_cache_dir(&settings).to_string_lossy().to_string()
}

#[tauri::command]
fn get_download_path(state: State<AppState>) -> String {
    let settings = state.settings.lock().unwrap().clone();
    resolve_download_dir(&settings).to_string_lossy().to_string()
}

/// Legacy download command (kept for compatibility).
#[tauri::command]
async fn download_song(query: String, state: State<'_, AppState>) -> Result<SongResult, String> {
    let settings = state.settings.lock().unwrap().clone();
    let dl_dir = resolve_download_dir(&settings);
    let yt_query = if query.trim().starts_with("http://") || query.trim().starts_with("https://") {
        query.trim().replace("music.youtube.com", "www.youtube.com")
    } else {
        format!("ytsearch1:{} audio", query)
    };
    let out_template = format!("{}/%(title)s.%(ext)s", dl_dir.to_str().unwrap());

    let mut cmd = if let Some(bin_path) = get_bundled_bin_path("yt-dlp") {
        let mut c = Command::new(bin_path);
        c.arg(&yt_query);
        configure_command_env(&mut c);
        c
    } else {
        let mut c = Command::new("python");
        c.arg("-m").arg("yt_dlp").arg(&yt_query);
        configure_command_env(&mut c);
        c
    };

    let output = cmd
        .arg("-x")
        .arg("--audio-format")
        .arg("mp3")
        .arg("--output")
        .arg(&out_template)
        .output()
        .map_err(|e| format!("Failed to execute yt-dlp: {}", e))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        if err.contains("ffprobe") || err.contains("ffmpeg") || err.contains("codec") {
            println!("FFmpeg/FFprobe missing. Falling back to raw bestaudio download.");
            let mut fallback_cmd = if let Some(bin_path) = get_bundled_bin_path("yt-dlp") {
                let mut c = Command::new(bin_path);
                c.arg(&yt_query);
                configure_command_env(&mut c);
                c
            } else {
                let mut c = Command::new("python");
                c.arg("-m").arg("yt_dlp").arg(&yt_query);
                configure_command_env(&mut c);
                c
            };
            let fallback_output = fallback_cmd
                .arg("-f")
                .arg("bestaudio[ext=m4a]/bestaudio")
                .arg("--output")
                .arg(&out_template)
                .output()
                .map_err(|e| format!("Failed to execute fallback yt-dlp: {}", e))?;

            if !fallback_output.status.success() {
                let fallback_err = String::from_utf8_lossy(&fallback_output.stderr);
                return Err(format!("Download failed even with fallback:\n{}", fallback_err));
            }
        } else {
            return Err(format!("Download failed: {}", err));
        }
    }

    let mut lyrics_cmd = Command::new("python");
    lyrics_cmd.arg("-c").arg(format!(
        "import syncedlyrics; print(syncedlyrics.search('{}') or 'No lyrics found.')",
        query.replace("'", "\\'")
    ));
    configure_command_env(&mut lyrics_cmd);
    let lyrics_output = lyrics_cmd.output();

    let lyrics = match lyrics_output {
        Ok(out) if out.status.success() => String::from_utf8_lossy(&out.stdout).trim().to_string(),
        _ => "Lyrics extraction failed or not found.".to_string(),
    };

    Ok(SongResult {
        title: query,
        lyrics,
    })
}

#[tauri::command]
async fn read_audio_file(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| format!("Failed to read file: {}", e))
}

#[tauri::command]
async fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| format!("Failed to read file: {}", e))
}

fn find_first_audio_file(root: &std::path::Path, candidates: &[&str]) -> Option<PathBuf> {
    if !root.exists() {
        return None;
    }

    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let entries = std::fs::read_dir(&dir).ok()?;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }
            if let Some(name) = path.file_name().and_then(|s| s.to_str()) {
                if candidates.iter().any(|candidate| name.eq_ignore_ascii_case(candidate)) {
                    return Some(path);
                }
            }
        }
    }

    None
}

#[derive(Serialize, Deserialize)]
struct KaraokeStemResult {
    source_path: String,
    instrumental_path: String,
    vocals_path: Option<String>,
    output_dir: String,
    model: String,
}

#[tauri::command]
async fn prepare_karaoke_stems(
    query: String,
    title: Option<String>,
    artist: Option<String>,
    duration_secs: Option<u64>,
    cache_path: Option<String>,
    state: State<'_, AppState>,
) -> Result<KaraokeStemResult, String> {
    let source_path = if let Some(path) = cache_path
        .as_deref()
        .filter(|p| !p.trim().is_empty())
        .map(PathBuf::from)
        .filter(|p| p.exists())
    {
        path
    } else {
        let stream = stream_song(
            query.clone(),
            title.clone(),
            artist.clone(),
            duration_secs,
            Some(true),
            state,
        )
        .await?;
        PathBuf::from(stream.file_path)
    };

    let mut hasher = DefaultHasher::new();
    source_path.to_string_lossy().hash(&mut hasher);
    let cache_key = format!("{:x}", hasher.finish());
    let output_dir = std::env::temp_dir()
        .join("spoti-tauri-karaoke")
        .join(cache_key);
    std::fs::create_dir_all(&output_dir).map_err(|e| e.to_string())?;

    if let Some(instrumental) = find_first_audio_file(
        &output_dir,
        &["no_vocals.wav", "instrumental.wav", "accompaniment.wav"],
    ) {
        return Ok(KaraokeStemResult {
            source_path: source_path.to_string_lossy().to_string(),
            instrumental_path: instrumental.to_string_lossy().to_string(),
            vocals_path: find_first_audio_file(&output_dir, &["vocals.wav"])
                .map(|p| p.to_string_lossy().to_string()),
            output_dir: output_dir.to_string_lossy().to_string(),
            model: "cached".to_string(),
        });
    }

    let source_str = source_path.to_string_lossy().to_string();
    let demucs_available = std::process::Command::new("python")
        .arg("-c")
        .arg("import demucs")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false);
    let model_name = if demucs_available { "demucs" } else { "spleeter" };

    let mut cmd = std::process::Command::new("python");
    if demucs_available {
        cmd.arg("-m")
            .arg("demucs")
            .arg("--two-stems=vocals")
            .arg("-o")
            .arg(&output_dir)
            .arg(&source_str);
    } else {
        cmd.arg("-m")
            .arg("spleeter")
            .arg("separate")
            .arg("-p")
            .arg("spleeter:2stems")
            .arg("-o")
            .arg(&output_dir)
            .arg(&source_str);
    }
    configure_command_env(&mut cmd);

    let output = cmd.output().map_err(|e| format!("Failed to run vocal separation: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Vocal separation failed ({}):\n{}", model_name, stderr));
    }

    let instrumental = find_first_audio_file(
        &output_dir,
        &["no_vocals.wav", "instrumental.wav", "accompaniment.wav"],
    )
    .ok_or_else(|| "Karaoke stems were generated, but no instrumental track was found.".to_string())?;

    Ok(KaraokeStemResult {
        source_path: source_str,
        instrumental_path: instrumental.to_string_lossy().to_string(),
        vocals_path: find_first_audio_file(&output_dir, &["vocals.wav"])
            .map(|p| p.to_string_lossy().to_string()),
        output_dir: output_dir.to_string_lossy().to_string(),
        model: model_name.to_string(),
    })
}

/// Resolve Spotify URLs / playlist: queries via spotDL Python bridge.
#[tauri::command]
async fn spotify_search(query: String, state: State<'_, AppState>) -> Result<String, String> {
    let settings = effective_settings(&state);
    if !spotify_is_configured(&settings) {
        return Err(
            "Spotify is not configured. Add Client ID and Secret in Settings.".to_string(),
        );
    }
    let mut cmd = if std::env::var("CARGO_MANIFEST_DIR").is_err() && get_bundled_bin_path("spotify_query").is_some() {
        let bin_path = get_bundled_bin_path("spotify_query").unwrap();
        let mut c = Command::new(bin_path);
        c.arg(&query);
        configure_command_env(&mut c);
        c
    } else {
        let script = resolve_spotify_script()
            .ok_or_else(|| "spotify_query.py not found in scripts/".to_string())?;
        let mut c = Command::new("python");
        c.arg(&script).arg(&query);
        configure_command_env(&mut c);
        c
    };
    for (k, v) in spotify_env_from_settings(&settings) {
        cmd.env(k, v);
    }

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to run spotify_query: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if let Ok(val) = serde_json::from_str::<Value>(&stdout) {
            if let Some(err) = val.get("error").and_then(|e| e.as_str()) {
                return Err(err.to_string());
            }
        }
        return Err(format!("Spotify query failed: {}\n{}", stderr, stdout));
    }

    Ok(stdout)
}

/// Download and cache album art; returns local file path.
#[tauri::command]
async fn cache_art_image(url: String, state: State<'_, AppState>) -> Result<String, String> {
    if url.is_empty() || url.contains(LASTFM_PLACEHOLDER) {
        return Err("Invalid image URL".to_string());
    }

    let settings = state.settings.lock().unwrap().clone();
    let cache_dir = art_cache_dir(&settings);
    let ext = if url.contains(".png") { "png" } else { "jpg" };
    let path = cache_dir.join(format!("{}.{}", hash_url(&url), ext));

    if path.is_file() {
        return Ok(path.to_string_lossy().to_string());
    }

    let response = reqwest::get(&url)
        .await
        .map_err(|e| format!("Failed to download art: {}", e))?;
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read art bytes: {}", e))?;

    std::fs::write(&path, &bytes).map_err(|e| format!("Failed to write art cache: {}", e))?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn load_playlists() -> Result<Vec<UserPlaylist>, String> {
    let path = playlists_file();
    if !path.exists() {
        return Ok(Vec::new());
    }
    let data = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&data).map_err(|e| format!("Invalid playlists file: {}", e))
}

#[tauri::command]
fn save_playlists(playlists: Vec<UserPlaylist>) -> Result<(), String> {
    let json =
        serde_json::to_string_pretty(&playlists).map_err(|e| format!("Serialize: {}", e))?;
    std::fs::write(playlists_file(), json).map_err(|e| format!("Write playlists: {}", e))
}

// Re-export best_image for tests if needed
#[allow(dead_code)]
fn pick_best_from_metadata(meta: &TrackMetadata) -> Option<String> {
    best_image_url(&meta.album_images)
        .or_else(|| best_image_url(&meta.track_images))
}

use axum::{extract::Query, response::IntoResponse, routing::get, Router};
use tower_http::cors::CorsLayer;
use tokio_util::io::ReaderStream;
use axum::body::Body;

#[derive(serde::Deserialize)]
struct StreamQuery {
    q: String,
    title: Option<String>,
    artist: Option<String>,
    duration: Option<u64>,
}

async fn stream_handler(Query(params): Query<StreamQuery>) -> impl IntoResponse {
    let yt_query = resolve_youtube_query(
        &params.q,
        params.title.as_deref(),
        params.artist.as_deref(),
        params.duration,
    );

    let mut cmd = if let Some(bin_path) = get_bundled_bin_path("yt-dlp") {
        let mut c = tokio::process::Command::new(bin_path);
        c.arg(&yt_query);
        configure_tokio_command_env(&mut c);
        c
    } else {
        let mut c = tokio::process::Command::new("python");
        c.arg("-m").arg("yt_dlp").arg(&yt_query);
        configure_tokio_command_env(&mut c);
        c
    };

    let mut child = cmd
        .arg("-f")
        .arg(YTDLP_AUDIO_FORMAT)
        .arg("--no-playlist")
        .arg("--no-warnings")
        .arg("-o")
        .arg("-")
        .stdout(std::process::Stdio::piped())
        .spawn()
        .expect("failed to spawn yt-dlp");

    let stdout = child.stdout.take().unwrap();
    let stream = ReaderStream::new(stdout);
    let body = Body::from_stream(stream);

    axum::response::Response::builder()
        .header("Content-Type", "audio/mp4")
        .header("Transfer-Encoding", "chunked")
        .body(body)
        .unwrap()
}

fn start_stream_server() {
    tauri::async_runtime::spawn(async {
        let app = Router::new()
            .route("/stream", get(stream_handler))
            .layer(CorsLayer::permissive());
        
        let listener = tokio::net::TcpListener::bind("127.0.0.1:8000").await.unwrap();
        axum::serve(listener, app).await.unwrap();
    });
}

// ---------- Discord Rich Presence ----------

/// Discord Application ID — create one at https://discord.com/developers/applications
const DISCORD_APP_ID: &str = "1506321943635427329";

fn init_discord_rpc() -> Option<DiscordIpcClient> {
    let mut client = DiscordIpcClient::new(DISCORD_APP_ID).ok()?;
    if client.connect().is_ok() {
        // Set initial idle presence
        let _ = client.set_activity(
            activity::Activity::new()
                .state("Idle")
                .details("Browsing music")
                .activity_type(activity::ActivityType::Listening)
                .assets(
                    activity::Assets::new()
                        .large_image("app_icon")
                        .large_text("SpotDL Desktop"),
                ),
        );
        Some(client)
    } else {
        None
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiscordPresencePayload {
    title: String,
    artist: String,
    #[allow(dead_code)]
    album: Option<String>,
    image_url: Option<String>,
    #[serde(default)]
    paused: bool,
}

#[tauri::command]
fn discord_update_presence(payload: DiscordPresencePayload, state: State<AppState>) -> Result<(), String> {
    let mut guard = state.discord_rpc.lock().unwrap();
    if guard.is_none() {
        // Try to connect if not already
        *guard = init_discord_rpc();
    }
    if let Some(client) = guard.as_mut() {
        let details = payload.title.clone();
        let state_text = format!("by {}", payload.artist);

        let large_img = payload.image_url.as_deref().unwrap_or("app_icon");

        let act = activity::Activity::new()
            .details(&details)
            .state(&state_text)
            .activity_type(activity::ActivityType::Listening)
            .assets(
                activity::Assets::new()
                    .large_image(large_img)
                    .large_text(&payload.title)
                    .small_image("app_icon")
                    .small_text(if payload.paused { "Paused" } else { "Playing" }),
            );

        client.set_activity(act).map_err(|e| format!("Discord RPC: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
fn discord_clear_presence(state: State<AppState>) -> Result<(), String> {
    let mut guard = state.discord_rpc.lock().unwrap();
    if let Some(client) = guard.as_mut() {
        let _ = client.clear_activity();
    }
    Ok(())
}

// ---------- App Entry ----------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let settings = load_settings_from_disk();
    let discord = init_discord_rpc();

    tauri::Builder::default()
        .setup(|app| {
            let _ = APP_HANDLE.set(app.handle().clone());
            start_stream_server();
            // Auto-open devtools in debug builds
            #[cfg(debug_assertions)]
            {
                if let Some(window) = app.get_webview_window("main") {
                    window.open_devtools();
                }
            }
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(AppState {
            settings: Mutex::new(settings),
            discord_rpc: Mutex::new(discord),
        })
        .invoke_handler(tauri::generate_handler![
            download_song,
            get_geo_country,
            window_minimize,
            window_toggle_maximize,
            window_close,
            get_api_key,
            fetch_lastfm,
            fetch_itunes_cover_art,
            fetch_itunes_preview,
            fetch_lyrics,
            fetch_lyrics_payload,
            fetch_track_metadata,
            spotify_search,
            cache_art_image,
            stream_song,
            prepare_karaoke_stems,
            save_song,
            save_song_with_metadata,
            is_track_downloaded,
            get_downloaded_keys,
            get_download_index,
            get_downloads_info,
            open_downloads_directory,
            open_cache_directory,
            get_storage_paths_status,
            rebuild_download_library,
            delete_downloaded_song,
            delete_all_downloads,
            check_system_dependencies,
            get_cache_size,
            clear_cache,
            get_cache_path,
            get_download_path,
            get_settings,
            get_api_status,
            set_settings,
            pick_folder,
            save_file_dialog,
            save_zip_file,
            pick_json_file,
            read_audio_file,
            read_file_bytes,
            load_playlists,
            save_playlists,
            discord_update_presence,
            discord_clear_presence,
            get_history,
            add_to_history,
            clear_history,
            import_history,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
