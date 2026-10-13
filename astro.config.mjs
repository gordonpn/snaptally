import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://tally.gordon-pn.com",
  output: "static",
  outDir: "./dist",
  vite: {
    plugins: [tailwindcss()],
  },
});
