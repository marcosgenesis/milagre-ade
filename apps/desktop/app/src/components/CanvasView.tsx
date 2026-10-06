import { scopeKey } from '@milagre/shared/chat-scopes';
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReactFlow, Background, BaseEdge, Controls, EdgeLabelRenderer, Handle, Position, applyNodeChanges, getSmoothStepPath, type Connection, type Edge, type EdgeProps, type Node, type NodeChange, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { AgentRuns } from "@/lib/agent-runs";
import type { CanvasSnapshot, LinkEndpoint } from "@/electron";
import type { CoordinatorState, LinkedWork, NamedProjectLink } from "@/model";
import { chatMark, chatTitle, type ChatMark } from "@/lib/chat-list";
import { chatKey, chatsAskingUser, chatsRunning, chatsWaitingForUser } from "@/lib/agent-runs";
import { delegatedChats } from "@/lib/linked-work";
import { NEGOTIATION_ROUNDS } from "@milagre/shared/limits";
import { ScrollArea } from "./primitives/ScrollArea";

type CanvasChat = { id: number; title: string; mark: ChatMark; receiveOnly: boolean; scopeOwner?: string };
type CanvasData = { kind: "project" | "worktree"; endpoint: LinkEndpoint; name: string; branch?: string; diff?: string; chats?: CanvasChat[]; onOpenChat?: (projectPath: string, id: number) => void; projectPath: string; [key: string]: unknown };
type CanvasNode = Node<CanvasData>;
const nodeTypes = { project: ProjectNode, worktree: WorktreeNode };
const edgeTypes = { link: LinkEdge, membership: MembershipEdge };

function MembershipEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, data }: EdgeProps<Edge<{ name: string; linkId: string }>>) {
  const [path, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  return <>
    <BaseEdge id={id} path={path} style={style} />
    <EdgeLabelRenderer><span data-named-link={data?.linkId} className="pointer-events-none absolute rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] font-medium text-ink" style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}>{data?.name}</span></EdgeLabelRenderer>
  </>;
}

/** What travels along a Link now: running Delegations, or a Negotiation the user can stop. */
type LinkActivity = { label: string; negotiationId?: string };
type LinkEdgeData = { activity?: LinkActivity; onStop: (negotiationId: string) => void };

function linkActivity(work: LinkedWork, linkId: string): LinkActivity | undefined {
  const negotiation = work.negotiations.find(item => item.link_id === linkId);
  if (negotiation) return { label: `Negotiation · round ${negotiation.round} of ${NEGOTIATION_ROUNDS}`, negotiationId: negotiation.id };
  const open = work.delegations.filter(item => item.link_id === linkId);
  if (!open.length) return undefined;
  return { label: open.length === 1 ? `Delegation ${open[0].status}` : `${open.length} Delegations` };
}

function LinkEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, data }: EdgeProps<Edge<LinkEdgeData>>) {
  const [path, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const activity = data?.activity;
  return <>
    <BaseEdge id={id} path={path} style={style} className={activity ? "milagre-link-active" : undefined} />
    {activity && <EdgeLabelRenderer>
      <div data-link-activity={id} className="nodrag nopan pointer-events-auto absolute flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] font-medium text-ink shadow-card" style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, zIndex: 1001 }}>
        <span className="size-1.5 rounded-full bg-accent" />
        <span>{activity.label}</span>
        {activity.negotiationId && <button type="button" className="ml-1 rounded-md border border-line px-1.5 py-0.5 text-[10px] text-ink-2 hover:bg-hover-2 hover:text-ink" onClick={() => data?.onStop(activity.negotiationId!)}>Stop</button>}
      </div>
    </EdgeLabelRenderer>}
  </>;
}

function LinkHandles() {
  return <>
    <Handle type="target" position={Position.Left} id="left-target" className="!size-3 !border-2 !border-surface !bg-accent" />
    <Handle type="source" position={Position.Left} id="left-source" className="!size-3 !border-2 !border-surface !bg-accent" style={{ top: "65%" }} />
    <Handle type="target" position={Position.Right} id="right-target" className="!size-3 !border-2 !border-surface !bg-accent" />
    <Handle type="source" position={Position.Right} id="right-source" className="!size-3 !border-2 !border-surface !bg-accent" style={{ top: "65%" }} />
  </>;
}

function ProjectNode({ data }: NodeProps<CanvasNode>) {
  return <div data-canvas-project={data.projectPath} className="h-full w-[330px] rounded-2xl border border-line-strong bg-surface/90 shadow-card">
    <LinkHandles />
    <div className="canvas-drag-handle flex h-14 cursor-grab items-center gap-2 border-b border-line px-5 active:cursor-grabbing">
      <span className="flex size-8 items-center justify-center rounded-lg bg-hover-2 text-sm font-semibold text-ink">{data.name.slice(0, 1).toUpperCase()}</span>
      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{data.name}</span>
      <span className="text-[11px] text-ink-3">Project</span>
    </div>
  </div>;
}

const markClass: Record<ChatMark, string> = {
  question: "bg-amber-500", waiting: "bg-amber-500", delegated: "bg-accent", running: "bg-blue-500", unread: "bg-accent", idle: "bg-ink-3/40",
};

function WorktreeNode({ data }: NodeProps<CanvasNode>) {
  return <div className="flex h-[178px] w-[290px] flex-col rounded-xl border border-line bg-surface shadow-card">
    <LinkHandles />
    <div className="canvas-drag-handle cursor-grab px-4 pt-3 active:cursor-grabbing">
      <div className="truncate text-[13px] font-semibold text-ink" title={data.branch}>{data.branch}</div>
      <div className="mt-0.5 flex items-center justify-between text-[11px] text-ink-3"><span>Worktree</span><span>{data.diff ?? ""}</span></div>
    </div>
    <ScrollArea as="ul" className="nodrag nopan nowheel mt-2 flex-1 border-t border-line px-2 py-1">
      {data.chats?.map(chat => <li key={chat.id}>
        <button type="button" className="nodrag flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-ink-2 hover:bg-hover-2 hover:text-ink" onClick={() => data.onOpenChat?.(chat.scopeOwner ?? data.projectPath, chat.id)}>
          <span className={`size-1.5 shrink-0 rounded-full ${markClass[chat.mark]}`} title={chat.mark} />
          <span className="min-w-0 flex-1 truncate">{chat.title}</span>
          {chat.receiveOnly && <span className="shrink-0 rounded border border-line px-1 text-[10px] text-ink-3" title="This Codex Chat can't use the linked tools: it gets the summary and receives Delegations only.">receive-only</span>}
        </button>
      </li>)}
      {!data.chats?.length && <li className="px-2 py-2 text-xs text-ink-3">No chats</li>}
    </ScrollArea>
  </div>;
}

const projectNodeId = (id: string) => `project:${encodeURIComponent(id)}`;
const worktreeNodeId = (id: string, path: string) => `worktree:${encodeURIComponent(id)}:${encodeURIComponent(path)}`;

function makeNodes(snapshot: CanvasSnapshot, states: Record<string, CoordinatorState>, runs: AgentRuns, work: LinkedWork, onOpenChat: (path: string, id: number) => void): CanvasNode[] {
  const nodes: CanvasNode[] = [];
  const columnHeights = [0, 0, 0];
  for (const project of snapshot.projects) {
    const state = states[project.path] ?? snapshot.states.find(entry => entry.path === project.path)?.state;
    const worktrees = Object.values(state?.worktrees ?? {});
    const height = Math.max(82, 74 + worktrees.length * 194);
    const column = columnHeights.indexOf(Math.min(...columnHeights));
    const position = project.position ?? { x: column * 390, y: columnHeights[column] };
    columnHeights[column] = Math.max(columnHeights[column], position.y + height + 50);
    nodes.push({ id: projectNodeId(project.id), type: "project", position, data: { kind: "project", endpoint: { project_id: project.id }, name: project.name, projectPath: project.path }, style: { width: 330, height }, dragHandle: ".canvas-drag-handle" });
    const asking = chatsAskingUser(runs, project.path);
    const waiting = chatsWaitingForUser(runs, project.path);
    const running = chatsRunning(runs, project.path, state?.sessions);
    const delegated = delegatedChats(work, project.path);
    const firstMessages = new Map<number, NonNullable<typeof state>["messages"][number]>();
    for (const message of state?.messages ?? []) {
      if (message.role !== "assistant" && message.body.trim() && !firstMessages.has(message.session_id)) firstMessages.set(message.session_id, message);
    }
    for (const [index, worktree] of worktrees.entries()) {
      const chats: CanvasChat[] = Object.values(state?.sessions ?? {}).filter(session => session.worktree_id === worktree.id && !session.archived).map(session => ({
        id: session.id,
        title: chatTitle(session, firstMessages.has(session.id) ? [firstMessages.get(session.id)!] : []),
        mark: chatMark({ asking: asking.has(session.id), waiting: waiting.has(session.id), delegated: delegated.has(session.id), running: running.has(session.id), unread: Boolean(session.unread) }),
        receiveOnly: work.receiveOnly.includes(chatKey(project.path, session.id)),
      }));
      if (worktree.sharedChat) chats.push({ id: worktree.sharedChat.sessionId, title: 'Open shared Link Chat', mark: 'idle', receiveOnly: false, scopeOwner: scopeKey({ kind: 'link', linkId: worktree.sharedChat.linkId }) } as typeof chats[number]);
      nodes.push({ id: worktreeNodeId(project.id, worktree.path), type: "worktree", parentId: projectNodeId(project.id), extent: "parent", position: snapshot.worktreePositions[project.id]?.[worktree.path] ?? { x: 20, y: 64 + index * 194 }, data: { kind: "worktree", endpoint: { project_id: project.id, worktree_path: worktree.path }, name: worktree.name, branch: worktree.name, diff: worktree.diff ? `+${worktree.diff.added} −${worktree.diff.removed}` : undefined, chats, projectPath: project.path, onOpenChat }, style: { width: 290, height: 178 }, dragHandle: ".canvas-drag-handle" });
    }
  }
  return nodes;
}

export function CanvasView({ states, runs, linkedWork, onOpenChat, onBack, focusLink }: { states: Record<string, CoordinatorState>; runs: AgentRuns; linkedWork: LinkedWork; onOpenChat: (projectPath: string, id: number) => void; onBack: () => void; focusLink?: NamedProjectLink }) {
  const [snapshot, setSnapshot] = useState<CanvasSnapshot | null>(null);
  const [nodes, setNodes] = useState<CanvasNode[]>([]);
  const [selectedLink, setSelectedLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try { setSnapshot(await window.milagre.getCanvas()); setError(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }, []);
  // oxlint-disable-next-line react/set-state-in-effect -- pre-existing, see PR body
  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), 15000); return () => window.clearInterval(timer); }, [refresh]);
  const openChatRef = useRef(onOpenChat);
  openChatRef.current = onOpenChat;
  const openChat = useCallback((path: string, id: number) => openChatRef.current(path, id), []);
  useEffect(() => {
    if (!snapshot) return;
    const visible = focusLink ? { ...snapshot, projects: snapshot.projects.filter(project => focusLink.projectIds.includes(project.id)) } : snapshot;
    const next = makeNodes(visible, states, runs, linkedWork, openChat);
    // oxlint-disable-next-line react/set-state-in-effect -- pre-existing, see PR body
    setNodes(previous => next.map(node => {
      const old = previous.find(item => item.id === node.id);
      return old ? { ...node, position: old.position } : node;
    }));
  }, [snapshot, states, runs, linkedWork, openChat, focusLink]);
  const onNodesChange = useCallback((changes: NodeChange<CanvasNode>[]) => setNodes(current => applyNodeChanges(changes, current)), []);
  const stopNegotiation = useCallback((id: string) => {
    window.milagre.stopNegotiation(id).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, []);
  const nodeById = useMemo(() => new Map(nodes.map(node => [node.id, node])), [nodes]);
  const edges = useMemo(() => {
    // A Link leaves the side facing the other end, so its line and its activity label run between the two.
    const centerX = (id: string) => {
      const node = nodeById.get(id);
      const parent = node?.parentId ? nodeById.get(node.parentId) : undefined;
      const width = Number(node?.style?.width ?? 0);
      return (node?.position.x ?? 0) + (parent?.position.x ?? 0) + width / 2;
    };
    const canvasEdges = (snapshot?.links ?? []).flatMap((link) => {
      const source = link.a.worktree_path ? worktreeNodeId(link.a.project_id, link.a.worktree_path) : projectNodeId(link.a.project_id);
      const target = link.b.worktree_path ? worktreeNodeId(link.b.project_id, link.b.worktree_path) : projectNodeId(link.b.project_id);
      if (!nodeById.has(source) || !nodeById.has(target)) return [];
      const rightward = centerX(source) <= centerX(target);
      return [{ id: link.id, source, target, sourceHandle: rightward ? "right-source" : "left-source", targetHandle: rightward ? "left-target" : "right-target", type: "link" as const, selected: link.id === selectedLink, data: { activity: linkActivity(linkedWork, link.id), onStop: stopNegotiation }, style: { stroke: link.id === selectedLink ? "var(--color-accent)" : "var(--color-ink-3)", strokeWidth: 2 } }];
    });
    const groups = focusLink ? [focusLink] : snapshot?.projectGroups ?? [];
    const memberships = groups.flatMap(group => {
      const members = group.projectIds.map(projectNodeId).filter(id => nodeById.has(id));
      return members.slice(1).map(target => {
        const source = members[0], rightward = centerX(source) <= centerX(target);
        return { id: `membership:${group.id}:${target}`, source, target, type: 'membership', sourceHandle: rightward ? 'right-source' : 'left-source', targetHandle: rightward ? 'left-target' : 'right-target', selectable: false, deletable: false, data: { name: group.name, linkId: group.id }, style: { stroke: 'var(--color-accent)', strokeWidth: 2, strokeDasharray: '5 4' } };
      });
    });
    return [...canvasEdges, ...memberships];
  }, [snapshot?.links, snapshot?.projectGroups, focusLink, selectedLink, linkedWork, stopNegotiation, nodeById]);
  const connect = useCallback(async (connection: Connection) => {
    const a = nodeById.get(connection.source)?.data.endpoint;
    const b = nodeById.get(connection.target)?.data.endpoint;
    if (!a || !b) return;
    try { const links = await window.milagre.addLink(a, b); setSnapshot(current => current && { ...current, links }); setError(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }, [nodeById]);
  const remove = async () => {
    if (!selectedLink) return;
    try { const links = await window.milagre.removeLink(selectedLink); setSnapshot(current => current && { ...current, links }); setSelectedLink(null); setError(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const savePosition = async (_event: unknown, node: CanvasNode) => {
    try {
      if (node.data.kind === "project") await window.milagre.setProjectPosition(node.data.endpoint.project_id, node.position);
      else if (node.data.endpoint.worktree_path) await window.milagre.setWorktreePosition(node.data.endpoint.project_id, node.data.endpoint.worktree_path, node.position);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  return <section data-canvas className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-window bg-surface shadow-card">
    <div className="flex shrink-0 items-center gap-3 border-b border-line px-5 py-3">
      <button type="button" className="rounded-lg px-2 py-1 text-sm text-ink-2 hover:bg-hover-2" onClick={onBack}>Back to chat</button>
      <h1 className="flex-1 text-sm font-semibold text-ink">Projects and Links</h1>
      {selectedLink && <button type="button" className="rounded-lg border border-line px-3 py-1 text-xs text-ink hover:bg-hover-2" onClick={() => void remove()}>Remove Link</button>}
      <button type="button" className="rounded-lg px-2 py-1 text-xs text-ink-2 hover:bg-hover-2" onClick={() => void refresh()}>Refresh</button>
    </div>
    {error && <div role="alert" className="border-b border-line px-5 py-2 text-xs text-red-500">{error}</div>}
    <div className="min-h-0 flex-1">
      {snapshot ? <ReactFlow className="milagre-canvas-flow" nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={onNodesChange} onConnect={connection => void connect(connection)} onNodeDragStop={(event, node) => void savePosition(event, node)} onEdgeClick={(_event, edge) => { if (edge.type === 'link') setSelectedLink(edge.id); }} onPaneClick={() => setSelectedLink(null)} fitView fitViewOptions={{ padding: 0.15 }} nodesConnectable edgesReconnectable={false} deleteKeyCode={null}>
        <Background gap={24} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow> : <div className="flex h-full items-center justify-center text-sm text-ink-3">Loading Projects…</div>}
    </div>
  </section>;
}
