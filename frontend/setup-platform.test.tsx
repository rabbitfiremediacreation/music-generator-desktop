// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "./react/i18n";
import { SetupScreen } from "./react/setup/SetupScreen";
import { setupFixture } from "./react/setup/fixtures";
import { setLang, t } from "./i18n.js";
import { vi } from "vitest";
vi.mock("@tauri-apps/api/core",()=>({invoke:async()=>({missing_bytes:0,free_bytes:100,backend:"gpu"})}));
afterEach(cleanup);
it.each(["windows","linux","macos"])("keeps %s guidance translated when changing languages",platform=>{
  setLang("de");
  const view=render(<QueryClientProvider client={new QueryClient()}><I18nProvider><SetupScreen bootstrap={{...setupFixture,hardware:{...setupFixture.hardware,platform}}} onComplete={()=>{}}/></I18nProvider></QueryClientProvider>);
  const key=platform==="macos"?"path_hint":"path_hint_plain";
  expect(view.container.querySelector("#setupPathHint")!.textContent).toBe(t(key));
  fireEvent.change(view.getByRole("combobox",{name:"Sprache"}),{target:{value:"en"}});
  expect(view.container.querySelector("#setupPathHint")!.textContent).toBe(t(key));
});
