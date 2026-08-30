import React from "react";
import { act, create } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

const cartHarness = vi.hoisted(() => ({ current: null }));

vi.mock("../../contexts/CartContext.jsx", () => ({
  useCart: () => cartHarness.current,
}));
vi.mock("../../hooks/useAddOnRecommendations.js", () => ({
  useAddOnRecommendations: () => ({ boxStatus: null, recommendations: [] }),
}));
vi.mock("../Modal.jsx", () => ({
  Modal: ({ isOpen, children }) => (isOpen ? <section data-modal="cart">{children}</section> : null),
}));
vi.mock("../SilhouetteSVG.jsx", () => ({
  FishSilhouetteSVG: () => <span data-fish-art="true" />,
}));
vi.mock("./BoxCapacityMeter.jsx", () => ({
  BoxCapacityMeter: () => null,
}));
vi.mock("./AddOnRecommendationStrip.jsx", () => ({
  AddOnRecommendationStrip: () => null,
}));
vi.mock("@phosphor-icons/react", () => {
  const Icon = () => <span data-icon="true" />;
  return {
    Plus: Icon,
    Minus: Icon,
    Trash: Icon,
    Info: Icon,
    Warning: Icon,
    ShoppingCartSimple: Icon,
  };
});

import { CartDrawer } from "./CartDrawer.jsx";

const listing = {
  id: "single-42",
  listingKey: "single-42",
  tokenId: 42,
  commonName: "Blue Dream Shrimp",
  scientificName: "Neocaridina davidi",
  seller: "0x1111111111111111111111111111111111111111",
  sellerAddress: "0x1111111111111111111111111111111111111111",
  quantity: 1,
  unitPriceCents: 1800,
  unavailable: false,
  isBatch: false,
};

function baseCartValue(overrides = {}) {
  return {
    cart: {
      seller: listing.seller,
      items: [listing],
      updatedAt: 1_725_000_000_000,
      serverRevision: 7,
    },
    totals: { itemCount: 1, subtotalDisplay: "$18.00" },
    changes: [],
    conflict: null,
    catalogAuthoritative: true,
    setItemQuantity: vi.fn(),
    removeItem: vi.fn(),
    resolveConflict: vi.fn(),
    retryMerge: vi.fn(),
    revalidate: vi.fn(() => ({
      ready: true,
      eligible: true,
      changes: [],
      cart: { seller: listing.seller, items: [listing], updatedAt: 1_725_000_000_000, serverRevision: 7 },
    })),
    addItem: vi.fn(),
    ...overrides,
  };
}

function nodeText(node) {
  return node.children.map((child) => (
    typeof child === "string" ? child : nodeText(child)
  )).join("");
}

describe("CartDrawer rendered synchronization behavior", () => {
  beforeEach(() => {
    cartHarness.current = baseCartValue();
  });

  it("revalidates a populated cart once per open transition, not on cart-state rerender", async () => {
    const stableRevalidate = cartHarness.current.revalidate;
    let renderer;
    await act(async () => {
      renderer = create(<CartDrawer isOpen onClose={vi.fn()} />);
    });

    expect(stableRevalidate).toHaveBeenCalledTimes(1);
    expect(renderer.root.findByProps({ "aria-label": "Remove Blue Dream Shrimp from cart" })).toBeTruthy();

    cartHarness.current = baseCartValue({
      revalidate: stableRevalidate,
      cart: { ...cartHarness.current.cart, items: [{ ...listing, unitPriceCents: 1900 }] },
    });
    await act(async () => {
      renderer.update(<CartDrawer isOpen onClose={vi.fn()} />);
    });

    expect(stableRevalidate).toHaveBeenCalledTimes(1);
    renderer.unmount();
  });

  it("renders both revision-conflict choices and dispatches only the explicit selection", async () => {
    const resolveConflict = vi.fn();
    cartHarness.current = baseCartValue({
      resolveConflict,
      conflict: {
        type: "sync_conflict",
        localCart: { seller: listing.seller, items: [listing], updatedAt: 2, serverRevision: 6 },
        accountCart: { seller: listing.seller, items: [{ ...listing, quantity: 2 }], updatedAt: 3, serverRevision: 7 },
      },
    });

    let renderer;
    await act(async () => {
      renderer = create(<CartDrawer isOpen onClose={vi.fn()} />);
    });

    const buttons = renderer.root.findAllByType("button");
    const accountChoice = buttons.find((button) => nodeText(button) === "Use account cart");
    const deviceChoice = buttons.find((button) => nodeText(button) === "Replace with this device");
    expect(accountChoice).toBeTruthy();
    expect(deviceChoice).toBeTruthy();

    await act(async () => accountChoice.props.onClick());
    expect(resolveConflict).toHaveBeenLastCalledWith("account");
    await act(async () => deviceChoice.props.onClick());
    expect(resolveConflict).toHaveBeenLastCalledWith("local");
    expect(resolveConflict).toHaveBeenCalledTimes(2);
    renderer.unmount();
  });
});
