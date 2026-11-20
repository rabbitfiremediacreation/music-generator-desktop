use crate::{
    engine::Engine,
    error::{message, Result},
    types::Settings,
};
use std::path::Path;
use std::time::Duration;
use tokio_util::sync::CancellationToken;

/// Exercise the real startup detector inside a signed bundle without opening user data or windows.
pub fn startup_location() {
    println!(
        "{}",
        serde_json::json!({ "installation_required": crate::launch_location::installation_required() })
    );
}

// Check actual OS enforcement and inherited engine restrictions, not only the signing metadata.
pub fn run(forbidden: &Path) -> Result<()> {
    if std::fs::read(forbidden).is_ok() {
        return Err(message("App Sandbox did not deny an unselected file"));
    }
    let write = forbidden.with_extension("write-check");
    if std::fs::write(&write, b"sandbox probe").is_ok() {
        let _ = std::fs::remove_file(write);
        return Err(message(
            "App Sandbox did not deny an unselected directory write",
        ));
    }
    let root = super::data_root().join(format!("sandbox-probe-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(root.join("models"))?;
    let mut metadata = vec![0u8; 96];
    metadata[..4].copy_from_slice(b"GGUF");
    metadata[4..8].copy_from_slice(&3u32.to_le_bytes());
    metadata[16..24].copy_from_slice(&1u64.to_le_bytes());
    metadata[24..32].copy_from_slice(&20u64.to_le_bytes());
    metadata[32..52].copy_from_slice(b"general.architecture");
    metadata[52..56].copy_from_slice(&8u32.to_le_bytes());
    metadata[56..64].copy_from_slice(&10u64.to_le_bytes());
    metadata[64..74].copy_from_slice(b"acestep-lm");
    std::fs::write(root.join("models/smoke.gguf"), metadata)?;
    std::env::set_var("MUSIC_SANDBOX_DENIED_PATH", forbidden);
    std::env::set_var("GGML_BACKEND", "CPU");
    let exe = std::env::current_exe()?;
    let resources = exe.parent().unwrap().parent().unwrap().join("Resources");
    let settings = Settings {
        models_dir: root.join("models").to_string_lossy().into(),
        lm_device: "cpu".into(),
        ..Settings::default()
    };
    let result = tokio::runtime::Builder::new_current_thread().enable_all().build()?.block_on(async {
        let engine = Engine::start(&resources, &root.join("logs"), &settings, &CancellationToken::new()).await?;
        if crate::hardware::cpu_only() {
            if engine.client.synth != engine.client.lm { return Err(message("Intel CPU engine unexpectedly duplicated the language-model process")); }
        } else if engine.client.synth == engine.client.lm { return Err(message("CPU-only language model did not start a separate process")); }
        drop(engine);
        verify_exports(&resources, &root).await?;
        let title = crate::titles::probe(&resources,&CancellationToken::new()).await?;
        if !title.contains("[Desktop Sandbox] Unselected file access denied") || !title.contains("music-title=ready") { return Err(message("Title runtime sandbox enforcement was not confirmed")); }
        println!("App Sandbox: native title runtime starts; unselected file access denied.");
        verify_audiocraft(&resources).await?;
        #[cfg(target_arch = "aarch64")]
        verify_audio_cpp(&resources, &root).await?;
        #[cfg(target_arch = "aarch64")]
        verify_mimetic(&resources).await?;
        // Optional real-model acceptance; fixture must already be inside this app's container.
        if let Some(model)=std::env::var_os("MUSIC_TITLE_SMOKE_MODEL") {
            let pin=crate::titles::manifest();
            std::fs::copy(model,root.join("models").join(&pin.model.file))?;
            for (lyrics,prompt) in [("[Verse]\nWir tragen das Licht durch die Straßen der Nacht\nHaben aus Scherben ein Morgen gemacht\n[Chorus]\nUnd wenn die Sterne versinken im Meer\nBleibt uns die Hoffnung, sie trägt uns noch mehr","A tropical party with sunny beaches and cheerful reggae."),("","An instrumental journey through a rainy neon city at midnight")] {
                let input=serde_json::json!({"lyrics":lyrics,"prompt":prompt});
                let title=crate::titles::generate(&resources,&root,&root.join("models"),&input,&CancellationToken::new(),|_|{}).await?;
                println!("App Sandbox: real local title model: {title}");
            }
            if std::fs::read_dir(root.join("title-work"))?.next().is_some() { return Err(message("Title request files were not removed")); }
        }

        let log = std::fs::read_to_string(root.join("logs/ace-server.log"))?;
        if !log.contains("[Desktop Sandbox] Unselected file access denied") { return Err(message("Engine sandbox enforcement was not confirmed")); }
        println!("App Sandbox: unselected read/write denied; inherited engine read denied; container storage, loopback health and supervisor shutdown passed.");
        Ok(())
    });
    let _ = std::fs::remove_dir_all(root);
    result
}

async fn verify_audiocraft(resources: &Path) -> Result<()> {
    let executable = resources.join("engine/audiocraft/audiocraft-synth");
    if !executable.is_file() {
        return Ok(());
    }
    let mut launcher = tokio::process::Command::new(executable);
    launcher
        .arg("--self-test")
        .env("PATH", "")
        .kill_on_drop(true);
    let output = tokio::time::timeout(Duration::from_secs(60), launcher.output())
        .await
        .map_err(|_| message("AudioCraft runtime self-test timed out"))??;
    let stderr = String::from_utf8_lossy(&output.stderr);
    if !output.status.success()
        || String::from_utf8_lossy(&output.stdout).trim() != "audiocraft-synth/1"
        || !stderr.contains("[Desktop Sandbox] Unselected file access denied")
    {
        return Err(message(format!(
            "AudioCraft runtime self-test failed: {stderr}"
        )));
    }
    println!("App Sandbox: packaged AudioCraft starts with an empty PATH; unselected file access denied.");
    Ok(())
}

#[cfg(target_arch = "aarch64")]
async fn verify_audio_cpp(resources: &Path, root: &Path) -> Result<()> {
    use crate::engine::process::OwnedProcess;

    let launcher = resources.join("engine/providers/audio.cpp/audiocpp_cli");
    let log = root.join("logs/audio-cpp-probe.log");
    let mut process = OwnedProcess::spawn_with_model_folder(
        &launcher,
        &["--version".into()],
        false,
        &log,
        Some(&root.join("models")),
    )?;
    let status = tokio::time::timeout(Duration::from_secs(15), async {
        loop {
            if let Some(status) = process.status()? {
                return Ok::<_, crate::error::Error>(status);
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .map_err(|_| message("audio.cpp sandbox probe timed out"))??;
    let log = std::fs::read_to_string(log)?;
    let pin: serde_json::Value =
        serde_json::from_str(include_str!("../../../models/audio-cpp-runtime.json"))?;
    let expected = format!("audio.cpp {}", pin["version"].as_str().unwrap_or_default());
    if !status.success()
        || !log.contains("[Desktop Sandbox] Unselected file access denied")
        || !log.lines().any(|line| line == expected)
    {
        return Err(message(format!("audio.cpp sandbox probe failed: {log}")));
    }
    println!("App Sandbox: native audio.cpp launcher starts; unselected file access denied.");
    Ok(())
}

#[cfg(target_arch = "aarch64")]
async fn verify_mimetic(resources: &Path) -> Result<()> {
    let mut command = tokio::process::Command::new(resources.join("engine/mimetic-synth"));
    command.arg("--self-test").kill_on_drop(true);
    let output = tokio::time::timeout(std::time::Duration::from_secs(600), command.output())
        .await
        .map_err(|_| message("Mimetic A0 runtime test timed out"))??;
    let stderr = String::from_utf8_lossy(&output.stderr);
    if !output.status.success()
        || !stderr.contains("[Desktop Sandbox] Unselected file access denied")
    {
        return Err(message(format!(
            "Mimetic A0 sandbox probe failed: {stderr}"
        )));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let result: serde_json::Value =
        serde_json::from_str(stdout.lines().last().unwrap_or_default())?;
    if result["runtime"] != "mimetic-a0" {
        return Err(message("Mimetic A0 runtime did not complete its self-test"));
    }
    println!("App Sandbox: Mimetic A0 starts with bundled Python; unselected file access denied.");
    Ok(())
}

async fn verify_exports(resources: &Path, root: &Path) -> Result<()> {
    let db = std::sync::Arc::new(crate::db::Database::open(root)?);
    let mut settings = db.settings()?;
    settings.export_format = "mp3".into();
    db.save_settings(&settings)?;
    std::fs::create_dir_all(&settings.songs_dir)?;
    let id = db.enqueue(&crate::types::GenerateRequest {
        prompt: "export fixture".into(),
        variants: 1,
        ..Default::default()
    })?[0]
        .clone();
    db.claim_next()?;
    let mut wav = Vec::new();
    let bytes = 44100u32 * 2 * 2;
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(bytes + 36).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16u32.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&44100u32.to_le_bytes());
    wav.extend_from_slice(&88200u32.to_le_bytes());
    wav.extend_from_slice(&2u16.to_le_bytes());
    wav.extend_from_slice(&16u16.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&bytes.to_le_bytes());
    wav.resize(44 + bytes as usize, 0);
    let original = Path::new(&settings.songs_dir).join("fixture.wav");
    std::fs::write(&original, &wav)?;
    db.finish(&id, "fixture.wav", &serde_json::json!({}))?;
    let cancel = CancellationToken::new();
    let output = root.join("exported.mp3");
    crate::exports::export(
        db.clone(),
        resources.into(),
        "audio".into(),
        Some(id.clone()),
        None,
        output.clone(),
        cancel.clone(),
    )
    .await?;
    if std::fs::metadata(output)?.len() < 1000 || std::fs::read(original)? != wav {
        return Err(message(
            "Sandbox MP3 export did not preserve the original WAV",
        ));
    }
    let zip = root.join("exported.zip");
    crate::exports::export(
        db.clone(),
        resources.into(),
        "zip".into(),
        None,
        None,
        zip.clone(),
        cancel,
    )
    .await?;
    let mut archive =
        zip::ZipArchive::new(std::fs::File::open(zip)?).map_err(|e| message(e.to_string()))?;
    if archive.len() != 1
        || !archive
            .by_index(0)
            .map_err(|e| message(e.to_string()))?
            .name()
            .ends_with(".mp3")
    {
        return Err(message(
            "Sandbox ZIP did not contain the selected MP3 format",
        ));
    }
    println!("App Sandbox: supervised MP3 export and ZIP passed; original WAV preserved.");
    db.delete_song(&id)?;
    if std::fs::read_dir(root.join("export"))?.next().is_some() {
        return Err(message("Deleting a song did not remove its MP3 cache"));
    }
    Ok(())
}
