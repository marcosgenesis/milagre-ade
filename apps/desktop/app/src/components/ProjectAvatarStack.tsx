import { useEffect, useState } from 'react';
import { WorkspaceIcon } from './WorkspaceIcon';
const images = new Map<string, string | null>();
export function ProjectAvatarStack({ projects }: { projects: Array<{ path: string; name: string }> }) {
  const [, redraw] = useState(0);
  const paths = projects.map(project => project.path).join('\n');
  useEffect(() => {
    let live = true;
    for (const project of projects) if (project.path && !images.has(project.path)) {
      images.set(project.path, null);
      void window.milagre.getProjectImage(project.path).then(image => { images.set(project.path, image); if (live) redraw(count => count + 1); }).catch(() => {});
    }
    return () => { live = false; };
  }, [paths]);
  return <span aria-hidden className="flex shrink-0 items-center pr-1">
    {projects.slice(0, 3).map((project, index) => <span key={project.path || index} className="relative flex size-5 items-center justify-center overflow-hidden rounded-[5px] bg-ink text-[10px] font-semibold text-surface ring-2 ring-surface" style={{ marginLeft: index ? -8 : 0, zIndex: 3 - index }}><WorkspaceIcon src={images.get(project.path)} fallback={project.name.slice(0, 1).toUpperCase()} /></span>)}
  </span>;
}
