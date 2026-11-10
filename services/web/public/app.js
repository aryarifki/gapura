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
      } else if (viewId === 'view-agents') {
        loadAgentsConfigUI();
      } else if (viewId === 'view-n8n') {
        loadWorkflow();
      } else if (viewId === 'view-tokens') {
        loadTokens();
      } else if (viewId === 'view-audit') {
        loadAuditFull();
      }
    };
  });

  // Overview 4 Agent Status Cards Click -> Kustomisasi Agen AI
  const agentCards = document.querySelectorAll('.agent-status-card');
  if (agentCards.length >= 4) {
    const agentMap = ['scout', 'analis', 'copywriter', 'designer'];
    agentCards.forEach((card, idx) => {
      card.onclick = () => {
        switchToView('view-agents');
        switchAgentTab(agentMap[idx]);
      };
    });
  }

  // Agent Customization Tabs
  document.querySelectorAll('.agent-nav-tab').forEach((tab) => {
    tab.onclick = () => {
      switchAgentTab(tab.dataset.agent);
    };
  });

  // Agent Save Buttons
  const saveTopBtn = document.getElementById('btn-save-agents-config-top');
  const saveBottomBtn = document.getElementById('btn-save-agents-config-bottom');
  if (saveTopBtn) saveTopBtn.onclick = saveAgentsConfigUI;
  if (saveBottomBtn) saveBottomBtn.onclick = saveAgentsConfigUI;

  // Analis Threshold Slider & Num Sync
  const thresholdSlider = document.getElementById('analis-threshold');
  const thresholdNum = document.getElementById('analis-threshold-num');
  const thresholdLabel = document.getElementById('analis-threshold-label');
  if (thresholdSlider && thresholdNum) {
    thresholdSlider.oninput = () => {
      thresholdNum.value = thresholdSlider.value;
      if (thresholdLabel) thresholdLabel.textContent = thresholdSlider.value;
    };
    thresholdNum.oninput = () => {
      thresholdSlider.value = thresholdNum.value;
      if (thresholdLabel) thresholdLabel.textContent = thresholdNum.value;
    };
  }

  // Color Pickers & Hex Text Sync
  ['bg', 'ink', 'accent', 'highlight', 'up', 'down'].forEach((key) => {
    const picker = document.getElementById(`color-${key}`);
    const hex = document.getElementById(`color-${key}-hex`);
    if (picker && hex) {
      picker.oninput = () => { hex.value = picker.value; };
      hex.oninput = () => {
        if (/^#[0-9A-Fa-f]{6}$/.test(hex.value)) picker.value = hex.value;
      };
    }
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

  // Slide Layout Selector & Slide Manager
  const layoutSelect = document.getElementById('editor-select-layout');
  if (layoutSelect) {
    layoutSelect.onchange = () => {
      const l = layoutSelect.value;
      document.getElementById('editor-layout-name').textContent = l;
      const currentSlide = (activeDraft?.rendered_slides || [])[activeSlideIndex] || {};
      renderLayoutFields(l, currentSlide.data || {});
    };
  }
  const addSlideBtn = document.getElementById('btn-add-slide-editor');
  if (addSlideBtn) addSlideBtn.onclick = addSlideToDraft;
  const delSlideBtn = document.getElementById('btn-del-slide-editor');
  if (delSlideBtn) delSlideBtn.onclick = deleteSlideFromDraft;

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

    const rawCount = data.raw_items ?? 0;
    const passedCount = data.scores?.passed ?? 0;
    const fastFailedCount = (data.scores?.fast_failed ?? 0) + (data.scores?.rejected ?? 0);
    const pendingDrafts = data.drafts?.draft ?? 0;
    const scheduledPosts = data.scheduled_posts ?? 0;

    document.getElementById('ov-raw-val').textContent = rawCount;
    document.getElementById('ov-passed-val').textContent = passedCount;
    document.getElementById('ov-fastfail-val').textContent = fastFailedCount;
    document.getElementById('ov-pending-val').textContent = pendingDrafts;
    document.getElementById('ov-scheduled-val').textContent = scheduledPosts;

    const badge = document.getElementById('sidebar-review-badge');
    if (badge) {
      badge.textContent = pendingDrafts;
      badge.style.display = pendingDrafts > 0 ? 'inline-block' : 'none';
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

  document.getElementById('editor-slide-heading').textContent = `Slide ${activeSlideIndex + 1} dari ${slides.length}`;
  const layout = currentSlide.layout || 'cover-stat';
  document.getElementById('editor-layout-name').textContent = layout;

  const layoutSelect = document.getElementById('editor-select-layout');
  if (layoutSelect) {
    layoutSelect.value = layout;
  }

  document.getElementById('editor-input-slide-text').value = currentSlide.text || '';

  // Render dynamic custom layout parameter fields
  renderLayoutFields(layout, currentSlide.data || {});

  // Update active thumbnail
  document.querySelectorAll('.editor-thumb-box').forEach((box, idx) => {
    box.classList.toggle('active', idx === activeSlideIndex);
  });
}

function renderLayoutFields(layout, data) {
  const container = document.getElementById('editor-layout-fields-container');
  if (!container) return;
  container.innerHTML = '';

  let html = '';

  if (layout === 'cover-stat') {
    html = `
      <div style="font-size: 11px; font-weight: 700; color: var(--lime); margin-bottom: 10px; text-transform: uppercase;">
        ⚙️ Parameter Layout: Cover Stat
      </div>
      <div class="form-grid-2col">
        <div class="form-group-editor" style="margin-bottom: 8px;">
          <label class="form-label-editor">Hook Angka / Stat Besar</label>
          <input type="text" id="lf-stat-value" class="form-input-dark" value="${escapeHtml(data.value || '')}" placeholder="Contoh: Rp 18.085 atau +0,02% atau POJK 12/2026">
        </div>
        <div class="form-group-editor" style="margin-bottom: 8px;">
          <label class="form-label-editor">Subtext / Keterangan Unit</label>
          <input type="text" id="lf-stat-unit" class="form-input-dark" value="${escapeHtml(data.unit || data.subtext || '')}" placeholder="Contoh: KURS PERDAGANGAN RESMI">
        </div>
      </div>
      <div class="form-group-editor" style="margin-bottom: 0;">
        <label class="form-label-editor">Kategori Badge</label>
        <input type="text" id="lf-stat-category" class="form-input-dark" value="${escapeHtml(data.category || '')}" placeholder="Contoh: VALUTA & MAKRO / PASAR MODAL">
      </div>
    `;
  } else if (layout === 'big-statement') {
    html = `
      <div style="font-size: 11px; font-weight: 700; color: var(--lime); margin-bottom: 10px; text-transform: uppercase;">
        ⚙️ Parameter Layout: Big Statement
      </div>
      <div class="form-grid-2col">
        <div class="form-group-editor" style="margin-bottom: 8px;">
          <label class="form-label-editor">Tokoh / Sumber Pernyataan</label>
          <input type="text" id="lf-statement-author" class="form-input-dark" value="${escapeHtml(data.author || '')}" placeholder="Contoh: Bank Indonesia / BPS / OJK">
        </div>
        <div class="form-group-editor" style="margin-bottom: 8px;">
          <label class="form-label-editor">Kategori</label>
          <input type="text" id="lf-statement-category" class="form-input-dark" value="${escapeHtml(data.category || 'FAKTA KUNCI')}" placeholder="Kategori">
        </div>
      </div>
    `;
  } else if (layout === 'stat-grid') {
    const items = data.items || [
      { label: 'Data 1', value: '10%' },
      { label: 'Data 2', value: '25%' },
    ];
    html = `
      <div style="font-size: 11px; font-weight: 700; color: var(--lime); margin-bottom: 10px; text-transform: uppercase;">
        ⚙️ Parameter Layout: Stat Grid (Kotak Metrik)
      </div>
      <div class="form-grid-2col">
        <div class="form-group-editor" style="margin-bottom: 8px;">
          <label class="form-label-editor">Kotak 1: Nilai & Label</label>
          <div style="display: flex; gap: 6px;">
            <input type="text" id="lf-grid-v0" class="form-input-dark" style="width: 45%;" value="${escapeHtml(items[0]?.value || '')}" placeholder="Nilai">
            <input type="text" id="lf-grid-l0" class="form-input-dark" style="width: 55%;" value="${escapeHtml(items[0]?.label || '')}" placeholder="Label">
          </div>
        </div>
        <div class="form-group-editor" style="margin-bottom: 8px;">
          <label class="form-label-editor">Kotak 2: Nilai & Label</label>
          <div style="display: flex; gap: 6px;">
            <input type="text" id="lf-grid-v1" class="form-input-dark" style="width: 45%;" value="${escapeHtml(items[1]?.value || '')}" placeholder="Nilai">
            <input type="text" id="lf-grid-l1" class="form-input-dark" style="width: 55%;" value="${escapeHtml(items[1]?.label || '')}" placeholder="Label">
          </div>
        </div>
      </div>
      <div class="form-grid-2col" style="margin-top: 6px;">
        <div class="form-group-editor" style="margin-bottom: 0;">
          <label class="form-label-editor">Kotak 3 (Opsional)</label>
          <div style="display: flex; gap: 6px;">
            <input type="text" id="lf-grid-v2" class="form-input-dark" style="width: 45%;" value="${escapeHtml(items[2]?.value || '')}" placeholder="Nilai">
            <input type="text" id="lf-grid-l2" class="form-input-dark" style="width: 55%;" value="${escapeHtml(items[2]?.label || '')}" placeholder="Label">
          </div>
        </div>
        <div class="form-group-editor" style="margin-bottom: 0;">
          <label class="form-label-editor">Kotak 4 (Opsional)</label>
          <div style="display: flex; gap: 6px;">
            <input type="text" id="lf-grid-v3" class="form-input-dark" style="width: 45%;" value="${escapeHtml(items[3]?.value || '')}" placeholder="Nilai">
            <input type="text" id="lf-grid-l3" class="form-input-dark" style="width: 55%;" value="${escapeHtml(items[3]?.label || '')}" placeholder="Label">
          </div>
        </div>
      </div>
    `;
  } else if (layout === 'regulasi') {
    html = `
      <div style="font-size: 11px; font-weight: 700; color: var(--lime); margin-bottom: 10px; text-transform: uppercase;">
        ⚙️ Parameter Layout: Regulasi / Pasal Hukum
      </div>
      <div class="form-group-editor" style="margin-bottom: 0;">
        <label class="form-label-editor">Nama Dokumen / Nomor Regulasi / Pasal</label>
        <input type="text" id="lf-regulasi-title" class="form-input-dark" value="${escapeHtml(data.title || '')}" placeholder="Contoh: POJK NOMOR 12 TAHUN 2026 / PASAL 14">
      </div>
    `;
  } else if (layout === 'comparison') {
    const left = data.left || { title: 'Sebelum / Katalis', text: '' };
    const right = data.right || { title: 'Sesudah / Implikasi', text: '' };
    html = `
      <div style="font-size: 11px; font-weight: 700; color: var(--lime); margin-bottom: 10px; text-transform: uppercase;">
        ⚙️ Parameter Layout: Comparison (Perbandingan)
      </div>
      <div class="form-grid-2col">
        <div class="form-group-editor" style="margin-bottom: 8px;">
          <label class="form-label-editor">Kolom Kiri: Judul</label>
          <input type="text" id="lf-comp-lt" class="form-input-dark" value="${escapeHtml(left.title || '')}">
          <label class="form-label-editor" style="margin-top: 6px;">Kolom Kiri: Teks Narasi</label>
          <textarea id="lf-comp-lx" class="form-input-dark" rows="3">${escapeHtml(left.text || '')}</textarea>
        </div>
        <div class="form-group-editor" style="margin-bottom: 8px;">
          <label class="form-label-editor">Kolom Kanan: Judul</label>
          <input type="text" id="lf-comp-rt" class="form-input-dark" value="${escapeHtml(right.title || '')}">
          <label class="form-label-editor" style="margin-top: 6px;">Kolom Kanan: Teks Narasi</label>
          <textarea id="lf-comp-rx" class="form-input-dark" rows="3">${escapeHtml(right.text || '')}</textarea>
        </div>
      </div>
    `;
  } else if (layout === 'timeline') {
    const events = data.events || [
      { date: 'Tahap 1', text: '' },
      { date: 'Tahap 2', text: '' },
    ];
    html = `
      <div style="font-size: 11px; font-weight: 700; color: var(--lime); margin-bottom: 10px; text-transform: uppercase;">
        ⚙️ Parameter Layout: Timeline (Tahapan Kronologis)
      </div>
      <div class="form-group-editor" style="margin-bottom: 8px;">
        <label class="form-label-editor">Tahap 1 (Waktu & Keterangan)</label>
        <div style="display: flex; gap: 6px;">
          <input type="text" id="lf-time-d0" class="form-input-dark" style="width: 30%;" value="${escapeHtml(events[0]?.date || 'Tahap 1')}">
          <input type="text" id="lf-time-t0" class="form-input-dark" style="width: 70%;" value="${escapeHtml(events[0]?.text || '')}">
        </div>
      </div>
      <div class="form-group-editor" style="margin-bottom: 8px;">
        <label class="form-label-editor">Tahap 2 (Waktu & Keterangan)</label>
        <div style="display: flex; gap: 6px;">
          <input type="text" id="lf-time-d1" class="form-input-dark" style="width: 30%;" value="${escapeHtml(events[1]?.date || 'Tahap 2')}">
          <input type="text" id="lf-time-t1" class="form-input-dark" style="width: 70%;" value="${escapeHtml(events[1]?.text || '')}">
        </div>
      </div>
    `;
  } else if (layout === 'cta-close') {
    html = `
      <div style="font-size: 11px; font-weight: 700; color: var(--lime); margin-bottom: 10px; text-transform: uppercase;">
        ⚙️ Parameter Layout: CTA Close (Penutup)
      </div>
      <div class="form-group-editor" style="margin-bottom: 8px;">
        <label class="form-label-editor">Teks Call to Action (CTA)</label>
        <input type="text" id="lf-cta-text" class="form-input-dark" value="${escapeHtml(data.cta || 'Simpan postingan ini & ikuti @homelessmedia untuk data harian.')}">
      </div>
      <div class="form-group-editor" style="margin-bottom: 0;">
        <label class="form-label-editor">Teks Disclaimer Edukasi</label>
        <textarea id="lf-cta-disclaimer" class="form-input-dark" rows="2">${escapeHtml(data.disclaimer || '')}</textarea>
      </div>
    `;
  } else if (layout === 'chart-bar') {
    const labels = data.labels || [];
    const values = data.values || [];
    html = `
      <div style="font-size: 11px; font-weight: 700; color: var(--lime); margin-bottom: 10px; text-transform: uppercase;">
        ⚙️ Parameter Layout: Chart Bar
      </div>
      <div class="form-group-editor" style="margin-bottom: 8px;">
        <label class="form-label-editor">Labels (Pisahkan dengan koma)</label>
        <input type="text" id="lf-chart-labels" class="form-input-dark" value="${escapeHtml(labels.join(', '))}">
      </div>
      <div class="form-group-editor" style="margin-bottom: 0;">
        <label class="form-label-editor">Values Angka (Pisahkan dengan koma)</label>
        <input type="text" id="lf-chart-values" class="form-input-dark" value="${escapeHtml(values.join(', '))}">
      </div>
    `;
  }

  container.innerHTML = html;
}

function getCompiledLayoutData(layout, existingData = {}) {
  const data = { ...existingData };

  if (layout === 'cover-stat') {
    data.value = document.getElementById('lf-stat-value')?.value || data.value || '';
    data.unit = document.getElementById('lf-stat-unit')?.value || data.unit || '';
    data.category = document.getElementById('lf-stat-category')?.value || data.category || '';
    data.title = document.getElementById('editor-input-slide-text')?.value || '';
  } else if (layout === 'big-statement') {
    data.author = document.getElementById('lf-statement-author')?.value || data.author || '';
    data.category = document.getElementById('lf-statement-category')?.value || data.category || 'FAKTA KUNCI';
  } else if (layout === 'stat-grid') {
    const items = [];
    for (let i = 0; i < 4; i++) {
      const v = document.getElementById(`lf-grid-v${i}`)?.value;
      const l = document.getElementById(`lf-grid-l${i}`)?.value;
      if (v && l) items.push({ value: v.trim(), label: l.trim() });
    }
    if (items.length > 0) data.items = items;
  } else if (layout === 'regulasi') {
    data.title = document.getElementById('lf-regulasi-title')?.value || data.title || 'REGULASI RESMI';
    data.category = 'HUKUM & REGULASI';
  } else if (layout === 'comparison') {
    data.left = {
      title: document.getElementById('lf-comp-lt')?.value || 'Sebelum',
      text: document.getElementById('lf-comp-lx')?.value || '',
    };
    data.right = {
      title: document.getElementById('lf-comp-rt')?.value || 'Sesudah',
      text: document.getElementById('lf-comp-rx')?.value || '',
    };
    data.category = 'ANALISIS DAMPAK';
  } else if (layout === 'timeline') {
    const events = [];
    for (let i = 0; i < 3; i++) {
      const d = document.getElementById(`lf-time-d${i}`)?.value;
      const t = document.getElementById(`lf-time-t${i}`)?.value;
      if (d && t) events.push({ date: d.trim(), text: t.trim() });
    }
    if (events.length > 0) data.events = events;
  } else if (layout === 'cta-close') {
    data.cta = document.getElementById('lf-cta-text')?.value || data.cta || '';
    data.disclaimer = document.getElementById('lf-cta-disclaimer')?.value || data.disclaimer || '';
  } else if (layout === 'chart-bar') {
    const lRaw = document.getElementById('lf-chart-labels')?.value || '';
    const vRaw = document.getElementById('lf-chart-values')?.value || '';
    data.labels = lRaw.split(',').map((x) => x.trim()).filter(Boolean);
    data.values = vRaw.split(',').map((x) => parseFloat(x.trim())).filter((x) => !isNaN(x));
  }

  return data;
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

async function saveAndRerenderSlide() {
  if (!activeDraft) return;
  const slideNo = activeSlideIndex + 1;
  const newText = document.getElementById('editor-input-slide-text').value;
  const chosenLayout = document.getElementById('editor-select-layout').value;
  const currentSlide = (activeDraft.rendered_slides || [])[activeSlideIndex] || {};
  const compiledData = getCompiledLayoutData(chosenLayout, currentSlide.data || {});

  const btn = document.getElementById('btn-save-and-rerender');
  btn.disabled = true;
  btn.textContent = 'Memproses Render...';

  try {
    const res = await fetch(`/api/drafts/${activeDraft.id}/edit-slide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slide_no: slideNo,
        new_text: newText,
        layout: chosenLayout,
        data: compiledData,
      }),
    });

    if (res.ok) {
      const result = await res.json();
      showToast(`✨ Slide #${slideNo} (${chosenLayout}) berhasil dirender ulang!`);
      // Update local memory
      if (activeDraft.rendered_slides && activeDraft.rendered_slides[activeSlideIndex]) {
        activeDraft.rendered_slides[activeSlideIndex].text = newText;
        activeDraft.rendered_slides[activeSlideIndex].layout = chosenLayout;
        activeDraft.rendered_slides[activeSlideIndex].data = compiledData;
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
    btn.textContent = '🔄 Simpan & Render Ulang Slide';
  }
}

async function addSlideToDraft() {
  if (!activeDraft) return;
  const confirmAdd = confirm('Tambah slide baru di akhir carousel ini?');
  if (!confirmAdd) return;

  try {
    const res = await fetch(`/api/drafts/${activeDraft.id}/add-slide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        layout: 'big-statement',
        teks: 'Poin penting tambahan...',
        data: { category: 'ANALISIS TAMBAHAN' },
      }),
    });
    if (res.ok) {
      const result = await res.json();
      showToast(`Slide #${result.new_slide_no} berhasil ditambahkan!`);
      await loadDrafts();
      activeDraft = currentDrafts.find((d) => d.id === activeDraft.id);
      activeSlideIndex = (activeDraft.rendered_slides || []).length - 1;
      renderActiveSlide();
      renderThumbnailsStrip();
    }
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}

async function deleteSlideFromDraft() {
  if (!activeDraft) return;
  const slides = activeDraft.rendered_slides || [];
  if (slides.length <= 1) {
    alert('Draf minimal harus memiliki 1 slide.');
    return;
  }
  const slideNo = activeSlideIndex + 1;
  const confirmDel = confirm(`Yakin ingin menghapus Slide #${slideNo}?`);
  if (!confirmDel) return;

  try {
    const res = await fetch(`/api/drafts/${activeDraft.id}/delete-slide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slide_no: slideNo }),
    });
    if (res.ok) {
      showToast(`Slide #${slideNo} berhasil dihapus.`);
      await loadDrafts();
      activeDraft = currentDrafts.find((d) => d.id === activeDraft.id);
      activeSlideIndex = Math.max(0, activeSlideIndex - 1);
      renderActiveSlide();
      renderThumbnailsStrip();
    }
  } catch (err) {
    showToast(`Error: ${err.message}`);
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
      card.title = 'Klik untuk langsung mereview & memproduksi draf carousel ini';
      card.onclick = () => autoProduceAndReviewTopic(t.id, t.title);

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
            <span class="radar-action-hint" style="color: var(--lime); font-size: 11px; font-weight: 700; margin-left: auto; display: flex; align-items: center; gap: 4px;">
              <span>⚡</span> <span>Siap Produksi ↗</span>
            </span>
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

// ==============================================================================
// 11. Auto-Produce Topic to Deep Review Editor (User Request #1)
// ==============================================================================
async function autoProduceAndReviewTopic(topicId, topicTitle) {
  showToast(`✨ Menyiapkan draf carousel untuk: "${topicTitle.slice(0, 30)}..."`);
  try {
    const res = await fetch(`/api/topics/${topicId}/auto-produce`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const data = await res.json();
    showToast(data.is_existing ? 'Draf sudah tersedia! Membuka editor...' : '✨ Draf & slide berhasil diproduksi! Membuka editor...');
    await loadDrafts();
    switchToView('view-review');
    openDraftEditor(data.draft_id);
  } catch (err) {
    console.error('Error auto-producing topic:', err);
    showToast(`Gagal memproduksi draf: ${err.message}`);
  }
}

function switchToView(viewId) {
  document.querySelectorAll('.nav-item').forEach((i) => i.classList.remove('active'));
  document.querySelectorAll('.view-pane').forEach((p) => p.classList.remove('active'));

  const navItem = document.querySelector(`.nav-item[data-view="${viewId}"]`);
  const viewPane = document.getElementById(viewId);
  if (navItem) navItem.classList.add('active');
  if (viewPane) viewPane.classList.add('active');

  const sidebar = document.getElementById('app-sidebar');
  if (sidebar) sidebar.classList.remove('mobile-open');

  if (viewId === 'view-overview') {
    loadStats();
    loadActivityFeed();
  } else if (viewId === 'view-review') {
    loadDrafts();
    showGalleryView();
  } else if (viewId === 'view-topics') {
    loadTopics();
  } else if (viewId === 'view-agents') {
    loadAgentsConfigUI();
  } else if (viewId === 'view-n8n') {
    loadWorkflow();
  } else if (viewId === 'view-tokens') {
    loadTokens();
  } else if (viewId === 'view-audit') {
    loadAuditFull();
  }
}

function switchAgentTab(agentKey) {
  document.querySelectorAll('.agent-nav-tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.agent === agentKey);
  });
  document.querySelectorAll('.agent-tab-panel').forEach((p) => {
    p.classList.toggle('active', p.id === `tab-panel-${agentKey}`);
  });
}

// ==============================================================================
// 12. AI Agents Configuration UI (User Requests #3 & #4)
// ==============================================================================
async function loadAgentsConfigUI() {
  try {
    const res = await fetch('/api/agents/config');
    if (!res.ok) return;
    const config = await res.json();

    // Scout
    const scout = config.scout || {};
    if (document.getElementById('scout-poll-interval')) document.getElementById('scout-poll-interval').value = scout.poll_interval_mins ?? 30;
    if (document.getElementById('scout-dedup-threshold')) document.getElementById('scout-dedup-threshold').value = scout.dedup_similarity_threshold ?? 0.85;
    if (document.getElementById('scout-max-items')) document.getElementById('scout-max-items').value = scout.max_items_per_source ?? 15;
    if (document.getElementById('scout-keywords')) document.getElementById('scout-keywords').value = scout.custom_keywords ?? '';
    if (document.getElementById('scout-rules')) document.getElementById('scout-rules').value = scout.rules ?? '';

    // Analis
    const analis = config.analis || {};
    if (document.getElementById('analis-provider')) document.getElementById('analis-provider').value = analis.provider || 'gemini';
    if (document.getElementById('analis-model')) document.getElementById('analis-model').value = analis.model || 'gemini-2.0-flash';
    if (document.getElementById('analis-endpoint')) document.getElementById('analis-endpoint').value = analis.endpoint || 'https://generativelanguage.googleapis.com';
    if (document.getElementById('analis-api-key')) document.getElementById('analis-api-key').value = analis.api_key || '';

    const minThreshold = analis.min_score_threshold ?? 75;
    if (document.getElementById('analis-threshold')) document.getElementById('analis-threshold').value = minThreshold;
    if (document.getElementById('analis-threshold-num')) document.getElementById('analis-threshold-num').value = minThreshold;
    if (document.getElementById('analis-threshold-label')) document.getElementById('analis-threshold-label').textContent = minThreshold;

    const weights = analis.weights || {};
    if (document.getElementById('weight-relevance')) document.getElementById('weight-relevance').value = weights.relevance ?? 30;
    if (document.getElementById('weight-credibility')) document.getElementById('weight-credibility').value = weights.credibility ?? 25;
    if (document.getElementById('weight-momentum')) document.getElementById('weight-momentum').value = weights.momentum ?? 20;
    if (document.getElementById('weight-engagement')) document.getElementById('weight-engagement').value = weights.engagement ?? 15;
    if (document.getElementById('weight-compliance')) document.getElementById('weight-compliance').value = weights.compliance ?? 10;

    if (document.getElementById('analis-fastfail')) document.getElementById('analis-fastfail').value = analis.fast_fail_rules ?? '';
    if (document.getElementById('analis-prompt')) document.getElementById('analis-prompt').value = analis.system_prompt ?? '';

    // Copywriter
    const copy = config.copywriter || {};
    if (document.getElementById('copywriter-provider')) document.getElementById('copywriter-provider').value = copy.provider || 'gemini';
    if (document.getElementById('copywriter-model')) document.getElementById('copywriter-model').value = copy.model || 'gemini-2.0-flash';
    if (document.getElementById('copywriter-endpoint')) document.getElementById('copywriter-endpoint').value = copy.endpoint || 'https://generativelanguage.googleapis.com';
    if (document.getElementById('copywriter-api-key')) document.getElementById('copywriter-api-key').value = copy.api_key || '';
    if (document.getElementById('copywriter-slides-count')) document.getElementById('copywriter-slides-count').value = copy.slide_count ?? 5;
    if (document.getElementById('copywriter-tone')) document.getElementById('copywriter-tone').value = copy.tone_of_voice ?? '';
    if (document.getElementById('copywriter-banned-words')) document.getElementById('copywriter-banned-words').value = copy.banned_words ?? '';
    if (document.getElementById('copywriter-disclaimer-fin')) document.getElementById('copywriter-disclaimer-fin').value = copy.disclaimer_financial ?? '';
    if (document.getElementById('copywriter-disclaimer-legal')) document.getElementById('copywriter-disclaimer-legal').value = copy.disclaimer_legal ?? '';
    if (document.getElementById('copywriter-prompt')) document.getElementById('copywriter-prompt').value = copy.system_prompt ?? '';

    // Designer
    const designer = config.designer || {};
    const tokens = designer.tokens || {};
    const palette = tokens.palette || {};

    const colorKeys = ['bg', 'ink', 'accent', 'highlight', 'up', 'down'];
    colorKeys.forEach((k) => {
      const val = palette[k] || (k === 'bg' ? '#f7f5f0' : k === 'ink' ? '#102b45' : '#1f7e81');
      const pEl = document.getElementById(`color-${k}`);
      const hEl = document.getElementById(`color-${k}-hex`);
      if (pEl) pEl.value = val;
      if (hEl) hEl.value = val;
    });

    const typo = tokens.typography || {};
    if (document.getElementById('designer-display-font')) document.getElementById('designer-display-font').value = typo.display_font || 'Archivo Black';
    if (document.getElementById('designer-text-font')) document.getElementById('designer-text-font').value = typo.text_font || 'Inter';

    const layouts = designer.default_layouts || {};
    if (document.getElementById('layout-cover')) document.getElementById('layout-cover').value = layouts.cover || 'cover-stat';
    if (document.getElementById('layout-context')) document.getElementById('layout-context').value = layouts.context || 'big-statement';
    if (document.getElementById('layout-data')) document.getElementById('layout-data').value = layouts.evidence_data || 'chart-bar';
    if (document.getElementById('layout-implication')) document.getElementById('layout-implication').value = layouts.implication || 'comparison';
    if (document.getElementById('layout-close')) document.getElementById('layout-close').value = layouts.close || 'cta-close';

    if (document.getElementById('designer-autofit')) {
      document.getElementById('designer-autofit').checked = designer.auto_fit_text !== false;
    }
  } catch (err) {
    console.error('Error loadAgentsConfigUI:', err);
  }
}

async function saveAgentsConfigUI() {
  const saveBtns = [
    document.getElementById('btn-save-agents-config-top'),
    document.getElementById('btn-save-agents-config-bottom'),
  ].filter(Boolean);

  saveBtns.forEach((b) => {
    b.disabled = true;
    b.innerHTML = '<span>⏳</span> <span>Menyimpan & Menerapkan...</span>';
  });

  try {
    const payload = {
      scout: {
        poll_interval_mins: parseInt(document.getElementById('scout-poll-interval')?.value || '30'),
        dedup_similarity_threshold: parseFloat(document.getElementById('scout-dedup-threshold')?.value || '0.85'),
        max_items_per_source: parseInt(document.getElementById('scout-max-items')?.value || '15'),
        custom_keywords: document.getElementById('scout-keywords')?.value || '',
        rules: document.getElementById('scout-rules')?.value || '',
      },
      analis: {
        provider: document.getElementById('analis-provider')?.value || 'gemini',
        endpoint: document.getElementById('analis-endpoint')?.value || 'https://generativelanguage.googleapis.com',
        api_key: document.getElementById('analis-api-key')?.value || '',
        model: document.getElementById('analis-model')?.value || 'gemini-2.0-flash',
        min_score_threshold: parseInt(document.getElementById('analis-threshold')?.value || '75'),
        weights: {
          relevance: parseInt(document.getElementById('weight-relevance')?.value || '30'),
          credibility: parseInt(document.getElementById('weight-credibility')?.value || '25'),
          momentum: parseInt(document.getElementById('weight-momentum')?.value || '20'),
          engagement: parseInt(document.getElementById('weight-engagement')?.value || '15'),
          compliance: parseInt(document.getElementById('weight-compliance')?.value || '10'),
        },
        fast_fail_rules: document.getElementById('analis-fastfail')?.value || '',
        system_prompt: document.getElementById('analis-prompt')?.value || '',
      },
      copywriter: {
        provider: document.getElementById('copywriter-provider')?.value || 'gemini',
        endpoint: document.getElementById('copywriter-endpoint')?.value || 'https://generativelanguage.googleapis.com',
        api_key: document.getElementById('copywriter-api-key')?.value || '',
        model: document.getElementById('copywriter-model')?.value || 'gemini-2.0-flash',
        slide_count: parseInt(document.getElementById('copywriter-slides-count')?.value || '5'),
        tone_of_voice: document.getElementById('copywriter-tone')?.value || '',
        banned_words: document.getElementById('copywriter-banned-words')?.value || '',
        system_prompt: document.getElementById('copywriter-prompt')?.value || '',
        disclaimer_financial: document.getElementById('copywriter-disclaimer-fin')?.value || '',
        disclaimer_legal: document.getElementById('copywriter-disclaimer-legal')?.value || '',
      },
      designer: {
        tokens: {
          palette: {
            bg: document.getElementById('color-bg-hex')?.value || '#f7f5f0',
            ink: document.getElementById('color-ink-hex')?.value || '#102b45',
            accent: document.getElementById('color-accent-hex')?.value || '#1f7e81',
            highlight: document.getElementById('color-highlight-hex')?.value || '#d79344',
            up: document.getElementById('color-up-hex')?.value || '#1a7a4f',
            down: document.getElementById('color-down-hex')?.value || '#b23a48',
          },
          typography: {
            display_font: document.getElementById('designer-display-font')?.value || 'Archivo Black',
            text_font: document.getElementById('designer-text-font')?.value || 'Inter',
          },
        },
        default_layouts: {
          cover: document.getElementById('layout-cover')?.value || 'cover-stat',
          context: document.getElementById('layout-context')?.value || 'big-statement',
          evidence_data: document.getElementById('layout-data')?.value || 'chart-bar',
          evidence_legal: document.getElementById('layout-implication')?.value || 'comparison',
          implication: document.getElementById('layout-implication')?.value || 'comparison',
          close: document.getElementById('layout-close')?.value || 'cta-close',
        },
        auto_fit_text: document.getElementById('designer-autofit')?.checked !== false,
      },
    };

    const res = await fetch('/api/agents/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    const data = await res.json();
    showToast(data.message || '✅ Konfigurasi 4 Agen AI berhasil disimpan & diterapkan!');
  } catch (err) {
    console.error('Error saving agent config:', err);
    showToast(`Gagal menyimpan: ${err.message}`);
  } finally {
    saveBtns.forEach((b) => {
      b.disabled = false;
      b.innerHTML = '<span>💾</span> <span>Simpan & Terapkan Perubahan</span>';
    });
  }
}

window.togglePasswordVisibility = function (id) {
  const el = document.getElementById(id);
  if (el) {
    el.type = el.type === 'password' ? 'text' : 'password';
  }
};

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
