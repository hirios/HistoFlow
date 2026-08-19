/**
 * HubSpot Flow Lookup — painel flutuante (v3)
 * ----------------------------------------------
 * Uso: cole este código no Console do DevTools (F12) enquanto estiver logado
 * em app.hubspot.com, ou salve como bookmarklet.
 *
 * Novidades desta versão:
 * - Cada card de inscrição agora tem um botão "Ver histórico completo" que
 *   busca (via /api/automationapps/v1/history) e exibe uma timeline com
 *   cada evento: inscrição, execução de cada ação (com detalhes/campos de
 *   saída) e desinscrição/conclusão do fluxo.
 * - Continua com: resumo (encontrado/quantas vezes/quando), link para o
 *   contato no CRM, e o JSON bruto retrátil.
 *
 * IMPORTANTE:
 * - Depende da sua sessão de navegador logada (cookies + CSRF token).
 * - Usa rotas internas não documentadas do app HubSpot
 *   (/api/crm-search/search e /api/automationapps/v1/history).
 *   Podem mudar ou parar de funcionar sem aviso.
 * - Só funciona rodando dentro do domínio app.hubspot.com.
 */
(function () {
  'use strict';

  if (window.location.hostname !== 'app.hubspot.com') {
    alert('Este script precisa rodar em app.hubspot.com');
    return;
  }

  const STORAGE_KEY = 'hs_flow_lookup_flow_id';
  const HISTORY_LOOKBACK_MS = 1000 * 60 * 60 * 24 * 180; // 180 dias

  function getCookie(name) {
    const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : null;
  }

  function parseFromUrl() {
    const path = window.location.pathname;
    const portalMatch = path.match(/\/workflows\/(\d+)\//);
    const flowMatch = path.match(/\/(?:details|platform\/flow)\/(\d+)\//);
    return {
      portalId: portalMatch ? portalMatch[1] : null,
      flowId: flowMatch ? flowMatch[1] : null,
    };
  }

  function formatDate(ts) {
    if (!ts) return '—';
    const d = new Date(Number(ts));
    return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' });
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // Extrai enrollmentId / actionExecutionIndex de um sourceId no formato
  // "enrollmentId:2746581817383;actionExecutionIndex:7"
  function parseAutomationSourceId(sourceId) {
    if (!sourceId) return null;
    const enrollMatch = sourceId.match(/enrollmentId:(\d+)/);
    const actionMatch = sourceId.match(/actionExecutionIndex:(\d+)/);
    if (!enrollMatch) return null;
    return {
      enrollmentId: enrollMatch[1],
      actionExecutionIndex: actionMatch ? actionMatch[1] : null,
    };
  }

  // Extrai um resumo legível a partir do JSON bruto do crm-search
  function summarize(data) {
    const results = Array.isArray(data.results) ? data.results : [];
    const items = results.map((item) => {
      let enrollmentId = null;
      const props = item.properties || {};

      for (const key of Object.keys(props)) {
        const versions = props[key].versions || [];
        for (const v of versions) {
          const parsed = parseAutomationSourceId(v.sourceId);
          if (parsed) {
            enrollmentId = parsed.enrollmentId;
            break;
          }
        }
        if (enrollmentId) break;
      }

      return {
        objectId: item.objectId,
        enrollmentId,
        timestamp: (item.state && item.state.timestamp) || null,
      };
    });

    return {
      found: items.length > 0,
      count: data.total != null ? data.total : items.length,
      items,
    };
  }

  // Monta a timeline legível a partir do retorno de /api/automationapps/v1/history
  function renderTimeline(events) {
    const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);

    return sorted.map((ev) => {
      let icon = '•', color = '#7c98b6', title = ev.type || 'Evento';

      if (ev.type === 'ENROLLMENT') {
        icon = '▶'; color = '#00a4bd';
        title = 'Inscrito no fluxo' + (ev.enrollType ? ` (${ev.enrollType})` : '');
      } else if (ev.type === 'ACTION_EXECUTION') {
        const ok = ev.executionState === 'SUCCESS';
        icon = ok ? '✓' : '!'; color = ok ? '#2e7d32' : '#c1462f';
        const actionType = (ev.action && ev.action.actionType) || '';
        title = `Ação #${ev.actionExecutionIndex != null ? ev.actionExecutionIndex : '?'}${actionType ? ' — ' + actionType : ''}`;
      } else if (ev.type === 'UNENROLLMENT') {
        const ok = ev.enrollmentState === 'COMPLETED';
        icon = ok ? '■' : '✕'; color = ok ? '#2e7d32' : '#c1462f';
        title = ev.enrollmentState === 'COMPLETED' ? 'Fluxo concluído' : `Desinscrito (${ev.enrollmentState || ''})`;
      }

      const message = (ev.logEventMessage && ev.logEventMessage.message) || '';
      const outputFields = (ev.logEventMessage && ev.logEventMessage.outputFields) || [];

      const outputHtml = outputFields.length
        ? `<details style="margin-top:4px;">
             <summary style="cursor:pointer; font-size:11px; color:#7c98b6;">Detalhes (${outputFields.length})</summary>
             <table style="width:100%; font-size:11px; margin-top:4px; border-collapse:collapse;">
               ${outputFields.map((f) => `
                 <tr>
                   <td style="padding:2px 4px; color:#7c98b6; vertical-align:top; white-space:nowrap;">${escapeHtml(f.label)}</td>
                   <td style="padding:2px 4px; word-break:break-all;">${escapeHtml(f.value)}</td>
                 </tr>
               `).join('')}
             </table>
           </details>`
        : '';

      return `
        <div style="display:flex; gap:8px; margin-bottom:10px;">
          <div style="flex-shrink:0; width:20px; height:20px; border-radius:50%; background:${color};
            color:#fff; display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:bold;">${icon}</div>
          <div style="flex:1; min-width:0;">
            <div style="font-weight:600;">${escapeHtml(title)}</div>
            <div style="color:#7c98b6; font-size:11px;">${formatDate(ev.timestamp)}</div>
            ${message ? `<div style="margin-top:2px;">${escapeHtml(message)}</div>` : ''}
            ${outputHtml}
          </div>
        </div>
      `;
    }).join('');
  }

  function createPanel() {
    const existing = document.getElementById('hs-flow-lookup-panel');
    if (existing) existing.remove();

    const { portalId, flowId } = parseFromUrl();
    const savedFlowId = localStorage.getItem(STORAGE_KEY);

    const panel = document.createElement('div');
    panel.id = 'hs-flow-lookup-panel';
    panel.style.cssText = `
      position: fixed; top: 80px; right: 20px; width: 400px;
      background: #fff; border: 1px solid #cbd6e2; border-radius: 8px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.2); z-index: 999999;
      font-family: -apple-system, "Segoe UI", Arial, sans-serif;
      font-size: 13px; color: #33475b; max-height: 90vh; display: flex; flex-direction: column;
    `;

    panel.innerHTML = `
      <div id="hs-flow-lookup-header" style="
        background: #33475b; color: #fff; padding: 8px 12px;
        border-radius: 8px 8px 0 0; cursor: move; flex-shrink: 0;
        display: flex; justify-content: space-between; align-items: center;
      ">
        <span>🔍 Flow Lookup</span>
        <span id="hs-flow-lookup-close" style="cursor:pointer; font-weight:bold; padding:0 4px;">×</span>
      </div>
      <div style="padding: 12px; overflow-y: auto;">
        <label style="display:block; margin-bottom:4px; font-weight:600;">Portal ID</label>
        <input id="hs-flow-portal-id" type="text" value="${portalId || ''}"
          style="width:100%; box-sizing:border-box; padding:6px; margin-bottom:8px; border:1px solid #cbd6e2; border-radius:4px;" />

        <label style="display:block; margin-bottom:4px; font-weight:600;">
          Flow ID <span id="hs-flow-id-status" style="font-weight:normal; color:#7c98b6;"></span>
        </label>
        <input id="hs-flow-id" type="text" value="${flowId || savedFlowId || ''}"
          style="width:100%; box-sizing:border-box; padding:6px; margin-bottom:8px; border:1px solid #cbd6e2; border-radius:4px;" />

        <label style="display:block; margin-bottom:4px; font-weight:600;">Email do lead</label>
        <input id="hs-flow-email" type="text" placeholder="lead@exemplo.com"
          style="width:100%; box-sizing:border-box; padding:6px; margin-bottom:8px; border:1px solid #cbd6e2; border-radius:4px;" />

        <button id="hs-flow-search-btn" style="
          width:100%; background:#ff7a59; color:#fff; border:none;
          padding:8px; border-radius:4px; cursor:pointer; font-weight:600;
        ">Buscar</button>

        <div id="hs-flow-lookup-status" style="margin-top:8px; min-height:16px; color:#7c98b6;"></div>

        <div id="hs-flow-lookup-summary" style="margin-top:8px;"></div>

        <details style="margin-top:10px;">
          <summary style="cursor:pointer; color:#7c98b6;">Ver JSON bruto (busca)</summary>
          <textarea id="hs-flow-lookup-result" readonly style="
            width:100%; box-sizing:border-box; height:180px; margin-top:6px;
            padding:6px; font-family: monospace; font-size:11px;
            border:1px solid #cbd6e2; border-radius:4px; resize:vertical;
          "></textarea>
          <button id="hs-flow-copy-btn" style="
            width:100%; background:#516f90; color:#fff;
            border:none; padding:6px; border-radius:4px; cursor:pointer; margin-top:6px;
          ">Copiar JSON</button>
        </details>
      </div>
    `;

    document.body.appendChild(panel);

    // --- Arrastar o painel ---
    let isDragging = false, offsetX = 0, offsetY = 0;
    const header = panel.querySelector('#hs-flow-lookup-header');
    header.addEventListener('mousedown', (e) => {
      isDragging = true;
      offsetX = e.clientX - panel.offsetLeft;
      offsetY = e.clientY - panel.offsetTop;
    });
    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      panel.style.left = (e.clientX - offsetX) + 'px';
      panel.style.top = (e.clientY - offsetY) + 'px';
      panel.style.right = 'auto';
    });
    document.addEventListener('mouseup', () => { isDragging = false; });

    panel.querySelector('#hs-flow-lookup-close').addEventListener('click', () => panel.remove());

    // --- Flow ID: status + persistência ---
    const flowIdInput = panel.querySelector('#hs-flow-id');
    const flowIdStatus = panel.querySelector('#hs-flow-id-status');
    if (flowId) {
      flowIdStatus.textContent = '(detectado na URL)';
    } else if (savedFlowId) {
      flowIdStatus.textContent = '(salvo anteriormente — edite se necessário)';
    } else {
      flowIdStatus.textContent = '(não encontrado na URL — edite manualmente)';
    }
    flowIdInput.addEventListener('change', () => {
      localStorage.setItem(STORAGE_KEY, flowIdInput.value.trim());
    });

    const statusEl = panel.querySelector('#hs-flow-lookup-status');
    const summaryEl = panel.querySelector('#hs-flow-lookup-summary');
    const resultEl = panel.querySelector('#hs-flow-lookup-result');
    const copyBtn = panel.querySelector('#hs-flow-copy-btn');

    async function fetchHistory(portal, flow, objectId, historyBtn, historyContainer) {
      historyBtn.disabled = true;
      historyBtn.textContent = 'Carregando...';
      historyContainer.style.display = 'block';
      historyContainer.innerHTML = '<div style="color:#7c98b6;">Buscando histórico...</div>';

      const csrf = getCookie('hubspotapi-csrf');
      const url = `/api/automationapps/v1/history?portalId=${encodeURIComponent(portal)}&clienttimeout=14000&hs_static_app=automation-ui-index&hs_static_app_version=1.72017`;
      const payload = {
        flowId: Number(flow),
        limit: 25,
        objectIds: [Number(objectId)],
        objectTypeId: '0-136',
        startTimestamp: Date.now() - HISTORY_LOOKBACK_MS,
      };

      try {
        const res = await fetch(url, {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            'x-hubspot-csrf-hubspotapi': csrf || '',
          },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          historyContainer.innerHTML = `<div style="color:#c1462f;">Erro ${res.status}: ${res.statusText}</div>`;
          return;
        }

        const data = await res.json();
        const events = Array.isArray(data.results) ? data.results : [];

        if (!events.length) {
          historyContainer.innerHTML = '<div style="color:#7c98b6;">Nenhum evento encontrado nesse período.</div>';
          return;
        }

        historyContainer.innerHTML = renderTimeline(events);
      } catch (err) {
        historyContainer.innerHTML = `<div style="color:#c1462f;">Erro na requisição: ${escapeHtml(err.message)}</div>`;
      } finally {
        historyBtn.disabled = false;
        historyBtn.textContent = 'Ver histórico completo';
      }
    }

    function renderSummary(summary, email) {
      const portal = panel.querySelector('#hs-flow-portal-id').value.trim();
      const flow = panel.querySelector('#hs-flow-id').value.trim();

      const contactSearchUrl = `https://app.hubspot.com/contacts/${portal}/objects/0-1/views/all/list?query=${encodeURIComponent(email)}`;

      if (!summary.found) {
        summaryEl.innerHTML = `
          <div style="background:#fde8e5; border:1px solid #f2b8ae; border-radius:4px; padding:8px; margin-bottom:8px;">
            <strong>Não encontrado.</strong> Nenhuma inscrição desse lead nesse fluxo.
          </div>
          <a href="${contactSearchUrl}" target="_blank" style="
            display:block; text-align:center; text-decoration:none;
            background:#516f90; color:#fff; padding:7px; border-radius:4px; margin-top:6px;
          ">Ver contato no CRM →</a>
        `;
        return;
      }

      summaryEl.innerHTML = `
        <div style="background:#e5f5e0; border:1px solid #b0dcae; border-radius:4px; padding:8px; margin-bottom:8px;">
          <strong>Encontrado!</strong> Lead passou pelo fluxo <strong>${summary.count}</strong> vez(es).
        </div>
        <div id="hs-flow-enrollment-cards"></div>
        <a href="${contactSearchUrl}" target="_blank" style="
          display:block; text-align:center; text-decoration:none;
          background:#516f90; color:#fff; padding:7px; border-radius:4px; margin-top:6px;
        ">Ver contato no CRM →</a>
      `;

      const cardsContainer = summaryEl.querySelector('#hs-flow-enrollment-cards');

      summary.items.forEach((item, idx) => {
        const card = document.createElement('div');
        card.style.cssText = 'border:1px solid #cbd6e2; border-radius:4px; padding:8px; margin-bottom:6px;';
        card.innerHTML = `
          <div><strong>Inscrição ${idx + 1}</strong></div>
          <div>Data: ${formatDate(item.timestamp)}</div>
          <div style="display:flex; align-items:center; gap:4px; margin-top:2px;"
               title="Identifica esse registro específico do lead nesse fluxo — usado para buscar o histórico de ações.">
            <span>Object ID: <code>${item.objectId}</code></span>
            <button class="hs-copy-btn" data-copy="${item.objectId}" title="Copiar"
              style="border:none; background:none; cursor:pointer; font-size:12px; padding:0 2px;">📋</button>
          </div>
          <button class="hs-history-btn" style="
            margin-top:6px; background:#00a4bd; color:#fff; border:none;
            padding:6px 10px; border-radius:4px; cursor:pointer; font-size:12px;
          ">Ver histórico completo</button>
          <div class="hs-history-container" style="display:none; margin-top:8px; padding-top:8px; border-top:1px solid #e5eaf0;"></div>
        `;

        card.querySelectorAll('.hs-copy-btn').forEach((btn) => {
          btn.addEventListener('click', () => {
            const value = btn.getAttribute('data-copy');
            navigator.clipboard.writeText(value).then(() => {
              const original = btn.textContent;
              btn.textContent = '✓';
              setTimeout(() => { btn.textContent = original; }, 1200);
            }).catch(() => {});
          });
        });

        const historyBtn = card.querySelector('.hs-history-btn');
        const historyContainer = card.querySelector('.hs-history-container');

        historyBtn.addEventListener('click', () => {
          if (historyContainer.style.display === 'block' && historyContainer.dataset.loaded === 'true') {
            // já carregado — só alterna visibilidade
            historyContainer.style.display = 'none';
            historyBtn.textContent = 'Ver histórico completo';
            return;
          }
          fetchHistory(portal, flow, item.objectId, historyBtn, historyContainer)
            .then(() => { historyContainer.dataset.loaded = 'true'; });
        });

        cardsContainer.appendChild(card);
      });
    }

    async function doSearch() {
      const portal = panel.querySelector('#hs-flow-portal-id').value.trim();
      const email = panel.querySelector('#hs-flow-email').value.trim();

      if (!portal || !email) {
        statusEl.textContent = 'Preencha Portal ID e Email.';
        statusEl.style.color = '#c1462f';
        return;
      }

      statusEl.textContent = 'Buscando...';
      statusEl.style.color = '#7c98b6';
      summaryEl.innerHTML = '';
      resultEl.value = '';

      const csrf = getCookie('hubspotapi-csrf');

      const payload = {
        portalId: Number(portal),
        count: 50,
        offset: 0,
        query: email,
        requestOptions: {
          properties: [
            'hs_associated_contact_email',
            'hs_associated_contact_lastname',
            'hs_lead_name',
            'hs_associated_company_domain',
            'hs_associated_contact_firstname',
            'hs_associated_company_name',
            'archived',
          ],
        },
        sorts: [{ property: 'createdate', order: 'ASC' }],
        nextCursor: null,
        objectTypeId: '0-136',
      };

      const url = `/api/crm-search/search?portalId=${encodeURIComponent(portal)}&clienttimeout=14000&hs_static_app=automation-ui-index&hs_static_app_version=1.72017`;

      try {
        const res = await fetch(url, {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            'x-hubspot-csrf-hubspotapi': csrf || '',
          },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          statusEl.textContent = `Erro ${res.status}: ${res.statusText}`;
          statusEl.style.color = '#c1462f';
          return;
        }

        const data = await res.json();
        statusEl.textContent = `OK (${res.status})`;
        statusEl.style.color = '#00a4bd';
        resultEl.value = JSON.stringify(data, null, 2);

        const summary = summarize(data);
        renderSummary(summary, email);
      } catch (err) {
        statusEl.textContent = 'Erro na requisição: ' + err.message;
        statusEl.style.color = '#c1462f';
      }
    }

    panel.querySelector('#hs-flow-search-btn').addEventListener('click', doSearch);
    panel.querySelector('#hs-flow-email').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doSearch();
    });

    copyBtn.addEventListener('click', () => {
      resultEl.select();
      document.execCommand('copy');
      copyBtn.textContent = 'Copiado!';
      setTimeout(() => (copyBtn.textContent = 'Copiar JSON'), 1500);
    });
  }

  createPanel();
})();
