"""
A股拐点信号追踪 - 数据获取脚本
拉取7个维度的原始数据，生成 latest.json
每日17:30由GitHub Actions触发
"""
import json
import math
import os
import datetime as dt
from pathlib import Path
import traceback

import akshare as ak
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
ERP_WINDOW_DAYS = 5 * 252

ETF_CODES = {
    "510300": "沪深300ETF",
    "510500": "中证500ETF",
    "159915": "创业板ETF",
    "588000": "科创50ETF",
    "510050": "上证50ETF",
    "512100": "中证1000ETF",
}

INDEX_CODE = "000300"
INDEX_NAME = "沪深300"


def safe_fetch(func, *args, **kwargs):
    try:
        return func(*args, **kwargs), None
    except Exception as e:
        return None, f"{func.__name__}: {e}"


def fetch_erp():
    """ERP = 1/PE - 十年国债收益率。用沪深300滚动市盈率（stock_index_pe_lg）。"""
    result = {"name": "ERP 股权风险溢价", "subtitle": "", "unit": "%", "data_source": "", "current_value": None, "history": [], "stats": {}}

    pe_df, err = safe_fetch(ak.stock_index_pe_lg, symbol="沪深300")
    if err or pe_df is None or len(pe_df) == 0:
        result["error"] = err or "pe empty"
        return result

    pe_df = pe_df.copy()
    pe_df["date"] = pd.to_datetime(pe_df["日期"])
    pe_df = pe_df.sort_values("date").tail(ERP_WINDOW_DAYS)
    pe_df["pe"] = pd.to_numeric(pe_df["滚动市盈率"], errors="coerce")
    pe_df = pe_df.dropna(subset=["pe"])

    bond_df, berr = safe_fetch(ak.bond_zh_us_rate, start_date="20200101")
    if berr or bond_df is None or len(bond_df) == 0:
        result["error"] = f"bond yield: {berr}"
        return result

    bond_df = bond_df.copy()
    bond_df["yield10"] = pd.to_numeric(bond_df["中国国债收益率10年"], errors="coerce")
    bond_df["date"] = pd.to_datetime(bond_df["日期"])
    bond_df = bond_df[["date", "yield10"]].dropna().sort_values("date")

    merged = pd.merge_asof(pe_df[["date", "pe"]].sort_values("date"), bond_df, on="date", direction="backward")
    merged = merged.dropna()
    merged["erp"] = (100.0 / merged["pe"]) - merged["yield10"]

    if len(merged) == 0:
        result["error"] = "merge empty"
        return result

    latest = merged.iloc[-1]
    erp_value = round(float(latest["erp"]), 3)

    window = merged["erp"].tail(ERP_WINDOW_DAYS)
    mean = round(float(window.mean()), 3)
    std = round(float(window.std()), 3)

    result.update({
        "subtitle": f"沪深300PE · 5年窗口",
        "data_source": "沪深300",
        "current_value": erp_value,
        "history": [{"date": d.strftime("%Y-%m-%d"), "value": round(v, 3)} for d, v in zip(merged["date"].tail(HISTORY_DAYS), merged["erp"].tail(HISTORY_DAYS))],
        "stats": {
            "mean": mean, "std": std,
            "plus_1x": round(mean + std, 3), "minus_1x": round(mean - std, 3),
            "plus_2x": round(mean + 2 * std, 3), "minus_2x": round(mean - 2 * std, 3),
        },
        "thresholds": {"red": f"<{round(mean - std, 2)}", "yellow": f"{round(mean - std, 2)}-{round(mean + std, 2)}", "green": f">{round(mean + std, 2)}"},
    })
    return result


def fetch_turnover():
    """换手率 = 全市场成交额 / 流通市值。当前值用legu，历史用沪深300成交额趋势。"""
    result = {"name": "换手率", "subtitle": "换手率% · 图表为成交额(亿)", "unit": "%", "data_source": "akshare", "current_value": None, "history": []}
    errors = []

    df, err = safe_fetch(ak.stock_market_activity_legu)
    if df is not None and len(df) > 0:
        try:
            for _, row in df.iterrows():
                item = str(row.iloc[0]) if len(row) > 0 else ""
                val = str(row.iloc[1]) if len(row) > 1 else ""
                if "换手率" in item:
                    num = float(val.replace("%", "").replace("亿", "").strip())
                    result["current_value"] = round(num, 3)
                    break
        except Exception as e:
            errors.append(f"parse legu: {e}")

    if result["current_value"] is None:
        spot, serr = safe_fetch(ak.stock_zh_a_spot_em)
        if spot is not None and len(spot) > 0:
            try:
                amount = float(spot["成交额"].sum())
                circ_mv = float(spot["流通市值"].sum())
                if circ_mv > 0:
                    result["current_value"] = round(amount / circ_mv * 100, 3)
            except Exception as e:
                errors.append(f"calc spot: {e}")
        elif serr:
            errors.append(serr)

    hist_df, herr = safe_fetch(ak.index_zh_a_hist, symbol="000300", period="daily", start_date=(dt.date.today() - dt.timedelta(days=HISTORY_DAYS + 100)).strftime("%Y%m%d"), end_date=dt.date.today().strftime("%Y%m%d"))
    if hist_df is not None and len(hist_df) > 0:
        try:
            hist_df = hist_df.copy()
            hist_df["日期"] = pd.to_datetime(hist_df["日期"])
            hist_df = hist_df.sort_values("日期")
            hist_df["成交额"] = pd.to_numeric(hist_df["成交额"], errors="coerce")
            result["history"] = [{"date": d.strftime("%Y-%m-%d"), "value": round(v / 1e8, 2)} for d, v in zip(hist_df["日期"], hist_df["成交额"]) if pd.notna(v)]
        except Exception as e:
            errors.append(f"hist parse: {e}")
    elif herr:
        errors.append(herr)

    if errors:
        result["error"] = "; ".join(errors[:3])
    return result


def fetch_margin():
    """两融交易占比 = 上交所融资买入额 / 上证综指成交额。有历史占比%。"""
    result = {"name": "两融交易占比", "subtitle": "融资买入额/上证成交额", "unit": "%", "data_source": "akshare", "current_value": None, "history": [], "extra": {}}
    errors = []

    start_date_3y = (dt.date.today() - dt.timedelta(days=HISTORY_DAYS + 100)).strftime("%Y%m%d")
    sh_df, sherr = safe_fetch(ak.stock_margin_sse, start_date=start_date_3y, end_date=dt.date.today().strftime("%Y%m%d"))
    if sherr:
        errors.append(sherr)

    idx_df, ierr = safe_fetch(ak.index_zh_a_hist, symbol="000001", period="daily", start_date=start_date_3y, end_date=dt.date.today().strftime("%Y%m%d"))
    if ierr:
        errors.append(ierr)

    if sh_df is not None and len(sh_df) > 0 and idx_df is not None and len(idx_df) > 0:
        try:
            sh_df = sh_df.copy()
            sh_df["日期"] = sh_df["信用交易日期"].astype(str)
            sh_df["融资买入额"] = pd.to_numeric(sh_df["融资买入额"], errors="coerce")
            sh_df = sh_df.sort_values("日期")

            idx_df = idx_df.copy()
            idx_df["日期"] = pd.to_datetime(idx_df["日期"]).dt.strftime("%Y%m%d")
            idx_df["成交额"] = pd.to_numeric(idx_df["成交额"], errors="coerce")
            idx_df = idx_df[["日期", "成交额"]].dropna().sort_values("日期")

            merged = sh_df[["日期", "融资买入额"]].merge(idx_df, on="日期", how="inner")
            merged = merged.dropna()
            merged["占比"] = merged["融资买入额"] / merged["成交额"] * 100

            result["history"] = [{"date": d, "value": round(v, 2)} for d, v in zip(merged["日期"], merged["占比"]) if pd.notna(v)]
            latest = merged.iloc[-1]
            result["current_value"] = round(float(latest["占比"]), 2)
            result["extra"]["sh_buy"] = round(float(latest["融资买入额"]) / 1e8, 2)
            result["extra"]["sh_amount"] = round(float(latest["成交额"]) / 1e8, 2)
        except Exception as e:
            errors.append(f"parse margin: {e}")

    if errors:
        result["error"] = "; ".join(errors[:3])
    return result


def fetch_etf_flow():
    """6只宽基ETF净流向。当前值为单日净流向，历史为各ETF成交额+合计。"""
    result = {"name": "ETF净流向", "subtitle": "6只宽基合计 · 可切换查看单只", "unit": "亿", "data_source": "akshare", "current_value": None, "history": [], "extra": {"etfs": {}, "per_etf_history": {}}}
    errors = []
    total_flow = 0
    etfs_detail = {}
    per_etf_hist = {}
    start_date_3y = (dt.date.today() - dt.timedelta(days=HISTORY_DAYS + 100)).strftime("%Y%m%d")
    all_dates = None
    combined_amount = None

    for code, name in ETF_CODES.items():
        df, err = safe_fetch(ak.fund_etf_hist_em, symbol=code, period="daily", start_date=start_date_3y, end_date=dt.date.today().strftime("%Y%m%d"), adjust="")
        if err or df is None or len(df) < 2:
            if err:
                errors.append(f"{code}: {err}")
            continue
        try:
            df = df.copy()
            df["日期"] = pd.to_datetime(df["日期"]).dt.strftime("%Y-%m-%d")
            df = df.sort_values("日期")
            df["成交量"] = pd.to_numeric(df["成交量"], errors="coerce")
            df["收盘"] = pd.to_numeric(df["收盘"], errors="coerce")
            df["成交额亿"] = df["成交量"] * df["收盘"] / 1e8

            latest = df.iloc[-1]
            prev = df.iloc[-2]
            flow = (float(latest["成交量"]) - float(prev["成交量"])) * float(latest["收盘"]) / 1e8
            total_flow += flow
            etfs_detail[name] = round(flow, 2)

            per_etf_hist[name] = [{"date": d, "value": round(v, 2)} for d, v in zip(df["日期"], df["成交额亿"]) if pd.notna(v)]

            if all_dates is None:
                all_dates = df["日期"].tolist()
                combined_amount = df["成交额亿"].fillna(0).tolist()
            else:
                temp = dict(zip(df["日期"], df["成交额亿"].fillna(0)))
                combined_amount = [a + temp.get(d, 0) for a, d in zip(combined_amount, all_dates)]
        except Exception as e:
            errors.append(f"{code} parse: {e}")

    result["current_value"] = round(total_flow, 2)
    result["extra"]["etfs"] = etfs_detail
    result["extra"]["per_etf_history"] = per_etf_hist
    if all_dates and combined_amount:
        result["history"] = [{"date": d, "value": round(v, 2)} for d, v in zip(all_dates, combined_amount)]
    if errors:
        result["error"] = "; ".join(errors[:3])
    return result


def fetch_ma():
    """沪深300均线状态：20日线、250日线得失。"""
    result = {"name": "均线", "subtitle": "沪深300 · 20日/250日线", "unit": "", "data_source": "akshare", "current_value": None, "history": [], "extra": {}}
    errors = []

    df, err = safe_fetch(ak.index_zh_a_hist, symbol=INDEX_CODE, period="daily", start_date=(dt.date.today() - dt.timedelta(days=400)).strftime("%Y%m%d"), end_date=dt.date.today().strftime("%Y%m%d"))
    if err or df is None or len(df) == 0:
        result["error"] = err or "empty"
        return result

    try:
        df = df.copy()
        df["日期"] = pd.to_datetime(df["日期"])
        df = df.sort_values("日期").reset_index(drop=True)
        df["close"] = pd.to_numeric(df["收盘"], errors="coerce")
        df["ma20"] = df["close"].rolling(20).mean()
        df["ma250"] = df["close"].rolling(250).mean()

        latest = df.iloc[-1]
        close = round(float(latest["close"]), 2)
        ma20 = round(float(latest["ma20"]), 2) if pd.notna(latest["ma20"]) else None
        ma250 = round(float(latest["ma250"]), 2) if pd.notna(latest["ma250"]) else None

        below_ma20_days = 0
        for i in range(len(df) - 1, -1, -1):
            if pd.notna(df.iloc[i]["ma20"]) and df.iloc[i]["close"] < df.iloc[i]["ma20"]:
                below_ma20_days += 1
            else:
                break

        broke_ma250_recent = False
        if ma250 is not None and len(df) >= 5:
            for i in range(max(0, len(df) - 5), len(df)):
                if pd.notna(df.iloc[i]["ma250"]) and df.iloc[i]["close"] < df.iloc[i]["ma250"]:
                    if i < len(df) - 1 and df.iloc[i + 1]["close"] > df.iloc[i + 1]["ma250"]:
                        broke_ma250_recent = True
                        break

        result["current_value"] = close
        result["extra"] = {
            "ma20": ma20, "ma250": ma250,
            "below_ma20_days": below_ma20_days,
            "broke_ma250_recent": broke_ma250_recent,
            "position_vs_ma20": "above" if close > ma20 else "below",
            "position_vs_ma250": "above" if (ma250 and close > ma250) else "below",
        }
        result["history"] = [{"date": d.strftime("%Y-%m-%d"), "value": round(v, 2)} for d, v in zip(df["日期"].tail(HISTORY_DAYS), df["close"].tail(HISTORY_DAYS))]
    except Exception as e:
        result["error"] = f"parse: {e}"
    return result


def fetch_vix():
    """CBOE VIX恐慌指数。"""
    result = {"name": "VIX", "subtitle": "CBOE恐慌指数", "unit": "", "data_source": "yfinance", "current_value": None, "history": []}
    try:
        ticker = yf.Ticker("^VIX")
        hist = ticker.history(period="3y")
        if hist is not None and len(hist) > 0:
            latest = hist.iloc[-1]
            result["current_value"] = round(float(latest["Close"]), 2)
            result["history"] = [{"date": d.strftime("%Y-%m-%d"), "value": round(v, 2)} for d, v in zip(hist.index, hist["Close"]) if pd.notna(v)]
        else:
            result["error"] = "yfinance empty"
    except Exception as e:
        result["error"] = str(e)
    return result


def fetch_north():
    """北向资金3日累计净流入。"""
    result = {"name": "北向资金", "subtitle": "3日累计净流向", "unit": "亿", "data_source": "akshare", "current_value": None, "history": []}
    errors = []

    df, err = safe_fetch(ak.stock_hsgt_hist_em, symbol="北向资金")
    if err or df is None or len(df) == 0:
        df2, err2 = safe_fetch(ak.stock_hsgt_north_net_flow_in_em)
        if err2 or df2 is None or len(df2) == 0:
            result["error"] = f"{err}; {err2}"
            return result
        df = df2

    try:
        df = df.copy()
        date_col = df.columns[0]
        df[date_col] = pd.to_datetime(df[date_col])
        df = df.sort_values(date_col)
        value_col = [c for c in df.columns if "净流入" in str(c) or "净买" in str(c)]
        col = value_col[0] if value_col else df.columns[1]
        df["flow"] = pd.to_numeric(df[col], errors="coerce") / 1e4 if df[col].abs().max() > 1e6 else pd.to_numeric(df[col], errors="coerce")

        recent = df.dropna(subset=["flow"]).tail(3)
        if len(recent) > 0:
            result["current_value"] = round(float(recent["flow"].sum()), 2)
            result["history"] = [{"date": d.strftime("%Y-%m-%d"), "value": round(v, 2)} for d, v in zip(df[date_col].tail(HISTORY_DAYS), df["flow"].tail(HISTORY_DAYS))]
        else:
            result["error"] = "no recent data"
    except Exception as e:
        result["error"] = f"parse: {e}"
    return result


def main():
    print(f"[{UPDATE_TIME}] 开始拉取数据...")
    output = {
        "date": TODAY,
        "update_time": UPDATE_TIME,
        "dimensions": {},
    }

    fetchers = {
        "erp": fetch_erp,
        "turnover": fetch_turnover,
        "margin": fetch_margin,
        "etf_flow": fetch_etf_flow,
        "ma": fetch_ma,
        "vix": fetch_vix,
        "north": fetch_north,
    }

    for key, func in fetchers.items():
        print(f"  fetching {key}...")
        try:
            data = func()
            output["dimensions"][key] = data
            status = "OK" if data.get("current_value") is not None else "FAIL"
            print(f"    {status}: {data.get('current_value', data.get('error', '?'))}")
        except Exception as e:
            output["dimensions"][key] = {"name": key, "error": str(e), "current_value": None}
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
