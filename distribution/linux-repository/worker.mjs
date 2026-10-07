import { metadata, packages } from "./repository-data.mjs";
import { createRepositoryWorker } from "./repository-handler.mjs";

export default createRepositoryWorker(metadata, packages);
