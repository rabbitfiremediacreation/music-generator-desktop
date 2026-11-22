use super::{GENERATE, PREVIEW, REPAIR, SCAN};
use crate::{mcp::tool, stems::model_layer::INSTRUMENTS};
use serde_json::{json, Value};

use super::super::{mix_schema::mix, schemas::id};

pub(in crate::mcp::operations::stems) fn tools() -> Vec<Value> {
    let mut generate = tool(GENERATE, "Generate an aligned instrument layer with an installed ACE-Step 1.5 Base or XL Base profile from list_models(view=installed). Context is the supplied mix, a saved version_id, or the default project mix. Poll get_operations for progress and the new role to add to mix.tracks. Cancel with cancel_job(target=operation).", json!({
        "project_id":id(),
        "selection":{
            "type":"object","additionalProperties":false,"required":["provider","synthesis"],
            "properties":{"provider":{"const":"ace-step"},"synthesis":id(),"language":{"type":"string","maxLength":200}}
        },
        "track":{"enum":INSTRUMENTS},
        "name":{"type":"string","minLength":1,"maxLength":80},
        "prompt":{"type":"string","maxLength":1000},
        "mix":mix(),"version_id":id()
    }), &["project_id","selection","track","name"], false, false);
    generate["inputSchema"]["not"] = json!({"required":["mix","version_id"]});
    let scan = tool(SCAN, "Scan an entire project track for possible tonal artifacts. Poll get_operations for candidate regions. Each region can be used as selection in preview_stem_repair or repair_stem_track.", json!({
        "project_id":id(),"role":id()
    }), &["project_id","role"], true, false);
    let preview = tool(PREVIEW, "Render aligned before.wav and after.wav in a new subdirectory of the chosen local destination. Select up to 20 seconds, plus up to 250 ms of context per side. Set whole_track=true to audition a whole-track repair over the excerpt. Poll get_operations for local paths and timing.", json!({
        "project_id":id(),"role":id(),"selection":repair_selection(true),
        "destination":{"type":"string","minLength":1,"description":"Existing absolute local directory. The tool creates a new subdirectory and preserves existing files."}
    }), &["project_id","role","selection","destination"], false, false);
    let repair = tool(REPAIR, "Create an aligned replacement layer using spectral attenuation, De-Click or De-Crackle. Repair a region or set whole_track=true. The original stays available. Poll get_operations for the replacement role, then set the channel's replacement in a mix snapshot and save it. Cancel with cancel_job(target=operation).", json!({
        "project_id":id(),"role":id(),"selection":repair_selection(false)
    }), &["project_id","role","selection"], false, false);
    vec![generate, scan, preview, repair]
}

fn repair_selection(preview: bool) -> Value {
    let spectral = json!({
        "low_hz":{"type":"number","minimum":20,"maximum":22050},
        "high_hz":{"type":"number","minimum":20,"maximum":22050},
        "reduction_db":{"type":"number","minimum":1,"maximum":36}
    });
    let impulse = json!({
        "effect":{
            "type":"object","additionalProperties":false,"required":["kind","sensitivity"],
            "properties":{"kind":{"enum":["de_click","de_crackle"]},"sensitivity":{"type":"number","minimum":1,"maximum":100}}
        }
    });
    json!({"oneOf":[
        repair_scope(spectral.clone(), false, preview),
        repair_scope(spectral, true, preview),
        repair_scope(impulse.clone(), false, preview),
        repair_scope(impulse, true, preview)
    ],"description":"first is inclusive and end exclusive. Region length is limited to 20 seconds. For whole-track repair, frames are needed only for the audition excerpt."})
}

fn repair_scope(mut properties: Value, whole_track: bool, preview: bool) -> Value {
    let mut required: Vec<_> = properties.as_object().unwrap().keys().cloned().collect();
    let frame = json!({"type":"integer","minimum":0,"description":"Project frame at 44.1 kHz."});
    properties["first"] = frame.clone();
    properties["end"] = frame;
    properties["whole_track"] = json!({"const":whole_track});
    if whole_track {
        required.push("whole_track".into());
    }
    if preview || !whole_track {
        required.extend(["first".into(), "end".into()]);
    }
    json!({"type":"object","additionalProperties":false,"required":required,"properties":properties})
}
