# -*- coding: utf-8 -*-
"""Windows Job Object — 主进程退出时自动结束子进程（网关）。"""
from __future__ import annotations

import os
import subprocess
from ctypes import byref, c_int64, c_size_t, c_ulonglong, sizeof, Structure, WinDLL
from ctypes.wintypes import DWORD, HANDLE

_JOB_HANDLES: list[HANDLE] = []

JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000
JobObjectExtendedLimitInformation = 9


class JOBOBJECT_BASIC_LIMIT_INFORMATION(Structure):
    _fields_ = [
        ("PerProcessUserTimeLimit", c_int64),
        ("PerJobUserTimeLimit", c_int64),
        ("LimitFlags", DWORD),
        ("MinimumWorkingSetSize", c_size_t),
        ("MaximumWorkingSetSize", c_size_t),
        ("ActiveProcessLimit", DWORD),
        ("Affinity", c_size_t),
        ("PriorityClass", DWORD),
        ("SchedulingClass", DWORD),
    ]


class IO_COUNTERS(Structure):
    _fields_ = [
        ("ReadOperationCount", c_ulonglong),
        ("WriteOperationCount", c_ulonglong),
        ("OtherOperationCount", c_ulonglong),
        ("ReadTransferCount", c_ulonglong),
        ("WriteTransferCount", c_ulonglong),
        ("OtherTransferCount", c_ulonglong),
    ]


class JOBOBJECT_EXTENDED_LIMIT_INFORMATION(Structure):
    _fields_ = [
        ("BasicLimitInformation", JOBOBJECT_BASIC_LIMIT_INFORMATION),
        ("IoInfo", IO_COUNTERS),
        ("ProcessMemoryLimit", c_size_t),
        ("JobMemoryLimit", c_size_t),
        ("PeakProcessMemoryUsed", c_size_t),
        ("PeakJobMemoryUsed", c_size_t),
    ]


def assign_kill_on_job_close(proc: subprocess.Popen[bytes]) -> None:
    """子进程随父进程 Job 关闭而结束（Windows）。"""
    if os.name != "nt" or proc.poll() is not None:
        return
    handle = getattr(proc, "_handle", None)
    if handle is None:
        return
    try:
        kernel32 = WinDLL("kernel32", use_last_error=True)
        job = kernel32.CreateJobObjectW(None, None)
        if not job:
            return
        info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION()
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        kernel32.SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            byref(info),
            DWORD(sizeof(info)),
        )
        if not kernel32.AssignProcessToJobObject(job, HANDLE(handle)):
            kernel32.CloseHandle(job)
            return
        _JOB_HANDLES.append(job)
    except (OSError, AttributeError, ValueError):
        return
