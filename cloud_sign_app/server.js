const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── データファイルパス ───
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const DOCUMENTS_FILE = path.join(DATA_DIR, 'documents.json');
const LOG_FILE = path.join(DATA_DIR, 'sign_log.json');

// ─── ディレクトリ初期化 ───
[DATA_DIR, UPLOADS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ─── データの読み書き ───
function readJSON(filepath, fallback = []) {
  try {
    if (fs.existsSync(filepath)) {
      return JSON.parse(fs.readFileSync(filepath, 'utf-8'));
    }
  } catch (e) {
    console.error(`Error reading ${filepath}:`, e.message);
  }
  return fallback;
}

function writeJSON(filepath, data) {
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf-8');
}

function getDocuments() { return readJSON(DOCUMENTS_FILE, []); }
function saveDocuments(docs) { writeJSON(DOCUMENTS_FILE, docs); }
function getLogs() { return readJSON(LOG_FILE, []); }
function saveLogs(logs) { writeJSON(LOG_FILE, logs); }

// ─── SHA256ハッシュ計算 ───
function computeHash(filepath) {
  const content = fs.readFileSync(filepath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

// ─── ログ追記 ───
function appendLog(action, docId, docName, signer) {
  const logs = getLogs();
  logs.push({
    id: crypto.randomUUID(),
    action,
    docId,
    docName,
    signer,
    timestamp: new Date().toISOString()
  });
  saveLogs(logs);
}

// ─── ミドルウェア ───
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── ファイルアップロード設定 ───
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}_${Buffer.from(file.originalname, 'latin1').toString('utf-8')}`;
    cb(null, uniqueName);
  }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// ================================================================
// API: ドキュメント一覧取得
// ================================================================
app.get('/api/documents', (req, res) => {
  const docs = getDocuments();
  res.json(docs);
});

// ================================================================
// API: ドキュメントアップロード
// ================================================================
app.post('/api/documents/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'ファイルが選択されていません' });
  }

  const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf-8');
  const filePath = req.file.path;
  const hash = computeHash(filePath);

  const doc = {
    id: crypto.randomUUID(),
    name: originalName,
    filename: req.file.filename,
    filepath: filePath,
    size: req.file.size,
    mimeType: req.file.mimetype,
    uploadedAt: new Date().toISOString(),
    currentHash: hash,
    signatures: [],
    approval: {
      status: 'unsigned',
      approvedAt: null,
      approvedBy: null
    }
  };

  const docs = getDocuments();
  docs.push(doc);
  saveDocuments(docs);

  appendLog('UPLOAD', doc.id, doc.name, '');

  res.json({ success: true, document: doc });
});

// ================================================================
// API: ドキュメント詳細取得
// ================================================================
app.get('/api/documents/:id', (req, res) => {
  const docs = getDocuments();
  const doc = docs.find(d => d.id === req.params.id);
  if (!doc) return res.status(404).json({ error: 'ドキュメントが見つかりません' });
  res.json(doc);
});

// ================================================================
// API: ドキュメント削除
// ================================================================
app.delete('/api/documents/:id', (req, res) => {
  let docs = getDocuments();
  const idx = docs.findIndex(d => d.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'ドキュメントが見つかりません' });

  const doc = docs[idx];
  // ファイルも削除
  if (fs.existsSync(doc.filepath)) {
    fs.unlinkSync(doc.filepath);
  }
  docs.splice(idx, 1);
  saveDocuments(docs);
  appendLog('DELETE', doc.id, doc.name, '');
  res.json({ success: true });
});

// ================================================================
// API: 署名
// ================================================================
app.post('/api/documents/:id/sign', (req, res) => {
  const { signer } = req.body;
  if (!signer) return res.status(400).json({ error: '署名者名を入力してください' });

  const docs = getDocuments();
  const doc = docs.find(d => d.id === req.params.id);
  if (!doc) return res.status(404).json({ error: 'ドキュメントが見つかりません' });

  // ファイルの現在のハッシュを計算
  if (!fs.existsSync(doc.filepath)) {
    return res.status(404).json({ error: 'ファイルが見つかりません' });
  }
  const currentHash = computeHash(doc.filepath);

  // 同じ署名者が既に署名していないかチェック
  const existingSig = doc.signatures.find(s => s.name === signer && s.status === 'active');
  if (existingSig) {
    return res.status(400).json({ error: `${signer} さんは既に署名済みです` });
  }

  const signature = {
    id: crypto.randomUUID(),
    name: signer,
    signedAt: new Date().toISOString(),
    sha256: currentHash,
    status: 'active'
  };

  doc.signatures.push(signature);
  doc.currentHash = currentHash;
  if (doc.approval.status === 'unsigned') {
    doc.approval.status = 'pending';
  }

  saveDocuments(docs);
  appendLog('SIGN', doc.id, doc.name, signer);

  res.json({ success: true, signature, document: doc });
});

// ================================================================
// API: 検証
// ================================================================
app.get('/api/documents/:id/verify', (req, res) => {
  const docs = getDocuments();
  const doc = docs.find(d => d.id === req.params.id);
  if (!doc) return res.status(404).json({ error: 'ドキュメントが見つかりません' });

  if (!fs.existsSync(doc.filepath)) {
    return res.status(404).json({ error: 'ファイルが見つかりません' });
  }

  const currentHash = computeHash(doc.filepath);
  const isValid = currentHash === doc.currentHash;

  res.json({
    valid: isValid,
    currentHash,
    recordedHash: doc.currentHash,
    signatures: doc.signatures.filter(s => s.status === 'active'),
    message: isValid
      ? '署名は有効です - ドキュメントは変更されていません'
      : '署名は無効です - ドキュメントが変更されています'
  });
});

// ================================================================
// API: 承認
// ================================================================
app.post('/api/documents/:id/approve', (req, res) => {
  const { signer } = req.body;
  if (!signer) return res.status(400).json({ error: '承認者名を入力してください' });

  const docs = getDocuments();
  const doc = docs.find(d => d.id === req.params.id);
  if (!doc) return res.status(404).json({ error: 'ドキュメントが見つかりません' });

  if (doc.signatures.length === 0) {
    return res.status(400).json({ error: '署名がありません。先に署名してください' });
  }

  // ファイル整合性チェック
  if (fs.existsSync(doc.filepath)) {
    const currentHash = computeHash(doc.filepath);
    if (currentHash !== doc.currentHash) {
      return res.status(400).json({ error: 'ドキュメントが署名後に変更されています。再署名してください' });
    }
  }

  doc.approval.status = 'approved';
  doc.approval.approvedAt = new Date().toISOString();
  doc.approval.approvedBy = signer;

  saveDocuments(docs);
  appendLog('APPROVE', doc.id, doc.name, signer);

  res.json({ success: true, document: doc });
});

// ================================================================
// API: 署名取り消し
// ================================================================
app.post('/api/documents/:id/revoke', (req, res) => {
  const { signer } = req.body;

  const docs = getDocuments();
  const doc = docs.find(d => d.id === req.params.id);
  if (!doc) return res.status(404).json({ error: 'ドキュメントが見つかりません' });

  // 指定された署名者の署名を取り消し
  const sig = doc.signatures.find(s => s.name === signer && s.status === 'active');
  if (!sig) {
    return res.status(400).json({ error: `${signer} さんの有効な署名が見つかりません` });
  }

  sig.status = 'revoked';
  doc.approval.status = 'revoked';

  saveDocuments(docs);
  appendLog('REVOKE', doc.id, doc.name, signer);

  res.json({ success: true, document: doc });
});

// ================================================================
// API: ログ取得
// ================================================================
app.get('/api/logs', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const logs = getLogs();
  res.json(logs.slice(-limit).reverse());
});

// ─── サーバー起動 ───
app.listen(PORT, () => {
  console.log(`\n  Cloud Sign Web App v1.0.0`);
  console.log(`  ─────────────────────────`);
  console.log(`  http://localhost:${PORT}\n`);
});
