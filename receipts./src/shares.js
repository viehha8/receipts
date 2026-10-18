// Saved, shareable results ("/r/<id>" links).
// Default: JSON files in data/shares (fine on your laptop; wiped on Render's free plan when it sleeps).
// Set MONGODB_URI in .env to keep links permanently in a free MongoDB Atlas database.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const TTL_MS = () => Number(process.env.SHARE_DAYS || 30) * 86_400_000;
const DIR = () => path.join(process.env.DATA_DIR || path.join(process.cwd(), 'data'), 'shares');
const ID_RE = /^[A-Za-z0-9_-]{8,24}$/;

let colPromise = null;
function collection() {
  if (!process.env.MONGODB_URI) return Promise.resolve(null);
  if (!colPromise) {
    colPromise = (async () => {
      const { MongoClient } = await import('mongodb');
      const client = new MongoClient(process.env.MONGODB_URI);
      await client.connect();
      const col = client.db(process.env.MONGODB_DB || 'receipts').collection('shares');
      // MongoDB deletes expired shares by itself.
      await col.createIndex({ createdAt: 1 }, { expireAfterSeconds: Math.round(TTL_MS() / 1000) });
      return col;
    })().catch((e) => {
      colPromise = null;
      throw new Error(`Could not connect to MongoDB: ${e.message}`);
    });
  }
  return colPromise;
}

export const storageKind = () => (process.env.MONGODB_URI ? 'mongodb' : 'file');

const filePath = (id) => path.join(DIR(), `${id}.json`);
const expiresAt = (createdAt) => new Date(new Date(createdAt).getTime() + TTL_MS());

/** Saves a share. Returns { id, deleteKey, expiresAt }. */
export async function saveShare(doc) {
  const id = crypto.randomBytes(9).toString('base64url');
  const deleteKey = crypto.randomBytes(12).toString('hex');
  const rec = { ...doc, _id: id, deleteHash: hash(deleteKey), createdAt: new Date() };
  const col = await collection();
  if (col) await col.insertOne(rec);
  else {
    fs.mkdirSync(DIR(), { recursive: true });
    fs.writeFileSync(filePath(id), JSON.stringify(rec));
  }
  return { id, deleteKey, expiresAt: expiresAt(rec.createdAt) };
}

export async function loadShare(id) {
  if (!ID_RE.test(String(id))) return null;
  const col = await collection();
  let rec = null;
  if (col) rec = await col.findOne({ _id: id });
  else {
    try {
      rec = JSON.parse(fs.readFileSync(filePath(id), 'utf8'));
    } catch {
      return null;
    }
  }
  if (!rec) return null;
  if (Date.now() > expiresAt(rec.createdAt).getTime()) {
    await deleteShare(id, null, true);
    return null;
  }
  const { deleteHash, _id, ...rest } = rec;
  return { ...rest, id: _id, expiresAt: expiresAt(rec.createdAt) };
}

export async function deleteShare(id, deleteKey, force = false) {
  if (!ID_RE.test(String(id))) return false;
  const col = await collection();
  if (!force) {
    const rec = col ? await col.findOne({ _id: id }) : safeRead(id);
    if (!rec || !deleteKey || rec.deleteHash !== hash(deleteKey)) return false;
  }
  if (col) await col.deleteOne({ _id: id });
  else fs.rmSync(filePath(id), { force: true });
  return true;
}

function safeRead(id) {
  try {
    return JSON.parse(fs.readFileSync(filePath(id), 'utf8'));
  } catch {
    return null;
  }
}

function hash(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}