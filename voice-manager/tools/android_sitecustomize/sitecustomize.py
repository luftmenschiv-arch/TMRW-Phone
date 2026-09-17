"""Termux compatibility hook for Python packages that cannot discover libsndfile."""
import ctypes.util

_original_find_library = ctypes.util.find_library

def _tmrw_find_library(name):
    if name == 'sndfile':
        return '/data/data/com.termux/files/usr/lib/libsndfile.so'
    return _original_find_library(name)

ctypes.util.find_library = _tmrw_find_library
