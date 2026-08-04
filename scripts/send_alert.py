"""
韩国市场信号 - Server酱微信告警
每日汇总日报，包含所有信号灯卡片内容，推送到微信
需要环境变量 SERVERCHAN_SENDKEY
"""
import json
import os
import urllib.parse
import urllib.request
from pathlib import Path

DATA_DIR = Path(__file__).parent.parent / "data"

STATUS_ICONS = {
    "red": "🔴",
    "yellow": "🟡",
    "green": "🟢",
    "gray": "⚪",
    "orange": "🟠",
    "darkred": "🟤",
}

STATUS_LABELS = {
    "red": "危险",
    "yellow": "警戒",
    "green": "安全",
    "gray": "数据缺失",
    "orange": "异常警戒",
    "darkred": "危险·强化",
}


def load_json(filename):
    with open(DATA_DIR / filename, "r", encoding="utf-8") as f:
        return json.load(f)


def compute_stability_score(history):
    """复刻 app.js 的 computeStabilityScore 逻辑"""
    if not history or len(history) < 22:
        return []

    results = []
    for i in range(21, len(history)):
        window = history[max(0, i - 19):i + 1]
        levels = [h["value"] for h in window]
        mean_level = sum(levels) / len(levels)
        if mean_level == 0:
            continue

        cv = (sum((v - mean_level) ** 2 for v in levels) / len(levels)) ** 0.5 / mean_level

        returns = []
        for j in range(1, len(window)):
            if window[j - 1]["value"] != 0:
                returns.append((window[j]["value"] - window[j - 1]["value"]) / window[j - 1]["value"])

        if len(returns) < 5:
            continue
        mean_ret = sum(returns) / len(returns)
        vol = (sum((r - mean_ret) ** 2 for r in returns) / len(returns)) ** 0.5
        ann_vol = vol * (252 ** 0.5)

        cv_score = max(0, min(100, 100 - (cv / 0.12) * 100))
        vol_score = max(0, min(100, 100 - (ann_vol / 0.80) * 100))
        score = (cv_score + vol_score) / 2

        results.append({"date": history[i]["date"], "score": score})

    return results


def classify_leverage_scenario(mar_chg, dep_chg, r2_chg, window):
    """复刻 app.js 的 classifyLeverageScenario 逻辑"""
    abn_mar = 7 if window == "14d" else 2
    abn_dep = 10 if window == "14d" else 4

    m_dir = "↑" if mar_chg > 0 else "↓"
    d_dir = "↑" if dep_chg > 0 else "↓"
    r_dir = "↑" if r2_chg > 0 else "↓"

    m_abn = abs(mar_chg) > abn_mar
    d_abn = abs(dep_chg) > abn_dep

    scenario = ""
    color = ""
    label = ""
    base_scenario = ""

    if m_dir == "↓" and d_dir == "↑" and r_dir == "↓":
        scenario, color, label, base_scenario = "A", "green", "健康", "A"
    elif m_dir == "↑" and d_dir == "↑" and r_dir == "↓":
        scenario, color, label, base_scenario = "A", "green", "健康", "A"
    elif m_dir == "↓" and d_dir == "↓" and r_dir == "↓":
        scenario, color, label, base_scenario = "B", "yellow", "中性", "B"
    elif m_dir == "↑" and d_dir == "↑" and r_dir == "↑":
        scenario, color, label, base_scenario = "B", "yellow", "中性", "B"
    elif m_dir == "↓" and d_dir == "↓" and r_dir == "↑":
        scenario, color, label, base_scenario = "C", "red", "危险", "C"
    elif m_dir == "↑" and d_dir == "↓" and r_dir == "↑":
        scenario, color, label, base_scenario = "C", "red", "危险", "C"
    else:
        scenario, color, label, base_scenario = "B", "yellow", "中性", "B"

    enhanced = False
    if color == "yellow" and (m_abn or d_abn):
        color = "red"
        enhanced = True
        label = "异常警戒"
    elif color == "red" and (m_abn or d_abn):
        enhanced = True

    return {
        "scenario": scenario, "color": color, "label": label,
        "baseScenario": base_scenario, "mDir": m_dir, "dDir": d_dir,
        "rDir": r_dir, "mAbn": m_abn, "dAbn": d_abn, "enhanced": enhanced,
    }


def compute_leverage_signals(margin_data, deposits_data):
    """计算单日和14日杠杆情景信号"""
    result = {"daily": None, "fourteen": None}
    if not margin_data or not deposits_data:
        return result
    if not margin_data.get("history") or not deposits_data.get("history"):
        return result

    mar_d = {h["date"]: h["value"] for h in margin_data["history"]}
    dep_d = {h["date"]: h["value"] for h in deposits_data["history"]}
    common = sorted([d for d in mar_d if d in dep_d])
    if len(common) < 15:
        return result

    latest = common[-1]
    prev = common[-2]
    prev14 = common[-15]

    # 单日
    m1 = (mar_d[latest] - mar_d[prev]) / mar_d[prev] * 100
    d1 = (dep_d[latest] - dep_d[prev]) / dep_d[prev] * 100
    r2_1 = mar_d[latest] / dep_d[latest] * 100 - mar_d[prev] / dep_d[prev] * 100
    daily = classify_leverage_scenario(m1, d1, r2_1, "1d")
    daily_abn = ("融" if daily["mAbn"] else "") + ("存" if daily["dAbn"] else "")
    result["daily"] = {
        "status": daily["color"],
        "label": daily["label"],
        "abn": daily_abn,
        "note": f"融资{m1:+.2f}% 存管金{d1:+.2f}% R2{r2_1:+.2f}pp",
    }

    # 14日
    m14 = (mar_d[latest] - mar_d[prev14]) / mar_d[prev14] * 100
    d14 = (dep_d[latest] - dep_d[prev14]) / dep_d[prev14] * 100
    r2_14 = mar_d[latest] / dep_d[latest] * 100 - mar_d[prev14] / dep_d[prev14] * 100
    fourteen = classify_leverage_scenario(m14, d14, r2_14, "14d")
    fourteen_abn = ("融" if fourteen["mAbn"] else "") + ("存" if fourteen["dAbn"] else "")
    result["fourteen"] = {
        "status": fourteen["color"],
        "label": fourteen["label"],
        "abn": fourteen_abn,
        "note": f"融资{m14:+.2f}% 存管金{d14:+.2f}% R2{r2_14:+.2f}pp",
    }

    return result


def get_threshold_tag(current_value, thresholds, direction, unit):
    """根据阈值生成判断标签"""
    if current_value is None or not thresholds:
        return ""
    unit_str = unit or ""

    if direction == "low_red":
        red = thresholds.get("red", "")
        try:
            red_num = float("".join(c for c in str(red) if c.isdigit() or c in ".-"))
            if current_value > red_num:
                return f">{red_num:g}{unit_str}"
        except (ValueError, AttributeError):
            pass
        green = thresholds.get("green", "")
        if "<" in str(green):
            try:
                g_num = float("".join(c for c in str(green) if c.isdigit() or c in ".-"))
                if current_value < g_num:
                    return f"<{g_num:g}{unit_str}"
            except (ValueError, AttributeError):
                pass
    elif direction == "high_red":
        red = thresholds.get("red", "")
        if ">" in str(red):
            try:
                r_num = float("".join(c for c in str(red) if c.isdigit() or c in ".-"))
                if current_value > r_num:
                    return f">{r_num:g}{unit_str}"
            except (ValueError, AttributeError):
                pass
        if "<" in str(red):
            try:
                r_num = float("".join(c for c in str(red) if c.isdigit() or c in ".-"))
                if current_value < r_num:
                    return f"<{r_num:g}{unit_str}"
            except (ValueError, AttributeError):
                pass
    return ""


def dod_pct(history):
    """计算日环比变化百分比，返回带符号的字符串，如 '+1.2%'/'−0.5%'，无法计算返回''"""
    if not history or len(history) < 2:
        return ""
    curr = history[-1].get("value")
    prev = history[-2].get("value")
    if curr is None or prev is None or prev == 0:
        return ""
    pct = (curr - prev) / prev * 100
    sign = "+" if pct >= 0 else ""
    return f" {sign}{pct:.1f}%"


def drop_dod(margin_history):
    """融资最高点回落的日环比变化（回落幅度的变化百分点），返回如 '+0.2%'/'−0.1%'，无法计算返回''"""
    if not margin_history or len(margin_history) < 2:
        return ""
    peak = max(h["value"] for h in margin_history)
    if peak == 0:
        return ""
    curr = margin_history[-1]["value"]
    prev = margin_history[-2]["value"]
    curr_drop = (peak - curr) / peak * 100
    prev_drop = (peak - prev) / peak * 100
    delta = curr_drop - prev_drop
    sign = "+" if delta >= 0 else ""
    return f" {sign}{delta:.1f}%"


def build_report(latest, signals):
    """构建包含所有卡片内容的报告（顺序与前端一致：两周杠杆→单日杠杆→存管金稳定性→…）"""
    date = signals["date"]
    korea_signals = signals.get("korea", {})
    korea_latest = latest.get("korea", {})

    # 统计
    korea_red = korea_signals.get("red_count", 0)
    korea_green = korea_signals.get("green_count", 0)
    korea_yellow = korea_signals.get("yellow_count", 0)
    korea_gray = korea_signals.get("gray_count", 0)

    title = f"韩国市场信号日报 {date}"
    if korea_red > 0 and korea_green == 0:
        title += f" | {korea_red}项顶部预警"
    elif korea_green > 0 and korea_red == 0:
        title += f" | {korea_green}项稳定信号"
    elif korea_red > 0 and korea_green > 0:
        title += f" | {korea_red}红{korea_green}绿"

    lines = [f"# 韩国市场信号日报\n\n**{date}** 收盘更新\n"]
    lines.append(f"## 总览\n\n🔴 危险 **{korea_red}** ｜ 🟡 警戒 **{korea_yellow}** ｜ 🟢 安全 **{korea_green}** ｜ ⚪ 缺失 **{korea_gray}**\n")

    # === 信号灯卡片区域 ===
    lines.append("\n## 📊 韩国市场信号\n")

    deposits = korea_latest.get("investor_deposits", {})
    margin = korea_latest.get("margin", {})
    margin_hist = margin.get("history", [])

    # 1. 两周杠杆比率趋势
    lev_sigs = compute_leverage_signals(margin, deposits)
    if lev_sigs["fourteen"]:
        s = lev_sigs["fourteen"]
        icon = STATUS_ICONS.get(s["status"], "⚪")
        abn_str = f" 异常:{s['abn']}" if s["abn"] else ""
        lines.append(f"- {icon} **两周杠杆比率趋势**：{s['label']}{abn_str}（{s['note']}）\n")

    # 2. 单日杠杆比率状态
    if lev_sigs["daily"]:
        s = lev_sigs["daily"]
        icon = STATUS_ICONS.get(s["status"], "⚪")
        abn_str = f" 异常:{s['abn']}" if s["abn"] else ""
        lines.append(f"- {icon} **单日杠杆比率状态**：{s['label']}{abn_str}（{s['note']}）\n")

    # 3. 存管金稳定性
    if deposits.get("history") and len(deposits["history"]) > 22:
        scores = compute_stability_score(deposits["history"])
        if scores:
            score = scores[-1]["score"]
            if score >= 60:
                st_label, st_icon = "平稳", "🟢"
            elif score >= 40:
                st_label, st_icon = "中性", "🟡"
            else:
                st_label, st_icon = "不稳定", "🔴"
            tag = "<60" if score < 60 else "≥60"
            lines.append(f"- {st_icon} **存管金稳定性**：{score:.1f} {tag}（{st_label}）\n")

    # 4. 融资余额 + 最高点回落（含日环比）
    if margin.get("current_value") is not None:
        mar_val = margin["current_value"]
        mar_sig = korea_signals.get("signals", {}).get("margin", {})
        mar_icon = STATUS_ICONS.get(mar_sig.get("status", "gray"), "⚪")
        lines.append(f"- {mar_icon} **融资余额**：{mar_val}万亿韩元{dod_pct(margin_hist)}")

        if margin_hist:
            peak = max(h["value"] for h in margin_hist)
            curr = margin_hist[-1]["value"]
            if peak > 0:
                drop_pct = (peak - curr) / peak * 100
                dod_s = drop_dod(margin_hist)
                lines.append(f"｜融资最高点回落 -{drop_pct:.1f}%{dod_s}")
        lines.append("\n")

    # 4.5 KOSPI + KOSDAQ（从高点回落% + 日环比）
    for idx_key, idx_name in [("kospi", "KOSPI"), ("kosdaq", "KOSDAQ")]:
        idx = korea_latest.get(idx_key, {})
        if idx.get("current_value") is not None and idx.get("history"):
            hist = idx["history"]
            val = idx["current_value"]
            peak = max(h["value"] for h in hist)
            drop_pct = (peak - val) / peak * 100 if peak > 0 else 0
            # 颜色判定
            if drop_pct > 10:
                icon = "🔴"
            elif drop_pct > 5:
                icon = "🟡"
            else:
                icon = "🟢"
            dod_s = dod_pct(hist)
            lines.append(f"- {icon} **{idx_name}**：{val}｜高点回落 -{drop_pct:.1f}%{dod_s}\n")

    # 5. VKOSPI（含日环比）
    vkospi = korea_latest.get("vkospi", {})
    vkospi_sig = korea_signals.get("signals", {}).get("vkospi", {})
    if vkospi.get("current_value") is not None:
        val = vkospi["current_value"]
        icon = STATUS_ICONS.get(vkospi_sig.get("status", "gray"), "⚪")
        tag = get_threshold_tag(val, vkospi.get("thresholds", {}), "low_red", "")
        dod_s = dod_pct(vkospi.get("history", []))
        lines.append(f"- {icon} **VKOSPI**：{val} {tag}{dod_s}\n")

    # 6. 强平金额（含日环比）
    liq = korea_latest.get("liquidation", {})
    liq_sig = korea_signals.get("signals", {}).get("liquidation", {})
    if liq.get("current_value") is not None:
        val = liq["current_value"]
        icon = STATUS_ICONS.get(liq_sig.get("status", "gray"), "⚪")
        tag = get_threshold_tag(val, liq.get("thresholds", {}), "low_red", "亿")
        dod_s = dod_pct(liq.get("history", []))
        lines.append(f"- {icon} **强平金额**：{val}亿 {tag}{dod_s}\n")

    # 7. 强平比例（含日环比）
    liq_ratio = korea_latest.get("liquidation_ratio", {})
    liq_ratio_sig = korea_signals.get("signals", {}).get("liquidation_ratio", {})
    if liq_ratio.get("current_value") is not None:
        val = liq_ratio["current_value"]
        icon = STATUS_ICONS.get(liq_ratio_sig.get("status", "gray"), "⚪")
        tag = get_threshold_tag(val, liq_ratio.get("thresholds", {}), "low_red", "%")
        dod_s = dod_pct(liq_ratio.get("history", []))
        lines.append(f"- {icon} **强平比例**：{val}% {tag}{dod_s}\n")

    # 数据来源
    lines.append(f"\n---\n\n*更新时间: {signals['update_time']}*")
    lines.append("\n*数据来源: KOFIA（kimpremium.com）+ Investing.com（VKOSPI）*")
    lines.append("\n*每日08:30自动推送*")

    return title, "".join(lines)


def send_serverchan(title, content, sendkey):
    if not sendkey:
        print("[告警] SERVERCHAN_SENDKEY 未设置，跳过推送（仅打印报告）")
        return False

    url = f"https://sctapi.ftqq.com/{sendkey}.send"
    data = urllib.parse.urlencode({"title": title, "desp": content}).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            if result.get("code") == 0:
                print("[告警] Server酱推送成功")
                return True
            else:
                print(f"[告警] Server酱推送失败: {result}")
                return False
    except Exception as e:
        print(f"[告警] 推送异常: {e}")
        return False


def main():
    signals = load_json("signals.json")
    latest = load_json("latest.json")
    title, content = build_report(latest, signals)
    print(f"[告警] 标题: {title}")
    print(f"[告警] 内容预览:\n{content[:800]}...")

    sendkey = os.environ.get("SERVERCHAN_SENDKEY", "")
    send_serverchan(title, content, sendkey)


if __name__ == "__main__":
    main()
