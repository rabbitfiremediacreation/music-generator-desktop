use super::*;
use ::windows::{
    core::w,
    Win32::{
        Foundation::{LPARAM, LRESULT, WPARAM},
        UI::{
            Input::KeyboardAndMouse::{GetActiveWindow, SetActiveWindow},
            WindowsAndMessaging::{
                CallWindowProcW, CreateWindowExW, DestroyWindow, GetWindowLongPtrW,
                GetWindowPlacement, SetWindowLongPtrW, GWLP_USERDATA, GWLP_WNDPROC,
                SW_SHOWMAXIMIZED, WINDOWPLACEMENT, WM_WINDOWPOSCHANGED, WNDPROC, WS_EX_NOACTIVATE,
                WS_OVERLAPPEDWINDOW,
            },
        },
    },
};

struct NativeWindow(HWND);

impl NativeWindow {
    fn new() -> Self {
        Self(unsafe {
            CreateWindowExW(
                WS_EX_NOACTIVATE,
                w!("STATIC"),
                w!("Issue 53 native regression"),
                WS_OVERLAPPEDWINDOW,
                100,
                100,
                640,
                480,
                None,
                None,
                None,
                None,
            )
            .unwrap()
        })
    }

    fn placement(&self) -> WINDOWPLACEMENT {
        let mut placement = WINDOWPLACEMENT {
            length: std::mem::size_of::<WINDOWPLACEMENT>() as u32,
            ..Default::default()
        };
        unsafe {
            GetWindowPlacement(self.0, &mut placement).unwrap();
        }
        placement
    }

    // Re-enter User32 at the hide notification, as an external minimize can do.
    fn minimize_on_hide(&self) {
        unsafe {
            let previous = SetWindowLongPtrW(
                self.0,
                GWLP_WNDPROC,
                minimize_during_hide as *const () as isize,
            );
            assert_ne!(previous, 0);
            SetWindowLongPtrW(self.0, GWLP_USERDATA, previous);
        }
    }
}

unsafe extern "system" fn minimize_during_hide(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    let previous = GetWindowLongPtrW(hwnd, GWLP_USERDATA);
    let procedure: WNDPROC = std::mem::transmute(previous);
    let result = CallWindowProcW(procedure, hwnd, message, wparam, lparam);
    if message == WM_WINDOWPOSCHANGED && !IsWindowVisible(hwnd).as_bool() {
        SetWindowLongPtrW(hwnd, GWLP_WNDPROC, previous);
        let _ = ShowWindow(hwnd, SW_SHOWMINNOACTIVE);
    }
    result
}

impl Drop for NativeWindow {
    fn drop(&mut self) {
        unsafe {
            let _ = DestroyWindow(self.0);
        }
    }
}

/// Exercise real User32 placement, not WebView2/GPU painting. Each test owns its HWND.
#[test]
fn native_cycle_preserves_normal_and_maximized_placement_and_skips_minimized_windows() {
    let temporary = tempfile::tempdir().unwrap();
    let startup = Startup::new(
        temporary.path().into(),
        temporary.path().into(),
        std::time::Instant::now(),
    );
    let window = NativeWindow::new();
    assert!(hide(window.0, None, &startup, 1).unwrap().is_none());
    for command in [SW_SHOWNA, SW_SHOWMAXIMIZED] {
        unsafe {
            let _ = ShowWindow(window.0, command);
        }
        let before = window.placement();
        let mut activation = hide(window.0, None, &startup, 1)
            .unwrap()
            .expect("visible HWND must be cycled");
        assert!(!unsafe { IsWindowVisible(window.0) }.as_bool());
        activation.was_foreground = false;
        show(window.0, &startup, 1, activation).unwrap();
        let after = window.placement();
        assert_eq!(before.showCmd, after.showCmd);
        assert_eq!(before.rcNormalPosition, after.rcNormalPosition);
        assert!(unsafe { IsWindowVisible(window.0) }.as_bool());
    }
    unsafe {
        let _ = ShowWindow(window.0, SW_SHOWMINNOACTIVE);
    }
    let before = window.placement();
    assert!(hide(window.0, None, &startup, 1).unwrap().is_none());
    assert!(unsafe { IsIconic(window.0) }.as_bool());
    assert!(unsafe { IsWindowVisible(window.0) }.as_bool());
    assert_eq!(before.showCmd, window.placement().showCmd);
    assert_eq!(before.rcNormalPosition, window.placement().rcNormalPosition);
}

#[test]
fn minimization_during_the_hidden_interval_is_preserved() {
    let temporary = tempfile::tempdir().unwrap();
    let startup = Startup::new(
        temporary.path().into(),
        temporary.path().into(),
        std::time::Instant::now(),
    );
    let window = NativeWindow::new();
    unsafe {
        let _ = ShowWindow(window.0, SW_SHOWNA);
    }
    let activation = hide(window.0, None, &startup, 1).unwrap().unwrap();
    unsafe {
        let _ = ShowWindow(window.0, SW_SHOWMINNOACTIVE);
        let _ = ShowWindow(window.0, SW_HIDE);
    }
    show(window.0, &startup, 1, activation).unwrap();
    assert!(unsafe { IsIconic(window.0) }.as_bool());
    assert!(unsafe { IsWindowVisible(window.0) }.as_bool());
}

#[test]
fn minimization_while_hiding_is_skipped_without_a_startup_error() {
    let temporary = tempfile::tempdir().unwrap();
    let startup = Startup::new(
        temporary.path().into(),
        temporary.path().into(),
        std::time::Instant::now(),
    );
    let window = NativeWindow::new();
    unsafe {
        let _ = ShowWindow(window.0, SW_SHOWNA);
    }
    let normal = window.placement().rcNormalPosition;
    window.minimize_on_hide();
    let result = hide(window.0, None, &startup, 1);
    assert!(
        unsafe { IsIconic(window.0) }.as_bool(),
        "the hide callback must exercise the race"
    );
    assert!(result.unwrap().is_none(), "minimization must skip recovery");
    assert!(unsafe { IsWindowVisible(window.0) }.as_bool());
    assert_eq!(normal, window.placement().rcNormalPosition);
}

#[test]
fn foreground_handoff_uses_the_splash_and_leaves_background_activation_unchanged() {
    let main = NativeWindow::new();
    let splash = NativeWindow::new();
    unsafe {
        let _ = ShowWindow(main.0, SW_SHOWNA);
        let _ = ShowWindow(splash.0, SW_SHOWNA);
        let _ = SetActiveWindow(main.0);
        assert_eq!(GetActiveWindow(), main.0);
    }
    let background = focus::handoff(Some(splash.0), false);
    assert_eq!(unsafe { GetActiveWindow() }, main.0);
    assert!(!background.may_restore(splash.0 .0 as usize));

    let foreground = focus::handoff(Some(splash.0), true);
    assert_eq!(unsafe { GetActiveWindow() }, splash.0);
    assert!(foreground.may_restore(splash.0 .0 as usize));
    assert!(!foreground.may_restore(main.0 .0 as usize));
}
