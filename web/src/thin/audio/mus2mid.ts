/**
 * MUS → Type-0 MIDI, matching chocolate-doom mus2mid.c
 * (Ben Ryves / Simon Howard). MUS delay ticks map 1:1 at division 70.
 */

const NUM_CHANNELS = 16;
const MIDI_PERCUSSION_CHAN = 9;
const MUS_PERCUSSION_CHAN = 15;

const MUS_RELEASEKEY = 0x00;
const MUS_PRESSKEY = 0x10;
const MUS_PITCHWHEEL = 0x20;
const MUS_SYSTEMEVENT = 0x30;
const MUS_CHANGECONTROLLER = 0x40;
const MUS_SCOREEND = 0x60;

const MIDI_HEADER = new Uint8Array([
  0x4d, 0x54, 0x68, 0x64, // MThd
  0x00, 0x00, 0x00, 0x06,
  0x00, 0x00, // type 0
  0x00, 0x01, // 1 track
  0x00, 0x46, // division 70 → 140 Hz at default tempo
  0x4d, 0x54, 0x72, 0x6b, // MTrk
  0x00, 0x00, 0x00, 0x00, // track length placeholder
]);

const CONTROLLER_MAP = [
  0x00, 0x20, 0x01, 0x07, 0x0a, 0x0b, 0x5b, 0x5d, 0x40, 0x43, 0x78, 0x7b, 0x7e, 0x7f, 0x79,
];

class ByteWriter {
  private chunks: number[] = [];
  pos = 0;

  write(bytes: ArrayLike<number>) {
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i]! & 0xff;
      if (this.pos < this.chunks.length) this.chunks[this.pos] = b;
      else this.chunks.push(b);
      this.pos++;
    }
  }

  writeU8(v: number) {
    this.write([v]);
  }

  seek(p: number) {
    this.pos = p;
  }

  toUint8Array(): Uint8Array {
    return Uint8Array.from(this.chunks);
  }
}

/** Convert a Doom MUS lump to a Type-0 SMF. Throws if the lump is not MUS. */
export function musToMidi(mus: Uint8Array): Uint8Array {
  if (mus.length < 16) throw new Error("MUS lump too short");
  if (mus[0] !== 0x4d || mus[1] !== 0x55 || mus[2] !== 0x53 || mus[3] !== 0x1a) {
    throw new Error("Not a MUS lump");
  }
  const view = new DataView(mus.buffer, mus.byteOffset, mus.byteLength);
  const scoreStart = view.getUint16(6, true);
  if (scoreStart >= mus.length) throw new Error("MUS scorestart out of range");

  const out = new ByteWriter();
  out.write(MIDI_HEADER);
  let trackSize = 0;
  let queuedTime = 0;
  const channelMap = new Int32Array(NUM_CHANNELS).fill(-1);
  const velocities = new Uint8Array(NUM_CHANNELS).fill(127);

  const writeTime = (time: number) => {
    let buffer = time & 0x7f;
    let t = time >>> 7;
    while (t !== 0) {
      buffer = (buffer << 8) | ((t & 0x7f) | 0x80);
      t >>>= 7;
    }
    for (;;) {
      out.writeU8(buffer & 0xff);
      trackSize++;
      if ((buffer & 0x80) !== 0) buffer >>>= 8;
      else {
        queuedTime = 0;
        return;
      }
    }
  };

  const writeEvent = (status: number, ...data: number[]) => {
    writeTime(queuedTime);
    out.writeU8(status);
    for (const d of data) out.writeU8(d);
    trackSize += 1 + data.length;
  };

  const allocateMidiChannel = () => {
    let max = -1;
    for (let i = 0; i < NUM_CHANNELS; i++) {
      if (channelMap[i]! > max) max = channelMap[i]!;
    }
    let result = max + 1;
    if (result === MIDI_PERCUSSION_CHAN) result++;
    return result;
  };

  const midiChannel = (musCh: number): number => {
    if (musCh === MUS_PERCUSSION_CHAN) return MIDI_PERCUSSION_CHAN;
    if (channelMap[musCh] === -1) {
      channelMap[musCh] = allocateMidiChannel();
      // all notes off — chocolate-doom "D_DDTBLU disease" fix
      writeEvent(0xb0 | channelMap[musCh]!, 0x7b, 0);
    }
    return channelMap[musCh]!;
  };

  let i = scoreStart;
  let hitscoreend = false;
  while (!hitscoreend) {
    while (!hitscoreend) {
      if (i >= mus.length) throw new Error("MUS truncated");
      const desc = mus[i++]!;
      const ch = midiChannel(desc & 0x0f);
      const event = desc & 0x70;
      switch (event) {
        case MUS_RELEASEKEY: {
          if (i >= mus.length) throw new Error("MUS truncated");
          const key = mus[i++]!;
          writeEvent(0x80 | ch, key & 0x7f, 0);
          break;
        }
        case MUS_PRESSKEY: {
          if (i >= mus.length) throw new Error("MUS truncated");
          const key = mus[i++]!;
          if (key & 0x80) {
            if (i >= mus.length) throw new Error("MUS truncated");
            velocities[ch] = mus[i++]! & 0x7f;
          }
          writeEvent(0x90 | ch, key & 0x7f, velocities[ch]!);
          break;
        }
        case MUS_PITCHWHEEL: {
          if (i >= mus.length) throw new Error("MUS truncated");
          const wheel = mus[i++]! * 64;
          writeEvent(0xe0 | ch, wheel & 0x7f, (wheel >> 7) & 0x7f);
          break;
        }
        case MUS_SYSTEMEVENT: {
          if (i >= mus.length) throw new Error("MUS truncated");
          const ctrl = mus[i++]!;
          if (ctrl < 10 || ctrl > 14) throw new Error(`Bad MUS system event ${ctrl}`);
          writeEvent(0xb0 | ch, CONTROLLER_MAP[ctrl]!, 0);
          break;
        }
        case MUS_CHANGECONTROLLER: {
          if (i + 1 >= mus.length) throw new Error("MUS truncated");
          const ctrl = mus[i++]!;
          let value = mus[i++]!;
          if (ctrl === 0) {
            writeEvent(0xc0 | ch, value & 0x7f);
          } else {
            if (ctrl < 1 || ctrl > 9) throw new Error(`Bad MUS controller ${ctrl}`);
            if (value & 0x80) value = 0x7f;
            writeEvent(0xb0 | ch, CONTROLLER_MAP[ctrl]!, value);
          }
          break;
        }
        case MUS_SCOREEND:
          hitscoreend = true;
          break;
        default:
          throw new Error(`Unknown MUS event 0x${event.toString(16)}`);
      }
      if (desc & 0x80) break;
    }
    if (!hitscoreend) {
      let delay = 0;
      for (;;) {
        if (i >= mus.length) throw new Error("MUS truncated");
        const w = mus[i++]!;
        delay = delay * 128 + (w & 0x7f);
        if ((w & 0x80) === 0) break;
      }
      queuedTime += delay;
    }
  }

  writeEvent(0xff, 0x2f, 0);
  out.seek(18);
  out.write([
    (trackSize >> 24) & 0xff,
    (trackSize >> 16) & 0xff,
    (trackSize >> 8) & 0xff,
    trackSize & 0xff,
  ]);
  return out.toUint8Array();
}
