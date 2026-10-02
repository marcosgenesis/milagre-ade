import { useCallback, useRef, useState } from 'react';
import type { ImageAttachment } from '../model';
import { mediaKind, mediaUrl } from '../lib/media';
import { type LightboxItem, MediaLightbox } from './motion/MediaLightbox';

export function Attachments({ images = [], files = [], removeImage, removeFile }: { images?: ImageAttachment[]; files?: string[]; removeImage?: (id: string) => void; removeFile?: (path: string) => void }) {
  // The open item's index among the media; its thumbnail hides while the viewer shows it.
  const [open, setOpen] = useState<number | null>(null);
  const thumbs = useRef(new Map<string, HTMLButtonElement>());
  const items = [
    ...images.map(image => ({ id: image.id, name: image.name, src: image.dataUrl, kind: 'image' as const, remove: image.path && removeFile ? () => removeFile(image.path!) : removeImage ? () => removeImage(image.id) : undefined })),
    ...files.filter(path => !images.some(image => image.path === path)).map(path => ({ id: path, name: path.split('/').at(-1) || path, src: mediaUrl(path), kind: mediaKind(path), remove: removeFile ? () => removeFile(path) : undefined })),
  ];
  const media = items.filter((item): item is typeof item & LightboxItem => !!item.kind);
  const close = useCallback(() => setOpen(null), []);
  const thumbFor = useCallback((id: string) => thumbs.current.get(id), []);
  const showing = (id: string) => open !== null && media[open]?.id === id;
  if (!items.length) return null;
  return <div className="mb-2 flex flex-wrap items-start gap-2" aria-label="Attachments">
    {items.map(item => <div key={item.id} className="relative max-w-full rounded-lg border border-line bg-inset p-1">
      {item.kind ? <button ref={el => { if (el) thumbs.current.set(item.id, el); else thumbs.current.delete(item.id); }} type="button" aria-label={`Preview ${item.name}`} onClick={() => setOpen(media.findIndex(entry => entry.id === item.id))} className="block rounded focus-visible:outline-2 focus-visible:outline-accent-ink">
        {item.kind === 'image' ? <img src={item.src} alt={item.name} className={`size-20 rounded object-contain ${showing(item.id) ? 'opacity-0' : ''}`} /> : <span className={`relative block ${showing(item.id) ? 'opacity-0' : ''}`}><video src={item.src} muted preload="metadata" className="h-20 w-28 rounded object-contain" /><span className="absolute bottom-0 left-0 rounded bg-surface/90 px-1 text-[10px]">Play video</span></span>}
        <span className="block max-w-28 truncate px-1 text-[10px] text-ink-2">{item.name}</span>
      </button> : <span title={item.id} className={`block max-w-60 truncate px-2 py-1 text-xs ${item.remove ? 'pr-5' : ''}`}>{item.name}</span>}
      {item.remove && <button type="button" aria-label={`Remove ${item.name}`} onClick={item.remove} className="absolute -top-1 -right-1 flex size-5 items-center justify-center rounded-full border border-line bg-surface text-xs text-ink">×</button>}
    </div>)}
    {open !== null && media[open] && <MediaLightbox items={media} start={open} thumbFor={thumbFor} onIndexChange={setOpen} close={close} />}
  </div>;
}
