use super::*;

#[test]
fn validates_the_complete_square_png_before_publication() {
    fn png(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = Vec::new();
        let mut encoder = png::Encoder::new(&mut bytes, width, height);
        encoder.set_color(png::ColorType::Rgb);
        let mut writer = encoder.write_header().unwrap();
        writer
            .write_image_data(&vec![0; (width * height * 3) as usize])
            .unwrap();
        writer.finish().unwrap();
        bytes
    }
    let cover = png(512, 512);
    assert!(validate_png(&cover).is_ok());
    assert!(validate_png(&cover[..cover.len() - 12]).is_err());
    assert!(validate_png(&png(512, 256)).is_err());
}

#[tokio::test]
#[ignore = "downloads about 1 GB and requires a supported cover art runtime"]
async fn pinned_engine_generates_a_real_cover() {
    let data = PathBuf::from(
        std::env::var_os("MUSIC_COVER_ART_QA_DATA").expect("isolated cover art fixture folder"),
    );
    let image = generate(
        &data,
        "Violet Horizon",
        "a lone mountain under a violet aurora, atmospheric electronic music, cobalt and magenta, painted album artwork",
        42,
        &CancellationToken::new(),
        |progress| println!("{}", progress.phase),
        |_| {},
    ).await.unwrap();
    std::fs::write(data.join("violet-horizon.png"), &image.png).unwrap();
    println!("{}", image.provenance);
}

#[cfg(target_os = "macos")]
#[tokio::test]
#[ignore = "requires local ACE-Step weights, runtime and a warm cover-art cache"]
async fn worker_saves_audio_and_its_cover() {
    use crate::{
        db::Database,
        state::AppState,
        types::{GenerateRequest, Settings},
    };
    use std::{sync::Arc, time::Duration};

    let path =
        |key| PathBuf::from(std::env::var_os(key).unwrap_or_else(|| panic!("Missing {key}")));
    let data = path("MUSIC_COVER_ART_QA_DATA");
    let root = tempfile::tempdir().unwrap();
    std::os::unix::fs::symlink(data.join("cover-art"), root.path().join("cover-art")).unwrap();
    let db = Database::open(root.path()).unwrap();
    db.save_settings(&Settings {
        models_dir: path("MUSIC_COVER_ART_QA_MUSIC_MODELS")
            .to_string_lossy()
            .into(),
        lm_model: crate::manifest::lm_file("4B"),
        synthesis_model: "acestep-v15-sft-Q8_0.gguf".into(),
        generate_cover_art: true,
        setup_complete: true,
        ..Default::default()
    })
    .unwrap();
    let id = db
        .enqueue(&GenerateRequest {
            title: "Violet Horizon".into(),
            prompt: "atmospheric electronic music, a lone mountain under a violet aurora".into(),
            duration: 12.0,
            inference_steps: 12,
            seed: 42,
            ..Default::default()
        })
        .unwrap()
        .remove(0);
    let state = Arc::new(AppState::new(db, path("MUSIC_COVER_ART_QA_RESOURCES")));
    state.restore_setup().unwrap();
    let app = tauri::test::mock_app();
    let worker = tokio::spawn(crate::jobs::worker(state.clone(), app.handle().clone()));
    let song = tokio::time::timeout(Duration::from_secs(240), async {
        loop {
            let song = state.db.song(&id).unwrap();
            if !matches!(song.status.as_str(), "queued" | "running") {
                break song;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    })
    .await
    .expect("Song generation timed out");
    state.runtime.shutdown();
    worker.await.unwrap();
    assert_eq!(song.status, "done", "{:?}", song.message);
    assert!(std::fs::metadata(song.audio_path().unwrap()).unwrap().len() > 44);
    let image = std::fs::read(
        song.cover_path
            .as_ref()
            .unwrap_or_else(|| panic!("{:?}", song.result_meta)),
    )
    .unwrap();
    validate_png(&image).unwrap();
    std::fs::write(data.join("worker-cover.png"), image).unwrap();
    std::fs::write(
        data.join("worker-song.json"),
        serde_json::to_vec(&song).unwrap(),
    )
    .unwrap();
}
