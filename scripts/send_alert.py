"""
A股拐点信号追踪 - Server酱微信告警
每日汇总日报，变红维度特别标识，推送到微信
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
}


def load_signals():
    with open(DATA_DIR / "signals.json", "r", encoding="utf-8") as f:
        return json.load(f)


def build_report(signals):
    date = signals["date"]
    red = signals["red_count"]
    green = signals["green_count"]
    yellow = signals["yellow_count"]
    gray = signals["gray_count"]

    title = f"A股拐点信号日报 {date}"
    if red > 0 and green == 0:
        title += f" | {red}项顶部预警"
    elif green > 0 and red == 0:
        title += f" | {green}项底部信号"
    elif red > 0 and green > 0:
        title += f" | {red}红{green}绿"

    lines = [f"# A股拐点信号日报\n\n**{date}** 收盘更新\n"]
    lines.append(f"## 总览\n\n🔴 顶部预警 **{red}** ｜ 🟡 中性 **{yellow}** ｜ 🟢 底部信号 **{green}** ｜ ⚪ 数据缺失 **{gray}**\n")

    if red > 0:
        lines.append("\n## ⚠️ 顶部预警维度\n")
        for key, sig in signals["signals"].items():
            if sig["status"] == "red":
                val = sig.get("current_value", "—")
                unit = sig.get("unit", "")
                lines.append(f"- **{sig['name']}**：{val}{unit} — {sig['note']}\n")

    if green > 0:
        lines.append("\n## 🎯 底部信号维度\n")
        for key, sig in signals["signals"].items():
            if sig["status"] == "green":
                val = sig.get("current_value", "—")
                unit = sig.get("unit", "")
                lines.append(f"- **{sig['name']}**：{val}{unit} — {sig['note']}\n")

    lines.append("\n## 全部维度状态\n")
    for key, sig in signals["signals"].items():
        icon = STATUS_ICONS.get(sig["status"], "⚪")
        val = sig.get("current_value", "—")
        unit = sig.get("unit", "")
        if val == "—" or val is None:
            val_str = "—"
        else:
            val_str = f"{val}{unit}"
        lines.append(f"- {icon} **{sig['name']}**：{val_str}（{sig['label']}）\n")

    lines.append(f"\n---\n\n*更新时间: {signals['update_time']}*\n*数据来源: akshare + yfinance*\n*每日17:30 GitHub Actions自动生成*")

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
    signals = load_signals()
    title, content = build_report(signals)
    print(f"[告警] 标题: {title}")
    print(f"[告警] 内容预览:\n{content[:500]}...")

    sendkey = os.environ.get("SERVERCHAN_SENDKEY", "")
    send_serverchan(title, content, sendkey)


if __name__ == "__main__":
    main()
