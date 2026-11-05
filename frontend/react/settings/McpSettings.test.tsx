// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { McpSettings } from "./McpSettings";
import { setLang, t } from "../../i18n.js";
import { LANGS } from "../../locales";
import { mcpKeys, mcpTranslations } from "../../mcp-i18n";
import type { McpSettingsStatus, McpHttpConnection, McpSettings as Preferences } from "../../types";

const mocks = vi.hoisted(() => ({ mcpSettings: vi.fn(), saveMcpSettings: vi.fn(), mcpHttpConnection: vi.fn() }));
vi.mock("../../backend", () => ({ backend: mocks }));
const inactive: McpSettingsStatus = { enabled: false, port: 0, scope: "local", urls: [], running: false, url: null, config_path: "/data/mcp.json", client_config: '{"mcpServers":{"music-generator":{"command":"/app/music-generator","args":["--mcp-stdio","/data/mcp.json"]}}}', managed_by_environment: false, error: null };
const active: McpSettingsStatus = { ...inactive, enabled: true, running: true, url: "http://127.0.0.1:32123/mcp", urls: ["http://127.0.0.1:32123/mcp"] };
const credentials: McpHttpConnection = { url: active.url!, token: "test-access-key-1234567890", client_config: JSON.stringify({mcpServers:{"music-generator":{url:active.url,headers:{Authorization:"Bearer test-access-key-1234567890"}}}}) };
const busy = vi.fn();
const clipboard = vi.fn();
beforeEach(() => {
  vi.resetAllMocks(); setLang("en"); mocks.mcpSettings.mockResolvedValue(inactive);
  mocks.saveMcpSettings.mockImplementation(async (settings: Preferences) => ({ ...inactive, ...settings, running: settings.enabled, url: settings.enabled ? active.url : null, urls: settings.enabled ? active.urls : [] }));
  mocks.mcpHttpConnection.mockResolvedValue(credentials);
  vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: clipboard } });
  clipboard.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const view = () => render(<McpSettings onBusyChange={busy} />);
const enable = () => screen.getByRole("checkbox", { name: t("mcp_enable") });
const port = () => screen.getByRole("textbox", { name: t("mcp_port") }) as HTMLInputElement;
const apply = () => screen.getByRole("button", { name: t("mcp_apply") });

it("provides complete MCP translations for every app language", () => {
  expect(Object.keys(mcpTranslations).sort()).toEqual(Object.keys(LANGS).sort());
  for (const messages of Object.values(mcpTranslations)) {
    expect(messages).toHaveLength(mcpKeys.length);
    expect(messages.every(value => value.trim().length > 0)).toBe(true);
  }
});

it("starts disabled, applies explicitly, and can stop the running server", async () => {
  view(); await screen.findByText(t("mcp_off"));
  expect(mocks.saveMcpSettings).not.toHaveBeenCalled();
  expect((apply() as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(enable());
  fireEvent.change(port(), { target: { value: "32123" } });
  expect(mocks.saveMcpSettings).not.toHaveBeenCalled();
  fireEvent.click(apply());
  await screen.findByText(t("mcp_on"));
  expect(mocks.saveMcpSettings).toHaveBeenLastCalledWith({ enabled: true, port: 32123, scope: "local" });
  expect(screen.getByText(active.url!)).toBeTruthy();
  fireEvent.click(enable()); fireEvent.click(apply());
  await screen.findByText(t("mcp_off"));
  expect(mocks.saveMcpSettings).toHaveBeenLastCalledWith({ enabled: false, port: 32123, scope: "local" });
  expect(screen.queryByRole("button", { name: t("mcp_copy") })).toBeNull();
  expect(busy.mock.calls).toEqual([[true], [false], [true], [false]]);
});

it.each(["", "-1", "65536", "1.5", "1e3", "abc"])("rejects invalid port %s without calling the backend", async value => {
  view(); await screen.findByText(t("mcp_off")); fireEvent.click(enable());
  fireEvent.change(port(), { target: { value } });
  expect(port().getAttribute("aria-invalid")).toBe("true");
  expect((apply() as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(apply()); expect(mocks.saveMcpSettings).not.toHaveBeenCalled();
});

it("allows an automatic port and preserves the draft after a failed write for retry", async () => {
  mocks.saveMcpSettings.mockRejectedValueOnce(new Error("Address already in use"));
  view(); await screen.findByText(t("mcp_off"));
  fireEvent.click(enable()); fireEvent.click(apply());
  expect((await screen.findByRole("alert")).textContent).toContain("Address already in use");
  expect((enable() as HTMLInputElement).checked).toBe(true); expect(port().value).toBe("0");
  fireEvent.click(apply()); await screen.findByText(t("mcp_on"));
  expect(mocks.saveMcpSettings).toHaveBeenCalledTimes(2);
  expect(mocks.saveMcpSettings).toHaveBeenLastCalledWith({ enabled: true, port: 0, scope: "local" });
});

it("prevents duplicate writes and reports busy until application finishes", async () => {
  let finish!: (value: McpSettingsStatus) => void;
  mocks.saveMcpSettings.mockReturnValue(new Promise<McpSettingsStatus>(resolve => { finish = resolve; }));
  view(); await screen.findByText(t("mcp_off")); fireEvent.click(enable());
  const button = apply(); fireEvent.click(button); fireEvent.click(button);
  expect(mocks.saveMcpSettings).toHaveBeenCalledTimes(1); expect(busy).toHaveBeenLastCalledWith(true);
  expect(screen.getByRole("group").hasAttribute("disabled")).toBe(true);
  await act(async () => finish(active)); expect(busy).toHaveBeenLastCalledWith(false);
});

it.each([false, true])("retains the draft without claiming a failed service is active (refresh fails: %s)", async refreshFails => {
  mocks.mcpSettings.mockResolvedValueOnce(active);
  if (refreshFails) mocks.mcpSettings.mockRejectedValue(new Error("Status unavailable"));
  else mocks.mcpSettings.mockResolvedValue({ ...active, running: false, urls: [], url: null, error: "Could not restore listener" });
  mocks.saveMcpSettings.mockRejectedValue(new Error("Could not restore listener"));
  view(); await screen.findByText(t("mcp_on"));
  fireEvent.change(screen.getByLabelText(t("mcp_scope")), { target: { value: "network" } });
  fireEvent.click(apply());
  await waitFor(() => expect(busy).toHaveBeenLastCalledWith(false));
  expect(screen.getByText(t("mcp_failed"))).toBeTruthy();
  expect(screen.queryByText(t("mcp_on"))).toBeNull();
  expect((screen.getByLabelText(t("mcp_scope")) as HTMLSelectElement).value).toBe("network");
  expect((enable() as HTMLInputElement).checked).toBe(true);
  expect(screen.queryByRole("button", { name: t("mcp_copy") })).toBeNull();
  expect(mocks.mcpSettings).toHaveBeenCalledTimes(2);
});

it("locks environment-controlled settings while leaving configuration copying available", async () => {
  mocks.mcpSettings.mockResolvedValue({ ...active, managed_by_environment: true });
  view(); await screen.findByText(t("mcp_on"));
  expect(screen.getByText(t("mcp_environment"))).toBeTruthy();
  expect(enable().closest("fieldset")!.disabled).toBe(true);
  fireEvent.click(apply()); expect(mocks.saveMcpSettings).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: t("mcp_copy") }));
  await screen.findByText(t("mcp_copied")); expect(clipboard).toHaveBeenCalledWith(credentials.client_config);
});

it("reveals a selectable configuration when clipboard access fails", async () => {
  mocks.mcpSettings.mockResolvedValue(active); clipboard.mockRejectedValue(new Error("Denied"));
  view(); await screen.findByText(t("mcp_on"));
  fireEvent.click(screen.getByRole("button", { name: t("mcp_copy") }));
  await screen.findByText(t("mcp_copy_failed"));
  const configuration = screen.getByRole("textbox", { name: t("mcp_connection") }) as HTMLTextAreaElement;
  expect(configuration.readOnly).toBe(true); expect(configuration.value).toBe(credentials.client_config);
  expect(screen.getByLabelText(t("mcp_token")).getAttribute("type")).toBe("text");
});

it("retries a failed read and reads fresh settings after reopening", async () => {
  mocks.mcpSettings.mockRejectedValueOnce(new Error("Unavailable"));
  const first = view(); await screen.findByText(t("mcp_load_failed"));
  fireEvent.click(screen.getByRole("button", { name: t("settings_retry") }));
  await screen.findByText(t("mcp_off")); fireEvent.click(enable());
  first.unmount(); mocks.mcpSettings.mockResolvedValue(active);
  view(); await screen.findByText(t("mcp_on"));
  expect(mocks.mcpSettings).toHaveBeenCalledTimes(3);
  expect(mocks.saveMcpSettings).not.toHaveBeenCalled();
});

it("offers recovery when startup failed and updates labels without losing the draft", async () => {
  mocks.mcpSettings.mockResolvedValue({ ...inactive, enabled: true, error: "Address already in use" });
  view(); await screen.findByText(t("mcp_failed"));
  expect((apply() as HTMLButtonElement).disabled).toBe(false);
  fireEvent.change(port(), { target: { value: "43210" } });
  await act(async () => setLang("de"));
  expect(screen.getByRole("heading", { name: "MCP-Dienst" })).toBeTruthy(); expect(port().value).toBe("43210");
  fireEvent.click(apply()); await waitFor(() => expect(mocks.saveMcpSettings).toHaveBeenCalledWith({ enabled: true, port: 43210, scope: "local" }));
});

it("persists the LAN scope and chooses an advertised server address", async () => {
  const lan = { ...active, scope: "network" as const, urls: ["http://192.168.1.40:32123/mcp", active.url!] };
  mocks.saveMcpSettings.mockResolvedValue(lan);
  view(); await screen.findByText(t("mcp_off"));
  fireEvent.click(enable()); fireEvent.change(screen.getByLabelText(t("mcp_scope")), { target: { value: "network" } });
  expect(screen.getByText(t("mcp_network_hint"))).toBeTruthy();
  fireEvent.click(apply());
  await screen.findByText(t("mcp_on"));
  expect(mocks.saveMcpSettings).toHaveBeenCalledWith({ enabled: true, port: 0, scope: "network" });
  expect((screen.getByLabelText(t("mcp_endpoint")) as HTMLSelectElement).value).toBe(lan.urls[0]);
  expect(mocks.mcpHttpConnection).not.toHaveBeenCalled();
});

it("retrieves credentials only on request and masks the key and JSON by default", async () => {
  mocks.mcpSettings.mockResolvedValue(active);
  view(); await screen.findByText(t("mcp_on"));
  expect(mocks.mcpHttpConnection).not.toHaveBeenCalled();
  expect(screen.queryByLabelText(t("mcp_token"))).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: t("mcp_connection") }));
  const token = await screen.findByLabelText(t("mcp_token")) as HTMLInputElement;
  expect(mocks.mcpHttpConnection).toHaveBeenCalledWith(active.url);
  expect(token.type).toBe("password"); expect(token.value).toBe(credentials.token);
  const configuration = screen.getByRole("textbox", { name: t("mcp_connection") }) as HTMLTextAreaElement;
  expect(configuration.value).not.toContain(credentials.token);
  fireEvent.click(screen.getByRole("checkbox", { name: t("mcp_show_token") }));
  expect(token.type).toBe("text"); expect(configuration.value).toContain(credentials.token);
  expect(clipboard).not.toHaveBeenCalled();
});

it.each(["disable", "address", "unmount"])("discards a late credential result after %s", async change => {
  const lan = { ...active, scope: "network" as const, urls: ["http://192.168.1.40:32123/mcp", active.url!] };
  let finish!: (value: McpHttpConnection) => void;
  mocks.mcpSettings.mockResolvedValue(lan);
  mocks.mcpHttpConnection.mockReturnValue(new Promise<McpHttpConnection>(resolve => { finish = resolve; }));
  const mounted = view(); await screen.findByText(t("mcp_on"));
  fireEvent.click(screen.getByRole("button", { name: t("mcp_copy") }));
  await waitFor(() => expect(mocks.mcpHttpConnection).toHaveBeenCalledOnce());
  if (change === "disable") fireEvent.click(enable());
  if (change === "address") fireEvent.change(screen.getByLabelText(t("mcp_endpoint")), { target: { value: active.url } });
  if (change === "unmount") mounted.unmount();
  await act(async () => finish(credentials));
  expect(clipboard).not.toHaveBeenCalled();
  expect(screen.queryByLabelText(t("mcp_token"))).toBeNull();
});

it("clears revealed credentials when applying a change and reports credential failures without leaking details", async () => {
  mocks.mcpSettings.mockResolvedValue(active);
  view(); await screen.findByText(t("mcp_on"));
  fireEvent.click(screen.getByRole("button", { name: t("mcp_connection") }));
  await screen.findByLabelText(t("mcp_token"));
  fireEvent.change(port(), { target: { value: "43210" } });
  expect(screen.queryByLabelText(t("mcp_token"))).toBeNull();
  fireEvent.click(apply());
  await waitFor(() => expect((apply() as HTMLButtonElement).disabled).toBe(true));
  mocks.mcpHttpConnection.mockRejectedValue(new Error(credentials.token));
  fireEvent.click(screen.getByRole("button", { name: t("mcp_connection") }));
  expect((await screen.findByRole("alert")).textContent).toBe(t("mcp_credentials_failed"));
  expect(document.body.textContent).not.toContain(credentials.token);
});

it("explains when LAN mode has no usable non-loopback address", async () => {
  mocks.mcpSettings.mockResolvedValue({ ...active, scope: "network" });
  view(); await screen.findByText(t("mcp_on"));
  expect(screen.getByText(t("mcp_no_network"))).toBeTruthy();
});
