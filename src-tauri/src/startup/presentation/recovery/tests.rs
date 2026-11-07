use super::*;
use crate::error::message;
use std::cell::Cell;

#[tokio::test(start_paused = true)]
async fn hide_and_show_are_separated_by_a_bounded_nonblocking_interval() {
    let hidden_at = Cell::new(None);
    let shown = Cell::new(0);
    let recovering = cycle(
        async {
            hidden_at.set(Some(tokio::time::Instant::now()));
            Ok(Some(()))
        },
        |()| async {
            assert_eq!(hidden_at.get().unwrap().elapsed(), HIDDEN_INTERVAL);
            shown.set(shown.get() + 1);
            Ok(())
        },
    );
    tokio::pin!(recovering);
    tokio::select! {
        _ = &mut recovering => panic!("restored before the compositor interval"),
        _ = tokio::time::sleep(Duration::from_millis(400)) => {},
    }
    assert!(hidden_at.get().is_some());
    assert_eq!(shown.get(), 0);
    recovering.await.unwrap();
    assert_eq!(shown.get(), 1);
}

#[tokio::test(start_paused = true)]
async fn skipped_native_work_neither_waits_nor_shows_the_window() {
    let started = tokio::time::Instant::now();
    cycle(async { Ok(None::<()>) }, |()| async {
        panic!("a skipped/minimized window must not be shown")
    })
    .await
    .unwrap();
    assert_eq!(started.elapsed(), Duration::ZERO);
}

#[tokio::test(start_paused = true)]
async fn native_failures_propagate_without_another_cycle() {
    let error = cycle(
        async { Err::<Option<()>, _>(message("hide failed")) },
        |()| async { panic!("show after a failed hide") },
    )
    .await
    .unwrap_err();
    assert_eq!(error.to_string(), "hide failed");
    let calls = Cell::new(0);
    let error = cycle(async { Ok(Some(())) }, |()| async {
        calls.set(calls.get() + 1);
        Err(message("show failed"))
    })
    .await
    .unwrap_err();
    assert_eq!(error.to_string(), "show failed");
    assert_eq!(calls.get(), 1);
}

#[test]
fn activation_restores_only_the_foreground_lost_by_our_hide() {
    let mut activation = Activation {
        was_foreground: true,
        foreground_after_hide: 17,
        last_input: Some(42),
    };
    assert!(activation.may_restore(17, Some(42)));
    assert!(
        !activation.may_restore(18, Some(42)),
        "another window took foreground"
    );
    assert!(
        !activation.may_restore(17, Some(43)),
        "user input during the hidden interval"
    );
    assert!(
        !activation.may_restore(17, None),
        "unknown input state must not activate"
    );
    activation.was_foreground = false;
    assert!(
        !activation.may_restore(17, Some(42)),
        "background starts stay in the background"
    );
    activation.was_foreground = true;
    activation.last_input = None;
    assert!(!activation.may_restore(17, None));
}
