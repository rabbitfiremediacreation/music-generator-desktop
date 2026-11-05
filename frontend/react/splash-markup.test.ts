// @vitest-environment happy-dom
import { expect,it } from "vitest";
import html from "../splash.html?raw";
it("keeps a branded first paint while the React module is loading",()=>{
  const page=new DOMParser().parseFromString(html,"text/html");
  expect(page.querySelectorAll(".waveform rect")).toHaveLength(6);
  expect(page.querySelector(".app-icon")).not.toBeNull();
  expect(page.querySelector("#splashStatus")!.textContent).toContain("Starting");
  expect(page.querySelector("[role=progressbar]")!.hasAttribute("aria-valuenow")).toBe(false);
});
