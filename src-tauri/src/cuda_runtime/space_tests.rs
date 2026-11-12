//! Opt-in verification on a disposable, capacity-limited volume; never fill the host disk.
use super::*;

fn model(p: &Pin, component: &Component) -> crate::manifest::Model {
    crate::manifest::Model {
        file: archive_name(p, component),
        estimated_bytes: component.bytes,
        sha256: component.sha256.clone(),
        kind: "cuda".into(),
    }
}

/// Allocate real blocks, leaving slightly less than the next operation needs.
fn consume_space(path: &Path, required: u64) {
    let available = fs2::available_space(path.parent().unwrap()).unwrap();
    let mut remaining = available.checked_sub(required - 1024 * 1024).unwrap();
    let mut file = fs::File::create(path).unwrap();
    let buffer = vec![0x69; 1024 * 1024];
    while remaining > 0 {
        let size = remaining.min(buffer.len() as u64) as usize;
        file.write_all(&buffer[..size]).unwrap();
        remaining -= size as u64;
    }
    file.sync_all().unwrap();
    assert!(fs2::available_space(path.parent().unwrap()).unwrap() < required);
}

fn assert_installation(root: &Path, p: &Pin) -> PathBuf {
    let active = installed(root).expect("Only a complete installation may be activated");
    for component in &p.components {
        let size: u64 = component
            .files
            .iter()
            .cloned()
            .chain(std::iter::once(format!("LICENSE-{}.txt", component.name)))
            .map(|name| fs::metadata(active.join(name)).unwrap().len())
            .sum();
        assert_eq!(size, component.installed_bytes);
    }
    active
}

#[tokio::test]
#[ignore = "requires NVIDIA downloads and MUSIC_GENERATOR_CUDA_SPACE_TEST_ROOT on a disposable volume <= 2 GiB"]
async fn pinned_installation_and_retries_on_a_small_real_volume() {
    let volume = PathBuf::from(
        std::env::var_os("MUSIC_GENERATOR_CUDA_SPACE_TEST_ROOT")
            .expect("Set MUSIC_GENERATOR_CUDA_SPACE_TEST_ROOT to a disposable mounted volume"),
    );
    assert!(fs2::total_space(&volume).unwrap() <= 2 * 1024 * 1024 * 1024);
    let root = tempfile::Builder::new()
        .prefix("CUDA Größe with spaces ")
        .tempdir_in(volume)
        .unwrap();
    let base = root.path().join("cuda");
    let cache = base.join("downloads");
    fs::create_dir_all(&cache).unwrap();
    let p = pin();
    let fresh = required_space(&cache, &p);
    let available = fs2::available_space(&cache).unwrap();
    assert!(available >= fresh);
    assert!(available < 1536 * 1024 * 1024);
    println!("Fresh preflight: required {fresh}, available {available} bytes");

    let filler = root.path().join("other-process.bin");
    consume_space(&filler, fresh);
    for _ in 0..2 {
        let error = crate::download::ensure_space(&cache, required_space(&cache, &p))
            .unwrap_err()
            .to_string();
        assert!(error.starts_with("Not enough free disk space"));
        assert!(error.contains(&cache.display().to_string()));
        assert_eq!(fs::read_dir(&cache).unwrap().count(), 0);
        println!("Unchanged low-space retry: {error}");
    }
    fs::remove_file(&filler).unwrap();
    crate::download::ensure_space(&cache, required_space(&cache, &p)).unwrap();

    let client = reqwest::Client::builder()
        .https_only(true)
        .connect_timeout(Duration::from_secs(30))
        .read_timeout(Duration::from_secs(60))
        .build()
        .unwrap();
    let cancel = CancellationToken::new();
    let mut verifier = crate::verification::ModelVerifier::open(&cache);
    let mut archives = Vec::new();
    for component in &p.components {
        let archive = crate::download::download_model(
            &client,
            &format!("{}{}", p.base_url, component.path),
            &cache,
            &model(&p, component),
            &mut verifier,
            &cancel,
            |_| {},
        )
        .await
        .unwrap();
        assert_eq!(fs::metadata(&archive).unwrap().len(), component.bytes);
        println!("Downloaded and SHA-256 verified: {}", archive.display());
        archives.push(archive);
    }

    let installed_bytes: u64 = p.components.iter().map(|c| c.installed_bytes).sum();
    let extraction = SPACE_RESERVE + installed_bytes;
    assert_eq!(required_space(&cache, &p), extraction);
    assert_eq!(installation_space(&p, &archives).unwrap(), extraction);
    publish(&base, &p, &archives, &cancel).unwrap();
    let active = assert_installation(root.path(), &p);
    println!("Fresh download and publication succeeded on the first attempt");
    // Reclaim the extracted copy so subsequent failure cases fit on the same volume.
    fs::remove_dir_all(active).unwrap();
    fs::remove_file(base.join("active.json")).unwrap();

    let partial = archives[0].with_extension("zip.part");
    fs::rename(&archives[0], &partial).unwrap();
    assert_eq!(required_space(&cache, &p), extraction);
    fs::rename(partial, &archives[0]).unwrap();

    // Valid completed archives work offline; corrupt cache must not bypass hashing.
    let saved = fs::read(&archives[0]).unwrap();
    fs::write(&archives[0], b"damaged archive").unwrap();
    for _ in 0..2 {
        let error = crate::download::download_model(
            &client,
            "https://127.0.0.1:1/unreachable",
            &cache,
            &model(&p, &p.components[0]),
            &mut verifier,
            &cancel,
            |_| {},
        )
        .await
        .unwrap_err()
        .to_string();
        assert!(error.contains("failed verification"));
    }
    fs::write(&archives[0], saved).unwrap();
    for component in &p.components {
        crate::download::download_model(
            &client,
            "https://127.0.0.1:1/unreachable",
            &cache,
            &model(&p, component),
            &mut verifier,
            &cancel,
            |_| {},
        )
        .await
        .unwrap();
    }

    fs::write(base.join("active.json"), b"\"previous\"").unwrap();
    let entries = fs::read_dir(&base).unwrap().count();
    consume_space(&filler, extraction);
    for _ in 0..2 {
        let error = publish(&base, &p, &archives, &cancel)
            .unwrap_err()
            .to_string();
        assert!(error.starts_with("Not enough free disk space"));
        assert_eq!(fs::read(base.join("active.json")).unwrap(), b"\"previous\"");
        assert_eq!(fs::read_dir(&base).unwrap().count(), entries);
        assert!(archives.iter().all(|archive| archive.is_file()));
        println!("Space lost before extraction: {error}");
    }
    fs::remove_file(filler).unwrap();
    publish(&base, &p, &archives, &cancel).unwrap();
    let active = assert_installation(root.path(), &p);
    println!(
        "Published {installed_bytes} bytes; active runtime: {}",
        active.display()
    );
}
