use serde::Deserialize;
use std::sync::OnceLock;

#[derive(Deserialize)]
struct Words {
    adj: Vec<String>,
    noun: Vec<String>,
}

/// Use the same offline word pairs as the studio's title dice.
pub(crate) fn random_title() -> String {
    static WORDS: OnceLock<Words> = OnceLock::new();
    let words = WORDS.get_or_init(|| {
        serde_json::from_str(include_str!("../../assets/random-titles.json"))
            .expect("embedded random title words")
    });
    let random = uuid::Uuid::new_v4().as_u128();
    let adjective = (random % words.adj.len() as u128) as usize;
    let noun = (random / words.adj.len() as u128 % words.noun.len() as u128) as usize;
    format!("{} {}", words.adj[adjective], words.noun[noun])
}
