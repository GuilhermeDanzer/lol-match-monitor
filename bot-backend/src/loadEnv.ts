import dotenv from "dotenv";
import path from "path";

/** Sempre carrega .env a partir da pasta bot-backend (não da raiz do monorepo) */
const backendRoot = path.resolve(__dirname, "..");

dotenv.config({ path: path.join(backendRoot, ".env") });
dotenv.config({ path: path.join(backendRoot, ".env.local") });
