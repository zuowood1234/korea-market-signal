"""
A股拐点信号追踪 - 信号计算脚本
读取 latest.json，根据阈值表计算7个维度的红黄绿状态，输出 signals.json
"""
import json
from pathlib import Path
import datetime as dt

DATA_DIR = Path(__file__).parent.parent / "data"


def load_latest():
    with open(DATA_DIR / "latest.json", "r", encoding="utf-8") as f:
        return json.load(f)


def calc_erp_signal(data):
    if data.get("current_value") is None or not data.get("stats"):
        return {"status": "gray", "label": "数据缺失", "note": ""}
    val = data["current_value"]
    stats = data["stats"]
    mean, std = stats["mean"], stats["std"]
    minus_1x, plus_1x = stats["minus_1x"], stats["plus_1x"]

    if val < minus_1x:
        if val < stats.get("minus_2x", minus_1x - std) + std * 0.2:
            return {"status": "red", "label": "顶部预警", "note": f"低于均值-1X（{minus_1x}%），逼近-2X极值"}
        return {"status": "red", "label": "顶部预警", "note": f"低于均值-1X（{minus_1x}%）"}
    elif val > plus_1x:
        if val > stats.get("plus_2x", plus_1x + std) - std * 0.2:
            return {"status": "green", "label": "底部信号", "note": f"高于均值+1X（{plus_1x}%），逼近+2X极值"}
        return {"status": "green", "label": "底部信号", "note": f"高于均值+1X（{plus_1x}%）"}
    else:
        return {"status": "yellow", "label": "中性", "note": f"位于均值±1X区间（{minus_1x}%-{plus_1x}%）"}


def calc_turnover_signal(data):
    val = data.get("current_value")
    if val is None:
        return {"status": "gray", "label": "数据缺失", "note": ""}
    if val > 2.4:
        return {"status": "red", "label": "顶部预警", "note": f"单日换手率{val}%，市场沸腾"}
    elif val >= 1.5:
        return {"status": "yellow", "label": "中性", "note": f"单日换手率{val}%，正常活跃"}
    elif val >= 1.0:
        return {"status": "green", "label": "底部信号", "note": f"单日换手率{val}%，缩量筑底"}
    else:
        return {"status": "green", "label": "底部信号", "note": f"单日换手率{val}%，极端缩量"}


def calc_margin_signal(data):
    val = data.get("current_value")
    if val is None:
        return {"status": "gray", "label": "数据缺失", "note": ""}
    if val > 12.5:
        return {"status": "red", "label": "顶部预警", "note": f"两融交易占比{val}%，杠杆过热"}
    elif val >= 9:
        return {"status": "yellow", "label": "中性", "note": f"两融交易占比{val}%，正常杠杆"}
    else:
        return {"status": "green", "label": "底部信号", "note": f"两融交易占比{val}%，杠杆出清"}


def calc_etf_signal(data):
    val = data.get("current_value")
    if val is None:
        return {"status": "gray", "label": "数据缺失", "note": ""}
    if val > 100:
        return {"status": "green", "label": "底部信号", "note": f"单日净流入{val}亿，聪明钱托底"}
    elif val < -100:
        return {"status": "red", "label": "顶部预警", "note": f"单日净赎回{abs(val)}亿，机构撤退"}
    else:
        return {"status": "yellow", "label": "中性", "note": f"单日净流向{val}亿，正常波动"}


def calc_ma_signal(data):
    extra = data.get("extra", {})
    if not extra or data.get("current_value") is None:
        return {"status": "gray", "label": "数据缺失", "note": ""}

    below_ma20_days = extra.get("below_ma20_days", 0)
    broke_ma250_recent = extra.get("broke_ma250_recent", False)
    pos_ma20 = extra.get("position_vs_ma20", "")
    pos_ma250 = extra.get("position_vs_ma250", "")

    if below_ma20_days >= 3:
        return {"status": "red", "label": "顶部预警", "note": f"连续{below_ma20_days}日跌破20日线"}
    elif broke_ma250_recent:
        return {"status": "green", "label": "底部信号", "note": "跌破年线后快速收复"}
    elif pos_ma20 == "below":
        return {"status": "yellow", "label": "中性", "note": "20日线下方，关注是否连续跌破"}
    else:
        return {"status": "yellow", "label": "中性", "note": "20日线上方，短期趋势正常"}


def calc_vix_signal(data):
    val = data.get("current_value")
    if val is None:
        return {"status": "gray", "label": "数据缺失", "note": ""}
    if val < 15:
        return {"status": "red", "label": "顶部预警", "note": f"VIX={val}，过度乐观"}
    elif val <= 30:
        return {"status": "yellow", "label": "中性", "note": f"VIX={val}，正常情绪"}
    else:
        return {"status": "green", "label": "底部信号", "note": f"VIX={val}，恐慌见底"}


def calc_north_signal(data):
    val = data.get("current_value")
    if val is None:
        return {"status": "gray", "label": "数据缺失", "note": ""}
    if val < -300:
        return {"status": "red", "label": "顶部预警", "note": f"3日累计净流出{abs(val)}亿"}
    elif val > 200:
        return {"status": "green", "label": "底部信号", "note": f"3日累计净流入{val}亿"}
    else:
        return {"status": "yellow", "label": "中性", "note": f"3日累计净流向{val}亿"}


CALCULATORS = {
    "erp": calc_erp_signal,
    "turnover": calc_turnover_signal,
    "margin": calc_margin_signal,
    "etf_flow": calc_etf_signal,
    "ma": calc_ma_signal,
    "vix": calc_vix_signal,
    "north": calc_north_signal,
}


def main():
    latest = load_latest()
    signals = {
        "date": latest["date"],
        "update_time": latest["update_time"],
        "signals": {},
        "red_count": 0,
        "green_count": 0,
        "yellow_count": 0,
        "gray_count": 0,
    }

    dims = latest.get("dimensions", {})
    for key, calc in CALCULATORS.items():
        data = dims.get(key, {})
        result = calc(data)
        result["current_value"] = data.get("current_value")
        result["unit"] = data.get("unit", "")
        result["name"] = data.get("name", key)
        result["subtitle"] = data.get("subtitle", "")
        signals["signals"][key] = result
        status = result["status"]
        if status == "red":
            signals["red_count"] += 1
        elif status == "green":
            signals["green_count"] += 1
        elif status == "yellow":
            signals["yellow_count"] += 1
        else:
            signals["gray_count"] += 1

    out_path = DATA_DIR / "signals.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(signals, f, ensure_ascii=False, indent=2, allow_nan=False)
    print(f"信号已保存到 {out_path}")
    print(f"红:{signals['red_count']} 黄:{signals['yellow_count']} 绿:{signals['green_count']} 灰:{signals['gray_count']}")
    return signals


if __name__ == "__main__":
    main()
