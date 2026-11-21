use crate::{
    catalog,
    engine::{mimetic, text2midi},
    error::{message, Result},
    types::{GenerateRequest, Settings},
};
use std::path::Path;
use tokio_util::sync::CancellationToken;

/// Exercise both production adapters from the shared engine archive with local weights.
pub(super) async fn verify(bundled: &Path, data: &Path, models: &Path) -> Result<()> {
    let catalog = catalog::catalog();
    let profile = |provider: &str| {
        catalog
            .profiles
            .iter()
            .find(|item| item.selection.provider == provider)
            .ok_or_else(|| message(format!("Missing PyTorch smoke-test profile {provider}")))
    };
    let audio = profile("mimetic-a0")?;
    let midi = profile("text2midi")?;
    let resources = audio.runtime.resources(bundled, data);
    if resources == bundled || resources != midi.runtime.resources(bundled, data) {
        return Err(message(
            "Both models must resolve to the same installed PyTorch package",
        ));
    }
    let settings = Settings {
        models_dir: models.to_string_lossy().into(),
        ..Settings::default()
    };
    let cancel = CancellationToken::new();
    let clip = "House drum loop, dance kit, open hi-hats";
    let params = serde_json::to_value(GenerateRequest {
        prompt: clip.into(),
        caption: clip.into(),
        bars: Some(1),
        bpm: 120,
        duration: 2.0,
        seed: 42,
        ..GenerateRequest::default()
    })?;
    let (wav, _, facts) =
        mimetic::generate(&resources, data, &settings, audio, &params, &cancel, |_| {}).await?;
    println!("Shared PyTorch Mimetic A0: {} bytes, {facts}", wav.len());

    let params = serde_json::json!({
        "caption": "A melodic ambient piece with soft piano, acoustic guitar and electric bass in G minor, 4/4, at 115 beats per minute.",
        "seed": 337,
    });
    let (bytes, _, facts) =
        text2midi::generate(midi, &resources, models, data, &params, &cancel, |_| {}).await?;
    println!("Shared PyTorch Text2midi: {} bytes, {facts}", bytes.len());
    Ok(())
}
