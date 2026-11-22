use serde::Serialize;
use serde_json::{json, Value};

fn object(properties: Value, required: &[&str]) -> Value {
    json!({"type":"object","additionalProperties":false,"properties":properties,"required":required})
}

fn number(min: impl Serialize, max: impl Serialize) -> Value {
    json!({"type":"number","minimum":min,"maximum":max})
}

fn slots(items: Value) -> Value {
    json!({"type":"array","minItems":4,"maxItems":4,"items":items})
}

fn dynamics() -> Value {
    let boolean = json!({"type":"boolean"});
    object(
        json!({
            "attack_ms":number(0.1,200),"release_ms":number(10,1000),"makeup_db":number(-12,18),"knee_db":number(0,24),
            "limiter":boolean,"mix":number(0,100),"threshold_db":number(-60,0),"ratio":number(1,20),
            "limit_ratio":boolean,"brickwall":boolean,"optical":boolean,"auto_gain":boolean,
            "mode":{"enum":["standard","optical","fet","vca"]},
            "fet_attack_us":number(20,800),"fet_release_ms":number(50,1100),"fet_ratio":{"enum":[4,8,12,20]},
            "vca_attack_ms":{"enum":[0.1,0.3,1,3,10,30]},"vca_release_ms":{"enum":[0,100,200,400,800,1600]},
            "vca_ratio":{"enum":[1.5,2,3,4,5,10]}
        }),
        &[],
    )
}

fn channel_fx() -> Value {
    object(
        json!({
            "low_db":number(-12,12),"mid_db":number(-12,12),"high_db":number(-12,12),
            "comp":number(0,100),"limit":number(0,100),"width":number(0,200),"filter":number(-100,100),
            "de_ess":number(0,100),"dynamics":dynamics()
        }),
        &[],
    )
}

fn dynamic_eq() -> Value {
    let band = object(
        json!({
            "frequency_hz":number(40,18000),"threshold_db":number(-60,-3),"reduction_db":number(1,24),"q":number(0.3,12)
        }),
        &["frequency_hz", "threshold_db", "reduction_db", "q"],
    );
    object(
        json!({
            "bands":{"type":"array","maxItems":8,"items":band},"bypass":{"type":"boolean"}
        }),
        &[],
    )
}

fn effect(kind: &str, properties: Value) -> Value {
    let mut properties = properties.as_object().expect("effect properties").clone();
    properties.insert("kind".into(), json!({"const":kind}));
    let names: Vec<_> = properties.keys().cloned().collect();
    let required: Vec<_> = names.iter().map(String::as_str).collect();
    object(Value::Object(properties), &required)
}

fn fx_return() -> Value {
    let boolean = json!({"type":"boolean"});
    let damping = number(800, 16000);
    object(
        json!({
            "effect":{"oneOf":[
                effect("off",json!({})),
                effect("reverb",json!({"decay_s":number(0.2,8),"size":number(40,150),"damping_hz":damping})),
                effect("delay",json!({"time_ms":number(10,1200),"feedback":number(0,90),"damping_hz":damping})),
                effect("slap_delay",json!({"time_ms":number(45,220),"spread_ms":number(0,60),"damping_hz":damping})),
                effect("chorus",json!({"rate_hz":number(0.1,5),"depth_ms":number(0.5,12),"stereo":number(0,100)}))
            ]},
            "level":number(0,100),"enabled":boolean,"mute":boolean,"solo":boolean,
            "gain_db":number(-60,18),"gain_off":boolean,"fx":channel_fx()
        }),
        &["effect", "level"],
    )
}

pub(super) fn mix() -> Value {
    let boolean = json!({"type":"boolean"});
    let frame = json!({"type":"integer","minimum":0});
    let seconds =
        json!({"type":"number","minimum":0,"description":"Seconds within the mix range."});
    let track = object(
        json!({
            "role":{"type":"string","minLength":1,"maxLength":200},"name":{"type":"string","minLength":1,"maxLength":80},
            "replacement":{"type":["string","null"],"description":"Managed layer role from this project."},
            "gain_db":number(-60,18),"gain_off":boolean,"pan":number(-1,1),
            "mute":boolean,"solo":boolean,"fade_in":seconds,"fade_out":seconds,"export":boolean,
            "fx":channel_fx(),"dynamic_eq":dynamic_eq(),"sends":slots(number(0,100))
        }),
        &[
            "role", "name", "gain_db", "pan", "mute", "solo", "fade_in", "fade_out",
        ],
    );
    object(
        json!({
            "version":{"type":"integer","enum":[1,2]},
            "tracks":{"type":"array","maxItems":32,"items":track,"description":"Keep project roles in order, followed by optional layer roles."},
            "master_db":number(-60,18),"master_off":boolean,"master_comp":number(0,100),
            "master_limit":number(0,100),"master_dynamics":dynamics(),"fx_returns":slots(fx_return()),
            "first":frame,"end":frame,"looping":boolean
        }),
        &["tracks", "master_db", "first", "end", "looping"],
    )
}
