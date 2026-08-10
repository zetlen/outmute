// Bun's file loader (runtime and bundler) resolves binary imports to a path/URL.
declare module "*.ttf" {
  const path: string;
  export default path;
}
