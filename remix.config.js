/** @type {import('@remix-run/dev').AppConfig} */
const isDevelopment = process.env.NODE_ENV === "development";
const devInstance = (process.env.REMIX_DEV_INSTANCE ?? "local").replace(
  /[^a-zA-Z0-9_-]/g,
  "-"
);
const devAssetsDirectory = `public/build-dev-${devInstance}`;
const devPublicPath = `/build-dev-${devInstance}/`;
const devServerBuildPath = `build/dev-${devInstance}/index.js`;

export default {
  ignoredRouteFiles: ["**/.*"],
  tailwind: true,
  // Every dev server gets its own output. Without this, a second `remix dev`
  // process can clean files still used by the Docker preview on port 3000.
  assetsBuildDirectory: isDevelopment
    ? devAssetsDirectory
    : "public/build",
  publicPath: isDevelopment ? devPublicPath : "/build/",
  serverBuildPath: isDevelopment
    ? devServerBuildPath
    : "build/index.js",
  browserNodeBuiltinsPolyfill: {
    modules: {
      buffer: true, // Aktivera polyfill för Buffer
      events: true 
    },
  },
  // appDirectory: "app",
};
