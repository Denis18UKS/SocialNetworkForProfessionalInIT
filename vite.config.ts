import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

const LOCAL_API_ORIGIN = "http://localhost:5000";

const rewriteLocalApiOrigin = (apiOrigin: string): Plugin => ({
  name: "socialbird-rewrite-local-api-origin",
  enforce: "pre",
  transform(code, id) {
    if (!/\.[cm]?[jt]sx?$/.test(id) || !code.includes(LOCAL_API_ORIGIN)) {
      return null;
    }

    return {
      code: code.split(LOCAL_API_ORIGIN).join(apiOrigin),
      map: null,
    };
  },
});

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiOrigin = (env.VITE_API_URL || LOCAL_API_ORIGIN).replace(/\/$/, "");

  return {
    server: {
      host: "::",
      port: 8080,
    },
    plugins: [
      rewriteLocalApiOrigin(apiOrigin),
      react(),
      mode === "development" && componentTagger(),
    ].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
