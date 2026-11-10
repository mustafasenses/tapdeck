"""Synthesized key presses: media keys, shortcuts and typed text."""

import ctypes
import struct
import time

from .frameworks import APPKIT_PATH, AX_PATH, CF_PATH, CG_PATH


# Browser KeyboardEvent.code -> macOS virtual keycode (physical key positions,
# so shortcuts work the same on any keyboard layout).
KEYCODES = {
    "KeyA": 0, "KeyS": 1, "KeyD": 2, "KeyF": 3, "KeyH": 4, "KeyG": 5, "KeyZ": 6,
    "KeyX": 7, "KeyC": 8, "KeyV": 9, "IntlBackslash": 10, "KeyB": 11, "KeyQ": 12,
    "KeyW": 13, "KeyE": 14, "KeyR": 15, "KeyY": 16, "KeyT": 17, "Digit1": 18,
    "Digit2": 19, "Digit3": 20, "Digit4": 21, "Digit6": 22, "Digit5": 23,
    "Equal": 24, "Digit9": 25, "Digit7": 26, "Minus": 27, "Digit8": 28,
    "Digit0": 29, "BracketRight": 30, "KeyO": 31, "KeyU": 32, "BracketLeft": 33,
    "KeyI": 34, "KeyP": 35, "Enter": 36, "KeyL": 37, "KeyJ": 38, "Quote": 39,
    "KeyK": 40, "Semicolon": 41, "Backslash": 42, "Comma": 43, "Slash": 44,
    "KeyN": 45, "KeyM": 46, "Period": 47, "Tab": 48, "Space": 49, "Backquote": 50,
    "Backspace": 51, "Escape": 53, "F17": 64, "NumpadDecimal": 65,
    "NumpadMultiply": 67, "NumpadAdd": 69, "NumpadDivide": 75, "NumpadEnter": 76,
    "NumpadSubtract": 78, "F18": 79, "F19": 80, "NumpadEqual": 81, "Numpad0": 82,
    "Numpad1": 83, "Numpad2": 84, "Numpad3": 85, "Numpad4": 86, "Numpad5": 87,
    "Numpad6": 88, "Numpad7": 89, "Numpad8": 91, "Numpad9": 92, "F20": 90,
    "F5": 96, "F6": 97, "F7": 98, "F3": 99, "F8": 100, "F9": 101, "F11": 103,
    "F13": 105, "F16": 106, "F14": 107, "F10": 109, "F12": 111, "F15": 113,
    "Home": 115, "PageUp": 116, "Delete": 117, "F4": 118, "End": 119, "F2": 120,
    "PageDown": 121, "F1": 122, "ArrowLeft": 123, "ArrowRight": 124,
    "ArrowDown": 125, "ArrowUp": 126,
}

MODIFIERS = {"cmd": 1 << 20, "shift": 1 << 17, "alt": 1 << 19, "ctrl": 1 << 18}


class NSPoint(ctypes.Structure):
    _fields_ = [("x", ctypes.c_double), ("y", ctypes.c_double)]


class Keyboard:
    """Synthesizes media keys, keyboard shortcuts and typed text.

    Posting key events requires the Accessibility permission for the app that
    runs this server (e.g. Terminal).
    """

    PLAY, NEXT, PREVIOUS = 16, 17, 18  # NX_KEYTYPE_*
    RETURN = 36

    def __init__(self):
        try:
            self.objc = ctypes.CDLL("/usr/lib/libobjc.A.dylib")
            ctypes.CDLL(APPKIT_PATH)  # registers NSEvent
            self.cg = ctypes.CDLL(CG_PATH)
            self.cf = ctypes.CDLL(CF_PATH)
            self.ax = ctypes.CDLL(AX_PATH)
        except OSError:
            self.objc = None
            return
        vp = ctypes.c_void_p
        self.objc.objc_getClass.restype = vp
        self.objc.objc_getClass.argtypes = [ctypes.c_char_p]
        self.objc.sel_registerName.restype = vp
        self.objc.sel_registerName.argtypes = [ctypes.c_char_p]
        self.objc.objc_autoreleasePoolPush.restype = vp
        self.objc.objc_autoreleasePoolPop.argtypes = [vp]
        self.cg.CGEventPost.argtypes = [ctypes.c_uint32, vp]
        self.cg.CGEventCreateKeyboardEvent.restype = vp
        self.cg.CGEventCreateKeyboardEvent.argtypes = [vp, ctypes.c_uint16, ctypes.c_bool]
        self.cg.CGEventSetFlags.argtypes = [vp, ctypes.c_uint64]
        self.cg.CGEventKeyboardSetUnicodeString.argtypes = [
            vp, ctypes.c_ulong, ctypes.POINTER(ctypes.c_uint16)]
        self.cf.CFRelease.argtypes = [vp]
        self.ax.AXIsProcessTrusted.restype = ctypes.c_bool
        self.ax.AXIsProcessTrustedWithOptions.restype = ctypes.c_bool
        self.ax.AXIsProcessTrustedWithOptions.argtypes = [vp]

        send = ctypes.cast(self.objc.objc_msgSend, vp).value
        # +[NSEvent otherEventWithType:location:modifierFlags:timestamp:
        #   windowNumber:context:subtype:data1:data2:]
        self._other_event = ctypes.CFUNCTYPE(
            vp, vp, vp, ctypes.c_ulong, NSPoint, ctypes.c_ulong, ctypes.c_double,
            ctypes.c_long, vp, ctypes.c_short, ctypes.c_long, ctypes.c_long)(send)
        self._get_ptr = ctypes.CFUNCTYPE(vp, vp, vp)(send)
        self.ns_event = self.objc.objc_getClass(b"NSEvent")
        self.sel_other = self.objc.sel_registerName(
            b"otherEventWithType:location:modifierFlags:timestamp:"
            b"windowNumber:context:subtype:data1:data2:")
        self.sel_cgevent = self.objc.sel_registerName(b"CGEvent")

    def trusted(self):
        return bool(self.objc) and self.ax.AXIsProcessTrusted()

    def request_access(self):
        """Shows the system 'allow Accessibility' prompt if not yet trusted."""
        if not self.objc or self.trusted():
            return
        vp = ctypes.c_void_p
        self.cf.CFDictionaryCreate.restype = vp
        self.cf.CFDictionaryCreate.argtypes = [
            vp, ctypes.POINTER(vp), ctypes.POINTER(vp), ctypes.c_long, vp, vp]
        key = vp.in_dll(self.ax, "kAXTrustedCheckOptionPrompt").value
        true = vp.in_dll(self.cf, "kCFBooleanTrue").value
        key_cb = ctypes.addressof(ctypes.c_char.in_dll(self.cf, "kCFTypeDictionaryKeyCallBacks"))
        val_cb = ctypes.addressof(ctypes.c_char.in_dll(self.cf, "kCFTypeDictionaryValueCallBacks"))
        options = self.cf.CFDictionaryCreate(
            None, (vp * 1)(key), (vp * 1)(true), 1, key_cb, val_cb)
        self.ax.AXIsProcessTrustedWithOptions(options)

    def media(self, key):
        if not self.trusted():
            return False
        pool = self.objc.objc_autoreleasePoolPush()
        try:
            for down in (True, False):
                flags = 0xA00 if down else 0xB00
                data1 = (key << 16) | ((0xA if down else 0xB) << 8)
                event = self._other_event(
                    self.ns_event, self.sel_other, 14, NSPoint(0, 0), flags, 0.0,
                    0, None, 8, data1, -1)  # 14 = NSEventTypeSystemDefined
                if not event:
                    return False
                self.cg.CGEventPost(0, self._get_ptr(event, self.sel_cgevent))
        finally:
            self.objc.objc_autoreleasePoolPop(pool)
        return True

    def _post_key(self, keycode, flags, unicode=None):
        for down in (True, False):
            event = self.cg.CGEventCreateKeyboardEvent(None, keycode, down)
            if not event:
                return False
            self.cg.CGEventSetFlags(event, flags)
            if unicode:
                self.cg.CGEventKeyboardSetUnicodeString(
                    event, len(unicode), (ctypes.c_uint16 * len(unicode))(*unicode))
            self.cg.CGEventPost(0, event)
            self.cf.CFRelease(event)
        return True

    def shortcut(self, keycode, flags):
        return self.trusted() and self._post_key(keycode, flags)

    def type_text(self, text):
        """Types text into the focused app (any language, emoji included)."""
        if not self.trusted():
            return False
        for i, line in enumerate(text.split("\n")):
            if i:
                self._post_key(self.RETURN, 0)
            raw = line.encode("utf-16-le")
            units = struct.unpack("<%dH" % (len(raw) // 2), raw)
            for start in range(0, len(units), 20):  # events carry at most 20 units
                self._post_key(0, 0, units[start:start + 20])
                time.sleep(0.008)
        return True
