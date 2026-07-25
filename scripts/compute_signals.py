"""
韩国市场信号 - 信号计算脚本
读取 latest.json，根据阈值计算韩国市场指标的红黄绿状态，输出 signals.json
"""
import json
from pathlib import Path
import datetime as dt

DATA_DIR = Path(__file__).parent.parent / "data"


def load_latest():
    with open(DATA_DIR / "latest.json", "r", encoding="utf-8") as f:
        return json.load(f)


def calc_korea_vkospi_signal(data):
    """韩国 VKOSPI 信号：高波动为顶部预警，低波动为底部信号"""
    val = data.get("current_value")
    if val is None:
        return {"status": "gray", "label": "数据缺失", "note": ""}
    if val > 40:
        return {"status": "red", "label": "顶部预警", "note": f"VKOSPI={val}，过度恐慌"}
    elif val >= 20:
        return {"status": "yellow", "label": "中性", "note": f"VKOSPI={val}，正常波动"}
    else:
        return {"status": "green", "label": "底部信号", "note": f"VKOSPI={val}，波动平静"}


def calc_korea_margin_signal(data):
    """韩国融资余额信号：高杠杆为顶部预警"""
    val = data.get("current_value")
    if val is None:
        return {"status": "gray", "label": "数据缺失", "note": ""}
    if val > 35:
        return {"status": "red", "label": "顶部预警", "note": f"融资余额{val}万亿韩元，杠杆过热"}
    elif val >= 25:
        return {"status": "yellow", "label": "中性", "note": f"融资余额{val}万亿韩元，正常水平"}
    else:
        return {"status": "green", "label": "底部信号", "note": f"融资余额{val}万亿韩元，杠杆出清"}


def calc_korea_liquidation_signal(data):
    """韩国强平金额信号：高强平为顶部预警，低强平为底部信号"""
    val = data.get("current_value")
    if val is None:
        return {"status": "gray", "label": "数据缺失", "note": ""}
    if val > 500:
        return {"status": "red", "label": "顶部预警", "note": f"强平{val}亿韩元，强平加剧"}
    elif val >= 200:
        return {"status": "yellow", "label": "中性", "note": f"强平{val}亿韩元，正常出清"}
    else:
        return {"status": "green", "label": "底部信号", "note": f"强平{val}亿韩元，市场稳定"}


def calc_korea_liquidation_ratio_signal(data):
    """韩国强平比例信号：高比例为顶部预警，低比例为底部信号"""
    val = data.get("current_value")
    if val is None:
        return {"status": "gray", "label": "数据缺失", "note": ""}
    if val > 3:
        return {"status": "red", "label": "顶部预警", "note": f"强平比例{val}%，强平比例过高"}
    elif val >= 1:
        return {"status": "yellow", "label": "中性", "note": f"强平比例{val}%，正常水平"}
    else:
        return {"status": "green", "label": "底部信号", "note": f"强平比例{val}%，杠杆风险低"}


KOREA_CALCULATORS = {
    "vkospi": calc_korea_vkospi_signal,
    "margin": calc_korea_margin_signal,
    "liquidation": calc_korea_liquidation_signal,
    "liquidation_ratio": calc_korea_liquidation_ratio_signal,
}


def main():
    latest = load_latest()
    signals = {
        "date": latest["date"],
        "update_time": latest["update_time"],
        "korea": {
            "signals": {},
            "red_count": 0,
            "green_count": 0,
            "yellow_count": 0,
            "gray_count": 0,
        },
    }

    korea_dims = latest.get("korea", {})
    for key, calc in KOREA_CALCULATORS.items():
        data = korea_dims.get(key, {})
        result = calc(data)
        result["current_value"] = data.get("current_value")
        result["unit"] = data.get("unit", "")
        result["name"] = data.get("name", key)
        result["subtitle"] = data.get("subtitle", "")
        signals["korea"]["signals"][key] = result
        status = result["status"]
        if status == "red":
            signals["korea"]["red_count"] += 1
        elif status == "green":
            signals["korea"]["green_count"] += 1
        elif status == "yellow":
            signals["korea"]["yellow_count"] += 1
        else:
            signals["korea"]["gray_count"] += 1

    out_path = DATA_DIR / "signals.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(signals, f, ensure_ascii=False, indent=2, allow_nan=False)
    print(f"信号已保存到 {out_path}")
    print(f"[韩国] 红:{signals['korea']['red_count']} 黄:{signals['korea']['yellow_count']} 绿:{signals['korea']['green_count']} 灰:{signals['korea']['gray_count']}")
    return signals


if __name__ == "__main__":
    main()
