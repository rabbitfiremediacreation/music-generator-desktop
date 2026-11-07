use super::*;
use ::windows::{
    core::w,
    Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DestroyWindow, GetWindowPlacement, SW_SHOWMAXIMIZED, WINDOWPLACEMENT,
        WS_EX_NOACTIVATE, WS_OVERLAPPEDWINDOW,
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
    assert!(hide(window.0, &startup, 1).unwrap().is_none());
    for command in [SW_SHOWNA, SW_SHOWMAXIMIZED] {
        unsafe {
            let _ = ShowWindow(window.0, command);
        }
        let before = window.placement();
        let mut activation = hide(window.0, &startup, 1)
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
    assert!(hide(window.0, &startup, 1).unwrap().is_none());
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
    let activation = hide(window.0, &startup, 1).unwrap().unwrap();
    unsafe {
        let _ = ShowWindow(window.0, SW_SHOWMINNOACTIVE);
        let _ = ShowWindow(window.0, SW_HIDE);
    }
    show(window.0, &startup, 1, activation).unwrap();
    assert!(unsafe { IsIconic(window.0) }.as_bool());
    assert!(unsafe { IsWindowVisible(window.0) }.as_bool());
}
