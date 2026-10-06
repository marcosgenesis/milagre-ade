// Demo data and the desktop renderer fixture shared by the README and site screenshot captures.
// No provider or personal data is read.
const fs = require('node:fs');
const path = require('node:path');
const projectPath = '/demo/milagre';
const projectImage = 'data:image/png;base64,' + fs.readFileSync(path.resolve(__dirname, '../../apps/desktop/app/public/logo-milagre-image.png')).toString('base64');
const topics = [
  ['Phone pairing follow-ups', 'feat/phone-pairing', 192],
  ['Find Projects from the phone', 'feat/project-search', 189],
  ['A sidebar for mobile', 'feat/mobile-sidebar', 186],
  ['Swipe between Chat and Changes', 'feat/swipe-navigation', 184],
  ['Keep the Chat timer running', 'fix/chat-timer', 177],
  ['Link Worktrees and share context', 'feat/linked-worktrees', 168],
];
const state = { next_id: 100, projects: { 1: { id: 1, name: 'Milagre' } }, worktrees: { 1: { id: 1, project_id: 1, path: projectPath, name: 'main' } }, sessions: {}, messages: [], connections: {}, events: [], approvals: [], tasks: {}, artifacts: {}, outputs: [], conflicts: [] };
topics.forEach(([title, branch], i) => {
  const id = i + 2;
  state.worktrees[id] = { id, project_id: 1, name: branch, path: `${projectPath}/${branch}`, base: 'main' };
  state.sessions[id] = { id, worktree_id: id, title, agent_name: title, provider: i % 2 ? 'claude' : 'codex', status: 'Stopped', ...(i === 4 ? { unread: true } : {}) };
  state.messages.push({ id: id * 10, session_id: id, role: 'user', body: `Let's work on ${title.toLowerCase()}.`, context: null, model: i % 2 ? 'claude-sonnet-5-5' : 'gpt-6.1-sol' });
});
const project = { path: projectPath, name: 'Milagre', state };
const run = (text, more = {}) => ({ text, model: 'gpt-6.1-sol', startedAt: Date.now() - 90000, steps: [], approvals: [], questions: [], answered: {}, ...more });
const runs = { runs: {
  [`${projectPath}#2`]: run('Checking the paired-phone count and reset flow.'),
  [`${projectPath}#3`]: run('', { questions: [{ id: 'search-scope', questions: [{ id: 'scope', header: 'Search', question: 'Should Project search include ignored folders?', options: [{ label: 'Skip ignored folders', description: 'Keep the results focused on Projects.' }, { label: 'Include everything', description: 'Search all folders.' }] }] }] }),
  [`${projectPath}#4`]: run('Testing the sidebar on iPhone.'),
  [`${projectPath}#5`]: run('', { approvals: [{ id: 'check', tool: 'Bash', input: { command: 'npm run test:mobile' }, description: 'Run the swipe navigation checks' }] }),
}, seq: 1 };
const models = { codex: null, claude: null };
const linked = { delegations: [], negotiations: [], receiveOnly: [] };

const desktopFixture = theme => `
import React from 'react';
import { createRoot } from 'react-dom/client';
import '/src/styles.css';
localStorage.setItem('milagre-settings', JSON.stringify({theme:'${theme}',defaultPermissionMode:'auto',notifyWhenWaiting:false,notifyOnCompletion:false,showDockBadge:false,showUsageInSidebar:false}));
window.addEventListener('error', e => console.error(e.error?.stack || e.message));
const project = ${JSON.stringify(project)}, runs = ${JSON.stringify(runs)};
const replies = {
  getCurrentProject: project, getRuns: runs, getModels: ${JSON.stringify(models)},
  getCliStatus: {codex:{state:'ready'},claude:{state:'ready'}},
  getRuntimeConnection: {connected:true}, getLinkedWork: ${JSON.stringify(linked)},
  listRecentProjects: [{path:project.path,name:project.name}], listBranches: ['main'],
  getWorktreeRoots: [], getCachedUsage: {providers:[]}, readUsage: {providers:[]}, getAgentPorts: {},
  getProjectImage: ${JSON.stringify(projectImage)}, getUpdateState: null, listSkills: {skills:[],warnings:[]}, listAgentPorts: [],
  readDiffStats: {}, getDiffStats: {},
};
window.milagre = new Proxy({}, {get(_, name) {
  if (name === 'git') return {diffStats: async () => ({added:0,removed:0}), diffFiles: async () => []};
  if (name.startsWith('on')) return () => () => {};
  if (name === 'readPullRequest') return async p => {
    const index = ${JSON.stringify(topics)}.findIndex(t => p.endsWith(t[1]));
    if (index < 0) return null;
    const [title,,number] = ${JSON.stringify(topics)}[index];
    return {number,title,url:'https://github.com/the-ptf/milagre-ade/pull/'+number,state:'OPEN',checks:index===0?'running':'passed',readyToMerge:index===5};
  };
  if (name === 'readPullRequests') return async (_, paths) => paths.map(() => null);
  return async () => name in replies ? replies[name] : null;
}});
// Settings are read when the module loads, so App is imported only after the theme is stored.
const { default: App } = await import('/src/App');
createRoot(document.getElementById('root')).render(<App />);
`;

module.exports = { projectPath, topics, project, runs, models, linked, projectImage, desktopFixture };
