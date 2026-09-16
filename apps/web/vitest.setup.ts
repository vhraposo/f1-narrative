import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";


if (typeof Element !== "undefined" && typeof Element.prototype.scrollTo !== "function") {
  Element.prototype.scrollTo = () => undefined;
}

afterEach(() => {
  cleanup();
});