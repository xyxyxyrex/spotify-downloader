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
use tauri::State;

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

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct AppSettings {
    pub cache_dir: Option<String>,
    pub download_dir: Option<String>,
    pub spotify_client_id: Option<String>,
    pub spotify_client_secret: Option<String>,
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

async fn lastfm_get(method: &str, extra_params: &str) -> Result<Value, String> {
    load_env();
    let api_key =
        env::var("LASTFM_API_KEY").map_err(|_| "LASTFM_API_KEY not set in .env".to_string())?;
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

// ---------- Commands ----------

#[tauri::command]
fn get_api_key() -> String {
    load_env();
    env::var("LASTFM_API_KEY").unwrap_or_else(|_| "YOUR_API_KEY_HERE".to_string())
}

#[tauri::command]
fn get_settings(state: State<AppState>) -> AppSettings {
    state.settings.lock().unwrap().clone()
}

#[tauri::command]
fn set_settings(
    cache_dir: Option<String>,
    download_dir: Option<String>,
    spotify_client_id: Option<String>,
    spotify_client_secret: Option<String>,
    state: State<AppState>,
) -> Result<AppSettings, String> {
    let mut settings = state.settings.lock().unwrap();
    if let Some(dir) = cache_dir {
        settings.cache_dir = if dir.trim().is_empty() {
            None
        } else {
            Some(dir)
        };
    }
    if let Some(dir) = download_dir {
        settings.download_dir = if dir.trim().is_empty() {
            None
        } else {
            Some(dir)
        };
    }
    if let Some(v) = spotify_client_id {
        settings.spotify_client_id = if v.trim().is_empty() { None } else { Some(v) };
    }
    if let Some(v) = spotify_client_secret {
        settings.spotify_client_secret = if v.trim().is_empty() { None } else { Some(v) };
    }
    persist_settings(&settings)?;
    Ok(settings.clone())
}

#[tauri::command]
fn pick_folder(title: String) -> Result<Option<String>, String> {
    let folder = rfd::FileDialog::new()
        .set_title(&title)
        .pick_folder();
    Ok(folder.map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
async fn fetch_track_metadata(artist: String, track: String) -> Result<TrackMetadata, String> {
    let encoded_artist = urlencoding::encode(&artist);
    let encoded_track = urlencoding::encode(&track);

    let track_data = lastfm_get(
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
async fn fetch_lastfm(method: String, extra_params: String) -> Result<String, String> {
    load_env();
    let api_key = env::var("LASTFM_API_KEY")
        .map_err(|_| "LASTFM_API_KEY not set in .env".to_string())?;

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
    let settings = state.settings.lock().unwrap().clone();
    let cache_dir = resolve_cache_dir(&settings);

    let before: HashSet<PathBuf> = std::fs::read_dir(&cache_dir)
        .map_err(|e| format!("Cannot read cache dir: {}", e))?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .collect();

    let yt_query = format!("ytsearch1:{} audio", query);
    let out_template = format!("{}/%(title)s.%(ext)s", cache_dir.to_str().unwrap());

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

    let new_files: Vec<PathBuf> = std::fs::read_dir(&cache_dir)
        .map_err(|e| format!("Cannot read cache dir: {}", e))?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| !before.contains(p) && is_audio_file(p))
        .collect();

    let file_path = if let Some(path) = new_files.first() {
        path.clone()
    } else {
        let mut files: Vec<_> = std::fs::read_dir(&cache_dir)
            .map_err(|e| format!("Cannot read cache dir: {}", e))?
            .filter_map(|e| e.ok())
            .filter(|e| is_audio_file(&e.path()))
            .collect();

        files.sort_by_key(|e| {
            std::cmp::Reverse(e.metadata().ok().and_then(|m| m.modified().ok()))
        });

        files
            .first()
            .map(|f| f.path())
            .ok_or_else(|| "No audio file found after download".to_string())?
    };

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
    let settings = state.settings.lock().unwrap().clone();
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

// ---------- App Entry ----------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let settings = load_settings_from_disk();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            settings: Mutex::new(settings),
        })
        .invoke_handler(tauri::generate_handler![
            download_song,
            get_api_key,
            fetch_lastfm,
            fetch_track_metadata,
            spotify_search,
            cache_art_image,
            stream_song,
            save_song,
            save_song_with_metadata,
            is_track_downloaded,
            get_downloaded_keys,
            get_cache_path,
            get_download_path,
            get_settings,
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
