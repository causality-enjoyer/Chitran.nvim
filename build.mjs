import { build } from "esbuild";

try {
  await build({
    entryPoints: ["src/server.ts"],
    outfile: "dist/server.js",
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    minify: false,
    loader: { ".html": "text" },
  });
  console.log("built dist/server.js.");
} catch {
  console.error("Building failed.");
  process.exit(1);
}
