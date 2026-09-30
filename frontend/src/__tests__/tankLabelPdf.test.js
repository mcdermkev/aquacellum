/**
 * generateTankQRLabel with a label target: the QR encodes the target URL, a
 * public label prints the /t/ link and no location, and a private label prints
 * the owner-only note. jsPDF and qrcode are faked so this runs in Node.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ qr: [], text: [], saved: [] }));

vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn(async (text) => { calls.qr.push(text); return "data:image/png;base64,AAAA"; }) },
}));

vi.mock("jspdf", () => {
  class FakePdf {
    constructor() {
      this.internal = { pageSize: { getWidth: () => 51, getHeight: () => 76 } };
    }
    setFillColor() {}
    setDrawColor() {}
    setTextColor() {}
    setFont() {}
    setFontSize() {}
    setLineWidth() {}
    rect() {}
    roundedRect() {}
    addImage() {}
    splitTextToSize(text) { return [String(text)]; }
    text(t, x, y) { calls.text.push({ t: String(t), x, y }); }
    save(name) { calls.saved.push(name); }
  }
  return { jsPDF: FakePdf };
});

const { generateTankQRLabel } = await import("../utils/pdfExport.js");
const { tankLabelTarget, PRIVATE_LABEL_NOTE } = await import("../utils/tankLabel.js");

const TOKEN = "0123456789abcdef0123456789abcdef";
const tank = { id: 42, name: "Club tank", facility: "Home", room: "Basement", rack: "Rack A", volumeLiters: 40 };
const fields = (target) => ({
  tankId: tank.id, tankName: tank.name, facility: tank.facility, room: tank.room, rack: tank.rack,
  volumeLiters: tank.volumeLiters, containment: "Tank", target,
});

beforeEach(() => { calls.qr = []; calls.text = []; calls.saved = []; });

describe("generateTankQRLabel", () => {
  it("public: encodes and prints the /t/ URL, without location or the local id", async () => {
    await generateTankQRLabel(fields(tankLabelTarget(tank, { token: TOKEN })));
    expect(calls.qr).toEqual([`https://aquacellum.com/t/${TOKEN}`]);
    const printed = calls.text.map((c) => c.t).join("\n");
    expect(printed).toContain(`aquacellum.com/t/${TOKEN}`);
    expect(printed).not.toMatch(/Basement|Rack A|ID: 42|owner's app/);
    expect(calls.saved).toHaveLength(1);
  });

  it("private: encodes /app#tank=<id> and prints the owner-only note", async () => {
    await generateTankQRLabel(fields(tankLabelTarget(tank, null)));
    expect(calls.qr).toEqual(["https://aquacellum.com/app#tank=42"]);
    const printed = calls.text.map((c) => c.t).join("\n");
    expect(printed).toContain(PRIVATE_LABEL_NOTE);
    expect(printed).toContain("ID: 42");
  });

  it("keeps every line inside the 51mm x 76mm page", async () => {
    await generateTankQRLabel(fields(tankLabelTarget(tank, null)));
    for (const c of calls.text) {
      expect(c.y).toBeGreaterThan(0);
      expect(c.y).toBeLessThan(76);
      expect(c.x).toBeLessThanOrEqual(51);
    }
  });
});
