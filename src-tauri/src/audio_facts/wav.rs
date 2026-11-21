use crate::error::{message, Result};
use std::io::{Read, Seek, SeekFrom};

pub(crate) struct WavFacts {
    pub duration_seconds: f64,
    pub sample_rate_hz: u32,
    pub channels: u32,
    pub bits_per_sample: u32,
    pub frames: u64,
}

fn invalid() -> crate::error::Error {
    message("Engine returned invalid WAV audio")
}

/// Read chunk headers only; validate PCM frame boundaries against the complete container length.
pub(super) fn facts(input: &mut (impl Read + Seek)) -> Result<WavFacts> {
    parse(input, |_, _| {})
}

fn parse(input: &mut (impl Read + Seek), mut data_chunk: impl FnMut(u64, u64)) -> Result<WavFacts> {
    let file_size = input.seek(SeekFrom::End(0))?;
    input.seek(SeekFrom::Start(0))?;
    let mut header = [0u8; 12];
    input.read_exact(&mut header).map_err(|_| invalid())?;
    if &header[..4] != b"RIFF" || &header[8..] != b"WAVE" {
        return Err(invalid());
    }
    let end = u64::from(u32::from_le_bytes(header[4..8].try_into().unwrap())) + 8;
    if end > file_size || end < 12 {
        return Err(invalid());
    }
    let mut position = 12u64;
    let mut format = None;
    let mut audio_bytes = 0u64;
    while position < end {
        if end - position < 8 {
            return Err(invalid());
        }
        input.seek(SeekFrom::Start(position))?;
        let mut chunk = [0u8; 8];
        input.read_exact(&mut chunk).map_err(|_| invalid())?;
        let size = u64::from(u32::from_le_bytes(chunk[4..].try_into().unwrap()));
        let body = position + 8;
        let next = body
            .checked_add(size)
            .and_then(|p| p.checked_add(size % 2))
            .ok_or_else(invalid)?;
        if next > end {
            return Err(invalid());
        }
        if &chunk[..4] == b"fmt " {
            if size < 16 || format.is_some() {
                return Err(invalid());
            }
            let mut fmt = [0u8; 16];
            input.read_exact(&mut fmt).map_err(|_| invalid())?;
            let tag = u16::from_le_bytes(fmt[..2].try_into().unwrap());
            let channels = u32::from(u16::from_le_bytes(fmt[2..4].try_into().unwrap()));
            let rate = u32::from_le_bytes(fmt[4..8].try_into().unwrap());
            let byte_rate = u32::from_le_bytes(fmt[8..12].try_into().unwrap());
            let align = u32::from(u16::from_le_bytes(fmt[12..14].try_into().unwrap()));
            let bits = u32::from(u16::from_le_bytes(fmt[14..16].try_into().unwrap()));
            if tag != 1
                || channels == 0
                || rate == 0
                || ![8, 16, 24, 32].contains(&bits)
                || channels.checked_mul(bits / 8) != Some(align)
                || rate.checked_mul(align) != Some(byte_rate)
            {
                return Err(invalid());
            }
            format = Some((rate, align, channels, bits));
        } else if &chunk[..4] == b"data" {
            audio_bytes = audio_bytes.checked_add(size).ok_or_else(invalid)?;
            data_chunk(body, size);
        }
        position = next;
    }
    let (rate, align, channels, bits) = format.ok_or_else(invalid)?;
    if audio_bytes == 0 || !audio_bytes.is_multiple_of(u64::from(align)) {
        return Err(invalid());
    }
    let frames = audio_bytes / u64::from(align);
    Ok(WavFacts {
        duration_seconds: frames as f64 / f64::from(rate),
        sample_rate_hz: rate,
        channels,
        bits_per_sample: bits,
        frames,
    })
}

/// Assemble PCM16 sections in one WAV, blending up to 30 ms at each seam.
#[derive(Default)]
pub(crate) struct WavAssembly {
    format: Option<(u32, u32)>,
    samples: Vec<u8>,
}

impl WavAssembly {
    pub(crate) fn append(&mut self, wav: &[u8]) -> Result<()> {
        let mut chunks = Vec::new();
        let facts = parse(&mut std::io::Cursor::new(wav), |start, size| {
            chunks.push(&wav[start as usize..(start + size) as usize]);
        })?;
        let format = (facts.sample_rate_hz, facts.channels);
        if facts.bits_per_sample != 16 || self.format.is_some_and(|existing| existing != format) {
            return Err(message(
                "The generated sections have incompatible WAV formats",
            ));
        }
        self.format = Some(format);
        let align = facts.channels as usize * 2;
        let first = chunks.first().ok_or_else(invalid)?;
        let overlap = (facts.sample_rate_hz as usize * 30 / 1000)
            .min(self.samples.len() / align / 2)
            .min(first.len() / align / 2);
        let overlap_bytes = overlap * align;
        let start = self.samples.len() - overlap_bytes;
        for (i, (old, new)) in self.samples[start..]
            .as_chunks_mut::<2>()
            .0
            .iter_mut()
            .zip(first.as_chunks::<2>().0)
            .enumerate()
        {
            let weight = (i / facts.channels as usize + 1) as i64;
            let total = overlap as i64 + 1;
            let a = i64::from(i16::from_le_bytes(*old));
            let b = i64::from(i16::from_le_bytes(*new));
            let sample = (a * (total - weight) + b * weight) / total;
            old.copy_from_slice(&(sample as i16).to_le_bytes());
        }
        self.samples.extend_from_slice(&first[overlap_bytes..]);
        for chunk in &chunks[1..] {
            self.samples.extend_from_slice(chunk);
        }
        Ok(())
    }

    pub(crate) fn finish(mut self, limit: f64) -> Result<Vec<u8>> {
        let (rate, channels) = self.format.ok_or_else(invalid)?;
        let align = channels * 2;
        self.samples
            .truncate((limit * f64::from(rate)).floor() as usize * align as usize);
        let size = u32::try_from(self.samples.len()).map_err(|_| invalid())?;
        let riff_size = size.checked_add(36).ok_or_else(invalid)?;
        let mut wav = Vec::with_capacity(self.samples.len() + 44);
        wav.extend_from_slice(b"RIFF");
        wav.extend_from_slice(&riff_size.to_le_bytes());
        wav.extend_from_slice(b"WAVEfmt \x10\0\0\0\x01\0");
        wav.extend_from_slice(&(channels as u16).to_le_bytes());
        wav.extend_from_slice(&rate.to_le_bytes());
        wav.extend_from_slice(&(rate * align).to_le_bytes());
        wav.extend_from_slice(&(align as u16).to_le_bytes());
        wav.extend_from_slice(&16u16.to_le_bytes());
        wav.extend_from_slice(b"data");
        wav.extend_from_slice(&size.to_le_bytes());
        wav.append(&mut self.samples);
        Ok(wav)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn measures_stereo_24_bit_output_from_the_pcm_header() {
        let data = [
            b"RIFF\x30\0\0\0WAVE".as_slice(),
            b"fmt \x10\0\0\0\x01\0\x02\0\x80\xBB\0\0\x00\x65\x04\0\x06\0\x18\0",
            b"data\x0C\0\0\0",
            &[0; 12],
        ]
        .concat();
        let wav = facts(&mut Cursor::new(data)).unwrap();
        assert_eq!(wav.sample_rate_hz, 48_000);
        assert_eq!(wav.channels, 2);
        assert_eq!(wav.bits_per_sample, 24);
        assert_eq!(wav.frames, 2);
        assert_eq!(wav.duration_seconds, 2.0 / 48_000.0);
    }
}
