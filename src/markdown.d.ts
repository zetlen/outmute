// Markdown imported with `with { type: "text" }` is embedded as a string.
declare module "*.md" {
  const text: string;
  export default text;
}
