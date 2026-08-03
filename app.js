const KOREA_DIMENSION_ORDER = ['investor_deposits', 'stability', 'leverage_14d', 'leverage_1d', 'leveraged_etf', 'margin', 'vkospi', 'liquidation', 'liquidation_ratio'];

const KOREA_DIMENSION_META = {
  vkospi: { name: 'VKOSPI', direction: 'low_red', displayUnit: '' },
  margin: { name: '融资余额', direction: 'high_red', displayUnit: '' },
  liquidation: { name: '强平金额', direction: 'low_red', displayUnit: '亿' },
  liquidation_ratio: { name: '强平比例', direction: 'low_red', displayUnit: '%' },
  investor_deposits: { name: '存管金 & R2', direction: 'special', displayUnit: '' },
  stability: { name: '存管金稳定性', direction: 'special', displayUnit: '' },
  leverage_1d: { name: '单日杠杆比率状态', direction: 'special', displayUnit: '' },
  leverage_14d: { name: '两周杠杆比率趋势', direction: 'special', displayUnit: '' },
  leveraged_etf: { name: '杠杆ETF净流入', direction: 'special', displayUnit: '' },
};

const STATUS_LABELS = {
  red: '危险',
  yellow: '警戒',
  green: '安全',
  gray: '数据缺失',
};

function formatChartDates(history) {
  if (!history || history.length === 0) return [];
  const years = new Set(history.map(h => h.date.slice(0, 4)));
  if (years.size <= 1) {
    return history.map(h => h.date.slice(5));
  }
  return history.map(h => {
    const yr = h.date.slice(2, 4);
    const mo = h.date.slice(5, 7);
    const da = h.date.slice(8, 10);
    return yr + '/' + mo + '/' + da;
  });
}

const THRESHOLD_COLORS = {
  red: '#fecaca',
  yellow: '#fef08a',
  green: '#bbf7d0',
  gray: '#d6d3d1',
};

function getThresholdTag(currentValue, thresholds, direction, unit) {
  if (currentValue == null || !thresholds) return '';
  const unitStr = unit || '';
  const parseNum = (s) => { const m = String(s).match(/-?[\d.]+/); return m ? parseFloat(m[0]) : null; };
  const fmt = (n) => Number.isInteger(n) ? String(n) : String(parseFloat(n.toFixed(1)));

  if (direction === 'low_red') {
    const redNum = parseNum(thresholds.red);
    if (redNum != null && currentValue > redNum) {
      return `>${fmt(redNum)}${unitStr}`;
    }
    const greenMatch = (thresholds.green || '').match(/<(\d+(?:\.\d+)?)/);
    if (greenMatch) {
      const g = parseFloat(greenMatch[1]);
      if (currentValue < g) return `<${fmt(g)}${unitStr}`;
    }
  } else if (direction === 'high_red') {
    const redAbove = (thresholds.red || '').match(/>(\d+(?:\.\d+)?)/);
    if (redAbove) {
      const r = parseFloat(redAbove[1]);
      if (currentValue > r) return `>${fmt(r)}${unitStr}`;
    }
    const redBelow = (thresholds.red || '').match(/<(\d+(?:\.\d+)?)/);
    if (redBelow) {
      const r = parseFloat(redBelow[1]);
      if (currentValue < r) return `<${fmt(r)}${unitStr}`;
    }
  }
  return '';
}

let charts = [];

async function loadData() {
  try {
    const v = '?v=' + Date.now();
    const [latestRes, signalsRes] = await Promise.all([
      fetch('data/latest.json' + v),
      fetch('data/signals.json' + v),
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

function renderKoreaLights(signals, latest) {
  const koreaSignals = signals.korea || {};
  const koreaLatest = latest.korea || {};
  const grid = document.getElementById('korea-lights-grid');
  if (!grid) return;
  grid.innerHTML = '';

  // 预计算稳定性信号灯
  const depositsData = koreaLatest.investor_deposits;
  let stabilitySig = null;
  let stabilityScore = null;
  if (depositsData && depositsData.history && depositsData.history.length > 22) {
    const scores = computeStabilityScore(depositsData.history);
    if (scores.length > 0) {
      const latestScore = scores[scores.length - 1];
      stabilityScore = latestScore.score;
      let status = 'red', label = '不稳定';
      if (latestScore.score >= 60) { status = 'green'; label = '平稳'; }
      else if (latestScore.score >= 40) { status = 'yellow'; label = '中性'; }
      const thresholdTag = latestScore.score < 60 ? '<60' : '≥60';
      stabilitySig = { status, note: `稳定性得分 ${latestScore.score.toFixed(1)} · ${label}`, thresholdTag };
    }
  }

  // 预计算杠杆去化情景信号灯（单日 + 14天）
  const marginData = koreaLatest.margin;
  const leverageSigs = computeLeverageScenarioSignals(marginData, depositsData);

  KOREA_DIMENSION_ORDER.forEach(key => {
    let sig = null;
    if (key === 'stability') {
      sig = stabilitySig;
    } else if (key === 'leverage_1d') {
      sig = leverageSigs.daily;
    } else if (key === 'leverage_14d') {
      sig = leverageSigs.fourteen;
    } else {
      sig = koreaSignals.signals ? koreaSignals.signals[key] : null;
    }
    if (!sig) return;
    const meta = KOREA_DIMENSION_META[key];
    const card = document.createElement('div');
    card.className = 'light-card ' + sig.status;
    card.title = sig.note || '';

    // 为每个指标追加当前数值 + 阈值判断（不改变方框大小）
    let valueSuffix = '';
    const dimData = koreaLatest[key];

    if (key === 'stability' && stabilityScore != null) {
      const scoreStr = stabilityScore.toFixed(1);
      const tag = stabilitySig.thresholdTag || '';
      valueSuffix = ` <span class="dd-inline">${scoreStr} ${tag}</span>`;
    } else if (key === 'leverage_1d' || key === 'leverage_14d' || key === 'leveraged_etf') {
      // 去化情景/杠杆ETF：已通过标签说明，不需要额外数值
    } else if (dimData && dimData.current_value != null) {
      const val = dimData.current_value;
      const displayUnit = meta.displayUnit || '';
      const thresholds = dimData.thresholds;
      const direction = meta.direction || 'low_red';
      const tag = getThresholdTag(val, thresholds, direction, displayUnit);
      const valStr = Number.isInteger(val) ? String(val) : String(parseFloat(val.toFixed(1)));
      valueSuffix = ` <span class="dd-inline">${valStr}${displayUnit}${tag ? ' ' + tag : ''}</span>`;
    }

    card.innerHTML = `
      <div class="light-dot"></div>
      <div class="light-label">${meta.name}${valueSuffix}</div>
    `;
    grid.appendChild(card);
  });

  // 渲染融资余额高点回落卡片（并入信号灯网格，与其他卡片同宽同高）
  if (marginData && marginData.history && marginData.history.length > 0) {
    const h = marginData.history;
    const peak = h.reduce((m, x) => Math.max(m, x.value), -Infinity);
    const peakDate = h.find(x => x.value === peak)?.date || '';
    const curr = h[h.length - 1].value;
    const dropAbs = (peak - curr).toFixed(1);
    const dropPct = ((peak - curr) / peak * 100).toFixed(1);
    const ddCard = document.createElement('div');
    ddCard.className = 'light-card drawdown-card';
    ddCard.title = `峰值 ${peak} (${peakDate}) → 当前 ${curr} · 回落 ${dropPct}%`;
    ddCard.innerHTML = `
      <div class="drawdown-dot"></div>
      <div class="light-label">融资回落 <span class="dd-inline">-${dropPct}%</span></div>
    `;
    grid.appendChild(ddCard);
  }

  // 渲染折叠式判定标准说明
  renderLeverageScenarioExplainer();

  // 渲染两个追踪表
  renderLeverageScenarioTables(marginData, depositsData);
}

// 杠杆去化情景判定（A/B/C + 异常强化）
function classifyLeverageScenario(marChg, depChg, r2Chg, window) {
  const abnMar = window === '14d' ? 7 : 2;
  const abnDep = window === '14d' ? 10 : 4;

  const mDir = marChg > 0 ? '↑' : '↓';
  const dDir = depChg > 0 ? '↑' : '↓';
  const rDir = r2Chg > 0 ? '↑' : '↓';

  const mAbn = Math.abs(marChg) > abnMar;
  const dAbn = Math.abs(depChg) > abnDep;

  let scenario = '', color = '', label = '', baseScenario = '';
  // A 健康: 融资↓ 存管金↑ R2↓
  if (mDir === '↓' && dDir === '↑' && rDir === '↓') {
    scenario = 'A'; color = 'green'; label = '健康'; baseScenario = 'A';
  }
  // A 健康: 融资↑ 存管金↑ R2↓
  else if (mDir === '↑' && dDir === '↑' && rDir === '↓') {
    scenario = 'A'; color = 'green'; label = '健康'; baseScenario = 'A';
  }
  // B 中性: 融资↓ 存管金↓ R2↓
  else if (mDir === '↓' && dDir === '↓' && rDir === '↓') {
    scenario = 'B'; color = 'yellow'; label = '中性'; baseScenario = 'B';
  }
  // B 中性: 融资↑ 存管金↑ R2↑
  else if (mDir === '↑' && dDir === '↑' && rDir === '↑') {
    scenario = 'B'; color = 'yellow'; label = '中性'; baseScenario = 'B';
  }
  // C 危险: 融资↓ 存管金↓ R2↑
  else if (mDir === '↓' && dDir === '↓' && rDir === '↑') {
    scenario = 'C'; color = 'red'; label = '危险'; baseScenario = 'C';
  }
  // C 危险: 融资↑ 存管金↓ R2↑
  else if (mDir === '↑' && dDir === '↓' && rDir === '↑') {
    scenario = 'C'; color = 'red'; label = '危险'; baseScenario = 'C';
  }
  else {
    scenario = '?'; color = 'gray'; label = '未匹配'; baseScenario = '?';
  }

  // 异常强化: 黄→红, 红保持；用 baseScenario 区分"原生危险"vs"异常强化"
  let enhanced = false;
  if (color === 'yellow' && (mAbn || dAbn)) {
    color = 'red'; enhanced = true; label = '异常警戒';
  } else if (color === 'red' && (mAbn || dAbn)) {
    enhanced = true; label = '危险·强化';
  }

  return { scenario, color, label, baseScenario, mDir, dDir, rDir, mAbn, dAbn, enhanced,
           marChg, depChg, r2Chg };
}

// 计算最新一天的单日和14日杠杆情景信号
function computeLeverageScenarioSignals(marginData, depositsData) {
  const result = { daily: null, fourteen: null };
  if (!marginData || !depositsData || !marginData.history || !depositsData.history) return result;

  const marD = {}; marginData.history.forEach(h => marD[h.date] = h.value);
  const depD = {}; depositsData.history.forEach(h => depD[h.date] = h.value);
  const common = Object.keys(marD).filter(d => depD[d]).sort();
  if (common.length < 15) return result;

  const latest = common[common.length - 1];
  const prev = common[common.length - 2];
  const prev14 = common[common.length - 15];

  // 单日
  const m1 = (marD[latest] - marD[prev]) / marD[prev] * 100;
  const d1 = (depD[latest] - depD[prev]) / depD[prev] * 100;
  const r2_1 = marD[latest] / depD[latest] * 100 - marD[prev] / depD[prev] * 100;
  const daily = classifyLeverageScenario(m1, d1, r2_1, '1d');
  result.daily = {
    status: daily.color,
    note: `单日情景 ${daily.scenario} ${daily.label} · 融资${m1 >= 0 ? '+' : ''}${m1.toFixed(2)}% 存管金${d1 >= 0 ? '+' : ''}${d1.toFixed(2)}% R2${r2_1 >= 0 ? '+' : ''}${r2_1.toFixed(2)}pp${daily.enhanced ? ' · 异常强化' : ''}`
  };

  // 14日
  const m14 = (marD[latest] - marD[prev14]) / marD[prev14] * 100;
  const d14 = (depD[latest] - depD[prev14]) / depD[prev14] * 100;
  const r2_14 = marD[latest] / depD[latest] * 100 - marD[prev14] / depD[prev14] * 100;
  const fourteen = classifyLeverageScenario(m14, d14, r2_14, '14d');
  result.fourteen = {
    status: fourteen.color,
    note: `14日情景 ${fourteen.scenario} ${fourteen.label} · 融资${m14 >= 0 ? '+' : ''}${m14.toFixed(2)}% 存管金${d14 >= 0 ? '+' : ''}${d14.toFixed(2)}% R2${r2_14 >= 0 ? '+' : ''}${r2_14.toFixed(2)}pp${fourteen.enhanced ? ' · 异常强化' : ''}`
  };

  return result;
}

// 折叠式判定标准说明
function renderLeverageScenarioExplainer() {
  let el = document.getElementById('leverage-scenario-explainer');
  if (!el) return;
  el.innerHTML = `
    <div class="explainer-toggle" onclick="toggleExplainer(this)">
      <span class="explainer-toggle-arrow">▾</span>
      <span>杠杆去化情景判定标准</span>
    </div>
    <div class="explainer-content">
      <h4>情景定义（A=健康 / B=中性 / C=危险）</h4>
      <table class="scenario-table">
        <thead>
          <tr><th>情景</th><th>融资</th><th>存管金</th><th>R2</th><th>市场含义</th><th>颜色</th></tr>
        </thead>
        <tbody>
          <tr class="row-green"><td>A</td><td>↓</td><td>↑</td><td>↓</td><td>新钱入场稀释杠杆，最理想</td><td>🟢</td></tr>
          <tr class="row-green"><td>A</td><td>↑</td><td>↑</td><td>↓</td><td>存管金涨幅更大，R2仍降</td><td>🟢</td></tr>
          <tr class="row-yellow"><td>B</td><td>↓</td><td>↓</td><td>↓</td><td>融资跌幅更大，去化中</td><td>🟡</td></tr>
          <tr class="row-yellow"><td>B</td><td>↑</td><td>↑</td><td>↑</td><td>同步加杠杆</td><td>🟡</td></tr>
          <tr class="row-red"><td>C</td><td>↓</td><td>↓</td><td>↑</td><td>存管金跌幅更大，现金跑得比债务快</td><td>🔴</td></tr>
          <tr class="row-red"><td>C</td><td>↑</td><td>↓</td><td>↑</td><td>加杠杆+资金外逃，最危险</td><td>🔴</td></tr>
        </tbody>
      </table>
      <table class="scenario-table">
        <thead>
          <tr><th>窗口</th><th>融资异常</th><th>存管金异常</th></tr>
        </thead>
        <tbody>
          <tr><td>单日</td><td>|变化率| &gt; 2%</td><td>|变化率| &gt; 4%</td></tr>
          <tr><td>14天</td><td>|变化率| &gt; 7%</td><td>|变化率| &gt; 10%</td></tr>
        </tbody>
      </table>

      <p class="explainer-note">
        判定流程：① 用正负号定方向（↑/↓，无横盘）→ ② 匹配情景表得初始红黄绿 → ③ 异常阈值强化（黄→红，红保持）
      </p>

      <p class="explainer-note">
        <b>追踪表说明</b>：<br>
        「异常」列：「融」=融资变化超阈值，「存」=存管金变化超阈值；<br>
        「情景」列：B→C = 初始B中性被异常强化为C，C·强化 = 初始C且同时触发异常阈值；<br>
        「信号」列：危险 = 原生C情景，危险·强化 = C且触发异常，异常警戒 = B被异常强化为红色。
      </p>
    </div>
  `;
}

function toggleExplainer(el) {
  const content = el.nextElementSibling;
  const arrow = el.querySelector('.explainer-toggle-arrow');
  const expanded = content.classList.toggle('expanded');
  arrow.style.transform = expanded ? 'rotate(180deg)' : 'rotate(0)';
}

// 渲染两个追踪表（14日 + 单日，2026年至今）
function renderLeverageScenarioTables(marginData, depositsData) {
  let el = document.getElementById('leverage-scenario-tables');
  if (!el) return;
  if (!marginData || !depositsData) { el.innerHTML = ''; return; }

  const marD = {}; marginData.history.forEach(h => marD[h.date] = h.value);
  const depD = {}; depositsData.history.forEach(h => depD[h.date] = h.value);
  const common = Object.keys(marD).filter(d => depD[d]).sort();
  const dates2026 = common.filter(d => d.startsWith('2026'));

  // 14日表（最新日期在上）
  let html14 = '';
  for (let i = dates2026.length - 1; i >= 14; i--) {
    const c = dates2026[i], p = dates2026[i - 14];
    const m = (marD[c] - marD[p]) / marD[p] * 100;
    const d = (depD[c] - depD[p]) / depD[p] * 100;
    const r2 = marD[c] / depD[c] * 100 - marD[p] / depD[p] * 100;
    const sc = classifyLeverageScenario(m, d, r2, '14d');
    const abn = (sc.mAbn ? '融' : '') + (sc.dAbn ? '存' : '');
    let scenarioDisplay;
    if (sc.enhanced && sc.baseScenario === 'B') {
      scenarioDisplay = 'B→C';
    } else if (sc.enhanced && sc.baseScenario === 'C') {
      scenarioDisplay = 'C·强化';
    } else {
      scenarioDisplay = sc.scenario;
    }
    html14 += `<tr class="row-${sc.color}">
      <td>${c}</td><td>${m >= 0 ? '+' : ''}${m.toFixed(2)}%</td>
      <td>${d >= 0 ? '+' : ''}${d.toFixed(2)}%</td>
      <td>${r2 >= 0 ? '+' : ''}${r2.toFixed(2)}</td>
      <td>${sc.mDir}${sc.dDir}${sc.rDir}</td>
      <td>${scenarioDisplay}</td><td>${abn}</td>
      <td><span class="dot-${sc.color}"></span>${sc.label}</td>
    </tr>`;
  }

  // 单日表（最新日期在上）
  let html1d = '';
  for (let i = dates2026.length - 1; i >= 1; i--) {
    const c = dates2026[i], p = dates2026[i - 1];
    const m = (marD[c] - marD[p]) / marD[p] * 100;
    const d = (depD[c] - depD[p]) / depD[p] * 100;
    const r2 = marD[c] / depD[c] * 100 - marD[p] / depD[p] * 100;
    const sc = classifyLeverageScenario(m, d, r2, '1d');
    const abn = (sc.mAbn ? '融' : '') + (sc.dAbn ? '存' : '');
    let scenarioDisplay;
    if (sc.enhanced && sc.baseScenario === 'B') {
      scenarioDisplay = 'B→C';
    } else if (sc.enhanced && sc.baseScenario === 'C') {
      scenarioDisplay = 'C·强化';
    } else {
      scenarioDisplay = sc.scenario;
    }
    html1d += `<tr class="row-${sc.color}">
      <td>${c}</td><td>${m >= 0 ? '+' : ''}${m.toFixed(2)}%</td>
      <td>${d >= 0 ? '+' : ''}${d.toFixed(2)}%</td>
      <td>${r2 >= 0 ? '+' : ''}${r2.toFixed(2)}</td>
      <td>${sc.mDir}${sc.dDir}${sc.rDir}</td>
      <td>${scenarioDisplay}</td><td>${abn}</td>
      <td><span class="dot-${sc.color}"></span>${sc.label}</td>
    </tr>`;
  }

  el.innerHTML = `
    <div class="scenario-tables-wrap">
      <div class="scenario-table-block">
        <h4 class="scenario-table-title">两周杠杆比率趋势追踪（2026年至今 · 14日窗口）</h4>
        <div class="scenario-table-scroll">
          <table class="scenario-track-table">
            <thead><tr><th>日期</th><th>融资%</th><th>存管金%</th><th>R2pp</th><th>方向</th><th>情景</th><th>异常</th><th>信号</th></tr></thead>
            <tbody>${html14}</tbody>
          </table>
        </div>
      </div>
      <div class="scenario-table-block">
        <h4 class="scenario-table-title">单日杠杆比率状态追踪（2026年至今 · 单日窗口）</h4>
        <div class="scenario-table-scroll">
          <table class="scenario-track-table">
            <thead><tr><th>日期</th><th>融资%</th><th>存管金%</th><th>R2pp</th><th>方向</th><th>情景</th><th>异常</th><th>信号</th></tr></thead>
            <tbody>${html1d}</tbody>
          </table>
        </div>
      </div>
    </div>
  `;
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

    if (key === 'investor_deposits') {
      if (!data) return;
      const marginData = koreaLatest.margin;
      const etfData = koreaLatest.leveraged_etf;
      renderDepositsR2Card(grid, data, marginData, etfData, idx);
      return;
    }

    if (key === 'stability') {
      const depositsData = koreaLatest.investor_deposits;
      if (depositsData && depositsData.history && depositsData.history.length > 22) {
        renderStabilityCard(grid, depositsData, idx);
      }
      return;
    }

    if (key === 'leveraged_etf') {
      if (!data) return;
      renderLeveragedEtfCard(grid, data, idx);
      return;
    }

    // margin 没有 signals.json 记录时，用 2026 年以来数据动态分位判定（high_red：高值危险）
    // 三区划分：≥p50 红（仍在高位）、p25-p50 黄（回落中警戒）、<p25 绿（低位安全）
    let _sig = sig;
    if (!_sig && key === 'margin' && data && data.history && data.history.length >= 20) {
      const y26History = data.history.filter(h => h.date.startsWith('2026'));
      const useHistory = y26History.length >= 60 ? y26History : data.history;
      const vals = useHistory.map(h => h.value).sort((a, b) => a - b);
      const curr = data.current_value;
      const p50 = vals[Math.floor(vals.length * 0.50)];
      const p25 = vals[Math.floor(vals.length * 0.25)];
      let st = 'green', lb = STATUS_LABELS.green;
      let zoneDesc = `低位(<25分位)`;
      if (curr >= p50) {
        st = 'red'; lb = STATUS_LABELS.red; zoneDesc = `高位(≥50分位)`;
      } else if (curr >= p25) {
        st = 'yellow'; lb = STATUS_LABELS.yellow; zoneDesc = `中位(25-50分位)`;
      }
      const sampleRange = y26History.length >= 60
        ? `2026年至今共${y26History.length}个交易日`
        : `全期共${data.history.length}个交易日`;
      _sig = {
        status: st,
        label: lb,
        note: `当前 ${curr} 万亿韩元，处于${sampleRange}的${zoneDesc} · p25=${p25.toFixed(2)}，p50=${p50.toFixed(2)}`
      };
    }

    if (!data || !_sig) return;

    const meta = KOREA_DIMENSION_META[key];
    const card = document.createElement('div');
    card.className = 'dim-card';

    const valueDisplay = formatKoreaValue(data, _sig);
    const thresholdBar = renderThresholdBar(data, _sig, meta.direction);

    // 融资余额：动态计算峰值回落比
    let drawdownNote = '';
    if (key === 'margin' && data.history && data.history.length > 0) {
      const h = data.history;
      const peak = h.reduce((m, x) => Math.max(m, x.value), -Infinity);
      const peakDate = h.find(x => x.value === peak)?.date || '';
      const curr = h[h.length - 1].value;
      const dropAbs = (peak - curr).toFixed(3);
      const dropPct = ((peak - curr) / peak * 100).toFixed(1);
      drawdownNote = `<div class="drawdown-note">高点回落: <b>${peak}</b> 万亿韩元 (${peakDate}) → 当前 <b>-${dropAbs}</b> (${dropPct}%)</div>`;
    }

    card.innerHTML = `
      <div class="dim-card-header">
        <div>
          <div class="dim-card-title">${data.name || meta.name}</div>
          <div class="dim-card-sub">${data.subtitle || ''}</div>
        </div>
        <div class="dim-badge ${_sig.status}">
          <div class="dim-badge-dot"></div>
          <span>${STATUS_LABELS[_sig.status]}</span>
        </div>
      </div>
      <div class="dim-value">${valueDisplay}</div>
      ${drawdownNote}
      <div class="dim-note">${_sig.note || ''}</div>
      <div class="dim-chart" id="chart-korea-${key}"></div>
      <div class="dim-chart-toggle">
        <button class="chart-toggle-btn" data-expanded="false" onclick="toggleChartRange('${key}', this)">查看更多 ▾</button>
      </div>
      ${thresholdBar}
    `;
    grid.appendChild(card);

    setTimeout(() => {
      createKoreaChart(key, data, _sig);
    }, 50 + idx * 30);
  });
}

function renderDepositsR2Card(grid, depositsData, marginData, etfData, idx) {
  const depVal = depositsData.current_value;
  const finVal = marginData?.current_value;
  const colVal = depositsData.extra?.securities_loan;
  // leveraged_etf 的累计净申赎估计：当前 AUM 和 peak 之间的关系，这里简化用当前 AUM（量级≈累计净申赎）
  const etfVal = etfData?.current_value;

  const haveAll = depVal && finVal != null && colVal != null && etfVal != null;

  const r2Pct = depVal && finVal != null ? (finVal / depVal * 100) : null;
  const colPct = depVal && colVal != null ? (colVal / depVal * 100) : null;
  const etfPct = depVal && etfVal != null ? (etfVal / depVal * 100) : null;
  const totalPct = (r2Pct != null && colPct != null && etfPct != null)
    ? r2Pct + colPct + etfPct
    : null;

  // colHistory 供独立趋势图和 toggle 使用
  const colHistory = depositsData.extra?.securities_loan_history || [];

  // 信号灯判断
  let status = 'gray';
  let statusLabel = STATUS_LABELS.gray;
  if (totalPct != null) {
    if (totalPct > 75) { status = 'red'; statusLabel = '高风险'; }
    else if (totalPct >= 60) { status = 'yellow'; statusLabel = '警戒'; }
    else { status = 'green'; statusLabel = '正常'; }
  }

  const totalStr = totalPct != null ? totalPct.toFixed(1) : '—';
  const r2Str = r2Pct != null ? r2Pct.toFixed(1) : '—';
  const colStr = colPct != null ? colPct.toFixed(1) : '—';
  const etfStr = etfPct != null ? etfPct.toFixed(1) : '—';

  // 距离阈值的差距说明
  let gapText = '';
  let gapClass = 'gap-gray';
  if (totalPct != null) {
    if (totalPct > 75) {
      const over = (totalPct - 75).toFixed(1);
      gapText = `🔥 已超 75% 高风险线 · 超出 ${over}pt`;
      gapClass = 'gap-red';
    } else if (totalPct >= 60) {
      const toDanger = (75 - totalPct).toFixed(1);
      gapText = `⚠️ 距 75% 高风险线还差 ${toDanger}pt`;
      gapClass = 'gap-yellow';
    } else if (totalPct >= 40) {
      const toWarn = (60 - totalPct).toFixed(1);
      gapText = `✅ 距 60% 警戒线还差 ${toWarn}pt`;
      gapClass = 'gap-green';
    } else {
      const toWarn = (40 - totalPct).toFixed(1);
      gapText = `💚 安全区 · 距 40% 安全线上沿还差 ${toWarn}pt`;
      gapClass = 'gap-green';
    }
  }

  // 拆解条（以 100% 为总长，每项宽度 = 各自比例）
  const maxBar = 100;
  const finBarW = Math.min(100, (r2Pct ?? 0) / maxBar * 100);
  const colBarW = Math.min(100, (colPct ?? 0) / maxBar * 100);
  const etfBarW = Math.min(100, (etfPct ?? 0) / maxBar * 100);
  const totalBarW = Math.min(100, (totalPct ?? 0) / maxBar * 100);

  // 温度计主条：背景色已经按 40/60/75% 分区
  const card = document.createElement('div');
  card.className = 'dim-card lev-thermo-full';
  card.innerHTML = `
    <div class="dim-card-header">
      <div>
        <div class="dim-card-title">${depositsData.name || '存管金 & R2'}</div>
        <div class="dim-card-sub">${depositsData.subtitle || '融资 + 证券抵押 + 杠杆ETF内嵌 · 占存管金比例'}</div>
      </div>
    </div>

    <div class="lev-chart-block">
      <div class="lev-chart-block-title">绝对额（万亿韩元）—— 存管金 vs 杠杆分项体量</div>
      <div class="dim-chart lev-chart-amount" id="chart-korea-investor_deposits-amount"></div>
    </div>
    <div class="lev-chart-block">
      <div class="lev-chart-block-title">R2（融资/存管金）vs 融资余额 & 存管金趋势</div>
      <div class="dim-chart lev-chart-r2trend" id="chart-korea-investor_deposits-r2trend"></div>
    </div>
    <div class="dim-chart-toggle">
      <button class="chart-toggle-btn" data-expanded="false" onclick="toggleChartRange('investor_deposits', this)">查看更多 ▾</button>
    </div>
  `;
  grid.appendChild(card);

  // 展开态切换：给卡片加类，让图表高度变化
  const btn = card.querySelector('.chart-toggle-btn');
  btn.addEventListener('click', () => {
    const expanded = btn.dataset.expanded === 'true';
    if (expanded) {
      card.classList.remove('lev-thermo-expanded');
    } else {
      card.classList.add('lev-thermo-expanded');
    }
    // 切类后等 layout，再 resize 图表
    setTimeout(() => {
      const a = document.getElementById('chart-korea-investor_deposits-amount');
      const b = document.getElementById('chart-korea-investor_deposits-r2trend');
      a && a._chartInstance && a._chartInstance.resize();
      b && b._chartInstance && b._chartInstance.resize();
    }, 50);
  }, false);

  setTimeout(() => {
    createDepositsR2Chart(depositsData, marginData, etfData);
  }, 50 + idx * 30);
}

function renderStabilityCard(grid, depositsData, idx) {
  const scores = computeStabilityScore(depositsData.history);
  if (scores.length === 0) return;
  const latestScore = scores[scores.length - 1];
  let stStatus = 'red', stLabel = '不稳定';
  if (latestScore.score >= 60) { stStatus = 'green'; stLabel = '平稳'; }
  else if (latestScore.score >= 40) { stStatus = 'yellow'; stLabel = '中性'; }

  const stCard = document.createElement('div');
  stCard.className = 'dim-card stability-card';
  stCard.innerHTML = `
    <div class="dim-card-header">
      <div>
        <div class="dim-card-title">存管金稳定性得分</div>
        <div class="dim-card-sub">基于20个交易日滚动窗口 · CV + 年化波动率归一化</div>
      </div>
      <div class="dim-badge ${stStatus}">
        <div class="dim-badge-dot"></div>
        <span>${latestScore.score.toFixed(1)} · ${stLabel}</span>
      </div>
    </div>
    <div class="dim-note">当前 得分=${latestScore.score.toFixed(1)} · CV=${(latestScore.cv*100).toFixed(2)}% · 年化波动率=${(latestScore.annVolSym*100).toFixed(1)}%</div>
    <div class="trend-chart" id="chart-stability-score" style="height:300px;"></div>
    <div class="stability-explainer">
      <div class="stability-explainer-title" onclick="this.parentElement.classList.toggle('expanded')" style="cursor:pointer;user-select:none;">
        <span>详细计算说明</span><span class="explainer-toggle">▾</span>
      </div>
      <div class="stability-explainer-content">
        <p><b>① 日度环比变化率</b>：r<sub>t</sub> = (V<sub>t</sub> − V<sub>t−1</sub>) / V<sub>t−1</sub>，V 为存管金日度值（万亿韩元）。</p>
        <p><b>② 滚动窗口</b>：每个时点取过去 <b>20 个交易日</b>的 r 序列。</p>
        <p><b>③ 变异系数 CV</b> = σ<sub>level</sub> / μ<sub>level</sub>，衡量存管金水平在窗口内的相对离散度。</p>
        <p><b>④ 全量年化波动率</b> σ<sub>ann</sub> = std(r) × √252，衡量日度变化率的年化波动幅度。</p>
        <p><b>⑤ 归一化</b>（分数越高越稳定，映射到 0–100）：<br/><span class="indent">· CV 得分 = 100 − (CV / 12%) × 100，CV ∈ [0, 12%] → [100, 0]</span><br/><span class="indent">· 波动率得分 = 100 − (σ<sub>ann</sub> / 80%) × 100，σ<sub>ann</sub> ∈ [0, 80%] → [100, 0]</span></p>
        <p><b>⑥ 稳定性得分</b> = (CV 得分 + 波动率得分) / 2，取值 [0, 100]。</p>
        <p class="indent"><b>区间判定</b>：≥ 60 平稳（绿）｜ 40–60 中性（黄）｜ &lt; 40 不稳定（红）</p>
      </div>
    </div>
    <div class="dim-chart-toggle">
      <button class="chart-toggle-btn" data-expanded="false" onclick="toggleStabilityChartRange(this)">查看更多 ▾</button>
    </div>
  `;
  grid.appendChild(stCard);
  setTimeout(() => createStabilityScoreChart(depositsData), 50 + idx * 30);
}

function renderLeveragedEtfCard(grid, etfData, idx) {
  const current = etfData.current_value;
  const card = document.createElement('div');
  card.className = 'dim-card';
  card.innerHTML = `
    <div class="dim-card-header">
      <div>
        <div class="dim-card-title">杠杆ETF累计资金净流入</div>
        <div class="dim-card-sub">cumFlow（累计净申赎额，非AUM）· 数据源: kimpremium</div>
      </div>
    </div>
    <div class="dim-value">${current != null ? current : '—'}<span class="dim-value-unit">${etfData.unit || ''}</span></div>
    <div class="dim-note">注: cumFlow 仅含资金进出，不含净值涨跌，无法等同于真实AUM</div>
    <div class="dim-chart" id="chart-leveraged-etf"></div>
    <div class="dim-chart-toggle">
      <button class="chart-toggle-btn" data-expanded="false" onclick="toggleTrendChartRange('leveraged_etf', this)">查看更多 ▾</button>
    </div>
  `;
  grid.appendChild(card);
  setTimeout(() => createLeveragedEtfChart(etfData), 50 + idx * 30);
}

function renderKoreaTrendDimensions(latest) {
  // 杠杆ETF和稳定性卡片已移至 renderKoreaDimensions
  const grid = document.getElementById('korea-trend-grid');
  if (grid) grid.innerHTML = '';
}

// —— 存管金稳定性得分计算（对称方案）——
function computeStabilityScore(history) {
  if (!history || history.length < 22) return [];

  // 日度环比变化率
  const returns = [];
  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1].value;
    const curr = history[i].value;
    if (prev && prev > 0) {
      returns.push({ date: history[i].date, r: (curr - prev) / prev });
    }
  }

  const windowSize = 20;
  const scores = [];
  for (let i = windowSize - 1; i < returns.length; i++) {
    const wReturns = [];
    for (let j = i - windowSize + 1; j <= i; j++) {
      wReturns.push(returns[j].r);
    }

    // CV = σ_level / μ_level
    const levels = [];
    const levelStart = i - windowSize + 2;
    for (let k = levelStart; k <= i + 1; k++) {
      if (k >= 0 && k < history.length) levels.push(history[k].value);
    }
    const meanL = levels.reduce((a, b) => a + b, 0) / levels.length;
    const varL = levels.reduce((a, b) => a + (b - meanL) ** 2, 0) / levels.length;
    const stdL = Math.sqrt(varL);
    const cv = meanL > 0 ? stdL / meanL : 0;

    // 全量年化波动率 = std(r) × √252
    const meanR = wReturns.reduce((a, b) => a + b, 0) / wReturns.length;
    const varR = wReturns.reduce((a, b) => a + (b - meanR) ** 2, 0) / wReturns.length;
    const stdR = Math.sqrt(varR);
    const annVolSym = stdR * Math.sqrt(252);

    // 归一化到 0-100
    const cvScore = Math.max(0, Math.min(100, 100 - (cv / 0.12) * 100));
    const volScore = Math.max(0, Math.min(100, 100 - (annVolSym / 0.80) * 100));
    const score = (cvScore + volScore) / 2;

    scores.push({
      date: returns[i].date,
      score: score,
      cv: cv,
      annVolSym: annVolSym,
      windowSize: windowSize
    });
  }
  return scores;
}

function createStabilityScoreChart(depositsData) {
  const dom = document.getElementById('chart-stability-score');
  if (!dom || !window.echarts) return;

  const allScores = computeStabilityScore(depositsData.history);
  if (allScores.length === 0) {
    dom.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-tertiary);font-size:12px;">暂无足够数据</div>';
    return;
  }

  // 默认显示 2025-2026
  const defaultScores = allScores.filter(s => s.date.startsWith('2026') || s.date.startsWith('2025'));

  const chart = echarts.init(dom);
  chart.setOption(buildStabilityScoreOption(defaultScores));
  dom._chartFullData = allScores;
  dom._chartInstance = chart;
  charts.push(chart);
}

function buildStabilityScoreOption(scores) {
  const dates = formatChartDates(scores.map(s => ({ date: s.date })));
  const valuesSym = scores.map(s => s.score);

  return {
    grid: { left: 56, right: 24, top: 42, bottom: 40 },
    legend: { show: false },
    xAxis: {
      type: 'category',
      data: dates,
      boundaryGap: false,
      axisLabel: { fontSize: 11, color: '#9ca3af', interval: Math.floor(dates.length / 8) },
      axisLine: { lineStyle: { color: '#d6d3d1' } },
      axisTick: { show: false }
    },
    yAxis: {
      type: 'value',
      name: '稳定性得分',
      min: 0,
      max: 100,
      nameTextStyle: { fontSize: 11, color: '#6b7280', padding: [0, 0, 0, -4] },
      axisLabel: { fontSize: 11, color: '#78716c' },
      axisLine: { show: false },
      splitLine: { lineStyle: { color: '#e7e5e4', type: 'dashed' } }
    },
    series: [
      {
        name: '稳定性得分',
        type: 'line',
        data: valuesSym,
        smooth: true,
        symbol: 'none',
        lineStyle: { width: 2.4, color: '#0ea5e9' },
        itemStyle: { color: '#0ea5e9' },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(14,165,233,0.25)' },
            { offset: 1, color: 'rgba(14,165,233,0.02)' }
          ])
        },
        markLine: {
          silent: true,
          symbol: 'none',
          data: [
            { yAxis: 60, lineStyle: { color: '#16a34a', type: 'dashed', width: 1.5 }, label: { formatter: '平稳 60', color: '#16a34a', fontSize: 10, position: 'insideEndTop' } },
            { yAxis: 40, lineStyle: { color: '#dc2626', type: 'dashed', width: 1.5 }, label: { formatter: '不稳定 40', color: '#dc2626', fontSize: 10, position: 'insideEndBottom' } }
          ]
        },
        markArea: {
          silent: true,
          data: [
            [{ yAxis: 60, itemStyle: { color: 'rgba(22,163,74,0.06)' } }, { yAxis: 100 }],
            [{ yAxis: 40, itemStyle: { color: 'rgba(234,179,8,0.07)' } }, { yAxis: 60 }],
            [{ yAxis: 0, itemStyle: { color: 'rgba(220,38,38,0.06)' } }, { yAxis: 40 }]
          ]
        },
        z: 3
      }
    ],
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'line', snap: true, lineStyle: { color: '#6b7280', type: 'dashed' } },
      formatter: params => {
        const p = params[0];
        const idx = p.dataIndex;
        const s = scores[idx];
        if (!s) return '';
        let html = `<b style="color:#f3f4f6">${p.axisValue}</b>`;
        html += `<br/><span style="color:#0ea5e9">●</span> 稳定性得分: <b style="color:#f3f4f6">${s.score.toFixed(1)}</b>`;
        html += `<br/><span style="color:#6b7280">　 CV ${(s.cv * 100).toFixed(2)}% · 全量年化波动率 ${(s.annVolSym * 100).toFixed(1)}%</span>`;
        return html;
      },
      confine: true,
      backgroundColor: 'rgba(17,24,39,0.95)',
      borderColor: '#374151',
      borderWidth: 1,
      textStyle: { color: '#d1d5db', fontSize: 12 },
      extraCssText: 'border-radius:8px; padding:8px 12px;'
    },
    animationDuration: 600
  };
}

function toggleStabilityChartRange(btn) {
  const dom = document.getElementById('chart-stability-score');
  if (!dom || !dom._chartInstance || !dom._chartFullData) return;

  const isExpanded = btn.dataset.expanded === 'true';
  const allScores = dom._chartFullData;

  let scores;
  if (isExpanded) {
    scores = allScores.filter(s => s.date.startsWith('2026') || s.date.startsWith('2025'));
    btn.textContent = '查看更多 ▾';
    btn.dataset.expanded = 'false';
  } else {
    scores = allScores;
    btn.textContent = '收起 ▴';
    btn.dataset.expanded = 'true';
  }

  dom._chartInstance.setOption(buildStabilityScoreOption(scores), true);
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
  const thresholds = parseThresholds(data.thresholds);

  const defaultHistory = data.history.filter(h => h.date.startsWith('2026') || h.date.startsWith('2025'));
  const defaultData = { ...data, history: defaultHistory };

  chart.setOption(buildChartOption(defaultData, thresholds));

  dom._chartKey = key;
  dom._chartFullData = data;
  dom._chartThresholds = thresholds;
  dom._chartInstance = chart;
  charts.push(chart);
}

function buildChartOption(data, thresholds) {
  const dates = formatChartDates(data.history);
  const values = data.history.map(h => h.value);

  const markArea = buildMarkArea(thresholds, values);

  return {
    grid: { left: 42, right: 14, top: 10, bottom: 24 },
    xAxis: {
      type: 'category',
      data: dates,
      boundaryGap: false,
      axisLabel: { fontSize: 9, color: '#9ca3af', interval: Math.floor(dates.length / 6) },
      axisLine: { lineStyle: { color: '#374151' } },
      axisTick: { show: false }
    },
    yAxis: {
      type: 'value',
      axisLabel: { fontSize: 9, color: '#9ca3af' },
      axisLine: { show: false },
      splitLine: { lineStyle: { color: '#374151', type: 'dashed' } },
      min: 0,
      scale: true
    },
    series: [
      {
        type: 'line',
        data: values,
        smooth: true,
        symbol: 'none',
        lineStyle: { width: 2, color: '#60a5fa' },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(96, 165, 250, 0.25)' },
            { offset: 1, color: 'rgba(96, 165, 250, 0.02)' }
          ])
        },
        markArea: markArea,
        z: 1
      }
    ],
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'line', snap: true, lineStyle: { color: '#6b7280', type: 'dashed' } },
      formatter: params => {
        const p = params[0];
        return `${p.axisValue}<br/><b style="color:#f3f4f6">${p.value}</b> ${data.unit || ''}`;
      },
      confine: true,
      backgroundColor: 'rgba(17, 24, 39, 0.92)',
      borderColor: '#374151',
      borderWidth: 1,
      textStyle: { color: '#d1d5db', fontSize: 12 },
      extraCssText: 'border-radius: 6px; padding: 4px 8px;'
    },
    animationDuration: 600
  };
}

function buildMarkArea(thresholds, values) {
  if (!thresholds) return {};

  const maxVal = Math.max(...values) * 1.1;
  const areas = [];

  if (thresholds.red && thresholds.yellowHigh) {
    areas.push([
      { yAxis: thresholds.yellowHigh, itemStyle: { color: 'rgba(220, 38, 38, 0.08)' } },
      { yAxis: maxVal }
    ]);
  }

  if (thresholds.yellowLow && thresholds.yellowHigh) {
    areas.push([
      { yAxis: thresholds.yellowLow, itemStyle: { color: 'rgba(245, 158, 11, 0.08)' } },
      { yAxis: thresholds.yellowHigh }
    ]);
  }

  if (thresholds.yellowLow) {
    areas.push([
      { yAxis: 0, itemStyle: { color: 'rgba(22, 163, 74, 0.08)' } },
      { yAxis: thresholds.yellowLow }
    ]);
  }

  return { silent: true, data: areas };
}

function parseThresholds(thresholds) {
  if (!thresholds) return null;
  const result = { red: null, yellow: null, green: null };

  if (thresholds.red) {
    const match = thresholds.red.match(/(\d+\.?\d*)/);
    if (match) result.red = parseFloat(match[1]);
  }

  if (thresholds.yellow) {
    const parts = thresholds.yellow.split('-');
    if (parts.length === 2) {
      const low = parseFloat(parts[0]);
      const high = parseFloat(parts[1]);
      result.yellowLow = low;
      result.yellowHigh = high;
    }
  }

  if (thresholds.green) {
    const match = thresholds.green.match(/(\d+\.?\d*)/);
    if (match) result.green = parseFloat(match[1]);
  }

  return result;
}

function toggleChartRange(key, btn) {
  if (key === 'investor_deposits') {
    const amountDom = document.getElementById('chart-korea-investor_deposits-amount');
    const r2TrendDom = document.getElementById('chart-korea-investor_deposits-r2trend');
    if (!amountDom || !amountDom._chartInstance || !amountDom._chartFullData) return;

    const isExpanded = btn.dataset.expanded === 'true';
    const { deposits, margin, etf, col } = amountDom._chartFullData;

    const filter = isExpanded
      ? (h => h.date.startsWith('2026') || h.date.startsWith('2025'))
      : (() => true);

    const depHist = deposits.history.filter(filter);
    const marginHist = (margin?.history || []).filter(filter);
    const colHist = (col || []).filter(filter);
    const etfHist = (etf?.history || []).filter(filter);

    if (isExpanded) {
      btn.textContent = '查看更多 ▾';
      btn.dataset.expanded = 'false';
    } else {
      btn.textContent = '收起 ▴';
      btn.dataset.expanded = 'true';
    }

    amountDom._chartInstance.setOption(buildDepositsAmountOption(depHist, marginHist, colHist, etfHist, deposits.unit), true);
    if (r2TrendDom && r2TrendDom._chartInstance) {
      r2TrendDom._chartInstance.setOption(buildR2TrendOption(depHist, marginHist, deposits.unit), true);
    }
    return;
  }

  const dom = document.getElementById('chart-korea-' + key);
  if (!dom || !dom._chartInstance || !dom._chartFullData) return;

  const isExpanded = btn.dataset.expanded === 'true';
  const fullData = dom._chartFullData;
  const thresholds = dom._chartThresholds;

  let filteredHistory;
  if (isExpanded) {
    filteredHistory = fullData.history.filter(h => h.date.startsWith('2026') || h.date.startsWith('2025'));
    btn.textContent = '查看更多 ▾';
    btn.dataset.expanded = 'false';
  } else {
    filteredHistory = fullData.history;
    btn.textContent = '收起 ▴';
    btn.dataset.expanded = 'true';
  }

  const newData = { ...fullData, history: filteredHistory };
  dom._chartInstance.setOption(buildChartOption(newData, thresholds), true);
}

function handleResize() {
  charts.forEach(c => c && c.resize());
}

function createLeveragedEtfChart(data) {
  const dom = document.getElementById('chart-leveraged-etf');
  if (!dom || !window.echarts) return;
  if (!data.history || data.history.length === 0) {
    dom.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-tertiary);font-size:12px;">暂无历史数据</div>';
    return;
  }

  const chart = echarts.init(dom);
  const peak = data.peak_value || 68;
  const fair = data.fair_value || 24.5;

  const defaultHistory = data.history.filter(h => h.date.startsWith('2026') || h.date.startsWith('2025'));
  chart.setOption(buildLeveragedEtfOption(defaultHistory, peak, fair, data.unit));

  dom._chartFullData = data;
  dom._chartInstance = chart;
  charts.push(chart);
}

function buildLeveragedEtfOption(history, peak, fair, unit) {
  const dates = formatChartDates(history);
  const values = history.map(h => h.value);

  if (values.length === 0) {
    return { grid: { left: 56, right: 24, top: 32, bottom: 36 }, xAxis: { type: 'category', data: [] }, yAxis: { type: 'value' }, series: [] };
  }

  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);

  let yMin = Math.max(0, Math.floor(dataMin * 10) / 10);
  let yMax = Math.ceil((dataMax + 0.5) * 10) / 10;

  return {
    grid: { left: 60, right: 24, top: 28, bottom: 38 },
    xAxis: {
      type: 'category',
      data: dates,
      boundaryGap: false,
      axisLabel: { fontSize: 11, color: '#9ca3af', interval: Math.floor(dates.length / 8) },
      axisLine: { lineStyle: { color: '#374151' } },
      axisTick: { show: false }
    },
    yAxis: {
      type: 'value',
      name: unit || '万亿韩元',
      nameTextStyle: { fontSize: 11, color: '#60a5fa', padding: [0, 0, 0, -2] },
      axisLabel: { fontSize: 11, color: '#60a5fa' },
      axisLine: { show: false },
      splitLine: { lineStyle: { color: '#374151', type: 'dashed' } },
      min: yMin,
      max: yMax,
      scale: true
    },
    series: [
      {
        name: 'cumFlow',
        type: 'bar',
        data: values.map(v => ({
          value: v,
          itemStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(96, 165, 250, 0.85)' },
              { offset: 1, color: 'rgba(96, 165, 250, 0.15)' }
            ]),
            borderRadius: [2, 2, 0, 0]
          }
        })),
        barWidth: '55%',
        z: 1
      }
    ],
    legend: {
      show: true,
      top: 0,
      right: 10,
      textStyle: { fontSize: 11, color: '#9ca3af' },
      itemWidth: 14,
      itemHeight: 8,
      data: ['cumFlow']
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'line', snap: true, lineStyle: { color: '#6b7280', type: 'dashed' } },
      formatter: params => {
        let html = params[0].axisValue;
        params.forEach(p => {
          if (p.value == null) return;
          html += `<br/><span style="color:${p.color}">■</span> cumFlow: <b style="color:#f3f4f6">${Number(p.value).toFixed(2)}</b> ${unit || ''}`;
        });
        return html;
      },
      confine: true,
      backgroundColor: 'rgba(17, 24, 39, 0.92)',
      borderColor: '#374151',
      borderWidth: 1,
      textStyle: { color: '#d1d5db', fontSize: 12 },
      extraCssText: 'border-radius: 6px; padding: 4px 10px;'
    },
    animationDuration: 600
  };
}

function createDepositsR2Chart(depositsData, marginData, etfData) {
  const colHistory = depositsData.extra?.securities_loan_history || [];
  const full = { deposits: depositsData, margin: marginData, etf: etfData, col: colHistory };

  const defaultFilter = h => h.date.startsWith('2026') || h.date.startsWith('2025');
  const defaultDep = depositsData.history.filter(defaultFilter);
  const defaultMargin = (marginData?.history || []).filter(defaultFilter);
  const defaultCol = colHistory.filter(defaultFilter);
  const defaultEtf = (etfData?.history || []).filter(defaultFilter);

  // 上图：绝对额
  const amountDom = document.getElementById('chart-korea-investor_deposits-amount');
  if (amountDom && window.echarts) {
    if (!depositsData.history || !depositsData.history.length) {
      amountDom.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-tertiary);font-size:12px;">暂无历史数据</div>';
    } else {
      const amountChart = echarts.init(amountDom);
      amountChart.setOption(buildDepositsAmountOption(defaultDep, defaultMargin, defaultCol, defaultEtf, depositsData.unit));
      amountDom._chartFullData = full;
      amountDom._chartInstance = amountChart;
      charts.push(amountChart);
    }
  }

  // 下图：R2 趋势图（R2% + 存管金 + 融资余额，双轴）
  const r2TrendDom = document.getElementById('chart-korea-investor_deposits-r2trend');
  if (r2TrendDom && window.echarts) {
    if (!depositsData.history || !depositsData.history.length) {
      r2TrendDom.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-tertiary);font-size:12px;">暂无历史数据</div>';
    } else {
      const r2TrendChart = echarts.init(r2TrendDom);
      r2TrendChart.setOption(buildR2TrendOption(defaultDep, defaultMargin, depositsData.unit));
      r2TrendDom._chartFullData = full;
      r2TrendDom._chartInstance = r2TrendChart;
      charts.push(r2TrendChart);
    }
  }
}

function buildDepositsAmountOption(depHistory, marginHistory, colHistory, etfHistory, unit) {
  const depMap = {};
  depHistory.forEach(h => { depMap[h.date] = h.value; });
  const marginMap = {};
  marginHistory.forEach(h => { marginMap[h.date] = h.value; });
  const colMap = {};
  colHistory.forEach(h => { colMap[h.date] = h.value; });
  const etfMap = {};
  etfHistory.forEach(h => { etfMap[h.date] = h.value; });

  const dates = depHistory
    .filter(h => marginMap[h.date] != null)
    .map(h => h.date);

  const depValues = dates.map(d => depMap[d]);
  const finValues = dates.map(d => marginMap[d]);
  const colValues = dates.map(d => (colMap[d] != null ? colMap[d] : null));
  const etfValues = dates.map(d => (etfMap[d] != null ? etfMap[d] : null));
  const totalValues = dates.map((_, i) => {
    const f = finValues[i] ?? 0;
    const c = colValues[i] ?? 0;
    const e = etfValues[i] ?? 0;
    return (f + c + e) || null;
  });

  const chartDates = formatChartDates(dates.map(d => ({ date: d })));
  const allNumbers = ([]).concat(depValues, finValues.filter(v=>v!=null), colValues.filter(v=>v!=null), etfValues.filter(v=>v!=null), totalValues.filter(v=>v!=null));
  const yMin = Math.max(0, Math.floor(Math.min(...allNumbers) * 0.85));
  const yMax = Math.ceil(Math.max(...allNumbers) * 1.08);

  return {
    grid: { left: 56, right: 24, top: 54, bottom: 28 },
    legend: {
      data: ['存管金','融资余额','证券抵押','杠杆ETF内嵌','杠杆合计（融+抵+ETF）'],
      top: 4,
      left: 'center',
      type: 'scroll',
      textStyle: { fontSize: 11, color: '#78716c' },
      itemWidth: 14,
      itemHeight: 8,
      itemGap: 18
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'line', snap: true, lineStyle: { color: '#6b7280', type: 'dashed' } },
      formatter: params => {
        let html = `<b style="color:#f3f4f6">${params[0].axisValue}</b>`;
        html += '<br/><span style="color:#9ca3af;font-size:11px;">单位：万亿韩元</span>';
        params.forEach(p => {
          if (p.value != null) {
            html += `<br/><span style="color:${p.color}">●</span> ${p.seriesName}: <b style="color:#f3f4f6">${Number(p.value).toFixed(1)}</b>`;
          }
        });
        return html;
      },
      confine: true,
      backgroundColor: 'rgba(17, 24, 39, 0.95)',
      borderColor: '#374151',
      borderWidth: 1,
      textStyle: { color: '#d1d5db', fontSize: 12 },
      extraCssText: 'border-radius: 8px; padding: 8px 12px;'
    },
    xAxis: {
      type: 'category',
      data: chartDates,
      boundaryGap: false,
      axisLabel: { fontSize: 10, color: '#9ca3af', interval: Math.floor(chartDates.length / 7) },
      axisLine: { lineStyle: { color: '#d6d3d1' } },
      axisTick: { show: false }
    },
    yAxis: {
      type: 'value',
      name: unit || '万亿韩元',
      nameTextStyle: { fontSize: 11, color: '#6b7280', padding: [0, 0, 0, -4] },
      axisLabel: { fontSize: 10, color: '#78716c' },
      axisLine: { show: false },
      splitLine: { lineStyle: { color: '#e7e5e4', type: 'dashed' } },
      min: yMin,
      max: yMax
    },
    series: [
      {
        name: '存管金',
        type: 'line',
        data: depValues,
        smooth: true,
        symbol: 'none',
        lineStyle: { width: 2.6, color: '#14b8a6' },
        itemStyle: { color: '#14b8a6' },
        z: 3
      },
      {
        name: '融资余额',
        type: 'line',
        data: finValues,
        smooth: true,
        symbol: 'none',
        lineStyle: { width: 2.2, color: '#ec4899' },
        itemStyle: { color: '#ec4899' },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(236,72,153,0.20)' },
            { offset: 1, color: 'rgba(236,72,153,0.00)' }
          ])
        },
        z: 3
      },
      {
        name: '证券抵押',
        type: 'line',
        data: colValues,
        smooth: true,
        symbol: 'none',
        lineStyle: { width: 2.2, color: '#a855f7' },
        itemStyle: { color: '#a855f7' },
        z: 3
      },
      {
        name: '杠杆ETF内嵌',
        type: 'line',
        data: etfValues,
        smooth: true,
        symbol: 'none',
        lineStyle: { width: 2.2, color: '#3b82f6' },
        itemStyle: { color: '#3b82f6' },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(59,130,246,0.22)' },
            { offset: 1, color: 'rgba(59,130,246,0.00)' }
          ])
        },
        z: 3
      },
      {
        name: '杠杆合计（融+抵+ETF）',
        type: 'line',
        data: totalValues,
        smooth: true,
        symbol: 'none',
        lineStyle: { width: 2.4, color: '#f97316', type: 'solid' },
        itemStyle: { color: '#f97316' },
        z: 3
      }
    ],
    animationDuration: 600
  };
}

function buildR2TrendOption(depHistory, marginHistory, unit) {
  const depMap = {};
  depHistory.forEach(h => { depMap[h.date] = h.value; });
  const marginMap = {};
  marginHistory.forEach(h => { marginMap[h.date] = h.value; });

  const dates = depHistory
    .filter(h => marginMap[h.date] != null)
    .map(h => h.date);

  const depValues = dates.map(d => depMap[d]);
  const finValues = dates.map(d => marginMap[d]);
  const r2Values = dates.map((_, i) => depValues[i] ? (finValues[i] / depValues[i] * 100) : null);

  const chartDates = formatChartDates(dates.map(d => ({ date: d })));

  // Left axis: 万亿韩元 (存管金 + 融资余额)
  const allLeft = [].concat(depValues, finValues).filter(v => v != null);
  const leftMin = Math.max(0, Math.floor(Math.min(...allLeft) * 0.9));
  const leftMax = Math.ceil(Math.max(...allLeft) * 1.08);

  // Right axis: % (R2)
  const r2Valid = r2Values.filter(v => v != null);
  const rightMin = Math.max(0, Math.floor(Math.min(...r2Valid) * 0.9));
  const rightMax = Math.ceil(Math.max(...r2Valid) * 1.15);

  return {
    grid: { left: 56, right: 60, top: 48, bottom: 28 },
    legend: {
      data: ['存管金', '融资余额', 'R2'],
      top: 4,
      left: 'center',
      textStyle: { fontSize: 11, color: '#78716c' },
      itemWidth: 14,
      itemHeight: 8,
      itemGap: 20
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'line', snap: true, lineStyle: { color: '#6b7280', type: 'dashed' } },
      formatter: params => {
        let html = `<b style="color:#f3f4f6">${params[0].axisValue}</b>`;
        params.forEach(p => {
          if (p.value == null) return;
          let unitStr = '';
          if (p.seriesName.includes('R2')) {
            unitStr = `<b style="color:#f3f4f6">${Number(p.value).toFixed(1)}%</b>`;
          } else {
            unitStr = `<b style="color:#f3f4f6">${Number(p.value).toFixed(1)}</b>`;
          }
          html += `<br/><span style="color:${p.color}">●</span> ${p.seriesName}: ${unitStr}`;
        });
        return html;
      },
      confine: true,
      backgroundColor: 'rgba(17, 24, 39, 0.95)',
      borderColor: '#374151',
      borderWidth: 1,
      textStyle: { color: '#d1d5db', fontSize: 12 },
      extraCssText: 'border-radius: 8px; padding: 8px 12px;'
    },
    xAxis: {
      type: 'category',
      data: chartDates,
      boundaryGap: false,
      axisLabel: { fontSize: 10, color: '#9ca3af', interval: Math.floor(chartDates.length / 7) },
      axisLine: { lineStyle: { color: '#d6d3d1' } },
      axisTick: { show: false }
    },
    yAxis: [
      {
        type: 'value',
        name: unit || '万亿韩元',
        position: 'left',
        nameTextStyle: { fontSize: 11, color: '#14b8a6', padding: [0, 0, 0, -4] },
        axisLabel: { fontSize: 10, color: '#78716c' },
        axisLine: { show: false },
        splitLine: { lineStyle: { color: '#e7e5e4', type: 'dashed' } },
        min: leftMin,
        max: leftMax
      },
      {
        type: 'value',
        name: 'R2 %',
        position: 'right',
        nameTextStyle: { fontSize: 11, color: '#ec4899', padding: [0, -4, 0, 0] },
        axisLabel: { fontSize: 10, color: '#78716c', formatter: '{value}%' },
        axisLine: { show: false },
        splitLine: { show: false },
        min: rightMin,
        max: rightMax
      }
    ],
    series: [
      {
        name: '存管金',
        type: 'line',
        yAxisIndex: 0,
        data: depValues,
        smooth: true,
        symbol: 'none',
        lineStyle: { width: 2.6, color: '#14b8a6' },
        itemStyle: { color: '#14b8a6' },
        z: 3
      },
      {
        name: '融资余额',
        type: 'line',
        yAxisIndex: 0,
        data: finValues,
        smooth: true,
        symbol: 'none',
        lineStyle: { width: 2.2, color: '#3b82f6' },
        itemStyle: { color: '#3b82f6' },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(59,130,246,0.20)' },
            { offset: 1, color: 'rgba(59,130,246,0.00)' }
          ])
        },
        z: 3
      },
      {
        name: 'R2',
        type: 'line',
        yAxisIndex: 1,
        data: r2Values,
        smooth: true,
        symbol: 'none',
        lineStyle: { width: 2.4, color: '#ec4899' },
        itemStyle: { color: '#ec4899' },
        z: 4
      }
    ],
    animationDuration: 600
  };
}

function toggleTrendChartRange(key, btn) {
  const isExpanded = btn.dataset.expanded === 'true';

  if (key === 'leveraged_etf') {
    const dom = document.getElementById('chart-leveraged-etf');
    if (!dom || !dom._chartInstance || !dom._chartFullData) return;
    const fullData = dom._chartFullData;
    const peak = fullData.peak_value || 68;
    const fair = fullData.fair_value || 24.5;

    let history;
    if (isExpanded) {
      history = fullData.history.filter(h => h.date.startsWith('2026') || h.date.startsWith('2025'));
      btn.textContent = '查看更多 ▾';
      btn.dataset.expanded = 'false';
    } else {
      history = fullData.history;
      btn.textContent = '收起 ▴';
      btn.dataset.expanded = 'true';
    }

    dom._chartInstance.setOption(buildLeveragedEtfOption(history, peak, fair, fullData.unit), true);
  }
}

async function init() {
  const loaded = await loadData();
  if (!loaded) return;
  const { latest, signals } = loaded;
  renderHeader(latest);
  renderKoreaLights(signals, latest);
  renderKoreaSummary(signals);
  renderKoreaDimensions(latest, signals);
  renderKoreaTrendDimensions(latest);
  window.addEventListener('resize', handleResize);
}

init();
