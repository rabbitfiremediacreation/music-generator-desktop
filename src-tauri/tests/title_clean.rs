use music_generator::titles;

#[test]
fn automatic_title_removes_the_reported_intro_and_unclosed_quote() {
    assert_eq!(
        titles::clean("The song title is \"A Big Band with Screaming Horns").unwrap(),
        "A Big Band with Screaming Horns"
    );
}

#[test]
fn automatic_title_recognizes_labels_without_changing_real_title_words() {
    for raw in [
        "tItLe: Neon Rain",
        "TITEL: Neon Rain",
        "the song title is: Neon Rain",
        "THE SONG TITLE IS \"Neon Rain\"",
    ] {
        assert_eq!(titles::clean(raw).unwrap(), "Neon Rain", "{raw:?}");
    }
    for raw in ["Title Wave", "The Song Title Island", "Titelmelodie"] {
        assert_eq!(titles::clean(raw).unwrap(), raw);
    }
}

#[test]
fn automatic_title_removes_wrappers_and_sentence_periods_in_either_order() {
    for raw in [
        "\"Neon Rain\".",
        "„ Neon Rain. “",
        "` \"Neon Rain\". `.",
        "«Neon Rain",
        "Neon Rain»",
    ] {
        assert_eq!(titles::clean(raw).unwrap(), "Neon Rain", "{raw:?}");
    }
    assert_eq!(
        titles::clean("\r\n Titel: „夜の希望“.\r\nExplanation").unwrap(),
        "夜の希望"
    );
    assert_eq!(titles::clean("Don't Stop!").unwrap(), "Don't Stop!");
    assert_eq!(
        titles::clean("L’esprit de l’été").unwrap(),
        "L’esprit de l’été"
    );
}

#[test]
fn automatic_title_rejects_unusable_responses_for_the_fallback() {
    for raw in [
        "",
        "\n",
        "The song title is \"",
        "Title: ...",
        "\"---\"",
        "?!",
        "<think>reasoning",
        "bad\u{0001}title",
    ] {
        assert!(titles::clean(raw).is_err(), "{raw:?}");
    }
    assert!(titles::clean(&"長".repeat(121)).is_err());
    assert_eq!(titles::clean(&"長".repeat(120)).unwrap(), "長".repeat(120));
    assert_eq!(titles::clean("1999").unwrap(), "1999");
}
