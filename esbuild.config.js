import { build } from "esbuild";

build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  outfile: "dist/index.js",
  format: "esm",
  platform: "node",
  target: "node18",
  packages: "external", // This prevents bundling node_modules
  banner: {
    js: `import { createRequire } from 'module';const require = createRequire(import.meta.url);`,
  },
  // Optional: Add source maps for debugging
  sourcemap: true,
  // Optional: Minify for production
  minify: process.env.NODE_ENV === "production",
}).catch(() => process.exit(1));
