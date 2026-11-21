//! The compact two-voice ABC emitted by YuE2's full planner.
use std::fmt::Write;

const UNIT: u32 = 16;

#[derive(Clone, Copy)]
struct Note<'a> {
    pitch: &'a str,
    start: u32,
    end: u32,
    tied: bool,
    vocal: bool,
}

#[derive(Default)]
struct Bar<'a> {
    notes: Vec<Note<'a>>,
    chords: Vec<(u32, &'a str)>,
    end: u32,
}

fn number(text: &mut &str) -> Option<Option<u32>> {
    let digits = text.bytes().take_while(u8::is_ascii_digit).count();
    if digits == 0 {
        return Some(None);
    }
    let (value, rest) = text.split_at(digits);
    *text = rest;
    Some(Some(value.parse().ok()?))
}

fn length(text: &mut &str) -> Option<u32> {
    let numerator = number(text)?.unwrap_or(1);
    let slash_count = text.bytes().take_while(|&b| b == b'/').count();
    *text = &text[slash_count..];
    let denominator = match slash_count {
        0 => 1,
        1 => number(text)?.unwrap_or(2),
        2..=4 => 1 << slash_count,
        _ => return None,
    };
    let ticks = numerator.checked_mul(UNIT)?;
    (denominator > 0 && ticks >= denominator && ticks % denominator == 0)
        .then(|| ticks / denominator)
}

fn parse_bars<'a>(music: &'a str, bar_length: u32, vocal: bool) -> Option<Vec<Bar<'a>>> {
    let mut bars = Vec::new();
    for mut rest in music.trim().trim_end_matches('|').split('|') {
        rest = rest.trim();
        if let Some(mut count) = rest.strip_prefix('Z') {
            let repeat = number(&mut count)?.unwrap_or(1);
            if !count.is_empty() || !(1..=64).contains(&repeat) {
                return None;
            }
            bars.extend((0..repeat).map(|_| Bar {
                end: bar_length,
                ..Bar::default()
            }));
            continue;
        }
        let mut bar = Bar::default();
        while !rest.trim_start().is_empty() {
            rest = rest.trim_start();
            if let Some(chord) = rest.strip_prefix('"') {
                let quote = chord.find('"')? + 2;
                bar.chords.push((bar.end, &rest[..quote]));
                rest = &rest[quote..];
                continue;
            }
            let pitch_start = rest;
            rest = rest.trim_start_matches(['^', '_', '=']);
            let name = *rest.as_bytes().first()?;
            let note = matches!(name, b'A'..=b'G' | b'a'..=b'g');
            if !note && !matches!(name, b'z' | b'x') {
                return None;
            }
            rest = rest[1..].trim_start_matches([',', '\'']);
            let pitch = &pitch_start[..pitch_start.len() - rest.len()];
            let end = bar.end.checked_add(length(&mut rest)?)?;
            let tied = rest.starts_with('-');
            if tied {
                rest = &rest[1..];
            }
            if note {
                bar.notes.push(Note {
                    pitch,
                    start: bar.end,
                    end,
                    tied,
                    vocal,
                });
            }
            bar.end = end;
        }
        if bar.end == 0 {
            return None;
        }
        bars.push(bar);
    }
    Some(bars)
}

fn fraction(field: &str) -> Option<(u32, u32)> {
    let (num, den) = field.split_once('/')?;
    Some((num.trim().parse().ok()?, den.trim().parse().ok()?))
}

fn append_length(out: &mut String, ticks: u32) {
    let divisor = 1 << ticks.trailing_zeros().min(UNIT.trailing_zeros());
    if ticks == UNIT {
        return;
    }
    if divisor == UNIT {
        let _ = write!(out, "{}", ticks / UNIT);
    } else {
        let _ = write!(out, "{}/{}", ticks / divisor, UNIT / divisor);
    }
}

fn append_rest(out: &mut String, ticks: u32) {
    if ticks != 0 {
        out.push('z');
        append_length(out, ticks);
    }
}

fn note_letter(pitch: &str) -> &str {
    pitch.trim_start_matches(['^', '_', '='])
}

fn merge_bar<'a>(vocal: &Bar<'a>, ins: &Bar<'a>) -> Vec<Note<'a>> {
    let mut merged = vocal.notes.clone();
    // Accidentals are scoped to a voice and measure. Keep a single voice in
    // those bars so moving the melody cannot change the pitch of an Ins fill.
    let accidentals = vocal
        .notes
        .iter()
        .chain(&ins.notes)
        .any(|note| note_letter(note.pitch) != note.pitch);
    if merged.is_empty() || !accidentals {
        merged.extend(ins.notes.iter().copied().filter(|note| {
            vocal
                .notes
                .iter()
                .all(|lead| note.end <= lead.start || note.start >= lead.end)
        }));
        merged.sort_by_key(|note| note.start);
    }
    merged
}

fn render_pair(
    vocal: &[Bar<'_>],
    ins: &[Bar<'_>],
    next_group: Option<Note<'_>>,
) -> Option<(String, String, bool)> {
    if vocal.len() != ins.len() {
        return None;
    }
    let mut chords = String::new();
    let mut melody = String::new();
    let mut ends = Vec::with_capacity(vocal.len());
    let mut notes = Vec::with_capacity(vocal.len());
    for (vocal, ins) in vocal.iter().zip(ins) {
        let end = vocal.end.max(ins.end);
        let mut cursor = 0;
        for &(start, chord) in &vocal.chords {
            append_rest(&mut chords, start - cursor);
            chords.push_str(chord);
            cursor = start;
        }
        append_rest(&mut chords, end - cursor);
        chords.push('|');
        ends.push(end);
        notes.push(merge_bar(vocal, ins));
    }
    let has_notes = notes.iter().any(|bar| !bar.is_empty());
    for (index, bar) in notes.iter().enumerate() {
        let end = ends[index];
        let mut cursor = 0;
        for (position, note) in bar.iter().enumerate() {
            append_rest(&mut melody, note.start - cursor);
            melody.push_str(note.pitch);
            append_length(&mut melody, note.end - note.start);
            let continuation = bar
                .get(position + 1)
                .filter(|next| next.start == note.end)
                .or_else(|| {
                    (note.end == end)
                        .then(|| match notes.get(index + 1) {
                            Some(next) => next.first(),
                            None => next_group.as_ref(),
                        })
                        .flatten()
                        .filter(|next| next.start == 0)
                });
            if note.tied
                && continuation.is_some_and(|next| {
                    next.vocal == note.vocal && note_letter(next.pitch) == note_letter(note.pitch)
                })
            {
                melody.push('-');
            }
            cursor = note.end;
        }
        append_rest(&mut melody, end - cursor);
        melody.push('|');
    }
    Some((chords, melody, has_notes))
}

/// Leave the chords in Vocal over rests and move the lead melody to Ins.
pub(super) fn instrumental_score(score: &str) -> Option<String> {
    let mut lines = score.trim().lines().map(str::trim);
    let mut output = String::new();
    let mut bar_length = None;
    let mut meter = None;
    let mut unit = None;
    let mut has_notes = false;

    for line in lines.by_ref() {
        if let Some(value) = line.strip_prefix("M:") {
            meter = fraction(value);
        } else if let Some(value) = line.strip_prefix("L:") {
            unit = fraction(value);
        }
        writeln!(output, "{line}").ok()?;
        if line.starts_with("K:") {
            let (beats, beat) = meter?;
            let (numerator, denominator) = unit?;
            let ticks = beats.checked_mul(denominator)?.checked_mul(UNIT)?;
            let scale = beat.checked_mul(numerator)?;
            if scale != 0 && ticks >= scale && ticks % scale == 0 {
                bar_length = Some(ticks / scale);
            }
            break;
        }
    }

    let bar_length = bar_length?;
    let mut groups = Vec::new();
    let mut comments = String::new();
    while let Some(line) = lines.next() {
        if line.is_empty() || line.starts_with('%') {
            writeln!(comments, "{line}").ok()?;
            continue;
        }
        if line != "V: Vocal" {
            return None;
        }
        let vocal = parse_bars(lines.next()?, bar_length, true)?;
        if lines.next()? != "V: Ins" {
            return None;
        }
        let ins = parse_bars(lines.next()?, bar_length, false)?;
        groups.push((std::mem::take(&mut comments), vocal, ins));
    }
    for (index, (comments, vocal, ins)) in groups.iter().enumerate() {
        let next_group = groups
            .get(index + 1)
            .and_then(|(_, vocal, ins)| merge_bar(vocal.first()?, ins.first()?).first().copied());
        let (chords, melody, pitched) = render_pair(vocal, ins, next_group)?;
        has_notes |= pitched;
        output.push_str(comments);
        writeln!(output, "V: Vocal\n{chords}\nV: Ins\n{melody}").ok()?;
    }
    has_notes.then_some(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transfers_lead_notes_and_keeps_chords_and_nonoverlapping_fills() {
        let score = "X:1\nM:4/4\nL:1/16\nK:Dm\n% verse\nV: Vocal\n\"Gm7\"z4D4-D8|\"Dm\"z16|\nV: Ins\nA2z2F8z4|A16|";
        let converted = instrumental_score(score).unwrap();
        assert!(converted.ends_with("V: Vocal\n\"Gm7\"z16|\"Dm\"z16|\nV: Ins\nA2z2D4-D8|A16|\n"));
    }

    #[test]
    fn expands_multibar_rests_and_rejects_unpaired_voices() {
        let score = "X:1\nM:3/4\nL:1/16\nK:C\nV: Vocal\nZ2|\nV: Ins\nC12|E12|";
        assert!(instrumental_score(score).unwrap().contains("z12|z12|"));
        assert!(instrumental_score(&score.replace("E12|", "")).is_none());
    }

    #[test]
    fn preserves_lead_ties_between_sections() {
        let score = "X:1\nM:4/4\nL:1/16\nK:C\nV: Vocal\nC16-|\nV: Ins\nZ|\n% chorus\nV: Vocal\nC16|\nV: Ins\nZ|";
        let converted = instrumental_score(score).unwrap();
        assert!(converted.contains("V: Ins\nC16-|\n% chorus\nV: Vocal\nz16|\nV: Ins\nC16|"));
    }
}
