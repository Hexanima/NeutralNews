import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import App from "./App.js";

describe("App", () => {
  it("renders the NeutralNews foundation screen", () => {
    const markup = renderToStaticMarkup(<App />);

    expect(markup).toContain("NeutralNews");
    expect(markup).toContain("Domain layer: ready");
    expect(markup).not.toMatch(/Clean Architecture\s+Template/);
    expect(markup).not.toMatch(/Vite\s+\+\s+React/);
  });
});
