// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { PhoneAccessField } from "./PhoneAccessField";
import type { PhoneAccess } from "../../types";
import { setLang } from "../../i18n.js";

const mocks = vi.hoisted(() => ({ phoneAccess: vi.fn(), setPhoneAccess: vi.fn() }));
vi.mock("../../backend", () => ({ backend: mocks }));
const off: PhoneAccess = { enabled: false, port: 8767, token: "", addresses: ["http://studio.local:8767", "http://192.168.1.20:8767"] };
const on: PhoneAccess = { ...off, enabled: true, token: "abc-DEF_123" };
const view = () => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><I18nProvider><PhoneAccessField /></I18nProvider></QueryClientProvider>;
const toggle = () => screen.getByRole("switch", { name: "Handy-Zugriff" }) as HTMLInputElement;

beforeEach(() => { vi.resetAllMocks(); setLang("de"); });
afterEach(cleanup);

it("shows QR code, addresses and key when switched on and hides them when off", async () => {
  mocks.phoneAccess.mockResolvedValue(off);
  mocks.setPhoneAccess.mockResolvedValueOnce(on).mockResolvedValueOnce({ ...on, token: "rotated" }).mockResolvedValueOnce({ ...off, token: "rotated" });
  render(view());
  await waitFor(() => expect(toggle().disabled).toBe(false));
  expect(toggle().checked).toBe(false);
  expect(screen.queryByTestId("phone-access-qr")).toBeNull();
  expect(screen.queryByTestId("phone-access-web-qr")).toBeNull();

  fireEvent.click(toggle());
  await screen.findByTestId("phone-access-qr");
  expect(mocks.setPhoneAccess.mock.calls[0][0]).toEqual({ enabled: true });
  expect(screen.getByTestId("phone-access-qr").querySelector("svg")).not.toBeNull();
  expect(screen.getByRole("heading", { name: "iPhone-App" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Web-App / PWA" })).toBeTruthy();
  expect(screen.getByTestId("phone-access-web-qr").querySelector("svg")).not.toBeNull();
  expect(screen.getAllByRole("listitem").map(li => li.textContent)).toEqual(on.addresses);
  const token = screen.getByRole("textbox", { name: "Zugangsschlüssel" }) as HTMLInputElement;
  expect(token.value).toBe("abc-DEF_123");
  expect(token.readOnly).toBe(true);

  fireEvent.click(screen.getByRole("button", { name: "Neuer Schlüssel" }));
  await waitFor(() => expect((screen.getByRole("textbox", { name: "Zugangsschlüssel" }) as HTMLInputElement).value).toBe("rotated"));
  expect(mocks.setPhoneAccess.mock.calls[1][0]).toEqual({ newToken: true });

  await waitFor(() => expect(toggle().disabled).toBe(false));
  fireEvent.click(toggle());
  await waitFor(() => expect(screen.queryByTestId("phone-access-qr")).toBeNull());
  expect(screen.queryByTestId("phone-access-web-qr")).toBeNull();
  expect(mocks.setPhoneAccess.mock.calls[2][0]).toEqual({ enabled: false });
  expect(screen.queryByRole("alert")).toBeNull();
});

it("reports a busy HTTPS port without exposing an internal error key", async () => {
  mocks.phoneAccess.mockResolvedValue(off);
  mocks.setPhoneAccess.mockRejectedValue(new Error("phone_access_https_port_busy"));
  render(view());
  await waitFor(() => expect(toggle().disabled).toBe(false));
  fireEvent.click(toggle());
  expect((await screen.findByRole("alert")).textContent).toBe("Handy-Zugriff ließ sich nicht starten: HTTPS-Port 8768 ist belegt.");
  await waitFor(() => expect(toggle().checked).toBe(false));
});

it("reports a busy port in the current language and shows the actual state", async () => {
  mocks.phoneAccess.mockResolvedValue(off);
  mocks.setPhoneAccess.mockRejectedValue(new Error("phone_access_port_busy"));
  render(view());
  await waitFor(() => expect(toggle().disabled).toBe(false));
  fireEvent.click(toggle());
  expect((await screen.findByRole("alert")).textContent).toBe("Handy-Zugriff ließ sich nicht starten: Port 8767 ist belegt.");
  await waitFor(() => expect(toggle().checked).toBe(false));
  expect(mocks.phoneAccess).toHaveBeenCalledTimes(2);
  act(() => setLang("en"));
  expect(screen.getByRole("alert").textContent).toBe("Phone access could not start: port 8767 is in use.");
  expect(screen.getByRole("switch", { name: "Phone access" })).toBeTruthy();
});
