# Spoti-Tauri GUI Release v0.2.5

We are thrilled to roll out the **v0.2.5 release** of SpotDL GUI (Spoti-Tauri)! This release introduces a highly requested extensibility system: the **Plugin Store**, enabling community integrations, custom dashboards, and local developer sandbox scripts. 

Alongside the Plugin Store, we have rolled out the first official local plugin: **Spotify Wrapped**, a premium 9:16 immersive mobile-style slide deck visualizing your unique listening habits with rich glassmorphism layouts and dynamic gradients.

---

## 🚀 What's New in v0.2.5

### 🔌 Extensibility & Plugin Store
You can now access the **Plugin Store** directly from the left navigation panel.
* **Search and Filter**: Instantly search available plugins inside the registry deck.
* **Local Sandbox Loader**: Load any `.js` script instantly from your disk to run hooks and interact with playback stats.
* **Paste Code Utility**: Fast developer sandbox injection by pasting raw Javascript code directly.
* **Mock Registry Catalog**: Installed/active integration listings for popular addons like *Receiptify*, *Visualizer Pro*, and *Last.fm Scrobbler*.

### 🎁 Immersive 9:16 Spotify Wrapped (Local Plugin)
A beautifully designed, 10-tabbed story experience visualizing your personal soundtrack!
* **10 Fluid Slides**:
  1. **Acoustic Greet**: Immersive personalized welcome splash.
  2. **Playcount Pulse**: Multi-ring visualizer displaying total plays.
  3. **Deep Discovery**: Detail card showing your first listened track of the year.
  4. **The Anthem**: Spin-animated cover displaying your top track with play counts.
  5. **Inner Circle**: Clean ranks showing your top 5 most-played artists.
  6. **Acoustic Footprint**: Dynamic HSL bars detailing top genre spectrums.
  7. **Time Well Spent**: Total listening minutes and hours log.
  8. **Listening Personality**: A customized archetype card (e.g. *The Devoted Loyalist*, *The Sonic Voyager*, *The Eclectic Tastemaker*).
  9. **Explorer Ratio**: Breakdown of unique tracks to unique artists cataloged.
  10. **Acoustic Summary**: A premium vertical snapshot grid highlighting all personal records, complete with a **Save Wrapped Card** utility.
* **Premium Story Controls**: Linearly animated segment progress bars, touch/click taps to navigate backward or forward, click-hold pause/resume, and instant copyable share hooks.

---

## 🛠️ Developer SDK Reference (`window.spotiTauri`)

For developers looking to build local plugins, we have exposed a secure global API:

```javascript
// Fetch the complete play log dictionary from the Rust SQLite engine
const history = await window.spotiTauri.getHistory();

// Trigger a native system alert / UI notification
window.spotiTauri.showStatus("Metadata sync completed!");

// Programmatically redirect the user to home, search, or settings
window.spotiTauri.switchView("home");

// Interact with the core Rust command invoker
const apiStatus = await window.spotiTauri.invoke("get_api_status");
```

---

## ⚙️ Compilation & Upgrade Path
All config manifests (`package.json`, `Cargo.toml`, `tauri.conf.json`, `updater.json`, and frontend elements) have been successfully bumped to `0.2.5`. 

1. Run dependencies:
   ```bash
   npm install
   ```
2. Launch in development sandbox mode:
   ```bash
   npm run tauri dev
   ```
3. Compile production distributions (MSI, EXE, ZIP):
   ```bash
   npm run tauri build
   ```

*Enjoy your music in a whole new dimension!* 🎧✨
