import { createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Splash } from "./react/Splash";
import { I18nProvider } from "./react/i18n";
import "./react/splash.css";

createRoot(document.getElementById("root")!).render(createElement(StrictMode, null, createElement(I18nProvider, null, createElement(Splash))));
