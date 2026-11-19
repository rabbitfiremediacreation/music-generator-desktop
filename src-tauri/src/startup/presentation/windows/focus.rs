use super::{recovery::Activation, HWND};
use ::windows::Win32::UI::{
    Input::KeyboardAndMouse::{GetActiveWindow, SetActiveWindow},
    WindowsAndMessaging::{GetForegroundWindow, IsIconic, IsWindowVisible, SetForegroundWindow},
};

/// Keep activation in our visible splash instead of Windows' asynchronous fallback.
/// SetActiveWindow cannot bring a background application to the foreground.
pub(super) fn handoff(splash: Option<HWND>, was_foreground: bool) -> Activation {
    let mut activation = Activation {
        was_foreground,
        temporary_foreground: 0,
    };
    if let Some(splash) = splash.filter(|_| was_foreground) {
        unsafe {
            if IsWindowVisible(splash).as_bool() && !IsIconic(splash).as_bool() {
                let _ = SetActiveWindow(splash);
                if GetActiveWindow() == splash {
                    activation.temporary_foreground = splash.0 as usize;
                }
            }
        }
    }
    activation
}

/// Use ordinary Windows activation only while our splash still owns foreground.
/// Pointer movement does not change that ownership; choosing another window does.
pub(super) fn restore(main: HWND, activation: &Activation) -> Option<bool> {
    unsafe {
        if !IsWindowVisible(main).as_bool()
            || IsIconic(main).as_bool()
            || !activation.may_restore(GetForegroundWindow().0 as usize)
        {
            return None;
        }
        let _ = SetForegroundWindow(main);
        Some(GetForegroundWindow() == main)
    }
}
