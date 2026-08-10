// Bun HTML imports produce a bundle manifest consumable by Bun.serve routes.
declare module "*.html" {
  const manifest: import("bun").HTMLBundle;
  export default manifest;
}
