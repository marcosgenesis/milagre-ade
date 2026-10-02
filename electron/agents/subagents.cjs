// Provider-owned children have their own lifecycle; a launch tool finishing is not a child finishing.
const { capOutput, claudeStep, codexStep } = require('./steps.cjs');
const active = agent => ['running', 'initializing', 'waiting'].includes(agent.status);
function update(state, id, patch, entry) {
  state.subagents ??= new Map();
  const previous = state.subagents.get(id);
  const time = Date.now();
  const agent = { id, title: 'Subagent', status: 'running', startedAt: time, transcript: [], ...previous, ...patch, updatedAt: time };
  if (entry?.text) {
    agent.transcript = [...agent.transcript.filter(row => row.id !== entry.id), { ...entry, text: capOutput(entry.text) }].slice(-100);
  }
  if (!active(agent)) agent.endedAt ??= time;
  else delete agent.endedAt;
  state.subagents.set(id, agent);
  return { type: 'subagent-update', agent };
}
const textContent = content => typeof content === 'string' ? content : (content ?? []).map(b => b.text ?? b.content ?? '').filter(v=>typeof v==='string').join('\n');
function claudeSubagents(message, state) {
  const events = [];
  const parent = message.parent_tool_use_id;
  const content = message.message?.content;
  if (message.type === 'assistant' && Array.isArray(content)) {
    for (const [index, block] of content.entries()) {
      if (block.type === 'tool_use' && ['Agent','Task'].includes(block.name)) {
        if (!parent && !block.input?.run_in_background) {
          state.foregroundChildren ??= new Set();
          state.foregroundChildren.add(block.id);
          events.push({type:'subagents-waiting',waiting:true});
        }
        events.push(update(state, block.id, { title: block.input?.description || 'Subagent', prompt: block.input?.prompt, ...(parent ? {parentId:parent} : {}) }));
      }
      if (parent && state.subagents?.has(parent)) {
        const text = block.type === 'text' ? block.text : block.type === 'thinking' ? block.thinking : block.type === 'tool_use' ? claudeStep(block.id, block.name, block.input).title : '';
        events.push(update(state, parent, { latestActivity: block.type === 'tool_use' ? text : 'Responding' }, { id: `${message.uuid ?? message.message.id}:${block.id ?? index}:${block.type}`, kind: block.type === 'tool_use' ? 'tool' : 'message', text }));
      }
    }
  }
  if (message.type === 'user' && Array.isArray(content)) {
    for (const block of content) {
      if (block.type !== 'tool_result') continue;
      if (state.subagents?.has(block.tool_use_id)) {
        if (!parent) {
          state.foregroundChildren?.delete(block.tool_use_id);
          events.push({type:'subagents-waiting',waiting:Boolean(state.foregroundChildren?.size)});
        }
        if (message.tool_use_result?.status !== 'async_launched') events.push(update(state, block.tool_use_id, {status:block.is_error ? 'failed':'completed',latestActivity:'Finished'}, {id:'result',kind:'message',text:textContent(block.content)}));
      }
      if (parent && state.subagents?.has(parent)) events.push(update(state,parent,{}, {id:`result:${block.tool_use_id}`,kind:'tool',text:textContent(block.content)}));
    }
  }
  if (message.type === 'system' && message.subtype?.startsWith('task_')) {
    state.taskAgents ??= new Map();
    let id = state.taskAgents.get(message.task_id) ?? message.tool_use_id;
    const known = id && state.subagents?.has(id);
    if (!known && !(message.subtype === 'task_started' && (message.task_type === 'local_agent' || message.subagent_type))) return events;
    id ??= message.task_id;
    state.taskAgents.set(message.task_id,id);
    const patch = { ...(message.description ? {title:message.description} : {}), ...(message.prompt ? {prompt:message.prompt} : {}) };
    if (message.subtype === 'task_started') patch.status = 'running';
    if (message.subtype === 'task_progress') patch.latestActivity = message.summary || message.last_tool_name || message.description;
    if (message.subtype === 'task_notification') {
      patch.status = {completed:'completed',failed:'failed',stopped:'cancelled'}[message.status] ?? 'unknown';
      patch.latestActivity = message.summary;
    }
    if (message.subtype === 'task_updated') {
      if (message.patch.status) patch.status = {pending:'initializing',running:'running',completed:'completed',failed:'failed',killed:'cancelled',paused:'waiting'}[message.patch.status] ?? 'unknown';
      if (message.patch.description) patch.title = message.patch.description;
    }
    events.push(update(state,id,patch,message.summary ? {id:'summary',kind:'message',text:message.summary}:undefined));
  }
  return events;
}
const codexStatus = status => ({pendingInit:'initializing',running:'running',interrupted:'cancelled',completed:'completed',errored:'failed',shutdown:'cancelled',notFound:'unknown'}[status] ?? 'unknown');
function codexSubagents(method, params, state) {
  const item = params.item;
  const foreign = params.threadId && state.threadId && params.threadId !== state.threadId;
  if (foreign && !state.subagents?.has(params.threadId)) return [];
  if (!foreign && state.turnId && params.turnId && params.turnId !== state.turnId) return [];
  const events = [];
  if (item?.type === 'subAgentActivity' && ['item/started','item/completed'].includes(method)) {
    const status = {started:'running',interacted:'running',interrupted:'cancelled',completed:'completed'}[item.kind];
    events.push(update(state,item.agentThreadId,{title:item.agentPath || 'Subagent',status:status ?? 'unknown',...(foreign?{parentId:params.threadId}:{})}));
  }
  if (foreign && method === 'thread/status/changed') {
    const status = {active:'running',systemError:'failed',notLoaded:'unknown'}[params.status?.type];
    if (status) events.push(update(state,params.threadId,{status}));
  }
  if (item?.type === 'collabAgentToolCall' && ['item/started','item/completed'].includes(method)) {
    for (const id of item.receiverThreadIds ?? []) {
      const status = item.agentsStates?.[id];
      if (!state.subagents?.has(id) && !status && item.tool !== 'spawnAgent') continue;
      const patch = { ...(foreign ? {parentId:params.threadId} : {}), ...(item.tool === 'spawnAgent' ? {title:item.prompt?.split('\n')[0].slice(0,120) || 'Subagent',prompt:item.prompt} : {}), ...(status ? {status:codexStatus(status.status)} : {}) };
      events.push(update(state,id,patch,status?.message ? {id:'result',kind:'message',text:status.message}:undefined));
    }
    if (!foreign && item.tool === 'wait') events.push({type:'subagents-waiting',waiting:method === 'item/started'});
  }
  if (foreign && method === 'item/completed' && item) {
    const step = codexStep(item);
    const text = item.type === 'agentMessage' ? item.text : item.type === 'reasoning' ? (item.summary ?? []).join('\n') : step ? [step.title,item.aggregatedOutput].filter(Boolean).join('\n') : '';
    if (text) events.push(update(state,params.threadId,{latestActivity:step?.title || 'Responding'}, {id:item.id,kind:step?'tool':'message',text}));
  }
  if (foreign && method === 'turn/started') events.push(update(state,params.threadId,{status:'running'}));
  if (foreign && method === 'turn/completed') events.push(update(state,params.threadId,{status:params.turn?.status === 'failed' ? 'failed' : params.turn?.status === 'interrupted' ? 'cancelled' : 'completed'}));
  return events;
}
function settleSubagents(state,status) {
  return [...(state.subagents?.values() ?? [])].filter(active).map(agent=>update(state,agent.id,{status}));
}
module.exports = { claudeSubagents, codexSubagents, settleSubagents, active };
