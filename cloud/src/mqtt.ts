// Minimal MQTT 3.1.1 (protocol level 4) binary helpers.
//
// We only implement the slice the recorder needs: CONNECT/CONNACK,
// SUBSCRIBE/SUBACK, inbound PUBLISH (QoS 0 + 1), outbound PUBACK,
// PINGREQ/PINGRESP, DISCONNECT. Everything else is parsed as 'unknown'
// and ignored so a misbehaving broker can't crash the DO.
//
// We deliberately don't pull in mqtt.js because its event emitter +
// reconnect loop assume Node-flavored streams that the Workers runtime
// doesn't expose, and the protocol slice we need fits in ~150 lines.

export const PacketType = {
  CONNECT: 1,
  CONNACK: 2,
  PUBLISH: 3,
  PUBACK: 4,
  SUBSCRIBE: 8,
  SUBACK: 9,
  PINGREQ: 12,
  PINGRESP: 13,
  DISCONNECT: 14,
} as const;

export interface ConnectOptions {
  clientId: string;
  username?: string;
  password?: string;
  cleanSession?: boolean;
  keepAliveSecs?: number;
}

export type Packet =
  | { type: "connack"; sessionPresent: boolean; returnCode: number }
  | { type: "suback"; packetId: number; codes: number[] }
  | {
      type: "publish";
      topic: string;
      payload: Uint8Array;
      qos: 0 | 1 | 2;
      packetId?: number;
      retain: boolean;
      dup: boolean;
    }
  | { type: "puback"; packetId: number }
  | { type: "pingresp" }
  | { type: "unknown"; raw: Uint8Array };

export function encodeConnect(opts: ConnectOptions): Uint8Array {
  const protoName = encodeString("MQTT");
  const protoLevel = 4;
  let connectFlags = 0;
  if (opts.cleanSession ?? false) connectFlags |= 0x02;
  if (opts.username) connectFlags |= 0x80;
  if (opts.password) connectFlags |= 0x40;
  const keepAlive = opts.keepAliveSecs ?? 60;

  const variable = concat(
    protoName,
    new Uint8Array([protoLevel, connectFlags, (keepAlive >> 8) & 0xff, keepAlive & 0xff]),
  );

  const payloadParts: Uint8Array[] = [encodeString(opts.clientId)];
  if (opts.username) payloadParts.push(encodeString(opts.username));
  if (opts.password) payloadParts.push(encodeString(opts.password));
  const payload = concat(...payloadParts);

  return encodePacket(PacketType.CONNECT, 0, concat(variable, payload));
}

export function encodeSubscribe(
  packetId: number,
  topics: { topic: string; qos: 0 | 1 | 2 }[],
): Uint8Array {
  const variable = new Uint8Array([(packetId >> 8) & 0xff, packetId & 0xff]);
  const payloadParts: Uint8Array[] = [];
  for (const t of topics) {
    payloadParts.push(encodeString(t.topic));
    payloadParts.push(new Uint8Array([t.qos]));
  }
  // SUBSCRIBE has reserved flags = 0b0010 — the broker rejects 0.
  return encodePacket(PacketType.SUBSCRIBE, 0x02, concat(variable, ...payloadParts));
}

export function encodePuback(packetId: number): Uint8Array {
  return new Uint8Array([0x40, 0x02, (packetId >> 8) & 0xff, packetId & 0xff]);
}

export function encodePingreq(): Uint8Array {
  return new Uint8Array([0xc0, 0x00]);
}

export function encodeDisconnect(): Uint8Array {
  return new Uint8Array([0xe0, 0x00]);
}

/**
 * Tries to parse a single packet from the head of `buf`. Returns the
 * packet plus number of bytes consumed, or null when the buffer is
 * incomplete (caller should wait for more bytes).
 */
export function tryParse(
  buf: Uint8Array,
): { pkt: Packet; consumed: number } | null {
  if (buf.length < 2) return null;
  const header = buf[0]!;
  const type = header >> 4;
  const flags = header & 0x0f;

  let multiplier = 1;
  let remLen = 0;
  let pos = 1;
  while (true) {
    if (pos >= buf.length) return null;
    const b = buf[pos++]!;
    remLen += (b & 0x7f) * multiplier;
    if ((b & 0x80) === 0) break;
    multiplier *= 128;
    if (multiplier > 128 * 128 * 128) throw new Error("mqtt: malformed length");
  }

  const totalLen = pos + remLen;
  if (buf.length < totalLen) return null;
  const body = buf.subarray(pos, totalLen);

  switch (type) {
    case PacketType.CONNACK: {
      if (body.length < 2) throw new Error("mqtt: short CONNACK");
      return {
        pkt: { type: "connack", sessionPresent: (body[0]! & 1) === 1, returnCode: body[1]! },
        consumed: totalLen,
      };
    }
    case PacketType.SUBACK: {
      if (body.length < 3) throw new Error("mqtt: short SUBACK");
      const packetId = (body[0]! << 8) | body[1]!;
      const codes = Array.from(body.subarray(2));
      return { pkt: { type: "suback", packetId, codes }, consumed: totalLen };
    }
    case PacketType.PUBLISH: {
      const dup = (flags & 0x08) !== 0;
      const qos = ((flags >> 1) & 0x03) as 0 | 1 | 2;
      const retain = (flags & 0x01) !== 0;
      if (body.length < 2) throw new Error("mqtt: short PUBLISH");
      const topicLen = (body[0]! << 8) | body[1]!;
      if (body.length < 2 + topicLen) throw new Error("mqtt: short PUBLISH topic");
      const topic = new TextDecoder().decode(body.subarray(2, 2 + topicLen));
      let cursor = 2 + topicLen;
      let packetId: number | undefined;
      if (qos > 0) {
        if (body.length < cursor + 2) throw new Error("mqtt: short PUBLISH packetId");
        packetId = (body[cursor]! << 8) | body[cursor + 1]!;
        cursor += 2;
      }
      const payload = body.subarray(cursor);
      return {
        pkt: { type: "publish", topic, payload, qos, packetId, retain, dup },
        consumed: totalLen,
      };
    }
    case PacketType.PUBACK: {
      if (body.length < 2) throw new Error("mqtt: short PUBACK");
      const packetId = (body[0]! << 8) | body[1]!;
      return { pkt: { type: "puback", packetId }, consumed: totalLen };
    }
    case PacketType.PINGRESP: {
      return { pkt: { type: "pingresp" }, consumed: totalLen };
    }
    default:
      return { pkt: { type: "unknown", raw: buf.subarray(0, totalLen) }, consumed: totalLen };
  }
}

function encodeString(s: string): Uint8Array {
  const enc = new TextEncoder().encode(s);
  const out = new Uint8Array(2 + enc.length);
  out[0] = (enc.length >> 8) & 0xff;
  out[1] = enc.length & 0xff;
  out.set(enc, 2);
  return out;
}

function encodeRemainingLength(n: number): Uint8Array {
  const bytes: number[] = [];
  do {
    let byte = n & 0x7f;
    n >>>= 7;
    if (n > 0) byte |= 0x80;
    bytes.push(byte);
  } while (n > 0);
  return new Uint8Array(bytes);
}

function encodePacket(type: number, flags: number, body: Uint8Array): Uint8Array {
  const header = (type << 4) | (flags & 0x0f);
  const lenBytes = encodeRemainingLength(body.length);
  const out = new Uint8Array(1 + lenBytes.length + body.length);
  out[0] = header;
  out.set(lenBytes, 1);
  out.set(body, 1 + lenBytes.length);
  return out;
}

function concat(...arrs: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const a of arrs) total += a.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}
