import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ImageAttachment } from '../model';
import { mediaKind, mediaUrl } from '../lib/media';

type Preview = { name: string; src: string; kind: 'image' | 'video' };
function MediaViewer({ media, close }: { media: Preview; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    window.addEventListener('keydown', escape, true);
    return () => { window.removeEventListener('keydown', escape, true); dialog.current?.close(); previous?.focus(); };
  }, [close]);
  return createPortal(<dialog ref={dialog} aria-label={`Preview ${media.name}`} onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === event.currentTarget) close(); }} className="fixed inset-0 m-auto max-h-[90vh] w-[min(960px,94vw)] max-w-none overflow-auto rounded-xl border border-line bg-surface p-4 text-ink shadow-raised backdrop:bg-black/70">
    <div className="mb-3 flex items-center gap-3"><span className="min-w-0 flex-1 truncate text-sm">{media.name}</span><button autoFocus type="button" onClick={close} className="rounded-control bg-hover px-3 py-1 text-sm">Close preview</button></div>
    {media.kind === 'video' ? <video src={media.src} controls autoPlay className="max-h-[75vh] w-full" /> : <img src={media.src} alt={media.name} className="mx-auto max-h-[75vh] max-w-full object-contain" />}
  </dialog>, document.body);
}

export function Attachments({ images = [], files = [], removeImage, removeFile }: { images?: ImageAttachment[]; files?: string[]; removeImage?: (id: string) => void; removeFile?: (path: string) => void }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const items = [
    ...images.map(image => ({ id: image.id, name: image.name, src: image.dataUrl, kind: 'image' as const, remove: image.path && removeFile ? () => removeFile(image.path!) : removeImage ? () => removeImage(image.id) : undefined })),
    ...files.filter(path => !images.some(image => image.path === path)).map(path => ({ id: path, name: path.split('/').at(-1) || path, src: mediaUrl(path), kind: mediaKind(path), remove: removeFile ? () => removeFile(path) : undefined })),
  ];
  const closePreview = useCallback(() => setPreview(null), []);
  if (!items.length) return null;
  return <div className="mb-2 flex flex-wrap items-start gap-2" aria-label="Attachments">
    {items.map(item => <div key={item.id} className="relative max-w-full rounded-lg border border-line bg-inset p-1">
      {item.kind ? <button type="button" aria-label={`Preview ${item.name}`} onClick={() => setPreview({ ...item, kind: item.kind! })} className="block rounded focus-visible:outline-2 focus-visible:outline-accent-ink">
        {item.kind === 'image' ? <img src={item.src} alt={item.name} className="size-20 rounded object-contain" /> : <span className="relative block"><video src={item.src} muted preload="metadata" className="h-20 w-28 rounded object-contain" /><span className="absolute bottom-0 left-0 rounded bg-surface/90 px-1 text-[10px]">Play video</span></span>}
        <span className="block max-w-28 truncate px-1 text-[10px] text-ink-2">{item.name}</span>
      </button> : <span title={item.id} className={`block max-w-60 truncate px-2 py-1 text-xs ${item.remove ? 'pr-5' : ''}`}>{item.name}</span>}
      {item.remove && <button type="button" aria-label={`Remove ${item.name}`} onClick={item.remove} className="absolute -top-1 -right-1 flex size-5 items-center justify-center rounded-full border border-line bg-surface text-xs text-ink">×</button>}
    </div>)}
    {preview && <MediaViewer media={preview} close={closePreview} />}
  </div>;
}
