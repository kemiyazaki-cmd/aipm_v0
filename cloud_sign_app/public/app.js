// ─── 状態管理 ───
let documents = [];
let currentDocId = null;
let modalAction = null; // 'sign' | 'approve' | 'revoke'

// ─── DOM要素 ───
const docList = document.getElementById('docList');
const emptyMessage = document.getElementById('emptyMessage');
const uploadArea = document.getElementById('uploadArea');
const fileInput = document.getElementById('fileInput');
const signModal = document.getElementById('signModal');
const detailModal = document.getElementById('detailModal');
const signerNameInput = document.getElementById('signerName');
const toastContainer = document.getElementById('toastContainer');

// ================================================================
// 初期化
// ================================================================
document.addEventListener('DOMContentLoaded', () => {
  loadDocuments();
  setupEventListeners();
});

function setupEventListeners() {
  // タブ切り替え
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
      if (btn.dataset.tab === 'logs') loadLogs();
    });
  });

  // アップロード
  uploadArea.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', handleFileSelect);
  uploadArea.addEventListener('dragover', e => { e.preventDefault(); uploadArea.classList.add('dragover'); });
  uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragover'));
  uploadArea.addEventListener('drop', e => { e.preventDefault(); uploadArea.classList.remove('dragover'); handleFileDrop(e); });

  // モーダル
  document.getElementById('modalClose').addEventListener('click', closeSignModal);
  document.getElementById('modalCancel').addEventListener('click', closeSignModal);
  document.getElementById('modalConfirm').addEventListener('click', handleModalConfirm);
  document.getElementById('detailModalClose').addEventListener('click', closeDetailModal);
  document.getElementById('detailModalCancel').addEventListener('click', closeDetailModal);

  // モーダル外クリックで閉じる
  signModal.addEventListener('click', e => { if (e.target === signModal) closeSignModal(); });
  detailModal.addEventListener('click', e => { if (e.target === detailModal) closeDetailModal(); });
}

// ================================================================
// API通信
// ================================================================
async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'エラーが発生しました');
  return data;
}

// ================================================================
// ドキュメント操作
// ================================================================
async function loadDocuments() {
  try {
    documents = await api('/api/documents');
    renderDocuments();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

function renderDocuments() {
  if (documents.length === 0) {
    docList.innerHTML = '<p class="empty-message">ドキュメントがありません。ファイルをアップロードしてください。</p>';
    return;
  }

  docList.innerHTML = documents.map(doc => {
    const statusBadge = getStatusBadge(doc.approval.status);
    const sigChips = doc.signatures.map(s =>
      `<span class="sig-chip ${s.status === 'revoked' ? 'revoked' : ''}">${s.name}</span>`
    ).join('');

    const uploadDate = new Date(doc.uploadedAt).toLocaleString('ja-JP');
    const fileSize = formatSize(doc.size);

    return `
      <div class="doc-card" data-id="${doc.id}">
        <div class="doc-card-header">
          <span class="doc-name">${escapeHtml(doc.name)}</span>
          ${statusBadge}
        </div>
        <div class="doc-meta">
          <span>&#128197; ${uploadDate}</span>
          <span>&#128190; ${fileSize}</span>
          ${doc.signatures.filter(s => s.status === 'active').length > 0
            ? `<span>&#9998; ${doc.signatures.filter(s => s.status === 'active').length}名が署名</span>` : ''}
        </div>
        ${sigChips ? `<div class="sig-list">${sigChips}</div>` : ''}
        <div class="doc-actions">
          <button class="btn btn-sign" onclick="openSignModal('${doc.id}', 'sign')">署名</button>
          <button class="btn btn-verify" onclick="verifyDoc('${doc.id}')">検証</button>
          <button class="btn btn-approve" onclick="openSignModal('${doc.id}', 'approve')"
            ${doc.signatures.length === 0 ? 'disabled' : ''}>承認</button>
          <button class="btn btn-detail" onclick="showDetail('${doc.id}')">詳細</button>
          <button class="btn btn-delete" onclick="deleteDoc('${doc.id}')">削除</button>
        </div>
      </div>
    `;
  }).join('');
}

function getStatusBadge(status) {
  const map = {
    unsigned: ['未署名', 'unsigned'],
    pending: ['署名済', 'pending'],
    approved: ['承認済', 'approved'],
    revoked: ['取消済', 'revoked']
  };
  const [label, cls] = map[status] || [status, 'unsigned'];
  return `<span class="badge badge-${cls}">${label}</span>`;
}

// ─── ファイルアップロード ───
function handleFileSelect(e) {
  if (e.target.files.length > 0) uploadFile(e.target.files[0]);
}

function handleFileDrop(e) {
  if (e.dataTransfer.files.length > 0) uploadFile(e.dataTransfer.files[0]);
}

async function uploadFile(file) {
  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch('/api/documents/upload', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    showToast(`「${data.document.name}」をアップロードしました`, 'success');
    fileInput.value = '';
    await loadDocuments();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

// ─── 削除 ───
async function deleteDoc(id) {
  const doc = documents.find(d => d.id === id);
  if (!doc) return;
  if (!confirm(`「${doc.name}」を削除しますか？`)) return;

  try {
    await api(`/api/documents/${id}`, { method: 'DELETE' });
    showToast('ドキュメントを削除しました', 'info');
    await loadDocuments();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

// ─── 検証 ───
async function verifyDoc(id) {
  const doc = documents.find(d => d.id === id);
  if (!doc) return;

  try {
    const result = await api(`/api/documents/${id}/verify`);
    const card = document.querySelector(`.doc-card[data-id="${id}"]`);
    // 既存の検証結果を削除
    const existing = card.querySelector('.verify-result');
    if (existing) existing.remove();

    const div = document.createElement('div');
    div.className = `verify-result ${result.valid ? 'verify-valid' : 'verify-invalid'}`;
    div.textContent = result.valid
      ? '[ VALID ] 署名は有効です - ドキュメントは変更されていません'
      : '[ INVALID ] 署名は無効です - ドキュメントが変更されています';
    card.appendChild(div);

    // 3秒後に自動で消す
    setTimeout(() => div.remove(), 5000);
  } catch (e) {
    showToast(e.message, 'error');
  }
}

// ================================================================
// 署名/承認モーダル
// ================================================================
function openSignModal(docId, action) {
  currentDocId = docId;
  modalAction = action;
  const doc = documents.find(d => d.id === docId);
  if (!doc) return;

  const titles = { sign: 'ドキュメントに署名', approve: 'ドキュメントを承認', revoke: '署名を取り消し' };
  const labels = { sign: '署名者名', approve: '承認者名', revoke: '取消者名' };
  const btns = { sign: '署名する', approve: '承認する', revoke: '取り消す' };

  document.getElementById('modalTitle').textContent = titles[action];
  document.querySelector('.form-group label').textContent = labels[action];
  document.getElementById('modalConfirm').textContent = btns[action];
  document.getElementById('modalDocInfo').innerHTML = `<strong>${escapeHtml(doc.name)}</strong>`;

  signerNameInput.value = '';
  signModal.classList.add('open');
  setTimeout(() => signerNameInput.focus(), 100);
}

function closeSignModal() {
  signModal.classList.remove('open');
  currentDocId = null;
  modalAction = null;
}

async function handleModalConfirm() {
  const signer = signerNameInput.value.trim();
  if (!signer) {
    showToast('名前を入力してください', 'error');
    return;
  }

  const endpoints = {
    sign: `/api/documents/${currentDocId}/sign`,
    approve: `/api/documents/${currentDocId}/approve`,
    revoke: `/api/documents/${currentDocId}/revoke`
  };
  const messages = {
    sign: '署名しました',
    approve: '承認しました',
    revoke: '署名を取り消しました'
  };

  try {
    await api(endpoints[modalAction], {
      method: 'POST',
      body: JSON.stringify({ signer })
    });
    showToast(messages[modalAction], 'success');
    closeSignModal();
    await loadDocuments();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

// ================================================================
// 詳細モーダル
// ================================================================
async function showDetail(id) {
  try {
    const doc = await api(`/api/documents/${id}`);
    const verification = await api(`/api/documents/${id}/verify`);

    const body = document.getElementById('detailModalBody');
    body.innerHTML = `
      <div class="detail-section">
        <h3>ドキュメント情報</h3>
        <div class="detail-row"><span class="label">ファイル名</span><span class="value">${escapeHtml(doc.name)}</span></div>
        <div class="detail-row"><span class="label">サイズ</span><span class="value">${formatSize(doc.size)}</span></div>
        <div class="detail-row"><span class="label">アップロード日時</span><span class="value">${new Date(doc.uploadedAt).toLocaleString('ja-JP')}</span></div>
        <div class="detail-row"><span class="label">SHA256</span></div>
        <div class="hash-value">${doc.currentHash}</div>
      </div>

      <div class="detail-section">
        <h3>整合性チェック</h3>
        <div class="verify-result ${verification.valid ? 'verify-valid' : 'verify-invalid'}">
          ${verification.valid ? '[ VALID ] 変更なし' : '[ INVALID ] 署名後に変更あり'}
        </div>
      </div>

      <div class="detail-section">
        <h3>承認ステータス</h3>
        <div class="detail-row">
          <span class="label">ステータス</span>
          <span class="value">${getStatusBadge(doc.approval.status)}</span>
        </div>
        ${doc.approval.approvedBy ? `
          <div class="detail-row"><span class="label">承認者</span><span class="value">${escapeHtml(doc.approval.approvedBy)}</span></div>
          <div class="detail-row"><span class="label">承認日時</span><span class="value">${new Date(doc.approval.approvedAt).toLocaleString('ja-JP')}</span></div>
        ` : ''}
      </div>

      <div class="detail-section">
        <h3>署名一覧 (${doc.signatures.length}件)</h3>
        ${doc.signatures.length === 0 ? '<p style="color:#999;font-size:14px;">まだ署名されていません</p>' :
          doc.signatures.map(s => `
            <div class="detail-row">
              <span class="label">
                <span class="sig-chip ${s.status === 'revoked' ? 'revoked' : ''}">${escapeHtml(s.name)}</span>
              </span>
              <span class="value" style="font-size:13px;">${new Date(s.signedAt).toLocaleString('ja-JP')}</span>
            </div>
          `).join('')
        }
      </div>

      ${doc.signatures.filter(s => s.status === 'active').length > 0 ? `
        <div style="margin-top:8px;">
          <button class="btn btn-revoke" onclick="openRevokeFromDetail('${doc.id}')">署名を取り消す</button>
        </div>
      ` : ''}
    `;

    detailModal.classList.add('open');
  } catch (e) {
    showToast(e.message, 'error');
  }
}

function openRevokeFromDetail(docId) {
  closeDetailModal();
  openSignModal(docId, 'revoke');
}

function closeDetailModal() {
  detailModal.classList.remove('open');
}

// ================================================================
// ログ
// ================================================================
async function loadLogs() {
  try {
    const logs = await api('/api/logs?limit=50');
    const logList = document.getElementById('logList');

    if (logs.length === 0) {
      logList.innerHTML = '<p class="empty-message">ログはまだありません</p>';
      return;
    }

    const actionLabels = {
      SIGN: ['署名', 'sign'],
      APPROVE: ['承認', 'approve'],
      REVOKE: ['取消', 'revoke'],
      UPLOAD: ['登録', 'upload'],
      DELETE: ['削除', 'delete']
    };

    logList.innerHTML = logs.map(log => {
      const [label, cls] = actionLabels[log.action] || [log.action, ''];
      const time = new Date(log.timestamp).toLocaleString('ja-JP');
      return `
        <div class="log-item">
          <span class="log-action ${cls}">${label}</span>
          <span class="log-signer">${escapeHtml(log.signer || '-')}</span>
          <span class="log-doc">${escapeHtml(log.docName)}</span>
          <span class="log-time">${time}</span>
        </div>
      `;
    }).join('');
  } catch (e) {
    showToast(e.message, 'error');
  }
}

// ================================================================
// ユーティリティ
// ================================================================
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
