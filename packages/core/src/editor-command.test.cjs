const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {editorInvocation}=require('./editor-command.cjs');
test('Windows VS Code opens paths with spaces and shell characters as literal arguments',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'milagre-editor-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'bin'));fs.mkdirSync(path.join(root,'resources/app/out'),{recursive:true});
  const file=path.join(root,'bin/code.cmd');fs.writeFileSync(file,'wrapper');
  fs.writeFileSync(path.join(root,'Code.exe'),'exe');fs.writeFileSync(path.join(root,'resources/app/out/cli.js'),'cli');
  const args=['-g','C:\\Project files\\$(command) & file.ts:42'];
  const result=editorInvocation(file,args,{platform:'win32'});
  assert.equal(result.file,path.join(root,'Code.exe'));
  assert.deepEqual(result.args,[path.join(root,'resources/app/out/cli.js'),...args]);
  assert.equal(result.env.ELECTRON_RUN_AS_NODE,'1');
  fs.unlinkSync(path.join(root,'Code.exe'));assert.throws(()=>editorInvocation(file,args,{platform:'win32'}));
});
test('other platforms and unknown editor wrappers retain standard invocation',()=>{
  assert.equal(editorInvocation('/usr/bin/code',['/project'],{platform:'linux'}),null);
  assert.equal(editorInvocation('/trusted/bin/other.cmd',[],{platform:'win32'}),null);
});
