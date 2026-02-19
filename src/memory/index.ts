import { Scratchpad } from './scratchpad.js';
import { Channels } from './channels.js';

export class SwarmMemory {
  public readonly scratchpad: Scratchpad;
  public readonly channels: Channels;

  constructor(limits?: { maxKeyBytes?: number; maxTotalBytes?: number }) {
    this.scratchpad = new Scratchpad(limits);
    this.channels = new Channels();
  }
}

export { Scratchpad } from './scratchpad.js';
export { Channels } from './channels.js';
