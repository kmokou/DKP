import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await cp("public", "dist", { recursive: true });
await build({
  entryPoints: [
    "src/background.ts",
    "src/content.ts",
    "src/sidebar.ts",
    "src/popup.ts",
  ],
  outdir: "dist",
  bundle: true,
  format: "iife",
  target: "firefox140",
  sourcemap: false,
});
console.log("Built DKP → dist/");
