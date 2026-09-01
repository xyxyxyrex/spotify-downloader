import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [, , sourcePath, targetPath, expectedVersion] = process.argv;

if (!sourcePath || !targetPath || !expectedVersion) {
    console.error(
        "Usage: node update_updater_manifest.mjs <latest.json> <updater.json> <version>",
    );
    process.exit(2);
}

function decodeMinisignText(value, label) {
    try {
        return Buffer.from(value.trim(), "base64").toString("utf8").trim();
    } catch (error) {
        throw new Error(`${label} is not valid base64: ${error}`);
    }
}

function payloadLine(text, label) {
    const lines = text.split(/\r?\n/);
    if (lines.length < 2 || !lines[1]) {
        throw new Error(`${label} does not contain a minisign payload`);
    }
    const payload = Buffer.from(lines[1].trim(), "base64");
    if (payload.length < 10) {
        throw new Error(`${label} minisign payload is too short`);
    }
    return { lines, payload };
}

function normalizedInstallerName(value) {
    return value.replace(/[ .]+/g, ".").toLowerCase();
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const tauriConfigPath = path.resolve(scriptDir, "../src-tauri/tauri.conf.json");
const latest = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
const tauriConfig = JSON.parse(fs.readFileSync(tauriConfigPath, "utf8"));

if (latest.version !== expectedVersion) {
    throw new Error(
        `Release manifest version ${latest.version} does not match ${expectedVersion}`,
    );
}

const nsis =
    latest.platforms?.["windows-x86_64-nsis"] ||
    (latest.platforms?.["windows-x86_64"]?.url?.endsWith("-setup.exe")
        ? latest.platforms["windows-x86_64"]
        : null);
if (!nsis?.url || !nsis?.signature) {
    throw new Error("Release manifest does not contain a Windows x64 NSIS updater");
}

const url = new URL(nsis.url);
if (url.protocol !== "https:" || url.hostname !== "github.com") {
    throw new Error(`Unexpected updater host: ${url.origin}`);
}
if (!url.pathname.includes(`/releases/download/v${expectedVersion}/`)) {
    throw new Error(`Updater URL does not point to release v${expectedVersion}`);
}

const installerName = decodeURIComponent(path.posix.basename(url.pathname));
if (!installerName.endsWith("_x64-setup.exe")) {
    throw new Error(`Unexpected NSIS installer filename: ${installerName}`);
}

const publicText = decodeMinisignText(
    tauriConfig.plugins?.updater?.pubkey || "",
    "Updater public key",
);
const signatureText = decodeMinisignText(nsis.signature, "Updater signature");
const publicPayload = payloadLine(publicText, "Updater public key").payload;
const signature = payloadLine(signatureText, "Updater signature");
const publicKeyId = publicPayload.subarray(2, 10);
const signatureKeyId = signature.payload.subarray(2, 10);
if (!publicKeyId.equals(signatureKeyId)) {
    throw new Error(
        `Signature key ID ${signatureKeyId.toString("hex")} does not match public key ${publicKeyId.toString("hex")}`,
    );
}

const trustedComment = signature.lines.find((line) =>
    line.startsWith("trusted comment:"),
);
const signedFile = trustedComment?.match(/\bfile:(.+)$/)?.[1]?.trim();
if (
    !signedFile ||
    normalizedInstallerName(signedFile) !== normalizedInstallerName(installerName)
) {
    throw new Error(
        `Signature file ${signedFile || "<missing>"} does not match ${installerName}`,
    );
}

const legacyManifest = {
    version: latest.version,
    notes: latest.notes || "",
    pub_date: latest.pub_date || new Date().toISOString(),
    platforms: {
        "windows-x86_64": {
            signature: nsis.signature,
            url: nsis.url,
        },
    },
};

fs.writeFileSync(targetPath, `${JSON.stringify(legacyManifest, null, 2)}\n`);
console.log(
    `Validated ${installerName} with updater key ${publicKeyId.toString("hex")} and wrote ${targetPath}`,
);
