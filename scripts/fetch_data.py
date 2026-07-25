"""
韩国市场信号 - 数据获取脚本
拉取韩国市场指标数据，生成 latest.json
"""
import json
import math
import os
import datetime as dt
from pathlib import Path
import traceback

import pandas as pd
import yfinance as yf


def clean_nan(obj):
    """递归把NaN/Infinity替换成None，避免浏览器JSON.parse失败"""
    if isinstance(obj, float) and (math.isnan(obj) or math.isinf(obj)):
        return None
    if isinstance(obj, dict):
        return {k: clean_nan(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [clean_nan(v) for v in obj]
    return obj


DATA_DIR = Path(__file__).parent.parent / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

TODAY = dt.date.today().strftime("%Y-%m-%d")
UPDATE_TIME = dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

HISTORY_DAYS = 3 * 252

MANUAL_DATA_PATH = DATA_DIR / "korea_manual.json"


def load_manual_korea_data():
    if MANUAL_DATA_PATH.exists():
        try:
            with open(MANUAL_DATA_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def fetch_korea_vkospi():
    """韩国波动率指数 VKOSPI。优先读取手动更新文件，否则从 yfinance 获取。"""
    manual = load_manual_korea_data()
    result = {"name": "VKOSPI", "subtitle": "韩国波动率指数", "unit": "", "data_source": "yfinance", "current_value": None, "history": []}
    result["thresholds"] = {"red": ">40", "yellow": "20-40", "green": "<20"}

    if manual.get("vkospi") and manual["vkospi"].get("current_value") is not None:
        m = manual["vkospi"]
        result["current_value"] = m["current_value"]
        result["history"] = m.get("history", [])
        result["data_source"] = "KRX (手动更新)"
        result["note"] = m.get("note", "数据来自手动更新文件")
        return result

    try:
        ticker = yf.Ticker("^VKOSPI")
        hist = ticker.history(period="3y")
        if hist is not None and len(hist) > 0:
            latest = hist.iloc[-1]
            result["current_value"] = round(float(latest["Close"]), 2)
            result["history"] = [{"date": d.strftime("%Y-%m-%d"), "value": round(v, 2)} for d, v in zip(hist.index, hist["Close"]) if pd.notna(v)]
        else:
            result["error"] = "yfinance VKOSPI empty"
    except Exception as e:
        result["error"] = str(e)
    return result


def fetch_korea_margin():
    """韩国融资余额数据。优先读取手动更新文件。"""
    manual = load_manual_korea_data()
    result = {
        "name": "融资余额",
        "subtitle": "韩国信用融资",
        "unit": "万亿韩元",
        "data_source": "KOFIA",
        "current_value": None,
        "history": [],
        "thresholds": {"red": ">35", "yellow": "25-35", "green": "<25"},
        "extra": {
            "liquidation": None,
            "liquidation_unit": "亿韩元",
            "liquidation_ratio": None,
            "liquidation_ratio_unit": "%"
        }
    }

    if manual.get("margin") and manual["margin"].get("current_value") is not None:
        m = manual["margin"]
        result["current_value"] = m["current_value"]
        result["history"] = m.get("history", [])
        result["extra"]["liquidation"] = m.get("liquidation")
        result["extra"]["liquidation_ratio"] = m.get("liquidation_ratio")
        result["data_source"] = "KOFIA (手动更新)"
        result["note"] = m.get("note", "数据来自手动更新文件")
    else:
        result["note"] = "韩国融资数据需从 KOFIA 手动更新 (korea_manual.json)"
        result["error"] = "数据源待接入（KOFIA）"

    return result


def fetch_korea_liquidation():
    """韩国每日强平金额数据。优先读取手动更新文件。"""
    manual = load_manual_korea_data()
    result = {
        "name": "强平金额",
        "subtitle": "韩国信用强平",
        "unit": "亿韩元",
        "data_source": "KOFIA",
        "current_value": None,
        "history": [],
        "thresholds": {"red": ">500", "yellow": "200-500", "green": "<200"},
        "extra": {
            "liquidation_ratio": None,
            "liquidation_ratio_unit": "%"
        }
    }

    if manual.get("liquidation") and manual["liquidation"].get("current_value") is not None:
        m = manual["liquidation"]
        result["current_value"] = m["current_value"]
        result["history"] = m.get("history", [])
        result["extra"]["liquidation_ratio"] = m.get("liquidation_ratio")
        result["data_source"] = "KOFIA (手动更新)"
        result["note"] = m.get("note", "数据来自手动更新文件")
    else:
        result["note"] = "韩国强平数据需从 KOFIA 手动更新 (korea_manual.json)"
        result["error"] = "数据源待接入（KOFIA）"

    return result


def fetch_korea_liquidation_ratio():
    """韩国强平比例（强平÷未收）。优先读取手动更新文件。"""
    manual = load_manual_korea_data()
    result = {
        "name": "强平比例",
        "subtitle": "强平÷未收",
        "unit": "%",
        "data_source": "KOFIA",
        "current_value": None,
        "history": [],
        "thresholds": {"red": ">3%", "yellow": "1-3%", "green": "<1%"}
    }

    if manual.get("liquidation_ratio") and manual["liquidation_ratio"].get("current_value") is not None:
        m = manual["liquidation_ratio"]
        result["current_value"] = m["current_value"]
        result["history"] = m.get("history", [])
        result["data_source"] = "KOFIA (手动更新)"
        result["note"] = m.get("note", "数据来自手动更新文件")
    else:
        result["note"] = "韩国强平比例需从 KOFIA 手动更新 (korea_manual.json)"
        result["error"] = "数据源待接入（KOFIA）"

    return result


def main():
    print(f"[{UPDATE_TIME}] 开始拉取韩国市场数据...")
    output = {
        "date": TODAY,
        "update_time": UPDATE_TIME,
        "korea": {},
    }

    korea_fetchers = {
        "vkospi": fetch_korea_vkospi,
        "margin": fetch_korea_margin,
        "liquidation": fetch_korea_liquidation,
        "liquidation_ratio": fetch_korea_liquidation_ratio,
    }

    for key, func in korea_fetchers.items():
        print(f"  fetching korea_{key}...")
        try:
            data = func()
            output["korea"][key] = data
            status = "OK" if data.get("current_value") is not None else "FAIL"
            print(f"    {status}: {data.get('current_value', data.get('error', '?'))}")
        except Exception as e:
            output["korea"][key] = {"name": key, "error": str(e), "current_value": None}
            print(f"    ERROR: {e}")
            traceback.print_exc()

    output = clean_nan(output)

    out_path = DATA_DIR / "latest.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2, allow_nan=False)
    print(f"\n数据已保存到 {out_path}")

    hist_path = DATA_DIR / "history" / f"{TODAY}.json"
    with open(hist_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2, allow_nan=False)
    print(f"历史归档到 {hist_path}")

    return output


if __name__ == "__main__":
    main()
