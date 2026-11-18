use std::hint::black_box;

#[allow(dead_code)]
mod baseline;
#[allow(dead_code)]
mod current;

// The production response parsers only need JSON errors and message errors.
mod error {
    pub type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;

    pub fn message(text: impl Into<String>) -> Box<dyn std::error::Error> {
        text.into().into()
    }
}

fn main() {
    let mut args = std::env::args().skip(1);
    let seconds: u32 = args.next().unwrap().parse().unwrap();
    let mode = args.next().unwrap();
    let data_size = seconds * 48_000 * 2 * 2;
    let metadata = serde_json::json!({"duration": seconds});
    let prefix = format!(
        "--example\r\nContent-Type: application/json\r\n\r\n{metadata}\r\n--example\r\nContent-Type: audio/wav\r\nContent-Transfer-Encoding: binary\r\n\r\n"
    );
    let suffix = b"\r\n--example--\r\n";
    let mut body = Vec::with_capacity(prefix.len() + 44 + data_size as usize + suffix.len());
    body.extend(prefix.as_bytes());
    body.extend(b"RIFF");
    body.extend((36 + data_size).to_le_bytes());
    body.extend(b"WAVEfmt ");
    body.extend(16_u32.to_le_bytes()); // fmt size
    body.extend(1_u16.to_le_bytes()); // PCM
    body.extend(2_u16.to_le_bytes()); // channels
    body.extend(48_000_u32.to_le_bytes());
    body.extend(192_000_u32.to_le_bytes()); // byte rate
    body.extend(4_u16.to_le_bytes()); // block alignment
    body.extend(16_u16.to_le_bytes()); // bits per sample
    body.extend(b"data");
    body.extend(data_size.to_le_bytes());
    body.resize(body.len() + data_size as usize, 0xa5);
    body.extend(suffix);

    let ctype = "multipart/mixed; boundary=example";
    let (audio, extension, parsed) = match mode.as_str() {
        "body" => {
            black_box(&body);
            return;
        }
        "baseline" => {
            let result = baseline::extract_generation(ctype, &body).unwrap();
            black_box(&body);
            result
        }
        "current" => current::extract_generation(ctype, body).unwrap(),
        _ => panic!("Unknown measurement mode: {mode}"),
    };
    assert_eq!(extension, "wav");
    assert_eq!(parsed.unwrap(), metadata);
    assert_eq!(audio.len(), 44 + data_size as usize);
    assert_eq!(&audio[..4], b"RIFF");
    assert_eq!(&audio[40..44], &data_size.to_le_bytes());
    assert!(audio[44..].iter().all(|byte| *byte == 0xa5));
    black_box(&audio);
}
