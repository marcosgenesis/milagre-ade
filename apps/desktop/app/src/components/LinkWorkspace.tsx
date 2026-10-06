import { useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import type { LinkState, ModelProvider, OpenLink, WorktreeBinding } from '@milagre/shared/model';
import { chatKeyForScope, scopeKey } from '@milagre/shared/chat-scopes';
import { chatTitle } from '@milagre/shared/chats';
import { ipcErrorMessage } from '@milagre/shared/result';
import { DotBackground } from './DotBackground';
import SidebarNav from './SidebarNav';
import { DraftChatComposer } from './DraftChatComposer';
import { createDraftStore } from '../lib/draft-store';
import { createScopeDrafts, linkChatRows, memberWorktreeForAction } from '../lib/link-scope';
import { usePastedImages } from './usePastedImages';
import type { useAgentRuns } from './useAgentRuns';
import { attachmentPrompt } from '../lib/media';
import { modelForChat, sentDecision, sentReply } from '../lib/agent-runs';
import { PermissionCard } from './agents/PermissionCard';
import { QuestionCard } from './agents/QuestionCard';
import { handoverLinks, handoverModel } from '../lib/handover';
import { getSettings } from '../lib/settings';
import { EditorLinks } from './editor-links';
import { openInEditor } from '../lib/editors';
import { isModalOpen } from '../lib/modal';
import { GitActionsDialog } from './GitActionsDialog';
import { gitChatContext } from '../lib/git-dialog';
import { Select } from './primitives/Select';

type Preferences = Pick<ComponentProps<typeof DraftChatComposer>, 'models' | 'selectedModel' | 'onModelChange' | 'cliStatus' | 'onModelPickerOpen' | 'onUpdateCli' | 'updatingCli' | 'capability' | 'effort' | 'onEffortChange' | 'ultracode' | 'onUltracodeChange' | 'fastMode' | 'onFastModeChange' | 'permissionMode' | 'onPermissionModeChange'>;
export function LinkWorkspace({ opened, state, agents, preferences, drafts, onSwitchProject, onSwitchLink, onLinkProject, onOpenProject, onSettings, onCanvas, usage, initialSessionId }: {
  opened: OpenLink; state: LinkState; agents: ReturnType<typeof useAgentRuns>; preferences: Preferences;
  drafts: ReturnType<typeof createScopeDrafts>; initialSessionId?: number;
  onSwitchProject: (path: string) => void; onSwitchLink: (id: string) => void; onLinkProject: () => void;
  onOpenProject: () => void; onSettings: () => void; onCanvas: () => void; usage?: ReactNode;
}) {
  const scope = { kind: 'link' as const, linkId: opened.link.id }, owner = scopeKey(scope);
  const draftStore = useMemo(createDraftStore, [owner]);
  const saved = drafts.read(scope);
  const [sessionId, setSessionId] = useState<number | null>(() => initialSessionId ?? saved.sessionId ?? Object.values(state.sessions).filter(session => !session.archived).at(-1)?.id ?? null);
  const session = sessionId == null ? undefined : state.sessions[sessionId];
  const chatId = session ? chatKeyForScope(scope, session.id) : null;
  const run = chatId ? agents.runs[chatId] : undefined;
  const messages = state.messages.filter(message => message.session_id === sessionId);
  const imageDraft = usePastedImages(`${owner}:${sessionId ?? 'new'}`);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findSignal, setFindSignal] = useState(0);
  const [memberId, setMemberId] = useState<string>('');
  const [gitDialog, setGitDialog] = useState<{ sessionId: number; member: WorktreeBinding } | null>(null);
  const [gitChoice, setGitChoice] = useState<number | null>(null);
  const pendingOperation = useRef<string | null>(null);
  const latest = useRef({ sessionId, text: '', active: true });
  latest.current.sessionId = sessionId;
  useEffect(() => {
    latest.current.active = true; draftStore.set(saved.text);
    const unsubscribe = draftStore.subscribe(() => { latest.current.text = draftStore.get(); });
    return () => { latest.current.active = false; drafts.save(scope, { text: draftStore.get(), sessionId: latest.current.sessionId }); unsubscribe(); };
  }, [owner]);
  useEffect(() => { void window.milagre.setOpenChat(chatId).catch(error => setError(ipcErrorMessage(error))); }, [chatId]);
  useEffect(() => {
    if (initialSessionId !== undefined) setSessionId(initialSessionId);
  }, [initialSessionId]);
  useEffect(() => {
    const model = modelForChat(preferences.selectedModel, session?.provider, messages, preferences.models);
    if (model.id !== preferences.selectedModel.id) preferences.onModelChange(model);
  }, [sessionId, session?.provider]);
  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || isModalOpen()) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); setFindOpen(true); setFindSignal(value => value + 1); }
      if (event.key !== 'Escape') return;
      if (findOpen) { event.preventDefault(); setFindOpen(false); return; }
      if (!chatId || !run) return;
      event.preventDefault();
      const approval = run.approvals[0], question = run.questions[0];
      if (approval && !run.answered[approval.requestId]) void agents.respond(chatId, approval.requestId, 'deny');
      else if (question && !run.answered[question.requestId]) void agents.answerQuestion(chatId, question.requestId, null);
      else void agents.interrupt(chatId);
    }
    window.addEventListener('keydown', shortcut); return () => window.removeEventListener('keydown', shortcut);
  }, [chatId, run, findOpen]);
  function pick(id: number | null) {
    setSessionId(id); draftStore.set(''); imageDraft.clear(); setError(null); setMemberId(''); setFindOpen(false); pendingOperation.current = null;
  }
  async function send(body = draftStore.get().trim(), preserve = false) {
    if (preparing || imageDraft.loading || !body && !imageDraft.images.length && !imageDraft.files.length && session?.handoverDraft === undefined) return;
    setPreparing(true); setError(null);
    pendingOperation.current ??= crypto.randomUUID();
    const model = modelForChat(preferences.selectedModel, session?.provider, messages, preferences.models);
    try {
      const sent = await window.milagre.sendLinkMessage({ linkId: opened.link.id, sessionId, operationId: pendingOperation.current, body, prompt: attachmentPrompt(body, imageDraft.files), images: imageDraft.images, files: imageDraft.files, provider: model.provider, model: model.id, permissionMode: preferences.permissionMode, effort: preferences.effort, ultracode: preferences.ultracode, fastMode: preferences.fastMode, replies: getSettings().claudeReplies, tldrEnabled: getSettings().tldrEnabled });
      pendingOperation.current = null;
      if (latest.current.active) { setSessionId(sent.sessionId); if (!preserve) { draftStore.set(''); imageDraft.clear(); } }
    } catch (error) { if (latest.current.active) setError(ipcErrorMessage(error)); }
    finally { if (latest.current.active) setPreparing(false); }
  }
  async function handover(provider: ModelProvider) {
    if (!session) return;
    const model = handoverModel(preferences.selectedModel, provider, state.messages, preferences.models); if (!model) return;
    try {
      const target = await window.milagre.handover({ projectPath: owner, sessionId: session.id, provider, model: model.id, permissionMode: preferences.permissionMode, effort: preferences.effort, tldrEnabled: getSettings().tldrEnabled });
      if (latest.current.active) { pick(target.sessionId); preferences.onModelChange(model); }
    } catch (error) { setError(ipcErrorMessage(error)); }
  }
  const recents = linkChatRows(state).map(row => {
    const running = agents.runs[chatKeyForScope(scope, Number(row.id))];
    return { ...row, mark: running?.questions.length ? 'question' as const : running?.approvals.length ? 'waiting' as const : running ? 'running' as const : row.unread ? 'unread' as const : 'idle' as const };
  });
  const approval = run?.approvals[0], question = approval ? undefined : run?.questions[0];
  const root = session?.workspacePath ?? '';
  const chosen = session?.worktrees.find(member => member.projectId === memberId);
  return <DotBackground>
    <div aria-hidden className="fixed inset-x-0 top-0 z-50 h-10 [-webkit-app-region:drag]" />
    <div className="flex min-h-0 min-w-0 flex-1 gap-3 overflow-hidden text-ink">
      <div className="flex min-h-0 shrink-0 pt-[60px] pb-3 pl-3"><SidebarNav fill workspaceName={opened.link.name} selectedLink={{ id: opened.link.id, projects: opened.projects }} onSwitchLink={onSwitchLink} onLinkProject={onLinkProject} onSwitchProject={onSwitchProject} onOpenProject={onOpenProject} onOpenSettings={onSettings} onOpenCanvas={onCanvas} onNewChat={() => pick(null)} onPick={id => pick(Number(id))} activeId={sessionId == null ? null : String(sessionId)} recents={recents} usage={usage} chatActions={{ onRename: (id, title) => void window.milagre.patchChat(owner, Number(id), { title }).catch(error => setError(ipcErrorMessage(error))), onMarkUnread: (id, unread) => void window.milagre.patchChat(owner, Number(id), { unread }), onReveal: id => { const target = state.sessions[id]; if (target) void window.milagre.revealInFolder(target.workspacePath); }, onOpenInEditor: id => { const target = state.sessions[id]; if (target) void openInEditor(target.workspacePath); }, onCommit: id => { setGitChoice(Number(id)); setMemberId(''); }, onArchive: id => { const key = chatKeyForScope(scope, Number(id)); void agents.interrupt(key).then(() => window.milagre.patchChat(owner, Number(id), { archived: true })).then(() => { if (sessionId === Number(id)) pick(null); }).catch(error => setError(ipcErrorMessage(error))); } }} /></div>
      <main data-chat-pane className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden pr-3 pb-3">
        {session && <div className="absolute right-5 top-3 z-20 flex items-center gap-2 [-webkit-app-region:no-drag]"><button type="button" onClick={() => { setGitChoice(session.id); setMemberId(''); }} className="rounded-control px-2 py-1 text-xs text-ink-2 hover:bg-hover-2">Commit and open PR…</button><button type="button" onClick={() => void openInEditor(root)} className="rounded-control px-2 py-1 text-xs text-ink-2 hover:bg-hover-2">Open in editor</button></div>}
        <EditorLinks root={root}><DraftChatComposer {...preferences} scopeKind="link" store={draftStore} projectPath={root} messages={messages} imageDraft={imageDraft} onSend={() => void send()} onStop={chatId && run ? () => void agents.interrupt(chatId) : undefined} isSending={Boolean(run && !approval && !question)} sendBlocked={preparing || Boolean(session?.handoverPending)} streamingText={run?.text} streamingSteps={run?.steps} runStartedAt={run?.startedAt} runModelName={run?.model} tasks={run?.tasks} subagents={session?.subagents} waitingForSubagents={run?.waitingForSubagents} asking={Boolean(question)} waitingStepIds={run?.approvals.flatMap(request => request.stepId ? [request.stepId] : [])} lockedProvider={messages.length ? session?.provider : undefined} onHandover={provider => void handover(provider)} canHandover={messages.length > 0} handover={{ ...handoverLinks(session, state), onOpen: pick }} handoverBrief={session?.handoverDraft !== undefined && chatId ? { chatId, brief: session.handoverDraft, onSave: text => window.milagre.setHandoverDraft(owner, session.id, text) } : undefined} resume={session?.resumeTurn ? { onContinue: () => void window.milagre.resumeChat(owner, session.id).catch(error => setError(ipcErrorMessage(error))) } : undefined} onArchiveSubagent={(id, archived) => { if (session) void window.milagre.archiveSubagent(owner, session.id, id, archived); }} onArchiveFinishedSubagents={() => { if (session) void window.milagre.archiveFinishedSubagents(owner, session.id); }} onPermissionModeChange={mode => { preferences.onPermissionModeChange(mode); if (chatId) void window.milagre.setAgentPermissionMode(chatId, mode); }} onRecommendationSelect={option => void send(option)} worktrees={[]} onWorktreeChange={() => {}} isolation="worktree" onIsolationChange={() => {}} branches={[]} baseBranch="" onBaseBranchChange={() => {}} newChatError={error} findOpen={findOpen} findSignal={findSignal} onFindClose={() => setFindOpen(false)} approval={approval && chatId ? <PermissionCard request={approval} waiting={(run?.approvals.length ?? 1) - 1} answering={sentDecision(run, approval.requestId)} onAnswer={decision => void agents.respond(chatId, approval.requestId, decision)} /> : question && chatId ? <QuestionCard request={question} waiting={(run?.questions.length ?? 1) - 1} answering={sentReply(run, question.requestId)} onAnswer={answer => void agents.answerQuestion(chatId, question.requestId, answer)} /> : undefined} /></EditorLinks>
      </main>
    </div>
    {gitChoice !== null && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-overlay" onClick={() => setGitChoice(null)}><div role="dialog" aria-modal="true" aria-label="Choose Project for Git" className="w-[380px] rounded-card bg-surface p-5 shadow-overlay" onClick={event => event.stopPropagation()}><h2 className="text-[16px] font-semibold">Choose a Project</h2><p className="mt-1 mb-4 text-[13px] text-ink-2">Git actions apply to one Worktree.</p><Select label="Project" value={memberId} onChange={setMemberId} options={(state.sessions[gitChoice]?.worktrees ?? []).map(member => ({ value: member.projectId, label: opened.projects.find(project => project.id === member.projectId)?.name ?? member.projectId, description: member.worktreePath }))} /><div className="mt-4 flex justify-end gap-2"><button type="button" className="rounded-control px-3 py-2 text-sm hover:bg-hover-2" onClick={() => setGitChoice(null)}>Cancel</button><button type="button" disabled={!memberId} className="rounded-control bg-ink px-3 py-2 text-sm text-surface disabled:opacity-40" onClick={() => { setGitDialog({ sessionId: gitChoice, member: memberWorktreeForAction(state, gitChoice, memberId) }); setGitChoice(null); }}>Continue</button></div></div></div>}
    {gitDialog && <GitActionsDialog cwd={gitDialog.member.worktreePath} base={gitDialog.member.base} provider={state.sessions[gitDialog.sessionId]?.provider} chat={gitChatContext(chatTitle(state.sessions[gitDialog.sessionId], state.messages.filter(message => message.session_id === gitDialog.sessionId)), state.messages.filter(message => message.session_id === gitDialog.sessionId))} turnRunning={Boolean(agents.runs[chatKeyForScope(scope, gitDialog.sessionId)])} onClose={() => setGitDialog(null)} onSendToAgent={text => { pick(gitDialog.sessionId); draftStore.set(text); }} onRan={note => void window.milagre.addGitNote(chatKeyForScope(scope, gitDialog.sessionId), note)} />}
  </DotBackground>;
}
