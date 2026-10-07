import { useEffect, useState } from 'react';
import { WorkspaceIcon } from './WorkspaceIcon';
const images = new Map<string, string | null>();
const listeners = new Set<() => void>();
export function ProjectAvatarStack({ projects }: { projects: Array<{ path: string; name: string }> }) {
  const [, redraw] = useState(0);
  const stacked = projects.length > 1;
  const paths = projects.map(project => project.path).join('\n');
  useEffect(() => {
    const redrawImages = () => redraw(count => count + 1);
    listeners.add(redrawImages);
    for (const project of projects) if (project.path && !images.has(project.path)) {
      images.set(project.path, null);
      void window.milagre.getProjectImage(project.path).then(image => { images.set(project.path, image); listeners.forEach(listener => listener()); }).catch(() => {});
    }
    return () => { listeners.delete(redrawImages); };
  }, [paths]);
  return <span aria-hidden className={`flex shrink-0 items-center ${stacked ? 'pr-1' : ''}`}>
    {projects.slice(0, 3).map((project, index) => <span key={project.path || index} className={`relative flex items-center justify-center overflow-hidden bg-ink text-[10px] font-semibold text-surface ${stacked ? 'size-5 rounded-[5px] ring-2 ring-surface' : 'size-6 rounded-[6px]'}`} style={{ marginLeft: index ? -8 : 0, zIndex: 3 - index }}><WorkspaceIcon src={images.get(project.path)} fallback={project.name.slice(0, 1).toUpperCase()} /></span>)}
  </span>;
}
