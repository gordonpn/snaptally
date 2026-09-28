import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

export default defineConfig({
  output: "static",
  outDir: "./dist",
  vite: {
    plugins: [tailwindcss()],
  },
});
