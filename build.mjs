import { build } from "esbuild";

async function runBuild() {
  try {
    await build({
      entryPoints: ["src/server.ts"],
      outfile: "dist/server.js",
      bundle: true,
      platform: "node",
      target: "node22",
      format: "esm",
      minify: false,
    });
  } catch {
    console.log("Building failed to some error.");
    process.exit(1);
  } finally {
    console.log("built dist/server.js completed");
  }
}

runBuild();
