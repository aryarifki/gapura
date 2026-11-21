// ==============================================================================
// GAPURA MEDIA (Homeless Media Engine v2.0) - Ruang Redaksi Client Controller
// Reference: Ruang Redaksi & Studio Editor Design System
// ==============================================================================

let currentDrafts = [];
let currentFilter = 'all';
let currentTopicStatus = '';
let currentTopicOffset = 0;
let topicHasMore = false;
let activeDraft = null;
let activeSlideIndex = 0;
let pendingManualAsset = null;
let manualAssetCache = { topicId: null, assets: [], loaded: false, loading: false };
let currentWorkflowActive = false;
let cachedTopics = [];
let studioSlides = [];
let studioGeneratedContent = null;
let studioGeneratedInput = '';
let activeStudioSlideIndex = 0;
let editorLivePreviewDebounceTimer = null;
let designStudioDebounceTimer = null;
let designStudioInitialized = false;
let appNavigation = null;
let createNavigationController = null;

// Logging terpusat: setiap klik tombol dan error frontend dikirim ke audit_log.
// Logging bersifat best-effort agar kegagalan logger tidak memblokir UI.
function reportClientLog(level, action, error = null, meta = {}) {
  const payload = {
    level,
    action,
    message: error?.message || String(error || ''),
    stack: error?.stack || null,
    meta,
    url: window.location.href,
  };
  return fetch('/api/client-log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => undefined);
}

window.addEventListener('error', (event) => {
  reportClientLog('error', 'window.error', event.error || new Error(event.message), {
    source: event.filename,
    line: event.lineno,
    column: event.colno,
  });
});

window.addEventListener('unhandledrejection', (event) => {
  reportClientLog('error', 'unhandledrejection', event.reason instanceof Error ? event.reason : new Error(String(event.reason)));
});

document.addEventListener('click', (event) => {
  const target = event.target.closest('button, [role="button"], .nav-item');
  if (target) {
    reportClientLog('info', 'ui.click', null, {
      id: target.id || null,
      text: (target.innerText || target.getAttribute('aria-label') || '').trim().slice(0, 120),
      view: target.closest('.view-pane')?.id || null,
    });
  }
});

function bindClick(id, handler) {
  const el = document.getElementById(id);
  if (!el) return;
  el.onclick = async (event) => {
    try {
      return await handler(event);
    } catch (error) {
      await reportClientLog('error', `ui.action.${id}`, error);
      console.error(`Error action ${id}:`, error);
      showToast(`Terjadi kesalahan: ${error.message}`);
    }
  };
}

function readEditorialInput(modeId, factsId, { allowEmptyCurrent = false } = {}) {
  const mode = document.getElementById(modeId)?.value || 'explainer';
  let facts;
  try { facts = JSON.parse(document.getElementById(factsId)?.value || '[]'); }
  catch { throw new Error('Catatan fakta harus JSON array yang valid.'); }
  if (!Array.isArray(facts)) throw new Error('Catatan fakta harus berupa JSON array.');
  if (mode === 'explainer' && facts.length) throw new Error('Mode explainer memakai []. Pilih current untuk memakai catatan fakta.');
  if (mode === 'current' && facts.length === 0 && allowEmptyCurrent) return undefined;
  if (mode === 'current' && facts.length < 3) throw new Error('Mode berita memerlukan minimal tiga catatan fakta substantif dengan nama sumber dan URL HTTPS publik.');
  return { version: 1, mode, facts };
}

function renderOriginalReview() {
  if (!activeDraft) return;
  const mode = activeDraft.editorial_mode;
  document.getElementById('editor-editorial-mode').textContent = `Mode naskah: ${mode === 'current' ? 'Current — fakta beratribusi' : mode === 'explainer' ? 'Explainer — konteks dan analisis umum' : 'Draf lama — buat ulang untuk metadata editorial'}`;
  document.getElementById('editor-editorial-angle').textContent = `Sudut pandang: ${activeDraft.angle || 'Belum tersedia'}`;
  document.getElementById('editor-editorial-scope').textContent = `Batas cakupan: ${activeDraft.scope_note || 'Belum tersedia; periksa seluruh naskah dan sumber.'}`;
  const facts = activeDraft.editorial_input?.facts || [];
  const container = document.getElementById('editor-editorial-references');
  container.replaceChildren();
  if (!facts.length) container.textContent = 'Referensi fakta: tidak ada. Explainer membahas mekanisme umum; periksa agar naskah tidak menyatakan kejadian terbaru.';
  for (const fact of facts) {
    const item = document.createElement('p');
    item.textContent = `${fact.id}: ${fact.text} — ${fact.source_name}. `;
    try {
      const url = new URL(fact.source_url);
      if (url.protocol === 'https:' && !url.username && !url.password) {
        const link = document.createElement('a');
        link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = url.href;
        item.append(link);
      }
    } catch { /* Invalid historical references remain plain text. */ }
    if (fact.quote) item.append(` Kutipan: ${fact.quote.text} — ${fact.quote.speaker}`);
    container.append(item);
  }
  const references = activeDraft.editorial_references;
  if (references) {
    const map = document.createElement('p');
    map.textContent = `Rujukan caption: ${(references.caption || []).map((block, index) => `paragraf ${index + 1} (${block.kind}): ${block.fact_ids?.join(', ') || 'konteks umum'}`).join('; ')}. Threads: ${references.threads?.join(', ') || 'konteks umum'}.`;
    container.append(map);
  }
  const articleReview = document.getElementById('editor-article-review');
  const articleBody = document.getElementById('editor-article-body');
  if (articleReview && articleBody) {
    const story = activeDraft.article_metadata;
    articleBody.replaceChildren();
    const metadata = document.getElementById('editor-article-metadata');
    if (metadata) metadata.replaceChildren();
    if (story?.editorial_version === 2) {
      if (metadata) {
        const add = (label, value) => { const row = document.createElement('p'); const strong = document.createElement('strong'); strong.textContent = `${label}: `; row.append(strong, document.createTextNode(value || '')); metadata.append(row); };
        add('SEO title', story.seo_title);
        add('Meta description', story.meta_description);
        if (story.takeaways?.length) add('Takeaways', story.takeaways.map((item) => item.text).join(' · '));
        if (story.entities?.length) add('Istilah/nama pertama', story.entities.map((item) => `${item.name} — ${item.expansion}`).join(' · '));
        if (story.pipeline?.status) add('Checkpoint', story.pipeline.status);
        if (story.legal_context?.status) add('Rujukan O-Crawler', story.legal_context.status);
        if (story.threads_posts?.length) for (const post of story.threads_posts) add(`Threads ${post.no}`, post.text);
      }
      const headline = document.createElement('h3'); headline.textContent = story.headline; articleBody.append(headline);
      const lead = document.createElement('p'); lead.textContent = story.lead?.text || ''; articleBody.append(lead);
      for (const section of story.sections || []) {
        const heading = document.createElement('h4'); heading.textContent = section.heading; articleBody.append(heading);
        for (const paragraph of section.paragraphs || []) { const p = document.createElement('p'); p.textContent = paragraph.text; articleBody.append(p); }
      }
    } else {
      if (metadata) metadata.textContent = 'Metadata SEO dan struktur artikel v2 belum tersedia pada draf lama.';
      articleBody.textContent = activeDraft.article_body || 'Artikel lengkap belum tersedia untuk draf lama.';
    }
    articleReview.style.display = activeDraft.article_body ? '' : 'none';
    const bibliography = document.getElementById('editor-article-references');
    if (bibliography) {
      bibliography.replaceChildren();
      const articleIds = new Set(activeDraft.article_references || activeDraft.editorial_references?.article || []);
      const seenSources = new Set();
      for (const fact of facts.filter((item) => articleIds.has(item.id))) {
        let sourceUrl;
        try { const url = new URL(fact.source_url); if (url.protocol !== 'https:' || url.username || url.password) continue; url.hash = ''; sourceUrl = url.toString(); } catch { continue; }
        if (seenSources.has(sourceUrl)) continue;
        seenSources.add(sourceUrl);
        const row = document.createElement('p');
        const link = document.createElement('a');
        link.href = sourceUrl; link.target = '_blank'; link.rel = 'noopener noreferrer';
        link.textContent = `${fact.source_name} · ${fact.source_url}`;
        row.append(link); bibliography.append(row);
      }
    }
  }
  document.getElementById('editor-regenerate-mode').value = mode || 'current';
  document.getElementById('editor-regenerate-facts').value = JSON.stringify(facts, null, 2);
}

function collectAgentConfigPayload() {
  return {
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
        model: document.getElementById('analis-model')?.value || 'gemini-3.8-flash',
        min_score_threshold: parseInt(document.getElementById('analis-threshold')?.value || '76'),
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
        model: document.getElementById('copywriter-model')?.value || 'gemini-3.8-flash',
        slide_count: parseInt(document.getElementById('copywriter-slides-count')?.value || '6'),
        tone_of_voice: document.getElementById('copywriter-tone')?.value || '',
        banned_words: document.getElementById('copywriter-banned-words')?.value || '',
        system_prompt: document.getElementById('copywriter-prompt')?.value || '',
        disclaimer_financial: document.getElementById('copywriter-disclaimer-fin')?.value || '',
        disclaimer_legal: document.getElementById('copywriter-disclaimer-legal')?.value || '',
      },
      designer: {
        provider: document.getElementById('designer-provider')?.value || 'gemini',
        endpoint: document.getElementById('designer-endpoint')?.value || 'https://generativelanguage.googleapis.com',
        api_key: document.getElementById('designer-api-key')?.value || '',
        model: document.getElementById('designer-model')?.value || 'gemini-3.8-flash',
        image_generation: {
          enabled: document.getElementById('designer-image-enabled')?.checked === true,
          provider: document.getElementById('designer-image-provider')?.value ?? 'gemini',
          model: document.getElementById('designer-image-model')?.value.trim() ?? 'gemini-3.1-flash-lite-image',
          rights_reference: document.getElementById('designer-image-rights-reference')?.value.trim() ?? 'https://ai.google.dev/gemini-api/terms',
          timeout_ms: Number(document.getElementById('designer-image-timeout')?.value ?? 90000),
        },
        system_prompt: document.getElementById('designer-prompt')?.value || '',
        tokens: { palette: Object.fromEntries(['bg', 'ink', 'accent', 'highlight', 'up', 'down'].map((key) => [key, document.getElementById(`color-${key}-hex`)?.value || ''])), typography: {
          display_font: document.getElementById('designer-display-font')?.value || 'Archivo Black',
          text_font: document.getElementById('designer-text-font')?.value || 'Inter',
        } },
        default_layouts: {
          cover: document.getElementById('layout-cover')?.value || 'cover-focus',
          context: document.getElementById('layout-context')?.value || 'big-statement',
          evidence_data: document.getElementById('layout-data')?.value || 'chart-bar',
          implication: document.getElementById('layout-implication')?.value || 'comparison',
          close: document.getElementById('layout-close')?.value || 'cta-close',
        },
        auto_fit_text: document.getElementById('designer-autofit')?.checked !== false,
      },
      seo: {
        provider: document.getElementById('seo-provider')?.value || 'gemini',
        endpoint: document.getElementById('seo-endpoint')?.value || 'https://generativelanguage.googleapis.com',
        api_key: document.getElementById('seo-api-key')?.value || '',
        model: document.getElementById('seo-model')?.value || 'gemini-3.8-flash',
        min_virality_score: parseInt(document.getElementById('seo-min-virality')?.value || '55'),
        system_prompt: document.getElementById('seo-prompt')?.value || '',
      },
      studio: {
        ...window.gapuraAgentStudioConfig,
        provider: document.getElementById('studio-agent-provider')?.value || 'gemini',
        endpoint: document.getElementById('studio-agent-endpoint')?.value || 'https://generativelanguage.googleapis.com',
        model: document.getElementById('studio-agent-model')?.value || 'gemini-3.8-flash',
        api_key: document.getElementById('studio-agent-key')?.value || '',
        system_prompt: document.getElementById('studio-agent-prompt')?.value || '',
      },
      skills: {
        scout: document.getElementById('scout-skills-md')?.value || '',
        analis: document.getElementById('analis-skills-md')?.value || '',
        copywriter: document.getElementById('copywriter-skills-md')?.value || '',
        designer: document.getElementById('designer-skills-md')?.value || '',
        seo: document.getElementById('seo-skills-md')?.value || '',
        studio: document.getElementById('studio-agent-skills')?.value || '',
      },
  };
}

window.gapuraAgentStudioConfig = { provider: 'gemini', endpoint: 'https://generativelanguage.googleapis.com', model: 'gemini-3.8-flash', api_key: '' };

// 1. Inisialisasi & Navigasi
document.addEventListener('DOMContentLoaded', () => {
  Promise.all([import('./navigation.js'), import('./icon-map.js')])
    .then(([navigation]) => {
      createNavigationController = navigation.createNavigationController;
      initializeApp();
    })
    .catch((error) => showToast(`Dashboard gagal memuat aset UI: ${error.message}`));
});

function initializeApp() {
  appNavigation = createNavigationController({
    window,
    onNavigate: renderRoute,
  });
  appNavigation.initialize();
  setupNavigation();
  loadStats();
  loadDrafts();
  loadActivityFeed();
  setInterval(() => { loadStats(); loadActivityFeed(); }, 15000);
}

function setupNavigation() {
  bindClick('btn-use-topic-illustration', useTopicIllustrationForDraft);
  bindClick('btn-upload-manual-media', uploadManualMedia);
  bindClick('btn-attach-manual-media', () => { if (pendingManualAsset) attachManualMedia(pendingManualAsset.id); });
  const manualAssets = document.getElementById('editor-media-assets');
  if (manualAssets) {
    manualAssets.addEventListener('click', (event) => {
      const assetId = event.target.closest('[data-attach-asset]')?.dataset.attachAsset;
      if (assetId) attachManualMedia(assetId);
    });
  }
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
      const viewId = item.dataset.view;
      appNavigation.navigate({ view: viewId });
      if (sidebar) sidebar.classList.remove('mobile-open');
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
  const testAgentButton = document.getElementById('btn-test-agent-config');
  if (testAgentButton) testAgentButton.onclick = testAgentSettings;

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
      currentTopicOffset = 0;
      loadTopics();
    };
  });

  const topicSearch = document.getElementById('topic-search');
  let topicSearchTimer;
  if (topicSearch) topicSearch.addEventListener('input', () => {
    clearTimeout(topicSearchTimer);
    topicSearchTimer = setTimeout(() => { currentTopicOffset = 0; loadTopics(); }, 220);
  });
  const topicSort = document.getElementById('topic-sort');
  if (topicSort) topicSort.onchange = () => { currentTopicOffset = 0; loadTopics(); };
  const topicDesk = document.getElementById('topic-desk');
  if (topicDesk) topicDesk.onchange = () => { currentTopicOffset = 0; loadTopics(); };
  const loadMore = document.getElementById('btn-topics-load-more');
  if (loadMore) loadMore.onclick = () => loadTopics({ append: true });

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
  bindClick('btn-slide-prev', () => navigateSlide(-1));
  bindClick('btn-slide-next', () => navigateSlide(1));

  // Editor Actions
  bindClick('btn-save-and-rerender', saveAndRerenderSlide);
  bindClick('btn-save-text-only', saveTextOnly);
  bindClick('btn-copy-caption-full', copyFullCaption);
  bindClick('btn-download-all-slides', downloadAllSlides);
  bindClick('btn-open-single-slide', openCurrentSlideFull);
  document.getElementById('review-editor-subview')?.addEventListener('input', (event) => {
    if (event.target.matches('input:not([type="checkbox"]), textarea, select')) invalidateDraftReview();
  });

  const regenBtn = document.getElementById('btn-action-regenerate-ai');
  if (regenBtn) regenBtn.onclick = regenerateActiveDraftAI;

  const editorSlideText = document.getElementById('editor-input-slide-text');
  if (editorSlideText) {
    editorSlideText.addEventListener('input', triggerEditorLivePreview);
  }

  // Slide Layout Selector & Slide Manager
  const layoutSelect = document.getElementById('editor-select-layout');
  const customLayoutInput = document.getElementById('editor-custom-layout-input');
  if (layoutSelect) {
    layoutSelect.onchange = () => {
      const isCustom = layoutSelect.value === 'custom';
      if (customLayoutInput) {
        customLayoutInput.style.display = isCustom ? 'block' : 'none';
        if (isCustom) customLayoutInput.focus();
      }
      const l = isCustom ? (customLayoutInput?.value?.trim() || 'cover-editorial') : layoutSelect.value;
      document.getElementById('editor-layout-name').textContent = l;
      const currentSlide = (activeDraft?.rendered_slides || [])[activeSlideIndex] || {};
      renderLayoutFields(l, currentSlide.data || {});
      triggerEditorLivePreview();
    };
  }
  if (customLayoutInput) {
    customLayoutInput.addEventListener('input', () => {
      document.getElementById('editor-layout-name').textContent = customLayoutInput.value || 'custom';
      triggerEditorLivePreview();
    });
  }
  const addSlideBtn = document.getElementById('btn-add-slide-editor');
  if (addSlideBtn) addSlideBtn.onclick = addSlideToDraft;
  const delSlideBtn = document.getElementById('btn-del-slide-editor');
  if (delSlideBtn) delSlideBtn.onclick = deleteSlideFromDraft;

  // Decision Buttons in Editor
  bindClick('btn-action-post-now', () => approveCurrentDraft('auto'));
  bindClick('btn-action-approve-auto', () => approveCurrentDraft('auto'));
  bindClick('btn-action-approve-manual', () => approveCurrentDraft('manual'));
  bindClick('btn-action-reject', rejectCurrentDraft);

  // n8n Controls
  if (document.getElementById('btn-toggle-wf-dark')) document.getElementById('btn-toggle-wf-dark').onclick = toggleWorkflowState;
  if (document.getElementById('btn-copy-wf-json-dark')) document.getElementById('btn-copy-wf-json-dark').onclick = copyWorkflowJson;

  // Tokens Save (Fallback / Legacy)
  if (document.getElementById('btn-save-tokens-dark')) document.getElementById('btn-save-tokens-dark').onclick = saveTokensYaml;

  // Agen SEO — Radar Trending Controls
  if (document.getElementById('btn-seo-scan-now')) document.getElementById('btn-seo-scan-now').onclick = runSeoScanNow;
  bindClick('btn-refresh-trends', async () => { await Promise.all([loadTrends(), loadTrendSources()]); });
  if (document.getElementById('btn-save-trend-source')) document.getElementById('btn-save-trend-source').onclick = saveTrendSource;
  if (document.getElementById('btn-reset-trend-source')) document.getElementById('btn-reset-trend-source').onclick = resetTrendSourceForm;

  document.querySelectorAll('.btn-trend-filter').forEach((btn) => {
    btn.onclick = () => {
      document.querySelectorAll('.btn-trend-filter').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      activeTrendPlatform = btn.dataset.platform || '';
      loadTrends();
    };
  });

  // Studio Prompt Controls
  bindClick('btn-studio-submit', submitStudioPrompt);
  bindClick('btn-studio-refresh', loadStudioJobs);

  // Badge ringkas di sidebar (trending)
  refreshSeoBadges();
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

    // Update Sources Count in Sidebar
    const sRes = await fetch('/api/sources').catch(() => null);
    if (sRes && sRes.ok) {
      const sources = await sRes.json();
      const activeCount = sources.filter((s) => s.is_active).length;
      const sBadge = document.getElementById('sidebar-sources-badge');
      if (sBadge) sBadge.textContent = activeCount;
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
  appNavigation.navigate({ view: 'view-review', draftId: Number(draftId) });
}

function renderDraftEditor(draft) {
  activeDraft = draft;
  activeSlideIndex = 0;
  pendingManualAsset = null;
  manualAssetCache = { topicId: null, assets: [], loaded: false, loading: false };
  const mediaFile = document.getElementById('editor-media-file');
  if (mediaFile) mediaFile.value = '';
  manualMediaStatus('');
  const reviewed = document.getElementById('editor-reviewed');
  if (reviewed) reviewed.checked = false;

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
  renderOriginalReview();
}

function invalidateDraftReview() {
  if (activeDraft) delete activeDraft.revision;
  const reviewed = document.getElementById('editor-reviewed');
  if (reviewed) reviewed.checked = false;
}

function showGalleryView() {
  document.getElementById('review-gallery-subview').style.display = 'block';
  document.getElementById('review-editor-subview').style.display = 'none';
  const route = appNavigation.current();
  if (route.view === 'view-review' && route.draftId) appNavigation.back({ view: 'view-review' });
  loadDrafts();
}

function triggerEditorLivePreview() {
  clearTimeout(editorLivePreviewDebounceTimer);
  editorLivePreviewDebounceTimer = setTimeout(() => {
    updateEditorLivePreview();
  }, 250);
}

async function updateEditorLivePreview() {
  if (!activeDraft) return;
  const currentSlide = (activeDraft.rendered_slides || [])[activeSlideIndex] || {};
  const layoutSelect = document.getElementById('editor-select-layout');
  const customLayoutInput = document.getElementById('editor-custom-layout-input');
  const isCustom = layoutSelect?.value === 'custom';
  const chosenLayout = isCustom ? (customLayoutInput?.value?.trim() || 'cover-editorial') : (layoutSelect?.value || currentSlide.layout || 'cover-stat');
  const newText = document.getElementById('editor-input-slide-text')?.value || '';
  const compiledData = getCompiledLayoutData(chosenLayout, currentSlide.data || {});

  const indicator = document.getElementById('editor-render-indicator');
  if (indicator) indicator.style.display = 'block';

  try {
    const slidePayload = {
      no: activeSlideIndex + 1,
      layout: chosenLayout,
      teks: newText,
      data: compiledData,
      source: activeDraft.primary_source || '@gapuramedia',
    };

    const res = await fetch('/api/render/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slide: slidePayload,
        slide_no: activeSlideIndex + 1,
        total_slides: (activeDraft.rendered_slides || []).length || 5,
      }),
    });

    if (res.ok) {
      const blob = await res.blob();
      const mainImg = document.getElementById('editor-main-slide-img');
      if (mainImg) {
        if (mainImg.dataset.objectUrl) {
          URL.revokeObjectURL(mainImg.dataset.objectUrl);
        }
        const objUrl = URL.createObjectURL(blob);
        mainImg.src = objUrl;
        mainImg.dataset.objectUrl = objUrl;
      }
    }
  } catch (err) {
    console.warn('Live preview render error:', err);
  } finally {
    if (indicator) indicator.style.display = 'none';
  }
}

async function regenerateActiveDraftAI() {
  if (!activeDraft) return;
  invalidateDraftReview();

  const btn = document.getElementById('btn-action-regenerate-ai');
  const originalHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '⚡ Merancang Ulang via AI...';
  }

  showToast(`⚡ AI Designer sedang merancang ulang draf #${activeDraft.id}...`);

  try {
    const editorial_input = readEditorialInput('editor-regenerate-mode', 'editor-regenerate-facts', { allowEmptyCurrent: true });
    const res = await fetch(`/api/drafts/${activeDraft.id}/regenerate-ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ editorial_input }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    const data = await res.json();

    const { status, ...content } = data;
    Object.assign(activeDraft, content, { status: 'draft' });
    // Map with fresh cache bust
    activeDraft.rendered_slides = (data.rendered_slides || []).map((s) => ({
      ...s,
      image_url: `${(s.image_url || '').split('?')[0]}?t=${Date.now()}_${Math.random().toString(36).substring(7)}`,
    }));
    activeSlideIndex = 0;

    await loadDrafts();

    document.getElementById('editor-input-caption').value = activeDraft.caption || '';
    document.getElementById('editor-input-hashtags').value = (activeDraft.hashtags || []).join(' ');
    renderActiveSlide();
    renderThumbnailsStrip();
    renderOriginalReview();

    showToast(`✨ Sukses merancang ulang draf #${activeDraft.id}! Seluruh slide diperbarui (${activeDraft.rendered_slides.length} slide).`);
  } catch (err) {
    console.error('Error regenerateActiveDraftAI:', err);
    showToast(`Gagal merancang ulang: ${err.message}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  }
}

async function useTopicIllustrationForDraft() {
  if (!activeDraft?.topic_id) return;
  const button = document.getElementById('btn-use-topic-illustration');
  button.disabled = true;
  try {
    const response = await fetch(`/api/topics/${encodeURIComponent(activeDraft.topic_id)}/illustration`);
    const packet = await response.json();
    if (!response.ok || !packet.selected || packet.selected.status !== 'ready') throw new Error(packet.error || 'Buat ilustrasi topik di Radar terlebih dahulu.');
    const save = await fetch(`/api/drafts/${activeDraft.id}/illustration`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ asset_id: packet.selected.id }) });
    const result = await save.json();
    if (!save.ok) throw new Error(result.error || 'Ilustrasi gagal diterapkan.');
    invalidateDraftReview();
    const fresh = await fetch(`/api/drafts/${activeDraft.id}`).then((res) => res.json());
    activeDraft = fresh;
    activeSlideIndex = 0;
    renderActiveSlide();
    renderThumbnailsStrip();
    showToast('Ilustrasi diperbarui. Tinjau kembali isi dan seluruh slide.');
  } finally { button.disabled = false; }
}

const MANUAL_RIGHTS_LABELS = { own_work: 'Karya sendiri', licensed_stock: 'Lisensi stok', agency_license: 'Lisensi agensi' };
const MANUAL_IMAGE_KINDS = ['ai_generated', 'editor_upload'];

function readManualFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Berkas tidak dapat dibaca.'));
    reader.readAsDataURL(file);
  });
}

function manualMediaStatus(message) {
  const status = document.getElementById('editor-media-status');
  if (status) status.textContent = message;
}

function renderManualAssetList() {
  const container = document.getElementById('editor-media-assets');
  if (!container) return;
  if (!manualAssetCache.loaded && !manualAssetCache.assets.length) {
    container.innerHTML = '<p class="form-help-text">Memuat aset gambar topik...</p>';
    return;
  }
  if (!manualAssetCache.assets.length) {
    container.innerHTML = '<p class="form-help-text">Belum ada gambar manual untuk topik ini.</p>';
    return;
  }
  container.innerHTML = `
    <div style="display: flex; gap: 10px; flex-wrap: wrap;">
      ${manualAssetCache.assets.map((asset) => `
        <figure style="margin: 0; width: 132px;">
          <img src="${escapeHtml(asset.url)}" alt="Gambar manual: ${escapeHtml(asset.credit)}" loading="lazy" style="display: block; width: 132px; height: 99px; object-fit: cover; border-radius: 6px; border: 1px solid var(--border);">
          <figcaption style="color: var(--muted); font-size: 11px; margin-top: 4px; overflow-wrap: anywhere;">${escapeHtml(asset.credit)} · ${escapeHtml(MANUAL_RIGHTS_LABELS[asset.rights_basis] || asset.rights_basis)}</figcaption>
          <button type="button" class="btn btn-outline" data-attach-asset="${escapeHtml(asset.id)}" style="margin-top: 4px; padding: 2px 8px; font-size: 11px;">Pasang</button>
        </figure>`).join('')}
    </div>`;
}

async function loadTopicManualAssets() {
  const topicId = activeDraft?.topic_id;
  if (!topicId || manualAssetCache.loading) return;
  manualAssetCache.loading = true;
  try {
    const response = await fetch(`/api/topics/${encodeURIComponent(topicId)}/media`);
    const packet = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(packet.error || `HTTP ${response.status}`);
    if (manualAssetCache.topicId !== topicId) return;
    manualAssetCache.assets = Array.isArray(packet.assets) ? packet.assets : [];
    manualAssetCache.loaded = true;
  } catch (error) {
    if (manualAssetCache.topicId === topicId) {
      manualAssetCache.loaded = true;
      const container = document.getElementById('editor-media-assets');
      if (container) container.innerHTML = `<p class="form-help-text">Gagal memuat aset gambar: ${escapeHtml(error.message)}</p>`;
      return;
    }
  } finally {
    if (manualAssetCache.topicId === topicId) manualAssetCache.loading = false;
  }
  renderManualAssetList();
}

function renderManualMediaPanel() {
  if (!activeDraft) return;
  const topicId = activeDraft.topic_id;
  if (!topicId) return;
  if (manualAssetCache.topicId !== topicId) {
    manualAssetCache = { topicId, assets: [], loaded: false, loading: false };
  }
  const target = document.getElementById('editor-media-target');
  if (target) target.textContent = String(activeSlideIndex + 1);
  const selected = document.getElementById('editor-media-selected');
  if (selected) {
    selected.innerHTML = pendingManualAsset
      ? `<div style="display: flex; gap: 10px; align-items: center; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 8px;">
          <img src="${escapeHtml(pendingManualAsset.url)}" alt="Gambar terunggah" style="width: 64px; height: 48px; object-fit: cover; border-radius: 4px;">
          <div style="font-size: 12px; color: var(--muted); overflow-wrap: anywhere;">Siap dipasang: ${escapeHtml(pendingManualAsset.credit)} · ${escapeHtml(MANUAL_RIGHTS_LABELS[pendingManualAsset.rights_basis] || pendingManualAsset.rights_basis)}</div>
        </div>`
      : '';
  }
  const attach = document.getElementById('btn-attach-manual-media');
  if (attach) attach.disabled = !pendingManualAsset;
  const cover = (activeDraft.slides || [])[0]?.data || {};
  const coverReady = (Boolean(cover.asset_id) && MANUAL_IMAGE_KINDS.includes(cover.image_kind)) || cover.cover_mode === 'typography';
  const coverStatus = document.getElementById('editor-cover-status');
  if (coverStatus) {
    coverStatus.textContent = coverReady ? 'Cover siap' : 'Cover belum bergambar';
    coverStatus.classList.toggle('active', coverReady);
  }
  if (!manualAssetCache.loaded && !manualAssetCache.loading) loadTopicManualAssets();
  else renderManualAssetList();
}

async function uploadManualMedia() {
  if (!activeDraft?.topic_id) return;
  const fileInput = document.getElementById('editor-media-file');
  const file = fileInput?.files?.[0];
  const credit = (document.getElementById('editor-media-credit')?.value || '').trim();
  const rightsBasis = document.getElementById('editor-media-rights')?.value || '';
  const rightsReference = (document.getElementById('editor-media-reference')?.value || '').trim();
  const attested = document.getElementById('editor-media-attested')?.checked === true;
  if (!file) { showToast('Pilih berkas gambar terlebih dahulu.'); return; }
  if (file.size > 12 * 1024 * 1024) { showToast('Gambar melebihi batas 12 MB sebelum diproses.'); return; }
  if (!credit) { showToast('Credit gambar wajib diisi.'); return; }
  if (!attested) { showToast('Atestasi hak wajib disetujui sebelum mengunggah.'); return; }
  const button = document.getElementById('btn-upload-manual-media');
  if (button) button.disabled = true;
  manualMediaStatus('Mengunggah dan memproses gambar...');
  try {
    const dataUri = await readManualFileAsDataUrl(file);
    const body = { filename: file.name, data_uri: dataUri, credit, rights_basis: rightsBasis, rights_attested: true };
    if (rightsReference) body.rights_reference = rightsReference;
    const response = await fetch(`/api/topics/${encodeURIComponent(activeDraft.topic_id)}/media`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const packet = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(packet.error || `HTTP ${response.status}`);
    pendingManualAsset = packet.asset;
    if (fileInput) fileInput.value = '';
    manualAssetCache.assets = [packet.asset, ...manualAssetCache.assets.filter((asset) => asset.id !== packet.asset.id)];
    renderManualMediaPanel();
    manualMediaStatus(`Gambar ${packet.asset.width}×${packet.asset.height} siap. Tekan "Pasang ke slide ${activeSlideIndex + 1}".`);
    showToast('Gambar diunggah. Pasang ke slide lalu tinjau ulang.');
  } catch (error) {
    manualMediaStatus('');
    showToast(`Gagal mengunggah gambar: ${error.message}`);
  } finally {
    if (button) button.disabled = false;
  }
}

async function attachManualMedia(assetId) {
  if (!activeDraft) return;
  const slideNo = activeSlideIndex + 1;
  const button = document.getElementById('btn-attach-manual-media');
  if (button) button.disabled = true;
  manualMediaStatus(`Memasang gambar ke slide ${slideNo}...`);
  try {
    const response = await fetch(`/api/drafts/${activeDraft.id}/slide-media`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slide_no: slideNo, asset_id: assetId }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    invalidateDraftReview();
    const fresh = await fetch(`/api/drafts/${activeDraft.id}`).then((res) => res.json());
    activeDraft = fresh;
    pendingManualAsset = null;
    renderActiveSlide();
    renderThumbnailsStrip();
    renderOriginalReview();
    manualMediaStatus(`Gambar terpasang di slide ${slideNo}. Tinjau ulang sebelum menyetujui.`);
    showToast(`Gambar dipasang ke slide ${slideNo}.`);
  } catch (error) {
    manualMediaStatus('');
    showToast(`Gagal memasang gambar: ${error.message}`);
  } finally {
    if (button) button.disabled = !pendingManualAsset;
  }
}

function renderActiveSlide() {
  if (!activeDraft) return;
  const slides = activeDraft.rendered_slides || [];
  const currentSlide = slides[activeSlideIndex] || {};

  const mainImg = document.getElementById('editor-main-slide-img');
  if (mainImg) {
    if (mainImg.dataset.objectUrl) {
      URL.revokeObjectURL(mainImg.dataset.objectUrl);
      mainImg.dataset.objectUrl = '';
    }
    const cleanUrl = (currentSlide.image_url || '').split('?')[0];
    mainImg.src = cleanUrl ? `${cleanUrl}?t=${Date.now()}_${Math.random().toString(36).substring(7)}` : '';
  }

  document.getElementById('editor-slide-heading').textContent = `Slide ${activeSlideIndex + 1} dari ${slides.length}`;
  const layout = currentSlide.layout || 'cover-stat';
  document.getElementById('editor-layout-name').textContent = layout;

  const layoutSelect = document.getElementById('editor-select-layout');
  const customLayoutInput = document.getElementById('editor-custom-layout-input');
  if (layoutSelect) {
    const exists = Array.from(layoutSelect.options).some((o) => o.value === layout);
    if (exists) {
      layoutSelect.value = layout;
      if (customLayoutInput) customLayoutInput.style.display = 'none';
    } else {
      layoutSelect.value = 'custom';
      if (customLayoutInput) {
        customLayoutInput.style.display = 'block';
        customLayoutInput.value = layout;
      }
    }
  }

  document.getElementById('editor-input-slide-text').value = currentSlide.text || '';

  // Render dynamic custom layout parameter fields
  renderLayoutFields(layout, currentSlide.data || {});
  renderManualMediaPanel();

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

  if (layout.startsWith('editorial-')) {
    html = `<div class="form-group-editor"><label class="form-label-editor">Headline slide</label><input type="text" id="lf-story-title" class="form-input-dark" maxlength="120" value="${escapeHtml(data.title || '')}"></div>
      <div class="form-group-editor"><label class="form-label-editor">Kicker / label fungsi</label><input type="text" id="lf-story-kicker" class="form-input-dark" maxlength="40" value="${escapeHtml(data.kicker || '')}"></div>`;
    if (layout === 'editorial-close') html += `<div class="form-group-editor"><label class="form-label-editor">Pertanyaan pembaca</label><input id="lf-story-question" class="form-input-dark" value="${escapeHtml(data.question || '')}"></div><div class="form-group-editor"><label class="form-label-editor">Ajakan singkat</label><input id="lf-story-cta" class="form-input-dark" value="${escapeHtml(data.cta || '')}"></div>`;
    if (layout === 'editorial-breakdown' || layout === 'editorial-timeline') html += `<div class="form-group-editor"><label class="form-label-editor">${layout === 'editorial-breakdown' ? 'Kartu rincian' : 'Peristiwa dan tanggal'} (JSON)</label><textarea id="lf-story-collection" class="form-input-dark" rows="6">${escapeHtml(JSON.stringify(layout === 'editorial-breakdown' ? data.items || [] : data.events || [], null, 2))}</textarea></div>`;
    if (layout === 'editorial-quote') html += ['quote', 'author', 'role_label'].map((key) => `<div class="form-group-editor"><label class="form-label-editor">${escapeHtml(key === 'quote' ? 'Kutipan terverifikasi' : key === 'author' ? 'Nama narasumber' : 'Jabatan / kapasitas')}</label><input id="lf-story-${key}" class="form-input-dark" value="${escapeHtml(data[key] || '')}"></div>`).join('');
  } else if (layout === 'cover-stat') {
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
    const items = data.items || [];
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
    const left = data.left || { title: '', text: '' };
    const right = data.right || { title: '', text: '' };
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
    const events = data.events || [];
    html = `
      <div style="font-size: 11px; font-weight: 700; color: var(--lime); margin-bottom: 10px; text-transform: uppercase;">
        ⚙️ Parameter Layout: Timeline (Tahapan Kronologis)
      </div>
      <div class="form-group-editor" style="margin-bottom: 8px;">
        <label class="form-label-editor">Tahap 1 (Waktu & Keterangan)</label>
        <div style="display: flex; gap: 6px;">
          <input type="text" id="lf-time-d0" class="form-input-dark" style="width: 30%;" value="${escapeHtml(events[0]?.date || '')}" placeholder="Tanggal sumber">
          <input type="text" id="lf-time-t0" class="form-input-dark" style="width: 70%;" value="${escapeHtml(events[0]?.text || '')}">
        </div>
      </div>
      <div class="form-group-editor" style="margin-bottom: 8px;">
        <label class="form-label-editor">Tahap 2 (Waktu & Keterangan)</label>
        <div style="display: flex; gap: 6px;">
          <input type="text" id="lf-time-d1" class="form-input-dark" style="width: 30%;" value="${escapeHtml(events[1]?.date || '')}" placeholder="Tanggal sumber">
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
        <input type="text" id="lf-cta-text" class="form-input-dark" value="${escapeHtml(data.cta || '')}" placeholder="Opsional sesuai naskah">
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
  } else {
    // Dynamic Fallback untuk Desain AI Bebas / Layout Kustom
    html = `
      <div style="font-size: 11px; font-weight: 700; color: var(--lime); margin-bottom: 10px; text-transform: uppercase;">
        ⚙️ Parameter Layout Bebas AI: ${escapeHtml(layout)}
      </div>
      <div class="form-grid-2col">
        <div class="form-group-editor" style="margin-bottom: 8px;">
          <label class="form-label-editor">Judul / Sub-topik Slide</label>
          <input type="text" id="lf-generic-title" class="form-input-dark" value="${escapeHtml(data.title || '')}" placeholder="Judul slide...">
        </div>
        <div class="form-group-editor" style="margin-bottom: 8px;">
          <label class="form-label-editor">Kategori / Keterangan Tag</label>
          <input type="text" id="lf-generic-category" class="form-input-dark" value="${escapeHtml(data.category || data.subtitle || '')}" placeholder="Kategori...">
        </div>
      </div>
      <div class="form-grid-2col">
        <div class="form-group-editor" style="margin-bottom: 8px;">
          <label class="form-label-editor">Highlight Nilai / Angka Hero (Opsional)</label>
          <input type="text" id="lf-generic-value" class="form-input-dark" value="${escapeHtml(data.value || '')}" placeholder="Contoh: +14.2% atau Rp 2 Triliun">
        </div>
        <div class="form-group-editor" style="margin-bottom: 8px;">
          <label class="form-label-editor">Kutipan / Callout / Catatan (Opsional)</label>
          <input type="text" id="lf-generic-quote" class="form-input-dark" value="${escapeHtml(data.quote || data.callout || data.author || '')}" placeholder="Kutipan atau poin regulasi...">
        </div>
      </div>
    `;
  }

  container.innerHTML = html;
  container.querySelectorAll('input, textarea').forEach((inputEl) => {
    inputEl.addEventListener('input', triggerEditorLivePreview);
  });
}

function getCompiledLayoutData(layout, existingData = {}) {
  const data = { ...existingData };
  if (layout.startsWith('editorial-')) {
    for (const key of ['title', 'kicker', 'question', 'cta', 'quote', 'author', 'role_label']) {
      const input = document.getElementById(`lf-story-${key}`);
      if (input) data[key] = input.value;
    }
    const collection = document.getElementById('lf-story-collection');
    if (collection) {
      const parsed = JSON.parse(collection.value);
      if (!Array.isArray(parsed)) throw new Error('Rincian layout harus berupa JSON array.');
      data[layout === 'editorial-breakdown' ? 'items' : 'events'] = parsed;
    }
    return data;
  }

  // Generic AI Layout Parameters
  if (document.getElementById('lf-generic-title')) {
    data.title = document.getElementById('lf-generic-title').value;
  }
  if (document.getElementById('lf-generic-category')) {
    data.category = document.getElementById('lf-generic-category').value;
  }
  if (document.getElementById('lf-generic-value')) {
    data.value = document.getElementById('lf-generic-value').value;
  }
  if (document.getElementById('lf-generic-quote')) {
    data.quote = document.getElementById('lf-generic-quote').value;
    data.callout = document.getElementById('lf-generic-quote').value;
  }

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
    data.items = items;
  } else if (layout === 'regulasi') {
    data.title = document.getElementById('lf-regulasi-title')?.value || data.title || 'REGULASI RESMI';
    data.category = 'HUKUM & REGULASI';
  } else if (layout === 'comparison') {
    data.left = {
      title: document.getElementById('lf-comp-lt')?.value || '',
      text: document.getElementById('lf-comp-lx')?.value || '',
    };
    data.right = {
      title: document.getElementById('lf-comp-rt')?.value || '',
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
    data.events = events;
  } else if (layout === 'cta-close') {
    data.cta = document.getElementById('lf-cta-text')?.value ?? data.cta ?? '';
    data.disclaimer = document.getElementById('lf-cta-disclaimer')?.value ?? data.disclaimer ?? '';
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

    const cleanUrl = (s.image_url || '').split('?')[0];
    const cacheBuster = `t=${Date.now()}_${idx}_${Math.random().toString(36).substring(7)}`;
    box.innerHTML = `
      <img src="${cleanUrl ? `${cleanUrl}?${cacheBuster}` : ''}" alt="Slide ${idx + 1}">
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
  invalidateDraftReview();
  const slideNo = activeSlideIndex + 1;
  const newText = document.getElementById('editor-input-slide-text').value;

  let chosenLayout = document.getElementById('editor-select-layout').value;
  if (chosenLayout === 'custom') {
    const customInput = document.getElementById('editor-custom-layout-input');
    chosenLayout = (customInput && customInput.value.trim()) || 'custom';
  }

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
        activeDraft.rendered_slides[activeSlideIndex].image_url = result.image_url;
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
  if ((activeDraft.rendered_slides || []).length >= 9) { showToast('Carousel maksimal memiliki 9 slide.'); return; }
  const confirmAdd = confirm('Tambah slide baru di akhir carousel ini?');
  if (!confirmAdd) return;
  invalidateDraftReview();

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
    if (!res.ok) { const error = await res.json().catch(() => ({})); throw new Error(error.error || `HTTP ${res.status}`); }
    if (res.ok) {
      const result = await res.json();
      showToast(`Slide #${result.new_slide_no} berhasil ditambahkan!`);
      await loadDrafts();
      activeDraft = { ...currentDrafts.find((d) => d.id === activeDraft.id), revision: null };
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
  const minimum = activeDraft.editorial_mode || activeDraft.editorial_input ? 3 : 1;
  if (slides.length <= minimum) {
    showToast(`Draf ${minimum === 3 ? 'editorial R6' : 'lama'} minimal harus memiliki ${minimum} slide.`);
    return;
  }
  const slideNo = activeSlideIndex + 1;
  const confirmDel = confirm(`Yakin ingin menghapus Slide #${slideNo}?`);
  if (!confirmDel) return;
  invalidateDraftReview();

  try {
    const res = await fetch(`/api/drafts/${activeDraft.id}/delete-slide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slide_no: slideNo }),
    });
    if (!res.ok) { const error = await res.json().catch(() => ({})); throw new Error(error.error || `HTTP ${res.status}`); }
    if (res.ok) {
      showToast(`Slide #${slideNo} berhasil dihapus.`);
      await loadDrafts();
      activeDraft = { ...currentDrafts.find((d) => d.id === activeDraft.id), revision: null };
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
  invalidateDraftReview();
  const newCaption = document.getElementById('editor-input-caption').value;
  try {
    const res = await fetch(`/api/drafts/${activeDraft.id}/update-full`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ caption: newCaption }),
    });
    if (!res.ok) { const error = await res.json().catch(() => ({})); throw new Error(error.error || `HTTP ${res.status}`); }
    if (res.ok) {
      activeDraft.caption = newCaption;
      if (activeDraft.editorial_mode) {
        activeDraft.caption_body = newCaption;
        activeDraft.editorial_references = { ...activeDraft.editorial_references, caption: [] };
        renderOriginalReview();
      }
      showToast('Teks caption berhasil disimpan!');
    }
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}

function copyFullCaption() {
  if (!activeDraft) return;
  const caption = document.getElementById('editor-input-caption').value;
  const hashtags = document.getElementById('editor-input-hashtags').value.split(/\s+/).filter((tag) => tag && !caption.includes(tag));
  const fullText = `${caption}${hashtags.length ? `\n\n${hashtags.join(' ')}` : ''}`;
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
  const link = document.createElement('a');
  link.href = `/api/drafts/${activeDraft.id}/export`;
  link.download = `Gapura_Draft_${activeDraft.id}.zip`;
  link.click();
  showToast('Mengunduh paket gambar dan caption.');
}

async function approveCurrentDraft(mode) {
  if (!activeDraft) return;
  if (!activeDraft.revision) {
    showToast('Muat ulang halaman atau buka ulang draf dari galeri, lalu tinjau konten terbaru sebelum menyetujui.');
    return;
  }
  try {
    const res = await fetch(`/api/drafts/${activeDraft.id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, reviewed: document.getElementById('editor-reviewed')?.checked === true, expected_revision: activeDraft.revision }),
    });
    if (res.ok) {
      await res.json().catch(() => ({}));
      showToast(mode === 'auto'
        ? `Draf #${activeDraft.id} lolos gate dan telah dijadwalkan.`
        : `Draf #${activeDraft.id} ditandai sudah terbit secara manual.`);
      showGalleryView();
    } else {
      const result = await res.json().catch(() => ({}));
      throw new Error(result.error || `HTTP ${res.status}`);
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
    const params = new URLSearchParams({
      limit: '40', offset: String(currentTopicOffset),
      sort: document.getElementById('topic-sort')?.value || 'newest',
      q: document.getElementById('topic-search')?.value?.trim() || '',
    });
    if (currentTopicStatus) params.set('status', currentTopicStatus);
    const desk = document.getElementById('topic-desk')?.value;
    if (desk) params.set('desk', desk);
    const url = `/api/topics?${params.toString()}`;
    const res = await fetch(url);
    if (!res.ok) return;
    const topics = await res.json();
    topicHasMore = res.headers.get('X-Has-More') === 'true';
    currentTopicOffset = Number.parseInt(res.headers.get('X-Next-Offset') || String(currentTopicOffset + topics.length), 10);
    cachedTopics = params.get('offset') === '0' ? topics : [...cachedTopics, ...topics];
    populateStudioTopics();
    populateStudioSourceTopics();

    const container = document.getElementById('radar-list-container');
    if (!container) return;
    if (params.get('offset') === '0') container.innerHTML = '';
    const loadMore = document.getElementById('btn-topics-load-more');
    if (loadMore) loadMore.hidden = !topicHasMore;

    if (topics.length === 0) {
      container.innerHTML = `<div style="padding: 40px; text-align: center; color: var(--muted); background: var(--card-bg); border-radius: 10px;">Tidak ada topik ditemukan.</div>`;
      return;
    }

    topics.forEach((t) => {
      const isLolos = t.status === 'scored' || t.status === 'produced';
      const score = t.score_total || 0;

      const card = document.createElement('div');
      card.className = 'radar-item-card';
      card.dataset.topicId = t.id;
      card.title = 'Pilih topik untuk melihat sumber dan skor, lalu produksi jika lolos.';

      card.innerHTML = `
        <div class="radar-score-col">
          <div class="radar-big-score" style="color: ${score >= 75 ? 'var(--lime)' : '#64748B'};">${score}</div>
        </div>
        <div class="radar-content-col">
          <div class="radar-item-title">${escapeHtml(t.title)}</div>
          <div class="radar-item-summary">↳ ${escapeHtml(t.summary ? t.summary.slice(0, 160) + '...' : '')}</div>
          <div class="radar-badges-row">
            <span class="radar-badge ${isLolos ? 'radar-badge-lolos' : 'radar-badge-gugur'}">${isLolos ? 'Skor analis lolos' : escapeHtml(t.status || 'Belum dinilai')}</span>
            <span class="radar-badge radar-badge-category">${escapeHtml(t.source_kind || 'feed')} · ${escapeHtml(t.primary_source || 'Sumber tidak diketahui')}</span>
            <span class="radar-badge">${escapeHtml(({ politik: 'Politik', sosial: 'Sosial', hukum: 'Hukum', lingkungan: 'Lingkungan', ekonomi: 'Ekonomi Nasional', bursa: 'Bursa Saham' })[t.desk] || 'Desk belum ditetapkan')}</span>
            <span class="radar-source-meta">· ${formatTimeAgo(t.created_at)}</span>
            <span class="radar-source-meta">${t.score_total == null ? 'Skor belum tersedia' : `Skor ${Number(t.score_total)}/100`}</span>
            <span class="radar-action-hint" style="color: var(--lime); font-size: 11px; font-weight: 700; margin-left: auto; display: flex; align-items: center; gap: 4px;">
              <span>🔗</span> <span>Buka detail</span>
            </span>
          </div>
          <div class="radar-card-actions">
            ${t.url ? `<a class="btn btn-outline" href="${escapeHtml(t.url)}" target="_blank" rel="noopener noreferrer">Buka sumber primer</a>` : ''}
            ${isLolos ? `<button class="btn btn-lime" data-produce-topic="${t.id}">Buat draf review</button>` : ''}
          </div>
          <div data-topic-illustration="${escapeHtml(t.id)}" style="margin-top: 12px;"></div>
        </div>
      `;

      card.querySelector('[data-produce-topic]')?.addEventListener('click', (event) => {
        event.stopPropagation();
        autoProduceAndReviewTopic(t.id, t.title);
      });
      container.appendChild(card);
      bindTopicIllustration(t.id, card.querySelector('[data-topic-illustration]'));
    });
  } catch (err) {
    console.error('Error loadTopics:', err);
  }
}

const topicIllustrationStates = new Map();

function topicIllustrationState(topicId) {
  const key = String(topicId);
  if (!topicIllustrationStates.has(key)) topicIllustrationStates.set(key, { open: false, assets: [], selected: null, configured: undefined, loading: false, generating: false, error: '', request: null });
  return topicIllustrationStates.get(key);
}

function renderTopicIllustration(topicId) {
  const state = topicIllustrationState(topicId);
  const busy = state.loading || state.generating;
  const selected = state.selected;
  const latest = state.assets[0];
  const preview = selected?.status === 'ready' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(selected.id));
  let status = selected?.status === 'ready' ? 'Ilustrasi terpilih siap.' : 'Belum ada ilustrasi AI.';
  if (latest && latest.status !== 'ready') status += ` Status pembuatan terakhir: ${latest.status || 'belum tersedia'}${latest.error_code ? ` (${latest.error_code})` : ''}.`;
  if (state.configured === false) status = 'Ilustrasi AI belum dikonfigurasi. Periksa pengaturan Agen Designer.';
  if (state.loading) status = 'Memuat ilustrasi...';
  if (state.generating) status = 'Membuat ilustrasi AI...';
  for (const panel of document.querySelectorAll('[data-topic-illustration]')) {
    if (panel.dataset.topicIllustration !== String(topicId)) continue;
    panel.setAttribute('aria-busy', String(busy));
    panel.innerHTML = `
      <div class="radar-card-actions">
        <button type="button" class="btn btn-outline" data-illustration-action="generate" ${busy || state.configured === false ? 'disabled' : ''}><svg class="ui-icon" aria-hidden="true" focusable="false" viewBox="0 0 24 24"><use href="/lucide-sprite.svg#sparkles"></use></svg> Buat ilustrasi AI</button>
        <button type="button" class="btn btn-outline" data-illustration-action="open" ${busy ? 'disabled' : ''}><svg class="ui-icon" aria-hidden="true" focusable="false" viewBox="0 0 24 24"><use href="/lucide-sprite.svg#eye"></use></svg> Lihat ilustrasi</button>
        ${state.open && (state.assets.length || selected) ? `<button type="button" class="btn btn-outline" data-illustration-action="regenerate" ${busy || state.configured === false ? 'disabled' : ''}><svg class="ui-icon" aria-hidden="true" focusable="false" viewBox="0 0 24 24"><use href="/lucide-sprite.svg#refresh-cw"></use></svg> Buat ulang ilustrasi AI</button>` : ''}
      </div>
      ${state.open ? `<div role="region" aria-label="Ilustrasi AI topik" style="margin-top: 10px;">
        <p role="status" style="color: var(--muted); font-size: 12px;">${escapeHtml(status)}</p>
        ${state.error ? `<p role="alert" style="color: var(--down); font-size: 12px;">${escapeHtml(state.error)}</p>` : ''}
        ${preview ? `<figure style="margin: 10px 0 0;"><img src="/api/media/assets/${encodeURIComponent(selected.id)}" alt="Ilustrasi AI terpilih untuk topik ini" loading="lazy" style="display: block; max-width: 100%; width: 240px; height: auto; border-radius: 8px;"><figcaption style="color: var(--muted); font-size: 11px; margin-top: 6px;">Ilustrasi AI · Perlu tinjauan editorial.</figcaption></figure>` : ''}
      </div>` : ''}`;
  }
}

function bindTopicIllustration(topicId, panel) {
  if (!panel) return;
  panel.addEventListener('click', (event) => {
    event.stopPropagation();
    const action = event.target.closest('[data-illustration-action]')?.dataset.illustrationAction;
    if (action === 'open') loadTopicIllustration(topicId);
    else if (action === 'generate' || action === 'regenerate') generateTopicIllustration(topicId, action === 'regenerate');
  });
  renderTopicIllustration(topicId);
}

async function loadTopicIllustration(topicId) {
  const state = topicIllustrationState(topicId);
  if (state.loading || state.generating) return;
  state.open = true;
  state.loading = true;
  state.error = '';
  renderTopicIllustration(topicId);
  try {
    const response = await fetch(`/api/topics/${encodeURIComponent(topicId)}/illustration`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    state.assets = Array.isArray(data.assets) ? data.assets : [];
    state.selected = data.selected || null;
    state.configured = data.configured === true;
  } catch (error) {
    state.error = `Ilustrasi gagal dimuat: ${error.message}`;
  } finally {
    state.loading = false;
    renderTopicIllustration(topicId);
  }
}

async function generateTopicIllustration(topicId, regenerate = false) {
  const state = topicIllustrationState(topicId);
  if (state.loading || state.generating || state.configured === false) return;
  state.open = true;
  state.generating = true;
  state.error = '';
  renderTopicIllustration(topicId);
  try {
    // Retain the request ID after a transport failure so retrying cannot create a duplicate asset.
    if (!state.request || state.request.regenerate !== regenerate) state.request = { request_id: crypto.randomUUID(), regenerate };
    const response = await fetch(`/api/topics/${encodeURIComponent(topicId)}/illustration/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request_id: state.request.request_id, ...(regenerate ? { regenerate: true } : {}) }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    if (!data.asset || typeof data.asset !== 'object' || !data.asset.id) throw new Error('Respons ilustrasi tidak valid.');
    state.assets = [data.asset, ...state.assets.filter((asset) => asset.id !== data.asset.id)];
    if (data.asset.status === 'ready') state.selected = data.asset;
    state.request = null;
  } catch (error) {
    state.error = `Ilustrasi gagal dibuat: ${error.message}`;
  } finally {
    state.generating = false;
    renderTopicIllustration(topicId);
  }
}

function populateStudioSourceTopics() {
  const select = document.getElementById('studio-source-topic');
  if (!select) return;
  const selected = select.value;
  const eligible = cachedTopics.filter((topic) => ['scored', 'produced'].includes(topic.status) && topic.url);
  select.innerHTML = '<option value="">Pilih topik skor analis</option>';
  for (const topic of eligible) {
    const option = document.createElement('option');
    option.value = topic.id;
    option.textContent = `#${topic.id} · ${String(topic.title || '').slice(0, 90)} · ${topic.score_total ?? '—'}`;
    select.appendChild(option);
  }
  if (eligible.some((topic) => String(topic.id) === selected)) select.value = selected;
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
      btn.textContent = currentWorkflowActive ? 'Jeda otomasi draf' : 'Aktifkan otomasi draf';
    }
    const status = document.getElementById('workflow-runtime-status');
    if (status) status.textContent = `Scheduler ${data.kind || 'systemd'}: ${data.active ? 'aktif' : 'berhenti'} · berikutnya ${data.next_run || 'belum tersedia'}`;
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
      showToast(`Otomasi draf ${result.active ? 'diaktifkan' : 'dijeda'}.`);
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

// ==============================================================================
// 9. Design Studio, AI Carousel Generator & Realtime Canvas Preview (User Request)
// ==============================================================================
function getDefaultStudioSlides() {
  // A preview of the six desks, not a report about a current event.
  return [
    ['POLITIK', 'Siapa mengawasi kebijakan publik?', 'Kebijakan publik dapat ditelaah melalui kewenangan pembuat keputusan, proses pembahasan, dan ruang pengawasan warga.'],
    ['SOSIAL', 'Layanan publik menjangkau siapa?', 'Akses pendidikan, kesehatan, dan perlindungan sosial berkaitan dengan kebutuhan warga serta hambatan yang mereka hadapi.'],
    ['HUKUM', 'Apa arti tahapan perkara?', 'Dugaan, dakwaan, dan putusan memiliki kedudukan berbeda. Tahap proses dan posisi para pihak perlu dijelaskan dengan cermat.'],
    ['LINGKUNGAN', 'Membaca risiko di sekitar kita', 'Risiko lingkungan dapat dipahami melalui paparan, kerentanan masyarakat, dan kebijakan pencegahan yang relevan.'],
    ['EKONOMI NASIONAL', 'Dari kebijakan ke kebutuhan sehari-hari', 'Harga pangan, pekerjaan, dan layanan negara menghubungkan kebijakan ekonomi dengan kehidupan masyarakat.'],
    ['BURSA SAHAM', 'Membaca keterbukaan informasi emiten', 'Laporan perusahaan dan pengumuman bursa memberi konteks untuk memahami peristiwa korporasi, periode data, dan risikonya.'],
  ].map(([category, title, teks], index) => ({
    no: index + 1,
    layout: index === 0 ? 'cover-editorial' : 'big-statement',
    teks,
    data: { category, title },
    source: 'Contoh redaksi · Gapura Media',
  }));
}

function populateStudioTopics() {
  const select = document.getElementById('studio-quick-topic-select');
  if (!select || !cachedTopics || cachedTopics.length === 0) return;
  const curVal = select.value;
  select.innerHTML = '<option value="">-- Pilih Topik dari Radar --</option>';
  cachedTopics.forEach((t) => {
    const opt = document.createElement('option');
    opt.value = t.id;
    const snippet = t.title.length > 65 ? t.title.substring(0, 63) + '...' : t.title;
    opt.textContent = `[#${t.id}] ${snippet} (${t.primary_source || 'Radar'})`;
    select.appendChild(opt);
  });
  if (curVal) select.value = curVal;
}

function updateStudioSlideUI() {
  if (!studioSlides || studioSlides.length === 0) {
    studioSlides = getDefaultStudioSlides();
  }

  const total = studioSlides.length;
  const curr = activeStudioSlideIndex + 1;

  const indText = document.getElementById('studio-slide-indicator-text');
  if (indText) indText.textContent = `${curr} / ${total}`;

  const badge = document.getElementById('studio-preview-caption-badge');
  if (badge) badge.textContent = `● Slide ${curr} dari ${total}`;

  // Update Pills
  const pillsContainer = document.getElementById('studio-slides-pills-container');
  if (pillsContainer) {
    pillsContainer.innerHTML = '';
    studioSlides.forEach((s, idx) => {
      const pill = document.createElement('button');
      pill.className = `btn ${idx === activeStudioSlideIndex ? 'btn-lime' : 'btn-dark'}`;
      pill.style.padding = '3px 8px';
      pill.style.fontSize = '11px';
      pill.style.minWidth = '28px';
      pill.textContent = `${idx + 1}`;
      pill.onclick = () => {
        activeStudioSlideIndex = idx;
        updateStudioSlideUI();
        renderStudioPreview();
      };
      pillsContainer.appendChild(pill);
    });
  }

  // Populate active slide edit inputs
  const activeSlide = studioSlides[activeStudioSlideIndex] || {};
  const textEl = document.getElementById('studio-edit-slide-text');
  if (textEl) textEl.value = activeSlide.teks || '';
  const layoutEl = document.getElementById('studio-edit-slide-layout');
  if (layoutEl) layoutEl.value = activeSlide.layout || 'cover-stat';
  const titleEl = document.getElementById('studio-edit-slide-title');
  if (titleEl) titleEl.value = activeSlide.data?.title || activeSlide.data?.category || '';
}

async function generateStudioCarouselAI() {
  const selectedTopicId = Number(document.getElementById('studio-quick-topic-select')?.value || 0);
  const selectedTopic = selectedTopicId ? cachedTopics.find((item) => Number(item.id) === selectedTopicId) : null;
  const title = selectedTopic?.title || document.getElementById('studio-custom-topic-text')?.value?.trim();
  const source = selectedTopic?.primary_source || document.getElementById('studio-custom-source-text')?.value?.trim() || '@gapuramedia';
  const sourceUrl = selectedTopic?.url || document.getElementById('studio-custom-source-url')?.value?.trim() || '';
  if (!title || !sourceUrl) {
    showToast('Judul dan URL sumber primer wajib diisi.');
    return;
  }

  const btn = document.getElementById('btn-studio-generate-ai');
  const origHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '⚡ Merancang Carousel via AI Designer...';

  const spinner = document.getElementById('live-preview-spinner');
  if (spinner) {
    spinner.style.display = 'flex';
    const spText = spinner.querySelector('span');
    if (spText) spText.textContent = '⚡ AI Designer merancang arsitektur visual...';
  }

  try {
    let editorial_input = readEditorialInput('studio-custom-editorial-mode', 'studio-custom-editorial-facts', { allowEmptyCurrent: selectedTopicId > 0 });
    if (selectedTopicId && editorial_input?.mode === 'explainer' && editorial_input.facts.length === 0) editorial_input = undefined;
    const res = await fetch('/api/designer/generate-slides', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, primary_source: source, url: sourceUrl, ...(selectedTopicId ? { topic_id: selectedTopicId } : {}), ...(editorial_input ? { editorial_input } : {}) }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    const data = await res.json();
    if (!Array.isArray(data.slides) || data.slides.length === 0) {
      throw new Error('AI tidak menghasilkan slide yang valid.');
    }

    studioSlides = data.slides;
    studioGeneratedContent = data;
    studioGeneratedInput = JSON.stringify({ title, source, sourceUrl, editorial_input: editorial_input || null, topicId: selectedTopicId || '' });
    document.getElementById('btn-studio-save-to-drafts').disabled = false;
    document.getElementById('studio-generated-scope').textContent = `${data.editorial_mode === 'current' ? 'Current' : 'Explainer'} · ${data.angle || ''} · ${data.scope_note || ''} · Periksa semua slide, caption dan rujukan sebelum menyetujui.`;
    activeStudioSlideIndex = 0;
    showToast(`✨ AI Designer sukses merancang ${studioSlides.length} slide carousel!`);
    updateStudioSlideUI();
    await renderStudioPreview();
  } catch (err) {
    console.error('Error generating studio carousel:', err);
    showToast(`Gagal merancang carousel: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = origHtml;
    if (spinner) spinner.style.display = 'none';
  }
}

async function saveStudioToDrafts() {
  if (!studioGeneratedContent || !studioSlides?.length) {
    showToast('Buat naskah orisinal melalui Rancang & Render Carousel terlebih dahulu.');
    return;
  }

  const selectedTopicId = Number(document.getElementById('studio-quick-topic-select')?.value || 0);
  const selectedTopic = selectedTopicId ? cachedTopics.find((item) => Number(item.id) === selectedTopicId) : null;
  const title = selectedTopic?.title || document.getElementById('studio-custom-topic-text')?.value?.trim() || studioSlides[0]?.data?.title || 'Carousel Studio Gapura';
  const source = selectedTopic?.primary_source || document.getElementById('studio-custom-source-text')?.value?.trim() || '@gapuramedia';
  const sourceUrl = selectedTopic?.url || document.getElementById('studio-custom-source-url')?.value?.trim() || '';

  const btn = document.getElementById('btn-studio-save-to-drafts');
  const origHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '💾 Menyimpan Draf ke Database...';

  try {
    let editorial_input = readEditorialInput('studio-custom-editorial-mode', 'studio-custom-editorial-facts', { allowEmptyCurrent: selectedTopicId > 0 });
    if (selectedTopicId && editorial_input?.mode === 'explainer' && editorial_input.facts.length === 0) editorial_input = undefined;
    const currentInput = JSON.stringify({ title, source, sourceUrl, editorial_input: editorial_input || null, topicId: selectedTopicId || '' });
    if (currentInput !== studioGeneratedInput) throw new Error('Topik, mode, atau catatan berubah. Buat ulang naskah sebelum menyimpan.');
    const res = await fetch('/api/drafts/create-from-custom', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...studioGeneratedContent,
        ...(Number(document.getElementById('studio-quick-topic-select')?.value) > 0 ? { topic_id: Number(document.getElementById('studio-quick-topic-select').value) } : {}),
        title,
        primary_source: source,
        source_url: sourceUrl,
        format: 'carousel',
        slides: studioSlides,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    const data = await res.json();
    showToast(`✨ Sukses membuat Draf Produksi #${data.draft_id}! Membuka meja review...`);

    await loadDrafts();
    switchToView('view-review');
    openDraftEditor(data.draft_id);
  } catch (err) {
    console.error('Error saving studio draft:', err);
    showToast(`Gagal menyimpan draf: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = origHtml;
  }
}

async function loadDesignStudio() {
  setupDesignStudioEvents();

  if (cachedTopics.length === 0) {
    loadTopics();
  } else {
    populateStudioTopics();
  }

  if (!studioSlides || studioSlides.length === 0) {
    studioSlides = getDefaultStudioSlides();
    activeStudioSlideIndex = 0;
  }
  updateStudioSlideUI();

  try {
    const res = await fetch('/api/tokens');
    if (!res.ok) return;
    const data = await res.json();
    const parsed = data.parsed || {};
    const brand = parsed.brand || {};
    const palette = parsed.palette || {};
    const typography = parsed.typography || {};

    // Raw YAML Editor
    const ed = document.getElementById('tokens-editor-dark');
    if (ed) ed.value = data.raw || '';

    // Brand inputs
    if (document.getElementById('studio-brand-handle')) {
      document.getElementById('studio-brand-handle').value = brand.handle || '@gapuramedia';
    }
    if (document.getElementById('studio-brand-name')) {
      document.getElementById('studio-brand-name').value = brand.name || 'Gapura Media';
    }
    if (document.getElementById('studio-brand-tagline')) {
      document.getElementById('studio-brand-tagline').value = brand.tagline || 'Politik, Sosial, Hukum, Lingkungan & Ekonomi Nasional termasuk Bursa Saham';
    }

    // Palette inputs
    const colorKeys = ['bg', 'ink', 'accent', 'highlight', 'up', 'down'];
    colorKeys.forEach((k) => {
      const val = palette[k] || (k === 'bg' ? '#f7f5f0' : k === 'ink' ? '#102b45' : '#1f7e81');
      const pEl = document.getElementById(`studio-color-${k}`);
      const hEl = document.getElementById(`studio-color-${k}-hex`);
      if (pEl) pEl.value = val;
      if (hEl) hEl.value = val;
    });

    // Typography inputs
    if (document.getElementById('studio-font-display')) {
      document.getElementById('studio-font-display').value = typography.display_font || 'Archivo Black';
    }
    if (document.getElementById('studio-font-body')) {
      document.getElementById('studio-font-body').value = typography.text_font || 'Inter';
    }

    // Trigger initial render preview
    triggerStudioPreview();
  } catch (err) {
    console.error('Error loadDesignStudio:', err);
  }
}

function setupDesignStudioEvents() {
  if (designStudioInitialized) return;
  designStudioInitialized = true;

  // Sync color pickers and hex inputs
  ['bg', 'ink', 'accent', 'highlight', 'up', 'down'].forEach((k) => {
    const pEl = document.getElementById(`studio-color-${k}`);
    const hEl = document.getElementById(`studio-color-${k}-hex`);
    if (pEl && hEl) {
      pEl.addEventListener('input', () => {
        hEl.value = pEl.value;
        triggerStudioPreview();
      });
      hEl.addEventListener('input', () => {
        if (/^#[0-9A-Fa-f]{6}$/.test(hEl.value)) {
          pEl.value = hEl.value;
          triggerStudioPreview();
        }
      });
    }
  });

  // Text inputs live trigger
  ['studio-brand-handle', 'studio-brand-name', 'studio-brand-tagline', 'studio-font-display', 'studio-font-body'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', triggerStudioPreview);
    }
  });

  // Topic select in Studio
  const topicSelect = document.getElementById('studio-quick-topic-select');
  if (topicSelect) {
    topicSelect.addEventListener('change', () => {
      const tid = parseInt(topicSelect.value);
      const chosen = cachedTopics.find((t) => Number(t.id) === tid);
      if (chosen) {
        document.getElementById('studio-custom-topic-text').value = chosen.title;
        document.getElementById('studio-custom-source-text').value = chosen.primary_source || '@gapuramedia';
        const sourceUrl = document.getElementById('studio-custom-source-url');
        if (sourceUrl) sourceUrl.value = chosen.url || '';
      }
      studioGeneratedContent = null;
      document.getElementById('btn-studio-save-to-drafts').disabled = true;
    });
  }
  for (const id of ['studio-custom-topic-text', 'studio-custom-source-text', 'studio-custom-source-url', 'studio-custom-editorial-mode', 'studio-custom-editorial-facts']) {
    document.getElementById(id)?.addEventListener('input', () => {
      studioGeneratedContent = null;
      document.getElementById('btn-studio-save-to-drafts').disabled = true;
      document.getElementById('studio-generated-scope').textContent = 'Topik, mode atau catatan berubah. Buat ulang naskah sebelum menyimpan.';
    });
  }

  // Generate Carousel Button
  const genBtn = document.getElementById('btn-studio-generate-ai');
  if (genBtn) {
    genBtn.addEventListener('click', generateStudioCarouselAI);
  }

  // Slide Nav Buttons
  const prevBtn = document.getElementById('btn-studio-prev-slide');
  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      if (activeStudioSlideIndex > 0) {
        activeStudioSlideIndex--;
        updateStudioSlideUI();
        renderStudioPreview();
      }
    });
  }
  const nextBtn = document.getElementById('btn-studio-next-slide');
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      if (activeStudioSlideIndex < studioSlides.length - 1) {
        activeStudioSlideIndex++;
        updateStudioSlideUI();
        renderStudioPreview();
      }
    });
  }

  // Live Slide Edit Fields in Studio
  const updateStudioSlideContent = () => {
    if (!studioSlides || !studioSlides[activeStudioSlideIndex]) return;
    const txt = document.getElementById('studio-edit-slide-text')?.value;
    const lyt = document.getElementById('studio-edit-slide-layout')?.value;
    const ttl = document.getElementById('studio-edit-slide-title')?.value;

    if (txt !== undefined) studioSlides[activeStudioSlideIndex].teks = txt;
    if (lyt !== undefined) studioSlides[activeStudioSlideIndex].layout = lyt;
    if (ttl !== undefined) {
      if (!studioSlides[activeStudioSlideIndex].data) studioSlides[activeStudioSlideIndex].data = {};
      studioSlides[activeStudioSlideIndex].data.title = ttl;
    }
    triggerStudioPreview();
  };

  ['studio-edit-slide-text', 'studio-edit-slide-layout', 'studio-edit-slide-title'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', updateStudioSlideContent);
  });

  // Save to Production Drafts Button
  const saveDraftsBtn = document.getElementById('btn-studio-save-to-drafts');
  if (saveDraftsBtn) {
    saveDraftsBtn.addEventListener('click', saveStudioToDrafts);
  }

  const saveBtn = document.getElementById('btn-save-design-studio');
  if (saveBtn) {
    saveBtn.addEventListener('click', saveDesignStudio);
  }

  const saveRawBtn = document.getElementById('btn-save-tokens-raw');
  if (saveRawBtn) {
    saveRawBtn.addEventListener('click', saveTokensYaml);
  }
}

function triggerStudioPreview() {
  clearTimeout(designStudioDebounceTimer);
  designStudioDebounceTimer = setTimeout(() => {
    renderStudioPreview();
  }, 250);
}

async function renderStudioPreview() {
  const spinner = document.getElementById('live-preview-spinner');
  if (spinner) spinner.style.display = 'flex';

  if (!studioSlides || studioSlides.length === 0) {
    studioSlides = getDefaultStudioSlides();
  }

  const currentSlide = studioSlides[activeStudioSlideIndex] || studioSlides[0] || {};
  const brandName = document.getElementById('studio-brand-name')?.value || 'Gapura Media';
  const brandHandle = document.getElementById('studio-brand-handle')?.value || '@gapuramedia';
  const brandTagline = document.getElementById('studio-brand-tagline')?.value || 'Politik, Sosial, Hukum, Lingkungan & Ekonomi Nasional termasuk Bursa Saham';

  const tokensOverride = {
    brand: {
      name: brandName,
      handle: brandHandle,
      tagline: brandTagline,
    },
    palette: {
      bg: document.getElementById('studio-color-bg-hex')?.value || '#f7f5f0',
      ink: document.getElementById('studio-color-ink-hex')?.value || '#102b45',
      accent: document.getElementById('studio-color-accent-hex')?.value || '#1f7e81',
      highlight: document.getElementById('studio-color-highlight-hex')?.value || '#d79344',
      up: document.getElementById('studio-color-up-hex')?.value || '#1a7a4f',
      down: document.getElementById('studio-color-down-hex')?.value || '#b23a48',
    },
    typography: {
      display_font: document.getElementById('studio-font-display')?.value || 'Archivo Black',
      text_font: document.getElementById('studio-font-body')?.value || 'Inter',
    },
  };

  const slideData = {
    no: activeStudioSlideIndex + 1,
    layout: currentSlide.layout || 'cover-stat',
    teks: currentSlide.teks || '',
    data: currentSlide.data || {},
    source: currentSlide.source || brandHandle,
  };

  try {
    const res = await fetch('/api/render/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slide: slideData,
        slide_no: activeStudioSlideIndex + 1,
        total_slides: studioSlides.length || 5,
        tokens: tokensOverride,
      }),
    });

    if (res.ok) {
      const blob = await res.blob();
      const img = document.getElementById('live-design-preview-img');
      if (img) {
        if (img.dataset.objectUrl) {
          URL.revokeObjectURL(img.dataset.objectUrl);
        }
        const objUrl = URL.createObjectURL(blob);
        img.src = objUrl;
        img.dataset.objectUrl = objUrl;
      }
    }
  } catch (err) {
    console.warn('Error rendering live preview:', err);
  } finally {
    if (spinner) spinner.style.display = 'none';
  }
}

async function saveDesignStudio() {
  const btn = document.getElementById('btn-save-design-studio');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span>⏳</span> <span>Menyimpan ke Render Engine...</span>';
  }

  const brandName = document.getElementById('studio-brand-name')?.value || 'Gapura Media';
  const brandHandle = document.getElementById('studio-brand-handle')?.value || '@gapuramedia';
  const brandTagline = document.getElementById('studio-brand-tagline')?.value || 'Politik, Sosial, Hukum, Lingkungan & Ekonomi Nasional termasuk Bursa Saham';

  const payload = {
    brand: {
      name: brandName,
      handle: brandHandle,
      tagline: brandTagline,
    },
    palette: {
      bg: document.getElementById('studio-color-bg-hex')?.value || '#f7f5f0',
      ink: document.getElementById('studio-color-ink-hex')?.value || '#102b45',
      accent: document.getElementById('studio-color-accent-hex')?.value || '#1f7e81',
      highlight: document.getElementById('studio-color-highlight-hex')?.value || '#d79344',
      up: document.getElementById('studio-color-up-hex')?.value || '#1a7a4f',
      down: document.getElementById('studio-color-down-hex')?.value || '#b23a48',
    },
    typography: {
      display_font: document.getElementById('studio-font-display')?.value || 'Archivo Black',
      text_font: document.getElementById('studio-font-body')?.value || 'Inter',
    },
  };

  try {
    const res = await fetch('/api/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    const data = await res.json();
    showToast(data.message || '✅ Desain identitas brand & username berhasil diterapkan ke Render Engine!');
    
    // Update sidebar brand handle text
    const sbHandle = document.querySelector('.sidebar-brand-handle');
    if (sbHandle) sbHandle.textContent = brandHandle;

    // Refresh raw editor
    const getRes = await fetch('/api/tokens');
    if (getRes.ok) {
      const gData = await getRes.json();
      const ed = document.getElementById('tokens-editor-dark');
      if (ed) ed.value = gData.raw || '';
    }

    renderStudioPreview();
  } catch (err) {
    console.error('Error saveDesignStudio:', err);
    showToast(`Gagal menyimpan desain: ${err.message}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span>💾</span> <span>Simpan & Terapkan ke Render Engine</span>';
    }
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
      loadDesignStudio();
    }
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}

// ==============================================================================
// 10. News Sources Management (User Request)
// ==============================================================================
let sourcesDataCache = [];
let sourcesInitialized = false;

async function loadSources() {
  setupSourcesEvents();
  const tbody = document.getElementById('sources-table-body');
  if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 30px; color: var(--muted);">Memuat daftar sumber berita...</td></tr>`;

  try {
    const res = await fetch('/api/sources');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const sources = await res.json();
    sourcesDataCache = sources;

    // Update Statistics
    const totalActive = sources.filter((s) => s.is_active).length;
    const nonFinancialDesks = new Set(['politik', 'sosial', 'hukum', 'lingkungan']);
    const deskOf = (s) => s.desk || ({ news_pasar: 'bursa', ojk_regulasi: 'ekonomi', bi_moneter: 'ekonomi', data_bps: 'ekonomi', jdih_hukum: 'hukum' }[s.category] || null);
    const regulasiCount = sources.filter((s) => nonFinancialDesks.has(deskOf(s))).length;
    const marketCount = sources.filter((s) => deskOf(s) === 'bursa').length;
    const primerCount = sources.filter((s) => deskOf(s) === 'ekonomi').length;

    if (document.getElementById('stat-sources-active')) document.getElementById('stat-sources-active').textContent = totalActive;
    if (document.getElementById('stat-sources-regulasi')) document.getElementById('stat-sources-regulasi').textContent = regulasiCount;
    if (document.getElementById('stat-sources-market')) document.getElementById('stat-sources-market').textContent = marketCount;
    if (document.getElementById('stat-sources-primer')) document.getElementById('stat-sources-primer').textContent = primerCount;
    if (document.getElementById('sidebar-sources-badge')) document.getElementById('sidebar-sources-badge').textContent = totalActive;

    if (!sources || sources.length === 0) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 30px; color: var(--muted);">Belum ada sumber berita terdaftar.</td></tr>`;
      return;
    }

    const categoryLabels = {
      news_pasar: { label: 'Pasar Modal', color: 'var(--up)' },
      ojk_regulasi: { label: 'Regulasi OJK', color: 'var(--highlight)' },
      jdih_hukum: { label: 'Hukum & MK', color: 'var(--accent)' },
      bi_moneter: { label: 'BI Moneter', color: '#38bdf8' },
      data_bps: { label: 'Data BPS', color: '#a855f7' },
      umum: { label: 'Umum / Lintas Isu', color: 'var(--muted)' },
    };
    const deskLabels = {
      politik: 'Politik', sosial: 'Sosial', hukum: 'Hukum',
      lingkungan: 'Lingkungan', ekonomi: 'Ekonomi Nasional', bursa: 'Bursa Saham',
    };

    let html = '';
    sources.forEach((src) => {
      const catInfo = categoryLabels[src.category] || { label: src.category, color: 'var(--muted)' };
      const isActive = src.is_active;

      html += `
        <tr style="border-bottom: 1px solid var(--border); transition: background 0.2s;" class="source-row">
          <td style="padding: 14px 16px;">
            <div style="font-weight: 700; color: #fff; margin-bottom: 2px;">${escapeHtml(src.name)}</div>
            <div style="font-size: 11px; color: var(--muted); text-transform: uppercase;">ID: #${src.id} • ${src.type}</div>
          </td>
          <td style="padding: 14px 16px;">
            <span style="display: inline-block; padding: 4px 10px; border-radius: 4px; font-size: 11px; font-weight: 700; background: rgba(255,255,255,0.06); color: ${catInfo.color}; border: 1px solid ${catInfo.color}33;">
              ${escapeHtml(deskLabels[src.desk] || catInfo.label)}
            </span>
            <div style="font-size: 11px; color: var(--muted); margin-top: 4px;">${src.desk ? `Registry: ${escapeHtml(catInfo.label)}` : 'Desk otomatis dari judul'}</div>
          </td>
          <td style="padding: 14px 16px; max-width: 300px;">
            <a href="${escapeHtml(src.url_or_query)}" target="_blank" rel="noopener" style="color: var(--accent); text-decoration: none; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(src.url_or_query)}">
              🔗 ${escapeHtml(src.url_or_query)}
            </a>
          </td>
          <td style="padding: 14px 16px; text-align: center; color: var(--text-dim);">
            ${src.poll_interval_mins} mnt
          </td>
          <td style="padding: 14px 16px; text-align: center; font-weight: 700; color: #fff;">
            ${src.total_items_fetched || 0}
          </td>
          <td style="padding: 14px 16px; text-align: center;">
            <button onclick="toggleSourceStatus(${src.id}, ${!isActive})" style="background: none; border: none; cursor: pointer; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; display: inline-flex; align-items: center; gap: 4px; ${isActive ? 'color: var(--lime); background: rgba(163, 230, 53, 0.1);' : 'color: var(--muted); background: rgba(255,255,255,0.05);'}">
              <span>${isActive ? '🟢 Aktif' : '⚪ Nonaktif'}</span>
            </button>
          </td>
          <td style="padding: 14px 16px; text-align: right;">
            <div style="display: inline-flex; gap: 6px;">
              <button class="btn btn-outline" onclick="openEditSourceModal(${src.id})" style="padding: 4px 10px; font-size: 12px;" title="Edit Sumber">
                ✏️ Edit
              </button>
              <button class="btn btn-outline" onclick="deleteSource(${src.id}, '${escapeHtml(src.name)}')" style="padding: 4px 8px; font-size: 12px; color: var(--down);" title="Hapus Sumber">
                🗑️
              </button>
            </div>
          </td>
        </tr>
      `;
    });

    if (tbody) tbody.innerHTML = html;
  } catch (err) {
    console.error('Error loadSources:', err);
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 30px; color: var(--down);">Gagal memuat sumber: ${err.message}</td></tr>`;
  }
}

function setupSourcesEvents() {
  if (sourcesInitialized) return;
  sourcesInitialized = true;

  const addBtn = document.getElementById('btn-open-add-source-modal');
  if (addBtn) addBtn.onclick = openAddSourceModal;

  const closeBtn = document.getElementById('btn-close-source-modal');
  if (closeBtn) closeBtn.onclick = closeSourceModal;

  const closeBtnX = document.getElementById('btn-close-source-modal-x');
  if (closeBtnX) closeBtnX.onclick = closeSourceModal;

  const form = document.getElementById('form-source');
  if (form) form.onsubmit = handleSaveSource;

  const typeSelect = document.getElementById('source-input-type');
  if (typeSelect) typeSelect.onchange = updateSourceInputHelp;

  const pollBtn = document.getElementById('btn-poll-sources-now');
  if (pollBtn) pollBtn.onclick = pollSourcesNow;
}

window.openAddSourceModal = function () {
  document.getElementById('modal-source-title').textContent = '➕ Tambah Sumber Berita Baru';
  document.getElementById('source-input-id').value = '';
  document.getElementById('source-input-name').value = '';
  document.getElementById('source-input-type').value = 'rss';
  document.getElementById('source-input-category').value = 'umum';
  document.getElementById('source-input-desk').value = '';
  document.getElementById('source-input-url').value = '';
  document.getElementById('source-input-interval').value = '30';
  document.getElementById('source-input-active').checked = true;

  const modal = document.getElementById('modal-source');
  if (modal) modal.style.display = 'flex';
};

function updateSourceInputHelp() {
  const type = document.getElementById('source-input-type')?.value;
  const input = document.getElementById('source-input-url');
  const help = document.getElementById('source-input-help');
  if (input) {
    input.type = type === 'rss' ? 'url' : 'text';
    input.placeholder = type === 'rss' ? 'https://example.com/rss.xml' : type === 'x_account' ? '@kemenkeuRI' : 'APBN Indonesia lang:id';
  }
  if (help) help.textContent = type === 'rss'
    ? 'Feed RSS/Atom wajib HTTPS.'
    : type === 'x_account'
      ? 'Masukkan @handle. Membutuhkan X_BEARER_TOKEN.'
      : 'Masukkan kata kunci pencarian X, misalnya APBN Indonesia lang:id. Membutuhkan X_BEARER_TOKEN.';
}

window.openEditSourceModal = function (id) {
  const src = sourcesDataCache.find((s) => s.id === id);
  if (!src) return;

  document.getElementById('modal-source-title').textContent = `✏️ Edit Sumber: ${src.name}`;
  document.getElementById('source-input-id').value = src.id;
  document.getElementById('source-input-name').value = src.name || '';
  document.getElementById('source-input-type').value = src.type || 'rss';
  document.getElementById('source-input-category').value = src.category || 'umum';
  document.getElementById('source-input-desk').value = src.desk || '';
  document.getElementById('source-input-url').value = src.url_or_query || '';
  document.getElementById('source-input-interval').value = src.poll_interval_mins || 30;
  document.getElementById('source-input-active').checked = src.is_active !== false;

  const modal = document.getElementById('modal-source');
  if (modal) modal.style.display = 'flex';
};

window.closeSourceModal = function () {
  const modal = document.getElementById('modal-source');
  if (modal) modal.style.display = 'none';
};

window.handleSaveSource = async function (e) {
  e.preventDefault();
  const id = document.getElementById('source-input-id')?.value;
  const name = document.getElementById('source-input-name')?.value;
  const type = document.getElementById('source-input-type')?.value;
  const category = document.getElementById('source-input-category')?.value;
  const desk = document.getElementById('source-input-desk')?.value || null;
  const url_or_query = document.getElementById('source-input-url')?.value;
  const poll_interval_mins = parseInt(document.getElementById('source-input-interval')?.value || '30');
  const is_active = document.getElementById('source-input-active')?.checked;

  const submitBtn = document.getElementById('btn-save-source-submit');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Menyimpan...';
  }

  try {
    const isEdit = Boolean(id);
    const url = isEdit ? `/api/sources/${id}` : '/api/sources';
    const method = isEdit ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, type, category, desk, url_or_query, poll_interval_mins, is_active }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    const data = await res.json();
    showToast(data.message || '✅ Sumber berhasil disimpan!');
    closeSourceModal();
    loadSources();
  } catch (err) {
    console.error('Error saving source:', err);
    showToast(`Gagal: ${err.message}`);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Simpan Sumber';
    }
  }
};

window.toggleSourceStatus = async function (id, newStatus) {
  const src = sourcesDataCache.find((s) => s.id === id);
  if (!src) return;

  try {
    const res = await fetch(`/api/sources/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...src,
        is_active: newStatus,
      }),
    });

    if (res.ok) {
      showToast(`Sumber "${src.name}" kini ${newStatus ? 'diaktifkan' : 'dinonaktifkan'}.`);
      loadSources();
    }
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
};

window.deleteSource = async function (id, name) {
  if (!confirm(`Apakah Anda yakin ingin menghapus atau menonaktifkan sumber "${name}"?`)) {
    return;
  }

  try {
    const res = await fetch(`/api/sources/${id}`, { method: 'DELETE' });
    const data = await res.json();
    showToast(data.message || 'Sumber berhasil dihapus.');
    loadSources();
  } catch (err) {
    showToast(`Gagal: ${err.message}`);
  }
};

window.pollSourcesNow = async function () {
  const btn = document.getElementById('btn-poll-sources-now');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span>⏳</span> <span>Scout Sedang Memindai Feed...</span>';
  }

  try {
    const res = await fetch('/api/sources/poll', { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      showToast(data.message || '✅ Pemindaian Scout selesai!');
      loadSources();
      loadTopics();
    } else {
      throw new Error(data.error || 'Gagal memindai');
    }
  } catch (err) {
    console.error('Error polling sources:', err);
    showToast(`Gagal polling: ${err.message}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span>⚡</span> <span>Tarik Berita Sekarang (Scout)</span>';
    }
  }
};

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
    showToast(data.is_existing ? `Draf #${data.draft_id} dimuat! Klik '✨ Regenerate AI' jika ingin merancang ulang total.` : '✨ Draf & slide berhasil diproduksi! Membuka editor...');
    await loadDrafts();
    switchToView('view-review');
    openDraftEditor(data.draft_id);
  } catch (err) {
    console.error('Error auto-producing topic:', err);
    showToast(`Gagal memproduksi draf: ${err.message}`);
  }
}

function switchToView(viewId) {
  appNavigation.navigate({ view: viewId });
}

function renderRoute(route) {
  activeDraft = null;
  clearTimeout(editorLivePreviewDebounceTimer);
  document.querySelectorAll('.nav-item').forEach((i) => i.classList.remove('active'));
  document.querySelectorAll('.view-pane').forEach((p) => p.classList.remove('active'));

  const viewId = route.view;
  const navItem = document.querySelector(`.nav-item[data-view="${viewId}"]`);
  const viewPane = document.getElementById(viewId);
  if (navItem) navItem.classList.add('active');
  if (viewPane) viewPane.classList.add('active');

  const sidebar = document.getElementById('app-sidebar');
  if (sidebar) sidebar.classList.remove('mobile-open');

  if (viewId === 'view-review') {
    const gallery = document.getElementById('review-gallery-subview');
    const editor = document.getElementById('review-editor-subview');
    if (route.draftId) {
      if (gallery) gallery.style.display = 'none';
      if (editor) editor.style.display = 'none';
      loadDraftForRoute(route.draftId);
    } else {
      if (gallery) gallery.style.display = 'block';
      if (editor) editor.style.display = 'none';
      loadDrafts();
    }
  } else if (viewId === 'view-overview') {
    loadStats();
    loadActivityFeed();
  } else if (viewId === 'view-topics') {
    loadTopics();
  } else if (viewId === 'view-sources') {
    loadSources();
  } else if (viewId === 'view-trends') {
    loadTrends();
    loadTrendSources();
  } else if (viewId === 'view-studio-prompt') {
    loadStudioSourceTopics();
    loadStudioJobs();
  } else if (viewId === 'view-agents') {
    loadAgentsConfigUI();
  } else if (viewId === 'view-n8n') {
    loadWorkflow();
  } else if (viewId === 'view-tokens') {
    loadDesignStudio();
  } else if (viewId === 'view-audit') {
    loadAuditFull();
  }
}

async function loadDraftForRoute(draftId) {
  try {
    const response = await fetch(`/api/drafts/${encodeURIComponent(draftId)}`);
    if (!response.ok) throw new Error(`Draf #${draftId} tidak tersedia.`);
    const draft = await response.json();
    const route = appNavigation.current();
    if (route.view !== 'view-review' || Number(route.draftId) !== Number(draftId)) return;
    renderDraftEditor(draft);
  } catch (error) {
    const route = appNavigation.current();
    if (route.view !== 'view-review' || Number(route.draftId) !== Number(draftId)) return;
    showToast(error.message);
    appNavigation.navigate({ view: 'view-review' }, { replace: true });
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
    window.gapuraAgentStudioConfig = config.studio || {};
    const studio = config.studio || {};
    if (document.getElementById('studio-agent-provider')) document.getElementById('studio-agent-provider').value = studio.provider || 'gemini';
    if (document.getElementById('studio-agent-model')) document.getElementById('studio-agent-model').value = studio.model || 'gemini-3.8-flash';
    if (document.getElementById('studio-agent-endpoint')) document.getElementById('studio-agent-endpoint').value = studio.endpoint || 'https://generativelanguage.googleapis.com';
    if (document.getElementById('studio-agent-prompt')) document.getElementById('studio-agent-prompt').value = studio.system_prompt || '';
    if (document.getElementById('studio-agent-key')) document.getElementById('studio-agent-key').placeholder = studio.api_key_configured ? 'Key tersimpan; kosongkan untuk mempertahankan atau isi untuk mengganti' : 'Belum ada key tersimpan; dapat memakai environment';
    if (document.getElementById('studio-agent-skills')) document.getElementById('studio-agent-skills').value = config.skills?.studio || '';

    // Scout
    const scout = config.scout || {};
    if (document.getElementById('scout-poll-interval')) document.getElementById('scout-poll-interval').value = scout.poll_interval_mins ?? 30;
    if (document.getElementById('scout-dedup-threshold')) document.getElementById('scout-dedup-threshold').value = scout.dedup_similarity_threshold ?? 0.85;
    if (document.getElementById('scout-max-items')) document.getElementById('scout-max-items').value = scout.max_items_per_source ?? 15;
    if (document.getElementById('scout-keywords')) document.getElementById('scout-keywords').value = scout.custom_keywords ?? '';
    if (document.getElementById('scout-rules')) document.getElementById('scout-rules').value = scout.rules ?? '';
    if (document.getElementById('scout-skills-md')) document.getElementById('scout-skills-md').value = (config.skills && config.skills.scout) || '';

    // Analis
    const analis = config.analis || {};
    if (document.getElementById('analis-provider')) document.getElementById('analis-provider').value = analis.provider || 'gemini';
    if (document.getElementById('analis-model')) document.getElementById('analis-model').value = analis.model || 'gemini-2.0-flash';
    if (document.getElementById('analis-endpoint')) document.getElementById('analis-endpoint').value = analis.endpoint || 'https://generativelanguage.googleapis.com';
    if (document.getElementById('analis-api-key')) document.getElementById('analis-api-key').placeholder = analis.api_key_configured ? 'Key tersimpan; kosongkan untuk mempertahankan atau isi untuk mengganti' : 'Belum ada key tersimpan; dapat memakai environment';

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
    if (document.getElementById('analis-skills-md')) document.getElementById('analis-skills-md').value = (config.skills && config.skills.analis) || '';

    // Copywriter
    const copy = config.copywriter || {};
    if (document.getElementById('copywriter-provider')) document.getElementById('copywriter-provider').value = copy.provider || 'gemini';
    if (document.getElementById('copywriter-model')) document.getElementById('copywriter-model').value = copy.model || 'gemini-2.0-flash';
    if (document.getElementById('copywriter-endpoint')) document.getElementById('copywriter-endpoint').value = copy.endpoint || 'https://generativelanguage.googleapis.com';
    if (document.getElementById('copywriter-api-key')) document.getElementById('copywriter-api-key').placeholder = copy.api_key_configured ? 'Key tersimpan; kosongkan untuk mempertahankan atau isi untuk mengganti' : 'Belum ada key tersimpan; dapat memakai environment';
    if (document.getElementById('copywriter-slides-count')) document.getElementById('copywriter-slides-count').value = copy.slide_count ?? 6;
    if (document.getElementById('copywriter-tone')) document.getElementById('copywriter-tone').value = copy.tone_of_voice ?? '';
    if (document.getElementById('copywriter-banned-words')) document.getElementById('copywriter-banned-words').value = copy.banned_words ?? '';
    if (document.getElementById('copywriter-disclaimer-fin')) document.getElementById('copywriter-disclaimer-fin').value = copy.disclaimer_financial ?? '';
    if (document.getElementById('copywriter-disclaimer-legal')) document.getElementById('copywriter-disclaimer-legal').value = copy.disclaimer_legal ?? '';
    if (document.getElementById('copywriter-prompt')) document.getElementById('copywriter-prompt').value = copy.system_prompt ?? '';
    if (document.getElementById('copywriter-skills-md')) document.getElementById('copywriter-skills-md').value = (config.skills && config.skills.copywriter) || '';

    // Designer (Full AI Creative Director + Design Tokens)
    const designer = config.designer || {};
    if (document.getElementById('designer-provider')) document.getElementById('designer-provider').value = designer.provider || 'gemini';
    if (document.getElementById('designer-model')) document.getElementById('designer-model').value = designer.model || 'gemini-2.0-flash';
    if (document.getElementById('designer-endpoint')) document.getElementById('designer-endpoint').value = designer.endpoint || 'https://generativelanguage.googleapis.com';
    if (document.getElementById('designer-api-key')) document.getElementById('designer-api-key').placeholder = designer.api_key_configured ? 'Key tersimpan; kosongkan untuk mempertahankan atau isi untuk mengganti' : 'Belum ada key tersimpan; dapat memakai environment';
    if (document.getElementById('designer-prompt')) document.getElementById('designer-prompt').value = designer.system_prompt || '';
    if (document.getElementById('designer-skills-md')) document.getElementById('designer-skills-md').value = (config.skills && config.skills.designer) || '';

    const imageGeneration = designer.image_generation || {};
    if (document.getElementById('designer-image-enabled')) document.getElementById('designer-image-enabled').checked = imageGeneration.enabled === true;
    if (document.getElementById('designer-image-provider')) document.getElementById('designer-image-provider').value = imageGeneration.provider ?? 'gemini';
    if (document.getElementById('designer-image-model')) document.getElementById('designer-image-model').value = imageGeneration.model ?? 'gemini-3.1-flash-lite-image';
    if (document.getElementById('designer-image-timeout')) document.getElementById('designer-image-timeout').value = imageGeneration.timeout_ms ?? 90000;
    if (document.getElementById('designer-image-rights-reference')) document.getElementById('designer-image-rights-reference').value = imageGeneration.rights_reference ?? 'https://ai.google.dev/gemini-api/terms';

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

    // SEO (Trend Intelligence)
    const seo = config.seo || {};
    if (document.getElementById('seo-provider')) document.getElementById('seo-provider').value = seo.provider || 'gemini';
    if (document.getElementById('seo-model')) document.getElementById('seo-model').value = seo.model || 'gemini-3.5-flash-lite';
    if (document.getElementById('seo-endpoint')) document.getElementById('seo-endpoint').value = seo.endpoint || 'https://generativelanguage.googleapis.com';
    if (document.getElementById('seo-api-key')) document.getElementById('seo-api-key').placeholder = seo.api_key_configured ? 'Key tersimpan; kosongkan untuk mempertahankan atau isi untuk mengganti' : 'Belum ada key tersimpan; dapat memakai environment';
    if (document.getElementById('seo-min-virality')) document.getElementById('seo-min-virality').value = seo.min_virality_score ?? 55;
    if (document.getElementById('seo-prompt')) document.getElementById('seo-prompt').value = seo.system_prompt ?? '';
    if (document.getElementById('seo-skills-md')) document.getElementById('seo-skills-md').value = (config.skills && config.skills.seo) || '';

    await loadProviderCatalogUI();
  } catch (err) {
    console.error('Error loadAgentsConfigUI:', err);
  }
}

// ==============================================================================
// 12b. Provider & Model Catalog UI
// ==============================================================================
let providerCatalogCache = null;
let providerCatalogBound = false;
let editingProviderId = '';

const AGENT_PROVIDER_SELECTS = ['analis-provider', 'copywriter-provider', 'designer-provider', 'seo-provider', 'studio-agent-provider'];
const AGENT_MODEL_INPUTS = ['analis-model', 'copywriter-model', 'designer-model', 'seo-model', 'studio-agent-model'];

function providerById(id) {
  return providerCatalogCache?.providers?.find((provider) => provider.id === id);
}

function pickProviderTestModel(provider) {
  const unusable = /(image|tts|audio|lyria|embed|transcribe|robotics|computer-use|deep-research|nano-banana)/i;
  const models = (provider.models || []).filter((model) => !unusable.test(model));
  return provider.default_model || models[0] || provider.models?.[0] || '';
}

function renderProviderCatalog(data) {
  const list = document.getElementById('provider-catalog-list');
  const status = document.getElementById('provider-catalog-status');
  if (!list) return;
  const providers = data.providers || [];
  const totalModels = providers.reduce((sum, provider) => sum + (provider.model_count || 0), 0);
  if (status) status.textContent = `${providers.length} provider · ${totalModels} model termuat`;
  if (!providers.length) {
    list.innerHTML = '<p class="agent-card-desc">Belum ada provider. Tambahkan endpoint resmi atau router di atas.</p>';
    return;
  }
  list.innerHTML = providers.map((provider) => {
    const enabledLabel = provider.enabled ? 'aktif' : 'nonaktif';
    return `
      <div class="provider-row" style="display: grid; grid-template-columns: minmax(200px, 1.6fr) 96px 100px 84px auto; gap: 10px; align-items: center; padding: 10px 12px; border: 1px solid var(--border); border-radius: 10px; background: rgba(255, 255, 255, 0.02);">
        <div style="min-width: 0;">
          <strong style="font-size: 13px; color: #fff;">${escapeHtml(provider.label)}</strong>
          <div style="font-size: 11px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(provider.id)} · ${escapeHtml(provider.base_url || 'Base URL belum diisi')}</div>
        </div>
        <span class="pill-status ${provider.enabled ? 'active' : ''}"><span class="dot"></span>${enabledLabel}</span>
        <span class="pill-status ${provider.key_configured ? 'active' : ''}"><span class="dot"></span>${provider.key_configured ? 'key siap' : 'tanpa key'}</span>
        <span style="font-size: 12px; color: var(--muted);">${provider.model_count} model</span>
        <div style="display: flex; gap: 6px; justify-content: flex-end; flex-wrap: wrap;">
          <button class="btn btn-outline" type="button" data-provider-refresh="${escapeHtml(provider.id)}">Refresh</button>
          <button class="btn btn-outline" type="button" data-provider-test="${escapeHtml(provider.id)}">Uji</button>
          <button class="btn btn-outline" type="button" data-provider-edit="${escapeHtml(provider.id)}">Ubah</button>
        </div>
        ${provider.error ? `<div style="grid-column: 1 / -1; font-size: 11px; color: var(--down);">${escapeHtml(provider.error)}</div>` : ''}
      </div>`;
  }).join('');
}

function syncProviderModelDatalist(providers) {
  const datalist = document.getElementById('provider-model-datalist');
  if (!datalist) return;
  const models = [...new Set(providers.flatMap((provider) => provider.models || []))].sort((a, b) => a.localeCompare(b));
  datalist.innerHTML = models.map((model) => `<option value="${escapeHtml(model)}"></option>`).join('');
  const imageDatalist = document.getElementById('designer-image-model-datalist');
  if (imageDatalist) {
    const imageModels = providers.filter((provider) => provider.id === 'gemini').flatMap((provider) => provider.models || []).filter((model) => /image|nano-banana/i.test(model));
    imageDatalist.innerHTML = [...new Set(imageModels)].sort().map((model) => `<option value="${escapeHtml(model)}"></option>`).join('');
  }
  for (const inputId of AGENT_MODEL_INPUTS) {
    const input = document.getElementById(inputId);
    if (input) input.setAttribute('list', 'provider-model-datalist');
  }
}

function populateAgentProviderSelects(providers) {
  for (const selectId of AGENT_PROVIDER_SELECTS) {
    const select = document.getElementById(selectId);
    if (!select) continue;
    const current = select.value;
    select.innerHTML = providers.map((provider) => `<option value="${escapeHtml(provider.id)}">${escapeHtml(provider.label)}${provider.enabled ? '' : ' (nonaktif)'}</option>`).join('');
    if (providers.some((provider) => provider.id === current)) select.value = current;
    else if (select.options.length) select.value = select.options[0].value;
  }
}

async function loadProviderCatalogUI() {
  bindProviderCatalogControls();
  try {
    const response = await fetch('/api/providers');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    providerCatalogCache = data;
    renderProviderCatalog(data);
    populateAgentProviderSelects(data.providers || []);
    syncProviderModelDatalist(data.providers || []);
    const chain = document.getElementById('provider-routing-chain');
    if (chain) chain.value = (data.routing?.fallback_chain || []).join('\n');
  } catch (error) {
    const status = document.getElementById('provider-catalog-status');
    if (status) status.textContent = `Gagal memuat katalog: ${error.message}`;
  }
}

function bindProviderCatalogControls() {
  if (providerCatalogBound) return;
  providerCatalogBound = true;

  document.getElementById('btn-refresh-models')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    const status = document.getElementById('provider-catalog-status');
    if (status) status.textContent = 'Memuat model dari semua provider...';
    try {
      const response = await fetch('/api/providers/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      providerCatalogCache = result;
      renderProviderCatalog(result);
      populateAgentProviderSelects(result.providers || []);
      syncProviderModelDatalist(result.providers || []);
      showToast('Katalog model diperbarui dari provider.');
    } catch (error) {
      if (status) status.textContent = `Refresh gagal: ${error.message}`;
      showToast(`Refresh model gagal: ${error.message}`);
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById('btn-toggle-provider-form')?.addEventListener('click', () => {
    const form = document.getElementById('provider-form');
    if (!form) return;
    form.hidden = !form.hidden;
    if (!form.hidden) resetProviderForm();
  });

  document.getElementById('provider-catalog-list')?.addEventListener('click', async (event) => {
    const refreshId = event.target.closest('[data-provider-refresh]')?.dataset.providerRefresh;
    const testId = event.target.closest('[data-provider-test]')?.dataset.providerTest;
    const editId = event.target.closest('[data-provider-edit]')?.dataset.providerEdit;
    if (refreshId) return refreshSingleProvider(refreshId, event.target.closest('button'));
    if (testId) return testProviderConnection(testId, event.target.closest('button'));
    if (editId) return editProviderForm(editId);
  });

  document.getElementById('btn-save-provider')?.addEventListener('click', saveProviderForm);
  document.getElementById('btn-save-routing')?.addEventListener('click', saveRoutingChain);
}

function resetProviderForm() {
  editingProviderId = '';
  const idInput = document.getElementById('provider-form-id');
  if (idInput) { idInput.value = ''; idInput.disabled = false; }
  const fields = { 'provider-form-label': '', 'provider-form-env': '', 'provider-form-url': '', 'provider-form-key': '' };
  for (const [id, value] of Object.entries(fields)) {
    const element = document.getElementById(id);
    if (element) element.value = value;
  }
  const kind = document.getElementById('provider-form-kind');
  if (kind) kind.value = 'openai';
  const enabled = document.getElementById('provider-form-enabled');
  if (enabled) enabled.checked = true;
  const status = document.getElementById('provider-form-status');
  if (status) status.textContent = '';
}

function editProviderForm(id) {
  const provider = providerById(id);
  if (!provider) return;
  editingProviderId = id;
  const form = document.getElementById('provider-form');
  if (form) form.hidden = false;
  const idInput = document.getElementById('provider-form-id');
  if (idInput) { idInput.value = provider.id; idInput.disabled = true; }
  const values = {
    'provider-form-label': provider.label,
    'provider-form-kind': provider.kind,
    'provider-form-env': provider.api_key_env,
    'provider-form-url': provider.base_url,
  };
  for (const [elementId, value] of Object.entries(values)) {
    const element = document.getElementById(elementId);
    if (element) element.value = value || '';
  }
  const key = document.getElementById('provider-form-key');
  if (key) key.value = '';
  const enabled = document.getElementById('provider-form-enabled');
  if (enabled) enabled.checked = provider.enabled;
  const status = document.getElementById('provider-form-status');
  if (status) status.textContent = `Mengubah ${provider.id}. Kosongkan API key bila tidak ingin mengganti.`;
}

async function refreshSingleProvider(id, button) {
  if (button) button.disabled = true;
  try {
    const response = await fetch('/api/providers/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider_id: id }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    providerCatalogCache = result;
    renderProviderCatalog(result);
    syncProviderModelDatalist(result.providers || []);
    const updated = result.providers.find((provider) => provider.id === id);
    showToast(updated?.error ? `${id}: ${updated.error}` : `${id}: ${updated?.model_count || 0} model dimuat.`);
  } catch (error) {
    showToast(`Refresh ${id} gagal: ${error.message}`);
  } finally {
    if (button) button.disabled = false;
  }
}

async function testProviderConnection(id, button) {
  const provider = providerById(id);
  const model = provider ? pickProviderTestModel(provider) : '';
  if (!model) return showToast(`Pilih model untuk ${id} lebih dulu (refresh katalog).`);
  if (button) button.disabled = true;
  try {
    const response = await fetch('/api/providers/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider_id: id, model }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.status === 'failed') throw new Error(result.error || (result.details || []).join(' ') || `HTTP ${response.status}`);
    showToast(`${provider.label || id} · ${result.model}: JSON valid dalam ${result.latency_ms} ms.`);
  } catch (error) {
    showToast(`${provider?.label || id} gagal: ${error.message}`);
  } finally {
    if (button) button.disabled = false;
  }
}

async function saveProviderForm() {
  const status = document.getElementById('provider-form-status');
  const button = document.getElementById('btn-save-provider');
  const id = (editingProviderId || document.getElementById('provider-form-id')?.value || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(id)) {
    if (status) status.textContent = 'ID provider harus huruf kecil, angka, minus, atau garis bawah.';
    return;
  }
  const payload = {
    label: document.getElementById('provider-form-label')?.value.trim() || id,
    kind: document.getElementById('provider-form-kind')?.value || 'openai',
    base_url: document.getElementById('provider-form-url')?.value.trim() || '',
    api_key_env: document.getElementById('provider-form-env')?.value.trim() || '',
    enabled: document.getElementById('provider-form-enabled')?.checked !== false,
  };
  const apiKey = document.getElementById('provider-form-key')?.value.trim() || '';
  if (button) button.disabled = true;
  if (status) status.textContent = 'Menyimpan provider...';
  try {
    const response = await fetch(`/api/providers/${encodeURIComponent(id)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error((result.details || [result.error || `HTTP ${response.status}`]).join(' '));
    if (apiKey) {
      const keyResponse = await fetch(`/api/providers/${encodeURIComponent(id)}/key`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_key: apiKey }) });
      const keyResult = await keyResponse.json().catch(() => ({}));
      if (!keyResponse.ok) throw new Error(keyResult.error || `API key HTTP ${keyResponse.status}`);
    }
    if (status) status.textContent = `Provider ${id} tersimpan.`;
    showToast(`Provider ${id} tersimpan${apiKey ? ' beserta API key' : ''}.`);
    resetProviderForm();
    await loadProviderCatalogUI();
  } catch (error) {
    if (status) status.textContent = `Gagal menyimpan: ${error.message}`;
    showToast(`Gagal menyimpan provider: ${error.message}`);
  } finally {
    if (button) button.disabled = false;
  }
}

async function saveRoutingChain() {
  const status = document.getElementById('provider-routing-status');
  const button = document.getElementById('btn-save-routing');
  const chain = (document.getElementById('provider-routing-chain')?.value || '')
    .split('\n').map((line) => line.trim()).filter(Boolean);
  if (button) button.disabled = true;
  if (status) status.textContent = 'Menyimpan rantai fallback...';
  try {
    const response = await fetch('/api/providers/routing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fallback_chain: chain }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error((result.details || [result.error || `HTTP ${response.status}`]).join(' '));
    if (status) status.textContent = `Rantai fallback tersimpan (${chain.length} entri).`;
    showToast('Rantai fallback global tersimpan.');
  } catch (error) {
    if (status) status.textContent = `Gagal: ${error.message}`;
    showToast(`Gagal menyimpan fallback: ${error.message}`);
  } finally {
    if (button) button.disabled = false;
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
    const payload = collectAgentConfigPayload();

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
    await loadAgentsConfigUI();
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

async function testAgentSettings() {
  const button = document.getElementById('btn-test-agent-config');
  const status = document.getElementById('agent-test-status');
  const agent = document.querySelector('.agent-nav-tab.active')?.dataset.agent || 'analis';
  const full = collectAgentConfigPayload();
  const keys = ['provider', 'endpoint', 'model', 'api_key', 'system_prompt'];
  const config = agent === 'scout' ? { scout: full.scout } : Object.fromEntries([agent].map((name) => [
    name,
    Object.fromEntries(keys.map((key) => [key, full[name]?.[key]])),
  ]));
  if (status) status.textContent = `Menguji ${agent} tanpa menyimpan perubahan...`;
  if (button) button.disabled = true;
  try {
    const response = await fetch('/api/agents/config/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent, config, skills: full.skills, prompt: 'Return only JSON: {"ok":true,"agent":"' + agent + '"}' }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error((result.details || [result.error || `HTTP ${response.status}`]).join(' '));
    if (status) status.textContent = `${agent}: ${result.status} · ${result.message}`;
  } catch (error) {
    if (status) status.textContent = `${agent}: gagal · ${error.message}`;
  } finally {
    if (button) button.disabled = false;
  }
}

// ==============================================================================
// 13. Agen SEO — Radar Trending
// ==============================================================================
let activeTrendPlatform = '';
let editingTrendSourceId = null;

const TREND_PLATFORM_META = {
  x: { label: 'X / Twitter', cls: 'x' },
  google_trends: { label: 'Google Trends', cls: 'trends' },
  news: { label: 'Momentum Berita', cls: 'news' },
  public_web: { label: 'Web Publik', cls: 'news' },
};

const TREND_SOURCE_KIND_META = {
  x_account: { label: 'Akun X', cls: 'x' },
  x_query: { label: 'Query X', cls: 'x' },
  google_trends: { label: 'Google Trends', cls: 'trends' },
  news_query: { label: 'Query Berita', cls: 'news' },
  public_web: { label: 'Web Publik + Sosial', cls: 'news' },
};

async function refreshSeoBadges() {
  try {
    const tRes = await fetch('/api/seo/trends?limit=100').catch(() => null);
    if (tRes && tRes.ok) {
      const trends = await tRes.json();
      const badge = document.getElementById('sidebar-trends-badge');
      if (badge) {
        const count = Array.isArray(trends) ? trends.length : 0;
        badge.textContent = count;
        badge.style.display = count > 0 ? 'inline-block' : 'none';
      }
    }
  } catch (err) {
    console.warn('Gagal memperbarui badge SEO:', err);
  }
}

async function loadTrends() {
  const container = document.getElementById('trend-list-container');
  if (!container) return;
  container.innerHTML = '<div class="empty-state-mini">Memuat item trending…</div>';

  try {
    await loadTrendHealth();
    const params = new URLSearchParams({ limit: '60' });
    if (activeTrendPlatform) params.set('platform', activeTrendPlatform);
    const res = await fetch(`/api/seo/trends?${params.toString()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const items = await res.json();

    renderTrendList(Array.isArray(items) ? items : []);
  } catch (err) {
    console.error('Error loadTrends:', err);
    reportClientLog('error', 'loadTrends', err);
    container.innerHTML = `<div class="empty-state-mini" style="color: var(--down);">Gagal memuat trending: ${escapeHtml(err.message)}</div>`;
  }
}

async function loadTrendHealth() {
  const banner = document.getElementById('trend-health-banner');
  const message = document.getElementById('trend-health-message');
  const time = document.getElementById('trend-health-last-success');
  if (!banner || !message) return;
  try {
    const response = await fetch('/api/seo/health');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const health = await response.json();
    banner.classList.toggle('is-stale', health.stale);
    const provider = `${health.firecrawl_api_configured ? 'Firecrawl Search aktif' : 'Firecrawl Search perlu API key'} · Google Trends + sosial/forum publik`;
    message.textContent = health.stale
      ? `Data trending stale · provider ${provider} · ${health.successful_sources}/${health.active_sources} sumber berhasil`
      : `Provider ${provider} · ${health.successful_sources}/${health.active_sources} sumber berhasil`;
    if (time) time.textContent = health.latest_success_at ? `Scan sukses ${formatTimeAgo(health.latest_success_at)}` : 'Belum ada scan sukses';
  } catch (error) {
    banner.classList.add('is-stale');
    message.textContent = `Status sumber tidak dapat diverifikasi: ${error.message}`;
    if (time) time.textContent = '';
  }
}

function renderTrendList(items) {
  const container = document.getElementById('trend-list-container');
  const meta = document.getElementById('trend-list-meta');
  if (!container) return;

  if (meta) meta.textContent = `${items.length} item · 3 hari terakhir`;

  const totalEl = document.getElementById('trend-stat-total');
  const topEl = document.getElementById('trend-stat-top');
  const promotedEl = document.getElementById('trend-stat-promoted');
  if (totalEl) totalEl.textContent = items.length;
  if (topEl) topEl.textContent = items.length ? Math.max(...items.map((i) => Number(i.virality_score) || 0)) : 0;
  if (promotedEl) promotedEl.textContent = items.filter((i) => i.promoted_topic_id).length;

  if (items.length === 0) {
    container.innerHTML = '<div class="empty-state-mini">Belum ada item trending. Jalankan <strong>Pindai Trending Sekarang</strong>.</div>';
    return;
  }

  container.innerHTML = items.map((item) => {
    const platform = TREND_PLATFORM_META[item.platform] || { label: item.platform || 'Trending', cls: 'news' };
    const score = Number(item.virality_score) || 0;
    const scoreClass = score >= 70 ? 'hot' : score >= 45 ? 'warm' : 'cool';
    const keywords = Array.isArray(item.matched_keywords) ? item.matched_keywords.slice(0, 4) : [];
    const traffic = item.engagement && item.engagement.traffic_label ? item.engagement.traffic_label : null;
    const author = item.author || (item.source_label ? `Sumber: ${item.source_label}` : '');
    const title = item.title || '(tanpa judul)';
    const snippet = item.snippet ? String(item.snippet).slice(0, 260) : '';
    const isPromoted = Boolean(item.promoted_topic_id);

    return `
      <div class="trend-item-card">
        <div class="trend-score-block ${scoreClass}">
          <span class="trend-score-val">${score}</span>
          <span class="trend-score-label">virality</span>
        </div>
        <div class="trend-body">
          <div class="trend-meta">
            <span class="trend-platform-badge ${platform.cls}">${escapeHtml(platform.label)}</span>
            ${author ? `<span class="trend-author">${escapeHtml(author)}</span>` : ''}
            ${traffic ? `<span class="trend-traffic">📈 ${escapeHtml(traffic)}</span>` : ''}
            <span class="trend-time">${formatTimeAgo(item.fetched_at || item.published_at)}</span>
            ${isPromoted ? '<span class="trend-status-badge promoted">✓ Sudah jadi topik</span>' : ''}
          </div>
          ${item.url
            ? `<a class="trend-title" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(title)}</a>`
            : `<div class="trend-title">${escapeHtml(title)}</div>`}
          ${snippet ? `<p class="trend-snippet">${escapeHtml(snippet)}</p>` : ''}
          <div class="trend-footer">
            <div class="trend-keywords">
              ${keywords.map((k) => `<span class="trend-keyword">${escapeHtml(k)}</span>`).join('')}
            </div>
            <button type="button" class="btn-trend-promote" data-trend-id="${item.id}" ${isPromoted ? 'disabled' : ''}>
              ${isPromoted ? 'Sudah Dipromosikan' : '🎯 Promosikan → Topik'}
            </button>
          </div>
        </div>
      </div>`;
  }).join('');

  container.querySelectorAll('.btn-trend-promote').forEach((btn) => {
    btn.onclick = () => promoteTrend(parseInt(btn.dataset.trendId, 10), btn);
  });
}

async function promoteTrend(trendId, btn) {
  if (!trendId) return;
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '⏳ Mempromosikan…';
  try {
    const res = await fetch(`/api/seo/trends/${trendId}/promote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actor: 'web_admin' }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    showToast(data.is_existing ? `Trend ini sudah menjadi topik #${data.topic_id}.` : `✅ Trend dipromosikan menjadi topik #${data.topic_id}.`);
    btn.innerHTML = '✓ Sudah Dipromosikan';
    await loadTrends();
    refreshSeoBadges();
  } catch (err) {
    console.error('Error promoteTrend:', err);
    reportClientLog('error', 'promoteTrend', err, { trendId });
    showToast(`Gagal mempromosikan trend: ${err.message}`);
    btn.disabled = false;
    btn.innerHTML = original;
  }
}

async function runSeoScanNow() {
  const btn = document.getElementById('btn-seo-scan-now');
  if (!btn) return;
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span>⏳</span> <span>Memindai sumber trending…</span>';
  try {
    const res = await fetch('/api/seo/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    const errCount = data.summary?.errors?.length || 0;
    showToast(data.message + (errCount ? ` (${errCount} sumber gagal, lihat tabel sumber)` : ''));
    await Promise.all([loadTrends(), loadTrendSources()]);
    refreshSeoBadges();
  } catch (err) {
    console.error('Error runSeoScanNow:', err);
    reportClientLog('error', 'runSeoScanNow', err);
    showToast(`Gagal memindai trending: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
}

async function loadTrendSources() {
  const tbody = document.getElementById('trend-sources-table-body');
  if (!tbody) return;
  try {
    const res = await fetch('/api/trend-sources');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = await res.json();
    renderTrendSources(Array.isArray(rows) ? rows : []);
  } catch (err) {
    console.error('Error loadTrendSources:', err);
    reportClientLog('error', 'loadTrendSources', err);
    tbody.innerHTML = `<tr><td colspan="8" style="padding: 16px; color: var(--down);">Gagal memuat sumber trending: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderTrendSources(rows) {
  const tbody = document.getElementById('trend-sources-table-body');
  const statEl = document.getElementById('trend-stat-sources');
  if (!tbody) return;
  if (statEl) statEl.textContent = rows.filter((r) => r.is_active).length;

  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="padding: 16px; color: var(--muted);">Belum ada sumber trending terdaftar.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map((row) => {
    const kind = TREND_SOURCE_KIND_META[row.kind] || { label: row.kind, cls: 'news' };
    const lastScan = row.last_scanned_at ? formatTimeAgo(row.last_scanned_at) : 'belum pernah';
    const errorNote = row.last_error
      ? `<div style="font-size: 11px; color: var(--down); margin-top: 3px;" title="${escapeHtml(row.last_error)}">⚠ ${escapeHtml(String(row.last_error).slice(0, 48))}…</div>`
      : '';
    return `
      <tr>
        <td style="padding: 12px 14px;"><span class="trend-platform-badge ${kind.cls}">${escapeHtml(kind.label)}</span></td>
        <td style="padding: 12px 14px; font-family: monospace; font-size: 12px; color: #fff;">${escapeHtml(row.value)}</td>
        <td style="padding: 12px 14px; color: var(--text-dim);">${escapeHtml(row.label || '—')}${errorNote}</td>
        <td style="padding: 12px 14px; color: var(--muted); font-size: 12px;">${escapeHtml(row.category || 'trending')}</td>
        <td style="padding: 12px 14px; text-align: center;">${row.weight ?? 10}</td>
        <td style="padding: 12px 14px; text-align: center; color: var(--muted); font-size: 12px;">${escapeHtml(lastScan)}</td>
        <td style="padding: 12px 14px; text-align: center;">
          <label style="display: inline-flex; align-items: center; gap: 6px; cursor: pointer; font-size: 12px; color: ${row.is_active ? 'var(--lime)' : 'var(--muted)'};">
            <input type="checkbox" class="trend-source-toggle" data-source-id="${row.id}" ${row.is_active ? 'checked' : ''} style="accent-color: var(--lime);">
            ${row.is_active ? 'Aktif' : 'Nonaktif'}
          </label>
        </td>
        <td style="padding: 12px 14px; text-align: right; white-space: nowrap;">
          <button type="button" class="btn-mini-ghost btn-trend-source-edit" data-source-id="${row.id}">✏️ Edit</button>
          <button type="button" class="btn-mini-ghost btn-trend-source-delete" data-source-id="${row.id}" style="color: var(--down);">🗑️</button>
        </td>
      </tr>`;
  }).join('');

  const sourceCache = rows;

  tbody.querySelectorAll('.btn-trend-source-edit').forEach((btn) => {
    btn.onclick = () => editTrendSource(parseInt(btn.dataset.sourceId, 10), sourceCache);
  });
  tbody.querySelectorAll('.btn-trend-source-delete').forEach((btn) => {
    btn.onclick = () => deleteTrendSource(parseInt(btn.dataset.sourceId, 10));
  });
  tbody.querySelectorAll('.trend-source-toggle').forEach((chk) => {
    chk.onchange = () => toggleTrendSource(parseInt(chk.dataset.sourceId, 10), chk.checked, sourceCache);
  });
}

function resetTrendSourceForm() {
  editingTrendSourceId = null;
  const fields = {
    'trend-source-value': '',
    'trend-source-label': '',
    'trend-source-weight': '12',
  };
  Object.entries(fields).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el) el.value = val;
  });
  const kindEl = document.getElementById('trend-source-kind');
  if (kindEl) kindEl.value = 'x_account';
  const catEl = document.getElementById('trend-source-category');
  if (catEl) catEl.value = 'trending';
  const activeEl = document.getElementById('trend-source-active');
  if (activeEl) activeEl.checked = true;
  const saveBtn = document.getElementById('btn-save-trend-source');
  if (saveBtn) saveBtn.innerHTML = '<span>➕</span> <span>Tambah / Perbarui Sumber</span>';
}

function editTrendSource(sourceId, rows) {
  const row = rows.find((r) => Number(r.id) === Number(sourceId));
  if (!row) return;
  editingTrendSourceId = sourceId;
  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  setVal('trend-source-kind', row.kind);
  setVal('trend-source-value', row.value);
  setVal('trend-source-label', row.label || '');
  setVal('trend-source-category', row.category || 'trending');
  setVal('trend-source-weight', row.weight ?? 12);
  const activeEl = document.getElementById('trend-source-active');
  if (activeEl) activeEl.checked = row.is_active !== false;
  const saveBtn = document.getElementById('btn-save-trend-source');
  if (saveBtn) saveBtn.innerHTML = '<span>💾</span> <span>Simpan Perubahan Sumber</span>';
  document.getElementById('trend-source-value')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function saveTrendSource() {
  const kind = document.getElementById('trend-source-kind')?.value || 'x_account';
  const value = (document.getElementById('trend-source-value')?.value || '').trim();
  const label = (document.getElementById('trend-source-label')?.value || '').trim();
  const category = document.getElementById('trend-source-category')?.value || 'trending';
  const weight = parseInt(document.getElementById('trend-source-weight')?.value || '12', 10);
  const is_active = document.getElementById('trend-source-active')?.checked !== false;

  if (!value) {
    showToast('Nilai sumber wajib diisi (handle, query, atau kode geo).');
    return;
  }

  const payload = { kind, value, label: label || null, category, weight, is_active };
  const isEdit = Boolean(editingTrendSourceId);
  const url = isEdit ? `/api/trend-sources/${editingTrendSourceId}` : '/api/trend-sources';
  const method = isEdit ? 'PUT' : 'POST';

  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    showToast(isEdit ? '✅ Sumber trending diperbarui.' : '✅ Sumber trending ditambahkan.');
    resetTrendSourceForm();
    await loadTrendSources();
  } catch (err) {
    console.error('Error saveTrendSource:', err);
    reportClientLog('error', 'saveTrendSource', err, { isEdit });
    showToast(`Gagal menyimpan sumber trending: ${err.message}`);
  }
}

async function toggleTrendSource(sourceId, isActive, rows) {
  const row = rows.find((r) => Number(r.id) === Number(sourceId));
  if (!row) return;
  try {
    const res = await fetch(`/api/trend-sources/${sourceId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: row.kind,
        value: row.value,
        label: row.label,
        category: row.category,
        weight: row.weight,
        is_active: isActive,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    showToast(isActive ? 'Sumber diaktifkan.' : 'Sumber dinonaktifkan.');
    await loadTrendSources();
  } catch (err) {
    console.error('Error toggleTrendSource:', err);
    reportClientLog('error', 'toggleTrendSource', err, { sourceId, isActive });
    showToast(`Gagal mengubah status sumber: ${err.message}`);
    await loadTrendSources();
  }
}

async function deleteTrendSource(sourceId) {
  if (!sourceId) return;
  if (!window.confirm('Hapus sumber trending ini? Item historis yang sudah tersimpan tetap ada.')) return;
  try {
    const res = await fetch(`/api/trend-sources/${sourceId}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    showToast('Sumber trending dihapus.');
    if (Number(editingTrendSourceId) === Number(sourceId)) resetTrendSourceForm();
    await loadTrendSources();
  } catch (err) {
    console.error('Error deleteTrendSource:', err);
    reportClientLog('error', 'deleteTrendSource', err, { sourceId });
    showToast(`Gagal menghapus sumber: ${err.message}`);
  }
}

async function loadStudioSourceTopics() {
  try {
    const response = await fetch('/api/topics?status=scored&limit=100&sort=score');
    if (!response.ok) throw new Error('Daftar sumber belum dapat dimuat.');
    const topics = await response.json();
    cachedTopics = topics;
    populateStudioSourceTopics();
  } catch (error) { showToast(error.message); }
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

// ==============================================================================
// 15. Studio Prompt — prompt-driven production
// ==============================================================================
let studioJobStream = null;

async function submitStudioPrompt() {
  const input = document.getElementById('studio-prompt-input');
  const topicId = Number.parseInt(document.getElementById('studio-source-topic')?.value || '', 10);
  const btn = document.getElementById('btn-studio-submit');
  if (!input || !btn) return;
  if (!Number.isInteger(topicId)) {
    showToast('Pilih topik Radar yang sudah lolos Analis dan memiliki sumber primer.');
    return;
  }
  const prompt = (input.value || '').trim();
  if (prompt.length < 10) {
    showToast('⚠️ Prompt minimal 10 karakter.');
    return;
  }
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span>⏳</span> <span>Mengirim prompt…</span>';
  try {
    let editorial_input = readEditorialInput('studio-editorial-mode', 'studio-editorial-facts', { allowEmptyCurrent: true });
    if (editorial_input?.mode === 'explainer' && editorial_input.facts.length === 0) editorial_input = undefined;
    const res = await fetch('/api/studio/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, topic_id: topicId, ...(editorial_input ? { editorial_input } : {}) }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    showToast(`✅ Job #${data.job.id} dibuat. AI menyusun rencana — pantau kartu di bawah.`);
    input.value = '';
    await loadStudioJobs(data.job.id);
  } catch (err) {
    console.error('Error submitStudioPrompt:', err);
    reportClientLog('error', 'submitStudioPrompt', err);
    showToast(`❌ Gagal membuat job: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
}

const STUDIO_STATUS_META = {
  queued: { label: 'MENUNGGU', cls: 'waiting' },
  planning: { label: 'MENYUSUN RENCANA', cls: 'context' },
  plan_review: { label: 'RENCANA MENUNGGU ACC', cls: 'context' },
  drafting: { label: 'MEMPRODUKSI DRAFT', cls: 'context' },
  dispatching: { label: 'MENGIRIM KE REVIEW', cls: 'context' },
  review: { label: 'MENUNGGU REVIEW', cls: 'context' },
  scheduled: { label: 'TERJADWAL', cls: 'success' },
  published: { label: 'TAYANG', cls: 'success' },
  failed: { label: 'GAGAL', cls: 'danger' },
  cancelled: { label: 'DIBATALKAN', cls: 'waiting' },
};

async function loadStudioJobs(focusJobId = null) {
  const container = document.getElementById('studio-jobs-container');
  if (!container) return;
  if (!focusJobId) container.innerHTML = '<div class="empty-state-mini">Memuat antrian produksi…</div>';
  try {
    const res = await fetch('/api/studio/jobs');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const jobs = await res.json();
    renderStudioJobs(Array.isArray(jobs) ? jobs : [], focusJobId);
  } catch (err) {
    console.error('Error loadStudioJobs:', err);
    reportClientLog('error', 'loadStudioJobs', err);
    container.innerHTML = `<div class="empty-state-mini" style="color: var(--down);">Gagal memuat antrian: ${escapeHtml(err.message)}</div>`;
  }
}

function renderStudioJobs(jobs, focusJobId) {
  const container = document.getElementById('studio-jobs-container');
  if (!container) return;
  if (jobs.length === 0) {
    container.innerHTML = '<div class="empty-state-mini">Belum ada job. Tulis prompt di atas untuk memulai.</div>';
    return;
  }
  container.innerHTML = jobs.map((job) => {
    const meta = STUDIO_STATUS_META[job.status] || { label: String(job.status).toUpperCase(), cls: 'waiting' };
    const plan = job.plan?.title && Array.isArray(job.plan.sections) ? job.plan : null;
    const planHtml = plan
      ? `<details class="studio-job-details" ${String(job.id) === String(focusJobId) ? 'open' : ''}>
           <summary>Lihat rencana konten</summary>
           <div class="studio-job-subblock"><span class="studio-job-subblock-title">Judul</span><p class="studio-job-takeaway">${escapeHtml(plan.title || '')}</p></div>
           ${plan.angle ? `<div class="studio-job-subblock"><span class="studio-job-subblock-title">Sudut pandang</span><p class="studio-job-takeaway">${escapeHtml(plan.angle)}</p></div>` : ''}
           ${plan.goal ? `<div class="studio-job-subblock"><span class="studio-job-subblock-title">Tujuan</span><p class="studio-job-takeaway">${escapeHtml(plan.goal)}</p></div>` : ''}
           <div class="studio-job-subblock"><span class="studio-job-subblock-title">Mode dan bahan review</span><p class="studio-job-takeaway">${escapeHtml(plan.editorial_input?.mode || 'explainer')} · ${(plan.editorial_input?.facts || []).length} catatan fakta · carousel ${plan.slide_count_hint || 6} slide</p><p class="form-help-text">Ubah mode dan catatan melalui editorial_input dalam rencana. Periksa setiap sumber; fokus sections bukan bukti kejadian.</p></div>
           <div class="studio-job-subblock"><span class="studio-job-subblock-title">Poin isi</span><ul class="studio-job-list">${(plan.sections || []).map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul></div>
           <textarea id="plan-edit-${job.id}" class="form-input-dark" rows="6" style="width: 100%; margin-top: 10px; font-family: monospace; font-size: 12px;">${escapeHtml(JSON.stringify(plan, null, 2))}</textarea>
         </details>`
      : '';
    return `
      <div class="studio-job-card" id="studio-job-${job.id}">
        <div class="studio-job-head">
          <span class="studio-job-badge ${meta.cls}">${escapeHtml(meta.label)}</span>
          <span class="studio-job-time">Review wajib</span>
          <span class="studio-job-time">${formatTimeAgo(job.created_at)}</span>
        </div>
        <div class="studio-job-title">${escapeHtml((job.prompt || '').slice(0, 140))}${(job.prompt || '').length > 140 ? '…' : ''}</div>
        ${job.error ? `<p class="studio-job-summary" style="color: var(--down);">${escapeHtml(job.error)}</p>` : ''}
        ${planHtml}
        <div class="studio-job-footer" style="gap: 8px; flex-wrap: wrap;">
          ${plan && ['plan_review', 'failed'].includes(job.status) ? `<button type="button" class="btn-mini-ghost btn-studio-run" data-job-id="${job.id}">▶️ Produksi Sesuai Rencana</button>` : ''}
          ${plan && job.status === 'plan_review' ? `<button type="button" class="btn-mini-ghost btn-studio-save-plan" data-job-id="${job.id}">Simpan Edit Rencana</button>` : ''}
          ${plan && job.status === 'plan_review' ? `<button type="button" class="btn-mini-ghost btn-studio-regen" data-job-id="${job.id}">Generate Ulang Rencana</button>` : ''}
          ${['queued', 'plan_review'].includes(job.status) ? `<button type="button" class="btn-mini-ghost btn-studio-cancel" data-job-id="${job.id}" style="color: var(--down);">✕ Batalkan</button>` : ''}
          ${job.draft_id ? `<button type="button" class="btn-mini-ghost btn-studio-open-draft" data-draft-id="${job.draft_id}">📂 Buka Draft #${job.draft_id}</button>` : ''}
          ${job.topic_id ? `<span class="studio-job-meta-line">Topik #${job.topic_id}</span>` : ''}
        </div>
      </div>`;
  }).join('');

  container.querySelectorAll('.btn-studio-run').forEach((btn) => {
    btn.onclick = () => runStudioJob(parseInt(btn.dataset.jobId, 10), btn);
  });
  container.querySelectorAll('.btn-studio-save-plan').forEach((btn) => {
    btn.onclick = () => saveStudioPlan(parseInt(btn.dataset.jobId, 10), btn);
  });
  container.querySelectorAll('.btn-studio-regen').forEach((btn) => {
    btn.onclick = () => regenerateStudioPlan(parseInt(btn.dataset.jobId, 10), btn);
  });
  container.querySelectorAll('.btn-studio-cancel').forEach((btn) => {
    btn.onclick = () => cancelStudioJob(parseInt(btn.dataset.jobId, 10), btn);
  });
  container.querySelectorAll('.btn-studio-open-draft').forEach((btn) => {
    btn.onclick = () => openStudioDraft(parseInt(btn.dataset.draftId, 10));
  });

  if (focusJobId) streamStudioJob(focusJobId);
}

function streamStudioJob(jobId) {
  if (studioJobStream) { studioJobStream.close(); studioJobStream = null; }
  const es = new EventSource(`/api/studio/jobs/${jobId}/stream`);
  studioJobStream = es;
  es.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.done) {
        es.close();
        studioJobStream = null;
        if (data.status === 'failed') {
          showToast(`❌ Job #${jobId} gagal: ${data.error || 'lihat log'}`);
        } else {
          showToast(`✅ Job #${jobId} selesai (${data.status}).`);
        }
        loadStudioJobs();
        refreshSeoBadges();
        return;
      }
      updateStudioJobLive(jobId, data);
    } catch { /* abaikan chunk rusak */ }
  };
  es.onerror = () => {
    es.close();
    studioJobStream = null;
    // Fallback: polling ringan sampai job selesai (mis. SSE diblokir proxy).
    const poll = setInterval(async () => {
      const job = await fetch(`/api/studio/jobs/${jobId}`).then((r) => r.json()).catch(() => ({}));
      updateStudioJobLive(jobId, { status: job.status, progress: job.progress });
      if (['plan_review','review','scheduled','published','failed','cancelled'].includes(job.status)) {
        clearInterval(poll);
        if (job.status === 'failed') showToast(`❌ Job #${jobId} gagal: ${job.error || 'lihat log'}`);
        else showToast(`✅ Job #${jobId} selesai (${job.status}).`);
        loadStudioJobs();
      }
    }, 3000);
  };
}

function updateStudioJobLive(jobId, data) {
  const card = document.getElementById(`studio-job-${jobId}`);
  if (!card) return;
  const badge = card.querySelector('.studio-job-badge');
  const meta = STUDIO_STATUS_META[data.status] || { label: data.status, cls: 'waiting' };
  if (badge) {
    badge.textContent = `${meta.label} · ${data.progress ?? 0}%`;
    badge.className = `studio-job-badge ${meta.cls}`;
  }
  // Baris log terakhir: pengguna selalu tahu AI sedang apa.
  if (data.message) {
    let live = card.querySelector('.studio-live-log');
    if (!live) {
      live = document.createElement('p');
      live.className = 'studio-live-log';
      live.style.cssText = 'font-size: 12px; color: var(--lime); margin-top: 8px;';
      card.insertBefore(live, card.querySelector('.studio-job-footer'));
    }
    live.textContent = `⚡ ${data.message}`;
  }
}

async function runStudioJob(jobId, btn) {
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '⏳ Menjalankan…';
  try {
    const res = await fetch(`/api/studio/jobs/${jobId}/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    showToast(`🚀 Job #${jobId} berjalan. Pantau progres di kartu ini.`);
    streamStudioJob(jobId);
  } catch (err) {
    console.error('Error runStudioJob:', err);
    reportClientLog('error', 'runStudioJob', err, { jobId });
    showToast(`Gagal menjalankan job: ${err.message}`);
    btn.disabled = false;
    btn.innerHTML = original;
  }
}

async function saveStudioPlan(jobId, btn) {
  const textarea = document.getElementById(`plan-edit-${jobId}`);
  if (!textarea) return;
  let plan;
  try {
    plan = JSON.parse(textarea.value);
  } catch (err) {
    showToast('Rencana bukan JSON valid. Perbaiki formatnya.');
    return;
  }
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '⏳ Menyimpan…';
  try {
    const res = await fetch(`/api/studio/jobs/${jobId}/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    showToast('✅ Rencana tersimpan.');
    await loadStudioJobs(jobId);
  } catch (err) {
    console.error('Error saveStudioPlan:', err);
    reportClientLog('error', 'saveStudioPlan', err, { jobId });
    showToast(`Gagal menyimpan rencana: ${err.message}`);
    btn.disabled = false;
    btn.innerHTML = original;
  }
}

async function regenerateStudioPlan(jobId, btn) {
  const instruction = window.prompt('Instruksi revisi untuk generate ulang rencana (boleh kosong):') || '';
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '⏳ Generate…';
  try {
    const res = await fetch(`/api/studio/jobs/${jobId}/regenerate-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    showToast('♻️ Rencana di-generate ulang.');
    await loadStudioJobs(jobId);
  } catch (err) {
    console.error('Error regenerateStudioPlan:', err);
    reportClientLog('error', 'regenerateStudioPlan', err, { jobId });
    showToast(`Gagal generate ulang: ${err.message}`);
    btn.disabled = false;
    btn.innerHTML = original;
  }
}

async function cancelStudioJob(jobId, btn) {
  const original = btn.innerHTML;
  btn.disabled = true;
  try {
    const res = await fetch(`/api/studio/jobs/${jobId}/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    showToast('Job dibatalkan.');
    await loadStudioJobs();
  } catch (err) {
    console.error('Error cancelStudioJob:', err);
    reportClientLog('error', 'cancelStudioJob', err, { jobId });
    showToast(`Gagal membatalkan: ${err.message}`);
    btn.disabled = false;
    btn.innerHTML = original;
  }
}

async function openStudioDraft(draftId) {
  switchToView('view-review');
  setTimeout(() => openDraftEditor(draftId), 400);
}
