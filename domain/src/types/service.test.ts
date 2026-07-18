import { describe, expect, it } from "vitest";

import { and, fieldFilter, FilterOperators, or } from "./service.js";

interface NewsSourceFixture {
  id: string;
  name: string;
  country: "AR" | "UY";
  active: boolean;
}

describe("filters", () => {
  it("creates a discriminated field filter", () => {
    const filter = fieldFilter<NewsSourceFixture, "country">(
      "country",
      FilterOperators.Eq,
      "AR",
    );

    expect(filter).toEqual({
      type: "field",
      field: "country",
      operator: "Eq",
      value: "AR",
    });
  });

  it("creates discriminated boolean filter groups", () => {
    const activeArgentineSources = and<NewsSourceFixture>(
      fieldFilter("active", FilterOperators.Eq, true),
      or<NewsSourceFixture>(
        fieldFilter("country", FilterOperators.Eq, "AR"),
        fieldFilter("name", FilterOperators.Contains, "Argentina"),
      ),
    );

    expect(activeArgentineSources.type).toBe("and");
    expect(activeArgentineSources.filters[1].type).toBe("or");
  });
});
