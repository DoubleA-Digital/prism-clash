// All live rooms by code. Codes are 5 letters without easily confused ones (no I or O).

import type { Logger, RandomSource } from "../platform";
import type { Member } from "./member";
import { Room } from "./room";

const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";

export interface RegistryOptions {
  log: Logger;
  random: RandomSource;
  /** false: rooms don't run their own timer (tests step them by hand). */
  loop?: boolean;
}

export class RoomRegistry {
  private rooms = new Map<string, Room>();

  constructor(private opts: RegistryOptions) {}

  create(testRoom: boolean): Room {
    const { log, random } = this.opts;
    let code = "";
    do {
      code = Array.from({ length: 5 }, () => LETTERS[random.int(LETTERS.length)]).join("");
    } while (this.rooms.has(code));
    const room = new Room(code, random.int(2 ** 31), testRoom, { loop: this.opts.loop, log });
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

  all(): IterableIterator<Room> {
    return this.rooms.values();
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
