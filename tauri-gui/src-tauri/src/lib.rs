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

const LASTFM_PLACEHOLDER: &str = "2a96cbd8b46e442fc41c2b86b821562f";

#[derive(Serialize, Deserialize)]
pub struct SongResult {
    title: String,
    lyrics: String,
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

pub struct AppState {
    pub settings: Mutex<AppSettings>,
}

// ---------- Helpers ----------

fn settings_file() -> PathBuf {
    let mut path = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    path.push("spotdl-gui");
    let _ = std::fs::create_dir_all(&path);
    path.push("settings.json");
    path
}

fn load_settings_from_disk() -> AppSettings {
    let path = settings_file();
    if !path.exists() {
        return AppSettings::default();
    }
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
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
    let mut cache = settings
        .cache_dir
        .as_ref()
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .or_else(dirs::cache_dir)
        .unwrap_or_else(|| PathBuf::from("."));
    if settings.cache_dir.is_none() {
        cache.push("spotdl-gui");
    }
    let _ = std::fs::create_dir_all(&cache);
    cache
}

fn resolve_download_dir(settings: &AppSettings) -> PathBuf {
    let mut dl = settings
        .download_dir
        .as_ref()
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .or_else(dirs::audio_dir)
        .or_else(dirs::download_dir)
        .unwrap_or_else(|| PathBuf::from("."));
    if settings.download_dir.is_none() {
        dl.push("SpotDL");
    }
    let _ = std::fs::create_dir_all(&dl);
    dl
}

fn is_audio_file(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|ext| matches!(ext, "mp3" | "m4a" | "ogg" | "opus" | "flac" | "wav"))
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

fn download_index_path(settings: &AppSettings) -> PathBuf {
    resolve_download_dir(settings).join(".spotdl-gui-library.json")
}

fn load_download_index(settings: &AppSettings) -> HashMap<String, String> {
    let path = download_index_path(settings);
    if !path.exists() {
        return HashMap::new();
    }
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
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
        .or_else(|| env::var("SPOTIFY_CLIENT_ID").ok());
    let secret = settings
        .spotify_client_secret
        .clone()
        .filter(|s| !s.is_empty())
        .or_else(|| env::var("SPOTIFY_CLIENT_SECRET").ok());
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
    let script = resolve_embed_script()
        .ok_or_else(|| "embed_metadata.py not found in scripts/".to_string())?;

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

    let output = Command::new("python")
        .arg(&script)
        .arg(audio_path)
        .arg(&json_str)
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
        .filter(|s| !s.is_empty());
    let secret = settings
        .spotify_client_secret
        .as_ref()
        .filter(|s| !s.is_empty())
        .cloned()
        .or_else(|| env::var("SPOTIFY_CLIENT_SECRET").ok())
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

/// Try LRCLIB (free, no key) when lyrics.ovh has no match.
async fn try_lrclib_lyrics(client: &reqwest::Client, artist: &str, title: &str) -> Option<String> {
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

/// Free lyrics: try api.lyrics.ovh, then LRCLIB (lrclib.net).
#[tauri::command]
async fn fetch_lyrics(artist: String, title: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(18))
        .user_agent("SpotDL-GUI/1.0 (https://github.com)")
        .build()
        .map_err(|e| e.to_string())?;

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
                            return Ok(ly.to_string());
                        }
                    }
                }
            }
        }
    }

    if let Some(ly) = try_lrclib_lyrics(&client, &artist, &title).await {
        return Ok(ly);
    }

    Err("No lyrics found (tried lyrics.ovh and LRCLIB).".to_string())
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

/// Download a song to the cache directory for streaming.
#[tauri::command]
async fn stream_song(query: String, state: State<'_, AppState>) -> Result<StreamResult, String> {
    use std::hash::{Hash, Hasher};
    use std::collections::hash_map::DefaultHasher;

    let settings = state.settings.lock().unwrap().clone();
    let cache_dir = resolve_cache_dir(&settings);

    let mut hasher = DefaultHasher::new();
    query.hash(&mut hasher);
    let hash_str = format!("{:x}", hasher.finish());

    // Check if it's already cached before downloading
    if let Ok(entries) = std::fs::read_dir(&cache_dir) {
        let files: Vec<_> = entries
            .filter_map(|e| e.ok())
            .filter(|e| is_audio_file(&e.path()) && e.path().file_stem().and_then(|s| s.to_str()) == Some(&hash_str))
            .collect();
            
        if let Some(existing_file) = files.first() {
            let file_path = existing_file.path();
            let file_name = file_path.file_name().unwrap_or_default().to_string_lossy().to_string();
            return Ok(StreamResult {
                file_path: file_path.to_string_lossy().to_string(),
                file_name,
            });
        }
    }

    let yt_query = format!("ytsearch1:{} audio", query);
    let out_template = format!("{}/{}.%(ext)s", cache_dir.to_str().unwrap(), hash_str);

    let output = Command::new("python")
        .arg("-m")
        .arg("yt_dlp")
        .arg(&yt_query)
        .arg("-x")
        .arg("--audio-format")
        .arg("mp3")
        .arg("--output")
        .arg(&out_template)
        .output()
        .map_err(|e| format!("Failed to execute yt-dlp: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        return Err(format!("yt-dlp failed:\n{}\n{}", stderr, stdout));
    }

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
        embed_metadata_file(&dest, &meta)?;
        let key = track_key(&meta.artist, &meta.title);
        let mut index = load_download_index(&settings);
        index.insert(key, filename);
        save_download_index(&settings, &index)?;
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
    let yt_query = format!("ytsearch1:{} audio", query);
    let out_template = format!("{}/%(title)s.%(ext)s", dl_dir.to_str().unwrap());

    let output = Command::new("python")
        .arg("-m")
        .arg("yt_dlp")
        .arg(&yt_query)
        .arg("-x")
        .arg("--audio-format")
        .arg("mp3")
        .arg("--output")
        .arg(&out_template)
        .output()
        .map_err(|e| format!("Failed to execute yt-dlp: {}", e))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Download failed: {}", err));
    }

    let lyrics_output = Command::new("python")
        .arg("-c")
        .arg(format!(
            "import syncedlyrics; print(syncedlyrics.search('{}') or 'No lyrics found.')",
            query.replace("'", "\\'")
        ))
        .output();

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

/// Resolve Spotify URLs / playlist: queries via spotDL Python bridge.
#[tauri::command]
async fn spotify_search(query: String, state: State<'_, AppState>) -> Result<String, String> {
    let settings = effective_settings(&state);
    if !spotify_is_configured(&settings) {
        return Err(
            "Spotify is not configured. Add Client ID and Secret in Settings.".to_string(),
        );
    }
    let script = resolve_spotify_script()
        .ok_or_else(|| "spotify_query.py not found in scripts/".to_string())?;

    let mut cmd = Command::new("python");
    cmd.arg(&script).arg(&query);
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
}

async fn stream_handler(Query(params): Query<StreamQuery>) -> impl IntoResponse {
    let query = params.q;
    let yt_query = format!("ytsearch1:{} audio", query);
    
    // Spawn yt-dlp piping out directly
    let mut child = tokio::process::Command::new("python")
        .arg("-m")
        .arg("yt_dlp")
        .arg(&yt_query)
        .arg("-x")
        .arg("--audio-format")
        .arg("mp3")
        .arg("-o")
        .arg("-")
        .stdout(std::process::Stdio::piped())
        .spawn()
        .expect("failed to spawn yt-dlp");

    let stdout = child.stdout.take().unwrap();
    let stream = ReaderStream::new(stdout);
    let body = Body::from_stream(stream);

    axum::response::Response::builder()
        .header("Content-Type", "audio/mpeg")
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

// ---------- App Entry ----------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let settings = load_settings_from_disk();

    tauri::Builder::default()
        .setup(|_app| {
            start_stream_server();
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            settings: Mutex::new(settings),
        })
        .invoke_handler(tauri::generate_handler![
            download_song,
            get_geo_country,
            window_minimize,
            window_toggle_maximize,
            window_close,
            get_api_key,
            fetch_lastfm,
            fetch_lyrics,
            fetch_track_metadata,
            spotify_search,
            cache_art_image,
            stream_song,
            save_song,
            save_song_with_metadata,
            is_track_downloaded,
            get_downloaded_keys,
            get_download_index,
            delete_downloaded_song,
            get_cache_size,
            clear_cache,
            get_cache_path,
            get_download_path,
            get_settings,
            get_api_status,
            set_settings,
            pick_folder,
            read_audio_file,
            read_file_bytes,
            load_playlists,
            save_playlists,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
