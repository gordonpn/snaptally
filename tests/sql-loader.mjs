import fs from "node:fs";

export async function load(url, context, nextLoad) {
  if (url.endsWith(".sql")) {
    const content = fs.readFileSync(new URL(url), "utf-8");
    return {
      format: "module",
      shortCircuit: true,
      source: `export default ${JSON.stringify(content)};`,
    };
  }
  return nextLoad(url, context);
}
