import { describe, expect, it } from "vitest";
import { decodeText } from "@/lib/files/read";

const TEXT = "Conciliação e Análise de Crédito — ação\nSegunda linha";

function utf16(text: string, littleEndian: boolean, bom: boolean): ArrayBuffer {
  const out = new Uint8Array((bom ? 2 : 0) + text.length * 2);
  const view = new DataView(out.buffer);
  if (bom) view.setUint16(0, 0xfeff, littleEndian);
  for (let i = 0; i < text.length; i++) view.setUint16((bom ? 2 : 0) + i * 2, text.charCodeAt(i), littleEndian);
  return out.buffer;
}

describe("decodeText", () => {
  it("lê UTF-16 com BOM (big e little endian)", () => {
    expect(decodeText(utf16(TEXT, false, true))).toBe(TEXT);
    expect(decodeText(utf16(TEXT, true, true))).toBe(TEXT);
  });

  it("lê UTF-16 sem BOM", () => {
    expect(decodeText(utf16(TEXT, true, false))).toBe(TEXT);
    expect(decodeText(utf16(TEXT, false, false))).toBe(TEXT);
  });

  it("continua lendo UTF-8 (com e sem BOM) e Windows-1252", () => {
    const utf8 = new TextEncoder().encode(TEXT);
    expect(decodeText(utf8.buffer as ArrayBuffer)).toBe(TEXT);
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8]).buffer)).toBe(TEXT);
    const latin = new Uint8Array([0x41, 0xe7, 0xe3, 0x6f]); // "Ação" em Windows-1252, sem o til do A
    expect(decodeText(latin.buffer)).toBe("Ação");
  });
});
