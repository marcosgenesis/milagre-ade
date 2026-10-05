// Exercise real npm's extensionless + .cmd pair without changing the user's global CLI.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {resolveExecutable}=require('@milagre/core/agents/environment');
const {inspectCli}=require('@milagre/core/agents/cli');
async function main() {
  assert.equal(process.platform,'win32');
  const prefix=path.resolve(process.argv[2]);
  assert.ok(fs.existsSync(path.join(prefix,'codex.cmd')),'Install Codex with npm into the test prefix');
  assert.ok(fs.existsSync(path.join(prefix,'codex')),'npm creates its Unix shim beside the Windows launcher');
  const project=fs.mkdtempSync(path.join(os.tmpdir(),'milagre-cli-project-'));
  const original=process.cwd();
  try {
    fs.writeFileSync(path.join(project,'codex.cmd'),'@echo Project command must never run\r\nexit /b 55\r\n');
    process.chdir(project);
    const env={...process.env};
    const key=Object.keys(env).find(key=>key.toLowerCase()==='path') || 'Path';
    env[key]=prefix+path.delimiter+env[key];
    const status=await inspectCli('codex',{resolve:name=>resolveExecutable(name,{env})});
    assert.equal(status.command.toLowerCase(),path.join(prefix,'codex.cmd').toLowerCase());
    assert.equal(status.problem,undefined,JSON.stringify(status));
    assert.equal(status.version,'0.160.0');
    console.log('PASS: real Windows npm Codex launcher starts, reports its version and ignores Project commands');
  } finally {process.chdir(original);fs.rmSync(project,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
