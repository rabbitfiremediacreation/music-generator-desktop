use crate::error::{message, Result};
use mailparse::body::Body;
use serde_json::Value;
use std::borrow::Cow;

type Audio = (Vec<u8>, String);
struct Parts {
    audio: Option<Audio>,
    metadata: Option<Vec<u8>>,
}

pub fn extract_json(ctype: &str, body: &[u8]) -> Result<Value> {
    if ctype.starts_with("application/json") {
        return parse_json(body);
    }
    let bytes = multipart_parts(ctype, body, false)?
        .metadata
        .ok_or_else(|| message("No application/json part in engine response"))?;
    parse_json(&bytes)
}

pub fn extract_audio(ctype: &str, body: &[u8]) -> Result<Audio> {
    if ctype.starts_with("audio/") {
        return audio(body.to_vec(), ctype);
    }
    let (bytes, kind) = multipart_parts(ctype, body, true)?
        .audio
        .ok_or_else(|| message("No audio/ part in engine response"))?;
    audio(bytes, &kind)
}

/// Reuse the HTTP buffer for binary synthesis audio.
pub(super) fn extract_generation(
    ctype: &str,
    mut body: Vec<u8>,
) -> Result<(Vec<u8>, String, Option<Value>)> {
    if ctype.starts_with("audio/") {
        return audio(body, ctype).map(|(bytes, kind)| (bytes, kind, None));
    }
    let (bytes, kind, metadata) = {
        let mut audio_part = None;
        let mut metadata = None;
        for part in synthesis_parts(ctype, &body)? {
            let (part, end) = part?;
            if audio_part.is_none() && part.ctype.mimetype.starts_with("audio/") {
                audio_part = Some((part, end));
            } else if metadata.is_none() && part.ctype.mimetype.starts_with("application/json") {
                metadata = Some(parse_json(&part_payload(&part)?)?);
            }
        }
        let (part, end) = audio_part.ok_or_else(|| message("No audio/ part in engine response"))?;
        let kind = part.ctype.mimetype.clone();
        let bytes = match part_payload(&part)? {
            Cow::Borrowed(bytes) => {
                let length = bytes.len();
                body.copy_within(end - length..end, 0);
                body.truncate(length);
                body
            }
            Cow::Owned(bytes) => bytes,
        };
        (bytes, kind, metadata)
    };
    let (bytes, extension) = audio(bytes, &kind)?;
    Ok((bytes, extension, metadata))
}

/// Parse parts from their original slices and require the final multipart delimiter.
fn synthesis_parts<'a>(
    ctype: &str,
    body: &'a [u8],
) -> Result<impl Iterator<Item = Result<(mailparse::ParsedMail<'a>, usize)>> + 'a> {
    let ctype = mailparse::parse_content_type(ctype);
    if !ctype.mimetype.starts_with("multipart/") {
        return Err(message(format!(
            "Unexpected engine response: {}",
            ctype.mimetype
        )));
    }
    let boundary = ctype
        .params
        .get("boundary")
        .filter(|boundary| !boundary.is_empty())
        .ok_or_else(|| message("Missing multipart boundary in engine response"))?;
    let marker = format!("--{boundary}");
    let mut offset = 0;
    let mut boundaries = body
        .split_inclusive(|byte| *byte == b'\n')
        .filter_map(move |line| {
            let start = offset;
            offset += line.len();
            let suffix = strip_line_ending(line).strip_prefix(marker.as_bytes())?;
            let (closing, padding) = match suffix.strip_prefix(b"--") {
                Some(padding) => (true, padding),
                None => (false, suffix),
            };
            padding
                .iter()
                .all(|byte| matches!(byte, b' ' | b'\t'))
                .then_some((start, offset, closing))
        });
    let (_, mut start, mut closed) = boundaries
        .next()
        .ok_or_else(|| message("Missing multipart delimiter in engine response"))?;
    Ok(std::iter::from_fn(move || {
        if closed {
            return None;
        }
        let Some((end, next, closing)) = boundaries.next() else {
            closed = true;
            return Some(Err(message("Incomplete multipart engine response")));
        };
        let part = strip_line_ending(&body[start..end]);
        let end = start + part.len();
        start = next;
        closed = closing;
        Some(
            mailparse::parse_mail(part)
                .map(|part| (part, end))
                .map_err(|error| message(error.to_string())),
        )
    }))
}

fn strip_line_ending(bytes: &[u8]) -> &[u8] {
    bytes
        .strip_suffix(b"\r\n")
        .or_else(|| bytes.strip_suffix(b"\n"))
        .unwrap_or(bytes)
}

fn part_payload<'a>(part: &'a mailparse::ParsedMail<'_>) -> Result<Cow<'a, [u8]>> {
    Ok(match part.get_body_encoded() {
        Body::Base64(body) | Body::QuotedPrintable(body) => Cow::Owned(
            body.get_decoded()
                .map_err(|error| message(error.to_string()))?,
        ),
        Body::SevenBit(body) | Body::EightBit(body) => Cow::Borrowed(body.get_raw()),
        Body::Binary(body) => Cow::Borrowed(body.get_raw()),
    })
}

fn parse_json(bytes: &[u8]) -> Result<Value> {
    let value: Value = serde_json::from_slice(bytes)?;
    let value = if let Value::Array(mut items) = value {
        if items.is_empty() {
            return Err(message("Empty engine result"));
        }
        items.remove(0)
    } else {
        value
    };
    if !value.is_object() {
        return Err(message("Invalid engine metadata"));
    }
    Ok(value)
}

fn audio(bytes: Vec<u8>, kind: &str) -> Result<Audio> {
    if bytes.is_empty() {
        return Err(message("Engine returned empty audio"));
    }
    let extension = if kind.contains("mpeg") || kind.contains("mp3") {
        "mp3"
    } else {
        "wav"
    };
    Ok((bytes, extension.into()))
}

fn multipart_parts(ctype: &str, body: &[u8], include_audio: bool) -> Result<Parts> {
    if !ctype.to_lowercase().starts_with("multipart/") {
        return Err(message(format!("Unexpected engine response: {ctype}")));
    }
    let mut bytes = format!("Content-Type: {ctype}\r\nMIME-Version: 1.0\r\n\r\n").into_bytes();
    bytes.extend(body);
    let parsed = mailparse::parse_mail(&bytes).map_err(|error| message(error.to_string()))?;
    let mut result = Parts {
        audio: None,
        metadata: None,
    };
    for part in &parsed.subparts {
        if include_audio && result.audio.is_none() && part.ctype.mimetype.starts_with("audio/") {
            result.audio = Some((
                part.get_body_raw()
                    .map_err(|error| message(error.to_string()))?,
                part.ctype.mimetype.clone(),
            ));
        } else if result.metadata.is_none() && part.ctype.mimetype.starts_with("application/json") {
            result.metadata = Some(
                part.get_body_raw()
                    .map_err(|error| message(error.to_string()))?,
            );
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn binary_synthesis_reuses_buffer_and_preserves_boundary_like_audio() {
        let audio = b"\x00\xff--song\r\n--song-extra\r\n--song--extra\r\n\x80\r\n";
        let mut body = b"preamble\r\n--song\r\nContent-Type: audio/wav\r\nContent-Transfer-Encoding: binary\r\n\r\n".to_vec();
        body.extend(audio);
        body.extend(b"\r\n--song \t\r\nContent-Type: application/json\r\n\r\n[{\"bpm\":120}]\r\n--song--\r\nepilogue");
        let pointer = body.as_ptr();
        let (bytes, extension, metadata) =
            extract_generation("Multipart/mixed; boundary=\"song\"", body).unwrap();
        assert_eq!(bytes, audio);
        assert_eq!(bytes.as_ptr(), pointer);
        assert_eq!(extension, "wav");
        assert_eq!(metadata, Some(json!({"bpm":120})));
    }

    #[test]
    fn bare_audio_reuses_buffer_and_encoded_parts_still_decode() {
        let audio = vec![0, 255, 128];
        let pointer = audio.as_ptr();
        let (bytes, extension, metadata) = extract_generation("audio/mpeg", audio).unwrap();
        assert_eq!(bytes, [0, 255, 128]);
        assert_eq!(bytes.as_ptr(), pointer);
        assert_eq!(extension, "mp3");
        assert!(metadata.is_none());

        let body = b"--song\nContent-Type: application/json\nContent-Transfer-Encoding: quoted-printable\n\n{\"bpm\":12=30}\n--song\nContent-Type: audio/mpeg\nContent-Transfer-Encoding: Base64\n\nAP+A\n--song--";
        let (decoded, extension, metadata) =
            extract_generation("multipart/mixed; boundary=song", body.to_vec()).unwrap();
        assert_eq!(decoded, bytes);
        assert_eq!(extension, "mp3");
        assert_eq!(metadata, Some(json!({"bpm":120})));
    }

    #[test]
    fn malformed_synthesis_parts_are_rejected() {
        let ctype = "multipart/mixed; boundary=song";
        let audio = b"--song\r\nContent-Type: audio/wav\r\n\r\nvalid bytes";
        for suffix in [
            b"".as_slice(),
            b"\r\n--song--incomplete",
            b"\r\n--song\r\nContent-Type: application/json\r\n\r\n{\r\n--song--\r\n",
        ] {
            let mut body = audio.to_vec();
            body.extend(suffix);
            assert!(extract_generation(ctype, body).is_err());
        }
    }
}
