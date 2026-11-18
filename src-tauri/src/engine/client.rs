use super::progress::{stream_logs, Progress};
use crate::error::{message, Error, Result};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    path::PathBuf,
    time::{Duration, Instant},
};
use tokio_util::sync::CancellationToken;

#[derive(Clone)]
pub struct EngineClient {
    pub http: reqwest::Client,
    pub synth: String,
    pub lm: String,
    pub poll: Duration,
    pub timeout: Duration,
    pub synth_log: Option<PathBuf>,
}

impl EngineClient {
    pub fn new(synth: String, lm: String, poll: f64, timeout: f64) -> Result<Self> {
        Ok(Self {
            http: reqwest::Client::builder()
                .no_proxy()
                .timeout(Duration::from_secs(120))
                .build()?,
            synth,
            lm,
            poll: Duration::from_secs_f64(poll),
            timeout: Duration::from_secs_f64(timeout * 60.0),
            synth_log: None,
        })
    }

    pub async fn operation(
        &self,
        base: &str,
        endpoint: &str,
        request: reqwest::RequestBuilder,
        cancel: &CancellationToken,
        progress: impl Fn(Progress),
    ) -> Result<(String, Vec<u8>)> {
        let started = Instant::now();
        let admission = async {
            let response = checked(request.send().await?).await?;
            Ok::<Value, Error>(response.json().await?)
        };
        let job = tokio::select! {
            _ = cancel.cancelled() => return Err(Error::Cancelled),
            result = tokio::time::timeout(self.timeout, admission) => result.unwrap_or_else(|_|Err(timeout_error(endpoint,started.elapsed())))?,
        };
        let jid = match &job["id"] {
            Value::String(s) => s.clone(),
            Value::Number(n) => n.to_string(),
            _ => return Err(message("Engine returned no job ID")),
        };
        let remaining = self.timeout.saturating_sub(started.elapsed());
        let outcome = tokio::select! {
            _ = cancel.cancelled() => Err(Error::Cancelled),
            r = tokio::time::timeout(remaining, self.track(base, &jid, endpoint, &progress)) => r.unwrap_or_else(|_| Err(timeout_error(endpoint, started.elapsed()))),
        };
        if outcome.is_err() {
            let _ = self
                .http
                .post(format!("{base}/job"))
                .query(&[("id", jid.as_str()), ("cancel", "1")])
                .timeout(Duration::from_secs(5))
                .send()
                .await;
        }
        outcome
    }

    async fn track(
        &self,
        base: &str,
        jid: &str,
        endpoint: &str,
        progress: &impl Fn(Progress),
    ) -> Result<(String, Vec<u8>)> {
        let start = Instant::now();
        let phase = if endpoint == "lm" { "lm" } else { "synth" };
        let (latest, current) = tokio::sync::watch::channel(Progress::new(phase));
        let report = |mut update: Progress| {
            update.elapsed_seconds = start.elapsed().as_secs();
            if *latest.borrow() != update {
                latest.send_replace(update.clone());
                progress(update);
            }
        };
        progress(current.borrow().clone());
        tokio::select! {
            result = self.wait(base, jid, start, current, progress) => result,
            _ = stream_logs(&self.http, base, jid, report) => unreachable!(),
        }
    }

    async fn wait(
        &self,
        base: &str,
        jid: &str,
        start: Instant,
        current: tokio::sync::watch::Receiver<Progress>,
        progress: &impl Fn(Progress),
    ) -> Result<(String, Vec<u8>)> {
        let mut last = None;
        loop {
            let state: Value = self.get_job(base, jid, false).await?.json().await?;
            let status = state["status"].as_str().unwrap_or("").to_lowercase();
            if status == "done" {
                let response = self.get_job(base, jid, true).await?;
                let ctype = response
                    .headers()
                    .get("content-type")
                    .and_then(|s| s.to_str().ok())
                    .unwrap_or("")
                    .to_string();
                return Ok((ctype, response.bytes().await?.into()));
            }
            if ["err", "fail", "cancel"]
                .iter()
                .any(|word| status.contains(word))
            {
                return Err(message(format!("Engine job failed: {state}")));
            }
            let mut update = current.borrow().clone();
            update.elapsed_seconds = start.elapsed().as_secs();
            if last.as_ref() != Some(&update) {
                progress(update.clone());
                last = Some(update);
            }
            tokio::time::sleep(self.poll).await;
        }
    }

    async fn get_job(&self, base: &str, jid: &str, result: bool) -> Result<reqwest::Response> {
        let mut last = None;
        for attempt in 0..4 {
            let mut request = self.http.get(format!("{base}/job")).query(&[("id", jid)]);
            if result {
                request = request.query(&[("result", "1")]);
            }
            match request.send().await {
                Ok(response) => return checked(response).await,
                Err(e) => last = Some(e),
            }
            tokio::time::sleep(Duration::from_millis(300 * (attempt + 1))).await;
        }
        Err(last.unwrap().into())
    }

    pub async fn language_model(
        &self,
        request: &Value,
        cancel: &CancellationToken,
        progress: impl Fn(Progress),
    ) -> Result<Value> {
        let (ctype, body) = self
            .operation(
                &self.lm,
                "lm",
                self.http.post(format!("{}/lm", self.lm)).json(request),
                cancel,
                progress,
            )
            .await?;
        extract_json(&ctype, &body)
    }

    pub async fn analyze(
        &self,
        data: Vec<u8>,
        filename: String,
        models: &crate::catalog::Selection,
        cancel: &CancellationToken,
    ) -> Result<Value> {
        let part = reqwest::multipart::Part::bytes(data).file_name(filename);
        let request = self
            .http
            .post(format!("{}/understand", self.lm))
            .multipart(reqwest::multipart::Form::new().part("audio", part).text("request", json!({"lm_model":models.language,"synth_model":models.synthesis,"vae":"vae-BF16.gguf"}).to_string()));
        let (ctype, body) = self
            .operation(&self.lm, "understand", request, cancel, |_| {})
            .await?;
        extract_json(&ctype, &body)
    }
}

fn timeout_error(endpoint: &str, elapsed: Duration) -> Error {
    Error::EngineTimeout {
        operation: match endpoint {
            "lm" => "LM",
            "synth" => "Synthese / Synthesis",
            "understand" => "Analyse / Analysis",
            other => other,
        }
        .to_owned(),
        minutes: (elapsed.as_secs_f64() / 60.0).round().max(1.0) as u64,
    }
}

pub fn limit_audio_codes(enriched: &mut Value, params: &Value) {
    let seconds = params["duration"]
        .as_f64()
        .filter(|n| n.is_finite() && *n > 0.0)
        .or_else(|| {
            enriched["duration"]
                .as_f64()
                .filter(|n| n.is_finite() && *n > 0.0)
        })
        .unwrap_or(600.0)
        .min(600.0);
    let limit = (seconds * 5.0).round() as usize;
    let codes: Vec<_> = enriched["audio_codes"]
        .as_str()
        .unwrap_or("")
        .split(',')
        .filter(|code| !code.trim().is_empty())
        .collect();
    if codes.len() > limit {
        enriched["audio_codes"] = json!(codes[..limit].join(","));
    }
}

async fn checked(response: reqwest::Response) -> Result<reqwest::Response> {
    if response.status().is_success() {
        return Ok(response);
    }
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    Err(message(format!(
        "Engine HTTP {status}: {}",
        text.chars().take(500).collect::<String>()
    )))
}

pub use super::response::{extract_audio, extract_json};

pub fn selftest_ok(result: &Value) -> bool {
    let codes: Vec<&str> = result["audio_codes"]
        .as_str()
        .unwrap_or("")
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .collect();
    let distinct: HashSet<_> = codes.iter().collect();
    let bpm = result["bpm"]
        .as_f64()
        .or_else(|| result["bpm"].as_str().and_then(|s| s.parse().ok()))
        .unwrap_or(0.0);
    bpm > 0.0
        && !result["keyscale"].as_str().unwrap_or("").is_empty()
        && (30..=70).contains(&codes.len())
        && distinct.len() as f64 / codes.len().max(1) as f64 > 0.3
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timeout_includes_stage_rounded_minutes_and_settings_guidance() {
        for (seconds, minutes) in [(0.08, 1), (60.0, 1), (90.0, 2), (1800.0, 30)] {
            for (endpoint, stage) in [
                ("lm", "LM"),
                ("synth", "Synthese"),
                ("understand", "Analyse"),
            ] {
                let error = timeout_error(endpoint, Duration::from_secs_f64(seconds));
                assert!(matches!(error, Error::EngineTimeout { minutes: n, .. } if n == minutes));
                let text = error.to_string();
                assert!(text.contains(stage));
                assert!(text.contains(&format!("nach {minutes} Min.")));
                assert!(text.contains("Timeout-Zeit erhöhen"));
                assert!(text.contains("Raise the timeout in the settings"));
                assert_eq!(serde_json::to_value(&error).unwrap(), json!(text));
            }
        }
    }
}
