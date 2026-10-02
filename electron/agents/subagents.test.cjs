const test = require('node:test');
const assert = require('node:assert/strict');
const { mapClaudeMessage, mapCodexNotification } = require('./events.cjs');
const child = events => events.find(e => e.type === 'subagent-update')?.agent;
const launch = { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 'spawn', name: 'Agent', input: { description: 'Review auth', prompt: 'Check authentication' } }] } };
test('Claude tracks background completion after the launch tool returns and isolates child output', () => {
 const state = {};
 assert.equal(child(mapClaudeMessage(launch, state)).status, 'running');
 mapClaudeMessage({ type:'system', subtype:'task_started', task_id:'task', tool_use_id:'spawn', task_type:'local_agent', description:'Review auth' }, state);
 const background = mapClaudeMessage({ type:'user', parent_tool_use_id:null, message:{content:[{type:'tool_result', tool_use_id:'spawn', content:'launched'}]}, tool_use_result:{status:'async_launched'} }, state);
 assert.notEqual(child(background)?.status, 'completed');
 const nested = mapClaudeMessage({type:'assistant', parent_tool_use_id:'spawn', message:{id:'m1',content:[{type:'text',text:'Found an auth issue'}]}}, state);
 assert.equal(child(nested).transcript[0].text, 'Found an auth issue');
 assert.equal(nested.some(e=>e.type==='text-delta'), false);
 const done = child(mapClaudeMessage({type:'system',subtype:'task_notification',task_id:'task',status:'failed',summary:'Review crashed'},state));
 assert.equal(done.id, 'spawn');
 assert.equal(done.status, 'failed');
 assert.equal(done.transcript[0].text, 'Found an auth issue');
});
test('Claude excludes shell tasks and handles foreground results', () => {
 const state = {};
 assert.equal(child(mapClaudeMessage({type:'system',subtype:'task_started',task_id:'bash',task_type:'local_bash',description:'sleep'},state)), undefined);
 mapClaudeMessage(launch,state);
 assert.equal(child(mapClaudeMessage({type:'user',parent_tool_use_id:null,message:{content:[{type:'tool_result',tool_use_id:'spawn',content:'All good'}]}},state)).status,'completed');
});
test('Codex tracks each receiver, explicit waits, and never leaks unrelated threads', () => {
 const state = {threadId:'root',turnId:'turn'};
 const item = {id:'spawn',type:'collabAgentToolCall',tool:'spawnAgent',status:'completed',senderThreadId:'root',receiverThreadIds:['child'],prompt:'Review auth',agentsStates:{child:{status:'running',message:null}}};
 assert.equal(child(mapCodexNotification('item/completed',{threadId:'root',turnId:'turn',item},state)).status,'running');
 const waiting = mapCodexNotification('item/started',{threadId:'root',turnId:'turn',item:{...item,id:'wait',tool:'wait'}},state);
 assert.ok(waiting.some(e=>e.type==='subagents-waiting' && e.waiting));
 assert.deepEqual(mapCodexNotification('item/agentMessage/delta',{threadId:'stranger',delta:'secret'},state),[]);
 const output = mapCodexNotification('item/completed',{threadId:'child',item:{id:'reply',type:'agentMessage',text:'Found issue'}},state);
 assert.equal(child(output).transcript[0].text,'Found issue');
 assert.equal(output.some(e=>e.type==='turn-completed'),false);
 const done = mapCodexNotification('item/completed',{threadId:'root',turnId:'turn',item:{...item,id:'wait',tool:'wait',agentsStates:{child:{status:'completed',message:'Found issue'}}}},state);
 assert.equal(child(done).status,'completed');
 assert.ok(done.some(e=>e.type==='subagents-waiting' && !e.waiting));
});
test('Codex native activity records expose children even without a collab tool call', () => {
 const state={threadId:'root'};
 const events=mapCodexNotification('item/completed',{threadId:'root',item:{type:'subAgentActivity',id:'activity',kind:'started',agentThreadId:'native-child',agentPath:'/root/review'}},state);
 assert.equal(child(events).id,'native-child');
 assert.equal(child(events).status,'running');
 assert.equal(child(mapCodexNotification('thread/status/changed',{threadId:'native-child',status:{type:'systemError'}},state)).status,'failed');
});
test('canceling the parent settles children without claiming successful completion', () => {
 const {settleSubagents}=require('./subagents.cjs');
 const state={};
 mapClaudeMessage(launch,state);
 assert.equal(child(settleSubagents(state,'cancelled')).status,'cancelled');
 assert.deepEqual(settleSubagents(state,'cancelled'),[]);
});
test('a resumed Codex parent can rediscover a child through wait results', () => {
 const agent=child(mapCodexNotification('item/completed',{threadId:'root',item:{type:'collabAgentToolCall',id:'wait',tool:'wait',receiverThreadIds:['existing'],agentsStates:{existing:{status:'completed',message:'Saved result'}}}},{threadId:'root'}));
 assert.equal(agent.id,'existing');
 assert.equal(agent.transcript[0].text,'Saved result');
});
test('Claude waits until all foreground children have returned', () => {
 const state={};
 mapClaudeMessage(launch,state);
 mapClaudeMessage({...launch,message:{content:[{...launch.message.content[0],id:'second'}]}},state);
 const first=mapClaudeMessage({type:'user',parent_tool_use_id:null,message:{content:[{type:'tool_result',tool_use_id:'spawn',content:'Done'}]}},state);
 assert.equal(first.find(e=>e.type==='subagents-waiting').waiting,true);
});
