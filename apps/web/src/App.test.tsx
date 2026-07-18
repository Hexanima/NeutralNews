import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import App from "./App.js";

describe("App", () => {
  it("renders the clean architecture template screen", () => {
    const markup = renderToStaticMarkup(<App />);

    expect(markup).toContain("Clean Architecture Template");
    expect(markup).toContain("Domain layer: ready");
    expect(markup).not.toContain("Vite + React");
  });
});
