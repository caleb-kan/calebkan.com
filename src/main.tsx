import { StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { App } from "./app";

const root = document.getElementById("cards-wrapper");
if (!root) throw new Error("Missing application root");
hydrateRoot(
  root,
  <StrictMode>
    <App />
  </StrictMode>,
);
