use super::{recovery, *};
use ::windows::Win32::{
    Foundation::{HWND, RECT},
    UI::{
        Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO},
        WindowsAndMessaging::{
            GetClientRect, GetForegroundWindow, GetWindowRect, IsIconic, IsWindowVisible, IsZoomed,
            ShowWindow, SW_HIDE, SW_SHOW, SW_SHOWMINNOACTIVE, SW_SHOWNA,
        },
    },
};
use tokio::sync::oneshot;

/// Cycle the top-level HWND once after frontend frames, without blocking its UI pump.
/// Controller visibility, focus and resize alone did not repair issue #53.
pub(in crate::startup) async fn synchronize<R: Runtime>(
    window: &WebviewWindow<R>,
    attempt: u64,
) -> Result<()> {
    recovery::cycle(
        on_ui(window, attempt, move |hwnd, startup| {
            hide(hwnd, startup, attempt)
        }),
        |activation| {
            on_ui(window, attempt, move |hwnd, startup| {
                show(hwnd, startup, attempt, activation)
            })
        },
    )
    .await
}

fn hide(hwnd: HWND, startup: &Startup, attempt: u64) -> Result<Option<recovery::Activation>> {
    diagnose(startup, attempt, hwnd, "before_hide");
    unsafe {
        if IsIconic(hwnd).as_bool() || !IsWindowVisible(hwnd).as_bool() {
            let _ =
                startup.log_diagnostic(attempt, "Native presentation skipped: minimized or hidden");
            return Ok(None);
        }
        let was_foreground = GetForegroundWindow() == hwnd;
        let input = last_input();
        // ShowWindow returns previous visibility, not success/failure.
        let _ = ShowWindow(hwnd, SW_HIDE);
        if IsWindowVisible(hwnd).as_bool() {
            return Err(message("Native presentation failed to hide main window"));
        }
        diagnose(startup, attempt, hwnd, "hidden");
        Ok(Some(recovery::Activation {
            was_foreground,
            foreground_after_hide: GetForegroundWindow().0 as usize,
            last_input: input,
        }))
    }
}

fn show(
    hwnd: HWND,
    startup: &Startup,
    attempt: u64,
    activation: recovery::Activation,
) -> Result<()> {
    unsafe {
        let minimized = IsIconic(hwnd).as_bool();
        let activate =
            !minimized && activation.may_restore(GetForegroundWindow().0 as usize, last_input());
        let mut activation_requested = false;
        // SW_SHOWNA preserves the current normal/maximized placement. Do not
        // use SW_RESTORE or SW_SHOWNORMAL, or copy iconic client bounds to WebView2.
        if !IsWindowVisible(hwnd).as_bool() {
            activation_requested = activate;
            let command = if minimized {
                SW_SHOWMINNOACTIVE
            } else if activate {
                SW_SHOW
            } else {
                SW_SHOWNA
            };
            let _ = ShowWindow(hwnd, command);
        }
        diagnose(startup, attempt, hwnd, "shown");
        if !IsWindowVisible(hwnd).as_bool() {
            return Err(message("Native presentation failed to show main window"));
        }
        let _ = startup.log_diagnostic(
            attempt,
            &format!(
                "Native presentation completed activation_requested={activation_requested}; pixels unverified"
            ),
        );
        Ok(())
    }
}

async fn on_ui<R: Runtime, T: Send + 'static>(
    window: &WebviewWindow<R>,
    attempt: u64,
    operation: impl FnOnce(HWND, &Startup) -> Result<T> + Send + 'static,
) -> Result<T> {
    let (send, receive) = oneshot::channel();
    let owner = window.clone();
    window
        .run_on_main_thread(move || {
            let startup = owner.state::<Startup>();
            let result = startup.with_pending_presentation(attempt, || {
                let hwnd = owner.hwnd().map_err(|e| message(e.to_string()))?;
                operation(hwnd, &startup)
            });
            let _ = send.send(result);
        })
        .map_err(|e| message(format!("Unable to dispatch native presentation: {e}")))?;
    receive
        .await
        .map_err(|_| message("Native presentation callback was dropped"))?
}

fn last_input() -> Option<u32> {
    let mut input = LASTINPUTINFO {
        cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
        ..Default::default()
    };
    unsafe {
        GetLastInputInfo(&mut input)
            .as_bool()
            .then_some(input.dwTime)
    }
}

fn diagnose(startup: &Startup, attempt: u64, hwnd: HWND, stage: &str) {
    let mut outer = RECT::default();
    let mut client = RECT::default();
    unsafe {
        let outer_ok = GetWindowRect(hwnd, &mut outer).is_ok();
        let client_ok = GetClientRect(hwnd, &mut client).is_ok();
        let _ = startup.log_diagnostic(attempt, &format!(
            "Native presentation stage={stage} visible={} minimized={} maximized={} foreground={} outer_ok={outer_ok} outer={},{},{},{} client_ok={client_ok} client={}x{}",
            IsWindowVisible(hwnd).as_bool(), IsIconic(hwnd).as_bool(), IsZoomed(hwnd).as_bool(), GetForegroundWindow() == hwnd,
            outer.left, outer.top, outer.right, outer.bottom, client.right - client.left, client.bottom - client.top,
        ));
    }
}

#[cfg(test)]
mod tests;
