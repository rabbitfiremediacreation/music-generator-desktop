use crate::error::{message, Result};
use std::io::{Read, Seek, SeekFrom};

fn invalid() -> crate::error::Error {
    message("Engine returned invalid WAV audio")
}

/// Read chunk headers only; validate PCM frame boundaries against the complete container length.
pub(super) fn duration(input: &mut (impl Read + Seek)) -> Result<f64> {
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
            format = Some((rate, align));
        } else if &chunk[..4] == b"data" {
            audio_bytes = audio_bytes.checked_add(size).ok_or_else(invalid)?;
        }
        position = next;
    }
    let (rate, align) = format.ok_or_else(invalid)?;
    if audio_bytes == 0 || !audio_bytes.is_multiple_of(u64::from(align)) {
        return Err(invalid());
    }
    Ok((audio_bytes / u64::from(align)) as f64 / f64::from(rate))
}
