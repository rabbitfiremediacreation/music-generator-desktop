use super::model::RATE;
use crate::{
    audio_facts::float_data,
    error::{message, Result},
};
use serde::{Deserialize, Serialize};
use std::{
    fs::File,
    io::{BufReader, Read, Seek, SeekFrom, Write},
    path::Path,
};
use tokio_util::sync::CancellationToken;

pub(super) struct StereoWave {
    file: BufReader<File>,
    data: u64,
    frames: u64,
    channels: u32,
    remaining: u64,
}

impl StereoWave {
    pub(super) fn open(path: &Path, frames: u64) -> Result<Self> {
        let wave = Self::open_project(path, frames)?;
        if !wave.is_canonical(frames) {
            return Err(message("stem_output_alignment"));
        }
        Ok(wave)
    }

    /// Read an aligned mono or stereo asset as stereo, with silence after its last frame.
    pub(super) fn open_project(path: &Path, frames: u64) -> Result<Self> {
        let mut file = BufReader::new(File::open(path).map_err(|_| message("stem_asset_missing"))?);
        let (facts, data) = float_data(&mut file).map_err(|_| message("stem_output_invalid"))?;
        if facts.sample_rate_hz != RATE || !matches!(facts.channels, 1 | 2) || facts.frames > frames
        {
            return Err(message("stem_output_alignment"));
        }
        Ok(Self {
            file,
            data,
            frames: facts.frames,
            channels: facts.channels,
            remaining: 0,
        })
    }

    pub(super) fn is_canonical(&self, frames: u64) -> bool {
        self.channels == 2 && self.frames == frames
    }

    pub(super) fn seek(&mut self, frame: u64) -> Result<()> {
        let frame = frame.min(self.frames);
        self.file.seek(SeekFrom::Start(
            self.data + frame * u64::from(self.channels) * 4,
        ))?;
        self.remaining = self.frames - frame;
        Ok(())
    }

    pub(super) fn read(&mut self, bytes: &mut [u8]) -> Result<()> {
        let frames = self.remaining.min((bytes.len() / 8) as u64) as usize;
        let input_size = frames * self.channels as usize * 4;
        self.file
            .read_exact(&mut bytes[..input_size])
            .map_err(|_| message("stem_output_invalid"))?;
        if self.channels == 1 {
            for index in (0..frames).rev() {
                let sample: [u8; 4] = bytes[index * 4..index * 4 + 4].try_into().unwrap();
                let stereo = &mut bytes[index * 8..index * 8 + 8];
                stereo[..4].copy_from_slice(&sample);
                stereo[4..].copy_from_slice(&sample);
            }
        }
        bytes[frames * 8..].fill(0);
        self.remaining -= frames as u64;
        Ok(())
    }
}

pub(super) fn sample_value(sample: &[u8]) -> Result<f32> {
    let value = f32::from_le_bytes(sample.try_into().expect("four byte sample"));
    value
        .is_finite()
        .then_some(value)
        .ok_or_else(|| message("stem_output_invalid"))
}

/// Preserve the source start and pad the rest of the canonical project extent with silence.
pub(super) fn pad_stereo(
    input: &Path,
    output: &Path,
    frames: u64,
    end: u64,
    cancel: &CancellationToken,
) -> Result<()> {
    let mut source = StereoWave::open(input, frames)?;
    source.seek(0)?;
    let mut target = File::create(output)?;
    header(&mut target, WaveFormat::Float32, end, RATE, 2)?;
    let mut data = [0; 32768];
    for offset in (0..frames).step_by(4096) {
        if cancel.is_cancelled() {
            return Err(crate::error::Error::Cancelled);
        }
        let count = (frames - offset).min(4096) as usize * 8;
        source.read(&mut data[..count])?;
        target.write_all(&data[..count])?;
    }
    let bytes_written = target.stream_position()?;
    target.set_len(bytes_written + (end - frames) * 8)?;
    Ok(())
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WaveFormat {
    Float32,
    Pcm16,
    Pcm24,
}

impl WaveFormat {
    pub(super) fn encoding(self) -> (u16, u16) {
        match self {
            Self::Float32 => (3, 32),
            Self::Pcm16 => (1, 16),
            Self::Pcm24 => (1, 24),
        }
    }

    pub(super) fn write_sample(self, file: &mut impl Write, sample: f32) -> Result<()> {
        match self {
            Self::Float32 => file.write_all(&sample.to_le_bytes())?,
            Self::Pcm16 => file.write_all(&((sample * 32768.0).round() as i16).to_le_bytes())?,
            Self::Pcm24 => file.write_all(
                &((sample * 8388608.0).round().clamp(-8388608.0, 8388607.0) as i32).to_le_bytes()
                    [..3],
            )?,
        }
        Ok(())
    }
}

pub(super) fn header(
    file: &mut impl Write,
    format: WaveFormat,
    frames: u64,
    rate: u32,
    channels: u16,
) -> Result<()> {
    let (encoding, bits) = format.encoding();
    let align = channels * bits / 8;
    let size = u32::try_from(frames * u64::from(align)).map_err(|_| message("stem_range"))?;
    let fact = encoding == 3;
    let riff_size = size
        .checked_add(if fact { 48 } else { 36 } + size % 2)
        .ok_or_else(|| message("stem_range"))?;
    file.write_all(b"RIFF")?;
    file.write_all(&riff_size.to_le_bytes())?;
    file.write_all(b"WAVEfmt \x10\0\0\0")?;
    file.write_all(&encoding.to_le_bytes())?;
    file.write_all(&channels.to_le_bytes())?;
    file.write_all(&rate.to_le_bytes())?;
    file.write_all(&(rate * u32::from(align)).to_le_bytes())?;
    file.write_all(&align.to_le_bytes())?;
    file.write_all(&bits.to_le_bytes())?;
    if fact {
        file.write_all(b"fact\x04\0\0\0")?;
        file.write_all(&(frames as u32).to_le_bytes())?;
    }
    file.write_all(b"data")?;
    file.write_all(&size.to_le_bytes())?;
    Ok(())
}
