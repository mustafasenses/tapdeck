"""Built-in display brightness."""

import ctypes

from .frameworks import CG_PATH, DS_PATH


class Brightness:
    """Built-in display brightness via DisplayServices (no permission needed)."""

    def __init__(self):
        try:
            self.cg = ctypes.CDLL(CG_PATH)
            self.ds = ctypes.CDLL(DS_PATH)
        except OSError:
            self.ds = None
            return
        u32 = ctypes.c_uint32
        self.cg.CGMainDisplayID.restype = u32
        self.cg.CGGetOnlineDisplayList.argtypes = [u32, ctypes.POINTER(u32), ctypes.POINTER(u32)]
        self.cg.CGDisplayIsBuiltin.argtypes = [u32]
        self.ds.DisplayServicesGetBrightness.argtypes = [u32, ctypes.POINTER(ctypes.c_float)]
        self.ds.DisplayServicesSetBrightness.argtypes = [u32, ctypes.c_float]

    def _display(self):
        ids = (ctypes.c_uint32 * 16)()
        count = ctypes.c_uint32()
        self.cg.CGGetOnlineDisplayList(16, ids, ctypes.byref(count))
        for i in range(count.value):
            if self.cg.CGDisplayIsBuiltin(ids[i]):
                return ids[i]
        return self.cg.CGMainDisplayID()

    def get(self):
        if not self.ds:
            return None
        value = ctypes.c_float()
        if self.ds.DisplayServicesGetBrightness(self._display(), ctypes.byref(value)) != 0:
            return None
        return round(value.value * 100)

    def set(self, percent):
        if not self.ds:
            return False
        level = max(0.0, min(1.0, percent / 100.0))
        return self.ds.DisplayServicesSetBrightness(self._display(), level) == 0
