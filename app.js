const KOREA_DIMENSION_ORDER = ['vkospi', 'margin', 'liquidation', 'liquidation_ratio'];

const KOREA_DIMENSION_META = {
  vkospi: { name: 'VKOSPI', direction: 'low_red' },
  margin: { name: '融资余额', direction: 'high_red' },
  liquidation: { name: '强平金额', direction: 'low_red' },
  liquidation_ratio: { name: '强平比例', direction: 'low_red' },
};

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

function renderKoreaLights(signals) {
  const koreaSignals = signals.korea || {};
  const grid = document.getElementById('korea-lights-grid');
  if (!grid) return;
  grid.innerHTML = '';
  KOREA_DIMENSION_ORDER.forEach(key => {
    const sig = koreaSignals.signals ? koreaSignals.signals[key] : null;
    if (!sig) return;
    const meta = KOREA_DIMENSION_META[key];
    const card = document.createElement('div');
    card.className = 'light-card ' + sig.status;
    card.title = sig.note || '';
    card.innerHTML = `
      <div class="light-dot"></div>
      <div class="light-label">${meta.name}</div>
    `;
    grid.appendChild(card);
  });
}

function renderKoreaSummary(signals) {
  const koreaSignals = signals.korea || {};
  const el = document.getElementById('korea-summary');
  if (!el) return;
  const items = [
    { status: 'red', label: '顶部预警', count: koreaSignals.red_count || 0 },
    { status: 'yellow', label: '中性', count: koreaSignals.yellow_count || 0 },
    { status: 'green', label: '底部信号', count: koreaSignals.green_count || 0 },
    { status: 'gray', label: '数据缺失', count: koreaSignals.gray_count || 0 },
  ];
  el.innerHTML = items.map(i => `
    <div class="summary-item">
      <div class="summary-dot ${i.status}"></div>
      <span>${i.label} ${i.count}</span>
    </div>
  `).join('');
}

function renderKoreaDimensions(latest, signals) {
  const koreaLatest = latest.korea || {};
  const koreaSignals = signals.korea || {};
  const grid = document.getElementById('korea-dimensions-grid');
  if (!grid) return;
  grid.innerHTML = '';

  KOREA_DIMENSION_ORDER.forEach((key, idx) => {
    const data = koreaLatest[key];
    const sig = koreaSignals.signals ? koreaSignals.signals[key] : null;
    if (!data || !sig) return;

    const meta = KOREA_DIMENSION_META[key];
    const card = document.createElement('div');
    card.className = 'dim-card';

    const valueDisplay = formatKoreaValue(data, sig);
    const thresholdBar = renderThresholdBar(data, sig, meta.direction);

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
      <div class="dim-chart" id="chart-korea-${key}"></div>
      ${thresholdBar}
    `;
    grid.appendChild(card);

    setTimeout(() => {
      createKoreaChart(key, data, sig);
    }, 50 + idx * 30);
  });
}

function formatKoreaValue(data, sig) {
  if (sig.status === 'gray' || data.current_value === null || data.current_value === undefined) {
    return '<span style="color: var(--text-tertiary);">—</span>';
  }
  const val = data.current_value;
  const unit = data.unit || '';
  return `<span>${val}</span><span class="dim-value-unit">${unit}</span>`;
}

function createKoreaChart(key, data, sig) {
  const dom = document.getElementById('chart-korea-' + key);
  if (!dom || !window.echarts) return;
  if (!data.history || data.history.length === 0) {
    dom.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-tertiary);font-size:11px;">暂无历史数据</div>';
    return;
  }

  const chart = echarts.init(dom);
  const dates = data.history.map(h => h.date);
  const values = data.history.map(h => h.value);

  const lineColor = sig.status === 'red' ? '#dc2626' : sig.status === 'green' ? '#16a34a' : '#2563eb';

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

function handleResize() {
  charts.forEach(c => c && c.resize());
}

async function init() {
  const loaded = await loadData();
  if (!loaded) return;
  const { latest, signals } = loaded;
  renderHeader(latest);
  renderKoreaLights(signals);
  renderKoreaSummary(signals);
  renderKoreaDimensions(latest, signals);
  window.addEventListener('resize', handleResize);
}

init();
