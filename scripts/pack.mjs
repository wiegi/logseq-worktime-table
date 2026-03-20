import { mkdir, cp } from "node:fs/promises";
import { spawn } from "node:child_process";

await mkdir("release", { recursive: true });

for (const file of [
  "README.md",
  "LICENSE",
  "package.json",
  "logseq-plugin.json",
  "icon.svg",
]) {
  try {
    await cp(file, `release/${file}`, { force: true });
  } catch {
    // ignore
  }
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${cmd} exited with code ${code}`)),
    );
  });
}

await run(process.execPath, [
  "node_modules/parcel/lib/bin.js",
  "build",
  "--dist-dir",
  "release/dist",
  "--public-url",
  "./",
  "--no-source-maps",
  "index.html",
]);

// Some Logseq surfaces appear to resolve plugin icons relative to `main`/`dist`.
// Parcel won't copy the icon unless it's referenced by the HTML/JS, so ensure
// the packaged release always contains it.
await cp("icon.svg", "release/dist/icon.svg", { force: true });
