use super::{library, operations, resources, surface};
use crate::{error, state::AppState};
use rmcp::{model::*, service::RequestContext, ErrorData, RoleServer, ServerHandler};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    sync::{Arc, OnceLock},
};
use tauri::{AppHandle, Runtime};

pub struct MusicServer<R: Runtime> {
    state: Arc<AppState>,
    app: AppHandle<R>,
}

struct Definition {
    tool: Tool,
    validator: jsonschema::Validator,
}

fn definitions() -> &'static BTreeMap<String, Definition> {
    static TOOLS: OnceLock<BTreeMap<String, Definition>> = OnceLock::new();
    TOOLS.get_or_init(|| {
        surface::tools()
            .into_iter()
            .map(|value| {
                let validator = jsonschema::validator_for(&value["inputSchema"])
                    .expect("MCP tool schemas must be valid");
                let tool: Tool = serde_json::from_value(value).expect("MCP tool definition");
                (tool.name.to_string(), Definition { tool, validator })
            })
            .collect()
    })
}

impl<R: Runtime> MusicServer<R> {
    pub fn new(state: Arc<AppState>, app: AppHandle<R>) -> Self {
        Self { state, app }
    }

    pub(super) async fn dispatch(&self, name: &str, args: Value) -> error::Result<Value> {
        surface::call(self, name, args).await
    }

    pub(super) async fn dispatch_internal(&self, name: &str, args: Value) -> error::Result<Value> {
        if self.state.runtime.is_shutdown() {
            return Err(error::message("Music Generator is shutting down"));
        }
        if let Some(result) = library::call(name, args.clone(), self.state.clone(), &self.app).await
        {
            return result;
        }
        if let Some(result) = operations::call(name, args, self.state.clone(), &self.app).await {
            return result;
        }
        Err(error::message("Unknown tool"))
    }

    pub(super) async fn invoke(
        &self,
        name: &str,
        args: Value,
    ) -> Result<CallToolResult, ErrorData> {
        let definition = definitions()
            .get(name)
            .ok_or_else(|| ErrorData::invalid_params(format!("Unknown tool: {name}"), None))?;
        if let Err(error) = definition.validator.validate(&args) {
            return Ok(CallToolResult::error(vec![ContentBlock::text(format!(
                "Invalid arguments at {}: {error}",
                error.instance_path()
            ))]));
        }
        match self.dispatch(name, args).await {
            Ok(value) => Ok(CallToolResult::structured(json!({"result": value}))),
            Err(error) => Ok(CallToolResult::error(vec![ContentBlock::text(
                error.to_string(),
            )])),
        }
    }
}

impl<R: Runtime> ServerHandler for MusicServer<R> {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(
            ServerCapabilities::builder()
                .enable_tools()
                .enable_resources()
                .enable_prompts()
                .build(),
        )
        .with_server_info(Implementation::new(
            "music-generator",
            env!("CARGO_PKG_VERSION"),
        ))
        .with_instructions(resources::INSTRUCTIONS)
    }

    fn get_tool(&self, name: &str) -> Option<Tool> {
        definitions()
            .get(name)
            .map(|definition| definition.tool.clone())
    }

    async fn list_tools(
        &self,
        _: Option<PaginatedRequestParams>,
        _: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, ErrorData> {
        Ok(ListToolsResult::with_all_items(
            definitions().values().map(|d| d.tool.clone()).collect(),
        ))
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        _: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, ErrorData> {
        self.invoke(
            &request.name,
            Value::Object(request.arguments.unwrap_or_default()),
        )
        .await
        .map(Into::into)
    }

    async fn list_resources(
        &self,
        _: Option<PaginatedRequestParams>,
        _: RequestContext<RoleServer>,
    ) -> Result<ListResourcesResult, ErrorData> {
        Ok(resources::list())
    }

    async fn list_resource_templates(
        &self,
        _: Option<PaginatedRequestParams>,
        _: RequestContext<RoleServer>,
    ) -> Result<ListResourceTemplatesResult, ErrorData> {
        Ok(resources::templates())
    }

    async fn read_resource(
        &self,
        request: ReadResourceRequestParams,
        _: RequestContext<RoleServer>,
    ) -> Result<ReadResourceResponse, ErrorData> {
        let (tool, args) = resources::resolve(&request.uri)?;
        let value = self
            .dispatch_internal(tool, args)
            .await
            .map_err(|error| ErrorData::invalid_params(error.to_string(), None))?;
        Ok(
            ReadResourceResult::new(vec![ResourceContents::text(value.to_string(), request.uri)
                .with_mime_type("application/json")])
            .into(),
        )
    }

    async fn list_prompts(
        &self,
        _: Option<PaginatedRequestParams>,
        _: RequestContext<RoleServer>,
    ) -> Result<ListPromptsResult, ErrorData> {
        Ok(resources::prompts())
    }

    async fn get_prompt(
        &self,
        request: GetPromptRequestParams,
        _: RequestContext<RoleServer>,
    ) -> Result<GetPromptResponse, ErrorData> {
        resources::prompt(request).map(Into::into)
    }
}

#[cfg(all(test, unix))]
mod tests;
