import { httpRequestBlock } from "./httpRequest";

export const requestsBlocks = {
  httpRequest: httpRequestBlock,
} as const;

export { httpRequestBlock };
