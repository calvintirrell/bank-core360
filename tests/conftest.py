"""Test session setup: point the pipeline at a temporary data root BEFORE any pipeline module is
imported, then run the whole pipeline once. Tests never read or write the tracked lakehouse/."""

from __future__ import annotations

import atexit
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
DATA_ROOT = Path(tempfile.mkdtemp(prefix="bank-core360-tests-"))
os.environ["BANK_CORE_DATA_ROOT"] = str(DATA_ROOT)
atexit.register(shutil.rmtree, DATA_ROOT, True)


@pytest.fixture(scope="session", autouse=True)
def run_pipeline() -> Path:
    r = subprocess.run([sys.executable, "-m", "pipeline"], check=False, cwd=ROOT, capture_output=True, text=True, env=os.environ.copy())
    if r.returncode != 0:
        pytest.fail(f"pipeline failed with exit {r.returncode}:\n{r.stderr[-4000:]}", pytrace=False)
    return DATA_ROOT
