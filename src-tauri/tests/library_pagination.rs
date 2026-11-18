use music_generator::{db::Database, types::SongFilter};
use rusqlite::{params, Connection};
use std::path::Path;

#[path = "support/wav.rs"]
mod wav;

const SONG_COUNT: u32 = 1000;
const PAGE_SIZE: u32 = 50;

fn fixture(root: &Path) -> Database {
    let db = Database::open(root).unwrap();
    let mut con = Connection::open(root.join("music.db")).unwrap();
    let tx = con.transaction().unwrap();
    tx.execute(
        "INSERT INTO folders VALUES('ideas', 'Ideas', '2026-01-01')",
        [],
    )
    .unwrap();

    for index in 0..SONG_COUNT {
        let date = format!("2026-01-{:02}T00:00:00Z", index % 3 + 1);
        let caption = if index % 5 == 1 {
            "night piano"
        } else {
            "piano"
        };
        let lyrics = if index % 5 == 2 {
            "the night falls"
        } else {
            ""
        };
        let prefix = if index % 5 == 0 { "Night" } else { "Song" };
        let folder = match index % 4 {
            0 | 2 => Some("ideas"),
            1 => None,
            _ => Some("removed-folder"),
        };
        tx.execute(
            "INSERT INTO songs (id, group_id, created_at, status, title, caption, lyrics, seed, params, file, favorite, folder_id)
             VALUES (?1, ?2, ?3, 'done', ?4, ?5, ?6, 0, '{}', 'fixture.wav', ?7, ?8)",
            params![index.to_string(), (index / 2).to_string(), date, format!("{prefix} {index:04}"), caption, lyrics, index % 7 < 5, folder],
        )
        .unwrap();
    }
    tx.commit().unwrap();
    db
}

#[test]
fn studio_pages_return_every_matching_song_once_including_timestamp_ties() {
    let root = tempfile::tempdir().unwrap();
    let db = fixture(root.path());
    let mut ordered: Vec<_> = (0..SONG_COUNT).collect();
    ordered.sort_by_key(|index| std::cmp::Reverse((index % 3, *index)));
    assert_eq!(ordered.last(), Some(&0));

    let all = SongFilter::default();
    let search = SongFilter {
        q: "night".into(),
        ..all.clone()
    };
    let folder = SongFilter {
        folder: "ideas".into(),
        ..all.clone()
    };
    let favorites = SongFilter {
        favorites: true,
        ..all.clone()
    };
    let combined = SongFilter {
        q: "night".into(),
        favorites: true,
        folder: "ideas".into(),
        ..all.clone()
    };
    let unfiled = SongFilter {
        folder: "none".into(),
        ..all.clone()
    };

    for (filter, matches) in [
        (all.clone(), (|_| true) as fn(u32) -> bool),
        (search, |i| i % 5 < 3),
        (folder, |i| i % 2 == 0),
        (favorites, |i| i % 7 < 5),
        (combined, |i| i % 2 == 0 && i % 5 < 3 && i % 7 < 5),
        (unfiled, |i| i % 2 == 1),
    ] {
        let expected: Vec<_> = ordered.iter().copied().filter(|i| matches(*i)).collect();
        let mut actual = Vec::new();
        for offset in (0..expected.len() as u32).step_by(PAGE_SIZE as usize) {
            let page = db.song_page(&filter, offset, PAGE_SIZE).unwrap();
            assert_eq!(page.total, expected.len() as u64);
            assert_eq!(
                page.songs.len(),
                (expected.len() - offset as usize).min(PAGE_SIZE as usize)
            );
            for song in page.songs {
                let index: u32 = song.id.parse().unwrap();
                assert_eq!(song.letter, if index % 2 == 0 { "A" } else { "B" });
                actual.push(index);
            }
        }
        assert_eq!(actual, expected, "{filter:?}");
    }
    let past_end = db.song_page(&all, SONG_COUNT, PAGE_SIZE).unwrap();
    assert!(past_end.songs.is_empty());
    assert_eq!(past_end.total, SONG_COUNT as u64);
    let no_hits = db
        .song_page(
            &SongFilter {
                q: "no match".into(),
                ..all.clone()
            },
            0,
            PAGE_SIZE,
        )
        .unwrap();
    assert_eq!(no_hits.total, 0);
    assert!(no_hits.songs.is_empty());
    assert!(db.song_page(&all, 0, 0).is_err());
    assert!(db.song_page(&all, 0, 101).is_err());

    let legacy = db.songs(&all).unwrap();
    assert_eq!(legacy.len(), 500);
    assert_eq!(
        legacy
            .iter()
            .map(|song| song.id.parse::<u32>().unwrap())
            .collect::<Vec<_>>(),
        ordered[..500]
    );
    assert_eq!(db.song("0").unwrap().id, "0");
}

#[test]
fn zip_contains_all_finished_songs_even_after_reading_one_studio_page() {
    let root = tempfile::tempdir().unwrap();
    let db = fixture(root.path());
    let songs_dir = root.path().join("songs");
    std::fs::create_dir(&songs_dir).unwrap();
    std::fs::write(songs_dir.join("fixture.wav"), wav::tone(0.1)).unwrap();

    let page = db
        .song_page(&SongFilter::default(), 500, PAGE_SIZE)
        .unwrap();
    assert_eq!(page.songs.len(), PAGE_SIZE as usize);
    assert!(page.songs.iter().all(|song| song.id != "0"));
    let destination = root.path().join("library.zip");
    db.export_zip("", &destination).unwrap();
    let archive = zip::ZipArchive::new(std::fs::File::open(destination).unwrap()).unwrap();
    assert_eq!(archive.len(), SONG_COUNT as usize);
    assert!(archive.file_names().any(|name| name == "Night 0000 A.wav"));
}
