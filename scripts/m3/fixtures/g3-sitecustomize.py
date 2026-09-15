"""Test-image only: preserve the legacy root monitor's bridge executable path.
Project environment gets no PYTHONPATH and project UID never changes this value.
"""
import os
import sys
if os.geteuid() == 0:
    sys.executable = '/usr/local/bin/python3'
