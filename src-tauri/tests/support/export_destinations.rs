use crate::{
    export_cases::run,
    export_fixture::{temporary_directories, Fixture},
};
use music_generator::{db::Database, exports::export, types::GenerateRequest};
use std::{io::Read, path::PathBuf, sync::Arc};
use tokio_util::sync::CancellationToken;

fn library(fixture: &Fixture) -> (Arc<Database>, String, PathBuf) {
    let db = Arc::new(Database::open(fixture.root.path()).unwrap());
    let id = db
        .enqueue(&GenerateRequest {
            prompt: "controlled export fixture".into(),
            title: "Fixture Song".into(),
            variants: 1,
            ..Default::default()
        })
        .unwrap()[0]
        .clone();
    db.claim_next().unwrap();
    let mut settings = db.settings().unwrap();
    let songs = PathBuf::from(&settings.songs_dir);
    std::fs::create_dir_all(&songs).unwrap();
    let source = songs.join("original.wav");
    std::fs::copy(&fixture.source, &source).unwrap();
    db.finish(&id, "original.wav", &serde_json::json!({}))
        .unwrap();
    settings.export_format = "mp3".into();
    db.save_settings(&settings).unwrap();
    (db, id, source)
}

pub fn audio_and_zip_exports_preserve_destinations_originals_and_cache() {
    run(async {
        let fixture = Fixture::new("success");
        let (db, id, source) = library(&fixture);
        let original = std::fs::read(&source).unwrap();
        let audio = fixture.root.path().join("selected.mp3");
        std::fs::write(&audio, b"previous audio export").unwrap();
        export(
            db.clone(),
            fixture.resources.clone(),
            "audio".into(),
            Some(id),
            None,
            audio.clone(),
            CancellationToken::new(),
        )
        .await
        .unwrap();
        assert_eq!(std::fs::read(&audio).unwrap(), vec![b'M'; 2048]);
        let cache: Vec<_> = std::fs::read_dir(fixture.root.path().join("export"))
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .filter(|path| path.extension().is_some_and(|ext| ext == "mp3"))
            .collect();
        assert_eq!(cache.len(), 1);
        let zip = fixture.root.path().join("selected.zip");
        std::fs::write(&zip, b"previous ZIP export").unwrap();
        export(
            db,
            fixture.resources.clone(),
            "zip".into(),
            None,
            None,
            zip.clone(),
            CancellationToken::new(),
        )
        .await
        .unwrap();
        let mut archive = zip::ZipArchive::new(std::fs::File::open(zip).unwrap()).unwrap();
        assert_eq!(archive.len(), 1);
        let mut entry = archive.by_index(0).unwrap();
        assert!(entry.name().ends_with(".mp3"));
        let mut bytes = Vec::new();
        entry.read_to_end(&mut bytes).unwrap();
        assert_eq!(bytes, vec![b'M'; 2048]);
        assert_eq!(std::fs::read(audio).unwrap(), bytes);
        assert_eq!(std::fs::read(&cache[0]).unwrap(), bytes);
        assert_eq!(std::fs::read(source).unwrap(), original);
        assert!(temporary_directories(fixture.root.path()).is_empty());
    });
}

pub fn conversion_failure_preserves_existing_audio_and_zip_exports() {
    run(async {
        let fixture = Fixture::new("fail");
        let (db, id, source) = library(&fixture);
        let original = std::fs::read(&source).unwrap();
        for kind in ["audio", "zip"] {
            let destination = fixture.root.path().join(format!("selected-{kind}"));
            std::fs::write(&destination, b"keep finished export").unwrap();
            let error = export(
                db.clone(),
                fixture.resources.clone(),
                kind.into(),
                Some(id.clone()),
                None,
                destination.clone(),
                CancellationToken::new(),
            )
            .await
            .unwrap_err();
            assert_eq!(error.to_string(), "mp3_failed");
            assert_eq!(std::fs::read(destination).unwrap(), b"keep finished export");
            assert_eq!(std::fs::read(&source).unwrap(), original);
            assert!(temporary_directories(fixture.root.path()).is_empty());
        }
    });
}
