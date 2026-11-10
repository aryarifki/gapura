// ==============================================================================
// Homeless Media Engine (HME) v2.0 - Dashboard Client Application
// File: /root/gapura/services/web/public/app.js
// ==============================================================================

let currentDrafts = [];
let currentFilter = 'all';
let editingDraftId = null;

// Utility: Show Toast
function showToast(message, duration = 3000) {
  const toast = document.getElementById('toast');
  toast.innerText = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), duration);
}

// 1. Fetch & Update Dashboard Stats
async function loadStats() {
  try {
    const res = await fetch('/api/stats');
    const data = await res.json();

    document.getElementById('metric-raw').innerText = data.raw_items.toLocaleString();
    document.getElementById('metric-topics').innerText = data.topics.toLocaleString();
    document.getElementById('metric-passed').innerText = data.scores.passed || 0;
    document.getElementById('metric-fastfail').innerText = (data.scores.fast_failed || 0) + (data.scores.rejected || 0);

    const pendingDrafts = data.drafts.draft || 0;
    document.getElementById('metric-drafts-pending').innerText = pendingDrafts;
    document.getElementById('metric-scheduled').innerText = data.scheduled_posts || 0;

    document.getElementById('tab-draft-count').innerText = pendingDrafts;
    document.getElementById('tab-topic-count').innerText = data.topics.toLocaleString();

    // Service Health Indicators
    const elRender = document.getElementById('status-render');
    const elN8n = document.getElementById('status-n8n');

    if (data.services.render) {
      elRender.className = 'status-pill status-ok';
      elRender.innerText = '● Render Service OK';
    } else {
      elRender.className = 'status-pill status-err';
      elRender.innerText = '● Render Service OFF';
    }

    if (data.services.n8n) {
      elN8n.className = 'status-pill status-ok';
      elN8n.innerText = '● n8n Engine OK';
    } else {
      elN8n.className = 'status-pill status-err';
      elN8n.innerText = '● n8n Engine OFF';
    }
  } catch (err) {
    console.error('Error loading stats:', err);
  }
}

// 2. Fetch & Render Drafts
async function loadDrafts() {
  try {
    const res = await fetch('/api/drafts');
    currentDrafts = await res.json();
    renderDraftsList();
  } catch (err) {
    console.error('Error loading drafts:', err);
  }
}

function renderDraftsList() {
  const container = document.getElementById('drafts-container');
  container.innerHTML = '';

  const filtered = currentDrafts.filter((d) => {
    if (currentFilter === 'all') return true;
    return d.status === currentFilter;
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 48px; background: #fff; border: 1px dashed var(--border); border-radius: 8px;">
        <p style="color: var(--muted); font-size: 15px;">Tidak ada draf dengan filter "${currentFilter}".</p>
      </div>
    `;
    return;
  }

  filtered.forEach((d) => {
    const card = document.createElement('div');
    card.className = 'draft-card';
    card.id = `draft-card-${d.id}`;

    const slides = d.rendered_slides || [];
    const mainImgSrc = slides[0] ? `${slides[0].image_url}?t=${Date.now()}` : '';

    // Thumbnails HTML
    let thumbsHtml = '';
    slides.forEach((s, idx) => {
      thumbsHtml += `
        <button class="thumb-btn ${idx === 0 ? 'active' : ''}" onclick="selectSlide(${d.id}, ${s.slide_no}, '${s.image_url}')">
          <img src="${s.image_url}" alt="Slide ${s.slide_no}" loading="lazy">
        </button>
      `;
    });

    const statusBadgeClass =
      d.status === 'draft'
        ? 'badge-status-draft'
        : d.status === 'scheduled' || d.status === 'approved'
        ? 'badge-status-scheduled'
        : 'badge-status-rejected';

    const statusLabel =
      d.status === 'draft'
        ? 'MENUNGGU REVIEW'
        : d.status === 'scheduled'
        ? 'TERJADWAL AUTO'
        : d.status === 'approved'
        ? 'DISETUJUI MANUAL'
        : 'DITOLAK';

    card.innerHTML = `
      <div class="draft-visual-panel">
        <div class="slide-viewer-box">
          <img id="main-slide-${d.id}" class="slide-img-main" src="${mainImgSrc}" alt="Slide View">
        </div>
        <div class="slide-thumb-strip" id="thumbs-${d.id}">
          ${thumbsHtml}
        </div>
      </div>

      <div class="draft-detail-panel">
        <div>
          <div class="draft-meta-top">
            <div class="draft-badges">
              <span class="badge badge-source">${d.primary_source}</span>
              <span class="badge badge-score">SKOR ${d.score_total || 80}/100</span>
              <span class="badge ${statusBadgeClass}">${statusLabel}</span>
            </div>
            <span class="draft-id-tag">ID #${d.id}</span>
          </div>

          <h3 class="draft-title">${d.topic_title}</h3>

          <div class="caption-label-row">
            <label style="font-size: 11px; font-weight: 700; color: var(--muted); text-transform: uppercase;">Caption Editorial:</label>
            <button class="btn btn-sm btn-secondary" onclick="copyCaption(${d.id})">📋 Salin Caption</button>
          </div>
          <div class="caption-box" id="caption-text-${d.id}">${escapeHtml(d.caption)}</div>

          <div class="hashtags-row">
            ${(d.hashtags || []).map((t) => `<span class="hashtag-tag">${t}</span>`).join('')}
          </div>
        </div>

        <div class="draft-actions-bar">
          <div class="actions-left">
            ${
              d.status === 'draft'
                ? `
              <button class="btn btn-success" onclick="approveDraft(${d.id}, 'auto')">✅ Setujui (Auto)</button>
              <button class="btn btn-secondary" onclick="approveDraft(${d.id}, 'manual')">📲 Setujui (Manual)</button>
              <button class="btn btn-secondary" onclick="openEditModal(${d.id})">✏️ Edit Slide</button>
              <button class="btn btn-secondary" onclick="window.open('${mainImgSrc}', '_blank')">🔍 Buka Slide Penuh</button>
            `
                : `
              <span style="font-size: 12.5px; font-weight: 600; color: var(--navy); display: inline-flex; align-items: center; gap: 6px;">
                Status: <span class="badge ${statusBadgeClass}">${statusLabel}</span>
              </span>
              <button class="btn btn-sm btn-secondary" onclick="window.open('${mainImgSrc}', '_blank')">🔍 Buka Slide Penuh</button>
            `
            }
          </div>
          <div class="actions-right">
            ${
              d.status === 'draft'
                ? `<button class="btn btn-danger" onclick="rejectDraft(${d.id})">❌ Tolak</button>`
                : ''
            }
          </div>
        </div>
      </div>
    `;

    container.appendChild(card);
  });
}

function selectSlide(draftId, slideNo, imgUrl) {
  const mainImg = document.getElementById(`main-slide-${draftId}`);
  if (mainImg) {
    mainImg.src = `${imgUrl}?t=${Date.now()}`;
  }
  const strip = document.getElementById(`thumbs-${draftId}`);
  if (strip) {
    const btns = strip.getElementsByClassName('thumb-btn');
    for (let i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('active', i === slideNo - 1);
    }
  }
}

function copyCaption(draftId) {
  const captionEl = document.getElementById(`caption-text-${draftId}`);
  if (captionEl) {
    navigator.clipboard.writeText(captionEl.innerText);
    showToast('Caption berhasil disalin ke clipboard!');
  }
}

async function approveDraft(draftId, mode) {
  try {
    const res = await fetch(`/api/drafts/${draftId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    });
    if (res.ok) {
      showToast(`Draf #${draftId} disetujui (${mode === 'auto' ? 'Auto-Publish Terjadwal' : 'Manual'})!`);
      loadDrafts();
      loadStats();
    }
  } catch (err) {
    showToast(`Gagal: ${err.message}`);
  }
}

async function rejectDraft(draftId) {
  const reason = prompt('Masukkan alasan penolakan draf (untuk kalibrasi skor Analis):', 'Kurang relevan dengan target pasar saat ini');
  if (reason === null) return;

  try {
    const res = await fetch(`/api/drafts/${draftId}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    if (res.ok) {
      showToast(`Draf #${draftId} ditolak.`);
      loadDrafts();
      loadStats();
    }
  } catch (err) {
    showToast(`Gagal: ${err.message}`);
  }
}

// 3. Edit Slide Modal
function openEditModal(draftId) {
  editingDraftId = draftId;
  const draft = currentDrafts.find((d) => d.id === draftId);
  if (!draft) return;

  const select = document.getElementById('edit-slide-no');
  select.value = '1';
  updateModalTextarea();

  select.onchange = updateModalTextarea;
  document.getElementById('edit-modal').classList.add('active');
}

function updateModalTextarea() {
  if (!editingDraftId) return;
  const draft = currentDrafts.find((d) => d.id === editingDraftId);
  const slideNo = parseInt(document.getElementById('edit-slide-no').value);
  const slide = draft.rendered_slides.find((s) => s.slide_no === slideNo);
  document.getElementById('edit-slide-text').value = slide ? slide.text : '';
}

document.getElementById('modal-close').onclick = () => document.getElementById('edit-modal').classList.remove('active');
document.getElementById('modal-cancel').onclick = () => document.getElementById('edit-modal').classList.remove('active');

document.getElementById('btn-submit-edit').onclick = async () => {
  if (!editingDraftId) return;
  const slideNo = parseInt(document.getElementById('edit-slide-no').value);
  const newText = document.getElementById('edit-slide-text').value;

  try {
    const res = await fetch(`/api/drafts/${editingDraftId}/edit-slide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slide_no: slideNo, new_text: newText }),
    });

    if (res.ok) {
      const data = await res.json();
      showToast(`Slide #${slideNo} berhasil dirender ulang!`);
      document.getElementById('edit-modal').classList.remove('active');
      loadDrafts();
    }
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
};

// 4. Fetch & Render Topics Table
let currentTopicStatus = '';
async function loadTopics() {
  try {
    const url = currentTopicStatus ? `/api/topics?status=${currentTopicStatus}&limit=60` : '/api/topics?limit=60';
    const res = await fetch(url);
    const topics = await res.json();

    const tbody = document.getElementById('topics-table-body');
    tbody.innerHTML = '';

    topics.forEach((t) => {
      const tr = document.createElement('tr');
      const score = t.score_total || 0;
      const scoreClass = score >= 75 ? 'score-high' : score >= 60 ? 'score-mid' : 'score-fail';

      tr.innerHTML = `
        <td style="font-family: 'JetBrains Mono'; font-weight: 600;">#${t.id}</td>
        <td><span class="badge badge-source">${escapeHtml(t.primary_source)}</span></td>
        <td class="topic-title-cell">
          <strong>${escapeHtml(t.title)}</strong>
          <div class="topic-summary">${escapeHtml(t.summary || '')}</div>
        </td>
        <td>
          <span class="score-badge-circle ${scoreClass}">${score}</span>
        </td>
        <td>
          <span class="badge ${t.status === 'scored' ? 'badge-status-scheduled' : t.status === 'produced' ? 'badge-score' : 'badge-status-rejected'}">
            ${t.status.toUpperCase()}
          </span>
        </td>
        <td>
          ${
            t.status === 'rejected'
              ? `<button class="btn btn-sm btn-secondary" onclick="promoteTopic(${t.id})">Promosikan</button>`
              : '<span style="color: var(--muted); font-size: 11px;">Tersaring</span>'
          }
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Error loading topics:', err);
  }
}

async function promoteTopic(topicId) {
  try {
    const res = await fetch(`/api/topics/${topicId}/promote`, { method: 'POST' });
    if (res.ok) {
      showToast(`Topik #${topicId} dipromosikan ke antrean Copywriter!`);
      loadTopics();
      loadStats();
    }
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}

// 5. Tokens Editor
async function loadTokens() {
  try {
    const res = await fetch('/api/tokens');
    const data = await res.json();
    document.getElementById('tokens-editor').value = data.raw;
  } catch (err) {
    console.error('Error loading tokens:', err);
  }
}

document.getElementById('btn-save-tokens').onclick = async () => {
  const content = document.getElementById('tokens-editor').value;
  try {
    const res = await fetch('/api/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ yaml_content: content }),
    });
    if (res.ok) {
      showToast('Tokens berhasil disimpan & Render Service di-reload!');
    } else {
      const err = await res.json();
      showToast(`Gagal: ${err.error}`);
    }
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
};

// 6. Audit Log
async function loadAuditLog() {
  try {
    const res = await fetch('/api/audit-log');
    const logs = await res.json();
    const tbody = document.getElementById('audit-table-body');
    tbody.innerHTML = '';

    logs.forEach((l) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-family: 'JetBrains Mono';">${l.id}</td>
        <td><b>${l.entity}</b></td>
        <td>#${l.entity_id}</td>
        <td><span class="badge badge-source">${l.action}</span></td>
        <td>${l.actor}</td>
        <td style="font-size: 11px; font-family: 'JetBrains Mono'; color: var(--muted);">${JSON.stringify(l.payload)}</td>
        <td style="font-size: 12px; color: var(--muted);">${new Date(l.created_at).toLocaleString('id-ID')}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Error loading audit log:', err);
  }
}

// 7. Workflow Engine Integration
let currentWorkflowActive = false;

async function loadWorkflow() {
  try {
    const res = await fetch('/api/workflow');
    const data = await res.json();

    const viewer = document.getElementById('workflow-json-viewer');
    if (viewer) {
      viewer.value = JSON.stringify(data.json || {}, null, 2);
    }

    currentWorkflowActive = !!data.active;
    const badge = document.getElementById('wf-status-badge');
    const toggleBtn = document.getElementById('btn-toggle-wf');

    if (badge) {
      if (currentWorkflowActive) {
        badge.className = 'badge badge-high';
        badge.textContent = '🟢 Aktif (Jadwal Berjalan)';
      } else {
        badge.className = 'badge badge-low';
        badge.textContent = '⏸️ Nonaktif (Manual)';
      }
    }

    if (toggleBtn) {
      toggleBtn.innerHTML = currentWorkflowActive
        ? '⏸️ Jeda Otomasi n8n'
        : '⚡ Aktifkan Otomasi n8n';
      toggleBtn.className = currentWorkflowActive ? 'btn btn-secondary' : 'btn btn-primary';
    }
  } catch (err) {
    console.error('Error loading workflow:', err);
  }
}

async function toggleWorkflow() {
  const toggleBtn = document.getElementById('btn-toggle-wf');
  if (toggleBtn) {
    toggleBtn.disabled = true;
    toggleBtn.textContent = 'Memproses...';
  }

  try {
    const res = await fetch('/api/workflow/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !currentWorkflowActive }),
    });
    const result = await res.json();
    if (result.status === 'success') {
      showToast(`Otomasi n8n berhasil ${result.active ? 'diaktifkan' : 'dijeda'}!`);
      await loadWorkflow();
    } else {
      showToast(`Gagal: ${result.error || 'Terjadi kesalahan'}`);
    }
  } catch (err) {
    showToast(`Error: ${err.message}`);
  } finally {
    if (toggleBtn) toggleBtn.disabled = false;
  }
}

const toggleWfBtn = document.getElementById('btn-toggle-wf');
if (toggleWfBtn) {
  toggleWfBtn.onclick = toggleWorkflow;
}

const copyWfJsonBtn = document.getElementById('btn-copy-workflow-json');
if (copyWfJsonBtn) {
  copyWfJsonBtn.onclick = () => {
    const viewer = document.getElementById('workflow-json-viewer');
    if (viewer && viewer.value) {
      navigator.clipboard.writeText(viewer.value);
      showToast('Definisi JSON Workflow berhasil disalin!');
    }
  };
}

// 7. Run Pipeline Trigger
document.getElementById('btn-run-pipeline').onclick = async () => {
  const btn = document.getElementById('btn-run-pipeline');
  btn.disabled = true;
  btn.innerHTML = '<span class="icon">⏳</span> Memproses Pipeline...';

  try {
    const res = await fetch('/api/pipeline/run', { method: 'POST' });
    const data = await res.json();
    showToast(data.message);

    // Refresh data after a few seconds
    setTimeout(() => {
      btn.disabled = false;
      btn.innerHTML = '<span class="icon">⚡</span> Jalankan Pipeline';
      loadStats();
      loadDrafts();
      loadTopics();
      loadAuditLog();
    }, 6000);
  } catch (err) {
    btn.disabled = false;
    btn.innerHTML = '<span class="icon">⚡</span> Jalankan Pipeline';
    showToast(`Error: ${err.message}`);
  }
};

// Filter Buttons Handler
document.querySelectorAll('.btn-filter').forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll('.btn-filter').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    renderDraftsList();
  };
});

document.querySelectorAll('.btn-topic-filter').forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll('.btn-topic-filter').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentTopicStatus = btn.dataset.status;
    loadTopics();
  };
});

// Tab Switcher
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach((p) => p.classList.remove('active'));

    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');

    if (btn.dataset.tab === 'tab-topics') loadTopics();
    if (btn.dataset.tab === 'tab-n8n') loadWorkflow();
    if (btn.dataset.tab === 'tab-tokens') loadTokens();
    if (btn.dataset.tab === 'tab-audit') loadAuditLog();
  };
});

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Inisialisasi awal
loadStats();
loadDrafts();
setInterval(loadStats, 15000);
