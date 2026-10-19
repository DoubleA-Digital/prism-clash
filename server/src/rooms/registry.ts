// All live rooms by code. Codes are 5 letters without easily confused ones (no I or O).

import { randomInt } from "node:crypto";
import { log } from "../log";
import type { Member } from "./member";
import { Room } from "./room";

const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";

export class RoomRegistry {
  private rooms = new Map<string, Room>();

  create(testRoom: boolean): Room {
    let code = "";
    do {
      code = Array.from({ length: 5 }, () => LETTERS[randomInt(LETTERS.length)]).join("");
    } while (this.rooms.has(code));
    const room = new Room(code, randomInt(2 ** 31), testRoom);
    room.onEmpty = () => {
      room.destroy();
      this.rooms.delete(code);
      log.info(`room ${code} closed (empty)`);
    };
    this.rooms.set(code, room);
    log.info(`room ${code} created${testRoom ? " (test)" : ""}`);
    return room;
  }

  get(code: string) {
    return this.rooms.get(code);
  }

  findByToken(token: string): { room: Room; member: Member } | null {
    for (const room of this.rooms.values()) {
      for (const m of room.members.values()) if (m.token === token) return { room, member: m };
    }
    return null;
  }

  count() {
    return this.rooms.size;
  }

  playerCount() {
    let n = 0;
    for (const r of this.rooms.values()) n += r.humans.filter((m) => m.connected).length;
    return n;
  }

  closeAll() {
    for (const r of this.rooms.values()) r.destroy();
    this.rooms.clear();
  }
}
