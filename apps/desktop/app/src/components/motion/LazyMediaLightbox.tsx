import { lazyView } from "../../lib/lazy-view";

/** MediaLightbox from its own chunk: it only renders once an attachment or image is opened. */
export const MediaLightbox = lazyView(() => import("./MediaLightbox").then((module) => module.MediaLightbox));
