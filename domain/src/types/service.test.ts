import { describe, expect, it } from "vitest";

import { and, fieldFilter, FilterOperators, or } from "./service.js";

interface User {
  id: string;
  name: string;
  age: number;
}

describe("filters", () => {
  it("creates a discriminated field filter", () => {
    const filter = fieldFilter<User, "age">("age", FilterOperators.Gte, 18);

    expect(filter).toEqual({
      type: "field",
      field: "age",
      operator: "Gte",
      value: 18,
    });
  });

  it("creates discriminated boolean filter groups", () => {
    const activeAdults = and<User>(
      fieldFilter("age", FilterOperators.Gte, 18),
      or<User>(
        fieldFilter("name", FilterOperators.Contains, "admin"),
        fieldFilter("id", FilterOperators.Eq, "root"),
      ),
    );

    expect(activeAdults.type).toBe("and");
    expect(activeAdults.filters[1].type).toBe("or");
  });
});
