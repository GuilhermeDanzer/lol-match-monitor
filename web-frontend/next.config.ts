import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from "url";

const appDir = path.dirname(fileURLToPath(import.meta.url));

/** Monorepo: pacote next resolve a partir da raiz do repositório */
const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(appDir, ".."),
  },
};

export default nextConfig;
