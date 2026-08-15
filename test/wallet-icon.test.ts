// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { inflateSync } from 'node:zlib';
import { WALLET_ICON_DATA_URI } from '../lib/shared/wallet-icon.js';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('WALLET_ICON_DATA_URI', () => {
  it('starts with the PNG data URI prefix', () => {
    expect(WALLET_ICON_DATA_URI.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('decodes to a valid PNG with 48x48 dimensions and an inflatable IDAT stream', () => {
    const base64 = WALLET_ICON_DATA_URI.slice('data:image/png;base64,'.length);
    const png = Buffer.from(base64, 'base64');

    expect(png.subarray(0, 8)).toEqual(PNG_SIGNATURE);

    const idatChunks: Buffer[] = [];
    let offset = 8;
    while (offset < png.length) {
      const length = png.readUInt32BE(offset);
      const type = png.toString('ascii', offset + 4, offset + 8);
      const data = png.subarray(offset + 8, offset + 8 + length);
      if (type === 'IDAT') idatChunks.push(data);
      if (type === 'IHDR') {
        expect(data.readUInt32BE(0)).toBe(48);
        expect(data.readUInt32BE(4)).toBe(48);
      }
      offset += 8 + length + 4; // data + CRC
    }

    expect(() => inflateSync(Buffer.concat(idatChunks))).not.toThrow();
  });
});
