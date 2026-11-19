"""Load the pure-logic modules without executing the HA-dependent package __init__."""

import sys
import types
from pathlib import Path

PKG_DIR = Path(__file__).resolve().parents[1] / "custom_components" / "musikanlage"

pkg = types.ModuleType("musikanlage")
pkg.__path__ = [str(PKG_DIR)]
sys.modules.setdefault("musikanlage", pkg)
