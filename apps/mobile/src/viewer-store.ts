import type { ImageSourcePropType } from 'react-native';

/** Where a thumbnail sits on screen, so the viewer can grow out of it and shrink back into it. */
export type ThumbRect = { x: number; y: number; width: number; height: number };
export type ViewerImage = { source: ImageSourcePropType; name: string; caption?: string; from?: ThumbRect };
let current: { images: ViewerImage[]; index: number } = { images: [], index: 0 };
/** Image sources can be large data URLs, so the viewer reads them here instead of from route params. */
export function showImages(images: ViewerImage[], index: number) { current = { images, index }; }
export function viewerImages() { return current; }
