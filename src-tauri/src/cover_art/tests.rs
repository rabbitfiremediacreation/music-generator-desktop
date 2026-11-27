use super::*;
use crate::{db::Database, types::GenerateRequest};

fn saved_track(db: &Database) -> (String, PathBuf) {
    let id = db
        .enqueue(&GenerateRequest {
            title: "Violet Horizon".into(),
            prompt: "lone mountain under a violet aurora, atmospheric electronic".into(),
            seed: 42,
            ..Default::default()
        })
        .unwrap()
        .remove(0);
    db.claim_next().unwrap();
    let dir = PathBuf::from(db.settings().unwrap().songs_dir);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("saved.wav"), b"existing audio fixture").unwrap();
    db.finish(
        &id,
        "saved.wav",
        &json!({"duration": 12.0, "fixture_note": "keep", "cover_art_error": "previous failure"}),
    )
    .unwrap();
    (id, dir)
}

#[test]
fn attaching_cover_preserves_saved_song_and_refuses_to_overwrite_an_existing_image() {
    let root = tempfile::tempdir().unwrap();
    let db = Database::open(root.path()).unwrap();
    let (id, dir) = saved_track(&db);
    let artwork = |seed| Artwork {
        png: vec![seed],
        provenance: json!({ "seed": seed }),
    };
    let cancel = CancellationToken::new();
    desktop::attach(&db, &dir, &id, artwork(42), &cancel).unwrap();
    let song = db.song(&id).unwrap();
    assert_eq!(song.status, "done");
    assert_eq!(song.seed, 42);
    assert_eq!(song.title.as_deref(), Some("Violet Horizon"));
    assert_eq!(
        std::fs::read(song.audio_path().unwrap()).unwrap(),
        b"existing audio fixture"
    );
    let metadata = song.result_meta.unwrap();
    assert_eq!(metadata["cover_art"]["seed"], 42);
    assert_eq!(metadata["fixture_note"], "keep");
    assert!(metadata.get("cover_art_error").is_none());
    let path = song.cover_path.unwrap();
    assert!(desktop::attach(&db, &dir, &id, artwork(99), &cancel).is_err());
    assert_eq!(std::fs::read(path).unwrap(), [42]);
    assert_eq!(
        db.song(&id).unwrap().result_meta.unwrap()["cover_art"]["seed"],
        42
    );
}

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
    let cancel = CancellationToken::new();
    install(&data, &cancel, |_| {}).await.unwrap();
    let image = generate(
        &data,
        "Violet Horizon",
        "a lone mountain under a violet aurora, atmospheric electronic music, cobalt and magenta, painted album artwork",
        42,
        &cancel,
    ).await.unwrap();
    std::fs::write(data.join("violet-horizon.png"), &image.png).unwrap();
    println!("{}", image.provenance);
}

#[cfg(unix)]
#[tokio::test]
#[ignore = "requires an installed cover model and engine"]
async fn existing_track_gets_cover_with_automatic_generation_off() {
    use crate::state::AppState;
    let data = PathBuf::from(std::env::var_os("MUSIC_COVER_ART_QA_DATA").unwrap());
    let root = tempfile::tempdir().unwrap();
    std::os::unix::fs::symlink(data.join("cover-art"), root.path().join("cover-art")).unwrap();
    let db = Database::open(root.path()).unwrap();
    let (id, dir) = saved_track(&db);
    assert!(!db.settings().unwrap().generate_cover_art);
    let state = AppState::new(db, root.path().join("resources"));
    let app = tauri::test::mock_app();
    desktop::generate_existing(&state, app.handle(), &id)
        .await
        .unwrap();
    let song = state.db.song(&id).unwrap();
    assert_eq!(
        std::fs::read(dir.join("saved.wav")).unwrap(),
        b"existing audio fixture"
    );
    let png = std::fs::read(song.cover_path.as_ref().unwrap()).unwrap();
    validate_png(&png).unwrap();
    std::fs::write(data.join("existing-song-cover.png"), png).unwrap();
    println!("{}", song.result_meta.unwrap()["cover_art"]);
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
