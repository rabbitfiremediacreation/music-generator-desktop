pub use super::wave::WaveFormat;
mod dynamics;
pub(super) mod returns;
#[cfg(test)]
mod returns_tests;
use super::wave::{header, sample_value, StereoWave};
use super::{dsp, jobs, model::RATE};
use crate::{
    error::{message, Error, Result},
    state::AppState,
    types::{id, now},
};
use dsp::dynamic_eq::DynamicEqSettings;
pub use dynamics::{CompressorMode, DynamicsSettings};
use returns::{empty_sends, valid_send, FxReturn, FX_SLOTS};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    fs::File,
    io::{BufWriter, Write},
    path::Path,
};
use tokio_util::sync::CancellationToken;

const MIX_VERSION: u8 = 2;

fn legacy_version() -> u8 {
    1
}

fn enabled() -> bool {
    true
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(default)]
pub struct ChannelFx {
    pub low_db: f64,
    pub mid_db: f64,
    pub high_db: f64,
    pub comp: f64,
    pub limit: f64,
    pub width: f64,
    pub filter: f64,
    pub de_ess: f64,
    #[serde(skip_serializing_if = "DynamicsSettings::is_default")]
    pub dynamics: DynamicsSettings,
}

impl Default for ChannelFx {
    fn default() -> Self {
        Self {
            low_db: 0.0,
            mid_db: 0.0,
            high_db: 0.0,
            comp: 0.0,
            limit: 0.0,
            width: 100.0,
            filter: 0.0,
            de_ess: 0.0,
            dynamics: DynamicsSettings::default(),
        }
    }
}

impl ChannelFx {
    fn valid(&self) -> bool {
        [self.low_db, self.mid_db, self.high_db]
            .iter()
            .all(|gain| (-12.0..=12.0).contains(gain))
            && [self.comp, self.limit, self.de_ess]
                .iter()
                .all(|amount| (0.0..=100.0).contains(amount))
            && (0.0..=200.0).contains(&self.width)
            && (-100.0..=100.0).contains(&self.filter)
            && self.dynamics.valid()
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Track {
    pub role: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub replacement: Option<String>,
    pub gain_db: f32,
    pub pan: f32,
    pub mute: bool,
    pub solo: bool,
    pub fade_in: f64,
    pub fade_out: f64,
    #[serde(default)]
    pub gain_off: bool,
    #[serde(default = "enabled")]
    pub export: bool,
    #[serde(default)]
    pub fx: ChannelFx,
    #[serde(default, skip_serializing_if = "DynamicEqSettings::is_default")]
    pub dynamic_eq: DynamicEqSettings,
    #[serde(default, skip_serializing_if = "empty_sends")]
    pub sends: [f64; FX_SLOTS],
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Mix {
    #[serde(default = "legacy_version")]
    pub version: u8,
    pub tracks: Vec<Track>,
    pub master_db: f32,
    #[serde(default)]
    pub master_off: bool,
    #[serde(default)]
    pub master_comp: f64,
    #[serde(default)]
    pub master_limit: f64,
    #[serde(default, skip_serializing_if = "DynamicsSettings::is_default")]
    pub master_dynamics: DynamicsSettings,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) fx_returns: Option<[FxReturn; FX_SLOTS]>,
    pub first: u64,
    pub end: u64,
    pub looping: bool,
}

#[derive(Clone, Serialize)]
pub struct Version {
    pub id: String,
    pub name: String,
    pub mix: Mix,
    pub updated_at: String,
}

impl Track {
    pub fn new(role: &str) -> Self {
        Self {
            role: role.into(),
            name: role.into(),
            replacement: None,
            gain_db: 0.0,
            pan: 0.0,
            mute: false,
            solo: false,
            fade_in: 0.0,
            fade_out: 0.0,
            gain_off: false,
            export: true,
            fx: ChannelFx::default(),
            dynamic_eq: DynamicEqSettings::default(),
            sends: [0.0; FX_SLOTS],
        }
    }

    fn valid(&self, duration: f64) -> bool {
        !self.name.trim().is_empty()
            && self.name.chars().count() <= 80
            && gain_valid(self.gain_db)
            && (-1.0..=1.0).contains(&self.pan)
            && (0.0..=duration).contains(&self.fade_in)
            && (0.0..=duration).contains(&self.fade_out)
            && self.fx.valid()
            && self.dynamic_eq.valid()
            && self.sends.into_iter().all(valid_send)
    }
}

impl Mix {
    pub fn defaults(project: &jobs::Project) -> Self {
        Self {
            version: MIX_VERSION,
            tracks: project.roles.iter().map(|role| Track::new(role)).collect(),
            master_db: 0.0,
            master_off: false,
            master_comp: 0.0,
            master_limit: 0.0,
            master_dynamics: DynamicsSettings::default(),
            fx_returns: None,
            first: 0,
            end: project.frames,
            looping: false,
        }
    }

    pub fn validate(&self, project: &jobs::Project) -> Result<()> {
        let duration = project.frames as f64 / f64::from(project.rate);
        if !(1..=MIX_VERSION).contains(&self.version)
            || !gain_valid(self.master_db)
            || !(0.0..=100.0).contains(&self.master_comp)
            || !(0.0..=100.0).contains(&self.master_limit)
            || !self.master_dynamics.valid()
            || self
                .fx_returns
                .is_some_and(|slots| !slots.into_iter().all(FxReturn::valid))
            || self.first >= self.end
            || self.end > project.frames
            || self.tracks.len() > 32
            || self.tracks.iter().any(|track| {
                !project.roles.contains(&track.role) && !super::layer::is_role(&track.role)
            })
            || self
                .tracks
                .iter()
                .map(|track| &track.role)
                .collect::<std::collections::HashSet<_>>()
                .len()
                != self.tracks.len()
            || self.tracks.iter().any(|track| !track.valid(duration))
        {
            return Err(message("stem_mix_invalid"));
        }
        Ok(())
    }

    pub fn validate_track_ids(&self, state: &AppState, project_id: &str) -> Result<()> {
        for track in &self.tracks {
            if super::layer::is_role(&track.role) {
                super::layer::registered(state, project_id, &track.role)?;
            }
            if let Some(replacement) = &track.replacement {
                super::layer::registered(state, project_id, replacement)?;
            }
        }
        Ok(())
    }

    pub fn audible(&self) -> impl Iterator<Item = &Track> {
        let solo = self.tracks.iter().any(|track| track.solo);
        self.tracks
            .iter()
            .filter(move |track| !track.mute && (!solo || track.solo))
    }
}

fn gain_valid(db: f32) -> bool {
    (-60.0..=18.0).contains(&db)
}
#[cfg(all(test, unix))]
pub(crate) fn amplitude(db: f32) -> f32 {
    10.0_f32.powf(db / 20.0)
}

pub fn versions(state: &AppState, project_id: &str) -> Result<Vec<Version>> {
    let job = jobs::get(state, project_id)?;
    let project = job.complete()?;
    let con = state.db.lock();
    let mut statement = con.prepare(
        "SELECT id,name,data,updated_at FROM stem_mixes WHERE project_id=?1 ORDER BY updated_at DESC LIMIT 100",
    )?;
    let rows = statement.query_map([project_id], |row| {
        Ok(Version {
            id: row.get(0)?,
            name: row.get(1)?,
            mix: crate::db::parse_json(row.get(2)?)?,
            updated_at: row.get(3)?,
        })
    })?;
    let versions = rows.collect::<rusqlite::Result<Vec<_>>>()?;
    for version in &versions {
        version.mix.validate(project)?;
    }
    Ok(versions)
}

/// Resolve a saved snapshot within its owning project, including versions outside the recent list.
pub fn load(state: &AppState, project_id: &str, version_id: &str) -> Result<Mix> {
    state
        .db
        .lock()
        .query_row(
            "SELECT data FROM stem_mixes WHERE project_id=?1 AND id=?2",
            params![project_id, version_id],
            |row| crate::db::parse_json(row.get(0)?),
        )
        .optional()?
        .ok_or_else(|| message("stem_mix_missing"))
}

pub fn save(
    state: &AppState,
    project_id: &str,
    version_id: Option<&str>,
    name: &str,
    mut mix: Mix,
) -> Result<Version> {
    mix.validate(jobs::get(state, project_id)?.complete()?)?;
    mix.validate_track_ids(state, project_id)?;
    mix.version = MIX_VERSION;
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 120 {
        return Err(message("stem_mix_invalid"));
    }
    let name = name.to_owned();
    let updated_at = now();
    let data = serde_json::to_string(&mix)?;
    let con = state.db.lock();
    let id = match version_id {
        Some(id) => {
            if con.execute(
                "UPDATE stem_mixes SET name=?3,data=?4,updated_at=?5 WHERE id=?1 AND project_id=?2",
                params![id, project_id, name, data, updated_at],
            )? != 1
            {
                return Err(message("stem_mix_missing"));
            }
            id.to_owned()
        }
        None => {
            let id = id();
            con.execute(
                "INSERT INTO stem_mixes(id,project_id,name,data,updated_at) VALUES(?1,?2,?3,?4,?5)",
                params![id, project_id, name, data, updated_at],
            )?;
            id
        }
    };
    Ok(Version {
        id,
        name,
        mix,
        updated_at,
    })
}

const BLOCK_FRAMES: usize = 4096;

pub(crate) fn verify_wave(path: &Path, frames: u64, cancel: &CancellationToken) -> Result<f32> {
    wave_peak(StereoWave::open(path, frames)?, frames, cancel)
}

pub(super) fn raw_copy_peak(
    path: &Path,
    frames: u64,
    cancel: &CancellationToken,
) -> Result<Option<f32>> {
    let reader = StereoWave::open_project(path, frames)?;
    reader
        .is_canonical(frames)
        .then(|| wave_peak(reader, frames, cancel))
        .transpose()
}

fn wave_peak(mut reader: StereoWave, frames: u64, cancel: &CancellationToken) -> Result<f32> {
    reader.seek(0)?;
    let mut data = [0u8; BLOCK_FRAMES * 8];
    let mut peak = 0.0_f32;
    for offset in (0..frames).step_by(BLOCK_FRAMES) {
        if cancel.is_cancelled() {
            return Err(Error::Cancelled);
        }
        let bytes = ((frames - offset).min(BLOCK_FRAMES as u64) * 8) as usize;
        reader.read(&mut data[..bytes])?;
        for sample in data[..bytes].as_chunks::<4>().0 {
            let value = sample_value(sample)?;
            peak = peak.max(value.abs());
        }
    }
    Ok(peak)
}

fn envelope(track: &Track, frame: u64, first: u64, end: u64) -> f64 {
    let fade_in = track.fade_in * f64::from(RATE);
    let fade_out = track.fade_out * f64::from(RATE);
    let rising = if fade_in > 0.0 {
        ((frame - first) as f64 / fade_in).min(1.0)
    } else {
        1.0
    };
    let falling = if fade_out > 0.0 {
        ((end - frame - 1) as f64 / fade_out).min(1.0)
    } else {
        1.0
    };
    rising * falling
}

pub(crate) struct RenderTrack<'a> {
    pub path: &'a Path,
    pub controls: Option<&'a Track>,
}

pub(crate) struct Render<'a> {
    pub tracks: &'a [RenderTrack<'a>],
    pub frames: u64,
    pub first: u64,
    pub end: u64,
    pub prefix: u64,
    pub mix: &'a Mix,
    pub master: bool,
    pub format: WaveFormat,
}

impl Render<'_> {
    pub(super) fn clip_ceiling(&self) -> Option<f32> {
        let threshold = if self.master {
            self.mix
                .master_dynamics
                .brickwall_threshold(self.mix.master_comp)
        } else {
            let [input] = self.tracks else { return None };
            let track = input.controls?;
            track.fx.dynamics.brickwall_threshold(track.fx.comp)
        };
        threshold.map(|db| dsp::amplitude(db) as f32)
    }

    pub fn write(
        &self,
        path: &Path,
        cancel: &CancellationToken,
        mut progress: impl FnMut(u64),
    ) -> Result<f32> {
        let mut readers = self
            .tracks
            .iter()
            .map(|track| {
                let mut wave = StereoWave::open_project(track.path, self.frames)?;
                wave.seek(self.first)?;
                Ok((
                    wave,
                    track.controls,
                    track
                        .controls
                        .map(|track| dsp::Strip::new(track, f64::from(RATE))),
                ))
            })
            .collect::<Result<Vec<_>>>()?;
        let mut output = BufWriter::new(File::create(path)?);
        header(
            &mut output,
            self.format,
            self.prefix + self.end - self.first,
            RATE,
            2,
        )?;
        let zeros = [0u8; BLOCK_FRAMES * 8];
        let frame_size = (self.format.encoding().1 / 4) as usize;
        for offset in (0..self.prefix).step_by(BLOCK_FRAMES) {
            if cancel.is_cancelled() {
                return Err(Error::Cancelled);
            }
            let count = (self.prefix - offset).min(BLOCK_FRAMES as u64) as usize;
            output.write_all(&zeros[..count * frame_size])?;
        }
        let mut bytes = [0u8; BLOCK_FRAMES * 8];
        let mut master = self
            .master
            .then(|| dsp::Master::new(self.mix, f64::from(RATE)));
        let solo_returns = self.master
            && self
                .mix
                .fx_returns
                .is_some_and(|slots| slots.into_iter().any(FxReturn::is_soloed));
        let dry = !solo_returns || self.mix.tracks.iter().any(|track| track.solo);
        let mut returns = if self.master {
            let settings = self.mix.fx_returns.unwrap_or_else(returns::defaults);
            let routed = std::array::from_fn(|slot| {
                self.tracks
                    .iter()
                    .any(|input| input.controls.is_some_and(|track| track.sends[slot] > 0.0))
            });
            dsp::returns::Rack::new(settings, routed, solo_returns, f64::from(RATE))
        } else {
            None
        };
        let mut sends = returns
            .as_ref()
            .map(|_| vec![[[0.0; 2]; FX_SLOTS]; BLOCK_FRAMES]);
        let mut peak = 0.0_f32;
        for offset in (self.first..self.end).step_by(BLOCK_FRAMES) {
            if cancel.is_cancelled() {
                return Err(Error::Cancelled);
            }
            let count = (self.end - offset).min(BLOCK_FRAMES as u64) as usize;
            let mut summed = [[0.0_f64; 2]; BLOCK_FRAMES];
            if let Some(sends) = &mut sends {
                sends[..count].fill([[0.0; 2]; FX_SLOTS]);
            }
            for (reader, controls, strip) in &mut readers {
                reader.read(&mut bytes[..count * 8])?;
                let mut send_inputs = sends
                    .as_mut()
                    .zip(controls.filter(|track| !empty_sends(&track.sends)));
                for (index, (sample, target)) in bytes[..count * 8]
                    .as_chunks::<8>()
                    .0
                    .iter()
                    .zip(&mut summed)
                    .enumerate()
                {
                    let frame = offset + index as u64;
                    let mut pair = [
                        f64::from(sample_value(&sample[..4])?),
                        f64::from(sample_value(&sample[4..])?),
                    ];
                    if let (Some(track), Some(strip)) = (*controls, strip.as_mut()) {
                        strip.process(&mut pair, envelope(track, frame, self.first, self.end));
                    }
                    if dry {
                        target[0] += pair[0];
                        target[1] += pair[1];
                    }
                    if let Some((inputs, track)) = &mut send_inputs {
                        for (target, send) in inputs[index].iter_mut().zip(track.sends) {
                            target[0] += pair[0] * (send / 100.0);
                            target[1] += pair[1] * (send / 100.0);
                        }
                    }
                }
            }
            for (index, pair) in summed[..count].iter_mut().enumerate() {
                if let Some((rack, inputs)) = returns.as_mut().zip(sends.as_ref()) {
                    rack.process(pair, inputs[index]);
                }
                if let Some(master) = &mut master {
                    master.process(pair);
                }
                for &sample in pair.iter() {
                    let sample = sample as f32;
                    if !sample.is_finite() {
                        return Err(message("stem_output_invalid"));
                    }
                    peak = peak.max(sample.abs());
                    self.format.write_sample(&mut output, sample)?;
                }
            }
            progress(offset + count as u64 - self.first);
        }
        output.flush()?;
        output.get_ref().sync_all()?;
        Ok(peak)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_wave(path: &Path, frames: u64, values: [f32; 2]) {
        let mut file = File::create(path).unwrap();
        header(&mut file, WaveFormat::Float32, frames, RATE, 2).unwrap();
        for _ in 0..frames {
            for value in &values {
                file.write_all(&value.to_le_bytes()).unwrap();
            }
        }
    }

    #[test]
    fn full_project_render_applies_fades_at_render_bounds_even_with_a_trimmed_mix() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("source.wav");
        let output = root.path().join("context.wav");
        let frames = 12;
        sample_wave(&source, frames, [0.5; 2]);
        let track = Track {
            fade_in: 2.0 / f64::from(RATE),
            fade_out: 2.0 / f64::from(RATE),
            ..Track::new("drums")
        };
        let mix: Mix = serde_json::from_value(serde_json::json!({
            "tracks": [&track], "master_db": 0, "first": 3, "end": 8, "looping": true
        }))
        .unwrap();
        let render = Render {
            tracks: &[RenderTrack {
                path: &source,
                controls: Some(&track),
            }],
            frames,
            first: 0,
            end: frames,
            prefix: 0,
            mix: &mix,
            master: true,
            format: WaveFormat::Float32,
        };
        assert_eq!(
            render
                .write(&output, &CancellationToken::new(), |_| {})
                .unwrap(),
            0.5
        );
        let mut wave = StereoWave::open(&output, frames).unwrap();
        wave.seek(0).unwrap();
        let mut bytes = [0; 96];
        wave.read(&mut bytes).unwrap();
        let left: Vec<_> = bytes
            .as_chunks::<8>()
            .0
            .iter()
            .map(|frame| sample_value(&frame[..4]).unwrap())
            .collect();
        assert_eq!(&left[..3], &[0.0, 0.25, 0.5]);
        assert_eq!(&left[9..], &[0.5, 0.25, 0.0]);
    }

    #[test]
    fn raw_render_duplicates_short_mono_sources_without_using_the_passthrough_copy() {
        let dir = tempfile::tempdir().unwrap();
        let input = dir.path().join("mono.wav");
        let output = dir.path().join("output.wav");
        let mut file = File::create(&input).unwrap();
        header(&mut file, WaveFormat::Float32, 2, RATE, 1).unwrap();
        for sample in [0.25_f32, -0.5] {
            file.write_all(&sample.to_le_bytes()).unwrap();
        }
        drop(file);
        let cancel = CancellationToken::new();
        assert!(verify_wave(&input, 4, &cancel).is_err());
        assert_eq!(raw_copy_peak(&input, 4, &cancel).unwrap(), None);
        let mix: Mix = serde_json::from_value(serde_json::json!({
            "tracks": [], "master_db": 0, "first": 0, "end": 4, "looping": false
        }))
        .unwrap();
        let renderer = Render {
            tracks: &[RenderTrack {
                path: &input,
                controls: None,
            }],
            frames: 4,
            first: 0,
            end: 4,
            prefix: 0,
            mix: &mix,
            master: false,
            format: WaveFormat::Float32,
        };
        assert_eq!(renderer.write(&output, &cancel, |_| {}).unwrap(), 0.5);
        let mut wave = StereoWave::open(&output, 4).unwrap();
        wave.seek(0).unwrap();
        let mut bytes = [0; 32];
        wave.read(&mut bytes).unwrap();
        let samples: Vec<_> = bytes
            .as_chunks::<4>()
            .0
            .iter()
            .map(|sample| sample_value(sample).unwrap())
            .collect();
        assert_eq!(samples, [0.25, 0.25, -0.5, -0.5, 0.0, 0.0, 0.0, 0.0]);
    }

    #[test]
    fn legacy_mixes_keep_their_gain_balance_toggles_and_get_neutral_defaults() {
        let mix: Mix = serde_json::from_value(serde_json::json!({
            "tracks": [{"role":"vocals","name":"Voice","gain_db":9.5,"pan":-0.3,"mute":true,"solo":true,
                "fade_in":0,"fade_out":0}],
            "master_db":-1.25,"first":8,"end":226,"looping":true
        })).unwrap();
        let track = &mix.tracks[0];
        assert_eq!(
            (
                mix.version,
                track.gain_db,
                track.pan,
                track.mute,
                track.solo
            ),
            (1, 9.5, -0.3, true, true)
        );
        assert!(track.export && !track.gain_off);
        assert_eq!(
            (
                track.fx.width,
                track.fx.comp,
                track.fx.filter,
                mix.master_limit
            ),
            (100.0, 0.0, 0.0, 0.0)
        );
    }

    #[test]
    fn float_export_matches_the_realtime_conformance_signal_with_all_effects() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("source.wav");
        let output = root.path().join("mixed.wav");
        let frames = 4096;
        let mut input = File::create(&path).unwrap();
        header(&mut input, WaveFormat::Float32, frames, RATE, 2).unwrap();
        for frame in 0..frames {
            let phase = frame as f64 * std::f64::consts::TAU / f64::from(RATE);
            for sample in [(phase * 255.0).sin() * 0.62, (phase * 970.0).cos() * 0.48] {
                input.write_all(&(sample as f32).to_le_bytes()).unwrap();
            }
        }
        let track = Track {
            pan: -0.35,
            gain_db: 3.0,
            fx: ChannelFx {
                filter: -63.0,
                low_db: 8.0,
                mid_db: -5.0,
                high_db: 6.0,
                comp: 37.0,
                limit: 71.0,
                width: 145.0,
                de_ess: 0.0,
                dynamics: DynamicsSettings::default(),
            },
            ..Track::new("vocals")
        };
        let mix = Mix {
            version: MIX_VERSION,
            tracks: vec![track.clone()],
            master_db: 2.0,
            master_comp: 28.0,
            master_limit: 54.0,
            master_dynamics: DynamicsSettings::default(),
            fx_returns: None,
            master_off: false,
            first: 0,
            end: frames,
            looping: false,
        };
        let render = Render {
            tracks: &[RenderTrack {
                path: &path,
                controls: Some(&track),
            }],
            frames,
            first: 0,
            end: frames,
            prefix: 0,
            mix: &mix,
            master: true,
            format: WaveFormat::Float32,
        };
        let peak = render
            .write(&output, &CancellationToken::new(), |_| {})
            .unwrap();
        assert!(peak <= 0.891_251);
        let checkpoints: std::collections::BTreeMap<u64, [f32; 2]> = serde_json::from_str(
            include_str!("../../../frontend/react/stems/mixer-parity.json"),
        )
        .unwrap();
        let mut audio = StereoWave::open(&output, frames).unwrap();
        let mut stereo = [0; 8];
        for (frame, expected) in checkpoints {
            audio.seek(frame).unwrap();
            audio.read(&mut stereo).unwrap();
            for (index, sample) in stereo.as_chunks::<4>().0.iter().enumerate() {
                assert!(
                    (sample_value(sample).unwrap() - expected[index]).abs() < 1e-6,
                    "frame {frame}, channel {index}"
                );
            }
        }
    }

    #[test]
    fn float_export_matches_live_eq_and_de_esser_on_the_existing_track() {
        type Samples = std::collections::BTreeMap<u64, [f32; 2]>;
        #[derive(Deserialize)]
        struct DeEssReference {
            amount: f64,
            samples: Samples,
        }
        #[derive(Deserialize)]
        struct Reference {
            settings: DynamicEqSettings,
            samples: Samples,
            de_ess: DeEssReference,
        }
        let expected: Reference = serde_json::from_str(include_str!(
            "../../../frontend/react/stems/mixer-live-eq-parity.json"
        ))
        .unwrap();
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("source.wav");
        let output = root.path().join("render.wav");
        let frames = 4096;
        let mut dry = Vec::new();
        header(&mut dry, WaveFormat::Float32, frames, RATE, 2).unwrap();
        for frame in 0..frames {
            let phase = frame as f64 * std::f64::consts::TAU / f64::from(RATE);
            for sample in [(phase * 700.0).sin() * 0.6, (phase * 6500.0).cos() * 0.48] {
                dry.extend_from_slice(&(sample as f32).to_le_bytes());
            }
        }
        std::fs::write(&path, &dry).unwrap();
        let mut track = Track {
            dynamic_eq: expected.settings,
            ..Track::new("vocals")
        };
        assert!(track.valid(frames as f64 / f64::from(RATE)));
        let encoded = serde_json::to_string(&track).unwrap();
        track = serde_json::from_str(&encoded).unwrap();
        let mix: Mix = serde_json::from_value(serde_json::json!({
            "tracks": [], "master_db": 0, "first": 0, "end": frames, "looping": false
        }))
        .unwrap();
        for (bypass, amount, points) in [
            (false, 0.0, Some(&expected.samples)),
            (true, expected.de_ess.amount, Some(&expected.de_ess.samples)),
            (true, 0.0, None),
        ] {
            track.dynamic_eq.bypass = bypass;
            track.fx.de_ess = amount;
            Render {
                tracks: &[RenderTrack {
                    path: &path,
                    controls: Some(&track),
                }],
                frames,
                first: 0,
                end: frames,
                prefix: 0,
                mix: &mix,
                master: false,
                format: WaveFormat::Float32,
            }
            .write(&output, &CancellationToken::new(), |_| {})
            .unwrap();
            let Some(points) = points else {
                assert_eq!(std::fs::read(&output).unwrap(), dry);
                continue;
            };
            let mut wave = StereoWave::open(&output, frames).unwrap();
            let mut pair = [0; 8];
            for (&frame, &[left, right]) in points {
                wave.seek(frame).unwrap();
                wave.read(&mut pair).unwrap();
                assert!(
                    (sample_value(&pair[..4]).unwrap() - left).abs() < 1e-6,
                    "left {frame}"
                );
                assert!(
                    (sample_value(&pair[4..]).unwrap() - right).abs() < 1e-6,
                    "right {frame}"
                );
            }
        }
    }

    #[test]
    fn float_export_applies_persisted_makeup_and_limiter_switches() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("source.wav");
        let output = root.path().join("mixed.wav");
        sample_wave(&source, 16, [0.5, 0.25]);
        let mix: Mix = serde_json::from_value(serde_json::json!({
            "version": MIX_VERSION,
            "tracks": [{
                "role": "vocals", "name": "Voice", "gain_db": 0.0, "pan": 0.0,
                "mute": false, "solo": false, "fade_in": 0.0, "fade_out": 0.0,
                "fx": { "limit": 100.0, "dynamics": { "makeup_db": 12.0, "limiter": false } }
            }],
            "master_db": 0.0, "master_dynamics": { "limiter": true },
            "first": 0, "end": 16, "looping": false
        }))
        .unwrap();
        let stored = serde_json::to_value(&mix).unwrap();
        assert_eq!(stored["tracks"][0]["fx"]["dynamics"]["limiter"], false);
        assert_eq!(stored["master_dynamics"]["limiter"], true);
        let render = Render {
            tracks: &[RenderTrack {
                path: &source,
                controls: Some(&mix.tracks[0]),
            }],
            frames: 16,
            first: 0,
            end: 16,
            prefix: 0,
            mix: &mix,
            master: true,
            format: WaveFormat::Float32,
        };
        let cancel = CancellationToken::new();
        let peak = render.write(&output, &cancel, |_| {}).unwrap();
        assert!((peak - 10f32.powf(-1.0 / 20.0)).abs() < 1e-6);
        let processed = Render {
            master: false,
            ..render
        };
        let peak = processed.write(&output, &cancel, |_| {}).unwrap();
        assert!((peak - 0.5 * 10f32.powf(12.0 / 20.0)).abs() < 1e-6);
    }

    #[test]
    fn float_export_uses_parallel_compression_and_the_independent_master_clipper() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("source.wav");
        let output = root.path().join("mixed.wav");
        let frames = 8192;
        sample_wave(&source, frames, [0.8, -0.2]);
        let mix: Mix = serde_json::from_value(serde_json::json!({
            "version": MIX_VERSION,
            "tracks": [{
                "role": "vocals", "name": "Voice", "gain_db": 0.0, "pan": 0.0,
                "mute": false, "solo": false, "fade_in": 0.0, "fade_out": 0.0,
                "fx": { "dynamics": { "mix": 50.0, "threshold_db": -12.0, "ratio": 2.0, "attack_ms": 0.1, "knee_db": 0.0 } }
            }],
            "master_db": 3.0,
            "master_dynamics": {
                "mix": 0.0, "threshold_db": -12.0, "ratio": 1.5, "brickwall": true,
                "attack_ms": 0.1, "release_ms": 10.0, "knee_db": 0.0
            },
            "first": 0, "end": frames, "looping": false
        }))
        .unwrap();
        let mut render = Render {
            tracks: &[RenderTrack {
                path: &source,
                controls: Some(&mix.tracks[0]),
            }],
            frames,
            first: 0,
            end: frames,
            prefix: 0,
            mix: &mix,
            master: false,
            format: WaveFormat::Float32,
        };
        let threshold = 10f64.powf(-12.0 / 20.0) as f32;
        let left = (0.8 + (0.8 * threshold).sqrt()) / 2.0;
        let right = -left / 4.0;
        let cancel = CancellationToken::new();
        for (master, expected) in [
            (false, [left, right]),
            (true, [threshold, right * 10f32.powf(3.0 / 20.0)]),
        ] {
            render.master = master;
            assert_eq!(render.clip_ceiling(), master.then_some(threshold));
            render.write(&output, &cancel, |_| {}).unwrap();
            let mut wave = StereoWave::open(&output, frames).unwrap();
            wave.seek(frames - 1).unwrap();
            let mut sample = [0; 8];
            wave.read(&mut sample).unwrap();
            for (bytes, expected) in sample.as_chunks::<4>().0.iter().zip(expected) {
                let actual = sample_value(bytes).unwrap();
                assert!(
                    (actual - expected).abs() < 1e-6,
                    "master={master}: {actual} != {expected}"
                );
            }
        }
    }

    #[test]
    fn float_export_keeps_the_optical_release_tail() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("source.wav");
        let output = root.path().join("mixed.wav");
        let press = u64::from(RATE);
        let frames = press * 7 / 5;
        let mut input = BufWriter::new(File::create(&source).unwrap());
        header(&mut input, WaveFormat::Float32, frames, RATE, 2).unwrap();
        for frame in 0..frames {
            let sample = if frame < press { 0.8f32 } else { 0.08f32 };
            for value in [sample, sample / 2.0] {
                input.write_all(&value.to_le_bytes()).unwrap();
            }
        }
        input.flush().unwrap();
        let mix: Mix = serde_json::from_value(serde_json::json!({
            "version": MIX_VERSION,
            "tracks": [],
            "master_db": 0.0,
            "master_dynamics": { "mix": 100.0, "threshold_db": -18.0, "ratio": 4.0, "knee_db": 0.0, "optical": true },
            "first": 0, "end": frames, "looping": false
        }))
        .unwrap();
        let render = Render {
            tracks: &[RenderTrack {
                path: &source,
                controls: None,
            }],
            frames,
            first: 0,
            end: frames,
            prefix: 0,
            mix: &mix,
            master: true,
            format: WaveFormat::Float32,
        };
        render
            .write(&output, &CancellationToken::new(), |_| {})
            .unwrap();
        let mut wave = StereoWave::open(&output, frames).unwrap();
        wave.seek(frames - 1).unwrap();
        let mut sample = [0; 8];
        wave.read(&mut sample).unwrap();
        let left = sample_value(&sample[..4]).unwrap();
        let right = sample_value(&sample[4..]).unwrap();
        let reduction = -0.75 * (20.0 * 0.8f64.log10() + 18.0);
        let fast = reduction * (-0.4f64 / 0.03).exp();
        let slow = reduction * (1.0 - (-1.0f64 / 0.25).exp()) * (-0.4f64 / 0.96).exp();
        let expected = 0.08 * 10f64.powf((fast + slow) / 40.0);
        assert!((f64::from(left) - expected).abs() < 1e-6);
        assert_eq!(right, left / 2.0);
    }

    #[test]
    fn float_export_uses_mode_specific_timing_ratio_and_makeup() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("source.wav");
        let output = root.path().join("mixed.wav");
        let frames = 1024;
        let input = 0.8f32;
        sample_wave(&source, frames, [input, input / 2.0]);
        let input = f64::from(input);
        for (settings, attack_seconds, ratio, makeup) in [
            (
                serde_json::json!({
                    "mode": "fet", "mix": 100.0, "threshold_db": -12.0, "ratio": 2.0, "knee_db": 0.0,
                    "fet_attack_us": 20.0, "fet_ratio": 8.0
                }),
                0.000_020,
                8.0,
                0.0,
            ),
            (
                serde_json::json!({
                    "mode": "vca", "mix": 100.0, "threshold_db": -12.0, "ratio": 2.0, "knee_db": 0.0,
                    "vca_attack_ms": 0.1, "vca_ratio": 4.0, "makeup_db": -6.0, "auto_gain": true
                }),
                0.000_1,
                4.0,
                4.5,
            ),
        ] {
            let mix: Mix = serde_json::from_value(serde_json::json!({
                "version": MIX_VERSION, "tracks": [], "master_db": 0.0, "master_dynamics": settings,
                "first": 0, "end": frames, "looping": false
            }))
            .unwrap();
            assert!(mix.master_dynamics.valid());
            let render = Render {
                tracks: &[RenderTrack {
                    path: &source,
                    controls: None,
                }],
                frames,
                first: 0,
                end: frames,
                prefix: 0,
                mix: &mix,
                master: true,
                format: WaveFormat::Float32,
            };
            render
                .write(&output, &CancellationToken::new(), |_| {})
                .unwrap();
            let mut wave = StereoWave::open(&output, frames).unwrap();
            let target = (1.0 / ratio - 1.0) * (20.0 * input.log10() + 12.0);
            for frame in [0, frames - 1] {
                wave.seek(frame).unwrap();
                let mut sample = [0; 8];
                wave.read(&mut sample).unwrap();
                let attack =
                    1.0 - (-((frame + 1) as f64) / (f64::from(RATE) * attack_seconds)).exp();
                let expected = input * 10f64.powf((target * attack + makeup) / 20.0);
                assert!((f64::from(sample_value(&sample[..4]).unwrap()) - expected).abs() < 1e-6);
            }
        }
    }

    #[test]
    fn zero_or_multiple_solos_and_mute_precedence() {
        let mut mix = Mix {
            version: MIX_VERSION,
            tracks: ["vocals", "drums", "bass"].map(Track::new).to_vec(),
            master_db: 0.0,
            master_off: false,
            master_comp: 0.0,
            master_limit: 0.0,
            master_dynamics: DynamicsSettings::default(),
            fx_returns: None,
            first: 0,
            end: 42,
            looping: false,
        };
        assert_eq!(mix.audible().count(), 3);
        mix.tracks[0].solo = true;
        mix.tracks[1].solo = true;
        assert_eq!(
            mix.audible().map(|t| t.role.as_str()).collect::<Vec<_>>(),
            ["vocals", "drums"]
        );
        mix.tracks[1].mute = true;
        assert_eq!(
            mix.audible().map(|t| t.role.as_str()).collect::<Vec<_>>(),
            ["vocals"]
        );
        mix.tracks[0].mute = true;
        assert_eq!(mix.audible().count(), 0);
    }

    #[test]
    fn checks_alignment_and_preserves_stereo_balance_range_and_source_bytes() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("source.wav");
        let output = root.path().join("mix.wav");
        sample_wave(&source, 16, [0.25, 0.75]);
        let original = std::fs::read(&source).unwrap();
        let cancel = CancellationToken::new();
        assert!(verify_wave(&source, 15, &cancel).is_err());
        assert!(verify_wave(&root.path().join("missing.wav"), 16, &cancel).is_err());
        assert_eq!(verify_wave(&source, 16, &cancel).unwrap(), 0.75);
        let track = Track {
            pan: -1.0,
            ..Track::new("drums")
        };
        let mix = Mix {
            version: MIX_VERSION,
            tracks: vec![track.clone()],
            master_db: 0.0,
            master_off: false,
            master_comp: 0.0,
            master_limit: 0.0,
            master_dynamics: DynamicsSettings::default(),
            fx_returns: None,
            first: 3,
            end: 10,
            looping: false,
        };
        let render = Render {
            tracks: &[RenderTrack {
                path: &source,
                controls: Some(&track),
            }],
            frames: 16,
            first: 3,
            end: 10,
            prefix: 3,
            mix: &mix,
            master: true,
            format: WaveFormat::Float32,
        };
        assert_eq!(render.write(&output, &cancel, |_| {}).unwrap(), 0.25);
        let mut read = StereoWave::open(&output, 10).unwrap();
        read.seek(0).unwrap();
        let mut samples = [0; 80];
        read.read(&mut samples).unwrap();
        assert_eq!(&samples[..24], &[0; 24]);
        assert_eq!(sample_value(&samples[24..28]).unwrap(), 0.25);
        assert_eq!(sample_value(&samples[28..32]).unwrap(), 0.0);
        assert_eq!(original, std::fs::read(&source).unwrap());
        cancel.cancel();
        assert!(matches!(
            render.write(&output, &cancel, |_| {}),
            Err(Error::Cancelled)
        ));
    }
}
