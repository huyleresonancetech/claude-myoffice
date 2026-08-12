'use strict';

(function () {
  const SVG_NS = 'http://www.w3.org/2000/svg';

  // Categorical palette, muted but distinguishable on a near-black background.
  // Reused consistently for phases and roles so the same key always maps to the
  // same color everywhere on the page.
  const PALETTE = ['#6ee7ff', '#a78bfa', '#4ade80', '#fb923c', '#f87171', '#94a3b8', '#38bdf8', '#c084fc'];

  const SEVERITY_COLORS = { blocker: '#f87171', major: '#fb923c', minor: '#94a3b8' };

  // Phase keys as documented in schema.md ("0".."6" or "done"). The workflow's
  // per-phase meaning is not part of the schema contract, so labels stay neutral.
  const PHASE_KEYS = ['0', '1', '2', '3', '4', '5', '6', 'done'];
  const PHASE_LABELS = {
    '0': 'Phase 0', '1': 'Phase 1', '2': 'Phase 2', '3': 'Phase 3',
    '4': 'Phase 4', '5': 'Phase 5', '6': 'Phase 6', done: 'Done',
  };
  const PHASE_COLORS = {};
  PHASE_KEYS.forEach(function (key, i) { PHASE_COLORS[key] = PALETTE[i % PALETTE.length]; });

  const ROLE_KEYS = ['scout', 'planner', 'implementer', 'reviewer', 'tester', 'analyst', 'claude'];
  const ROLE_COLORS = {};
  ROLE_KEYS.forEach(function (key, i) { ROLE_COLORS[key] = PALETTE[i % PALETTE.length]; });

  // ---- demo dataset -------------------------------------------------------
  // Covers 7 days / 8 runs / 4 repos with a failed run and one in-progress
  // (partial) run, so every code path below gets exercised without a server.

  const DEMO_DATA = {
    runs: [
      {
        runId: 'r-20260806-1', startedAt: '2026-08-06T09:12:00Z', durationMs: 2520000,
        phaseDurations: { '0': 60000, '1': 240000, '2': 300000, '3': 900000, '4': 420000, '5': 360000, '6': 180000, done: 60000 },
        findings: { blocker: 1, major: 3, minor: 4 }, fixLoops: 2, firstVerifyGreen: false,
        tokens: { perAgentRole: { scout: 8000, planner: 6000, implementer: 42000, reviewer: 15000, tester: 9000 } },
        cwd: 'D:\\projects\\keywordgap', triage: 'feature', result: 'ok',
      },
      {
        runId: 'r-20260807-1', startedAt: '2026-08-07T10:05:00Z', durationMs: 1080000,
        phaseDurations: { '0': 30000, '3': 600000, '4': 300000, '6': 120000, done: 30000 },
        findings: { blocker: 0, major: 1, minor: 2 }, fixLoops: 0, firstVerifyGreen: true,
        tokens: { perAgentRole: { implementer: 30000, reviewer: 9000, tester: 6000 } },
        cwd: 'D:\\projects\\writerzen', triage: 'trivial', result: 'ok',
      },
      {
        runId: 'r-20260808-1', startedAt: '2026-08-08T14:20:00Z', durationMs: 1500000,
        phaseDurations: { '0': 45000, '1': 180000, '2': 150000, '3': 420000, '4': 300000, '5': 300000, '6': 90000, done: 15000 },
        findings: { blocker: 2, major: 2, minor: 1 }, fixLoops: 1, firstVerifyGreen: false,
        tokens: { perAgentRole: { scout: 9000, planner: 7000, implementer: 32000, reviewer: 14000, tester: 8000 } },
        cwd: 'D:\\projects\\pawcastcam-pipeline', triage: 'bugfix', result: 'failed',
      },
      {
        runId: 'r-20260809-1', startedAt: '2026-08-09T08:40:00Z', durationMs: 720000,
        phaseDurations: { '0': 20000, '3': 420000, '4': 200000, '6': 60000, done: 20000 },
        findings: { blocker: 0, major: 0, minor: 3 }, fixLoops: 0, firstVerifyGreen: true,
        tokens: { perAgentRole: { implementer: 22000, reviewer: 6000, tester: 4000 } },
        cwd: 'D:\\projects\\keywordgap', triage: 'trivial', result: 'ok',
      },
      {
        runId: 'r-20260809-2', startedAt: '2026-08-09T15:55:00Z', durationMs: 1800000,
        phaseDurations: { '0': 40000, '1': 200000, '2': 260000, '3': 600000, '4': 360000, '5': 240000, '6': 80000, done: 20000 },
        findings: { blocker: 0, major: 2, minor: 2 }, fixLoops: 1, firstVerifyGreen: false,
        tokens: { perAgentRole: { scout: 7000, planner: 6000, implementer: 38000, reviewer: 12000, tester: 7000 } },
        cwd: 'D:\\projects\\resonancetech', triage: 'feature', result: 'ok',
      },
      {
        runId: 'r-20260810-1', startedAt: '2026-08-10T11:00:00Z', durationMs: 1200000,
        phaseDurations: { '0': 30000, '1': 150000, '2': 180000, '3': 480000, '4': 240000, '6': 90000, done: 30000 },
        findings: { blocker: 0, major: 1, minor: 1 }, fixLoops: 0, firstVerifyGreen: true,
        tokens: { perAgentRole: { scout: 6000, planner: 5000, implementer: 34000, reviewer: 11000, tester: 6000 } },
        cwd: 'D:\\projects\\writerzen', triage: 'refactor', result: 'ok',
      },
      {
        runId: 'r-20260811-1', startedAt: '2026-08-11T09:30:00Z', durationMs: 900000,
        phaseDurations: { '0': 20000, '3': 540000, '4': 220000, '5': 90000, '6': 20000, done: 10000 },
        findings: { blocker: 0, major: 0, minor: 1 }, fixLoops: 1, firstVerifyGreen: true,
        tokens: { perAgentRole: { implementer: 26000, reviewer: 8000, tester: 5000 } },
        cwd: 'D:\\projects\\keywordgap', triage: 'trivial', result: 'ok',
      },
      {
        runId: 'r-20260812-1', startedAt: '2026-08-12T08:15:00Z', durationMs: 1980000,
        phaseDurations: { '0': 30000, '1': 180000, '2': 220000, '3': 720000, '4': 420000, '5': 360000, '6': 50000 },
        findings: { blocker: 1, major: 1, minor: 0 }, fixLoops: 2, firstVerifyGreen: false,
        tokens: { perAgentRole: { scout: 8000, planner: 6000, implementer: 41000, reviewer: 13000, tester: 6000 } },
        cwd: 'D:\\projects\\pawcastcam-pipeline', triage: 'feature', result: 'n/a', partial: true,
      },
    ],
    daily: [
      { date: '2026-08-06', tasksCompleted: 1, avgDurationMs: 2520000, tokens: 80000 },
      { date: '2026-08-07', tasksCompleted: 1, avgDurationMs: 1080000, tokens: 45000 },
      { date: '2026-08-08', tasksCompleted: 0, avgDurationMs: 0, tokens: 70000 },
      { date: '2026-08-09', tasksCompleted: 2, avgDurationMs: 1260000, tokens: 102000 },
      { date: '2026-08-10', tasksCompleted: 1, avgDurationMs: 1200000, tokens: 62000 },
      { date: '2026-08-11', tasksCompleted: 1, avgDurationMs: 900000, tokens: 39000 },
      { date: '2026-08-12', tasksCompleted: 0, avgDurationMs: 0, tokens: 74000 },
    ],
    perRepo: [
      { cwd: 'D:\\projects\\keywordgap', runs: 3, avgDurationMs: 1380000, tokens: 151000 },
      { cwd: 'D:\\projects\\writerzen', runs: 2, avgDurationMs: 1140000, tokens: 107000 },
      { cwd: 'D:\\projects\\pawcastcam-pipeline', runs: 2, avgDurationMs: 1740000, tokens: 144000 },
      { cwd: 'D:\\projects\\resonancetech', runs: 1, avgDurationMs: 1800000, tokens: 70000 },
    ],
  };

  // ---- generic helpers -----------------------------------------------------

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        if (key === 'class') node.className = attrs[key];
        else if (key === 'html') node.innerHTML = attrs[key];
        else node.setAttribute(key, attrs[key]);
      });
    }
    (children || []).forEach(function (child) {
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return node;
  }

  function svg(tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) { node.setAttribute(key, attrs[key]); });
    }
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function repoName(cwd) {
    if (!cwd) return 'unknown';
    const parts = String(cwd).replace(/[\\/]+$/, '').split(/[\\/]/);
    return parts[parts.length - 1] || cwd;
  }

  function formatMs(ms) {
    if (!ms || ms <= 0) return '\u2014';
    const totalSec = Math.round(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return h + 'h ' + m + 'm';
    if (m > 0) return m + 'm ' + s + 's';
    return s + 's';
  }

  function formatCompact(n) {
    if (!n) return '0';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
    return String(Math.round(n));
  }

  function formatDate(dateStr) {
    const parts = String(dateStr).split('-');
    return parts.length === 3 ? parts[1] + '-' + parts[2] : dateStr;
  }

  // tokens may arrive as a plain number, a usage object ({input, cacheCreation,
  // cacheRead, output}), or (one level deep) a map of such values — normalize
  // any of those shapes down to a single number.
  function tokenValueOf(v) {
    if (typeof v === 'number') return v;
    if (v && typeof v === 'object') {
      if ('input' in v || 'output' in v || 'cacheCreation' in v || 'cacheRead' in v) {
        return (v.input || 0) + (v.cacheCreation || 0) + (v.cacheRead || 0) + (v.output || 0);
      }
      return Object.keys(v).reduce(function (sum, key) { return sum + tokenValueOf(v[key]); }, 0);
    }
    return 0;
  }

  // Schema names the run-level token breakdown "perAgentRole"; some callers
  // use "perRole". Accept either, or a bare role map, so this keeps working
  // regardless of which the server ends up emitting.
  function roleTokenMap(run) {
    const t = run && run.tokens;
    if (!t || typeof t !== 'object') return {};
    const map = t.perAgentRole || t.perRole || t;
    const out = {};
    Object.keys(map).forEach(function (role) { out[role] = tokenValueOf(map[role]); });
    return out;
  }

  function runTokenTotal(run) {
    const map = roleTokenMap(run);
    return Object.keys(map).reduce(function (sum, role) { return sum + map[role]; }, 0);
  }

  function legend(entries) {
    const wrap = el('div', { class: 'legend' });
    entries.forEach(function (entry) {
      wrap.appendChild(el('span', { class: 'legend-item' }, [
        el('span', { class: 'legend-swatch', style: 'background:' + entry.color }),
        entry.label,
      ]));
    });
    return wrap;
  }

  // ---- stat tiles ------------------------------------------------------

  function renderStatTiles(runs, daily) {
    const container = document.getElementById('stat-tiles');
    clear(container);

    const completed = runs.filter(function (r) { return r.result === 'ok'; });
    const avgDuration = completed.length
      ? completed.reduce(function (sum, r) { return sum + (r.durationMs || 0); }, 0) / completed.length
      : 0;
    const greenCount = completed.filter(function (r) { return r.firstVerifyGreen; }).length;
    const greenPct = completed.length ? Math.round((greenCount / completed.length) * 100) : null;
    const totalTokens = daily.length
      ? daily.reduce(function (sum, d) { return sum + tokenValueOf(d.tokens); }, 0)
      : runs.reduce(function (sum, r) { return sum + runTokenTotal(r); }, 0);

    const tiles = [
      { value: String(completed.length), label: 'Runs completed' },
      { value: formatMs(avgDuration), label: 'Avg duration' },
      { value: greenPct === null ? '\u2014' : greenPct + '%', label: 'First-verify green' },
      { value: formatCompact(totalTokens), label: 'Total tokens' },
    ];

    tiles.forEach(function (t) {
      container.appendChild(el('div', { class: 'tile' }, [
        el('span', { class: 'tile-value' }, [t.value]),
        el('span', { class: 'tile-label' }, [t.label]),
      ]));
    });
  }

  // ---- section 1: throughput over time ----------------------------------

  function renderThroughput(daily) {
    const container = document.getElementById('throughput-chart');
    clear(container);

    if (!daily.length) {
      container.appendChild(el('p', {}, ['No daily data yet.']));
      return;
    }

    const sorted = daily.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    const W = 760, H = 260;
    const marginTop = 24, marginBottom = 30, marginLeft = 10, marginRight = 10;
    const plotTop = marginTop, plotBottom = H - marginBottom;
    const plotHeight = plotBottom - plotTop;
    const plotLeft = marginLeft, plotRight = W - marginRight;
    const plotWidth = plotRight - plotLeft;

    const maxTasks = Math.max(1, Math.max.apply(null, sorted.map(function (d) { return d.tasksCompleted || 0; })));
    const maxDuration = Math.max(1, Math.max.apply(null, sorted.map(function (d) { return d.avgDurationMs || 0; })));

    const chart = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'chart-svg', role: 'img' });
    const slot = plotWidth / sorted.length;
    const barWidth = Math.min(40, slot * 0.5);

    const legendText = svg('text', { x: plotLeft, y: 12, fill: '#8b94a7', 'font-size': '11' });
    legendText.textContent = '\u25A0 tasks completed    \u2014 avg duration (line)';
    chart.appendChild(legendText);

    sorted.forEach(function (d, i) {
      const cx = plotLeft + slot * i + slot / 2;
      const barHeight = ((d.tasksCompleted || 0) / maxTasks) * plotHeight;
      const barX = cx - barWidth / 2;
      const barY = plotBottom - barHeight;

      chart.appendChild(svg('rect', {
        x: barX, y: barY, width: barWidth, height: Math.max(barHeight, 0),
        fill: '#facc15', rx: 2,
      }));

      if (d.tasksCompleted) {
        const label = svg('text', {
          x: cx, y: barY - 6, 'text-anchor': 'middle', fill: '#e6e9ef', 'font-size': '11',
        });
        label.textContent = String(d.tasksCompleted);
        chart.appendChild(label);
      }

      const dateLabel = svg('text', {
        x: cx, y: H - 8, 'text-anchor': 'middle', fill: '#8b94a7', 'font-size': '10',
      });
      dateLabel.textContent = formatDate(d.date);
      chart.appendChild(dateLabel);
    });

    const linePoints = sorted.map(function (d, i) {
      const cx = plotLeft + slot * i + slot / 2;
      const cy = plotBottom - ((d.avgDurationMs || 0) / maxDuration) * plotHeight;
      return { x: cx, y: cy, value: d.avgDurationMs || 0 };
    });

    if (linePoints.length > 1) {
      const pathD = linePoints.map(function (p, i) { return (i === 0 ? 'M' : 'L') + p.x + ',' + p.y; }).join(' ');
      chart.appendChild(svg('path', { d: pathD, fill: 'none', stroke: '#4ade80', 'stroke-width': 2 }));
    }
    linePoints.forEach(function (p) {
      chart.appendChild(svg('circle', { cx: p.x, cy: p.y, r: 3, fill: '#4ade80' }));
      if (p.value) {
        const label = svg('text', {
          x: p.x, y: p.y - 8, 'text-anchor': 'middle', fill: '#4ade80', 'font-size': '10',
        });
        label.textContent = formatMs(p.value);
        chart.appendChild(label);
      }
    });

    container.appendChild(chart);
  }

  // ---- section 2: time & progress ---------------------------------------

  function renderRunsTable(runs) {
    const container = document.getElementById('runs-table');
    clear(container);

    const recent = runs.slice().sort(function (a, b) {
      return String(b.startedAt).localeCompare(String(a.startedAt));
    }).slice(0, 10);

    const table = el('table', { class: 'data-table' }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', {}, ['Repo']),
          el('th', {}, ['Triage']),
          el('th', { class: 'num' }, ['Duration']),
          el('th', {}, ['Result']),
        ]),
      ]),
    ]);
    const tbody = el('tbody', {}, []);
    recent.forEach(function (r) {
      const resultText = r.result + (r.partial ? ' (partial)' : '');
      tbody.appendChild(el('tr', {}, [
        el('td', {}, [repoName(r.cwd)]),
        el('td', {}, [r.triage || '\u2014']),
        el('td', { class: 'num' }, [formatMs(r.durationMs)]),
        el('td', {}, [resultText]),
      ]));
    });
    table.appendChild(tbody);
    container.appendChild(table);
  }

  function renderPhaseBars(runs) {
    const legendContainer = document.getElementById('phase-legend');
    clear(legendContainer);
    legendContainer.appendChild(legend(PHASE_KEYS.map(function (key) {
      return { color: PHASE_COLORS[key], label: PHASE_LABELS[key] };
    })));

    const container = document.getElementById('phase-bars');
    clear(container);

    const recent = runs.slice().sort(function (a, b) {
      return String(b.startedAt).localeCompare(String(a.startedAt));
    }).slice(0, 10);

    if (!recent.length) {
      container.appendChild(el('p', {}, ['No runs yet.']));
      return;
    }

    recent.forEach(function (r) {
      const phases = r.phaseDurations || {};
      const total = PHASE_KEYS.reduce(function (sum, key) { return sum + (phases[key] || 0); }, 0);
      const barWidth = 400, barHeight = 14;
      const chart = svg('svg', { viewBox: '0 0 ' + barWidth + ' ' + barHeight, class: 'chart-svg', style: 'height:14px' });
      let x = 0;
      if (total > 0) {
        PHASE_KEYS.forEach(function (key) {
          const value = phases[key] || 0;
          if (!value) return;
          const w = (value / total) * barWidth;
          chart.appendChild(svg('rect', { x: x, y: 0, width: w, height: barHeight, fill: PHASE_COLORS[key] }));
          x += w;
        });
      } else {
        chart.appendChild(svg('rect', { x: 0, y: 0, width: barWidth, height: barHeight, fill: '#232733' }));
      }

      const row = el('div', { class: 'run-row' }, [
        el('span', { class: 'run-label' }, [repoName(r.cwd) + ' \u00b7 ' + (r.triage || '')]),
        el('span', { class: 'run-bar' }, [chart]),
        el('span', { class: 'run-note' }, [formatMs(total)]),
      ]);
      container.appendChild(row);
    });
  }

  function renderTimeProgress(runs) {
    renderRunsTable(runs);
    renderPhaseBars(runs);
  }

  // ---- section 3: quality -------------------------------------------------

  function renderQuality(runs) {
    const headline = document.getElementById('quality-headline');
    clear(headline);
    const completed = runs.filter(function (r) { return r.result === 'ok'; });
    const greenCount = completed.filter(function (r) { return r.firstVerifyGreen; }).length;
    const pct = completed.length ? Math.round((greenCount / completed.length) * 100) : null;
    headline.appendChild(el('span', {}, [
      'First-verify green: ',
      el('strong', {}, [pct === null ? '\u2014' : pct + '%']),
      ' (' + greenCount + ' of ' + completed.length + ' completed runs)',
    ]));

    const legendContainer = document.getElementById('findings-legend');
    clear(legendContainer);
    legendContainer.appendChild(legend([
      { color: SEVERITY_COLORS.blocker, label: 'Blocker' },
      { color: SEVERITY_COLORS.major, label: 'Major' },
      { color: SEVERITY_COLORS.minor, label: 'Minor' },
    ]));

    const container = document.getElementById('findings-bars');
    clear(container);

    const recent = runs.slice().sort(function (a, b) {
      return String(b.startedAt).localeCompare(String(a.startedAt));
    }).slice(0, 10);

    if (!recent.length) {
      container.appendChild(el('p', {}, ['No runs yet.']));
      return;
    }

    const maxTotal = Math.max(1, Math.max.apply(null, recent.map(function (r) {
      const f = r.findings || {};
      return (f.blocker || 0) + (f.major || 0) + (f.minor || 0);
    })));

    recent.forEach(function (r) {
      const f = r.findings || {};
      const blocker = f.blocker || 0, major = f.major || 0, minor = f.minor || 0;
      const total = blocker + major + minor;
      const barWidth = 300, barHeight = 14;
      const chart = svg('svg', { viewBox: '0 0 ' + barWidth + ' ' + barHeight, class: 'chart-svg', style: 'height:14px' });
      let x = 0;
      [['blocker', blocker], ['major', major], ['minor', minor]].forEach(function (pair) {
        const value = pair[1];
        if (!value) return;
        const w = (value / maxTotal) * barWidth;
        chart.appendChild(svg('rect', { x: x, y: 0, width: w, height: barHeight, fill: SEVERITY_COLORS[pair[0]] }));
        x += w;
      });
      if (!total) {
        chart.appendChild(svg('rect', { x: 0, y: 0, width: 4, height: barHeight, fill: '#232733' }));
      }

      const countsText = blocker + ' blocker, ' + major + ' major, ' + minor + ' minor';
      const row = el('div', { class: 'run-row' }, [
        el('span', { class: 'run-label' }, [repoName(r.cwd) + ' \u00b7 ' + (r.triage || '')]),
        el('span', { class: 'run-bar' }, [chart]),
        el('span', { class: 'run-note' }, [countsText + ' \u00b7 loops: ' + (r.fixLoops || 0)]),
      ]);
      container.appendChild(row);
    });
  }

  // ---- section 4: token cost ----------------------------------------------

  function renderTokensDaily(daily) {
    const container = document.getElementById('tokens-daily-chart');
    clear(container);

    if (!daily.length) {
      container.appendChild(el('p', {}, ['No daily data yet.']));
      return;
    }

    const sorted = daily.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    const W = 760, H = 200;
    const marginTop = 20, marginBottom = 26;
    const plotTop = marginTop, plotBottom = H - marginBottom;
    const plotHeight = plotBottom - plotTop;
    const plotWidth = W - 20;
    const maxTokens = Math.max(1, Math.max.apply(null, sorted.map(function (d) { return tokenValueOf(d.tokens); })));
    const slot = plotWidth / sorted.length;
    const barWidth = Math.min(40, slot * 0.5);

    const chart = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'chart-svg', role: 'img' });
    sorted.forEach(function (d, i) {
      const value = tokenValueOf(d.tokens);
      const cx = 10 + slot * i + slot / 2;
      const barHeight = (value / maxTokens) * plotHeight;
      const barX = cx - barWidth / 2;
      const barY = plotBottom - barHeight;
      chart.appendChild(svg('rect', { x: barX, y: barY, width: barWidth, height: Math.max(barHeight, 0), fill: '#38bdf8', rx: 2 }));
      if (value) {
        const label = svg('text', { x: cx, y: barY - 6, 'text-anchor': 'middle', fill: '#e6e9ef', 'font-size': '11' });
        label.textContent = formatCompact(value);
        chart.appendChild(label);
      }
      const dateLabel = svg('text', { x: cx, y: H - 8, 'text-anchor': 'middle', fill: '#8b94a7', 'font-size': '10' });
      dateLabel.textContent = formatDate(d.date);
      chart.appendChild(dateLabel);
    });
    container.appendChild(chart);
  }

  function renderTokensPerRole(runs) {
    const container = document.getElementById('tokens-role-chart');
    clear(container);

    const totals = {};
    runs.forEach(function (r) {
      const map = roleTokenMap(r);
      Object.keys(map).forEach(function (role) {
        totals[role] = (totals[role] || 0) + map[role];
      });
    });
    const roles = Object.keys(totals).sort(function (a, b) { return totals[b] - totals[a]; });

    if (!roles.length) {
      container.appendChild(el('p', {}, ['No token data yet.']));
      return;
    }

    const maxValue = Math.max.apply(null, roles.map(function (role) { return totals[role]; }));
    const rowHeight = 20, barMaxWidth = 300, labelWidth = 90, valueWidth = 60;
    const W = labelWidth + barMaxWidth + valueWidth + 10;
    const H = roles.length * rowHeight + 10;
    const chart = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'chart-svg' });

    roles.forEach(function (role, i) {
      const value = totals[role];
      const y = i * rowHeight + 5;
      const w = maxValue ? (value / maxValue) * barMaxWidth : 0;
      const color = ROLE_COLORS[role] || PALETTE[i % PALETTE.length];

      const label = svg('text', { x: 0, y: y + 11, fill: '#8b94a7', 'font-size': '11' });
      label.textContent = role;
      chart.appendChild(label);

      chart.appendChild(svg('rect', { x: labelWidth, y: y, width: Math.max(w, 1), height: 12, fill: color, rx: 2 }));

      const valueLabel = svg('text', { x: labelWidth + barMaxWidth + 8, y: y + 11, fill: '#e6e9ef', 'font-size': '11' });
      valueLabel.textContent = formatCompact(value);
      chart.appendChild(valueLabel);
    });

    container.appendChild(chart);
  }

  function renderTokensPerRepo(perRepo) {
    const container = document.getElementById('tokens-repo-table');
    clear(container);

    if (!perRepo.length) {
      container.appendChild(el('p', {}, ['No per-repo data yet.']));
      return;
    }

    const sorted = perRepo.slice().sort(function (a, b) { return tokenValueOf(b.tokens) - tokenValueOf(a.tokens); });
    const table = el('table', { class: 'data-table' }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', {}, ['Repo']),
          el('th', { class: 'num' }, ['Runs']),
          el('th', { class: 'num' }, ['Avg duration']),
          el('th', { class: 'num' }, ['Tokens']),
        ]),
      ]),
    ]);
    const tbody = el('tbody', {}, []);
    sorted.forEach(function (r) {
      tbody.appendChild(el('tr', {}, [
        el('td', {}, [repoName(r.cwd)]),
        el('td', { class: 'num' }, [String(r.runs || 0)]),
        el('td', { class: 'num' }, [formatMs(r.avgDurationMs)]),
        el('td', { class: 'num' }, [tokenValueOf(r.tokens).toLocaleString()]),
      ]));
    });
    table.appendChild(tbody);
    container.appendChild(table);
  }

  function renderTokenCost(daily, runs, perRepo) {
    renderTokensDaily(daily);
    renderTokensPerRole(runs);
    renderTokensPerRepo(perRepo);
  }

  // ---- top-level render / init --------------------------------------------

  function render(data) {
    const runs = Array.isArray(data && data.runs) ? data.runs : [];
    const daily = Array.isArray(data && data.daily) ? data.daily : [];
    const perRepo = Array.isArray(data && data.perRepo) ? data.perRepo : [];

    const app = document.getElementById('app');
    const empty = document.getElementById('empty-state');

    if (!runs.length) {
      app.hidden = true;
      empty.hidden = false;
      return;
    }

    empty.hidden = true;
    app.hidden = false;

    renderStatTiles(runs, daily);
    renderThroughput(daily);
    renderTimeProgress(runs);
    renderQuality(runs);
    renderTokenCost(daily, runs, perRepo);
  }

  function init() {
    const banner = document.getElementById('demo-banner');
    const useDemo = /(?:^|[?&])demo(?:&|$|=)/.test(location.search);

    if (useDemo) {
      banner.hidden = false;
      render(DEMO_DATA);
      return;
    }

    fetch('/api/history')
      .then(function (res) {
        if (!res.ok) throw new Error('bad response: ' + res.status);
        return res.json();
      })
      .then(function (data) { render(data); })
      .catch(function () {
        banner.hidden = false;
        render(DEMO_DATA);
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
