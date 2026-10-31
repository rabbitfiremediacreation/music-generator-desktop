use super::*;
use ::windows::Win32::{
    Foundation::{HWND, RECT},
    UI::WindowsAndMessaging::{GetClientRect, SetWindowPos, SWP_NOACTIVATE, SWP_NOZORDER},
};
use tokio::sync::oneshot;

pub(super) async fn synchronize<R: Runtime>(window: &WebviewWindow<R>, attempt: u64) -> Result<()> {
    // Dispatch separately and await each callback. Do not keep COM objects across
    // threads, block the UI pump, or rely on JS/rAF to schedule the second step.
    controller_step(window, attempt, false).await?;
    controller_step(window, attempt, true).await
}

async fn controller_step<R: Runtime>(
    window: &WebviewWindow<R>,
    attempt: u64,
    visible: bool,
) -> Result<()> {
    let (send, receive) = oneshot::channel();
    let owner = window.clone();
    window
        .with_webview(move |webview| {
            let startup = owner.state::<Startup>();
            let result = startup.with_pending_presentation(attempt, || {
                let controller = webview.controller();
                // All handles and controller calls stay on the WebView UI thread.
                let native_window = owner.hwnd().map_err(|e| message(e.to_string()))?;
                let mut bounds = RECT::default();
                let mut parent = HWND::default();
                let result = unsafe {
                    (|| -> ::windows::core::Result<()> {
                        if visible {
                            GetClientRect(native_window, &mut bounds)?;
                            if bounds.right <= bounds.left || bounds.bottom <= bounds.top {
                                return Err(::windows::core::Error::from_hresult(
                                    ::windows::Win32::Foundation::E_INVALIDARG,
                                ));
                            }
                            controller.ParentWindow(&mut parent)?;
                            // Match both Wry's child container and WebView2 to the
                            // current physical client rect, including restored DPI/maximize.
                            // The outer window geometry and saved state are untouched.
                            SetWindowPos(
                                parent,
                                None,
                                0,
                                0,
                                bounds.right - bounds.left,
                                bounds.bottom - bounds.top,
                                SWP_NOACTIVATE | SWP_NOZORDER,
                            )?;
                            controller.SetBounds(bounds)?;
                        } else {
                            controller.Bounds(&mut bounds)?;
                        }
                        controller.SetIsVisible(visible)?;
                        Ok(())
                    })()
                };
                if let Err(error) = result {
                    // Do not leave the controller hidden if updating its bounds fails.
                    // The caller reports the failure and keeps the splash available.
                    unsafe {
                        let _ = controller.SetIsVisible(true);
                    }
                    return Err(message(format!("WebView2 presentation failed: {error}")));
                }
                let _ = startup.log_diagnostic(
                    attempt,
                    &format!(
                        "WebView2 presentation visible={visible} width={} height={}",
                        bounds.right - bounds.left,
                        bounds.bottom - bounds.top,
                    ),
                );
                Ok(())
            });
            let _ = send.send(result);
        })
        .map_err(|e| message(format!("Unable to dispatch WebView2 presentation: {e}")))?;
    receive
        .await
        .map_err(|_| message("WebView2 presentation callback was dropped"))?
}
