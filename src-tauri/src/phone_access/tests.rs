use super::*;
use crate::{db::Database, synthesis_policy::Backend, types::CpuIterationBehavior};
use reqwest::header::{AUTHORIZATION, CONTENT_DISPOSITION, CONTENT_RANGE, RANGE};
use std::sync::atomic::{AtomicUsize, Ordering};
use tokio::io::AsyncWriteExt;
use tokio::time::{timeout, Duration};

fn wav(samples: usize) -> Vec<u8> {
    let data = (samples * 2) as u32;
    let mut out = Vec::new();
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&8000u32.to_le_bytes());
    out.extend_from_slice(&16000u32.to_le_bytes());
    out.extend_from_slice(&2u16.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data.to_le_bytes());
    out.extend((0..samples * 2).map(|i| (i % 251) as u8));
    out
}

struct Fixture {
    _root: tempfile::TempDir,
    state: Arc<AppState>,
    changes: Arc<AtomicUsize>,
    song: String,
    audio: Vec<u8>,
    base: String,
    http: reqwest::Client,
}

impl Fixture {
    async fn new() -> Self {
        let root = tempfile::tempdir().unwrap();
        let db = Database::open(root.path()).unwrap();
        let folder = db.folder_save(None, "Demos").unwrap()["id"]
            .as_str()
            .unwrap()
            .to_string();
        let ids = db
            .enqueue(&GenerateRequest {
                prompt: "warm piano".into(),
                title: "Rain Song".into(),
                variants: 2,
                folder_id: Some(folder),
                ..Default::default()
            })
            .unwrap();
        db.claim_next().unwrap();
        let songs = std::path::PathBuf::from(db.settings().unwrap().songs_dir);
        std::fs::create_dir_all(&songs).unwrap();
        let audio = wav(4000);
        std::fs::write(songs.join(format!("{}.wav", ids[0])), &audio).unwrap();
        db.finish(
            &ids[0],
            &format!("{}.wav", ids[0]),
            &json!({"bpm":120,"keyscale":"C major","vocal_language":"en","duration":"0.5"}),
        )
        .unwrap();
        // The second variant is rendering now.
        db.claim_next().unwrap();
        let state = Arc::new(AppState::new(db, root.path().join("resources")));
        let changes = Arc::new(AtomicUsize::new(0));
        let counter = changes.clone();
        let changed: Changed = Arc::new(move || {
            counter.fetch_add(1, Ordering::SeqCst);
        });
        let status = set(&state, changed, Some(true), false, 0).await.unwrap();
        Self {
            _root: root,
            base: format!("http://127.0.0.1:{}", status.port),
            state,
            changes,
            song: ids[0].clone(),
            audio,
            http: reqwest::Client::builder().no_proxy().build().unwrap(),
        }
    }

    fn token(&self) -> String {
        token(&self.state).unwrap()
    }

    fn get(&self, path: &str) -> reqwest::RequestBuilder {
        self.http
            .get(format!("{}{path}", self.base))
            .header(AUTHORIZATION, format!("Bearer {}", self.token()))
    }

    fn send(&self, method: reqwest::Method, path: &str) -> reqwest::RequestBuilder {
        self.http
            .request(method, format!("{}{path}", self.base))
            .header(AUTHORIZATION, format!("Bearer {}", self.token()))
    }
}

#[tokio::test]
async fn requests_need_the_current_key_and_stay_inside_the_api() {
    let f = Fixture::new().await;
    let url = format!("{}/api/songs", f.base);
    let missing = f
        .http
        .get(&url)
        .header("X-Lang", "de")
        .send()
        .await
        .unwrap();
    assert_eq!(missing.status(), 401);
    let body: Value = missing.json().await.unwrap();
    assert_eq!(body["detail"], "Zugangsschlüssel fehlt oder ist falsch.");
    let wrong = f
        .http
        .get(&url)
        .header(AUTHORIZATION, "Bearer wrong")
        .send()
        .await
        .unwrap();
    assert_eq!(wrong.status(), 401);
    assert_eq!(
        wrong.json::<Value>().await.unwrap()["detail"],
        "Access key missing or wrong."
    );
    assert_eq!(f.get("/api/songs").send().await.unwrap().status(), 200);
    for path in [
        "/api/remote",
        "/api/shutdown",
        "/api/update/apply",
        "/",
        "/index.html",
    ] {
        let response = f.get(path).send().await.unwrap();
        assert_eq!(response.status(), 403, "{path}");
        assert!(response.json::<Value>().await.unwrap()["detail"]
            .as_str()
            .unwrap()
            .contains("phone access"));
    }
    let settings = f
        .send(reqwest::Method::PUT, "/api/settings")
        .send()
        .await
        .unwrap();
    assert_eq!(settings.status(), 403);
    let unknown = f.get("/api/nothing").send().await.unwrap();
    assert_eq!(unknown.status(), 404);
    assert_eq!(
        unknown.json::<Value>().await.unwrap()["detail"],
        "Not Found"
    );
    // Rotating the key locks out the previous one immediately.
    let old = f.token();
    let rotated = set(&f.state, Arc::new(|| {}), None, true, 0).await.unwrap();
    assert_ne!(rotated.token, old);
    assert!(rotated.enabled);
    let stale = f
        .http
        .get(&url)
        .header(AUTHORIZATION, format!("Bearer {old}"))
        .send()
        .await
        .unwrap();
    assert_eq!(stale.status(), 401);
    assert_eq!(f.get("/api/songs").send().await.unwrap().status(), 200);
    f.state.phone_access.stop().await;
}

#[tokio::test]
async fn library_json_matches_the_web_app_contract() {
    let f = Fixture::new().await;
    let songs: Vec<Value> = f
        .get("/api/songs")
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(songs.len(), 2);
    let done = songs.iter().find(|s| s["id"] == f.song.as_str()).unwrap();
    assert_eq!(done["status"], "done");
    assert_eq!(done["title"], "Rain Song");
    assert_eq!(done["caption"], "warm piano");
    assert_eq!(done["favorite"], false);
    assert_eq!(done["letter"], "A");
    assert_eq!(done["url"], format!("/api/songs/{}/audio", f.song));
    assert!(done["folder_id"].is_string());
    assert!(done["created_at"].is_string());
    assert!(done.get("path").is_none());
    assert_eq!(done["result_meta"]["bpm"], 120.0);
    assert_eq!(done["result_meta"]["keyscale"], "C major");
    assert_eq!(done["result_meta"]["vocal_language"], "en");
    assert_eq!(done["result_meta"]["duration"], 0.5);
    let queued = songs.iter().find(|s| s["id"] != f.song.as_str()).unwrap();
    assert_eq!(queued["status"], "running");
    assert!(queued["url"].is_null());
    assert_eq!(queued["letter"], "B");

    let folders: Value = f
        .get("/api/folders")
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(folders["all"], 2);
    assert_eq!(folders["none"], 0);
    assert_eq!(folders["folders"][0]["name"], "Demos");
    assert_eq!(folders["folders"][0]["count"], 2);
    let folder = folders["folders"][0]["id"].as_str().unwrap().to_string();
    let filtered: Vec<Value> = f
        .get(&format!("/api/songs?folder={folder}&q=piano"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(filtered.len(), 2);
    let none: Vec<Value> = f
        .get("/api/songs?folder=none")
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(none.is_empty());

    let queue: Value = f
        .get("/api/queue")
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(queue["queued"], 0);
    assert_eq!(queue["running"].as_array().unwrap().len(), 1);
    assert_eq!(queue["running"][0]["caption"], "warm piano");
    assert!(queue["running"][0]["id"].is_string());

    // Favorite, move to a new folder, then back to unsorted with an explicit null.
    let favorite: Value = f
        .send(reqwest::Method::PATCH, &format!("/api/songs/{}", f.song))
        .json(&json!({"favorite":true}))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(favorite["favorite"], true);
    let favorites: Vec<Value> = f
        .get("/api/songs?favorites=true")
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(favorites.len(), 1);
    let created: Value = f
        .send(reqwest::Method::POST, "/api/folders")
        .json(&json!({"name":"  Phone  "}))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(created["name"], "Phone");
    let moved: Value = f
        .send(reqwest::Method::PATCH, &format!("/api/songs/{}", f.song))
        .json(&json!({"folder_id":created["id"]}))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(moved["folder_id"], created["id"]);
    let unsorted: Value = f
        .send(reqwest::Method::PATCH, &format!("/api/songs/{}", f.song))
        .json(&json!({"folder_id":null}))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(unsorted["folder_id"].is_null());
    assert_eq!(unsorted["favorite"], true);
    let empty = f
        .send(reqwest::Method::POST, "/api/folders")
        .json(&json!({"name":" "}))
        .send()
        .await
        .unwrap();
    assert_eq!(empty.status(), 422);
    let missing = f
        .send(reqwest::Method::PATCH, "/api/songs/missing")
        .json(&json!({"favorite":true}))
        .send()
        .await
        .unwrap();
    assert_eq!(missing.status(), 404);
    assert!(f.changes.load(Ordering::SeqCst) >= 4);
    f.state.phone_access.stop().await;
}

#[tokio::test]
async fn audio_streams_with_ranges_and_downloads_as_attachment() {
    let f = Fixture::new().await;
    let path = format!("/api/songs/{}/audio", f.song);
    let len = f.audio.len();
    let whole = f.get(&path).send().await.unwrap();
    assert_eq!(whole.status(), 200);
    assert_eq!(whole.headers()["accept-ranges"], "bytes");
    assert_eq!(whole.headers()["content-type"], "audio/wav");
    assert_eq!(whole.bytes().await.unwrap().as_ref(), f.audio.as_slice());

    let part = f
        .get(&path)
        .header(RANGE, "bytes=0-99")
        .send()
        .await
        .unwrap();
    assert_eq!(part.status(), 206);
    assert_eq!(part.headers()[CONTENT_RANGE], format!("bytes 0-99/{len}"));
    assert_eq!(part.headers()["content-length"], "100");
    assert_eq!(part.bytes().await.unwrap().as_ref(), &f.audio[..100]);

    let tail = f
        .get(&path)
        .header(RANGE, "bytes=-10")
        .send()
        .await
        .unwrap();
    assert_eq!(tail.status(), 206);
    assert_eq!(tail.bytes().await.unwrap().as_ref(), &f.audio[len - 10..]);
    let open = f
        .get(&path)
        .header(RANGE, "bytes=8000-")
        .send()
        .await
        .unwrap();
    assert_eq!(open.status(), 206);
    assert_eq!(open.bytes().await.unwrap().as_ref(), &f.audio[8000..]);
    let outside = f
        .get(&path)
        .header(RANGE, format!("bytes={len}-"))
        .send()
        .await
        .unwrap();
    assert_eq!(outside.status(), 416);
    assert_eq!(outside.headers()[CONTENT_RANGE], format!("bytes */{len}"));

    let download = f
        .get(&format!("{path}?download=true"))
        .send()
        .await
        .unwrap();
    assert_eq!(download.status(), 200);
    let seed = f.state.db.song(&f.song).unwrap().seed;
    assert_eq!(
        download.headers()[CONTENT_DISPOSITION].to_str().unwrap(),
        format!(
            "attachment; filename=\"Rain_Song_{seed}.wav\"; filename*=UTF-8''Rain_Song_{seed}.wav"
        )
    );
    assert_eq!(download.bytes().await.unwrap().len(), len);

    let songs = f.state.db.songs(&SongFilter::default()).unwrap();
    let running = songs.iter().find(|s| s.id != f.song).unwrap();
    let pending = f
        .get(&format!("/api/songs/{}/audio", running.id))
        .send()
        .await
        .unwrap();
    assert_eq!(pending.status(), 404);
    f.state.phone_access.stop().await;
}

#[tokio::test]
async fn generation_and_analysis_report_desktop_errors_as_json() {
    let f = Fixture::new().await;
    // Model setup is incomplete in the fixture, so admission refuses with the desktop message.
    let refused = f
        .send(reqwest::Method::POST, "/api/generate")
        .json(&json!({"prompt":"piano","bpm":0.0,"duration":90.0,"variants":2,"inference_steps":80,"lm_temperature":0.85,"vocal_language":"en","folder_id":null}))
        .send()
        .await
        .unwrap();
    assert_eq!(refused.status(), 400);
    assert!(refused.json::<Value>().await.unwrap()["detail"]
        .as_str()
        .unwrap()
        .contains("model setup"));
    let invalid = f
        .send(reqwest::Method::POST, "/api/generate")
        .body("not json")
        .send()
        .await
        .unwrap();
    assert_eq!(invalid.status(), 422);
    let negative = f
        .send(reqwest::Method::POST, "/api/generate")
        .json(&json!({"prompt":"piano","bpm":-1}))
        .send()
        .await
        .unwrap();
    assert_eq!(negative.status(), 422);

    let form = reqwest::multipart::Form::new().part(
        "audio",
        reqwest::multipart::Part::bytes(wav(100)).file_name("Aufnahme.wav"),
    );
    let analysis = f
        .send(reqwest::Method::POST, "/api/analyze")
        .multipart(form)
        .send()
        .await
        .unwrap();
    assert_eq!(analysis.status(), 400);
    assert_eq!(
        analysis.json::<Value>().await.unwrap()["detail"],
        "Complete model setup first"
    );
    let empty = f
        .send(reqwest::Method::POST, "/api/analyze")
        .multipart(reqwest::multipart::Form::new().text("other", "x"))
        .send()
        .await
        .unwrap();
    assert_eq!(empty.status(), 422);
    f.state.phone_access.stop().await;
}

#[test]
fn phone_requests_map_onto_desktop_generation() {
    let phone: PhoneGeneration = serde_json::from_value(json!({
        "prompt":"piano","style":"jazz","lyrics":"","instrumental":false,"title":"",
        "duration":90.0,"bpm":121.6,"keyscale":"","timesignature":"","inference_steps":80,
        "lm_temperature":0.85,"vocal_language":"en","variants":2,"folder_id":""
    }))
    .unwrap();
    let request = phone.request("group".into()).unwrap();
    assert_eq!(request.bpm, 122);
    assert_eq!(request.inference_steps, 80);
    assert_eq!(request.variants, 2);
    assert_eq!(request.seed, -1);
    assert!(request.keep_caption);
    assert!(!request.instrumental);
    assert_eq!(request.lyrics, "");
    assert_eq!(request.group_id.as_deref(), Some("group"));
    assert_eq!(request.folder_id, None);
    assert!(request.model_selection.is_none());
    let defaults: PhoneGeneration = serde_json::from_value(json!({"prompt":"x"})).unwrap();
    assert!(defaults.instrumental);
    assert!(PhoneGeneration {
        bpm: f64::NAN,
        ..Default::default()
    }
    .request("g".into())
    .is_err());
}

#[test]
fn cpu_iterations_follow_the_desktop_setting_without_a_dialog() {
    use CpuIterationBehavior::*;
    assert_eq!(cpu_steps(Backend::Gpu, Ask, 80, 50), 80);
    assert_eq!(cpu_steps(Backend::Cpu, Ask, 80, 50), 30);
    assert_eq!(cpu_steps(Backend::Unknown, Limit30, 80, 50), 30);
    assert_eq!(cpu_steps(Backend::Cpu, Continue, 80, 50), 80);
    assert_eq!(cpu_steps(Backend::Cpu, Ask, 20, 50), 20);
    assert_eq!(cpu_steps(Backend::Cpu, Ask, 0, 50), 30);
    assert_eq!(cpu_steps(Backend::Cpu, Ask, 0, 8), 0);
}

#[test]
fn ranges_follow_rfc_7233() {
    assert_eq!(byte_range(None, 100), None);
    assert_eq!(byte_range(Some("bytes=0-99"), 1000), Some(Ok((0, 99))));
    assert_eq!(byte_range(Some("bytes=10-"), 100), Some(Ok((10, 99))));
    assert_eq!(byte_range(Some("bytes=90-500"), 100), Some(Ok((90, 99))));
    assert_eq!(byte_range(Some("bytes=-20"), 100), Some(Ok((80, 99))));
    assert_eq!(byte_range(Some("bytes=-500"), 100), Some(Ok((0, 99))));
    assert_eq!(byte_range(Some("bytes=100-"), 100), Some(Err(())));
    assert_eq!(byte_range(Some("bytes=5-1"), 100), Some(Err(())));
    assert_eq!(byte_range(Some("bytes=-0"), 100), Some(Err(())));
    assert_eq!(byte_range(Some("bytes=0-1,5-6"), 100), None);
    assert_eq!(byte_range(Some("items=0-1"), 100), None);
}

#[test]
fn keys_and_filenames_are_safe() {
    let a = new_token();
    assert_eq!(a.len(), 24);
    assert!(a
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
    assert_ne!(a, new_token());
    assert!(same_secret(b"Bearer x", b"Bearer x"));
    assert!(!same_secret(b"Bearer x", b"Bearer y"));
    assert!(!same_secret(b"", b"Bearer y"));
    assert_eq!(
        attachment("Größe_1.wav"),
        "attachment; filename=\"Gr__e_1.wav\"; filename*=UTF-8''Gr%C3%B6%C3%9Fe_1.wav"
    );
    for address in addresses(PORT) {
        assert!(address.starts_with("http://") && address.ends_with(":8767"));
        assert!(!address.contains("127.0.0."));
    }
}

#[tokio::test]
async fn switch_persists_and_reports_a_busy_port() {
    let root = tempfile::tempdir().unwrap();
    let state = Arc::new(AppState::new(
        Database::open(root.path()).unwrap(),
        root.path().join("resources"),
    ));
    let off = status(&state).await.unwrap();
    assert!(!off.enabled);
    assert_eq!(off.port, PORT);
    assert_eq!(off.token, "");
    assert!(!enabled(&state).unwrap());

    let on = set(&state, Arc::new(|| {}), Some(true), false, 0)
        .await
        .unwrap();
    assert!(on.enabled);
    assert_eq!(on.token.len(), 24);
    assert!(enabled(&state).unwrap());
    let url = format!("http://127.0.0.1:{}/api/queue", on.port);
    let http = reqwest::Client::builder().no_proxy().build().unwrap();
    assert_eq!(
        http.get(&url)
            .bearer_auth(&on.token)
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    // Switching on again keeps the running listener and key.
    let again = set(&state, Arc::new(|| {}), Some(true), false, 0)
        .await
        .unwrap();
    assert_eq!(
        (again.port, again.token.as_str()),
        (on.port, on.token.as_str())
    );

    let off = set(&state, Arc::new(|| {}), Some(false), false, 0)
        .await
        .unwrap();
    assert!(!off.enabled);
    assert_eq!(off.token, on.token);
    assert!(!enabled(&state).unwrap());
    assert!(http.get(&url).bearer_auth(&on.token).send().await.is_err());

    let occupied = std::net::TcpListener::bind(("0.0.0.0", 0)).unwrap();
    let port = occupied.local_addr().unwrap().port();
    let busy = set(&state, Arc::new(|| {}), Some(true), false, port).await;
    assert_eq!(busy.unwrap_err().to_string(), "phone_access_port_busy");
    assert!(!enabled(&state).unwrap());
    assert!(!status(&state).await.unwrap().enabled);
    drop(occupied);
}

#[tokio::test]
async fn switching_off_cancels_an_incomplete_upload() {
    let f = Fixture::new().await;
    let mut connection = tokio::net::TcpStream::connect(f.base.trim_start_matches("http://"))
        .await
        .unwrap();
    connection
        .write_all(
            format!(
                "POST /api/analyze HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer {}\r\nContent-Type: multipart/form-data; boundary=upload\r\nContent-Length: 1048576\r\nExpect: 100-continue\r\n\r\n",
                f.token()
            )
            .as_bytes(),
        )
        .await
        .unwrap();
    // Hyper sends this only once the authenticated handler starts reading the body.
    let mut interim = [0; b"HTTP/1.1 100 Continue\r\n\r\n".len()];
    timeout(Duration::from_secs(2), connection.read_exact(&mut interim))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(&interim, b"HTTP/1.1 100 Continue\r\n\r\n");

    // No body is sent: shutdown must cancel this request, not wait for the phone.
    let off = timeout(
        Duration::from_secs(2),
        set(&f.state, Arc::new(|| {}), Some(false), false, 0),
    )
    .await
    .expect("an unfinished upload must not hold shutdown open")
    .unwrap();
    assert!(!off.enabled);
    let mut response = Vec::new();
    timeout(
        Duration::from_secs(2),
        connection.read_to_end(&mut response),
    )
    .await
    .expect("the upload connection must close")
    .unwrap();
    assert!(response.starts_with(b"HTTP/1.1 503"));
    assert_eq!(f.changes.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn switching_off_interrupts_a_download_and_can_be_enabled_again() {
    let f = Fixture::new().await;
    let song = f.state.db.song(&f.song).unwrap();
    // A sparse file larger than socket buffers keeps the response in flight without
    // allocating a large fixture or relying on sleeps or network timing.
    let length = 64 * 1024 * 1024;
    std::fs::OpenOptions::new()
        .write(true)
        .open(song.path.as_ref().unwrap())
        .unwrap()
        .set_len(length)
        .unwrap();
    let mut connection = tokio::net::TcpStream::connect(f.base.trim_start_matches("http://"))
        .await
        .unwrap();
    connection
        .write_all(
            format!(
                "GET /api/songs/{}/audio HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer {}\r\nConnection: close\r\n\r\n",
                f.song,
                f.token()
            )
            .as_bytes(),
        )
        .await
        .unwrap();
    let headers = timeout(Duration::from_secs(2), async {
        let mut headers = Vec::new();
        while !headers.ends_with(b"\r\n\r\n") {
            headers.push(connection.read_u8().await.unwrap());
            assert!(headers.len() < 4096);
        }
        headers
    })
    .await
    .unwrap();
    assert!(headers.starts_with(b"HTTP/1.1 200"));
    assert!(String::from_utf8(headers)
        .unwrap()
        .contains(&format!("content-length: {length}")));

    let cancelled = f
        .state
        .phone_access
        .server
        .lock()
        .await
        .as_ref()
        .unwrap()
        .stop
        .clone();
    let state = f.state.clone();
    let switch =
        tokio::spawn(async move { set(&state, Arc::new(|| {}), Some(false), false, 0).await });
    cancelled.cancelled().await;
    let mut received = Vec::new();
    let result = timeout(
        Duration::from_secs(2),
        connection.read_to_end(&mut received),
    )
    .await
    .expect("the download connection must close after switching off");
    // Depending on the platform Hyper's truncated response ends with EOF or a reset.
    if let Err(error) = result {
        assert_eq!(error.kind(), std::io::ErrorKind::ConnectionReset);
    }
    assert!(
        (received.len() as u64) < length,
        "the download continued after switching off"
    );
    assert!(!switch.await.unwrap().unwrap().enabled);
    assert!(!enabled(&f.state).unwrap());

    let on = set(&f.state, Arc::new(|| {}), Some(true), false, 0)
        .await
        .unwrap();
    assert!(on.enabled);
    assert_eq!(on.token, f.token());
    let response = f
        .http
        .get(format!("http://127.0.0.1:{}/api/queue", on.port))
        .bearer_auth(&on.token)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    // Turning off external access did not cancel the previously queued desktop work.
    assert_eq!(
        response.json::<Value>().await.unwrap()["running"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    f.state.phone_access.stop().await;
}
