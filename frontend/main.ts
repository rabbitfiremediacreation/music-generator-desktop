import { createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DesktopApp, createAppRouter } from "./react/app";
import { createAppQueryClient } from "./react/data";
import "./react/styles.css";

export function startApp(): void {
  const client = createAppQueryClient();
  const router = createAppRouter(client);
  createRoot(document.getElementById("root")!).render(createElement(StrictMode, null, createElement(DesktopApp, { client, router })));
}
