/**
 * PulseWatch — charts.js
 * Chart.js wrappers for latency, uptime, server metrics, and sparklines.
 * Chart.js is loaded from CDN in each HTML page.
 */

'use strict';

import { fmtDateTime, fmtMs } from './utils.js';

// ─── Shared defaults ─────────────────────────────────────────────────────────
const FONT_FAMILY = "'Inter', system-ui, sans-serif";
const COLOR = {
  accent:   '#3b82f6',
  success:  '#22c55e',
  warn:     '#f59e0b',
  danger:   '#ef4444',
  muted:    'rgba(148,163,184,0.35)',
  gridLine: 'rgba(148,163,184,0.12)',
  text:     '#94a3b8',
  fill:     'rgba(59,130,246,0.10)',
};

function base() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#1e293b',
        borderColor: 'rgba(148,163,184,0.2)',
        borderWidth: 1,
        titleColor: '#e2e8f0',
        bodyColor: '#94a3b8',
        padding: 10,
        cornerRadius: 6,
        titleFont: { family: FONT_FAMILY, size: 11 },
        bodyFont:  { family: FONT_FAMILY, size: 12 },
      },
    },
    scales: {
      x: {
        grid: { color: COLOR.gridLine, drawBorder: false },
        ticks: { color: COLOR.text, font: { family: FONT_FAMILY, size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 },
      },
      y: {
        grid: { color: COLOR.gridLine, drawBorder: false },
        ticks: { color: COLOR.text, font: { family: FONT_FAMILY, size: 10 } },
        beginAtZero: true,
      },
    },
  };
}

function timeLabels(series, bucketKey = 'bucket') {
  return series.map(d => {
    const dt = new Date(d[bucketKey]);
    return isNaN(dt) ? '' : dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  });
}

// ─── Latency chart ────────────────────────────────────────────────────────────
export function createLatencyChart(canvasId, series = []) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !window.Chart) return null;
  const labels = timeLabels(series);
  const cfg = {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Avg',
          data: series.map(d => d.avg_ms),
          borderColor: COLOR.accent,
          backgroundColor: COLOR.fill,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          fill: true,
          tension: 0.3,
        },
        {
          label: 'P95',
          data: series.map(d => d.p95_ms),
          borderColor: COLOR.warn,
          backgroundColor: 'transparent',
          borderWidth: 1.5,
          borderDash: [4, 3],
          pointRadius: 0,
          pointHoverRadius: 3,
          fill: false,
          tension: 0.3,
        },
        {
          label: 'P99',
          data: series.map(d => d.p99_ms),
          borderColor: COLOR.danger,
          backgroundColor: 'transparent',
          borderWidth: 1,
          borderDash: [2, 4],
          pointRadius: 0,
          pointHoverRadius: 3,
          fill: false,
          tension: 0.3,
        },
      ],
    },
    options: {
      ...base(),
      plugins: {
        ...base().plugins,
        legend: {
          display: true,
          position: 'top',
          align: 'end',
          labels: { color: COLOR.text, font: { family: FONT_FAMILY, size: 11 }, boxWidth: 12, padding: 12 },
        },
        tooltip: {
          ...base().plugins.tooltip,
          callbacks: {
            title:  (items) => fmtDateTime(series[items[0].dataIndex]?.bucket),
            label:  (item)  => ` ${item.dataset.label}: ${fmtMs(item.raw)}`,
          },
        },
      },
      scales: {
        ...base().scales,
        y: {
          ...base().scales.y,
          ticks: {
            ...base().scales.y.ticks,
            callback: (v) => fmtMs(v),
          },
        },
      },
    },
  };
  const chart = new Chart(canvas, cfg);
  return {
    chart,
    update(newSeries) {
      const lbl = timeLabels(newSeries);
      chart.data.labels = lbl;
      chart.data.datasets[0].data = newSeries.map(d => d.avg_ms);
      chart.data.datasets[1].data = newSeries.map(d => d.p95_ms);
      chart.data.datasets[2].data = newSeries.map(d => d.p99_ms);
      chart.update('none');
    },
  };
}

// ─── Dashboard latency chart (avg + failures overlay) ─────────────────────────
export function createDashboardChart(canvasId, series = []) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !window.Chart) return null;
  const labels = timeLabels(series);
  const chart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Avg Latency',
          data: series.map(d => d.avg_ms),
          borderColor: COLOR.accent,
          backgroundColor: COLOR.fill,
          borderWidth: 2,
          pointRadius: 0,
          fill: true,
          tension: 0.3,
          yAxisID: 'yLatency',
        },
        {
          label: 'Failures',
          data: series.map(d => d.failures),
          borderColor: COLOR.danger,
          backgroundColor: 'rgba(239,68,68,0.15)',
          borderWidth: 1.5,
          pointRadius: 0,
          fill: true,
          type: 'bar',
          yAxisID: 'yFailures',
        },
      ],
    },
    options: {
      ...base(),
      plugins: {
        ...base().plugins,
        legend: {
          display: true,
          position: 'top',
          align: 'end',
          labels: { color: COLOR.text, font: { family: FONT_FAMILY, size: 11 }, boxWidth: 12 },
        },
      },
      scales: {
        x: base().scales.x,
        yLatency: {
          type: 'linear',
          position: 'left',
          grid: { color: COLOR.gridLine, drawBorder: false },
          ticks: { color: COLOR.text, font: { family: FONT_FAMILY, size: 10 }, callback: (v) => fmtMs(v) },
          beginAtZero: true,
        },
        yFailures: {
          type: 'linear',
          position: 'right',
          grid: { display: false },
          ticks: { color: COLOR.danger, font: { family: FONT_FAMILY, size: 10 } },
          beginAtZero: true,
        },
      },
    },
  });
  return {
    chart,
    update(newSeries) {
      chart.data.labels = timeLabels(newSeries);
      chart.data.datasets[0].data = newSeries.map(d => d.avg_ms);
      chart.data.datasets[1].data = newSeries.map(d => d.failures);
      chart.update('none');
    },
  };
}

// ─── Server metric chart (CPU / RAM / Disk over time) ─────────────────────────
export function createServerChart(canvasId, series = [], keys = ['cpu','memory','disk']) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !window.Chart) return null;
  const labels  = timeLabels(series);
  const palette = [COLOR.accent, COLOR.success, COLOR.warn, COLOR.danger];
  const keyLabels = { cpu: 'CPU', memory: 'RAM', disk: 'Disk', load1: 'Load', rx_delta: 'RX', tx_delta: 'TX' };

  const datasets = keys.map((key, i) => ({
    label: keyLabels[key] ?? key,
    data: series.map(d => d[key]),
    borderColor: palette[i % palette.length],
    backgroundColor: 'transparent',
    borderWidth: 2,
    pointRadius: 0,
    tension: 0.3,
    fill: false,
  }));

  const chart = new Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: {
      ...base(),
      plugins: {
        ...base().plugins,
        legend: {
          display: keys.length > 1,
          position: 'top',
          align: 'end',
          labels: { color: COLOR.text, font: { family: FONT_FAMILY, size: 11 }, boxWidth: 12 },
        },
      },
      scales: {
        x: base().scales.x,
        y: {
          ...base().scales.y,
          max: keys.every(k => ['cpu','memory','disk'].includes(k)) ? 100 : undefined,
          ticks: { ...base().scales.y.ticks, callback: (v) => keys.some(k => ['cpu','memory','disk'].includes(k)) ? v + '%' : v },
        },
      },
    },
  });

  return {
    chart,
    update(newSeries) {
      chart.data.labels = timeLabels(newSeries);
      keys.forEach((key, i) => { chart.data.datasets[i].data = newSeries.map(d => d[key]); });
      chart.update('none');
    },
  };
}

// ─── Uptime percent bar chart (daily, 30d) ─────────────────────────────────────
export function createUptimeChart(canvasId, rollups = []) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !window.Chart) return null;
  const labels = rollups.map(d => {
    const dt = new Date(d.bucket ?? d.day);
    return isNaN(dt) ? '' : dt.toLocaleDateString([], { month: 'short', day: 'numeric' });
  });
  const data = rollups.map(d => {
    const checks = parseInt(d.checks, 10) || 0;
    const fail   = parseInt(d.failures, 10) || 0;
    return checks ? ((checks - fail) / checks * 100) : 100;
  });

  const chart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: data.map(v => v >= 99.9 ? COLOR.success : v >= 95 ? COLOR.warn : COLOR.danger),
        borderRadius: 2,
        borderSkipped: false,
      }],
    },
    options: {
      ...base(),
      plugins: {
        ...base().plugins,
        tooltip: {
          ...base().plugins.tooltip,
          callbacks: {
            label: (item) => ` Uptime: ${item.raw.toFixed(3)}%`,
          },
        },
      },
      scales: {
        x: { ...base().scales.x },
        y: { ...base().scales.y, min: 95, max: 100, ticks: { ...base().scales.y.ticks, callback: (v) => v + '%' } },
      },
    },
  });
  return { chart };
}

// ─── Analytics: aggregated latency ────────────────────────────────────────────
export function createAnalyticsLatencyChart(canvasId, series = []) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !window.Chart) return null;
  const labels = series.map(d => {
    const dt = new Date(d.bucket ?? d.day);
    return isNaN(dt) ? '' : dt.toLocaleDateString([], { month: 'short', day: 'numeric' });
  });
  const chart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Avg',  data: series.map(d => d.avg_ms),  borderColor: COLOR.accent,  backgroundColor: COLOR.fill, fill: true,  borderWidth: 2, pointRadius: 0, tension: 0.3 },
        { label: 'P50',  data: series.map(d => d.p50_ms),  borderColor: COLOR.success, backgroundColor: 'transparent', fill: false, borderWidth: 1.5, pointRadius: 0, tension: 0.3, borderDash: [5,3] },
        { label: 'P95',  data: series.map(d => d.p95_ms),  borderColor: COLOR.warn,    backgroundColor: 'transparent', fill: false, borderWidth: 1.5, pointRadius: 0, tension: 0.3, borderDash: [3,3] },
        { label: 'P99',  data: series.map(d => d.p99_ms),  borderColor: COLOR.danger,  backgroundColor: 'transparent', fill: false, borderWidth: 1,   pointRadius: 0, tension: 0.3, borderDash: [2,4] },
      ],
    },
    options: {
      ...base(),
      plugins: {
        ...base().plugins,
        legend: { display: true, position: 'top', align: 'end', labels: { color: COLOR.text, font: { family: FONT_FAMILY, size: 11 }, boxWidth: 12 } },
        tooltip: { ...base().plugins.tooltip, callbacks: { label: (item) => ` ${item.dataset.label}: ${fmtMs(item.raw)}` } },
      },
      scales: { x: base().scales.x, y: { ...base().scales.y, ticks: { ...base().scales.y.ticks, callback: (v) => fmtMs(v) } } },
    },
  });
  return { chart, update(s) { chart.data.labels = timeLabels(s); ['avg_ms','p50_ms','p95_ms','p99_ms'].forEach((k,i) => { chart.data.datasets[i].data = s.map(d => d[k]); }); chart.update('none'); } };
}

// ─── Doughnut (incident severity breakdown) ───────────────────────────────────
export function createIncidentDonut(canvasId, down = 0, degraded = 0) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !window.Chart) return null;
  const chart = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: ['Down', 'Degraded'],
      datasets: [{ data: [down, degraded], backgroundColor: [COLOR.danger, COLOR.warn], borderWidth: 0, hoverOffset: 4 }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '72%',
      plugins: {
        legend: { display: true, position: 'bottom', labels: { color: COLOR.text, font: { family: FONT_FAMILY, size: 11 }, padding: 12 } },
        tooltip: { ...base().plugins.tooltip },
      },
    },
  });
  return { chart, update(d, dg) { chart.data.datasets[0].data = [d, dg]; chart.update('none'); } };
}
