// Minimal, dependency-free .tar.gz and .zip writers.
//
// Written in-process (instead of shelling out to tar/zip) so the archive is
// byte-identical in shape on every build host and — crucially — the Unix
// mode bits (0755 on the entrypoint) are set explicitly even when the
// archive is produced on Windows.
import { gzipSync, deflateRawSync, crc32 } from "node:zlib";

/**
 * @typedef {{ name: string, data: Buffer, mode: number }} Entry
 * `name` is the POSIX path inside the archive (no leading slash).
 */

function tarHeader(name, size, mode, mtime) {
  const h = Buffer.alloc(512, 0);
  if (Buffer.byteLength(name) > 100) throw new Error(`tar: path too long: ${name}`);
  const oct = (n, len) => n.toString(8).padStart(len - 1, "0") + "\0";
  h.write(name, 0, 100, "utf8");
  h.write(oct(mode, 8), 100, 8, "ascii");
  h.write(oct(0, 8), 108, 8, "ascii"); // uid
  h.write(oct(0, 8), 116, 8, "ascii"); // gid
  h.write(oct(size, 12), 124, 12, "ascii");
  h.write(oct(mtime, 12), 136, 12, "ascii");
  h.write("        ", 148, 8, "ascii"); // checksum placeholder
  h.write(name.endsWith("/") ? "5" : "0", 156, 1, "ascii");
  h.write("ustar\0", 257, 6, "ascii");
  h.write("00", 263, 2, "ascii");
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "ascii");
  return h;
}

/** @param {Entry[]} entries */
export function createTarGz(entries, mtime = Math.floor(Date.now() / 1000)) {
  const parts = [];
  for (const e of entries) {
    parts.push(tarHeader(e.name, e.data.length, e.mode, mtime), e.data);
    const pad = (512 - (e.data.length % 512)) % 512;
    if (pad) parts.push(Buffer.alloc(pad, 0));
  }
  parts.push(Buffer.alloc(1024, 0)); // end-of-archive marker
  return gzipSync(Buffer.concat(parts), { level: 9 });
}

function dosDateTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

/** @param {Entry[]} entries */
export function createZip(entries, now = new Date()) {
  const { time, date } = dosDateTime(now);
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const comp = deflateRawSync(e.data, { level: 9 });
    const crc = crc32(e.data) >>> 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, comp);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4); // made by: Unix → external attrs carry st_mode
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(((0o100000 | e.mode) << 16) >>> 0, 38); // regular file + mode
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + comp.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}
