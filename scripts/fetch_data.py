"""
韩国市场信号 - 数据获取脚本
拉取韩国市场指标数据，生成 latest.json

数据源优先级（VKOSPI）：
1. Investing.com（cloudscraper 绕过 CloudFlare，稳定可用）
2. KRX 指数开放接口（日频波动率指数）
3. yfinance ^VKOSPI（Yahoo 已下架该 ticker，备用）
4. Yahoo Finance chart API 直连（备用）
5. korea_manual.json 手动数据

其他指标：
- 融资/强平/存管金/杠杆ETF 等 -> kimpremium.com (KOFIA/KRX 官方数据)
"""
import json
import math
import os
import re
import datetime as dt
from pathlib import Path
import traceback

import pandas as pd
import yfinance as yf
import requests

try:
    import cloudscraper
    _HAS_CLOUDSCRAPER = True
except ImportError:
    _HAS_CLOUDSCRAPER = False

try:
    from bs4 import BeautifulSoup
    _HAS_BS4 = True
except ImportError:
    _HAS_BS4 = False


KIMPREMIUM_BASE = "https://kimpremium.com/data"
KIMPREMIUM_API_BASE = "https://kimpremium.com/api/v1"

DATA_DIR = Path(__file__).parent.parent / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

TODAY = dt.date.today().strftime("%Y-%m-%d")
UPDATE_TIME = dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

HISTORY_DAYS = 3 * 252

MANUAL_DATA_PATH = DATA_DIR / "korea_manual.json"

_kimpremium_cache = None
_kimpremium_health = None


def _check_kimpremium_health():
    """调用 /api/v1/health 检查数据新鲜度。
    stale_days > 3 时打 warning，避免"跑了但没新数据"的假成功。
    返回 dict: {ok, asof, stale_days, level, generated}
    """
    global _kimpremium_health
    if _kimpremium_health is not None:
        return _kimpremium_health

    try:
        resp = requests.get(f"{KIMPREMIUM_API_BASE}/health", timeout=15,
                            headers={"User-Agent": "korea-market-signal/1.0"})
        resp.raise_for_status()
        health = resp.json()
        _kimpremium_health = health

        stale = health.get("stale_days", 0)
        asof = health.get("asof", "?")
        level = health.get("level", "?")
        generated = health.get("generated", "?")

        if stale > 3:
            print(f"  ⚠️  [health] kimpremium 数据已过期 {stale} 天 (asof={asof}, generated={generated})")
            print(f"      → 本次抓取可能拿到旧数据，请检查 kimpremium 数据管道是否正常")
        else:
            print(f"  ✓ [health] kimpremium 数据正常 (asof={asof}, stale_days={stale}, level={level})")

        return health
    except Exception as e:
        print(f"  ⚠️  [health] kimpremium health check 失败: {e}")
        _kimpremium_health = {"ok": False, "error": str(e)}
        return _kimpremium_health


def _format_date(d):
    """YYYYMMDD -> YYYY-MM-DD"""
    if len(d) == 8:
        return f"{d[:4]}-{d[4:6]}-{d[6:8]}"
    return d


def _fetch_kimpremium_data():
    """从 kimpremium.com 抓取 series.json 和 etf.json"""
    global _kimpremium_cache
    if _kimpremium_cache is not None:
        return _kimpremium_cache

    try:
        resp_series = requests.get(f"{KIMPREMIUM_BASE}/series.json", timeout=30)
        resp_series.raise_for_status()
        series = resp_series.json()
    except Exception as e:
        print(f"    kimpremium series.json fetch failed: {e}")
        _kimpremium_cache = {}
        return _kimpremium_cache

    try:
        resp_etf = requests.get(f"{KIMPREMIUM_BASE}/etf.json", timeout=30)
        resp_etf.raise_for_status()
        etf = resp_etf.json()
    except Exception as e:
        print(f"    kimpremium etf.json fetch failed: {e}")
        etf = {}

    _kimpremium_cache = {"series": series, "etf": etf}
    return _kimpremium_cache


def _get_recent_series(series_data, field, days=500):
    """从 series.json 获取最近 N 天的历史数据"""
    if not series_data or field not in series_data:
        return [], None

    dates = series_data["d"]
    values = series_data[field]
    history = []
    latest_value = None
    latest_date = None

    for i in range(len(dates) - 1, -1, -1):
        if values[i] is not None:
            if latest_value is None:
                latest_value = values[i]
                latest_date = _format_date(dates[i])
            if len(history) < days:
                history.append({
                    "date": _format_date(dates[i]),
                    "value": values[i]
                })
            else:
                break

    history.reverse()
    return history, latest_value, latest_date


def _get_recent_etf(etf_data, days=500):
    """从 etf.json 获取 ETF 历史数据"""
    if not etf_data:
        return [], None, None

    dates = etf_data.get("d", [])
    flow = etf_data.get("flow", [])
    cum_flow = etf_data.get("cumFlow", [])
    aum = etf_data.get("aum", [])

    if not dates or not flow:
        return [], None, None

    history = []
    latest_value = None
    latest_date = None

    for i in range(len(dates) - 1, -1, -1):
        if flow[i] is not None:
            record = {
                "date": _format_date(dates[i]),
                "net_flow": flow[i] if i < len(flow) else None,
            }
            if i < len(cum_flow):
                record["cum_flow"] = cum_flow[i]
            if i < len(aum):
                record["aum"] = aum[i]
            else:
                kpi = etf_data.get("kpi", {})
                if kpi.get("aum"):
                    record["aum"] = kpi["aum"]

            if latest_value is None:
                latest_value = record.get("aum", kpi.get("aum")) if (kpi := etf_data.get("kpi", {})) else None
                latest_date = _format_date(dates[i])

            if len(history) < days:
                history.append(record)
            else:
                break

    # 备用: 从 kpi.aum 获取当前 AUM
    kpi = etf_data.get("kpi", {})
    if kpi.get("aum") and latest_value is None:
        latest_value = kpi["aum"]

    history.reverse()
    return history, latest_value, latest_date


def clean_nan(obj):
    """递归把NaN/Infinity替换成None，避免浏览器JSON.parse失败"""
    if isinstance(obj, float) and (math.isnan(obj) or math.isinf(obj)):
        return None
    if isinstance(obj, dict):
        return {k: clean_nan(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [clean_nan(v) for v in obj]
    return obj


def load_manual_korea_data():
    if MANUAL_DATA_PATH.exists():
        try:
            with open(MANUAL_DATA_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def _investing_http_get(url, timeout=20):
    """使用 curl_cffi 或 cloudscraper 访问 Investing.com，绕过 CloudFlare。
    CI 环境优先 curl_cffi（模拟浏览器 TLS 指纹），本地回退 cloudscraper。
    返回 Response 对象或 None。
    """
    # 方案 1: curl_cffi（模拟浏览器 TLS 指纹，CI 环境最可靠）
    try:
        from curl_cffi import requests as curl_requests
        for browser in ["chrome120", "chrome116", "chrome110"]:
            try:
                resp = curl_requests.get(url, impersonate=browser, timeout=timeout)
                if resp.status_code == 200:
                    return resp
            except Exception:
                continue
    except ImportError:
        pass

    # 方案 2: cloudscraper（本地环境可用）
    if _HAS_CLOUDSCRAPER:
        try:
            scraper = cloudscraper.create_scraper(
                browser={'browser': 'chrome', 'platform': 'darwin', 'mobile': False}
            )
            resp = scraper.get(url, timeout=timeout)
            if resp.status_code == 200:
                return resp
        except Exception:
            pass

    return None


def _fetch_vkospi_via_investing():
    """从 Investing.com 获取 VKOSPI 历史数据。
    使用 curl_cffi/cloudscraper 绕过 CloudFlare 保护。
    返回 [{date, value}, ...] 或 []。
    """
    # 1. 先获取当前实时值（从概览页面）
    current_value = None
    try:
        resp = _investing_http_get("https://cn.investing.com/indices/kospi-volatility")
        if resp:
            m = re.search(r'instrument-price-last[^>]*>([0-9]+\.?[0-9]*)', resp.text)
            if m:
                current_value = float(m.group(1))
                print(f"      Investing.com 实时值: {current_value}")
        else:
            print("      Investing.com 概览页获取失败（CloudFlare 拦截）")
    except Exception as e:
        print(f"      Investing.com 概览页失败: {e}")

    # 2. 获取历史数据
    history = []
    try:
        resp = _investing_http_get("https://cn.investing.com/indices/kospi-volatility-historical-data")
        if not resp:
            print("      Investing.com 历史数据页获取失败（CloudFlare 拦截）")
            return [{"date": dt.date.today().strftime("%Y-%m-%d"), "value": current_value}] if current_value else []

        if not _HAS_BS4:
            print("      beautifulsoup4 未安装，无法解析历史数据表格")
            return [{"date": dt.date.today().strftime("%Y-%m-%d"), "value": current_value}] if current_value else []

        soup = BeautifulSoup(resp.text, "html.parser")
        tables = soup.find_all("table")

        # 找包含"日期"和"收盘"表头的表格
        target_table = None
        for table in tables:
            headers = [th.get_text(strip=True) for th in table.find_all("th")]
            if "日期" in headers and "收盘" in headers:
                target_table = table
                break

        if not target_table:
            print("      Investing.com 未找到历史数据表格")
            return [{"date": dt.date.today().strftime("%Y-%m-%d"), "value": current_value}] if current_value else []

        rows = target_table.find_all("tr")
        for row in rows[1:]:  # 跳过表头
            cells = [td.get_text(strip=True) for td in row.find_all(["td", "th"])]
            if len(cells) < 2:
                continue
            date_str = cells[0]  # 格式: "2026年08月03日"
            close_str = cells[1]  # 收盘价

            # 解析日期
            m = re.match(r'(\d{4})年(\d{1,2})月(\d{1,2})日', date_str)
            if not m:
                continue
            d_fmt = f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"

            # 解析收盘价
            try:
                val = float(close_str.replace(",", ""))
            except ValueError:
                continue

            history.append({"date": d_fmt, "value": round(val, 2)})

        # 历史数据是倒序的（最新在上），转换为正序
        history.reverse()
        print(f"      Investing.com 历史数据: {len(history)} 条, 最新 {history[-1]['date']} = {history[-1]['value']}")

        # 3. 如果有实时值且与最新历史数据日期不同，追加实时值
        if current_value is not None:
            from datetime import timezone, timedelta
            kr_today = dt.datetime.now(timezone(timedelta(hours=9))).strftime("%Y-%m-%d")
            if not history or history[-1]["date"] != kr_today:
                # 检查是否是交易日（工作日）
                if dt.date.today().weekday() < 5:
                    history.append({"date": kr_today, "value": current_value})
                    print(f"      追加盘中实时值: {kr_today} = {current_value}")

    except Exception as e:
        print(f"      Investing.com 历史数据抓取失败: {e}")
        if current_value is not None:
            return [{"date": dt.date.today().strftime("%Y-%m-%d"), "value": current_value}]

    return history


def _fetch_index_via_investing(overview_url, history_url, name):
    """通用 Investing.com 指数抓取函数。
    返回 [{"date": "YYYY-MM-DD", "value": float}, ...] 或 []。
    """
    # 1. 先获取当前实时值
    current_value = None
    try:
        resp = _investing_http_get(overview_url)
        if resp:
            # 新版页面用 text-5xl/9 类名显示主价格
            soup = BeautifulSoup(resp.text, "html.parser")
            el = soup.find(class_='text-5xl/9')
            if el:
                try:
                    current_value = float(el.get_text(strip=True).replace(",", ""))
                    print(f"      Investing.com {name} 实时值: {current_value}")
                except ValueError:
                    pass
            # 兜底：旧版 instrument-price-last
            if current_value is None:
                m = re.search(r'instrument-price-last[^>]*>([0-9,]+\.?[0-9]*)', resp.text)
                if m:
                    current_value = float(m.group(1).replace(",", ""))
        else:
            print(f"      Investing.com {name} 概览页获取失败")
    except Exception as e:
        print(f"      Investing.com {name} 概览页失败: {e}")

    # 2. 获取历史数据
    history = []
    try:
        resp = _investing_http_get(history_url)
        if not resp:
            print(f"      Investing.com {name} 历史数据页获取失败")
            return [{"date": dt.date.today().strftime("%Y-%m-%d"), "value": current_value}] if current_value else []

        if not _HAS_BS4:
            return [{"date": dt.date.today().strftime("%Y-%m-%d"), "value": current_value}] if current_value else []

        soup = BeautifulSoup(resp.text, "html.parser")
        tables = soup.find_all("table")

        target_table = None
        for table in tables:
            headers = [th.get_text(strip=True) for th in table.find_all("th")]
            if "日期" in headers and "收盘" in headers:
                target_table = table
                break

        if not target_table:
            print(f"      Investing.com {name} 未找到历史数据表格")
            return [{"date": dt.date.today().strftime("%Y-%m-%d"), "value": current_value}] if current_value else []

        rows = target_table.find_all("tr")
        for row in rows[1:]:
            cells = [td.get_text(strip=True) for td in row.find_all(["td", "th"])]
            if len(cells) < 2:
                continue
            date_str = cells[0]
            close_str = cells[1]

            m = re.match(r'(\d{4})年(\d{1,2})月(\d{1,2})日', date_str)
            if not m:
                continue
            d_fmt = f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"

            try:
                val = float(close_str.replace(",", ""))
            except ValueError:
                continue

            history.append({"date": d_fmt, "value": round(val, 2)})

        history.reverse()
        print(f"      Investing.com {name} 历史数据: {len(history)} 条, 最新 {history[-1]['date']} = {history[-1]['value']}")

        # 3. 如果有实时值且与最新历史数据日期不同，追加实时值
        if current_value is not None:
            from datetime import timezone, timedelta
            kr_today = dt.datetime.now(timezone(timedelta(hours=9))).strftime("%Y-%m-%d")
            if not history or history[-1]["date"] != kr_today:
                if dt.date.today().weekday() < 5:
                    history.append({"date": kr_today, "value": current_value})
                    print(f"      追加盘中实时值: {kr_today} = {current_value}")

    except Exception as e:
        print(f"      Investing.com {name} 历史数据抓取失败: {e}")
        if current_value is not None:
            return [{"date": dt.date.today().strftime("%Y-%m-%d"), "value": current_value}]

    return history


def _fetch_index_via_yahoo_direct(symbol, name, range_param="6mo"):
    """直接使用 requests 调用 Yahoo Finance chart API 获取指数日线。
    symbol 例: "^KS11" (KOSPI), "^KQ11" (KOSDAQ)。
    返回 [{"date": "YYYY-MM-DD", "value": float}, ...] 或 []。
    Yahoo chart API 对 CI 环境（GitHub Actions IP 池）稳定，无 CloudFlare 拦截。
    """
    session = requests.Session()
    headers = {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        "Accept": "application/json,text/plain,*/*",
        "Accept-Language": "en-US,en;q=0.9",
    }

    # 获取 A3 cookie（失败不影响后续）
    try:
        session.get("https://fc.yahoo.com", headers=headers, allow_redirects=True, timeout=10)
    except Exception:
        pass

    import time
    time.sleep(0.3)

    # 获取 crumb
    try:
        crumb_resp = session.get(
            "https://query2.finance.yahoo.com/v1/test/getcrumb",
            headers=headers,
            timeout=10,
        )
        crumb = crumb_resp.text.strip() if crumb_resp.status_code == 200 and len(crumb_resp.text) < 32 else ""
    except Exception:
        crumb = ""

    time.sleep(0.3)

    # 查询指数日线
    from urllib.parse import quote
    url = f"https://query2.finance.yahoo.com/v8/finance/chart/{quote(symbol)}"
    params = {
        "range": range_param,
        "interval": "1d",
        "includePrePost": "false",
    }
    if crumb:
        params["crumb"] = crumb

    try:
        resp = session.get(url, headers=headers, params=params, timeout=20)
        if resp.status_code != 200:
            print(f"      Yahoo direct {name} HTTP {resp.status_code}")
            return []
        obj = resp.json()
        results = obj.get("chart", {}).get("result", [])
        if not results:
            err = obj.get("chart", {}).get("error", {})
            print(f"      Yahoo direct {name} 错误: {err}")
            return []
        ts = results[0].get("timestamp", [])
        quotes = results[0].get("indicators", {}).get("quote", [{}])[0]
        closes = quotes.get("close", [])
        history = []
        for t, c in zip(ts, closes):
            if c is None:
                continue
            d = dt.datetime.fromtimestamp(t, tz=dt.timezone.utc).strftime("%Y-%m-%d")
            history.append({"date": d, "value": round(float(c), 2)})
        if history:
            print(f"      Yahoo direct {name}: {len(history)} 条, 最新 {history[-1]['date']} = {history[-1]['value']}")
        return history
    except Exception as e:
        print(f"      Yahoo direct {name} 错误: {e}")
        return []


def fetch_korea_kospi():
    """KOSPI 综合指数。数据源优先级: Yahoo chart API -> Investing.com -> yfinance。"""
    result = {
        "name": "KOSPI",
        "subtitle": "韩国综合股价指数",
        "unit": "",
        "data_source": "Yahoo Finance",
        "current_value": None,
        "history": [],
    }

    # 1. Yahoo chart API 直连（CI 环境最稳定）
    try:
        print("    尝试从 Yahoo Finance 获取 KOSPI (^KS11)...")
        history = _fetch_index_via_yahoo_direct("^KS11", "KOSPI")
        if history:
            result["history"] = history[-500:]
            result["current_value"] = history[-1]["value"]
            result["note"] = f"自动抓取 {len(history)} 条，最新 {history[-1]['date']}"
            return result
    except Exception as e:
        print(f"      Yahoo Finance KOSPI 失败: {e}")

    # 2. Investing.com（curl_cffi/cloudscraper，本地可用）
    try:
        print("    尝试从 Investing.com 获取 KOSPI...")
        history = _fetch_index_via_investing(
            "https://cn.investing.com/indices/kospi",
            "https://cn.investing.com/indices/kospi-historical-data",
            "KOSPI",
        )
        if history:
            result["history"] = history[-500:]
            result["current_value"] = history[-1]["value"]
            result["data_source"] = "Investing.com"
            result["note"] = f"自动抓取 {len(history)} 条，最新 {history[-1]['date']}"
            return result
    except Exception as e:
        print(f"      Investing.com KOSPI 失败: {e}")

    # 3. yfinance（最后备用，CI 环境可能被限流）
    try:
        print("    尝试从 yfinance 获取 KOSPI (^KS11)...")
        ticker = yf.Ticker("^KS11")
        hist = ticker.history(period="6mo")
        if hist is not None and len(hist) > 0:
            history = [
                {"date": idx.strftime("%Y-%m-%d"), "value": round(float(row["Close"]), 2)}
                for idx, row in hist.iterrows() if row["Close"] == row["Close"]
            ]
            if history:
                result["history"] = history[-500:]
                result["current_value"] = history[-1]["value"]
                result["data_source"] = "yfinance"
                result["note"] = f"自动抓取 {len(history)} 条"
                return result
    except Exception as e:
        print(f"      yfinance KOSPI 失败: {e}")

    result["error"] = "Yahoo/Investing.com/yfinance 均无 KOSPI 数据"
    return result


def fetch_korea_kosdaq():
    """KOSDAQ 综合指数。数据源优先级: Yahoo chart API -> Investing.com -> yfinance。"""
    result = {
        "name": "KOSDAQ",
        "subtitle": "韩国创业板指数",
        "unit": "",
        "data_source": "Yahoo Finance",
        "current_value": None,
        "history": [],
    }

    # 1. Yahoo chart API 直连（CI 环境最稳定）
    try:
        print("    尝试从 Yahoo Finance 获取 KOSDAQ (^KQ11)...")
        history = _fetch_index_via_yahoo_direct("^KQ11", "KOSDAQ")
        if history:
            result["history"] = history[-500:]
            result["current_value"] = history[-1]["value"]
            result["note"] = f"自动抓取 {len(history)} 条，最新 {history[-1]['date']}"
            return result
    except Exception as e:
        print(f"      Yahoo Finance KOSDAQ 失败: {e}")

    # 2. Investing.com（curl_cffi/cloudscraper，本地可用）
    try:
        print("    尝试从 Investing.com 获取 KOSDAQ...")
        history = _fetch_index_via_investing(
            "https://cn.investing.com/indices/kosdaq",
            "https://cn.investing.com/indices/kosdaq-historical-data",
            "KOSDAQ",
        )
        if history:
            result["history"] = history[-500:]
            result["current_value"] = history[-1]["value"]
            result["data_source"] = "Investing.com"
            result["note"] = f"自动抓取 {len(history)} 条，最新 {history[-1]['date']}"
            return result
    except Exception as e:
        print(f"      Investing.com KOSDAQ 失败: {e}")

    # 3. yfinance（最后备用，CI 环境可能被限流）
    try:
        print("    尝试从 yfinance 获取 KOSDAQ (^KQ11)...")
        ticker = yf.Ticker("^KQ11")
        hist = ticker.history(period="6mo")
        if hist is not None and len(hist) > 0:
            history = [
                {"date": idx.strftime("%Y-%m-%d"), "value": round(float(row["Close"]), 2)}
                for idx, row in hist.iterrows() if row["Close"] == row["Close"]
            ]
            if history:
                result["history"] = history[-500:]
                result["current_value"] = history[-1]["value"]
                result["data_source"] = "yfinance"
                result["note"] = f"自动抓取 {len(history)} 条"
                return result
    except Exception as e:
        print(f"      yfinance KOSDAQ 失败: {e}")

    result["error"] = "Yahoo/Investing.com/yfinance 均无 KOSDAQ 数据"
    return result


def _fetch_vkospi_via_krx():
    """从 KRX 指数开放接口获取 VKOSPI 日频历史数据。

    KRX 指数开放 API 说明：
    URL: https://open.krx.co.kr/contents/OPN/STD/STD_01_01_04P.do (公开文档)
    实际使用的是开放门户统计图表页后端 JSON 端点。
    """
    session = requests.Session()
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://open.krx.co.kr/",
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest",
    }

    # 方法 1: KRX 官方开放门户 "KOSPI 200 波动率지수" 时间序列 JSON
    # 另一种方法：直接请求 KRX 数据门户 genDataApi 接口
    # 常见 bld 组合，VKOSPI 的统计代码:
    #   KOSPI 200 波动率 지수 = 21（지수분류코드），中분류=02
    # 这里尝试 open.krx 的 genFindData 方式
    import time

    try:
        # 先请求开放门户拿会话 cookie 和 JSESSIONID
        main = session.get(
            "https://open.krx.co.kr/contents/OPN/STD/STD_01_01_01P.do",
            headers=headers, timeout=15, allow_redirects=True,
        )
    except Exception:
        pass

    time.sleep(0.3)

    # 实际使用 KRX 公共数据图表接口（公开查询）
    # 参考：KOSPI200 일별 시세 / 변동성지수
    # VKOSPI = KOSPI 200 Volatility Index, 代码 'VKOSPI' 或 '120'
    # 尝试几个常见的 stat_url_code
    attempts = [
        # bld 参数: dbms/COMMON/FIND/MDCSTAT00301 (지수시세 - 주가지수 일별)
        ("https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd", {
            "bld": "dbms/COMMON/FIND/MDCSTAT00301",
            "locale": "ko_KR",
            "tboxindTpcd": "1",      # 1: 주가지수
            "tboxindMidcd": "02",     # 02: KOSPI 200
            "tboxindClscd": "21",     # 21: 변동성지수 (VKOSPI)
            "tboxindCalcval": "1",
            "tboxindUprcd": "310",    # 310: KOSPI 200
            "textndTpcd": "1",
            "textndMidcd": "02",
            "textndClscd": "21",
            "textndCalcval": "1",
            "textndUprcd": "310",
            "inqryDiv": "2",
            "inqryBgnDt": (dt.date.today() - dt.timedelta(days=60)).strftime("%Y%m%d"),
            "inqryEndDt": dt.date.today().strftime("%Y%m%d"),
            "pagePath": "/contents/MKD/STAT/MDCSTAT00301.jsp",
        }),
        # 另一个常见的开放接口：KOSPI 指数 / 日频 VKOSPI 也出现在 MDCSTAT00401
        ("https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd", {
            "bld": "dbms/MDC/STAT/standard/MDCSTAT00401",
            "locale": "ko_KR",
            "indTpcd": "1",
            "indMidcd": "02",
            "indClscd": "21",
            "indCalcval": "1",
            "indUprcd": "310",
            "inqryDiv": "1",
            "inqryBgnDt": (dt.date.today() - dt.timedelta(days=700)).strftime("%Y%m%d"),
            "inqryEndDt": dt.date.today().strftime("%Y%m%d"),
            "pagePath": "/contents/MKD/STAT/standard/MDCSTAT00401.jsp",
        }),
    ]

    for url, params in attempts:
        try:
            resp = session.post(url, data=params, headers=headers, timeout=20)
            if resp.status_code != 200:
                continue
            try:
                obj = resp.json()
            except Exception:
                continue

            # 不同 bld 返回的数组键名不同，找包含日期+指数值的数组
            arr_key = None
            for k in ["output", "OutBlock_1", "output_1", "OutBlock", "value", "result"]:
                if k in obj and isinstance(obj[k], list) and len(obj[k]) > 0:
                    arr_key = k
                    break
            if arr_key is None:
                # 扫描所有 list 值，看哪个包含类似 TRD_DT / CLSPRC_IDX 字段
                for k, v in obj.items():
                    if isinstance(v, list) and len(v) > 0 and isinstance(v[0], dict):
                        keys = v[0].keys()
                        if any("DT" in kk.upper() or "DATE" in kk.upper() for kk in keys):
                            if any("CLS" in kk.upper() or "VAL" in kk.upper() or "IDX" in kk.upper() for kk in keys):
                                arr_key = k
                                break

            if not arr_key:
                continue

            rows = obj[arr_key]
            if len(rows) == 0:
                continue

            # 猜测字段名
            sample = rows[0]
            date_key = next((k for k in sample.keys() if "DT" in k.upper() or "DATE" in k.upper()), None)
            close_key = next((k for k in sample.keys() if "CLS" in k.upper() or "END" in k.upper() or "PRC" in k.upper() or "VAL" in k.upper() or ("IDX" in k.upper() and "UPR" not in k.upper())), None)
            if not date_key or not close_key:
                continue

            history = []
            for row in rows:
                d_raw = str(row.get(date_key, "")).replace("/", "-")
                v = row.get(close_key)
                if d_raw and v is not None:
                    try:
                        d_fmt = d_raw
                        if len(d_fmt) == 8 and d_fmt.isdigit():
                            d_fmt = f"{d_fmt[:4]}-{d_fmt[4:6]}-{d_fmt[6:8]}"
                        else:
                            # e.g. 2026/07/28
                            parts = d_raw.replace(".", "-").replace("/", "-").split("-")
                            if len(parts) == 3:
                                d_fmt = f"{parts[0]}-{parts[1].zfill(2)}-{parts[2].zfill(2)}"
                        val = float(str(v).replace(",", ""))
                        history.append({"date": d_fmt, "value": round(val, 2)})
                    except Exception:
                        continue

            if history:
                history.sort(key=lambda x: x["date"])
                print(f"      KRX VKOSPI: {len(history)} 条, 最新 {history[-1]['date']} = {history[-1]['value']}")
                return history

        except Exception:
            continue

    return []


def _fetch_vkospi_via_yahoo_direct():
    """直接使用 requests 调用 Yahoo Finance chart API 获取 VKOSPI，规避 yfinance 的 cookie 限流。"""
    session = requests.Session()
    headers = {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        "Accept": "application/json,text/plain,*/*",
        "Accept-Language": "en-US,en;q=0.9",
    }

    try:
        # 获取 A3 cookie
        session.get("https://fc.yahoo.com", headers=headers, allow_redirects=True, timeout=10)
    except Exception:
        pass

    import time
    time.sleep(0.3)

    try:
        # 获取 crumb
        crumb_resp = session.get(
            "https://query2.finance.yahoo.com/v1/test/getcrumb",
            headers=headers,
            timeout=10,
        )
        crumb = crumb_resp.text.strip() if crumb_resp.status_code == 200 and len(crumb_resp.text) < 32 else ""
    except Exception:
        crumb = ""

    time.sleep(0.3)

    # 查询 2 年的 VKOSPI 日线
    url = "https://query2.finance.yahoo.com/v8/finance/chart/%5EVKOSPI"
    params = {
        "range": "2y",
        "interval": "1d",
        "includePrePost": "false",
        "events": "div,splits",
    }
    if crumb:
        params["crumb"] = crumb

    try:
        resp = session.get(url, headers=headers, params=params, timeout=20)
        if resp.status_code != 200:
            print(f"      Yahoo direct HTTP {resp.status_code}")
            return []
        obj = resp.json()
        results = obj.get("chart", {}).get("result", [])
        if not results:
            return []
        ts = results[0].get("timestamp", [])
        quotes = results[0].get("indicators", {}).get("quote", [{}])[0]
        closes = quotes.get("close", [])
        history = []
        import datetime as _dt
        for t, c in zip(ts, closes):
            if c is None:
                continue
            d = _dt.datetime.fromtimestamp(t, tz=_dt.timezone.utc).strftime("%Y-%m-%d")
            history.append({"date": d, "value": round(float(c), 2)})
        print(f"      Yahoo direct VKOSPI: {len(history)} 条, 最新 {history[-1]['date']} = {history[-1]['value']}")
        return history
    except Exception as e:
        print(f"      Yahoo direct VKOSPI 错误: {e}")
        return []


def fetch_korea_vkospi():
    """韩国波动率指数 VKOSPI。Investing.com -> KRX 开放接口 -> yfinance -> Yahoo 直连 -> manual。"""
    manual = load_manual_korea_data()
    result = {"name": "VKOSPI", "subtitle": "韩国波动率指数", "unit": "", "data_source": "KRX", "current_value": None, "history": []}
    result["thresholds"] = {"red": ">40", "yellow": "20-40", "green": "<20"}

    auto_history = []
    auto_source_name = ""

    # 1. 优先 Investing.com（cloudscraper 绕过 CloudFlare，稳定可用）
    try:
        print("    尝试从 Investing.com 获取 VKOSPI...")
        auto_history = _fetch_vkospi_via_investing()
        if auto_history:
            auto_source_name = "Investing.com"
    except Exception as e:
        print(f"      Investing.com VKOSPI 失败: {e}")

    # 2. KRX 官方接口（VKOSPI 的发布机构，权威）
    if not auto_history:
        try:
            print("    尝试 KRX 开放门户获取 VKOSPI...")
            auto_history = _fetch_vkospi_via_krx()
            if auto_history:
                auto_source_name = "KRX/开放门户"
        except Exception as e:
            print(f"      KRX VKOSPI 失败: {e}")

    # 3. 失败 -> yfinance（CI 环境 IP 池大，通常不受限流）
    if not auto_history:
        try:
            print("    从 yfinance 抓取 VKOSPI (^VKOSPI)...")
            ticker = yf.Ticker("^VKOSPI")
            hist = ticker.history(period="2y")
            if hist is not None and len(hist) > 0:
                auto_history = [
                    {"date": d.strftime("%Y-%m-%d"), "value": round(float(v), 2)}
                    for d, v in zip(hist.index, hist["Close"])
                    if pd.notna(v)
                ]
                if auto_history:
                    auto_source_name = "KRX/yfinance"
                    print(f"      yfinance VKOSPI: {len(auto_history)} 条, 最新 {auto_history[-1]['date']} = {auto_history[-1]['value']}")
        except Exception as e:
            print(f"      yfinance VKOSPI 失败: {e}")

    # 4. -> Yahoo Finance 直连 chart API（规避本地 cookie 限流
    if not auto_history:
        print("    尝试 Yahoo Finance 直连 API 获取 VKOSPI...")
        auto_history = _fetch_vkospi_via_yahoo_direct()
        if auto_history:
            auto_source_name = "KRX/Yahoo直连"

    # 5. 读取 manual 数据作为补充
    m = manual.get("vkospi", {})
    manual_history = m.get("history", [])

    # 6. 合并策略：优先自动抓取；有自动，缺失用 manual 填充；两者都空才回退 manual
    if auto_history:
        auto_date_set = {h["date"] for h in auto_history}
        for item in manual_history:
            if item["date"] not in auto_date_set:
                auto_history.append(item)
        seen = {}
        for item in auto_history:
            seen[item["date"]] = item["value"]
        merged_history = [{"date": d, "value": v} for d, v in sorted(seen.items())]

        result["history"] = merged_history[-500:]
        result["current_value"] = result["history"][-1]["value"]
        result["data_source"] = auto_source_name or "KRX/自动"
        supplement_count = len(merged_history) - len(auto_date_set)
        note_parts = [f"自动抓取 {len(auto_date_set)} 条"]
        if supplement_count > 0:
            note_parts.append(f"manual 补充 {supplement_count} 条")
        note_parts.append(f"最新 {result['history'][-1]['date']}")
        result["note"] = ", ".join(note_parts)
    else:
        if m.get("current_value") is not None:
            result["current_value"] = m["current_value"]
            result["history"] = manual_history
            result["data_source"] = "KRX (手动更新)"
            result["note"] = m.get("note", "数据来自手动更新文件")
        else:
            result["error"] = "KRX/yfinance/manual 均无 VKOSPI 数据"

    return result


def _fetch_vkospi_realtime():
    """获取 VKOSPI 盘中实时报价。yfinance fast_info 优先，Yahoo chart API 兜底。
    返回 float 或 None。"""
    # 方案 1: yfinance fast_info.last_price
    try:
        ticker = yf.Ticker("^VKOSPI")
        rt = ticker.fast_info.last_price
        if rt and rt > 0:
            return round(float(rt), 2)
    except Exception as e:
        print(f"      yfinance fast_info 失败: {e}")

    # 方案 2: Yahoo chart API（含 regularMarketPrice）
    try:
        import requests
        url = "https://query2.finance.yahoo.com/v8/finance/chart/%5EVKOSPI?range=1d&interval=1m"
        headers = {"User-Agent": "Mozilla/5.0"}
        resp = requests.get(url, headers=headers, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            meta = data.get("chart", {}).get("result", [{}])[0].get("meta", {})
            rt = meta.get("regularMarketPrice")
            if rt and rt > 0:
                return round(float(rt), 2)
    except Exception as e:
        print(f"      Yahoo chart API 实时值失败: {e}")

    return None


def fetch_korea_margin():
    """韩国融资余额数据。优先从 kimpremium.com 自动抓取。"""
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

    kimpremium = _fetch_kimpremium_data()
    series = kimpremium.get("series", {})

    if series and "fin" in series:
        history, current_value, latest_date = _get_recent_series(series, "fin", 500)
        result["current_value"] = current_value
        result["history"] = history
        result["data_source"] = "KOFIA (kimpremium.com)"
        result["note"] = f"数据来源: kimpremium.com (KOFIA FreeSIS), 截至 {latest_date}"

        # 从同一份数据获取强平信息
        if "liq" in series:
            _, liq_val, _ = _get_recent_series(series, "liq", 1)
            result["extra"]["liquidation"] = liq_val
        if "liqR" in series:
            _, liqR_val, _ = _get_recent_series(series, "liqR", 1)
            result["extra"]["liquidation_ratio"] = liqR_val

        return result

    # 回退到手动数据
    manual = load_manual_korea_data()
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
    """韩国每日强平金额数据。优先从 kimpremium.com 自动抓取。"""
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

    kimpremium = _fetch_kimpremium_data()
    series = kimpremium.get("series", {})

    if series and "liq" in series:
        history, current_value, latest_date = _get_recent_series(series, "liq", 500)
        result["current_value"] = current_value
        result["history"] = history
        result["data_source"] = "KOFIA (kimpremium.com)"
        result["note"] = f"数据来源: kimpremium.com (KOFIA FreeSIS), 截至 {latest_date}"

        if "liqR" in series:
            _, liqR_val, _ = _get_recent_series(series, "liqR", 1)
            result["extra"]["liquidation_ratio"] = liqR_val

        return result

    manual = load_manual_korea_data()
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
    """韩国强平比例（强平÷未收）。优先从 kimpremium.com 自动抓取。"""
    result = {
        "name": "强平比例",
        "subtitle": "强平÷未收",
        "unit": "%",
        "data_source": "KOFIA",
        "current_value": None,
        "history": [],
        "thresholds": {"red": ">3%", "yellow": "1-3%", "green": "<1%"}
    }

    kimpremium = _fetch_kimpremium_data()
    series = kimpremium.get("series", {})

    if series and "liqR" in series:
        history, current_value, latest_date = _get_recent_series(series, "liqR", 500)
        result["current_value"] = current_value
        result["history"] = history
        result["data_source"] = "KOFIA (kimpremium.com)"
        result["note"] = f"数据来源: kimpremium.com (KOFIA FreeSIS), 截至 {latest_date}"
        return result

    manual = load_manual_korea_data()
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


def fetch_korea_leveraged_etf():
    """韩国杠杆ETF总AUM。优先从 kimpremium.com 自动抓取。"""
    result = {
        "name": "杠杆ETF去化",
        "subtitle": "韩国杠杆ETF总AUM",
        "unit": "万亿韩元",
        "data_source": "KOFIA/KRX",
        "current_value": None,
        "history": [],
        "peak_value": 68.0,
        "fair_value": 24.5,
    }

    kimpremium = _fetch_kimpremium_data()
    etf = kimpremium.get("etf", {})

    if etf:
        # 优先从 universe 汇总当前 AUM（每只 ETF 的准确数据）
        universe = etf.get("universe", [])
        if universe:
            total_aum = sum(etf_item.get("aum", 0) for etf_item in universe)
            aum = round(total_aum, 2)
            result["current_value"] = aum

            # 历史数据通过 cumFlow 反推
            etf_dates = etf.get("d", [])
            cum_flow = etf.get("cumFlow", [])

            if etf_dates and cum_flow:
                history = []
                latest_cum = cum_flow[-1] if cum_flow else 0

                for i in range(len(etf_dates) - 1, -1, -1):
                    if cum_flow[i] is not None and len(history) < 500:
                        estimated = round(aum - (latest_cum - cum_flow[i]), 2)
                        history.append({
                            "date": _format_date(etf_dates[i]),
                            "value": estimated
                        })

                history.reverse()
                result["history"] = history

            result["data_source"] = "KOFIA/KRX (kimpremium.com)"
            result["note"] = f"数据来源: kimpremium.com ETF统计, 共 {len(universe)} 只ETF, 总AUM {aum}万亿韩元"
            result["etf_count"] = len(universe)
            return result

        # 备用方案：从 kpi.aum 获取
        kpi = etf.get("kpi", {})
        aum = kpi.get("aum")

        if aum is not None:
            result["current_value"] = aum

            etf_dates = etf.get("d", [])
            cum_flow = etf.get("cumFlow", [])

            if etf_dates and cum_flow:
                history = []
                latest_cum = cum_flow[-1] if cum_flow else 0

                for i in range(len(etf_dates) - 1, -1, -1):
                    if cum_flow[i] is not None and len(history) < 500:
                        estimated = round(aum - (latest_cum - cum_flow[i]), 2)
                        history.append({
                            "date": _format_date(etf_dates[i]),
                            "value": estimated
                        })

                history.reverse()
                result["history"] = history

            result["data_source"] = "KOFIA/KRX (kimpremium.com)"
            result["note"] = f"数据来源: kimpremium.com ETF统计, 共 {kpi.get('n', '?')} 只ETF, AUM {aum}万亿韩元"
            return result

    manual = load_manual_korea_data()
    if manual.get("leveraged_etf") and manual["leveraged_etf"].get("current_value") is not None:
        m = manual["leveraged_etf"]
        result["current_value"] = m["current_value"]
        result["history"] = m.get("history", [])
        result["peak_value"] = m.get("peak_value", result["peak_value"])
        result["fair_value"] = m.get("fair_value", result["fair_value"])
        result["data_source"] = "KOFIA/KRX (手动更新)"
        result["note"] = m.get("note", "")
    else:
        result["note"] = "杠杆ETF数据需从 KOFIA/KRX 手动更新 (korea_manual.json)"
        result["error"] = "数据源待接入"

    return result


def fetch_korea_investor_deposits():
    """投资者存管金（Investor deposits）+ 证券抵押贷款（col）。
    前端需要同时拿到 存管金/融资余额/证券抵押贷款/杠杆ETF 四份数据，
    这里顺带把 col（证券抵押贷款）抓进来，存在 result.extra 里。
    """
    result = {
        "name": "散户总杠杆水位",
        "subtitle": "融资 + 证券抵押 + 杠杆ETF内嵌 ｜ 占存管金比例",
        "unit": "万亿韩元",
        "data_source": "KOFIA",
        "current_value": None,
        "history": [],
        "extra": {
            "securities_loan": None,          # 证券抵押贷款 col 当前值 (万亿韩元)
            "securities_loan_history": [],    # [{date, value}]
        },
    }

    kimpremium = _fetch_kimpremium_data()
    series = kimpremium.get("series", {})

    if series and "dep" in series:
        history, current_value, latest_date = _get_recent_series(series, "dep", 500)
        result["current_value"] = current_value
        result["history"] = history
        result["data_source"] = "KOFIA (kimpremium.com)"
        result["note"] = f"数据来源: kimpremium.com (KOFIA FreeSIS), 截至 {latest_date}"

        # col = 证券抵押贷款余额（유가증권대출금 잔고）
        if "col" in series:
            col_hist, col_val, _ = _get_recent_series(series, "col", 500)
            result["extra"]["securities_loan"] = col_val
            result["extra"]["securities_loan_history"] = col_hist

        return result

    manual = load_manual_korea_data()
    if manual.get("investor_deposits") and manual["investor_deposits"].get("current_value") is not None:
        m = manual["investor_deposits"]
        result["current_value"] = m["current_value"]
        result["history"] = m.get("history", [])
        result["data_source"] = "KOFIA (手动更新)"
        result["note"] = m.get("note", "")
    else:
        result["note"] = "存管金数据需从 KOFIA 手动更新 (korea_manual.json)"
        result["error"] = "数据源待接入"

    return result


def main():
    print(f"[{UPDATE_TIME}] 开始拉取韩国市场数据...")
    output = {
        "date": TODAY,
        "update_time": UPDATE_TIME,
        "korea": {},
    }

    # 前置 health check：检查 kimpremium 数据新鲜度
    print("  检查 kimpremium 数据新鲜度...")
    health = _check_kimpremium_health()

    # 先尝试从 kimpremium.com 拉取一次（缓存）
    print("  从 kimpremium.com 拉取数据...")
    try:
        kimpremium = _fetch_kimpremium_data()
        if kimpremium:
            series = kimpremium.get("series", {})
            etf = kimpremium.get("etf", {})
            print(f"    ✓ series.json: {len(series.get('d', []))} 个交易日")
            print(f"    ✓ etf.json: {len(etf.get('d', []))} 个交易日")
            meta_resp = requests.get(f"{KIMPREMIUM_BASE}/meta.json", timeout=15)
            if meta_resp.status_code == 200:
                meta = meta_resp.json()
                print(f"    ✓ meta.json asof: {meta.get('asof')}")
                print(f"    ✓ 生成时间: {meta.get('generated')}")
        else:
            print("    ✗ kimpremium 数据获取失败")
    except Exception as e:
        print(f"    ✗ kimpremium 抓取异常: {e}")

    korea_fetchers = {
        "vkospi": fetch_korea_vkospi,
        "kospi": fetch_korea_kospi,
        "kosdaq": fetch_korea_kosdaq,
        "margin": fetch_korea_margin,
        "liquidation": fetch_korea_liquidation,
        "liquidation_ratio": fetch_korea_liquidation_ratio,
        "leveraged_etf": fetch_korea_leveraged_etf,
        "investor_deposits": fetch_korea_investor_deposits,
    }

    for key, func in korea_fetchers.items():
        print(f"  fetching korea_{key}...")
        try:
            data = func()
            output["korea"][key] = data
            status = "OK" if data.get("current_value") is not None else "FAIL"
            print(f"    {status}: {data.get('current_value', data.get('error', '?'))} (source: {data.get('data_source', '?')})")
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