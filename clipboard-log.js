function fmtMs(v) {
  return `${Math.round(v || 0)} ms`;
}

function fmtDate(v) {
  if (!v) return '-';
  const d = new Date(v);
  return d.toLocaleString();
}

function statCard(label, value) {
  return `<div class="stat"><div class="label">${label}</div><div class="value">${value}</div></div>`;
}

function escapeHtml(str) {
  return (str || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

async function loadData() {
  const stats = await window.electronAPI.getUsageStats();
  const logs = await window.electronAPI.getActionLogs();

  const avg = stats.totalActions ? (stats.totalDurationMs / stats.totalActions) : 0;

  document.getElementById('summaryGrid').innerHTML = [
    statCard('Total actions', stats.totalActions || 0),
    statCard('Success', stats.successCount || 0),
    statCard('Errors', stats.errorCount || 0),
    statCard('No selection', stats.noSelectionCount || 0),
    statCard('Total duration', fmtMs(stats.totalDurationMs || 0)),
    statCard('Avg duration', fmtMs(avg)),
    statCard('Input chars', stats.totalInputChars || 0),
    statCard('Output chars', stats.totalOutputChars || 0),
    statCard('Last run', fmtDate(stats.lastRunAt))
  ].join('');

  document.getElementById('providerBreakdown').textContent = JSON.stringify(stats.providerBreakdown || {}, null, 2);
  document.getElementById('modelBreakdown').textContent = JSON.stringify(stats.modelBreakdown || {}, null, 2);

  const list = document.getElementById('logList');
  if (!logs.length) {
    list.innerHTML = '<div class="meta">No records yet. Run the hotkey workflow to generate logs.</div>';
    return;
  }

  list.innerHTML = logs.map((row) => {
    const provider = row.provider || 'unknown';
    const model = row.model || 'unknown';
    const d = row.durations || {};

    return `
      <article class="log-item">
        <header>
          <div>
            <span class="badge ${row.status}">${row.status}</span>
            <span class="meta">${fmtDate(row.timestamp)} · ${provider} / ${model}</span>
          </div>
          <div class="actions">
            <button data-copy="${row.id}">Re-copy output</button>
            <button data-delete="${row.id}" class="danger">Delete record</button>
          </div>
        </header>

        <div class="meta">Durations: copy ${fmtMs(d.copyMs)} · llm ${fmtMs(d.llmMs)} · paste ${fmtMs(d.pasteMs)} · total ${fmtMs(d.totalMs)}</div>
        <div class="meta">Prompt: ${escapeHtml(row.prompt || '')}</div>
        ${row.error ? `<div class="meta" style="color:#fca5a5;">Error: ${escapeHtml(row.error)}</div>` : ''}

        <div class="row">
          <div>
            <div class="meta">Copied input (${(row.inputText || '').length} chars)</div>
            <div class="text-block">${escapeHtml(row.inputText || '')}</div>
          </div>
          <div>
            <div class="meta">LLM output (${(row.outputText || '').length} chars)</div>
            <div class="text-block">${escapeHtml(row.outputText || '')}</div>
          </div>
        </div>
      </article>
    `;
  }).join('');

  list.querySelectorAll('button[data-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-copy');
      const result = await window.electronAPI.recopyActionOutput(id);
      if (!result.success) {
        alert(result.error || 'Failed to copy output');
      }
    });
  });

  list.querySelectorAll('button[data-delete]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-delete');
      await window.electronAPI.deleteActionLog(id);
      await loadData();
    });
  });
}

document.getElementById('refreshBtn').addEventListener('click', loadData);

document.getElementById('clearLogsBtn').addEventListener('click', async () => {
  if (!confirm('Clear all clipboard log records?')) return;
  await window.electronAPI.clearActionLogs();
  await loadData();
});

document.getElementById('resetStatsBtn').addEventListener('click', async () => {
  if (!confirm('Reset usage stats and telemetry counters?')) return;
  await window.electronAPI.clearUsageStats();
  await loadData();
});

loadData();
