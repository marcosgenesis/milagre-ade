import type { ImageSourcePropType } from 'react-native';

export type ViewerImage = { source: ImageSourcePropType; name: string; caption?: string };
let current: { images: ViewerImage[]; index: number } = { images: [], index: 0 };
/** Image sources can be large data URLs, so the viewer reads them here instead of from route params. */
export function showImages(images: ViewerImage[], index: number) { current = { images, index }; }
export function viewerImages() { return current; }
