// Real Electron rendering of the composer and simulator entry point. No simulator required.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const {setTimeout:delay} = require('node:timers/promises');
const fixture = `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { ChatComposer } from "/src/components/ChatComposer";
import { MODEL_CATALOG, capabilityFor } from "/src/model";
import "/src/styles.css";
const noop = () => {};
window.deviceCount = 3;
window.attachedIds = [0,1];
window.simulatorCalls = [];
window.simulatorClosed = [];
const device = i => i === 0 ? {id:'device-0',name:'iPhone 17',platform:'ios',version:'27'} : {id:'device-'+i,name:i===1?'Pixel 9':'Other Chat device',platform:'android',version:'16'};
window.milagre = { simulators: {
 list: async ({chatId}) => ({chatId,devices:window.attachedIds.map(device),attached:window.attachedIds.map(device),available:Array.from({length:window.deviceCount},(_,i)=>i).filter(i=>!window.attachedIds.includes(i)).map(device),supported:true}),
 attach: async ({chatId,deviceId}) => {window.attachedIds.push(Number(deviceId.split('-')[1]));return window.milagre.simulators.list({chatId});},
 detach: async ({chatId,deviceId}) => {window.attachedIds=window.attachedIds.filter(i=>device(i).id!==deviceId);return window.milagre.simulators.list({chatId});},
 open: async args => { window.simulatorCalls.push(args); return {viewerId:'view-'+window.simulatorCalls.length,device:device(Number(args.deviceId.split('-')[1])),iceServers:[]}; },
 offer: async () => {throw Error('Test connection failed. Retry to reconnect.');},
 status: async () => ({width:588,height:1280,orientation:'portrait',generation:1,controlling:false,ready:true}),
 control: async () => ({width:588,height:1280,orientation:'portrait',generation:2,controlling:true,ready:true}),
 close: async args => {window.simulatorClosed.push(args.viewerId);return null;},
 input: async () => ({accepted:true}),
}};
function Fixture() {
  const [count, setCount] = useState(2);
  const [children, setChildren] = useState([
    {id:"review",title:"Review authentication",prompt:"Check auth for regressions",status:"running",startedAt:Date.now()-65000,updatedAt:Date.now(),latestActivity:"Reading auth.ts",transcript:[{id:"a",kind:"message",text:"Child-only finding"}]},
    {id:"tests",title:"Run tests",status:"failed",startedAt:Date.now()-40000,updatedAt:Date.now(),endedAt:Date.now(),transcript:[{id:"b",kind:"tool",text:"Tests failed"}]}
  ]);
  const [sending, setSending] = useState(true);
  const [tasks, setTasks] = useState([
    {id:"0",content:"Read the composer",status:"completed"},
    {id:"1",content:"Add the task pill",activeForm:"Adding the task pill",status:"in_progress"},
    {id:"2",content:"Write tests",status:"pending"},
    {id:"3",content:"Run the build",status:"pending"},
    {id:"4",content:"Take screenshots",status:"pending"},
    {id:"5",content:"Fix the A very long task name that has to wrap onto a second line because the popover is narrow",status:"completed"},
    {id:"6",content:"Commit",status:"pending"}
  ]);
  window.setTasks = setTasks;
  window.setDark = (dark) => document.documentElement.classList.toggle("dark", dark);
  const archive = (id,archived) => setChildren(items=>items.map(child=>child.id===id ? {...child,archived} : child));
  const archiveFinished = () => setChildren(items=>items.map(child=>["completed","failed","cancelled"].includes(child.status) ? {...child,archived:true} : child));
  window.setChildren = setChildren;
  window.finishChildren = () => {setChildren(items=>items.map(item=>({...item,status:"completed",endedAt:Date.now()})));setSending(false);};
  const [draft, setDraft] = useState("");
  const [model, setModel] = useState(MODEL_CATALOG[0]);
  const [fastMode, setFastMode] = useState(false);
  window.setMessageCount = setCount;
  window.setDraft = setDraft;
  window.setModel = (id) => setModel(MODEL_CATALOG.find((item) => item.id === id));
  const messages = Array.from({ length: count }, (_, index) => ({
    id: index + 1, session_id: 1, context: null, role: index === 0 ? "user" : "assistant",
    body: index === 0 ? "Review authentication and run the relevant tests." : "I started two subagents. Their progress is available below.",
  }));
  return <div style={{ height: "100%", padding: 12 }}>
    <ChatComposer messages={messages}
      imageDraft={{ images: [], files: [], attachFiles: noop, attachPath: noop, removeFile: noop, loading: false, error: "", onPaste: noop, clear: noop, remove: noop }}
      projectPath="/fixture" draft={draft} onDraftChange={setDraft} onSend={noop} isSending={sending} sendBlocked={false} tasks={tasks} subagents={children} onArchiveFinishedSubagents={archiveFinished} onArchiveSubagent={archive} waitingForSubagents={true}
      models={MODEL_CATALOG} cliStatus={null} onModelPickerOpen={noop} selectedModel={model} onModelChange={noop}
      capability={capabilityFor(model, null)} onEffortChange={noop} ultracode={false} onUltracodeChange={noop}
      fastMode={fastMode} onFastModeChange={setFastMode} permissionMode="auto" onPermissionModeChange={noop}
      onRecommendationSelect={noop} worktrees={[]} onWorktreeChange={noop}
      isolation="local" onIsolationChange={noop} branches={[]} baseBranch="main" onBaseBranchChange={noop} newChatError={null} />
  </div>;
}
document.documentElement.classList.add("dark");
createRoot(document.getElementById("root")).render(<Fixture />);
`;
async function browserChecks() {
 const {app,BrowserWindow} = require('electron');
 app.setPath('userData',fs.mkdtempSync(path.join(require('node:os').tmpdir(),'milagre-simulator-ui-')));
 await app.whenReady();
 console.log('Electron ready');
 const watchdog=setTimeout(()=>{console.error('Electron UI check timed out');app.exit(1);},60000);
 const window = new BrowserWindow({width:1000,height:800,show:false,webPreferences:{backgroundThrottling:false}});
 window.webContents.on('console-message',details=>{if(details.level==='error')console.error(details.message);});
 window.webContents.on('did-fail-load',(_e,code,message)=>console.error('Page load failed',code,message));
 window.webContents.on('render-process-gone',(_e,details)=>console.error('Renderer gone',details));
 const evaluate = source => window.webContents.executeJavaScript(source);
 const waitFor = async source => {for(let i=0;i<200;i++){if(await evaluate(source))return;await delay(50);}throw Error('Timed out: '+source);};
 const click = selector => evaluate('document.querySelector('+JSON.stringify(selector)+').click()');
 const screenshot = async name => {if(!process.env.MILAGRE_SCREENSHOT_DIR)return;fs.mkdirSync(process.env.MILAGRE_SCREENSHOT_DIR,{recursive:true});await delay(150);fs.writeFileSync(path.join(process.env.MILAGRE_SCREENSHOT_DIR,name+'.png'),(await window.webContents.capturePage()).toPNG());};
 try {
  console.log('Loading fixture');
  await window.loadURL(process.argv[2]);
  console.log('Fixture loaded');
  await waitFor('document.querySelector("[data-slot=simulator-track]")?.textContent.includes("2")');
  assert.equal(await evaluate('window.simulatorCalls.length'),0,'closed pill must not start capture');
  assert.ok(await evaluate('!!document.querySelector("[data-slot=simulator-track] svg")'),'phone icon');
  assert.ok(await evaluate('document.querySelector("[data-slot=simulator-track]").parentElement === document.querySelector("[data-slot=subagent-track]").parentElement'),'same composer pill row');
  await evaluate('window.setMessageCount(0)');
  await waitFor('!document.querySelector("[data-slot=simulator-track]")');
  await screenshot('new-chat');
  await evaluate('window.setMessageCount(2)');
  await waitFor('!!document.querySelector("[data-slot=simulator-track]")');
  await screenshot('composer-dark');
  await click('[data-slot=simulator-track] button');
  await waitFor('document.querySelectorAll("[data-simulator-device]").length===2');
  assert.equal(await evaluate('window.simulatorCalls.length'),0,'chooser must not capture every device');
  assert.ok(await evaluate('document.querySelector("[data-simulator-device=device-1]").textContent.includes("Android 16")'),'Android device label');
  await screenshot('chooser-dark');
  await click('[data-simulator-device="device-0"]');
  await waitFor('window.simulatorCalls.length===1');
  await waitFor('document.querySelector("[data-slot=simulator-frame]")');
  await click('[aria-label="Expand simulator"]');
  await waitFor('document.querySelector("[data-slot=simulator-popover]").dataset.expanded==="true"');
  await screenshot('expanded-dark');
  const footerMatches = '(()=>{const doc=document.querySelector("[data-slot=simulator-frame]").contentDocument;return doc && getComputedStyle(doc.body).backgroundColor===getComputedStyle(document.querySelector("[data-slot=simulator-popover]")).backgroundColor})()';
  await waitFor(footerMatches);
  await evaluate('window.setDark(false)'); await waitFor(footerMatches);
  assert.equal(await evaluate('window.simulatorCalls.length'),1,'theme changes must preserve the viewer session');
  await screenshot('expanded-light');
  await evaluate('window.setDark(true)'); await waitFor(footerMatches);
  await click('[aria-label="Collapse simulator"]');
  window.setContentSize(390,500);await delay(200);
  assert.ok(await evaluate('(()=>{const r=document.querySelector("[data-slot=simulator-popover]").getBoundingClientRect();return r.top>=0&&r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})()'),'viewer fits short/narrow window');
  await screenshot('viewer-narrow');
  await click('[aria-label="Close simulator"]');
  await waitFor('!document.querySelector("[data-slot=simulator-popover]") && window.simulatorClosed.length>0');
  window.setContentSize(1000,800);await evaluate('window.setDark(false)');
  await screenshot('composer-light');
  await click('[data-slot=simulator-track] button');
  await waitFor('!!document.querySelector("[data-slot=simulator-popover]")');
  assert.equal(await evaluate('!!document.querySelector("[data-simulator-device=device-2]")'),false,'other Chat device is excluded');
  await screenshot('chooser-light');
  await evaluate('Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="Attach simulator").click()');
  await waitFor('!!document.querySelector("[data-simulator-device=device-2]")');
  assert.equal(await evaluate('!!document.querySelector("[data-simulator-device=device-0]")'),false);
  await screenshot('attach-light');
  await click('[data-simulator-device=device-2]');
  await waitFor('document.querySelector("[data-slot=simulator-track]").textContent.includes("3")');
  assert.equal(await evaluate('window.simulatorCalls.at(-1).chatId'),'/fixture#1');
  await click('[aria-label="Back to devices"]');
  await click('[aria-label="Detach Other Chat device from Chat"]');
  await waitFor('document.querySelector("[data-slot=simulator-track]").textContent.includes("2")');
  window.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});
  await waitFor('!document.querySelector("[data-slot=simulator-popover]")');
  console.log('PASS: icon/count and composer placement, on-demand capture, chooser, expand/collapse, narrow layout, close cleanup, Escape, light/dark screenshots');
  app.exit(0);
 } catch(error){console.error(error);app.exit(1);}
}
async function main(){
 const {createServer}=await import('vite'); const {spawn}=require('node:child_process');
 const server=await createServer({server:{host:'127.0.0.1',port:0},plugins:[{
  name:'simulator-fixture', resolveId(id){if(id==='/__simulators_fixture.tsx')return id;},load(id){if(id==='/__simulators_fixture.tsx')return fixture;},
  configureServer(server){server.middlewares.use(async(req,res,next)=>{if(req.url!=='/__simulators__')return next();res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml(req.url,'<html><body><div id="root"></div><script type="module" src="/__simulators_fixture.tsx"></script></body></html>'));});}
 }]});
 try {await server.listen();const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const child=spawn(require('electron'),[__filename,server.resolvedUrls.local[0]+'__simulators__'],{env,stdio:'inherit'});process.exitCode=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>resolve(code??1));});}finally{await server.close();}
}
(process.versions.electron?browserChecks():main()).catch(error=>{console.error(error);process.exitCode=1;});
