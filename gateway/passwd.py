# -*- coding: utf-8 -*-
"""设置/更新站点访问口令（哈希存 config.json，不落明文）。

用法（在项目根目录、虚拟环境下）：
    python -m gateway.passwd             # 自动生成强口令，并打印一次
    python -m gateway.passwd 你的口令     # 用指定口令（至少 8 位）

改完口令需要重启网关（restart_desktop.bat）才生效。
忘记口令时重跑本命令即可重设。
"""
import sys

from .auth import generate_password, make_site_auth
from .config import CONFIG_PATH, load_config, save_config


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    if args:
        pw = args[0]
        if len(pw) < 8:
            print("口令至少 8 位。")
            return 1
        auto = False
    else:
        pw = generate_password()
        auto = True

    cfg = load_config()
    cfg["site_auth"] = make_site_auth(pw)
    save_config(cfg)

    print(f"已写入 {CONFIG_PATH}")
    if auto:
        print("")
        print("======================================")
        print(f"  你的站点访问口令： {pw}")
        print("======================================")
        print("（仅显示这一次，请记好；忘记可重跑本命令重设）")
    else:
        print("站点口令已更新（不回显明文）。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
