import os
import sys
import shutil
import urllib.request
import subprocess

BIN_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "bin"))
SCRIPTS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "scripts"))

YT_DLP_URL = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
SPOTDL_URL = "https://github.com/spotDL/spotify-downloader/releases/download/v4.2.9/spotdl-win-x64.exe"

def ensure_bin_dir():
    if not os.path.exists(BIN_DIR):
        print(f"Creating binary folder: {BIN_DIR}")
        os.makedirs(BIN_DIR)

def download_file(url, filename):
    dest = os.path.join(BIN_DIR, filename)
    print(f"Downloading {filename} from {url}...")
    try:
        urllib.request.urlretrieve(url, dest)
        print(f"Successfully downloaded and saved to {dest}")
    except Exception as e:
        print(f"Error downloading {filename}: {e}")
        sys.exit(1)

def freeze_script(script_name):
    script_path = os.path.join(SCRIPTS_DIR, f"{script_name}.py")
    if not os.path.exists(script_path):
        print(f"Error: Script not found: {script_path}")
        sys.exit(1)
    
    print(f"Freezing {script_name}.py using PyInstaller...")
    try:
        import PyInstaller
    except ImportError:
        print("PyInstaller not found. Installing PyInstaller...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "pyinstaller"])

    # Run PyInstaller
    cmd = [
        "pyinstaller",
        "--onefile",
        "--distpath", BIN_DIR,
        "--workpath", os.path.join(os.path.dirname(__file__), "build"),
        "--specpath", os.path.dirname(__file__),
        "--clean",
        script_path
    ]
    
    print(f"Running command: {' '.join(cmd)}")
    subprocess.check_call(cmd)
    
    # Cleanup unnecessary PyInstaller files
    spec_file = os.path.join(os.path.dirname(__file__), f"{script_name}.spec")
    if os.path.exists(spec_file):
        os.remove(spec_file)
    build_dir = os.path.join(os.path.dirname(__file__), "build")
    if os.path.exists(build_dir):
        shutil.rmtree(build_dir)
        
    print(f"Successfully froze {script_name}.py to {os.path.join(BIN_DIR, script_name + '.exe')}")

def main():
    ensure_bin_dir()
    
    # Download precompiled binaries
    download_file(YT_DLP_URL, "yt-dlp.exe")
    download_file(SPOTDL_URL, "spotdl.exe")
    
    # Freeze python scripts
    freeze_script("spotify_query")
    freeze_script("embed_metadata")
    
    print("\nAll dependencies successfully packaged and bundled into the build directory!")
    print("You are now ready to run 'npm run tauri build'!")

if __name__ == "__main__":
    main()
