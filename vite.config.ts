import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // /address/{addr} のような深いパスでも index.html から資産を引けるよう絶対パスで出す
  base: "/",
  build: { target: "es2020" },
});
