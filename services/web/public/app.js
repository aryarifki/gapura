// ==============================================================================
// GAPURA MEDIA (Homeless Media Engine v2.0) - Ruang Redaksi Client Controller
// Reference: Ruang Redaksi & Studio Editor Design System
// ==============================================================================

let currentDrafts = [];
let currentFilter = 'all';
let currentTopicStatus = '';
let activeDraft = null;
let activeSlideIndex = 0;
let currentWorkflowActive = false;

// 1. Inisialisasi & Navigasi
document.addEventListener('DOMContentLoaded', () => {
  setupNavigation();
  loadStats();
  loadDrafts();
  loadActivityFeed();

  // Polling data berkala
  setInterval(() => {
    loadStats();
    loadActivityFeed();
  }, 15000);
});

function setupNavigation() {
  // Mobile Sidebar Toggle
  const toggleBtn = document.getElementById('btn-toggle-sidebar');
  const sidebar = document.getElementById('app-sidebar');
  if (toggleBtn && sidebar) {
    toggleBtn.onclick = () => {
      sidebar.classList.toggle('mobile-open');
    };
  }

  // Sidebar Menu Clicks
  document.querySelectorAll('.nav-item').forEach((item) => {
    item.onclick = () => {
      document.querySelectorAll('.nav-item').forEach((i) => i.classList.remove('active'));
      document.querySelectorAll('.view-pane').forEach((p) => p.classList.remove('active'));

      item.classList.add('active');
      const viewId = item.dataset.view;
      const targetView = document.getElementById(viewId);
      if (targetView) targetView.classList.add('active');

      if (sidebar) sidebar.classList.remove('mobile-open');

      if (viewId === 'view-overview') {
        loadStats();
        loadActivityFeed();
      } else if (viewId === 'view-review') {
        loadDrafts();
        showGalleryView();
      } else if (viewId === 'view-topics') {
        loadTopics();
      } else if (viewId === 'view-n8n') {
        loadWorkflow();
      } else if (viewId === 'view-tokens') {
        loadTokens();
      } else if (viewId === 'view-audit') {
        loadAuditFull();
      }
    };
  });

  // Filter Tabs Gallery Review
  document.querySelectorAll('.gallery-tab-btn[data-filter]').forEach((btn) => {
    btn.onclick = () => {
      document.querySelectorAll('.gallery-tab-btn[data-filter]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      renderGalleryCards();
    };
  });

  // Filter Tabs Radar Topik
  document.querySelectorAll('.btn-topic-filter').forEach((btn) => {
    btn.onclick = () => {
      document.querySelectorAll('.btn-topic-filter').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentTopicStatus = btn.dataset.status;
      loadTopics();
    };
  });

  // Runner Button
  const runBtn = document.getElementById('btn-run-pipeline-top');
  if (runBtn) {
    runBtn.onclick = triggerPipelineRun;
  }

  // Back from editor to gallery
  const backBtn = document.getElementById('btn-back-to-gallery');
  if (backBtn) {
    backBtn.onclick = showGalleryView;
  }

  // Slide Navigation Arrows
  document.getElementById('btn-slide-prev').onclick = () => navigateSlide(-1);
  document.getElementById('btn-slide-next').onclick = () => navigateSlide(1);

  // Editor Actions
  document.getElementById('btn-save-and-rerender').onclick = saveAndRerenderSlide;
  document.getElementById('btn-save-text-only').onclick = saveTextOnly;
  document.getElementById('btn-copy-caption-full').onclick = copyFullCaption;
  document.getElementById('btn-download-all-slides').onclick = downloadAllSlides;
  document.getElementById('btn-open-single-slide').onclick = openCurrentSlideFull;

  // Decision Buttons in Editor
  document.getElementById('btn-action-post-now').onclick = () => approveCurrentDraft('auto');
  document.getElementById('btn-action-approve-auto').onclick = () => approveCurrentDraft('auto');
  document.getElementById('btn-action-approve-manual').onclick = () => approveCurrentDraft('manual');
  document.getElementById('btn-action-reject').onclick = rejectCurrentDraft;

  // n8n Controls
  document.getElementById('btn-toggle-wf-dark').onclick = toggleWorkflowState;
  document.getElementById('btn-copy-wf-json-dark').onclick = copyWorkflowJson;

  // Tokens Save
  document.getElementById('btn-save-tokens-dark').onclick = saveTokensYaml;
}

// 2. Fetch Overview Stats
async function loadStats() {
  try {
    const res = await fetch('/api/stats');
    if (!res.ok) return;
    const data = await res.json();

    document.getElementById('ov-raw-val').textContent = data.raw_items_count || 0;
    document.getElementById('ov-passed-val').textContent = data.topics_passed || 0;
    document.getElementById('ov-fastfail-val').textContent = data.topics_fastfailed || 0;
    document.getElementById('ov-pending-val').textContent = data.drafts_pending || 0;
    document.getElementById('ov-scheduled-val').textContent = data.scheduled_count || 0;

    const badge = document.getElementById('sidebar-review-badge');
    if (badge) {
      badge.textContent = data.drafts_pending || 0;
      badge.style.display = data.drafts_pending > 0 ? 'inline-block' : 'none';
    }
  } catch (err) {
    console.error('Error loadStats:', err);
  }
}

// 3. Activity Feed (Ruang Redaksi)
async function loadActivityFeed() {
  try {
    const res = await fetch('/api/audit-log');
    if (!res.ok) return;
    const logs = await res.json();

    const list = document.getElementById('activity-feed-list');
    if (!list) return;
    list.innerHTML = '';

    const recent = logs.slice(0, 7);
    recent.forEach((item) => {
      let agentTag = item.actor || 'System';
      let tagClass = 'color: #38BDF8;'; // Scout blue

      if (/analis/i.test(agentTag)) {
        tagClass = 'color: #A855F7;';
      } else if (/copywriter/i.test(agentTag)) {
        tagClass = 'color: #EAB308;';
      } else if (/designer|render/i.test(agentTag)) {
        tagClass = 'color: #EC4899;';
      } else if (/admin|web/i.test(agentTag)) {
        tagClass = 'color: var(--lime);';
      }

      const row = document.createElement('div');
      row.className = 'activity-item';

      let msg = `${item.action} pada ${item.entity} #${item.entity_id}`;
      if (item.action === 'produced') msg = `Draf baru berhasil diproduksi untuk Draf #${item.entity_id}`;
      else if (item.action === 'approved_auto') msg = `Draf #${item.entity_id} disetujui untuk Auto-Publish terjadwal`;
      else if (item.action === 'approved_manual') msg = `Draf #${item.entity_id} disetujui untuk publikasi manual`;
      else if (item.action === 'rejected') msg = `Draf #${item.entity_id} ditolak oleh admin`;
      else if (item.action === 'edit_slide') msg = `Slide teks Draf #${item.entity_id} diperbarui & dirender ulang`;
      else if (item.action === 'activated') msg = `Workflow otomasi n8n diaktifkan`;

      row.innerHTML = `
        <div class="activity-left">
          <span class="activity-agent-tag" style="${tagClass}">● ${agentTag}</span>
          <span class="activity-msg">${escapeHtml(msg)}</span>
        </div>
        <span class="activity-time">${formatTimeAgo(item.created_at)}</span>
      `;
      list.appendChild(row);
    });
  } catch (err) {
    console.error('Error loadActivityFeed:', err);
  }
}

// 4. Drafts (Gallery View - Reference s-3.jpg)
async function loadDrafts() {
  try {
    const res = await fetch('/api/drafts');
    if (!res.ok) return;
    currentDrafts = await res.json();

    // Update filter counts
    const pendingCount = currentDrafts.filter((d) => d.status === 'draft').length;
    const scheduledCount = currentDrafts.filter((d) => d.status === 'scheduled').length;
    const approvedCount = currentDrafts.filter((d) => d.status === 'approved').length;
    const rejectedCount = currentDrafts.filter((d) => d.status === 'rejected').length;

    document.getElementById('count-all').textContent = currentDrafts.length;
    document.getElementById('count-pending').textContent = pendingCount;
    document.getElementById('count-scheduled').textContent = scheduledCount;
    document.getElementById('count-approved').textContent = approvedCount;
    document.getElementById('count-rejected').textContent = rejectedCount;

    renderGalleryCards();
  } catch (err) {
    console.error('Error loadDrafts:', err);
  }
}

function renderGalleryCards() {
  const container = document.getElementById('gallery-cards-container');
  if (!container) return;
  container.innerHTML = '';

  const filtered = currentDrafts.filter((d) => {
    if (currentFilter === 'all') return true;
    return d.status === currentFilter;
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; padding: 40px; text-align: center; color: var(--muted); background: var(--card-bg); border-radius: 10px; border: 1px dashed var(--border);">
        Tidak ada draf dalam kategori "${currentFilter}".
      </div>
    `;
    return;
  }

  filtered.forEach((d) => {
    const slides = d.rendered_slides || [];
    const coverImg = slides[0] ? `${slides[0].image_url}?t=${Date.now()}` : '';

    const card = document.createElement('div');
    card.className = 'gallery-card';
    card.onclick = () => openDraftEditor(d.id);

    card.innerHTML = `
      <div class="gallery-card-thumb-wrap">
        <img class="gallery-card-img" src="${coverImg}" alt="${escapeHtml(d.topic_title)}" loading="lazy">
        <span class="gallery-card-slide-count">1/${slides.length || 5}</span>
        <span class="gallery-card-score-badge">${d.score_total || 80}</span>
      </div>
      <div class="gallery-card-content">
        <h4 class="gallery-card-title">${escapeHtml(d.topic_title)}</h4>
        <div class="gallery-card-meta">
          <span>${escapeHtml(d.primary_source || 'Sumber Resmi')}</span>
          <span>·</span>
          <span>${formatTimeAgo(d.created_at)}</span>
        </div>
      </div>
    `;

    container.appendChild(card);
  });
}

// 5. Deep Draft Review & Slide Editor Mode (Reference IMG_20261110_205004_739.jpg & s-2.jpg)
function openDraftEditor(draftId) {
  activeDraft = currentDrafts.find((d) => d.id === draftId);
  if (!activeDraft) return;

  activeSlideIndex = 0;

  // Toggle subviews
  document.getElementById('review-gallery-subview').style.display = 'none';
  document.getElementById('review-editor-subview').style.display = 'block';

  // Header info
  document.getElementById('editor-source-link').innerHTML = `🔗 Sumber: <b>${escapeHtml(activeDraft.primary_source)}</b>`;

  // Update slide viewer & form
  renderActiveSlide();
  renderThumbnailsStrip();

  // Populate caption & hashtags
  document.getElementById('editor-input-caption').value = activeDraft.caption || '';
  document.getElementById('editor-input-hashtags').value = (activeDraft.hashtags || []).join(' ');
}

function showGalleryView() {
  document.getElementById('review-gallery-subview').style.display = 'block';
  document.getElementById('review-editor-subview').style.display = 'none';
  loadDrafts();
}

function renderActiveSlide() {
  if (!activeDraft) return;
  const slides = activeDraft.rendered_slides || [];
  const currentSlide = slides[activeSlideIndex] || {};

  const mainImg = document.getElementById('editor-main-slide-img');
  if (mainImg) {
    mainImg.src = `${currentSlide.image_url}?t=${Date.now()}`;
  }

  document.getElementById('editor-slide-heading').textContent = `Slide ${activeSlideIndex + 1} · ${getSlideRole(activeSlideIndex)}`;
  document.getElementById('editor-layout-name').textContent = currentSlide.layout || 'standard';
  document.getElementById('editor-input-slide-text').value = currentSlide.text || '';

  // Update active thumbnail
  document.querySelectorAll('.editor-thumb-box').forEach((box, idx) => {
    box.classList.toggle('active', idx === activeSlideIndex);
  });
}

function renderThumbnailsStrip() {
  const strip = document.getElementById('editor-thumbs-strip');
  if (!strip || !activeDraft) return;
  strip.innerHTML = '';

  const slides = activeDraft.rendered_slides || [];
  slides.forEach((s, idx) => {
    const box = document.createElement('div');
    box.className = `editor-thumb-box ${idx === activeSlideIndex ? 'active' : ''}`;
    box.onclick = () => {
      activeSlideIndex = idx;
      renderActiveSlide();
    };

    box.innerHTML = `
      <img src="${s.image_url}?t=${Date.now()}" alt="Slide ${idx + 1}">
      <span class="editor-thumb-number">${idx + 1}</span>
    `;
    strip.appendChild(box);
  });
}

function navigateSlide(dir) {
  if (!activeDraft) return;
  const slides = activeDraft.rendered_slides || [];
  const nextIdx = activeSlideIndex + dir;
  if (nextIdx >= 0 && nextIdx < slides.length) {
    activeSlideIndex = nextIdx;
    renderActiveSlide();
  }
}

function getSlideRole(idx) {
  const roles = ['Cover (Hook)', 'Konteks Peristiwa', 'Bukti / Data / Regulasi', 'Implikasi Kebijakan', 'CTA Penutup'];
  return roles[idx] || `Slide ${idx + 1}`;
}

async function saveAndRerenderSlide() {
  if (!activeDraft) return;
  const slideNo = activeSlideIndex + 1;
  const newText = document.getElementById('editor-input-slide-text').value;

  const btn = document.getElementById('btn-save-and-rerender');
  btn.disabled = true;
  btn.textContent = 'Memproses Render...';

  try {
    const res = await fetch(`/api/drafts/${activeDraft.id}/edit-slide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slide_no: slideNo, new_text: newText }),
    });

    if (res.ok) {
      showToast(`Slide #${slideNo} berhasil dirender ulang!`);
      // Update local memory
      if (activeDraft.rendered_slides && activeDraft.rendered_slides[activeSlideIndex]) {
        activeDraft.rendered_slides[activeSlideIndex].text = newText;
      }
      renderActiveSlide();
      renderThumbnailsStrip();
    } else {
      const err = await res.json();
      showToast(`Gagal: ${err.error}`);
    }
  } catch (err) {
    showToast(`Error: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = '🔄 Simpan & Render Ulang';
  }
}

async function saveTextOnly() {
  if (!activeDraft) return;
  const newCaption = document.getElementById('editor-input-caption').value;
  try {
    const res = await fetch(`/api/drafts/${activeDraft.id}/update-full`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ caption: newCaption }),
    });
    if (res.ok) {
      showToast('Teks caption berhasil disimpan!');
    }
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}

function copyFullCaption() {
  if (!activeDraft) return;
  const caption = document.getElementById('editor-input-caption').value;
  const hashtags = document.getElementById('editor-input-hashtags').value;
  const fullText = `${caption}\n\n${hashtags}`;
  navigator.clipboard.writeText(fullText);
  showToast('Caption + Hashtag berhasil disalin ke clipboard!');
}

function openCurrentSlideFull() {
  if (!activeDraft) return;
  const slides = activeDraft.rendered_slides || [];
  const s = slides[activeSlideIndex];
  if (s && s.image_url) {
    window.open(s.image_url, '_blank');
  }
}

function downloadAllSlides() {
  if (!activeDraft) return;
  const slides = activeDraft.rendered_slides || [];
  slides.forEach((s) => {
    const link = document.createElement('a');
    link.href = s.image_url;
    link.download = `Draft_${activeDraft.id}_Slide_${s.slide_no}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  });
  showToast(`Mengunduh ${slides.length} slide carousel...`);
}

async function approveCurrentDraft(mode) {
  if (!activeDraft) return;
  try {
    const res = await fetch(`/api/drafts/${activeDraft.id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    });
    if (res.ok) {
      showToast(`Draf #${activeDraft.id} disetujui (${mode === 'auto' ? 'Auto-Publish' : 'Manual'})!`);
      showGalleryView();
    }
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}

async function rejectCurrentDraft() {
  if (!activeDraft) return;
  const reason = prompt('Masukkan alasan penolakan draf:', 'Kurang sesuai dengan standar editorial');
  if (!reason) return;

  try {
    const res = await fetch(`/api/drafts/${activeDraft.id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    if (res.ok) {
      showToast(`Draf #${activeDraft.id} ditolak.`);
      showGalleryView();
    }
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}

// 6. Radar Topik (Reference IMG_20261110_204957_926.jpg)
async function loadTopics() {
  try {
    let url = '/api/topics?limit=40';
    if (currentTopicStatus) url += `&status=${currentTopicStatus}`;
    const res = await fetch(url);
    if (!res.ok) return;
    const topics = await res.json();

    const container = document.getElementById('radar-list-container');
    if (!container) return;
    container.innerHTML = '';

    if (topics.length === 0) {
      container.innerHTML = `<div style="padding: 40px; text-align: center; color: var(--muted); background: var(--card-bg); border-radius: 10px;">Tidak ada topik ditemukan.</div>`;
      return;
    }

    topics.forEach((t) => {
      const isLolos = t.status === 'scored' || t.status === 'produced';
      const score = t.score_total || 0;

      const card = document.createElement('div');
      card.className = 'radar-item-card';

      card.innerHTML = `
        <div class="radar-score-col">
          <div class="radar-big-score" style="color: ${score >= 75 ? 'var(--lime)' : '#64748B'};">${score}</div>
        </div>
        <div class="radar-content-col">
          <div class="radar-item-title">${escapeHtml(t.title)}</div>
          <div class="radar-item-summary">↳ ${escapeHtml(t.summary ? t.summary.slice(0, 160) + '...' : '')}</div>
          <div class="radar-badges-row">
            <span class="radar-badge ${isLolos ? 'radar-badge-lolos' : 'radar-badge-gugur'}">${isLolos ? 'Lolos' : 'Gugur'}</span>
            <span class="radar-badge radar-badge-category">${escapeHtml(t.primary_source)}</span>
            <span class="radar-source-meta">· ${formatTimeAgo(t.created_at)}</span>
          </div>
        </div>
      `;

      container.appendChild(card);
    });
  } catch (err) {
    console.error('Error loadTopics:', err);
  }
}

// 7. Trigger Pipeline Runner
async function triggerPipelineRun() {
  const btn = document.getElementById('btn-run-pipeline-top');
  btn.disabled = true;
  btn.innerHTML = '<span>⏳</span> <span>Memproses 4 Agen...</span>';

  try {
    const res = await fetch('/api/pipeline/run', { method: 'POST' });
    const data = await res.json();
    showToast(data.message);

    setTimeout(() => {
      btn.disabled = false;
      btn.innerHTML = '<span>🔄</span> <span>Cari topik sekarang</span>';
      loadStats();
      loadDrafts();
      loadActivityFeed();
    }, 6000);
  } catch (err) {
    btn.disabled = false;
    btn.innerHTML = '<span>🔄</span> <span>Cari topik sekarang</span>';
    showToast(`Error: ${err.message}`);
  }
}

// 8. n8n Studio Workflow
async function loadWorkflow() {
  try {
    const res = await fetch('/api/workflow');
    const data = await res.json();
    const viewer = document.getElementById('workflow-json-viewer-dark');
    if (viewer) viewer.value = JSON.stringify(data.json || {}, null, 2);

    currentWorkflowActive = !!data.active;
    const btn = document.getElementById('btn-toggle-wf-dark');
    if (btn) {
      btn.textContent = currentWorkflowActive ? '⏸️ Jeda Otomasi n8n' : '⚡ Aktifkan Otomasi n8n';
    }
  } catch (err) {
    console.error('Error loadWorkflow:', err);
  }
}

async function toggleWorkflowState() {
  try {
    const res = await fetch('/api/workflow/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !currentWorkflowActive }),
    });
    const result = await res.json();
    if (result.status === 'success') {
      showToast(`Otomasi n8n berhasil ${result.active ? 'diaktifkan' : 'dijeda'}!`);
      loadWorkflow();
    }
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}

function copyWorkflowJson() {
  const viewer = document.getElementById('workflow-json-viewer-dark');
  if (viewer && viewer.value) {
    navigator.clipboard.writeText(viewer.value);
    showToast('Definisi JSON Workflow berhasil disalin!');
  }
}

// 9. Tokens System
async function loadTokens() {
  try {
    const res = await fetch('/api/tokens');
    const data = await res.json();
    const ed = document.getElementById('tokens-editor-dark');
    if (ed) ed.value = data.raw || '';
  } catch (err) {
    console.error('Error loadTokens:', err);
  }
}

async function saveTokensYaml() {
  const ed = document.getElementById('tokens-editor-dark');
  if (!ed) return;
  try {
    const res = await fetch('/api/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ yaml_content: ed.value }),
    });
    if (res.ok) {
      showToast('tokens.yaml berhasil disimpan & direload di Render Service!');
    }
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}

// 10. Audit Full
async function loadAuditFull() {
  try {
    const res = await fetch('/api/audit-log');
    const logs = await res.json();
    const list = document.getElementById('audit-full-list');
    if (!list) return;
    list.innerHTML = '';

    logs.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'activity-item';
      row.innerHTML = `
        <div class="activity-left">
          <span class="activity-agent-tag" style="color: var(--lime);">#${item.id}</span>
          <span class="activity-msg"><b>[${item.action}]</b> ${item.entity} #${item.entity_id} oleh ${item.actor}</span>
        </div>
        <span class="activity-time">${new Date(item.created_at).toLocaleString('id-ID')}</span>
      `;
      list.appendChild(row);
    });
  } catch (err) {
    console.error('Error loadAuditFull:', err);
  }
}

// Utilities
function formatTimeAgo(dateStr) {
  if (!dateStr) return 'baru saja';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'baru saja';
  if (mins < 60) return `${mins} mnt lalu`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} jam lalu`;
  const days = Math.floor(hours / 24);
  return `${days} hari lalu`;
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3500);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
