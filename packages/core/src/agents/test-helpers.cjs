async function waitUntil(check, { timeoutMs = 3000, intervalMs = 10 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

function waitForOutput(child, { timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    let stderr = '';
    const diagnostic = () => stderr ? `\n${stderr}` : '';
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout?.off('data', output);
      child.stderr?.off('data', errorOutput);
      child.off('close', closed);
      child.off('error', failed);
    };
    const output = chunk => { cleanup(); resolve(chunk); };
    const errorOutput = chunk => { stderr = (stderr + String(chunk)).slice(-16384); };
    const closed = (code, signal) => { cleanup(); reject(new Error(`Fixture exited before output (code ${code}, signal ${signal})${diagnostic()}`)); };
    const failed = error => { cleanup(); reject(new Error(`Fixture launch failed: ${error.message}${diagnostic()}`, { cause: error })); };
    const timer = setTimeout(() => { cleanup(); reject(new Error(`Fixture startup timed out after ${timeoutMs}ms${diagnostic()}`)); }, timeoutMs);
    child.stdout?.once('data', output);
    child.stderr?.on('data', errorOutput);
    child.once('close', closed);
    child.once('error', failed);
  });
}

module.exports = { waitUntil, waitForOutput };
