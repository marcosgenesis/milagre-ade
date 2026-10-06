import { WorkspaceIcon } from './WorkspaceIcon';
import { useProjectImages } from '../lib/project-images';
export function ProjectAvatarStack({ projects }: { projects: Array<{ path: string; name: string }> }) {
  const imageOf = useProjectImages(projects.map(project => project.path));
  const stacked = projects.length > 1;
  return <span aria-hidden className={`flex shrink-0 items-center ${stacked ? 'pr-1' : ''}`}>
    {projects.slice(0, 3).map((project, index) => <span key={project.path || index} className={`relative flex items-center justify-center overflow-hidden bg-ink text-[10px] font-semibold text-surface ${stacked ? 'size-5 rounded-[5px] ring-2 ring-surface' : 'size-6 rounded-[6px]'}`} style={{ marginLeft: index ? -8 : 0, zIndex: 3 - index }}><WorkspaceIcon src={imageOf(project.path)} fallback={project.name.slice(0, 1).toUpperCase()} /></span>)}
  </span>;
}
