const DIMENSION_ORDER = ['erp', 'turnover', 'margin', 'etf_flow', 'ma', 'vix', 'north'];

const DIMENSION_META = {
  erp: { name: 'ERP 股权风险溢价', direction: 'low_red' },
  turnover: { name: '换手率', direction: 'high_red' },
  margin: { name: '两融交易占比', direction: 'high_red' },
  etf_flow: { name: 'ETF净流向', direction: 'low_red' },
  ma: { name: '均线', direction: 'special' },
  vix: { name: 'VIX', direction: 'low_red' },
  north: { name: '北向资金', direction: 'low_red' },
};

const TIMELINE_POINTS = [
  { date: '2024-02', label: '24.2', type: 'green', desc: '反弹' },
  { date: '2024-05', label: '24.5', type: 'red', desc: '大跌起点' },
  { date: '2024-09', label: '24.9', type: 'green', desc: '见大底' },
  { date: '2024-10', label: '24.10', type: 'red', desc: '924高点' },
  { date: '2025-04', label: '25.4', type: 'red', desc: '暴跌' },
  { date: '2025-10', label: '25.10', type: 'red', desc: '回调' },
  { date: '2026-01', label: '26.1', type: 'red', desc: '科创回调' },
  { date: '2026-03', label: '26.3', type: 'green', desc: '反弹' },
  { date: '2026-07', label: '26.7', type: 'green', desc: '见底' },
];

const BACKTEST_DATES = [
  { date: '2024-02-06', label: '24.2' },
  { date: '2024-05-20', label: '24.5' },
  { date: '2024-09-24', label: '24.9' },
  { date: '2024-10-08', label: '24.10' },
  { date: '2025-04-07', label: '25.4' },
  { date: '2025-10-28', label: '25.10' },
  { date: '2026-01-27', label: '26.1' },
  { date: '2026-03-24', label: '26.3' },
  { date: '2026-07-20', label: '26.7' },
];

function findClosestDate(dates, target) {
  let closest = null;
  let minDiff = Infinity;
  const targetTime = new Date(target).getTime();
  for (const d of dates) {
    const diff = Math.abs(new Date(d).getTime() - targetTime);
    if (diff < minDiff) {
      minDiff = diff;
      closest = d;
    }
  }
  return closest;
}

const STATUS_LABELS = {
  red: '顶部预警',
  yellow: '中性',
  green: '底部信号',
  gray: '数据缺失',
};

const THRESHOLD_COLORS = {
  red: '#fecaca',
  yellow: '#fde68a',
  green: '#bbf7d0',
  gray: '#d6d3d1',
};

let charts = [];

async function loadData() {
  try {
    const [latestRes, signalsRes] = await Promise.all([
      fetch('data/latest.json'),
      fetch('data/signals.json'),
    ]);
    const latest = await latestRes.json();
    const signals = await signalsRes.json();
    return { latest, signals };
  } catch (e) {
    document.getElementById('date').textContent = '数据加载失败';
    document.getElementById('date').style.color = '#dc2626';
    console.error('load error:', e);
    return null;
  }
}

function renderHeader(latest) {
  document.getElementById('date').textContent = latest.date;
  document.getElementById('update-time').textContent = '更新于 ' + latest.update_time;
}

function renderLights(signals) {
  const grid = document.getElementById('lights-grid');
  grid.innerHTML = '';
  DIMENSION_ORDER.forEach(key => {
    const sig = signals.signals[key];
    if (!sig) return;
    const meta = DIMENSION_META[key];
    const card = document.createElement('div');
    card.className = 'light-card ' + sig.status;
    card.title = sig.note;
    card.innerHTML = `
      <div class="light-dot"></div>
      <div class="light-label">${meta.name}</div>
    `;
    grid.appendChild(card);
  });
}

function renderSummary(signals) {
  const el = document.getElementById('summary');
  const items = [
    { status: 'red', label: '顶部预警', count: signals.red_count },
    { status: 'yellow', label: '中性', count: signals.yellow_count },
    { status: 'green', label: '底部信号', count: signals.green_count },
    { status: 'gray', label: '数据缺失', count: signals.gray_count },
  ];
  el.innerHTML = items.map(i => `
    <div class="summary-item">
      <div class="summary-dot ${i.status}"></div>
      <span>${i.label} ${i.count}</span>
    </div>
  `).join('');
}

function renderDimensions(latest, signals) {
  const grid = document.getElementById('dimensions-grid');
  grid.innerHTML = '';
  charts = [];

  DIMENSION_ORDER.forEach((key, idx) => {
    const data = latest.dimensions[key];
    const sig = signals.signals[key];
    if (!data || !sig) return;

    const meta = DIMENSION_META[key];
    const card = document.createElement('div');
    card.className = 'dim-card';

    const valueDisplay = formatValue(data, sig);
    const thresholdBar = renderThresholdBar(data, sig, meta.direction);

    let etfSelector = '';
    if (key === 'etf_flow' && data.extra && data.extra.per_etf_history) {
      const etfNames = Object.keys(data.extra.per_etf_history);
      etfSelector = `<div class="etf-selector" id="etf-selector-${key}">
        <span class="etf-tag active" data-etf="合计">合计</span>
        ${etfNames.map(name => `<span class="etf-tag" data-etf="${name}">${name.replace('ETF','')}</span>`).join('')}
      </div>`;
    }

    card.innerHTML = `
      <div class="dim-card-header">
        <div>
          <div class="dim-card-title">${data.name || meta.name}</div>
          <div class="dim-card-sub">${data.subtitle || ''}</div>
        </div>
        <div class="dim-badge ${sig.status}">
          <div class="dim-badge-dot"></div>
          <span>${STATUS_LABELS[sig.status]}</span>
        </div>
      </div>
      <div class="dim-value">${valueDisplay}</div>
      <div class="dim-note">${sig.note || ''}</div>
      ${etfSelector}
      <div class="dim-chart" id="chart-${key}"></div>
      ${thresholdBar}
    `;
    grid.appendChild(card);

    setTimeout(() => {
      createChart(key, data, sig);
      if (etfSelector) {
        const selector = document.getElementById(`etf-selector-${key}`);
        if (selector) {
          selector.querySelectorAll('.etf-tag').forEach(tag => {
            tag.addEventListener('click', () => {
              selector.querySelectorAll('.etf-tag').forEach(t => t.classList.remove('active'));
              tag.classList.add('active');
              const etfName = tag.dataset.etf;
              const chartDom = document.getElementById('chart-' + key);
              if (chartDom && window.echarts) {
                const existing = echarts.getInstanceByDom(chartDom);
                if (existing) existing.dispose();
              }
              const histData = etfName === '合计' ? data : { ...data, history: data.extra.per_etf_history[etfName] || [] };
              createChart(key, histData, sig);
            });
          });
        }
      }
    }, 50 + idx * 30);
  });
}

function formatValue(data, sig) {
  if (sig.status === 'gray' || data.current_value === null || data.current_value === undefined) {
    return '<span style="color: var(--text-tertiary);">—</span>';
  }
  const val = data.current_value;
  const unit = data.unit || '';
  if (data.name === '均线') {
    const extra = data.extra || {};
    const pos = extra.position_vs_ma20;
    const days = extra.below_ma20_days || 0;
    return `<span>${val}</span><span class="dim-value-unit">点 · ${pos === 'above' ? '20日线上' : `20日线下${days}日`}</span>`;
  }
  return `<span>${val}</span><span class="dim-value-unit">${unit}</span>`;
}

function renderThresholdBar(data, sig, direction) {
  if (direction === 'special' || !data.thresholds) {
    return '';
  }
  let order;
  if (direction === 'low_red') {
    order = ['red', 'yellow', 'green'];
  } else {
    order = ['green', 'yellow', 'red'];
  }
  const grayClass = sig.status === 'gray' ? ' gray' : '';
  const t = data.thresholds;
  const labels = order.map(s => {
    if (s === 'red') return t.red || '';
    if (s === 'yellow') return t.yellow || '';
    if (s === 'green') return t.green || '';
  });
  return `
    <div class="dim-threshold-bar${grayClass}">
      <div style="flex: 2; background: ${THRESHOLD_COLORS[order[0]]};"></div>
      <div style="flex: 3; background: ${THRESHOLD_COLORS[order[1]]};"></div>
      <div style="flex: 2; background: ${THRESHOLD_COLORS[order[2]]};"></div>
    </div>
    <div class="dim-threshold-labels">
      <span>${labels[0]}</span>
      <span>${labels[1]}</span>
      <span>${labels[2]}</span>
    </div>
  `;
}

function createChart(key, data, sig) {
  const dom = document.getElementById('chart-' + key);
  if (!dom || !window.echarts) return;
  if (!data.history || data.history.length === 0) {
    dom.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-tertiary);font-size:11px;">暂无历史数据</div>';
    return;
  }

  const chart = echarts.init(dom);
  const dates = data.history.map(h => h.date);
  const values = data.history.map(h => h.value);
  const stats = data.stats || {};

  const markLines = [];
  if (stats.mean !== undefined) markLines.push({ yAxis: stats.mean, color: '#a8a29e', name: '均值' });
  if (stats.plus_1x !== undefined) markLines.push({ yAxis: stats.plus_1x, color: '#ca8a04', name: '+1X' });
  if (stats.minus_1x !== undefined) markLines.push({ yAxis: stats.minus_1x, color: '#ca8a04', name: '-1X' });

  const backtestMarks = BACKTEST_DATES.map(bt => {
    const closest = findClosestDate(dates, bt.date);
    return closest ? {
      xAxis: closest,
      lineStyle: { color: '#dc2626', type: 'solid', width: 1, opacity: 0.2 },
      label: { show: true, position: 'insideEndTop', formatter: bt.label, fontSize: 9, color: '#991b1b' },
    } : null;
  }).filter(Boolean);

  const lineColor = sig.status === 'red' ? '#dc2626' : sig.status === 'green' ? '#16a34a' : '#2563eb';
  const allMarks = [...markLines.map(m => ({ yAxis: m.yAxis, lineStyle: { color: m.color, type: 'dashed', width: 1 }, label: { show: false } })), ...backtestMarks];

  const option = {
    grid: { left: 5, right: 5, top: 14, bottom: 5 },
    xAxis: { type: 'category', data: dates, show: false, boundaryGap: false },
    yAxis: { type: 'value', show: false, scale: true },
    series: [{
      type: 'line',
      data: values,
      symbol: 'none',
      lineStyle: { width: 1.5, color: lineColor },
      areaStyle: { color: lineColor, opacity: 0.06 },
      markLine: allMarks.length > 0 ? {
        silent: true,
        symbol: 'none',
        data: allMarks,
      } : undefined,
    }],
    tooltip: {
      trigger: 'axis',
      formatter: params => {
        const p = params[0];
        return `${p.axisValue}<br/>${p.value}${data.unit || ''}`;
      },
      confine: true,
    },
  };

  chart.setOption(option);
  charts.push(chart);
}

function renderTimeline() {
  const bar = document.getElementById('timeline-bar');
  bar.innerHTML = '';
  TIMELINE_POINTS.forEach((point, idx) => {
    const el = document.createElement('div');
    el.className = 'timeline-point';
    el.innerHTML = `
      <div class="timeline-dot ${point.type}"></div>
      <div class="timeline-label">${point.label}</div>
    `;
    el.title = point.desc;
    el.addEventListener('click', () => loadSnapshot(point));
    bar.appendChild(el);

    if (idx < TIMELINE_POINTS.length - 1) {
      const line = document.createElement('div');
      line.className = 'timeline-line';
      bar.appendChild(line);
    }
  });
}

async function loadSnapshot(point) {
  const detail = document.getElementById('timeline-detail');
  detail.classList.remove('empty');
  detail.innerHTML = `<strong>${point.label} · ${point.desc}</strong><br>正在加载快照...`;

  const dateMap = {
    '2024-01': '2024-01-31',
    '2024-05': '2024-05-31',
    '2024-09': '2024-09-30',
    '2024-10': '2024-10-31',
    '2025-01': '2025-01-31',
    '2025-04': '2025-04-07',
    '2025-10': '2025-10-31',
    '2026-01': '2026-01-31',
    '2026-02': '2026-02-28',
    '2026-07': '2026-07-20',
  };
  const dateStr = dateMap[point.date];
  if (!dateStr) {
    detail.innerHTML = `<strong>${point.label} · ${point.desc}</strong><br><span style="color:var(--text-tertiary)">该时间点暂无快照数据（需运行历史回测生成）</span>`;
    detail.classList.add('empty');
    return;
  }

  try {
    const res = await fetch(`data/history/${dateStr}.json`);
    if (!res.ok) throw new Error('not found');
    const snapshot = await res.json();
    renderSnapshot(detail, point, snapshot);
  } catch (e) {
    detail.innerHTML = `<strong>${point.label} · ${point.desc}</strong><br><span style="color:var(--text-tertiary)">该时间点暂无快照数据（需运行历史回测生成）</span>`;
    detail.classList.add('empty');
  }
}

function renderSnapshot(container, point, snapshot) {
  const dims = snapshot.dimensions || {};
  const items = DIMENSION_ORDER.map(key => {
    const d = dims[key];
    if (!d) return `<div class="snapshot-item gray">—</div>`;
    const val = d.current_value;
    const valStr = val !== null && val !== undefined ? val : '—';
    let status = 'gray';
    if (d.extra && d.extra.below_ma20_days >= 3) status = 'red';
    return `<div class="snapshot-item ${status}" title="${DIMENSION_META[key].name}">${DIMENSION_META[key].name}<br>${valStr}</div>`;
  }).join('');
  container.innerHTML = `
    <strong>${point.label} · ${point.desc}</strong>
    <div class="snapshot-grid">${items}</div>
  `;
}

function handleResize() {
  charts.forEach(c => c && c.resize());
}

async function init() {
  const loaded = await loadData();
  if (!loaded) return;
  const { latest, signals } = loaded;
  renderHeader(latest);
  renderLights(signals);
  renderSummary(signals);
  renderDimensions(latest, signals);
  renderTimeline();
  window.addEventListener('resize', handleResize);
}

init();
