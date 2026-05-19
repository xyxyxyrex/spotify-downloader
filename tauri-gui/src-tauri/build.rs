fn main() {
    // Try to load .env file at compile-time to embed keys as defaults
    if let Ok(content) = std::fs::read_to_string(".env") {
        for line in content.lines() {
            let line = line.trim();
            if line.starts_with('#') || line.is_empty() {
                continue;
            }
            if let Some((key, val)) = line.split_once('=') {
                let key = key.trim();
                let val = val.trim().trim_matches('"').trim_matches('\'');
                if !key.is_empty() {
                    println!("cargo:rustc-env={}={}", key, val);
                }
            }
        }
    }
    tauri_build::build()
}
