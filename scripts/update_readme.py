# -*- coding: utf-8 -*-
"""
自动同步 README.md 中可从代码推导的内容（目前：依赖清单 ← requirements.txt）。

用法：  python scripts/update_readme.py
行为：  只更新「## 依赖」小节，其余内容原样保留；
        内容无变化时不做任何写入（避免噪音提交）；
        新依赖自动追加（有已知描述则附带说明）。
"""
import os
import re

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
README_PATH = os.path.join(BASE_DIR, "README.md")
REQ_PATH = os.path.join(BASE_DIR, "requirements.txt")

# 已知依赖的补充说明（新依赖没有说明也会正常展示，只是无描述）
DESC = {
    "openctp-ctp": "标准 CTP API 的 Python 直译封装，自带官方 DLL（行情 + 交易）",
    "aiohttp": "异步 Web 框架：静态前端 + WebSocket 实时推送",
    "akshare": "历史 K 线数据源（新浪期货分钟/日线，供图表回显）",
    "pywebview": "桌面版原生窗口（WebView2），嵌入现有 web/ 界面",
}


def load_deps():
    """从 requirements.txt 读取直接依赖（跳过注释与空行）。"""
    deps = []
    with open(REQ_PATH, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#"):
                deps.append(line)
    return deps


def build_deps_section(deps):
    """生成「## 依赖」小节文本。"""
    lines = [
        "## 依赖",
        "",
        "> 本节由 `scripts/update_readme.py` 自动生成，请勿手改；真相源为 `requirements.txt`。",
        "",
    ]
    for d in deps:
        name = re.split(r"[<>=!~\[\]]", d)[0].strip()
        desc = DESC.get(name)
        lines.append(f"- `{d}`" + (f" — {desc}" if desc else ""))
    return "\n".join(lines) + "\n"


def replace_section(text, heading, new_block):
    """把 ## heading 开头的整节替换为 new_block；没有该节则追加到文末。"""
    pattern = re.compile(rf"^## {re.escape(heading)}\b.*$", re.MULTILINE)
    m = pattern.search(text)
    if not m:
        return text.rstrip() + "\n\n" + new_block
    start = m.start()
    nxt = re.search(r"^## ", text[m.end():], re.MULTILINE)
    end = m.end() + nxt.start() if nxt else len(text)
    return text[:start] + new_block + text[end:]


def main():
    if not os.path.exists(REQ_PATH):
        print("[skip] requirements.txt not found")
        return
    with open(README_PATH, encoding="utf-8") as f:
        text = f.read()
    deps = load_deps()
    new_text = replace_section(text, "依赖", build_deps_section(deps))
    if new_text == text:
        print("[ok] README 依赖小节已是最新，无需改动")
        return
    with open(README_PATH, "w", encoding="utf-8") as f:
        f.write(new_text)
    print("[updated] README 依赖小节已同步（%d 个依赖）" % len(deps))


if __name__ == "__main__":
    main()
