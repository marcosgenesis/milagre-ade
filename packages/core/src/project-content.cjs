const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { decodeImages } = require('./image-input.cjs');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const inside = (root, target) => target === root || target.startsWith(root + path.sep);

async function contentDirectory(projectPath, folder) {
  const root = await fs.realpath(projectPath);
  const metadata = path.join(root, '.milagre');
  await fs.mkdir(metadata, { recursive: true });
  if (!inside(root, await fs.realpath(metadata))) throw new Error('Project content directory is outside the Project');
  const directory = path.join(metadata, folder);
  await fs.mkdir(directory, { recursive: true });
  if (!inside(metadata, await fs.realpath(directory))) throw new Error('Project content directory is outside the Project');
  return directory;
}

/** Immutable, content-addressed files keep both the old and new state valid during a save. */
async function writeContent(projectPath, folder, bytes, extension) {
  const directory = await contentDirectory(projectPath, folder);
  const name = `${digest(bytes)}.${extension}`;
  const file = path.join(directory, name);
  const temporary = path.join(directory, `.${name}.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
    try { await fs.link(temporary, file); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const real = await fs.realpath(file);
      if (!inside(directory, real) || digest(await fs.readFile(real)) !== digest(bytes)) throw new Error('Stored Project content does not match its reference');
    }
  } finally { await fs.rm(temporary, { force: true }); }
  return file;
}

async function storeImages(projectPath, images = []) {
  const decoded = decodeImages(images);
  return Promise.all(images.map(async (image, index) => {
    const { bytes, mime } = decoded[index];
    const extension = mime === 'image/jpeg' ? 'jpg' : mime.slice('image/'.length);
    const stored = await writeContent(projectPath, 'images', bytes, extension);
    const { dataUrl, path: original, ...rest } = image;
    return { ...rest, path: stored, ...(original ? { sourcePath: original } : {}) };
  }));
}

/** Existing inline attachments migrate only after their bytes have been written successfully. */
async function migrateImages(projectPath, state) {
  let changed = false;
  const messages = [];
  for (const message of state.messages ?? []) {
    if (!message.images?.some(image => typeof image.dataUrl === 'string')) { messages.push(message); continue; }
    const images = [];
    for (const image of message.images) {
      if (typeof image.dataUrl !== 'string') { images.push(image); continue; }
      try { images.push((await storeImages(projectPath, [image]))[0]); changed = true; }
      catch { images.push(image); } // Old unsupported data remains readable; never discard it during migration.
    }
    messages.push({ ...message, images });
  }
  return changed ? { ...state, messages } : state;
}

/** Keep complete transcripts in sidecars; coordination.json holds the latest short entry. */
async function compactSubagents(projectPath, state) {
  if (!state.sessions) return state;
  const sessions = {};
  for (const [id, session] of Object.entries(state.sessions)) {
    if (!session.subagents?.length) { sessions[id] = session; continue; }
    const subagents = [];
    for (const agent of session.subagents) {
      if (!agent.transcript?.length) { subagents.push(agent); continue; }
      const file = await writeContent(projectPath, 'subagents', JSON.stringify(agent.transcript), 'json');
      const last = agent.transcript.at(-1);
      const refs = [...new Set([...(agent.transcriptFiles ?? []), agent.transcriptFile].filter(ref => ref && ref !== path.basename(file)))];
      subagents.push({ ...agent, transcriptFile: path.basename(file), ...(refs.length ? { transcriptFiles: refs } : {}), transcript: [{ ...last, text: last.text.slice(-1000), compact: true }] });
    }
    sessions[id] = { ...session, subagents };
  }
  return { ...state, sessions };
}

async function hydrateSubagents(projectPath, state) {
  const validName = name => typeof name === 'string' && /^[a-f0-9]{64}\.json$/.test(name);
  for (const session of Object.values(state.sessions ?? {})) {
    for (const agent of session.subagents ?? []) {
      const refs = [...new Set([...(agent.transcriptFiles ?? []), agent.transcriptFile].filter(validName))];
      if (!refs.length) continue;
      const entries = new Map();
      const missing = [];
      const merge = rows => {
        for (const row of rows) if (!row.compact || !entries.has(row.id)) entries.set(row.id, row);
      };
      for (const ref of refs) {
        try {
          const directory = await contentDirectory(projectPath, 'subagents');
          const file = await fs.realpath(path.join(directory, ref));
          if (!inside(directory, file)) throw new Error('Invalid transcript path');
          const bytes = await fs.readFile(file);
          if (digest(bytes) + '.json' !== ref) throw new Error('Invalid transcript hash');
          const transcript = JSON.parse(bytes);
          if (!Array.isArray(transcript) || !transcript.every(row => typeof row.id === 'string' && typeof row.text === 'string' && ['message','tool'].includes(row.kind))) throw new Error('Invalid transcript');
          merge(transcript);
        } catch { missing.push(ref); }
      }
      // Compact summaries never replace a recovered complete entry with the same id.
      merge(agent.transcript ?? []);
      agent.transcript = [...entries.values()];
      delete agent.transcriptFile;
      if (missing.length) agent.transcriptFiles = missing;
      else delete agent.transcriptFiles;
    }
  }
  return state;
}
module.exports = { storeImages, migrateImages, compactSubagents, hydrateSubagents };
