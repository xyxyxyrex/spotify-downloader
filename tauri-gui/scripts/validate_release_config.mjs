import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const guiDir = path.resolve(scriptDir, "..");
const repoDir = path.resolve(guiDir, "..");
const expectedTag = process.argv[2] || "";

function readJson(relativePath) {
    return JSON.parse(fs.readFileSync(path.join(repoDir, relativePath), "utf8"));
}

function readText(relativePath) {
    return fs.readFileSync(path.join(repoDir, relativePath), "utf8");
}

function fail(message) {
    throw new Error(`Release configuration error: ${message}`);
}

function assertEqual(actual, expected, label) {
    if (actual !== expected) {
        fail(`${label} is ${JSON.stringify(actual)}; expected ${JSON.stringify(expected)}`);
    }
}

function decodeBase64(value, label) {
    const normalized = String(value || "").replace(/\s/g, "");
    if (!normalized || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
        fail(`${label} is not valid base64`);
    }
    const decoded = Buffer.from(normalized, "base64");
    const roundTrip = decoded.toString("base64").replace(/=+$/, "");
    if (roundTrip !== normalized.replace(/=+$/, "")) {
        fail(`${label} is not valid base64`);
    }
    return decoded;
}

const packageJson = readJson("tauri-gui/package.json");
const packageLock = readJson("tauri-gui/package-lock.json");
const tauriConfig = readJson("tauri-gui/src-tauri/tauri.conf.json");
const cargoToml = readText("tauri-gui/src-tauri/Cargo.toml");
const cargoLock = readText("tauri-gui/src-tauri/Cargo.lock");
const indexHtml = readText("tauri-gui/src/index.html");
const capabilities = readJson("tauri-gui/src-tauri/capabilities/default.json");
const mainJs = readText("tauri-gui/src/main.js");

const version = packageJson.version;
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    fail(`package version ${JSON.stringify(version)} is not SemVer`);
}

assertEqual(packageLock.version, version, "package-lock version");
assertEqual(packageLock.packages?.[""]?.version, version, "package-lock root version");
assertEqual(tauriConfig.version, version, "Tauri config version");

const cargoVersion = cargoToml.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
assertEqual(cargoVersion, version, "Cargo package version");
const lockedAppVersion = cargoLock.match(
    /\[\[package\]\]\s*\r?\nname = "tauri-gui"\s*\r?\nversion = "([^"]+)"/,
)?.[1];
assertEqual(lockedAppVersion, version, "Cargo.lock app version");

if (!indexHtml.includes(`SpotDL GUI v${version}`)) {
    fail(`title bar does not display v${version}`);
}

if (expectedTag) {
    assertEqual(expectedTag, `v${version}`, "release tag");
}

assertEqual(
    tauriConfig.bundle?.createUpdaterArtifacts,
    true,
    "bundle.createUpdaterArtifacts",
);
if (!tauriConfig.bundle?.targets || tauriConfig.bundle.targets !== "all") {
    fail("bundle.targets must include the Windows NSIS installer");
}
assertEqual(
    tauriConfig.plugins?.updater?.endpoints?.[0],
    "https://github.com/xyxyxyrex/spotify-downloader/releases/latest/download/latest.json",
    "updater endpoint",
);
assertEqual(
    tauriConfig.plugins?.updater?.windows?.installMode,
    "passive",
    "Windows updater install mode",
);

const publicKeyText = decodeBase64(
    tauriConfig.plugins?.updater?.pubkey,
    "updater public key",
).toString("utf8");
const publicKeyLines = publicKeyText.trim().split(/\r?\n/);
if (!publicKeyLines[0]?.startsWith("untrusted comment: minisign public key")) {
    fail("updater public key has an unexpected minisign header");
}
const publicKeyPayload = decodeBase64(publicKeyLines[1], "minisign public key payload");
if (publicKeyPayload.length !== 42) {
    fail(`minisign public key payload has ${publicKeyPayload.length} bytes; expected 42`);
}

for (const permission of ["updater:default", "process:allow-restart"]) {
    if (!capabilities.permissions?.includes(permission)) {
        fail(`capability ${permission} is missing`);
    }
}
for (const updaterCall of ["downloadAndInstall", "process.relaunch"]) {
    if (!mainJs.includes(updaterCall)) {
        fail(`app updater call ${updaterCall} is missing`);
    }
}

const keyId = publicKeyPayload.subarray(2, 10).toString("hex");
console.log(`Release v${version} is internally consistent (updater key ${keyId}).`);
