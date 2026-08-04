#!/usr/bin/env python3
"""
VKOSPI 本地更新脚本 — 每天韩国收盘后本地运行一次。
本地 cloudscraper 能稳定绕过 CloudFlare，抓取 Investing.com 的 VKOSPI 历史数据。
抓取后更新 data/korea_manual.json，并 git push 到 GitHub。

用法:
    python3 scripts/update_vkospi_local.py

建议 crontab 配置（韩国 15:30 收盘，北京时间 15:05 运行）:
    5 15 * * 1-5 cd "/Users/doriszuo/Library/Application Support/TRAE SOLO CN/ModularData/ai-agent/work-mode-projects/6a62d72e97cfa6aa96cb12df/korea-market-signal" && /usr/bin/python3 scripts/update_vkospi_local.py >> /tmp/vkospi_update.log 2>&1
"""
import sys
import os
import json
import subprocess
from pathlib import Path

# 确保能 import fetch_data
sys.path.insert(0, str(Path(__file__).parent))
from fetch_data import _fetch_vkospi_via_investing, MANUAL_DATA_PATH, load_manual_korea_data


def main():
    print(f"=== VKOSPI 本地更新 {__import__('datetime').datetime.now()} ===")

    # 1. 抓取 VKOSPI（T+1，排除今日盘中数据）
    print("正在从 Investing.com 抓取 VKOSPI 历史数据...")
    history = _fetch_vkospi_via_investing(exclude_today=True)

    if not history:
        print("✗ 抓取失败，Investing.com 无数据或被 CloudFlare 拦截")
        sys.exit(1)

    latest = history[-1]
    print(f"✓ 抓取成功: {len(history)} 条, 最新 {latest['date']} = {latest['value']}")

    # 2. 更新 korea_manual.json
    manual = load_manual_korea_data()
    vkospi = manual.get("vkospi", {})

    # 合并：自动抓取的数据优先，manual 数据填充缺失日期
    auto_dates = {h["date"] for h in history}
    for item in vkospi.get("history", []):
        if item["date"] not in auto_dates:
            history.append(item)

    # 去重排序
    seen = {}
    for item in history:
        seen[item["date"]] = item["value"]
    merged = [{"date": d, "value": v} for d, v in sorted(seen.items())]

    # 只保留最近 500 条
    merged = merged[-500:]

    manual["vkospi"] = {
        "current_value": merged[-1]["value"],
        "history": merged,
        "note": f"本地 cloudscraper 自动更新，最新 {merged[-1]['date']}",
    }

    with open(MANUAL_DATA_PATH, "w", encoding="utf-8") as f:
        json.dump(manual, f, ensure_ascii=False, indent=2)

    print(f"✓ 已更新 {MANUAL_DATA_PATH.name}: {len(merged)} 条")

    # 3. Git commit & push（push 失败时自动 pull rebase 重试）
    repo_dir = Path(__file__).parent.parent
    try:
        subprocess.run(["git", "add", str(MANUAL_DATA_PATH)], cwd=repo_dir, check=True)
        # 检查是否有变更
        result = subprocess.run(
            ["git", "diff", "--cached", "--quiet"],
            cwd=repo_dir,
            capture_output=True,
        )
        if result.returncode == 0:
            print("• 无变更（数据未更新），跳过 push")
        else:
            subprocess.run(
                ["git", "commit", "-m", f"auto update VKOSPI via local script ({merged[-1]['date']})"],
                cwd=repo_dir,
                check=True,
            )
            # push，失败则 pull rebase 后重试一次
            push_result = subprocess.run(["git", "push"], cwd=repo_dir, capture_output=True, text=True)
            if push_result.returncode != 0:
                print("• push 被拒绝，尝试 pull rebase...")
                subprocess.run(["git", "pull", "--rebase", "origin", "main"], cwd=repo_dir, check=True)
                subprocess.run(["git", "push"], cwd=repo_dir, check=True)
            print(f"✓ 已推送到 GitHub: VKOSPI = {merged[-1]['value']} ({merged[-1]['date']})")
    except subprocess.CalledProcessError as e:
        print(f"✗ Git 操作失败: {e}")
        sys.exit(1)

    print("=== 完成 ===")


if __name__ == "__main__":
    main()
