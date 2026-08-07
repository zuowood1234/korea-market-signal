// 顶部灯卡区专用：korea-lights-grid 同时承载 12 张常规卡 + KOSPI/KOSDAQ/VKOSPI 三张白卡（紧跟融资最高点回落之后），共 15 张同处顶端
const KOREA_DIMENSION_ORDER = ['leverage_14d', 'leverage_1d', 'stability', 'investor_deposits', 'leveraged_etf', 'margin', 'liquidation', 'liquidation_ratio'];

// KOREA_DIMENSION_ORDER 同时驱动顶部信号灯区 + 下方 dim 卡片网格。
// 但用户对 dim 卡的展示顺序有独立要求（存管金稳定性放在散户总杠杆水位+7709之后，VKOSPI 卡片放最后）。
// dim 卡网格改用以下顺序独立渲染，信号灯区保留 KOREA_DIMENSION_ORDER 不变。
// 注：renderKoreaDimensions 内部遇到 'investor_deposits' 后会强制插入 7709 两图，再走下一项。
const KOREA_DIM_CARDS_ORDER = ['investor_deposits', 'stability', 'leveraged_etf', 'liquidation', 'liquidation_ratio', 'vkospi'];  // 已移除 'margin'（融资余额，韩国信用融资）— 胖丁认为冗余

// T+0 指标（KOSPI/KOSDAQ/VKOSPI，当日收盘价）；其余为 T+1（KOFIA 披露滞后）
const T0_KEYS = ['kospi', 'kosdaq', 'vkospi'];

const KOREA_DIMENSION_META = {
  vkospi: { name: 'VKOSPI', direction: 'low_red', displayUnit: '' },
  kospi: { name: 'KOSPI', direction: 'special', displayUnit: '' },
  kosdaq: { name: 'KOSDAQ', direction: 'special', displayUnit: '' },
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
    let aum7709 = [];
    try {
      const aumRes = await fetch('data/7709_aum_history.json' + v);
      aum7709 = await aumRes.json();
    } catch (e) { aum7709 = []; }
    let aum7747 = [];
    try {
      const aumRes2 = await fetch('data/7747_aum_history.json' + v);
      aum7747 = await aumRes2.json();
    } catch (e) { aum7747 = []; }
    return { latest, signals, aum7709, aum7747 };
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

// 计算最高点状态：创新高(上升) vs 回落（提取到顶层，供 renderKoreaLights 与 renderIndexLightsRow 共用）
// prevPeak = 排除当前点后的历史最高值
function computePeakStatus(history) {
  if (!history || history.length < 2) return null;
  const curr = history[history.length - 1].value;
  const prevHist = history.slice(0, -1);
  const prevPeak = prevHist.reduce((m, x) => Math.max(m, x.value), -Infinity);
  const prevPeakDate = prevHist.find(x => x.value === prevPeak)?.date || '';
  if (curr >= prevPeak && prevPeak > 0) {
    const risePct = (curr - prevPeak) / prevPeak * 100;
    return { type: 'up', pct: risePct, prevPeak, prevPeakDate, curr };
  } else if (prevPeak > 0) {
    const dropPct = (prevPeak - curr) / prevPeak * 100;
    return { type: 'down', pct: dropPct, prevPeak, prevPeakDate, curr };
  }
  return null;
}

// 计算日环比辅助函数：从 history 取当前值和上一个值，返回变化百分比字符串（逗号分隔）
function getDayOverDayStr(history) {
  if (!history || history.length < 2) return '';
  const curr = history[history.length - 1].value;
  const prev = history[history.length - 2].value;
  if (prev == null || prev === 0) return '';
  const pct = (curr - prev) / prev * 100;
  const sign = pct >= 0 ? '+' : '';
  return `，${sign}${pct.toFixed(1)}%`;
}

// 今日涨跌幅 emoji：涨幅 >5% 加 🔥，跌幅 >5% 加 🥶（信号卡最后 9 张用）
function dailyHeatEmoji(pct) {
  if (pct == null || isNaN(pct)) return '';
  if (pct > 5) return ' 🔥';
  if (pct < -5) return ' 🥶';
  return '';
}

// 从 history 取最后两点算日环比百分比（数值，非字符串）
function historyDodPct(history) {
  if (!history || history.length < 2) return null;
  const curr = history[history.length - 1].value;
  const prev = history[history.length - 2].value;
  if (prev == null || prev === 0) return null;
  return (curr - prev) / prev * 100;
}

function renderKoreaLights(signals, latest, aum7709, aum7747) {
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

  // getDayOverDayStr 与 computePeakStatus 已提取到顶层（154/171 行），此处直接复用

  KOREA_DIMENSION_ORDER.forEach(key => {
    let sig = null;
    if (key === 'stability') {
      sig = stabilitySig;
    } else if (key === 'leverage_1d') {
      sig = leverageSigs.daily;
    } else if (key === 'leverage_14d') {
      sig = leverageSigs.fourteen;
    } else if (key === 'kospi' || key === 'kosdaq' || key === 'vkospi') {
      // KOSPI/KOSDAQ/VKOSPI：从 history 计算高点上升/回落% 计算数字，但不染色（中性 gray）
      const idxData = koreaLatest[key];
      if (idxData && idxData.history && idxData.history.length > 1) {
        const ps = computePeakStatus(idxData.history);
        if (ps) {
          const peakLabel = ps.type === 'up' ? `上次峰值 ${ps.prevPeak} (${ps.prevPeakDate}) → 新高 ${ps.curr}，+${ps.pct.toFixed(1)}%` : `峰值 ${ps.prevPeak} (${ps.prevPeakDate}) → 当前 ${ps.curr}，回落 ${ps.pct.toFixed(1)}%`;
          sig = { status: 'gray', note: `${idxData.name} ${peakLabel}` };
        }
      }
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

    // 需要显示日环比的指标：强平金额、强平比例、VKOSPI、KOSPI、KOSDAQ
    const needsDod = ['liquidation', 'liquidation_ratio', 'vkospi', 'kospi', 'kosdaq'].includes(key);
    const dodStr = needsDod && dimData ? getDayOverDayStr(dimData.history) : '';

    if (key === 'stability' && stabilityScore != null) {
      const scoreStr = stabilityScore.toFixed(1);
      const tag = stabilitySig.thresholdTag || '';
      valueSuffix = ` <span class="dd-inline">${scoreStr} ${tag}</span>`;
    } else if (key === 'leverage_1d' && sig && sig.label) {
      const abnStr = sig.abn ? ` ${sig.abn}` : '';
      valueSuffix = ` <span class="dd-inline">${sig.label}${abnStr}</span>`;
    } else if (key === 'leverage_14d' && sig && sig.label) {
      const abnStr = sig.abn ? ` ${sig.abn}` : '';
      valueSuffix = ` <span class="dd-inline">${sig.label}${abnStr}</span>`;
    } else if (key === 'kospi' || key === 'kosdaq' || key === 'vkospi') {
      // KOSPI/KOSDAQ/VKOSPI：动态显示 高点上升/回落% + 日环比（整段与指数名同字体，回落与数字间留空格）
      if (dimData && dimData.history && dimData.history.length > 1) {
        const ps = computePeakStatus(dimData.history);
        if (ps) {
          const pctStr = ps.type === 'up'
            ? `最高点上升 +${ps.pct.toFixed(1)}%`
            : `高点回落 ${ps.pct.toFixed(1)}%`;
          valueSuffix = ` ${pctStr}${dodStr}`;
        }
      }
    } else if (key === 'leveraged_etf') {
      // 去化情景/杠杆ETF：已通过标签说明，不需要额外数值
    } else if (dimData && dimData.current_value != null) {
      const val = dimData.current_value;
      const displayUnit = meta.displayUnit || '';
      const thresholds = dimData.thresholds;
      const direction = meta.direction || 'low_red';
      const tag = getThresholdTag(val, thresholds, direction, displayUnit);
      const valStr = Number.isInteger(val) ? String(val) : String(parseFloat(val.toFixed(1)));
      valueSuffix = ` <span class="dd-inline">${valStr}${displayUnit}${tag ? ' ' + tag : ''}${dodStr}</span>`;
    }

    // T+0/T+1 时效角标
    const isT0 = T0_KEYS.includes(key);
    const freshTag = isT0
      ? `<span class="fresh-tag t0">T+0</span>`
      : `<span class="fresh-tag t1">T+1</span>`;

    card.innerHTML = `
      <div class="light-dot"></div>
      <div class="light-label">${meta.name}${valueSuffix}</div>
      ${freshTag}
    `;
    grid.appendChild(card);
  });

  // 渲染融资余额高点卡片（动态：上升/回落）+ 日环比
  if (marginData && marginData.history && marginData.history.length > 1) {
    const h = marginData.history;
    const ps = computePeakStatus(h);
    if (ps) {
      const dodStr = getDayOverDayStr(h);
      let ddCard, label, valueStr, titleStr;
      if (ps.type === 'up') {
        // 创新高 → 红色（融资创新高=危险）
        label = '融资最高点上升';
        valueStr = `+${ps.pct.toFixed(1)}%`;
        titleStr = `上次峰值 ${ps.prevPeak} (${ps.prevPeakDate}) → 新高 ${ps.curr}，+${ps.pct.toFixed(1)}%`;
        ddCard = document.createElement('div');
        ddCard.className = 'light-card red';
      } else {
        // 回落 → 黄色
        label = '融资最高点回落';
        valueStr = `-${ps.pct.toFixed(1)}%`;
        titleStr = `峰值 ${ps.prevPeak} (${ps.prevPeakDate}) → 当前 ${ps.curr}，回落 ${ps.pct.toFixed(1)}%`;
        ddCard = document.createElement('div');
        ddCard.className = 'light-card yellow';
      }
      ddCard.title = titleStr;
      ddCard.innerHTML = `
        <div class="light-dot"></div>
        <div class="light-label">${label} <span class="dd-inline">${valueStr}${dodStr}</span></div>
        <span class="fresh-tag t1">T+1</span>
      `;
      grid.appendChild(ddCard);
    }
  }

  // 三张指数白卡（KOSPI/KOSDAQ/VKOSPI）：紧跟「融资最高点回落」之后，与 7709/7747 等 12 张同处顶端信号灯区（共 15 张）
  ['kospi', 'kosdaq', 'vkospi'].forEach(k => {
    const idxData = koreaLatest[k];
    if (!idxData || !idxData.history || idxData.history.length < 2) return;
    const ps = computePeakStatus(idxData.history);
    if (!ps) return;
    const pctStr = ps.type === 'up'
      ? `最高点上升 +${ps.pct.toFixed(1)}%`
      : `高点回落 ${ps.pct.toFixed(1)}%`;
    const dodStr = getDayOverDayStr(idxData.history);
    const heat = dailyHeatEmoji(historyDodPct(idxData.history));
    const isT0 = T0_KEYS.includes(k);
    const card = document.createElement('div');
    card.className = 'light-card gray korea-index-light';
    card.title = `${idxData.name} ${pctStr}${dodStr.replace(/^，/, '')}`;
    card.innerHTML = `
      <div class="light-dot"></div>
      <div class="light-label">${idxData.name} ${pctStr}${dodStr}${heat}</div>
      <span class="fresh-tag ${isT0 ? 't0' : 't1'}">${isT0 ? 'T+0' : 'T+1'}</span>
    `;
    grid.appendChild(card);
  });

  // 渲染 7709 AUM 信号卡片：从峰值回落% + 日环比%（中性灰，不染红黄绿）
  if (aum7709 && aum7709.length >= 2) {
    const aumHist = aum7709.map(r => ({ value: r.aum_usd, date: r.date }));
    const ps = computePeakStatus(aumHist);
    const dodStr = getDayOverDayStr(aumHist);
    if (ps) {
      const dropStr = ps.type === 'up' ? '0.0%' : ('-' + ps.pct.toFixed(1) + '%');
      const labelTxt = ps.type === 'up' ? '7709 AUM 创新高' : '7709 AUM 峰值回落';
      const card7709 = document.createElement('div');
      card7709.className = 'light-card gray';
      card7709.title = '7709 (CSOP SK Hynix 2x) AUM：峰值 ' + ps.prevPeakDate + ' → 当前回落 ' + ps.pct.toFixed(1) + '% · 日环比 ' + dodStr.replace(/^，/, '');
      card7709.innerHTML = `
        <div class="light-dot"></div>
      <div class="light-label">${labelTxt} ${dropStr}${dodStr}${dailyHeatEmoji(historyDodPct(aumHist))}</div>
      <span class="fresh-tag t0">T+0</span>
      `;
      grid.appendChild(card7709);
    }
  }

  // 渲染 7709 溢价率信号卡片：今日 vs 昨日（中性灰，不染色）
  if (aum7709 && aum7709.length >= 2) {
    const lastP = aum7709[aum7709.length - 1];
    const prevP = aum7709[aum7709.length - 2];
    const premToday = lastP.premium;
    const premYest = prevP ? prevP.premium : null;
    const premStr = premToday != null ? premToday.toFixed(2) + '%' : '-';
    const yestStr = premYest != null ? premYest.toFixed(2) + '%' : '-';
    const premChg = (premToday != null && premYest != null) ? premToday - premYest : null;
    const premCard = document.createElement('div');
    premCard.className = 'light-card gray';
    premCard.title = '7709 (CSOP SK Hynix 2x) 溢价率：今日 ' + premStr + ' vs 昨日 ' + yestStr + '（>5% 高溢价风险）';
      premCard.innerHTML = `
        <div class="light-dot"></div>
        <div class="light-label">7709 溢价率 今 ${premStr} · 昨 ${yestStr}${dailyHeatEmoji(premChg)}</div>
        <span class="fresh-tag t0">T+0</span>
      `;
    grid.appendChild(premCard);

    // 渲染 7709 今日涨跌% 信号卡片：收市价日涨跌幅 + 从高点回落%（中性灰，不染红涨绿跌）
    const chgToday = lastP.daily_change_pct;
    const chgStr = chgToday != null ? (chgToday >= 0 ? '+' : '') + chgToday.toFixed(1) + '%' : '-';
    // 7709 自身收市价从历史高点回落%（与 AUM 峰值回落区分）
    const closes = aum7709.map(r => r.close_price).filter(v => v != null);
    const highClose = closes.length ? Math.max(...closes) : null;
    const ddPct = (highClose != null && lastP.close_price != null && highClose > 0)
      ? (lastP.close_price - highClose) / highClose * 100 : null;
    const ddStr = ddPct != null ? (ddPct >= 0 ? '+' : '') + ddPct.toFixed(1) + '%' : '-';
    const chgCard = document.createElement('div');
    chgCard.className = 'light-card gray';
    chgCard.title = '7709 (CSOP SK Hynix 2x) 今日收市价涨跌 ' + chgStr + ' · 最高点回落 ' + ddStr;
      chgCard.innerHTML = `
        <div class="light-dot"></div>
        <div class="light-label">7709 最高点回落 ${ddStr}， ${chgStr}${dailyHeatEmoji(chgToday)}</div>
        <span class="fresh-tag t0">T+0</span>
      `;
    grid.appendChild(chgCard);
  }

  // ===== 7747 信号卡片（CSOP Samsung Electronics 2x）=====
  if (aum7747 && aum7747.length >= 2) {
    const aumHist7 = aum7747.map(r => ({ value: r.aum_usd, date: r.date }));
    const ps7 = computePeakStatus(aumHist7);
    const dodStr7 = getDayOverDayStr(aumHist7);
    if (ps7) {
      const dropStr7 = ps7.type === 'up' ? '0.0%' : ('-' + ps7.pct.toFixed(1) + '%');
      const label7 = ps7.type === 'up' ? '7747 AUM 创新高' : '7747 AUM 峰值回落';
      const card7747 = document.createElement('div');
      card7747.className = 'light-card gray';
      card7747.title = '7747 (CSOP Samsung Electronics 2x) AUM：峰值 ' + ps7.prevPeakDate + ' → 当前回落 ' + ps7.pct.toFixed(1) + '% · 日环比 ' + dodStr7.replace(/^，/, '');
      card7747.innerHTML = `
        <div class="light-dot"></div>
      <div class="light-label">${label7} ${dropStr7}${dodStr7}${dailyHeatEmoji(historyDodPct(aumHist7))}</div>
      <span class="fresh-tag t0">T+0</span>
      `;
      grid.appendChild(card7747);
    }
    const lastP7 = aum7747[aum7747.length - 1];
    const prevP7 = aum7747[aum7747.length - 2];
    const premToday7 = lastP7.premium;
    const premYest7 = prevP7 ? prevP7.premium : null;
    const premStr7 = premToday7 != null ? premToday7.toFixed(2) + '%' : '-';
    const yestStr7 = premYest7 != null ? premYest7.toFixed(2) + '%' : '-';
    const premChg7 = (premToday7 != null && premYest7 != null) ? premToday7 - premYest7 : null;
    const premCard7 = document.createElement('div');
    premCard7.className = 'light-card gray';
    premCard7.title = '7747 (CSOP Samsung Electronics 2x) 溢价率：今日 ' + premStr7 + ' vs 昨日 ' + yestStr7 + '（>5% 高溢价风险）';
      premCard7.innerHTML = `
        <div class="light-dot"></div>
        <div class="light-label">7747 溢价率 今 ${premStr7} · 昨 ${yestStr7}${dailyHeatEmoji(premChg7)}</div>
        <span class="fresh-tag t0">T+0</span>
      `;
    grid.appendChild(premCard7);

    const chgToday7 = lastP7.daily_change_pct;
    const chgStr7 = chgToday7 != null ? (chgToday7 >= 0 ? '+' : '') + chgToday7.toFixed(1) + '%' : '-';
    const closes7 = aum7747.map(r => r.close_price).filter(v => v != null);
    const highClose7 = closes7.length ? Math.max(...closes7) : null;
    const ddPct7 = (highClose7 != null && lastP7.close_price != null && highClose7 > 0)
      ? (lastP7.close_price - highClose7) / highClose7 * 100 : null;
    const ddStr7 = ddPct7 != null ? (ddPct7 >= 0 ? '+' : '') + ddPct7.toFixed(1) + '%' : '-';
    const chgCard7 = document.createElement('div');
    chgCard7.className = 'light-card gray';
    chgCard7.title = '7747 (CSOP Samsung Electronics 2x) 今日收市价涨跌 ' + chgStr7 + ' · 最高点回落 ' + ddStr7;
      chgCard7.innerHTML = `
        <div class="light-dot"></div>
        <div class="light-label">7747 最高点回落 ${ddStr7}， ${chgStr7}${dailyHeatEmoji(chgToday7)}</div>
        <span class="fresh-tag t0">T+0</span>
      `;
    grid.appendChild(chgCard7);
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

  // 异常强化: 用独立颜色区分三种危险状态
  // - 原生C（无异常）= red 红色
  // - B被异常强化升级为红 = orange 橙色（异常警戒）
  // - C + 异常强化 = darkred 红棕色（危险·强化）
  let enhanced = false;
  if (color === 'yellow' && (mAbn || dAbn)) {
    color = 'orange'; enhanced = true; label = '异常警戒';
  } else if (color === 'red' && (mAbn || dAbn)) {
    color = 'darkred'; enhanced = true; label = '危险·强化';
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
  const dailyAbn = (daily.mAbn ? '融' : '') + (daily.dAbn ? '存' : '');
  result.daily = {
    status: daily.color,
    note: `单日情景 ${daily.scenario} ${daily.label} · 融资${m1 >= 0 ? '+' : ''}${m1.toFixed(2)}% 存管金${d1 >= 0 ? '+' : ''}${d1.toFixed(2)}% R2${r2_1 >= 0 ? '+' : ''}${r2_1.toFixed(2)}pp${daily.enhanced ? ' · 异常强化' : ''}`,
    label: daily.label,
    abn: dailyAbn
  };

  // 14日
  const m14 = (marD[latest] - marD[prev14]) / marD[prev14] * 100;
  const d14 = (depD[latest] - depD[prev14]) / depD[prev14] * 100;
  const r2_14 = marD[latest] / depD[latest] * 100 - marD[prev14] / depD[prev14] * 100;
  const fourteen = classifyLeverageScenario(m14, d14, r2_14, '14d');
  const fourteenAbn = (fourteen.mAbn ? '融' : '') + (fourteen.dAbn ? '存' : '');
  result.fourteen = {
    status: fourteen.color,
    note: `14日情景 ${fourteen.scenario} ${fourteen.label} · 融资${m14 >= 0 ? '+' : ''}${m14.toFixed(2)}% 存管金${d14 >= 0 ? '+' : ''}${d14.toFixed(2)}% R2${r2_14 >= 0 ? '+' : ''}${r2_14.toFixed(2)}pp${fourteen.enhanced ? ' · 异常强化' : ''}`,
    label: fourteen.label,
    abn: fourteenAbn
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
          <tr class="row-green"><td>A</td><td>↓</td><td>↑</td><td>↓</td><td>新钱入场稀释杠杆</td><td>🟢</td></tr>
          <tr class="row-green"><td>A</td><td>↑</td><td>↑</td><td>↓</td><td>大量自有现金涌入股市，流入速度超过散户借钱速度</td><td>🟢</td></tr>
          <tr class="row-yellow"><td>B</td><td>↓</td><td>↓</td><td>↓</td><td>爆仓盘出清，但现金没跑，杠杆硬着陆</td><td>🟡</td></tr>
          <tr class="row-yellow"><td>B</td><td>↑</td><td>↑</td><td>↑</td><td>借的钱（融资）膨胀得比现金快得多</td><td>🟡</td></tr>
          <tr class="row-red"><td>C</td><td>↓</td><td>↓</td><td>↑</td><td>现金流失比债务还快，主动退场，流动性枯竭，易触发新一轮爆仓</td><td>🔴</td></tr>
          <tr class="row-red"><td>C</td><td>↑</td><td>↓</td><td>↑</td><td>盈利离场，纯加杠杆且场内资金非常不理性</td><td>🔴</td></tr>
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
        判定流程：① 用正负号定方向（↑/↓，无横盘）→ ② 匹配情景表得初始红黄绿 → ③ 异常阈值强化（黄→橙，红→深红棕）
      </p>

      <p class="explainer-note">
        <b>三种危险颜色区分</b>：<br>
        🔴 <b>危险</b>（红色）= 原生C情景，无异常强化；<br>
        🟠 <b>异常警戒</b>（橙色）= 初始B中性被异常强化升级为红色；<br>
        🟤 <b>危险·强化</b>（红棕色）= 原生C情景且同时触发异常阈值。
      </p>

      <p class="explainer-note">
        <b>追踪表说明</b>：<br>
        「异常」列：「融」=融资变化超阈值，「存」=存管金变化超阈值；<br>
        「情景」列：B→C = 初始B中性被异常强化为C，C·强化 = 初始C且同时触发异常阈值。
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
    { status: 'green', label: '稳定信号', count: koreaSignals.green_count || 0 },
    { status: 'gray', label: '数据缺失', count: koreaSignals.gray_count || 0 },
  ];
  el.innerHTML = items.map(i => `
    <div class="summary-item">
      <div class="summary-dot ${i.status}"></div>
      <span>${i.label} ${i.count}</span>
    </div>
  `).join('');
}

function renderKoreaDimensions(latest, signals, aum7709, aum7747) {
  const koreaLatest = latest.korea || {};
  const koreaSignals = signals.korea || {};
  const grid = document.getElementById('korea-dimensions-grid');
  if (!grid) return;
  grid.innerHTML = '';

  KOREA_DIM_CARDS_ORDER.forEach((key, idx) => {
    const data = koreaLatest[key];
    const sig = koreaSignals.signals ? koreaSignals.signals[key] : null;

    if (key === 'investor_deposits') {
      if (!data) return;
      const marginData = koreaLatest.margin;
      const etfData = koreaLatest.leveraged_etf;
      renderDepositsR2Card(grid, data, marginData, etfData, idx);
      // 紧贴散户总杠杆水位卡正下方插入 7709 图表（占整行）
      render7709Charts(grid, aum7709, etfData);
      // 7747 图表区块紧跟 7709 之后（同属 CSOP 杠杆 ETF，相邻展示）
      render7747Charts(grid, aum7747, etfData);
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

    if (key === 'vkospi') {
      if (!data) return;
      renderVkospiCard(grid, data, idx);
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
      <div class="lev-chart-block-title">存管金 · 融资余额 · 证券抵押 vs R2（融资/存管金）</div>
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
      const b = document.getElementById('chart-korea-investor_deposits-r2trend');
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
  `;
  grid.appendChild(card);
  setTimeout(() => createLeveragedEtfChart(etfData), 50 + idx * 30);
}

function renderVkospiCard(grid, vkospiData, idx) {
  const current = vkospiData.current_value;
  const hist = vkospiData.history || [];
  if (hist.length === 0) return;
  const prev = hist.length >= 2 ? hist[hist.length - 2].value : null;
  const dodStr = (prev != null && prev !== 0)
    ? `${current >= prev ? '+' : ''}${((current - prev) / prev * 100).toFixed(1)}%`
    : '';

  const card = document.createElement('div');
  card.className = 'dim-card';
  card.innerHTML = `
    <div class="dim-card-header">
      <div>
        <div class="dim-card-title">${vkospiData.name || 'VKOSPI'}</div>
        <div class="dim-card-sub">${vkospiData.subtitle || '韩国波动率指数'}</div>
      </div>
    </div>
    <div class="dim-value">${current != null ? current : '—'}<span class="dim-value-unit">${vkospiData.unit || ''}</span></div>
    <div class="dim-note">日环比 ${dodStr} · 数据源 ${vkospiData.data_source || ''}（每两周披露一次）</div>
    <div class="dim-chart" id="chart-vkospi"></div>
  `;
  grid.appendChild(card);
  setTimeout(() => createVkospiChart(vkospiData), 50 + idx * 30);
}

function createVkospiChart(data) {
  const dom = document.getElementById('chart-vkospi');
  if (!dom || !window.echarts) return;
  if (!data.history || data.history.length === 0) {
    dom.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-tertiary);font-size:12px;">暂无历史数据</div>';
    return;
  }
  const chart = echarts.init(dom);
  chart.setOption(buildVkospiOption(data.history));
  dom._chartFullData = data.history;
  dom._chartInstance = chart;
  charts.push(chart);
}

function buildVkospiOption(history) {
  const dates = formatChartDates(history);
  const values = history.map(h => h.value);
  const color = '#8b5cf6';
  return {
    grid: { left: 48, right: 16, top: 36, bottom: 36 },
    legend: {
      data: [{ name: 'VKOSPI', textStyle: { color: '#8b5cf6' } }],
      top: 2, left: 'center',
      itemWidth: 14, itemHeight: 8, itemGap: 16,
      textStyle: { fontSize: 11 }
    },
    xAxis: {
      type: 'category',
      data: dates,
      boundaryGap: false,
      axisLabel: { fontSize: 10, color: '#9ca3af', interval: Math.floor(dates.length / 6) },
      axisLine: { lineStyle: { color: '#d6d3d1' } },
      axisTick: { show: false }
    },
    yAxis: {
      type: 'value',
      name: 'VKOSPI',
      nameTextStyle: { fontSize: 11, color: '#6b7280', padding: [0, 0, 0, -4] },
      axisLabel: { fontSize: 10, color: '#78716c' },
      axisLine: { show: false },
      splitLine: { lineStyle: { color: '#e7e5e4', type: 'dashed' } },
      scale: true
    },
    series: [
      {
        name: 'VKOSPI',
        type: 'line',
        data: values,
        smooth: true,
        symbol: 'circle',
        symbolSize: 4,
        lineStyle: { width: 2.2, color: color },
        itemStyle: { color: color },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(139,92,246,0.22)' },
            { offset: 1, color: 'rgba(139,92,246,0.02)' }
          ])
        },
        markLine: {
          silent: true, symbol: 'none',
          data: [{ yAxis: 30, lineStyle: { color: '#dc2626', type: 'dashed', width: 1.4 }, label: { formatter: '高位 30', color: '#dc2626', fontSize: 10, position: 'insideEndTop' } }]
        },
        z: 3
      }
    ],
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'line', snap: true, lineStyle: { color: '#6b7280', type: 'dashed' } },
      formatter: params => {
        const p = params[0];
        return `<b style="color:#f3f4f6">${p.axisValue}</b><br/><span style="color:${color}">●</span> VKOSPI: <b style="color:#f3f4f6">${p.value != null ? Number(p.value).toFixed(1) : '-'}</b>`;
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
    const r2TrendDom = document.getElementById('chart-korea-investor_deposits-r2trend');
    if (!r2TrendDom || !r2TrendDom._chartInstance || !r2TrendDom._chartFullData) return;

    const isExpanded = btn.dataset.expanded === 'true';
    const { deposits, margin, etf, col } = r2TrendDom._chartFullData;

    const filter = isExpanded
      ? (h => h.date.startsWith('2026') || h.date.startsWith('2025'))
      : (() => true);

    const depHist = deposits.history.filter(filter);
    const marginHist = (margin?.history || []).filter(filter);
    const colHist = (col || []).filter(filter);

    if (isExpanded) {
      btn.textContent = '查看更多 ▾';
      btn.dataset.expanded = 'false';
    } else {
      btn.textContent = '收起 ▴';
      btn.dataset.expanded = 'true';
    }

    r2TrendDom._chartInstance.setOption(buildR2TrendOption(depHist, marginHist, colHist, deposits.unit), true);
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
  // 起始日期固定为 2026-01-01（胖丁偏好）
  const history = (data.history || []).filter(h => h.date >= '2026-01-01');
  if (history.length === 0) {
    dom.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-tertiary);font-size:12px;">暂无历史数据</div>';
    return;
  }

  const chart = echarts.init(dom);
  const peak = data.peak_value || 68;
  const fair = data.fair_value || 24.5;

  // 默认全量（自 2026-01-01 起）展示，不再折叠（胖丁偏好：杠杆ETF累积净流入图不要"查看更多"）
  chart.setOption(buildLeveragedEtfOption(history, peak, fair, data.unit));

  dom._chartFullData = { ...data, history };
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
      itemWidth: 14,
      itemHeight: 8,
      data: [{ name: 'cumFlow', textStyle: { color: '#60a5fa' } }],
      textStyle: { fontSize: 11 }
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

  // 图：R2 趋势图（R2% + 存管金 + 融资余额 + 证券抵押，左轴金额、右轴 R2%）
  const r2TrendDom = document.getElementById('chart-korea-investor_deposits-r2trend');
  if (r2TrendDom && window.echarts) {
    if (!depositsData.history || !depositsData.history.length) {
      r2TrendDom.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-tertiary);font-size:12px;">暂无历史数据</div>';
    } else {
      const r2TrendChart = echarts.init(r2TrendDom);
      r2TrendChart.setOption(buildR2TrendOption(defaultDep, defaultMargin, defaultCol, depositsData.unit));
      r2TrendDom._chartFullData = full;
      r2TrendDom._chartInstance = r2TrendChart;
      charts.push(r2TrendChart);
    }
  }
}

function buildR2TrendOption(depHistory, marginHistory, colHistory, unit) {
  const depMap = {};
  depHistory.forEach(h => { depMap[h.date] = h.value; });
  const marginMap = {};
  marginHistory.forEach(h => { marginMap[h.date] = h.value; });
  const colMap = {};
  (colHistory || []).forEach(h => { colMap[h.date] = h.value; });

  const dates = depHistory
    .filter(h => marginMap[h.date] != null)
    .map(h => h.date);

  const depValues = dates.map(d => depMap[d]);
  const finValues = dates.map(d => marginMap[d]);
  const colValues = dates.map(d => (colMap[d] != null ? colMap[d] : null));
  const r2Values = dates.map((_, i) => depValues[i] ? (finValues[i] / depValues[i] * 100) : null);

  const chartDates = formatChartDates(dates.map(d => ({ date: d })));

  // Left axis: 万亿韩元 (存管金 + 融资余额 + 证券抵押)
  const allLeft = [].concat(depValues, finValues, colValues).filter(v => v != null);
  const leftMin = Math.max(0, Math.floor(Math.min(...allLeft) * 0.9));
  const leftMax = Math.ceil(Math.max(...allLeft) * 1.08);

  // Right axis: % (R2)
  const r2Valid = r2Values.filter(v => v != null);
  const rightMin = Math.max(0, Math.floor(Math.min(...r2Valid) * 0.9));
  const rightMax = Math.ceil(Math.max(...r2Valid) * 1.15);

  return {
    grid: { left: 56, right: 60, top: 48, bottom: 28 },
    legend: {
      data: [
        { name: '存管金', textStyle: { color: '#14b8a6' } },
        { name: '融资余额', textStyle: { color: '#3b82f6' } },
        { name: '证券抵押', textStyle: { color: '#a855f7' } },
        { name: 'R2', textStyle: { color: '#ec4899' } }
      ],
      top: 4,
      left: 'center',
      itemWidth: 14,
      itemHeight: 8,
      itemGap: 20,
      textStyle: { fontSize: 11 }
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
        name: '证券抵押',
        type: 'line',
        yAxisIndex: 0,
        data: colValues,
        smooth: true,
        symbol: 'none',
        lineStyle: { width: 2.2, color: '#a855f7' },
        itemStyle: { color: '#a855f7' },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(168,85,247,0.18)' },
            { offset: 1, color: 'rgba(168,85,247,0.00)' }
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
      history = fullData.history.filter(h => h.date >= '2026-01-01');
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
  const { latest, signals, aum7709, aum7747 } = loaded;
  renderHeader(latest);
  renderKoreaLights(signals, latest, aum7709, aum7747);
  renderKoreaSummary(signals);
  renderKoreaDimensions(latest, signals, aum7709, aum7747);
  renderKoreaTrendDimensions(latest);
  window.addEventListener('resize', handleResize);
}

init();

// 7709 AUM 展示用：港币(HKD)→韩元(KRW) 近似固定汇率（标注"约"，如需精确改此常数）
const HKD_TO_KRW = 175;

function createCombined7709Chart(history) {
  const dom = document.getElementById('chart-combined-7709');
  if (!dom || !window.echarts) return;
  const chart = echarts.init(dom);
  const dates = formatChartDates(history);
  const aumKRW = history.map(h => +(h.aum_usd * HKD_TO_KRW / 1e8).toFixed(2));
  const peakVal = Math.max(...aumKRW);
  const cum = history.map(h => (h.cum_change_pct != null ? +h.cum_change_pct.toFixed(2) : null));
  chart.setOption({
    legend: {
      data: [
        { name: 'AUM(亿韩元)', textStyle: { color: '#60a5fa' } },
        { name: '累计涨跌幅%', textStyle: { color: '#f472b6' } }
      ],
      top: 2, right: 8, itemWidth: 14, itemHeight: 8,
      textStyle: { fontSize: 11 }
    },
    grid: { left: 52, right: 46, top: 34, bottom: 30 },
    xAxis: {
      type: 'category', data: dates, boundaryGap: false,
      axisLabel: { fontSize: 10, color: '#9ca3af', interval: 'auto', hideOverlap: true, formatter: v => v.length > 5 ? v.slice(0, 5) : v },
      axisLine: { lineStyle: { color: '#374151' } }, axisTick: { show: false }
    },
    yAxis: [
      {
        type: 'value', name: '亿韩元', scale: true, position: 'left',
        nameTextStyle: { fontSize: 10, color: '#60a5fa' },
        axisLabel: { fontSize: 10, color: '#60a5fa' },
        axisLine: { show: false }, splitLine: { lineStyle: { color: '#374151', type: 'dashed' } }
      },
      {
        type: 'value', name: '%', scale: true, position: 'right',
        nameTextStyle: { fontSize: 10, color: '#c084fc' },
        axisLabel: { fontSize: 10, color: '#c084fc' },
        axisLine: { show: false }, splitLine: { show: false }
      }
    ],
    series: [
      {
        name: 'AUM(亿韩元)', type: 'line', yAxisIndex: 0, data: aumKRW, smooth: true, symbol: 'none',
        lineStyle: { width: 2.2, color: '#60a5fa' },
        areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: 'rgba(96,165,250,0.28)' },
          { offset: 1, color: 'rgba(96,165,250,0.02)' }
        ]) },
        markLine: {
          silent: true, symbol: 'none',
          data: [{ yAxis: peakVal, lineStyle: { color: '#f59e0b', type: 'dashed', width: 1.5 },
            label: { formatter: '峰值 ' + peakVal.toFixed(0) + '亿', color: '#f59e0b', fontSize: 10, position: 'insideEndTop' } }],
          z: 2
        },
        z: 1
      },
      {
        name: '累计涨跌幅%', type: 'line', yAxisIndex: 1, data: cum, smooth: true, symbol: 'none',
        lineStyle: { width: 1.6, color: '#f472b6' },
        z: 3
      }
    ],
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'line', snap: true, lineStyle: { color: '#6b7280', type: 'dashed' } },
      formatter: params => {
        const i = params[0].dataIndex; const h = history[i];
        const aumV = aumKRW[i];
        const v = h.cum_change_pct; const dv = h.daily_change_pct;
        return `${h.date}<br/>`
          + `AUM: <b>${aumV != null ? aumV.toFixed(0) : '-'}</b> 亿韩元(约)<br/>`
          + `累计涨跌幅: <b style="color:#f472b6">${v != null ? (v >= 0 ? '+' : '') + v.toFixed(2) : '-'}%</b><br/>`
          + `当日涨跌: ${dv != null ? (dv >= 0 ? '+' : '') + dv.toFixed(2) + '%' : '-'}<br/>`
          + `收市价: ${h.close_price != null ? h.close_price.toFixed(2) : '-'} · 份额: ${(h.units / 1e8).toFixed(2)} 亿份`;
      },
      confine: true,
      backgroundColor: 'rgba(17,24,39,0.92)', borderColor: '#374151', borderWidth: 1,
      textStyle: { color: '#d1d5db', fontSize: 12 },
      extraCssText: 'border-radius:6px;padding:4px 10px;'
    },
    animationDuration: 600
  });
  dom._chartInstance = chart;
  charts.push(chart);
}

// 7709 每日溢价率独立图（从合并图拆出，单独展示）
function createPremium7709Chart(history) {
  const dom = document.getElementById('chart-premium-7709');
  if (!dom || !window.echarts) return;
  const chart = echarts.init(dom);
  const dates = formatChartDates(history);
  const prem = history.map(h => (h.premium != null ? +h.premium.toFixed(2) : null));
  chart.setOption({
    grid: { left: 46, right: 16, top: 30, bottom: 30 },
    legend: {
      data: [{ name: '每日溢价率%', textStyle: { color: '#c084fc' } }],
      top: 2, right: 8, itemWidth: 14, itemHeight: 8,
      textStyle: { fontSize: 11 }
    },
    xAxis: {
      type: 'category', data: dates, boundaryGap: false,
      axisLabel: { fontSize: 10, color: '#9ca3af', interval: 'auto', hideOverlap: true, formatter: v => v.length > 5 ? v.slice(0, 5) : v },
      axisLine: { lineStyle: { color: '#374151' } }, axisTick: { show: false }
    },
    yAxis: {
      type: 'value', name: '%', scale: true,
      nameTextStyle: { fontSize: 10, color: '#c084fc' },
      axisLabel: { fontSize: 10, color: '#c084fc' },
      axisLine: { show: false }, splitLine: { lineStyle: { color: '#374151', type: 'dashed' } }
    },
    series: [{
      name: '每日溢价率%', type: 'line', data: prem, smooth: true, symbol: 'none',
      lineStyle: { width: 1.6, color: '#c084fc' },
      areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
        { offset: 0, color: 'rgba(192,132,252,0.18)' },
        { offset: 1, color: 'rgba(192,132,252,0.01)' }
      ]) },
      markLine: { silent: true, symbol: 'none',
        data: [{ yAxis: 0, lineStyle: { color: '#6b7280', type: 'solid', width: 1 } }], z: 2 },
      z: 1
    }],
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'line', snap: true, lineStyle: { color: '#6b7280', type: 'dashed' } },
      formatter: params => {
        const i = params[0].dataIndex; const h = history[i];
        const pv = h.premium;
        return `${h.date}<br/>每日溢价率: <b style="color:#c084fc">${pv != null ? pv.toFixed(2) : '-'}%</b>`;
      },
      confine: true, backgroundColor: 'rgba(17,24,39,0.92)', borderColor: '#374151', borderWidth: 1,
      textStyle: { color: '#d1d5db', fontSize: 12 }, extraCssText: 'border-radius:6px;padding:4px 10px;'
    },
    animationDuration: 600
  });
  dom._chartInstance = chart;
  charts.push(chart);
}

// 7709 图表：第一行 合并图(AUM+累计) | 每日溢价率；第二行 份额(亿份) | 杠杆ETF累积净流入
// 显示在散户总杠杆水位（investor_deposits）卡正下方
function render7709Charts(grid, history, etfData) {
  if (!grid) return;
  // 移除旧的（避免重复）
  const old = grid.querySelector(':scope > .korea-7709-charts');
  if (old) old.remove();
  if (!history || history.length === 0) {
    grid.appendChild(Object.assign(document.createElement('div'), {
      className: 'korea-7709-charts',
      innerHTML: '<div class="dim-note">暂无 7709 图表数据</div>'
    }));
    return;
  }
  const wrap = document.createElement('div');
  wrap.className = 'korea-7709-charts';
  wrap.innerHTML = `
    <div class="korea-7709-charts-section-title">7709 · CSOP SK Hynix 2x 杠杆 ETF · 跟踪曲线</div>
    <div class="korea-7709-charts-inner">
      <div class="korea-7709-chart-col">
        <div class="korea-7709-chart-title">AUM（亿韩元·约）与累计涨跌幅（%）</div>
        <div class="dim-chart" id="chart-combined-7709" style="height:300px;"></div>
      </div>
      <div class="korea-7709-chart-col">
        <div class="korea-7709-chart-title">每日溢价率（%）</div>
        <div class="dim-chart" id="chart-premium-7709" style="height:300px;"></div>
      </div>
      <div class="korea-7709-chart-col">
        <div class="korea-7709-chart-title">份额（亿份）</div>
        <div class="dim-chart" id="chart-units-7709" style="height:300px;"></div>
      </div>
    </div>
  `;
  grid.appendChild(wrap);
  setTimeout(() => {
    createCombined7709Chart(history);
    createPremium7709Chart(history);
    createUnits7709Chart(history);
  }, 80);
}

// 7709 份额（units）折线图，单位亿份
function createUnits7709Chart(history) {
  const dom = document.getElementById('chart-units-7709');
  if (!dom || !window.echarts) return;
  const chart = echarts.init(dom);
  const dates = formatChartDates(history);
  const unitsYi = history.map(h => +(h.units / 1e8).toFixed(2));
  const peakVal = Math.max(...unitsYi);
  chart.setOption({
    grid: { left: 46, right: 16, top: 30, bottom: 30 },
    legend: {
      data: [{ name: '份额(亿份)', textStyle: { color: '#f59e0b' } }],
      top: 2, right: 8, itemWidth: 14, itemHeight: 8,
      textStyle: { fontSize: 11 }
    },
    xAxis: {
      type: 'category', data: dates, boundaryGap: false,
      axisLabel: { fontSize: 10, color: '#9ca3af', interval: 'auto', hideOverlap: true, formatter: v => v.length > 5 ? v.slice(0, 5) : v },
      axisLine: { lineStyle: { color: '#374151' } }, axisTick: { show: false }
    },
    yAxis: {
      type: 'value', name: '亿份', scale: true,
      nameTextStyle: { fontSize: 10, color: '#f59e0b' },
      axisLabel: { fontSize: 10, color: '#f59e0b' },
      axisLine: { show: false }, splitLine: { lineStyle: { color: '#374151', type: 'dashed' } }
    },
    series: [{
      name: '份额(亿份)', type: 'line', data: unitsYi, smooth: true, symbol: 'none',
      lineStyle: { width: 1.8, color: '#f59e0b' },
      areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
        { offset: 0, color: 'rgba(245,158,11,0.20)' },
        { offset: 1, color: 'rgba(245,158,11,0.01)' }
      ]) },
      markLine: { silent: true, symbol: 'none',
        data: [{ yAxis: peakVal, lineStyle: { color: '#f59e0b', type: 'dashed', width: 1.2 },
          label: { formatter: '峰值 ' + peakVal.toFixed(2) + '亿份', color: '#f59e0b', fontSize: 10, position: 'insideEndTop' } }],
        z: 2 },
      z: 1
    }],
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'line', snap: true, lineStyle: { color: '#6b7280', type: 'dashed' } },
      formatter: params => {
        const i = params[0].dataIndex; const h = history[i];
        const u = h.units;
        return `${h.date}<br/>份额: <b style="color:#f59e0b">${u != null ? (u / 1e8).toFixed(2) : '-'}</b> 亿份`;
      },
      confine: true, backgroundColor: 'rgba(17,24,39,0.92)', borderColor: '#374151', borderWidth: 1,
      textStyle: { color: '#d1d5db', fontSize: 12 }, extraCssText: 'border-radius:6px;padding:4px 10px;'
    },
    animationDuration: 600
  });
  dom._chartInstance = chart;
  charts.push(chart);
}

// ===== 7747（CSOP Samsung Electronics 2x）图表，完全镜像 7709 结构与配色（区分色）=====
// 配色：AUM 青 #22d3ee / 累计涨跌幅 玫红 #fb7185 / 溢价率 靛 #818cf8 / 份额 青柠 #84cc16

// 7747 图表区块：第一行 合并图(AUM+累计) | 每日溢价率；第二行 份额(亿份) | 杠杆ETF累积净流入
function render7747Charts(grid, history, etfData) {
  if (!grid) return;
  const old = grid.querySelector(':scope > .korea-7747-charts');
  if (old) old.remove();
  if (!history || history.length === 0) {
    grid.appendChild(Object.assign(document.createElement('div'), {
      className: 'korea-7747-charts',
      innerHTML: '<div class="dim-note">暂无 7747 图表数据</div>'
    }));
    return;
  }
  const wrap = document.createElement('div');
  wrap.className = 'korea-7747-charts';
  wrap.innerHTML = `
    <div class="korea-7709-charts-section-title">7747 · CSOP Samsung Electronics 2x 杠杆 ETF · 跟踪曲线</div>
    <div class="korea-7709-charts-inner">
      <div class="korea-7709-chart-col">
        <div class="korea-7709-chart-title">AUM（亿韩元·约）与累计涨跌幅（%）</div>
        <div class="dim-chart" id="chart-combined-7747" style="height:300px;"></div>
      </div>
      <div class="korea-7709-chart-col">
        <div class="korea-7709-chart-title">每日溢价率（%）</div>
        <div class="dim-chart" id="chart-premium-7747" style="height:300px;"></div>
      </div>
      <div class="korea-7709-chart-col">
        <div class="korea-7709-chart-title">份额（亿份）</div>
        <div class="dim-chart" id="chart-units-7747" style="height:300px;"></div>
      </div>
    </div>
  `;
  grid.appendChild(wrap);
  setTimeout(() => {
    createCombined7747Chart(history);
    createPremium7747Chart(history);
    createUnits7747Chart(history);
  }, 90);
}

function createCombined7747Chart(history) {
  const dom = document.getElementById('chart-combined-7747');
  if (!dom || !window.echarts) return;
  const chart = echarts.init(dom);
  const dates = formatChartDates(history);
  const aumKRW = history.map(h => +(h.aum_usd * HKD_TO_KRW / 1e8).toFixed(2));
  const peakVal = Math.max(...aumKRW);
  const cum = history.map(h => (h.cum_change_pct != null ? +h.cum_change_pct.toFixed(2) : null));
  chart.setOption({
    legend: {
      data: [
        { name: 'AUM(亿韩元)', textStyle: { color: '#22d3ee' } },
        { name: '累计涨跌幅%', textStyle: { color: '#fb7185' } }
      ],
      top: 2, right: 8, itemWidth: 14, itemHeight: 8,
      textStyle: { fontSize: 11 }
    },
    grid: { left: 52, right: 46, top: 34, bottom: 30 },
    xAxis: {
      type: 'category', data: dates, boundaryGap: false,
      axisLabel: { fontSize: 10, color: '#9ca3af', interval: 'auto', hideOverlap: true, formatter: v => v.length > 5 ? v.slice(0, 5) : v },
      axisLine: { lineStyle: { color: '#374151' } }, axisTick: { show: false }
    },
    yAxis: [
      {
        type: 'value', name: '亿韩元', scale: true, position: 'left',
        nameTextStyle: { fontSize: 10, color: '#22d3ee' },
        axisLabel: { fontSize: 10, color: '#22d3ee' },
        axisLine: { show: false }, splitLine: { lineStyle: { color: '#374151', type: 'dashed' } }
      },
      {
        type: 'value', name: '%', scale: true, position: 'right', min: 0,
        nameTextStyle: { fontSize: 10, color: '#c084fc' },
        axisLabel: { fontSize: 10, color: '#c084fc' },
        axisLine: { show: false }, splitLine: { show: false }
      }
    ],
    series: [
      {
        name: 'AUM(亿韩元)', type: 'line', yAxisIndex: 0, data: aumKRW, smooth: true, symbol: 'none',
        lineStyle: { width: 2.2, color: '#22d3ee' },
        areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: 'rgba(34,211,238,0.28)' },
          { offset: 1, color: 'rgba(34,211,238,0.02)' }
        ]) },
        markLine: {
          silent: true, symbol: 'none',
          data: [{ yAxis: peakVal, lineStyle: { color: '#84cc16', type: 'dashed', width: 1.5 },
            label: { formatter: '峰值 ' + peakVal.toFixed(0) + '亿', color: '#84cc16', fontSize: 10, position: 'insideEndTop' } }],
          z: 2
        },
        z: 1
      },
      {
        name: '累计涨跌幅%', type: 'line', yAxisIndex: 1, data: cum, smooth: true, symbol: 'none',
        lineStyle: { width: 1.6, color: '#fb7185' },
        z: 3
      }
    ],
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'line', snap: true, lineStyle: { color: '#6b7280', type: 'dashed' } },
      formatter: params => {
        const i = params[0].dataIndex; const h = history[i];
        const aumV = aumKRW[i];
        const v = h.cum_change_pct; const dv = h.daily_change_pct;
        return `${h.date}<br/>`
          + `AUM: <b>${aumV != null ? aumV.toFixed(0) : '-'}</b> 亿韩元(约)<br/>`
          + `累计涨跌幅: <b style="color:#fb7185">${v != null ? (v >= 0 ? '+' : '') + v.toFixed(2) : '-'}%</b><br/>`
          + `当日涨跌: ${dv != null ? (dv >= 0 ? '+' : '') + dv.toFixed(2) + '%' : '-'}<br/>`
          + `收市价: ${h.close_price != null ? h.close_price.toFixed(2) : '-'} · 份额: ${(h.units / 1e8).toFixed(2)} 亿份`;
      },
      confine: true,
      backgroundColor: 'rgba(17,24,39,0.92)', borderColor: '#374151', borderWidth: 1,
      textStyle: { color: '#d1d5db', fontSize: 12 },
      extraCssText: 'border-radius:6px;padding:4px 10px;'
    },
    animationDuration: 600
  });
  dom._chartInstance = chart;
  charts.push(chart);
}

function createPremium7747Chart(history) {
  const dom = document.getElementById('chart-premium-7747');
  if (!dom || !window.echarts) return;
  const chart = echarts.init(dom);
  const dates = formatChartDates(history);
  const prem = history.map(h => (h.premium != null ? +h.premium.toFixed(2) : null));
  chart.setOption({
    grid: { left: 46, right: 16, top: 30, bottom: 30 },
    legend: {
      data: [{ name: '每日溢价率%', textStyle: { color: '#818cf8' } }],
      top: 2, right: 8, itemWidth: 14, itemHeight: 8,
      textStyle: { fontSize: 11 }
    },
    xAxis: {
      type: 'category', data: dates, boundaryGap: false,
      axisLabel: { fontSize: 10, color: '#9ca3af', interval: 'auto', hideOverlap: true, formatter: v => v.length > 5 ? v.slice(0, 5) : v },
      axisLine: { lineStyle: { color: '#374151' } }, axisTick: { show: false }
    },
    yAxis: {
      type: 'value', name: '%', scale: true,
      nameTextStyle: { fontSize: 10, color: '#818cf8' },
      axisLabel: { fontSize: 10, color: '#818cf8' },
      axisLine: { show: false }, splitLine: { lineStyle: { color: '#374151', type: 'dashed' } }
    },
    series: [{
      name: '每日溢价率%', type: 'line', data: prem, smooth: true, symbol: 'none',
      lineStyle: { width: 1.6, color: '#818cf8' },
      areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
        { offset: 0, color: 'rgba(129,140,248,0.18)' },
        { offset: 1, color: 'rgba(129,140,248,0.01)' }
      ]) },
      markLine: { silent: true, symbol: 'none',
        data: [{ yAxis: 0, lineStyle: { color: '#6b7280', type: 'solid', width: 1 } }], z: 2 },
      z: 1
    }],
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'line', snap: true, lineStyle: { color: '#6b7280', type: 'dashed' } },
      formatter: params => {
        const i = params[0].dataIndex; const h = history[i];
        const pv = h.premium;
        return `${h.date}<br/>每日溢价率: <b style="color:#818cf8">${pv != null ? pv.toFixed(2) : '-'}%</b>`;
      },
      confine: true, backgroundColor: 'rgba(17,24,39,0.92)', borderColor: '#374151', borderWidth: 1,
      textStyle: { color: '#d1d5db', fontSize: 12 }, extraCssText: 'border-radius:6px;padding:4px 10px;'
    },
    animationDuration: 600
  });
  dom._chartInstance = chart;
  charts.push(chart);
}

function createUnits7747Chart(history) {
  const dom = document.getElementById('chart-units-7747');
  if (!dom || !window.echarts) return;
  const chart = echarts.init(dom);
  const dates = formatChartDates(history);
  const unitsYi = history.map(h => +(h.units / 1e8).toFixed(2));
  const peakVal = Math.max(...unitsYi);
  chart.setOption({
    grid: { left: 46, right: 16, top: 30, bottom: 30 },
    legend: {
      data: [{ name: '份额(亿份)', textStyle: { color: '#84cc16' } }],
      top: 2, right: 8, itemWidth: 14, itemHeight: 8,
      textStyle: { fontSize: 11 }
    },
    xAxis: {
      type: 'category', data: dates, boundaryGap: false,
      axisLabel: { fontSize: 10, color: '#9ca3af', interval: 'auto', hideOverlap: true, formatter: v => v.length > 5 ? v.slice(0, 5) : v },
      axisLine: { lineStyle: { color: '#374151' } }, axisTick: { show: false }
    },
    yAxis: {
      type: 'value', name: '亿份', scale: true,
      nameTextStyle: { fontSize: 10, color: '#84cc16' },
      axisLabel: { fontSize: 10, color: '#84cc16' },
      axisLine: { show: false }, splitLine: { lineStyle: { color: '#374151', type: 'dashed' } }
    },
    series: [{
      name: '份额(亿份)', type: 'line', data: unitsYi, smooth: true, symbol: 'none',
      lineStyle: { width: 1.8, color: '#84cc16' },
      areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
        { offset: 0, color: 'rgba(132,204,22,0.20)' },
        { offset: 1, color: 'rgba(132,204,22,0.01)' }
      ]) },
      markLine: { silent: true, symbol: 'none',
        data: [{ yAxis: peakVal, lineStyle: { color: '#84cc16', type: 'dashed', width: 1.2 },
          label: { formatter: '峰值 ' + peakVal.toFixed(2) + '亿份', color: '#84cc16', fontSize: 10, position: 'insideEndTop' } }],
        z: 2 },
      z: 1
    }],
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'line', snap: true, lineStyle: { color: '#6b7280', type: 'dashed' } },
      formatter: params => {
        const i = params[0].dataIndex; const h = history[i];
        const u = h.units;
        return `${h.date}<br/>份额: <b style="color:#84cc16">${u != null ? (u / 1e8).toFixed(2) : '-'}</b> 亿份`;
      },
      confine: true, backgroundColor: 'rgba(17,24,39,0.92)', borderColor: '#374151', borderWidth: 1,
      textStyle: { color: '#d1d5db', fontSize: 12 }, extraCssText: 'border-radius:6px;padding:4px 10px;'
    },
    animationDuration: 600
  });
  dom._chartInstance = chart;
  charts.push(chart);
}

// 7747 区复用杠杆ETF累积净流入图（与 leveraged_etf 卡片同一份数据，仅展示位置不同）
function createCumFlow7747Chart(etfData) {
  const dom = document.getElementById('chart-cumflow-7747');
  if (!dom || !window.echarts || !etfData) return;
  if (!etfData.history || etfData.history.length === 0) {
    dom.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-tertiary);font-size:12px;">暂无历史数据</div>';
    return;
  }
  const chart = echarts.init(dom);
  const peak = etfData.peak_value || 68;
  const fair = etfData.fair_value || 24.5;
  const defaultHistory = etfData.history.filter(h => h.date >= '2026-01-01');
  chart.setOption(buildLeveragedEtfOption(defaultHistory, peak, fair, etfData.unit));
  dom._chartInstance = chart;
  charts.push(chart);
}

// 7709 区复用杠杆ETF累积净流入图（与 leveraged_etf 卡片同一份数据，仅展示位置不同）
function createCumFlow7709Chart(etfData) {
  const dom = document.getElementById('chart-cumflow-7709');
  if (!dom || !window.echarts || !etfData) return;
  if (!etfData.history || etfData.history.length === 0) {
    dom.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-tertiary);font-size:12px;">暂无历史数据</div>';
    return;
  }
  const chart = echarts.init(dom);
  const peak = etfData.peak_value || 68;
  const fair = etfData.fair_value || 24.5;
  const defaultHistory = etfData.history.filter(h => h.date >= '2026-01-01');
  chart.setOption(buildLeveragedEtfOption(defaultHistory, peak, fair, etfData.unit));
  dom._chartInstance = chart;
  charts.push(chart);
}
